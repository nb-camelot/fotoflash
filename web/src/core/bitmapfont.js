// Font bitmap 5x7 per le pagine di prova raster: le Phomemo non hanno font ESC/POS affidabili,
// quindi testi e numeri della pagina di prova si disegnano punto per punto nella BitImage.
// Solo ASCII 32..126 (il resto diventa '?'), deterministico e senza DOM: gira anche in Node.
// Non entra nelle stampe vere (lì i testi li disegna il renderer con i TTF del brand) né nei
// vettori condivisi con Kotlin: serve solo alla calibrazione.

import { BitImage, blit, fillRect } from './bitimage.js';
import { GrayImage } from './gray.js';
import { dither } from './dither.js';
import { DitherAlgorithm } from './model.js';

/** Larghezza e altezza di un carattere, in punti a scala 1. */
export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Passo orizzontale (carattere + 1 punto di spazio) e interlinea (7 + 2), a scala 1. */
export const GLYPH_ADVANCE = 6;
export const LINE_HEIGHT = 9;

/** Primo e ultimo carattere disegnabile. */
export const FIRST_CHAR = 32;
export const LAST_CHAR = 126;

// Tabella classica 5x7 (quella dei display HD44780 e delle librerie per LCD): 5 colonne per
// carattere, da sinistra a destra; in ogni colonna il bit 0 è la riga in alto.
// prettier-ignore
const FONT_DATA = [
  0x00, 0x00, 0x00, 0x00, 0x00, // ' '
  0x00, 0x00, 0x5f, 0x00, 0x00, // !
  0x00, 0x07, 0x00, 0x07, 0x00, // "
  0x14, 0x7f, 0x14, 0x7f, 0x14, // #
  0x24, 0x2a, 0x7f, 0x2a, 0x12, // $
  0x23, 0x13, 0x08, 0x64, 0x62, // %
  0x36, 0x49, 0x55, 0x22, 0x50, // &
  0x00, 0x05, 0x03, 0x00, 0x00, // '
  0x00, 0x1c, 0x22, 0x41, 0x00, // (
  0x00, 0x41, 0x22, 0x1c, 0x00, // )
  0x14, 0x08, 0x3e, 0x08, 0x14, // *
  0x08, 0x08, 0x3e, 0x08, 0x08, // +
  0x00, 0x50, 0x30, 0x00, 0x00, // ,
  0x08, 0x08, 0x08, 0x08, 0x08, // -
  0x00, 0x60, 0x60, 0x00, 0x00, // .
  0x20, 0x10, 0x08, 0x04, 0x02, // /
  0x3e, 0x51, 0x49, 0x45, 0x3e, // 0
  0x00, 0x42, 0x7f, 0x40, 0x00, // 1
  0x42, 0x61, 0x51, 0x49, 0x46, // 2
  0x21, 0x41, 0x45, 0x4b, 0x31, // 3
  0x18, 0x14, 0x12, 0x7f, 0x10, // 4
  0x27, 0x45, 0x45, 0x45, 0x39, // 5
  0x3c, 0x4a, 0x49, 0x49, 0x30, // 6
  0x01, 0x71, 0x09, 0x05, 0x03, // 7
  0x36, 0x49, 0x49, 0x49, 0x36, // 8
  0x06, 0x49, 0x49, 0x29, 0x1e, // 9
  0x00, 0x36, 0x36, 0x00, 0x00, // :
  0x00, 0x56, 0x36, 0x00, 0x00, // ;
  0x08, 0x14, 0x22, 0x41, 0x00, // <
  0x14, 0x14, 0x14, 0x14, 0x14, // =
  0x00, 0x41, 0x22, 0x14, 0x08, // >
  0x02, 0x01, 0x51, 0x09, 0x06, // ?
  0x32, 0x49, 0x79, 0x41, 0x3e, // @
  0x7e, 0x11, 0x11, 0x11, 0x7e, // A
  0x7f, 0x49, 0x49, 0x49, 0x36, // B
  0x3e, 0x41, 0x41, 0x41, 0x22, // C
  0x7f, 0x41, 0x41, 0x22, 0x1c, // D
  0x7f, 0x49, 0x49, 0x49, 0x41, // E
  0x7f, 0x09, 0x09, 0x09, 0x01, // F
  0x3e, 0x41, 0x49, 0x49, 0x7a, // G
  0x7f, 0x08, 0x08, 0x08, 0x7f, // H
  0x00, 0x41, 0x7f, 0x41, 0x00, // I
  0x20, 0x40, 0x41, 0x3f, 0x01, // J
  0x7f, 0x08, 0x14, 0x22, 0x41, // K
  0x7f, 0x40, 0x40, 0x40, 0x40, // L
  0x7f, 0x02, 0x0c, 0x02, 0x7f, // M
  0x7f, 0x04, 0x08, 0x10, 0x7f, // N
  0x3e, 0x41, 0x41, 0x41, 0x3e, // O
  0x7f, 0x09, 0x09, 0x09, 0x06, // P
  0x3e, 0x41, 0x51, 0x21, 0x5e, // Q
  0x7f, 0x09, 0x19, 0x29, 0x46, // R
  0x46, 0x49, 0x49, 0x49, 0x31, // S
  0x01, 0x01, 0x7f, 0x01, 0x01, // T
  0x3f, 0x40, 0x40, 0x40, 0x3f, // U
  0x1f, 0x20, 0x40, 0x20, 0x1f, // V
  0x3f, 0x40, 0x38, 0x40, 0x3f, // W
  0x63, 0x14, 0x08, 0x14, 0x63, // X
  0x07, 0x08, 0x70, 0x08, 0x07, // Y
  0x61, 0x51, 0x49, 0x45, 0x43, // Z
  0x00, 0x7f, 0x41, 0x41, 0x00, // [
  0x02, 0x04, 0x08, 0x10, 0x20, // \
  0x00, 0x41, 0x41, 0x7f, 0x00, // ]
  0x04, 0x02, 0x01, 0x02, 0x04, // ^
  0x40, 0x40, 0x40, 0x40, 0x40, // _
  0x00, 0x01, 0x02, 0x04, 0x00, // `
  0x20, 0x54, 0x54, 0x54, 0x78, // a
  0x7f, 0x48, 0x44, 0x44, 0x38, // b
  0x38, 0x44, 0x44, 0x44, 0x20, // c
  0x38, 0x44, 0x44, 0x48, 0x7f, // d
  0x38, 0x54, 0x54, 0x54, 0x18, // e
  0x08, 0x7e, 0x09, 0x01, 0x02, // f
  0x0c, 0x52, 0x52, 0x52, 0x3e, // g
  0x7f, 0x08, 0x04, 0x04, 0x78, // h
  0x00, 0x44, 0x7d, 0x40, 0x00, // i
  0x20, 0x40, 0x44, 0x3d, 0x00, // j
  0x7f, 0x10, 0x28, 0x44, 0x00, // k
  0x00, 0x41, 0x7f, 0x40, 0x00, // l
  0x7c, 0x04, 0x18, 0x04, 0x78, // m
  0x7c, 0x08, 0x04, 0x04, 0x78, // n
  0x38, 0x44, 0x44, 0x44, 0x38, // o
  0x7c, 0x14, 0x14, 0x14, 0x08, // p
  0x08, 0x14, 0x14, 0x18, 0x7c, // q
  0x7c, 0x08, 0x04, 0x04, 0x08, // r
  0x48, 0x54, 0x54, 0x54, 0x20, // s
  0x04, 0x3f, 0x44, 0x40, 0x20, // t
  0x3c, 0x40, 0x40, 0x20, 0x7c, // u
  0x1c, 0x20, 0x40, 0x20, 0x1c, // v
  0x3c, 0x40, 0x30, 0x40, 0x3c, // w
  0x44, 0x28, 0x10, 0x28, 0x44, // x
  0x0c, 0x50, 0x50, 0x50, 0x3c, // y
  0x44, 0x64, 0x54, 0x4c, 0x44, // z
  0x00, 0x08, 0x36, 0x41, 0x00, // {
  0x00, 0x00, 0x7f, 0x00, 0x00, // |
  0x00, 0x41, 0x36, 0x08, 0x00, // }
  0x08, 0x04, 0x08, 0x10, 0x08, // ~
];

