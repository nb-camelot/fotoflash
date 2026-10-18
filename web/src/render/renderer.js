// Compone una stampa come PrintRenderer.kt: impaginazione dal core, foto retinate, testi e
// decorazioni in nero pieno. Le foto e i testi seguono due strade apposta: le foto passano da
// regolazioni tonali e retino; i testi si disegnano con antialias e poi si sogliano, così restano
// nitidi e mai puntinati. Alla fine tutto si somma (OR) in un'unica immagine a 1 bit.

import { layoutTemplate } from '../core/template.js';
import { defaultTone } from '../core/model.js';
import { BitImage, blit, bitImageFromRgba } from '../core/bitimage.js';
import { applyTone } from '../core/tone.js';
import { dither } from '../core/dither.js';
import { ensureFonts, fontsReady, fontFor, FONT_METRICS, FONT_FAMILY } from './fonts.js';
import { createCanvas, readableContext, releaseCanvas, grayFromSource, bitImageToCanvas } from './bitmap.js';

/** Marchio stampato in testa allo scontrino: è un logotipo, non si traduce. */
export const BRAND_TEXT = 'FOTOFLASH';

/** Soglia per i testi: sopra 128 i bordi antialias si ispessiscono un poco, tratti più pieni. */
export const TEXT_THRESHOLD = 150;

/** Il corpo si riduce al massimo fino al 70% prima di troncare. */
export const MIN_TEXT_SCALE = 0.7;
export const MIN_TEXT_DOTS = 8;
export const MAX_LINES = 4;

/** Spaziatura del marchio, in em: il logotipo respira come sul brand. */
export const BRAND_LETTER_SPACING = 0.08;

/** Lettera di riferimento per l'altezza delle maiuscole. */
const CAP_SAMPLE = 'H';
const ELLIPSIS = '…';
const DEFAULT_DITHER = 'ATKINSON';

// ---------------------------------------------------------------- errori e utilità

