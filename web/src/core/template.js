// Impaginazione dei modelli di stampa: porting di TemplateGeometry.kt.
// Tutto in punti di testina (8 punti = 1 mm). Le misure sono pensate per 384 punti (58 mm) e
// scalate di 1.5 per l'80 mm, arrotondando all'intero. L'altezza è la somma reale degli elementi:
// niente spazio vuoto in fondo, l'avanzamento carta lo fa la stampante (ESC d).

import { Rect, TemplateKind, dashedLine, intArg, paperOf, roundToInt, textsWithDefaults } from './model.js';
import { fitText, lineHeightFor, normalizeText } from './textmetrics.js';

/** Larghezza su cui sono pensate le misure. */
export const BASE_WIDTH = 384;
/** Scatti massimi in una striscia. */
export const MAX_STRIP_PHOTOS = 4;
/** Testo precompilato del blocco BRAND nello scontrino. */
export const BRAND_TEXT = 'FOTOFLASH';

// Corpi nominali a 384 punti; si riducono solo se il testo non ci sta.
export const SIZE_EVENT_TITLE = 40;
export const SIZE_BRAND = 48;
export const SIZE_CAPTION = 28;
export const SIZE_HASHTAG = 22;
export const SIZE_DATE = 20;
export const SIZE_PRINT_NUMBER = 22;
export const SIZE_FOOTER = 22;

// Misure a 384 punti
const MARGIN = 16;
const GAP = 12;
const TEXT_TAIL = 8;
const TEXT_INSET = 4;
const SEPARATOR = 20;
const DASH = 6;
const DASH_GAP = 4;
const DASH_THICKNESS = 2;
const POLAROID_BAND = 96;
const POLAROID_BAND_PAD = 12;
const FULL_PHOTO_HEIGHT = 512;
const MIN_TEXT = 14;
/** Riduzione massima del corpo in assoluto (oltre si tronca con l'ellissi). */
const MIN_SHRINK = 0.6;

/** Quante foto usa davvero [kind] se ne vengono offerte [requested]. */
export function photoCount(kind, requested) {
  if (kind !== 'STRIP') return 1;
  const n = intArg(requested, 1);
  return n < 1 ? 1 : n > MAX_STRIP_PHOTOS ? MAX_STRIP_PHOTOS : n;
}

/** Testo del numero progressivo: "N. 0042". */
export function printNumberText(n) {
  const v = Math.max(0, intArg(n, 0));
  return `N. ${String(v).padStart(4, '0')}`;
}

/**
 * Impagina [kind] ('POLAROID' | 'FULL' | 'STRIP' | 'RECEIPT') sulla carta [paper] ('MM58' | 'MM80').
 * → { width, height, photos: [Rect], texts: [{ role, text, rect, font, sizeDots, align }],
 *     decorations: [{ type: 'dashed', y, from, to, dash, gap, thickness }] }
 *
 * - POLAROID: margini 16, foto quadrata 352x352, fascia di almeno 96 punti con didascalia e data;
 *   senza testi la fascia sparisce e resta il margine.
 * - FULL: foto 384x512 (3:4) a filo, poi didascalia e data se presenti.
 * - STRIP: titolo evento, photoCount foto 4:3 da 352x264 (1..4) separate da 12 punti, piede con
 *   didascalia, data e hashtag.
 * - RECEIPT: marchio, titolo, riga tratteggiata, foto 352x352, didascalia e hashtag, riga, numero e
 *   data, riga, piede. Le righe tratteggiate stanno solo tra sezioni non vuote.
 *
 * Testi vuoti, null o di soli spazi non occupano spazio. Titolo e didascalia possono andare a capo:
 * in quel caso producono DUE blocchi consecutivi con lo stesso ruolo. Il FOOTER ha testo vuoto
 * (la frase localizzata la mette l'app), PRINT_NUMBER è precompilato come "N. 0042".
 */