/** Colonne dei glifi, 5 byte per carattere da FIRST_CHAR a LAST_CHAR (da non modificare). */
export const FONT_5X7 = Uint8Array.from(FONT_DATA);

const QUESTION = 0x3f;

function codeOf(ch) {
  const c = typeof ch === 'number' ? ch : String(ch).charCodeAt(0);
  return c >= FIRST_CHAR && c <= LAST_CHAR ? c : QUESTION;
}

/** Le 5 colonne del carattere [ch] (stringa di un carattere o codice); fuori ASCII stampabile è '?'. */
export function glyph(ch) {
  const i = (codeOf(ch) - FIRST_CHAR) * GLYPH_WIDTH;
  return FONT_5X7.subarray(i, i + GLYPH_WIDTH);
}

/** Il punto (col, row) del glifo è nero? col 0..4, row 0..6. */
export function glyphPixel(ch, col, row) {
  if (col < 0 || col >= GLYPH_WIDTH || row < 0 || row >= GLYPH_HEIGHT) return false;
  return (glyph(ch)[col] & (1 << row)) !== 0;
}

function intScale(scale) {
  const s = Math.trunc(Number(scale));
  return Number.isFinite(s) && s >= 1 ? Math.min(s, 64) : 1;
}

/** Larghezza in punti di [text] a [scale] (senza lo spazio dopo l'ultimo carattere). */
export function textWidth(text, scale = 1) {
  const s = intScale(scale);
  const n = String(text).length;
  return n === 0 ? 0 : (n * GLYPH_ADVANCE - 1) * s;
}