function renderError(code, message, cause) {
  const e = new Error(message);
  e.name = 'RenderError';
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

function checkAborted(signal) {
  if (!signal?.aborted) return;
  const e = new Error('composizione annullata');
  e.name = 'AbortError';
  e.code = 'aborted';
  throw e;
}

/** Cede il passo al browser tra una foto e l'altra: l'editor resta reattivo durante una striscia. */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

let segmenter;

/** Grafemi (bandiere ed emoji composte restano interi); senza Intl.Segmenter, code point. */
export function graphemes(text) {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  }
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

const words = (text) => text.split(' ').filter((w) => w.length > 0);

// ---------------------------------------------------------------- testi fissi

/** Sostituisce %1$d / %1$04d / %1$s / %d / %s con [n], come getString(R.string.ed_print_number, n). */
export function formatNumberLabel(template, n) {
  return String(template).replace(/%(?:1\$)?(0?)(\d*)([ds])/g, (_, zero, width, kind) => {
    const value = kind === 'd' ? String(Math.max(0, Math.trunc(Number(n) || 0))) : String(n);
    return width ? value.padStart(Number(width), zero ? '0' : ' ') : value;
  });
}

/**
 * I testi fissi li decide l'app, non il core (che non conosce la lingua dell'utente):
 * marchio, ringraziamento finale e numero progressivo nella forma localizzata, da request.labels.
 * labels: { footer: string, printNumber: (n) => string, brand?: string }.
 */
export function resolveText(block, texts = {}, labels = {}) {
  const own = block?.text ?? '';
  switch (block?.role) {
    case 'BRAND': {
      if (typeof labels?.brand === 'string' && labels.brand.trim()) return labels.brand;
      return own.trim() ? own : BRAND_TEXT;
    }
    case 'FOOTER': {
      const footer = typeof labels?.footer === 'function' ? labels.footer() : labels?.footer;
      return footer != null && String(footer).trim() ? String(footer) : own;
    }
    case 'PRINT_NUMBER': {
      const n = texts?.printNumber;
      const label = labels?.printNumber;
      if (n == null || label == null) return own;
      let s = typeof label === 'function' ? label(n) : formatNumberLabel(label, n);
      // una traduzione che non espande %1$04d si completa qui, invece di stampare il segnaposto
      if (typeof s === 'string' && /%(?:1\$)?0?\d*[ds]/.test(s)) s = formatNumberLabel(s, n);
      return s != null && String(s).trim() ? String(s) : own;
    }
    default:
      return own;
  }
}

// ---------------------------------------------------------------- adattamento dei testi (puro)
// metrics: { width(text, size) → px (spaziatura compresa), spacing(size) → interlinea px }

/** Righe che stanno nell'altezza del riquadro: almeno 1, al massimo MAX_LINES. */
export function maxLinesFor(lineSpacing, height) {
  if (!(lineSpacing > 0)) return 1;
  return Math.min(MAX_LINES, Math.max(1, Math.trunc(height / lineSpacing)));
}

/** Il testo su una riga, o a capo sulle parole se c'è spazio; null se non entra. */
export function wrapOrNull(text, measure, width, maxLines) {
  if (measure(text) <= width) return [text];
  if (maxLines < 2) return null;
  const lines = [];
  let line = '';
  for (const word of words(text)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) {
      line = candidate;
      continue;
    }
    // una parola che da sola non sta nella riga non si spezza: meglio rimpicciolire
    if (!line || measure(word) > width) return null;
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

/** Troncatura in fondo con "…" (TextUtils.ellipsize END); "" se nemmeno i puntini ci stanno. */
export function ellipsize(text, measure, width) {
  if (measure(text) <= width) return text;
  if (measure(ELLIPSIS) > width) return '';
  const parts = graphemes(text);
  for (let k = parts.length - 1; k > 0; k--) {
    const candidate = parts.slice(0, k).join('') + ELLIPSIS;
    if (measure(candidate) <= width) return candidate;
  }
  return ELLIPSIS;
}

/** Ultima spiaggia al corpo minimo: righe piene finché ci stanno, l'ultima troncata. */
export function wrapEllipsized(text, measure, width, maxLines) {
  if (maxLines < 2) return [ellipsize(text, measure, width)];
  const list = words(text);
  const lines = [];
  let index = 0;
  while (lines.length < maxLines - 1 && index < list.length && measure(list[index]) <= width) {
    let line = list[index++];
    while (index < list.length && measure(`${line} ${list[index]}`) <= width) {
      line = `${line} ${list[index++]}`;
    }
    lines.push(line);
  }
  const rest = list.slice(index).join(' ');
  if (rest) lines.push(ellipsize(rest, measure, width));
  return lines;
}

/**
 * Prima prova il corpo pieno (andando a capo solo se il riquadro è alto abbastanza per più
 * righe), poi riduce di un punto alla volta fino al 70%, infine tronca con i puntini.
 * → { size, lines }
 */
export function fitText(text, sizeDots, rect, metrics) {
  const width = rect.width;
  const maxSize = Math.max(sizeDots, MIN_TEXT_DOTS);
  const minSize = Math.max(maxSize * MIN_TEXT_SCALE, MIN_TEXT_DOTS);
  let size = maxSize;
  for (;;) {
    const s = size;
    const lines = wrapOrNull(text, (t) => metrics.width(t, s), width, maxLinesFor(metrics.spacing(s), rect.height));
    if (lines) return { size: s, lines };
    if (size <= minSize) break;
    size = Math.max(size - 1, minSize);
  }
  return {
    size: minSize,
    lines: wrapEllipsized(text, (t) => metrics.width(t, minSize), width, maxLinesFor(metrics.spacing(minSize), rect.height)),
  };
}

/**
 * Spaziatura tra le lettere in pixel, arrotondata come fa Android (Minikin) per il testo non lineare.
 * Android la divide metà prima e metà dopo ogni lettera.
 */
export function letterSpacingPx(em, size) {
  return em ? Math.round(em * size) : 0;
}

/** Bordo sinistro della riga larga [width] nel riquadro, secondo l'allineamento del core. */
export function alignedLeft(align, rect, width) {
  if (align === 'START') return rect.left;
  if (align === 'END') return rect.left + rect.width - width;
  return rect.left + rect.width / 2 - width / 2;
}

// ---------------------------------------------------------------- decorazioni (pure)

function decorationType(d) {
  const t = String(d?.type ?? d?.kind ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (t === 'dashed' || t === 'dashedline' || t === 'dash') return 'dashed';
  if (t === 'frame') return 'frame';
  if (t === 'zigzag') return 'zigzag';
  return '';
}

/** Trattini da from a to; y è la prima riga del tratto. → [[x, y, w, h], ...] */
export function dashedRects(line) {
  const dash = Math.max(1, line.dash ?? 6);
  const step = dash + Math.max(0, line.gap ?? 4);
  const thickness = Math.max(1, line.thickness ?? 2);
  const rects = [];
  for (let x = line.from; x < line.to; x += step) {
    rects.push([x, line.y, Math.min(x + dash, line.to) - x, thickness]);
  }
  return rects;
}

/** Cornice disegnata all'interno del rettangolo, così non sfora mai i margini del core. */
export function frameRects(frame) {
  const r = frame.rect;
  const t = Math.min(Math.max(1, frame.thickness ?? 2), Math.trunc(Math.min(r.width, r.height) / 2) + 1);
  const right = r.left + r.width;
  const bottom = r.top + r.height;
  return [
    [r.left, r.top, r.width, t],
    [r.left, bottom - t, r.width, t],
    [r.left, r.top, t, r.height],
    [right - t, r.top, t, r.height],
  ];
}

/**
 * Dente di sega della carta strappata: triangoli pieni che partono dalla riga y e scendono di
 * mezzo dente, larghi quanto la stampa. Rasterizzati a mano, riga per riga, con la regola del
 * centro del pixel: sulla carta niente antialias, che diventerebbe sbavatura.
 */
export function zigzagRects(zigzag, width) {
  const tooth = Math.max(2, Math.trunc(zigzag.tooth ?? 8));
  const top = zigzag.y;
  const depth = tooth / 2;
  const rects = [];
  for (let x = 0; x < width; x += tooth) {
    const cx = x + tooth / 2;
    for (let py = Math.floor(top); py < Math.ceil(top + depth); py++) {
      const cy = py + 0.5;
      if (cy < top || cy > top + depth) continue;
      const half = (tooth / 2) * (1 - (cy - top) / depth);
      const from = Math.ceil(cx - half - 0.5);
      const to = Math.ceil(cx + half - 0.5);
      if (to > from) rects.push([from, py, to - from, 1]);
    }
  }
  return rects;
}

/** Tutti i rettangoli neri delle decorazioni dell'impaginazione. */
export function decorationRects(layout) {
  const out = [];
  for (const d of layout.decorations ?? []) {
    switch (decorationType(d)) {
      case 'dashed':
        out.push(...dashedRects(d));
        break;
      case 'frame':
        out.push(...frameRects(d));
        break;
      case 'zigzag':
        out.push(...zigzagRects(d, layout.width));
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- disegno sul canvas

/**
 * Misure del canvas, spaziatura delle lettere compresa (come Paint.measureText).
 * Le metriche verticali dei font del brand vengono dalle tabelle dei TTF: Chrome arrotonda
 * ascendente e discendente all'intero, Android (Paint.fontSpacing) no. Col carattere di ripiego
 * (font non caricati) si usano quelle misurate dal canvas.
 */
function canvasMetrics(ctx, role, spacingEm, brandFonts) {
  const table = FONT_METRICS[role] ?? FONT_METRICS.DISPLAY;
  return {
    width(text, size) {
      ctx.font = fontFor(role, size);
      return ctx.measureText(text).width + graphemes(text).length * letterSpacingPx(spacingEm, size);
    },
    spacing(size) {
      if (brandFonts) return table.spacing * size;
      ctx.font = fontFor(role, size);
      const m = ctx.measureText(CAP_SAMPLE);
      const h = (m.fontBoundingBoxAscent ?? NaN) + (m.fontBoundingBoxDescent ?? NaN);
      return h > 0 ? h : table.spacing * size;
    },
  };
}

/** Altezza delle maiuscole: come getTextBounds("H") di Android, arrotondata per eccesso. */
function capHeightOf(ctx, role, size, brandFonts) {
  if (brandFonts) return Math.ceil((FONT_METRICS[role] ?? FONT_METRICS.DISPLAY).capHeight * size - 1e-6);
  ctx.font = fontFor(role, size);
  const ascent = ctx.measureText(CAP_SAMPLE).actualBoundingBoxAscent;
  if (ascent > 0) return Math.ceil(ascent - 1e-3);
  return size * 0.7;
}

function setLetterSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

/** Una riga che comincia (primo glifo) in x; con la spaziatura, a mano se il canvas non la sa fare. */
function drawLine(ctx, line, x, baseline, spacing) {
  if (spacing === 0) {
    ctx.fillText(line, x, baseline);
    return;
  }
  if ('letterSpacing' in ctx) {
    setLetterSpacing(ctx, spacing);
    ctx.fillText(line, x, baseline);
    setLetterSpacing(ctx, 0);
    return;
  }
  let cursor = x;
  for (const g of graphemes(line)) {
    ctx.fillText(g, cursor, baseline);
    cursor += ctx.measureText(g).width + spacing;
  }
}

/** Testo nel riquadro del blocco: adattamento, centratura ottica sulle maiuscole, allineamento. */
function drawText(ctx, block, rawText) {
  const text = String(rawText ?? '').trim();
  const rect = block.rect;
  if (!text || !rect || !(rect.width > 0 && rect.height > 0)) return;

  const role = block.font ?? 'MONO';
  const spacingEm = block.role === 'BRAND' ? BRAND_LETTER_SPACING : 0;
  const brandFonts = fontsReady();
  const metrics = canvasMetrics(ctx, role, spacingEm, brandFonts);
  const fitted = fitText(text, block.sizeDots ?? 22, rect, metrics);
  const size = fitted.size;

  // centratura ottica: si centra l'altezza delle maiuscole, le discendenti scendono sotto la base
  const capHeight = capHeightOf(ctx, role, size, brandFonts);
  const lineSpacing = metrics.spacing(size);
  const blockHeight = capHeight + lineSpacing * (fitted.lines.length - 1);
  let baseline = rect.top + (rect.height - blockHeight) / 2 + capHeight;
  const spacing = letterSpacingPx(spacingEm, size);

  for (const line of fitted.lines) {
    const width = metrics.width(line, size);
    // Android mette metà spaziatura prima del primo glifo (e metà dopo l'ultimo)
    const x = alignedLeft(block.align, rect, width) + Math.floor(spacing / 2);
    ctx.font = fontFor(role, size);
    drawLine(ctx, line, x, baseline, spacing);
    baseline += lineSpacing;
  }
}

let offscreenFontsOk;

/**
 * Canvas per i testi. L'OffscreenCanvas del thread principale usa i font del documento in Chrome;
 * se in qualche browser non li vede (stessa larghezza con e senza Space Mono), si ripiega su un
 * canvas del DOM fuori pagina, che li vede sempre.
 */
function textCanvas(width, height) {
  const canvas = createCanvas(width, height);
  const doc = globalThis.document;
  if (!fontsReady() || typeof OffscreenCanvas === 'undefined' || !(canvas instanceof OffscreenCanvas) || !doc) {
    return canvas;
  }
  if (offscreenFontsOk === undefined) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sample = 'iiiiWWWW';
    ctx.font = `48px "${FONT_FAMILY.mono}", serif`;
    const withBrand = ctx.measureText(sample).width;
    ctx.font = '48px serif';
    offscreenFontsOk = withBrand !== ctx.measureText(sample).width;
  }
  if (offscreenFontsOk) return canvas;
  releaseCanvas(canvas);
  const el = doc.createElement('canvas');
  el.width = width;
  el.height = height;
  return el;
}

/**
 * Testi e decorazioni su un canvas bianco grande quanto la stampa (1 pixel = 1 punto), poi
 * soglia: i bordi antialias un po' scuri diventano neri e i tratti restano pieni.
 */
function renderOverlay(layout, request) {
  const { width, height } = layout;
  const canvas = textCanvas(width, height);
  try {
    const ctx = readableContext(canvas);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    // decorazioni: rettangoli a coordinate intere, quindi netti anche senza togliere l'antialias
    for (const [x, y, w, h] of decorationRects(layout)) ctx.fillRect(x, y, w, h);

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if ('fontKerning' in ctx) ctx.fontKerning = 'normal';
    setLetterSpacing(ctx, 0);
    for (const block of layout.texts ?? []) {
      drawText(ctx, block, resolveText(block, request.texts, request.labels));
    }
    const { data } = ctx.getImageData(0, 0, width, height);
    return bitImageFromRgba(width, height, data, TEXT_THRESHOLD);
  } finally {
    releaseCanvas(canvas);
  }
}

/** Foto: ritaglio al riquadro, scala di grigi, regolazioni tonali, retino. */
function renderPhoto(photo, rect, tone, algorithm) {
  const gray = grayFromSource(photo, rect.width, rect.height);
  return dither(applyTone(gray, tone), algorithm);
}

/**
 * Compone la stampa.
 * request: { photos: ImageBitmap[]|HTMLCanvasElement[], template, paper, dither, tone, texts,
 *            labels: { footer, printNumber(n), brand? }, signal?: AbortSignal }
 * → { bitImage, canvas }: bitImage va alla testina, canvas è la stessa immagine (1 px = 1 punto).
 * Errori con err.code: 'no-photos' | 'render-failed' | 'aborted'. Le foto del chiamante non si chiudono.
 */
export async function renderPrint(request) {
  const photos = Array.from(request?.photos ?? []).filter(Boolean);
  if (photos.length === 0) throw renderError('no-photos', 'nessuna foto da stampare');
  const signal = request.signal;
  // i font si caricano mentre si retinano le foto
  const fonts = ensureFonts();
  try {
    const layout = layoutTemplate(request.template, request.paper, photos.length, request.texts ?? {});
    const print = new BitImage(layout.width, layout.height);
    const tone = { ...defaultTone(), ...(request.tone ?? {}) };
    const algorithm = request.dither || DEFAULT_DITHER;

    const rects = layout.photos ?? [];
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (!(rect.width > 0 && rect.height > 0)) continue;
      if (i > 0) await yieldToEventLoop();
      checkAborted(signal);
      // la Striscia ha tanti riquadri quante foto; il modulo è solo una difesa
      blit(print, renderPhoto(photos[i % photos.length], rect, tone, algorithm), rect.left, rect.top);
    }

    if ((layout.texts?.length ?? 0) > 0 || (layout.decorations?.length ?? 0) > 0) {
      await fonts;
      checkAborted(signal);
      blit(print, renderOverlay(layout, request), 0, 0);
    }
    checkAborted(signal);
    return { bitImage: print, canvas: bitImageToCanvas(print) };
  } catch (e) {
    if (e?.name === 'AbortError' || typeof e?.code === 'string') throw e;
    throw renderError('render-failed', `composizione della stampa fallita: ${e?.message ?? e}`, e);
  }
}