export function layoutTemplate(kind, paper, count, texts) {
  const sheet = new Sheet(paperOf(paper).dots);
  const t = textsWithDefaults(texts);
  switch (kind) {
    case 'POLAROID':
      sheet.polaroid(t);
      break;
    case 'FULL':
      sheet.full(t);
      break;
    case 'STRIP':
      sheet.strip(t, photoCount(kind, count));
      break;
    case 'RECEIPT':
      sheet.receipt(t);
      break;
    default:
      throw new RangeError(`modello sconosciuto: ${String(kind)} (ammessi: ${TemplateKind.join(', ')})`);
  }
  return sheet.build();
}

/** Foglio in costruzione: un cursore verticale che scende man mano che si posano gli elementi. */
class Sheet {
  constructor(dots) {
    this.width = dots;
    this.scale = dots / BASE_WIDTH;
    this.margin = this.sc(MARGIN);
    this.contentWidth = this.width - 2 * this.margin;
    this.textAvail = this.contentWidth - 2 * this.sc(TEXT_INSET);
    this.y = 0;
    this.photos = [];
    this.texts = [];
    this.decorations = [];
  }

  sc(v) {
    return roundToInt(v * this.scale);
  }

  polaroid(t) {
    this.space(this.margin);
    this.photo(this.margin, this.contentWidth, this.contentWidth);
    const blocks = [
      this.text('CAPTION', t.caption, 'MONO_BOLD', SIZE_CAPTION, 2),
      this.text('DATE', t.dateText, 'MONO', SIZE_DATE, 1),
    ].filter(Boolean);
    if (blocks.length === 0) {
      this.space(this.margin);
      return;
    }
    // fascia bassa da instantanea: i testi stanno centrati in una fascia di altezza minima fissa
    const content = blocks.reduce((sum, b) => sum + b.height, 0);
    const band = Math.max(this.sc(POLAROID_BAND), content + 2 * this.sc(POLAROID_BAND_PAD));
    const bandTop = this.y;
    this.space(Math.trunc((band - content) / 2));
    for (const block of blocks) this.place(block);
    this.y = bandTop + band;
  }

  full(t) {
    this.photo(0, this.width, this.sc(FULL_PHOTO_HEIGHT));
    const blocks = [
      this.text('CAPTION', t.caption, 'MONO_BOLD', SIZE_CAPTION, 2),
      this.text('DATE', t.dateText, 'MONO', SIZE_DATE, 1),
    ].filter(Boolean);
    if (blocks.length > 0) {
      this.space(this.sc(GAP));
      for (const block of blocks) this.place(block);
      this.space(this.sc(TEXT_TAIL));
    }
  }

  strip(t, count) {
    this.space(this.margin);
    const title = this.text('EVENT_TITLE', t.eventTitle, 'DISPLAY', SIZE_EVENT_TITLE, 2);
    if (title) {
      this.place(title);
      this.space(this.sc(GAP));
    }
    // 4:3 esatto anche a 576 punti
    const photoHeight = Math.trunc((this.contentWidth * 3) / 4);
    for (let i = 0; i < count; i++) {
      if (i > 0) this.space(this.sc(GAP));
      this.photo(this.margin, this.contentWidth, photoHeight);
    }
    const footer = [
      this.text('CAPTION', t.caption, 'MONO_BOLD', SIZE_CAPTION, 2),
      this.text('DATE', t.dateText, 'MONO', SIZE_DATE, 1),
      this.text('HASHTAG', hashtag(t.hashtag), 'MONO', SIZE_HASHTAG, 1),
    ].filter(Boolean);
    if (footer.length === 0) {
      this.space(this.margin);
      return;
    }
    this.space(this.sc(GAP));
    for (const block of footer) this.place(block);
    this.space(this.sc(TEXT_TAIL));
  }