/** Caratteri che stanno in [width] punti a [scale]. */
export function columnsFor(width, scale = 1) {
  return Math.max(1, Math.floor((width + intScale(scale)) / (GLYPH_ADVANCE * intScale(scale))));
}

/**
 * Disegna [text] in [img] con l'angolo in alto a sinistra in (x, y); ogni punto del font diventa
 * un quadrato di [scale] x [scale]. Ciò che esce dall'immagine viene tagliato. → larghezza disegnata
 */
export function drawText(img, text, x, y, scale = 1) {
  const s = intScale(scale);
  const str = String(text);
  let left = Math.trunc(x);
  const top = Math.trunc(y);
  for (let i = 0; i < str.length; i++) {
    const cols = glyph(str.charCodeAt(i));
    for (let col = 0; col < GLYPH_WIDTH; col++) {
      const bits = cols[col];
      if (bits === 0) continue;
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        if ((bits & (1 << row)) !== 0) fillRect(img, { left: left + col * s, top: top + row * s, width: s, height: s }, true);
      }
    }
    left += GLYPH_ADVANCE * s;
  }
  return textWidth(str, s);
}

/** [text] su una BitImage tutta sua, alta una riga di testo (7 punti a scala 1, senza interlinea). */
export function textImage(text, scale = 1) {
  const s = intScale(scale);
  const img = new BitImage(Math.max(1, textWidth(text, s)), GLYPH_HEIGHT * s);
  drawText(img, text, 0, 0, s);
  return img;
}

/**
 * A capo per parole entro [columns] caratteri; le parole più lunghe di una riga si spezzano.
 * Riduce prima il testo ad ASCII stampabile: il font non ha altro.
 */
export function wrapText(text, columns) {
  const cols = Math.max(1, Math.trunc(columns));
  const lines = [];
  const clean = Array.from(String(text == null ? '' : text), (c) => {
    if (c === '\n') return c;
    const code = c.charCodeAt(0);
    return c.length === 1 && code >= FIRST_CHAR && code <= LAST_CHAR ? c : '?';
  }).join('');
  for (const paragraph of clean.split('\n')) {
    let current = '';
    for (const raw of paragraph.split(' ')) {
      if (raw === '') continue;
      let word = raw;
      while (word.length > cols) {
        if (current !== '') {
          lines.push(current);
          current = '';
        }
        lines.push(word.slice(0, cols));
        word = word.slice(cols);
      }
      if (word === '') continue;
      if (current === '') current = word;
      else if (current.length + 1 + word.length <= cols) current += ' ' + word;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current !== '' || paragraph.trim() === '') lines.push(current);
  }
  return lines;
}

// ---------------------------------------------------------------- pagina di prova raster

/** Millimetri → righe di punti alla risoluzione [dpi]. */
function mmToDots(mm, dpi) {
  return Math.max(1, Math.round((mm * dpi) / 25.4));
}

/** Scala del testo: a 300 dpi i caratteri a scala 2 sarebbero alti poco più di un millimetro. */
export function textScaleFor(dpi) {
  return dpi >= 250 ? 3 : 2;
}

/** Riquadro a tutta larghezza con tacche ogni 6 mm, più lunghe ogni 24 mm: se un bordo manca, la larghezza è sbagliata. */
export function widthFrameImage(width, dpi = 203) {
  const rows = mmToDots(4, dpi);
  const border = Math.max(2, Math.round(dpi / 70));
  const img = new BitImage(width, rows);
  fillRect(img, { left: 0, top: 0, width, height: border }, true);
  fillRect(img, { left: 0, top: rows - border, width, height: border }, true);
  fillRect(img, { left: 0, top: 0, width: border, height: rows }, true);
  fillRect(img, { left: width - border, top: 0, width: border, height: rows }, true);
  const step = (6 * dpi) / 25.4;
  for (let k = 1; ; k++) {
    const x = Math.round(k * step);
    if (x >= width - border) break;
    const length = k % 4 === 0 ? Math.round(rows / 2) : Math.round(rows / 4);
    fillRect(img, { left: x, top: border, width: 2, height: length }, true);
  }
  return img;
}

/** Scala di grigi in [steps] riquadri dal nero al bianco, retinata con [algorithm], con una cornice sottile. */
export function grayScaleImage(width, rows, algorithm, steps = 8) {
  const n = Math.max(2, Math.trunc(steps));
  const gray = new GrayImage(width, rows);
  for (let x = 0; x < width; x++) {
    const i = Math.min(n - 1, Math.floor((x * n) / width));
    const v = Math.round((i * 255) / (n - 1));
    for (let y = 0; y < rows; y++) gray.set(x, y, v);
  }
  const img = dither(gray, algorithm);
  fillRect(img, { left: 0, top: 0, width, height: 1 }, true);
  fillRect(img, { left: 0, top: rows - 1, width, height: 1 }, true);
  fillRect(img, { left: 0, top: 0, width: 1, height: rows }, true);
  fillRect(img, { left: width - 1, top: 0, width: 1, height: rows }, true);
  return img;
}

/**
 * Controllo dei neri: una barra nera piena (densità, energia della testina), poi linee verticali
 * (a sinistra) e orizzontali (a destra) da un punto (risoluzione, punti bruciati), come blackCheck
 * della pagina di prova Kotlin.
 */
export function blackCheckImage(width, rows, margin = 0, gap = 4) {
  const inner = Math.max(2, width - 2 * margin);
  const img = new BitImage(width, rows * 2 + gap);
  fillRect(img, { left: margin, top: 0, width: inner, height: rows }, true);
  const top = rows + gap;
  const half = Math.trunc(inner / 2);
  for (let y = top; y < top + rows; y++) {
    for (let x = margin; x < margin + inner; x++) {
      const black = x < margin + half ? (x - margin) % 2 === 0 : (y - top) % 2 === 0;
      if (black) img.set(x, y, true);
    }
  }
  return img;
}