  receipt(t) {
    this.space(this.margin);
    // intestazione
    this.place(this.fixedText('BRAND', BRAND_TEXT, 'DISPLAY', SIZE_BRAND, 1));
    const title = this.text('EVENT_TITLE', t.eventTitle, 'DISPLAY', SIZE_EVENT_TITLE, 2);
    if (title) this.place(title);
    this.dashed();
    // foto e note
    this.photo(this.margin, this.contentWidth, this.contentWidth);
    const notes = [
      this.text('CAPTION', t.caption, 'MONO_BOLD', SIZE_CAPTION, 2),
      this.text('HASHTAG', hashtag(t.hashtag), 'MONO', SIZE_HASHTAG, 1),
    ].filter(Boolean);
    if (notes.length > 0) {
      this.space(this.sc(GAP));
      for (const block of notes) this.place(block);
    }
    // dati della stampa: la sezione sparisce se è vuota, senza doppie righe tratteggiate
    const number = t.printNumber;
    const numberText = number !== null && number !== undefined ? printNumberText(number) : null;
    const info = [
      this.text('PRINT_NUMBER', numberText, 'MONO', SIZE_PRINT_NUMBER, 1),
      this.text('DATE', t.dateText, 'MONO', SIZE_DATE, 1),
    ].filter(Boolean);
    if (info.length > 0) {
      this.dashed();
      for (const block of info) this.place(block);
    }
    // piede: la frase la mette l'app, localizzata
    this.dashed();
    this.place(this.fixedText('FOOTER', '', 'MONO', SIZE_FOOTER, 1));
    this.space(this.sc(TEXT_TAIL));
  }

  build() {
    return {
      width: this.width,
      height: this.y,
      photos: this.photos.slice(),
      texts: this.texts.slice(),
      decorations: this.decorations.slice(),
    };
  }

  space(dots) {
    this.y += dots;
  }

  photo(left, w, h) {
    this.photos.push(new Rect(left, this.y, w, h));
    this.y += h;
  }

  /** Testo facoltativo: null se vuoto. */
  text(role, raw, font, nominal, maxLines) {
    const text = normalizeText(raw);
    if (text.length === 0) return null;
    return this.fixedText(role, text, font, nominal, maxLines);
  }

  /** Testo sempre presente, anche se vuoto (blocchi che riempie l'app). */
  fixedText(role, text, font, nominal, maxLines) {
    const size = this.sc(nominal);
    const minSize = Math.min(size, Math.max(this.sc(MIN_TEXT), roundToInt(size * MIN_SHRINK)));
    const fit = fitText(text, font, size, minSize, this.textAvail, maxLines);
    const lineHeight = lineHeightFor(fit.size);
    return { role, font, size: fit.size, lines: fit.lines, lineHeight, height: fit.lines.length * lineHeight };
  }

  place(f) {
    for (const line of f.lines) {
      this.texts.push({
        role: f.role,
        text: line,
        rect: new Rect(this.margin, this.y, this.contentWidth, f.lineHeight),
        font: f.font,
        sizeDots: f.size,
        align: 'CENTER',
      });
      this.y += f.lineHeight;
    }
  }

  /** Riga tratteggiata centrata in una fascia propria, così non tocca foto e testi vicini. */
  dashed() {
    const band = this.sc(SEPARATOR);
    const thickness = this.sc(DASH_THICKNESS);
    this.decorations.push(
      dashedLine({
        y: this.y + Math.trunc((band - thickness) / 2),
        from: this.margin,
        to: this.width - this.margin,
        dash: this.sc(DASH),
        gap: this.sc(DASH_GAP),
        thickness,
      }),
    );
    this.y += band;
  }
}

/** L'hashtag riceve il '#' iniziale se manca. */
function hashtag(raw) {
  const text = normalizeText(raw);
  return text.length === 0 || text.startsWith('#') ? text : `#${text}`;
}

/** Namespace come l'object Kotlin. */
export const TemplateGeometry = Object.freeze({
  BASE_WIDTH,
  MAX_STRIP_PHOTOS,
  BRAND_TEXT,
  layout: layoutTemplate,
  photoCount,
  printNumberText,
});