/**
 * Pagina di prova raster, larga [spec.width] punti a [spec.dpi], dall'alto:
 * titolo grande, sottotitolo, righe tecniche (parametri correnti), righe di informazioni,
 * controllo della larghezza (testo e riquadro), una sfumatura retinata per ciascun retino (con la
 * sua etichetta), una scala di grigi con il retino corrente, il controllo dei neri, il piede.
 * spec: { width, dpi, title, subtitle, technical: string[], lines: string[], widthCheck,
 *         ditherTitle, ditherLabels: { ALG: string }, currentDither, footer: string[] }.
 * Tutti i testi sono già tradotti (e ridotti ad ASCII) dal chiamante; quelli assenti si saltano,
 * le etichette dei retini assenti diventano il nome dell'algoritmo. Deterministica. → BitImage
 */
export function testPageImage(spec = {}) {
  const width = Math.max(8, Math.trunc(spec.width || 384));
  const dpi = spec.dpi > 0 ? spec.dpi : 203;
  const scale = textScaleFor(dpi);
  const margin = 2 * scale;
  const cols = columnsFor(width - 2 * margin, scale);
  const gap = mmToDots(2, dpi);
  const bandRows = mmToDots(5, dpi);
  const current = DitherAlgorithm.includes(spec.currentDither) ? spec.currentDither : 'FLOYD_STEINBERG';
  const labels = spec.ditherLabels || {};
  const list = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x !== '') : []);
  const blocks = [];

  const textBlock = (lines, centered = false) => {
    const wrapped = [];
    for (const line of lines) wrapped.push(...wrapText(line, cols));
    if (wrapped.length === 0) return;
    const img = new BitImage(width, wrapped.length * LINE_HEIGHT * scale);
    wrapped.forEach((line, i) => {
      const left = centered ? Math.trunc((width - textWidth(line, scale)) / 2) : margin;
      drawText(img, line, left, i * LINE_HEIGHT * scale + scale, scale);
    });
    blocks.push(img);
  };
  // Filetto tra i margini, spesso quanto un punto del testo.
  const rule = () => {
    const img = new BitImage(width, scale);
    fillRect(img, { left: margin, top: 0, width: width - 2 * margin, height: scale }, true);
    blocks.push(img);
  };

  // Titolo: il più grande che entra, centrato.
  const title = String(spec.title || '');
  if (title !== '') {
    const big = Math.max(scale, Math.floor((width - 2 * margin) / (title.length * GLYPH_ADVANCE)));
    const img = new BitImage(width, GLYPH_HEIGHT * big + 2 * scale);
    drawText(img, title, Math.trunc((width - textWidth(title, big)) / 2), scale, big);
    blocks.push(img);
  }
  textBlock(list([spec.subtitle]), true);
  rule();
  textBlock(list(spec.technical));
  textBlock(list(spec.lines));
  rule();

  // Controllo larghezza: il riquadro occupa tutto il raster; se un bordo manca, la larghezza è sbagliata.
  textBlock(list([spec.widthCheck]));
  blocks.push(widthFrameImage(width, dpi));

  textBlock(list([spec.ditherTitle]));
  for (const algorithm of DitherAlgorithm) {
    textBlock([labels[algorithm] || algorithm]);
    blocks.push(dither(GrayImage.gradient(width, bandRows), algorithm));
  }
  textBlock([labels[current] || current]);
  blocks.push(grayScaleImage(width, bandRows, current));
  blocks.push(blackCheckImage(width, mmToDots(3, dpi), margin, gap));
  rule();
  textBlock(list(spec.footer), true);

  const height = blocks.reduce((sum, b) => sum + b.height + gap, gap);
  const page = new BitImage(width, height);
  let top = gap;
  for (const b of blocks) {
    blit(page, b, 0, top);
    top += b.height + gap;
  }
  return page;
}
