// Retinatura: porting di Ditherer.kt. Da grigi a punti neri/bianchi: un punto è nero quando il
// valore (con l'errore accumulato, per gli algoritmi a diffusione) è minore della soglia.
// Gli errori sono FloatArray in Kotlin: qui Float32Array, e ogni operazione passa per Math.fround,
// così l'errore si accumula esattamente come in float32 e i punti escono identici.

import { BitImage } from './bitimage.js';
import { DitherAlgorithm, intArg } from './model.js';

const fround = Math.fround;

/** Matrice di Bayer 8x8 standard, valori 0..63. */
export const BAYER_8 = Object.freeze([
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]);

/**
 * Retina [src] con [algorithm] ('ATKINSON' | 'FLOYD_STEINBERG' | 'ORDERED_BAYER' | 'THRESHOLD').
 * [threshold] (1..255, default 128) sposta il punto di decisione: più alto = stampa più scura.
 * [src] non viene modificata.
 */
export function dither(src, algorithm, threshold = 128) {
  const t = Math.min(255, Math.max(1, intArg(threshold, 128)));
  switch (algorithm) {
    case 'ATKINSON':
      return atkinson(src, t);
    case 'FLOYD_STEINBERG':
      return floydSteinberg(src, t);
    case 'ORDERED_BAYER':
      return bayer(src, t);
    case 'THRESHOLD':
      return thresholdDither(src, t);
    default:
      throw new RangeError(`retino sconosciuto: ${String(algorithm)} (ammessi: ${DitherAlgorithm.join(', ')})`);
  }
}

function thresholdDither(src, t) {
  const w = src.width;
  const h = src.height;
  const out = new BitImage(w, h);
  const px = src.pixels;
  const data = out.data;
  const bpr = out.bytesPerRow;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const outRow = y * bpr;
    for (let x = 0; x < w; x++) {
      if (px[row + x] < t) data[outRow + (x >>> 3)] |= 0x80 >>> (x & 7);
    }
  }
  return out;
}

/**
 * Bayer 8x8: soglia della cella = (M + 0.5) / 64 * 255, spostata di (t - 128), in float32.
 * Con t = 128 un grigio 128 accende esattamente metà delle celle.
 */
function bayer(src, t) {
  const cells = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    cells[i] = fround(fround(fround(fround(BAYER_8[i] + 0.5) * 255) / 64) + (t - 128));
  }
  const w = src.width;
  const h = src.height;
  const out = new BitImage(w, h);
  const px = src.pixels;
  const data = out.data;
  const bpr = out.bytesPerRow;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const outRow = y * bpr;
    const cellRow = (y & 7) << 3;
    for (let x = 0; x < w; x++) {
      if (px[row + x] < cells[cellRow + (x & 7)]) data[outRow + (x >>> 3)] |= 0x80 >>> (x & 7);
    }
  }
  return out;
}

/**
 * Atkinson: 1/8 dell'errore a 6 vicini (destra, destra+2, sotto-sinistra, sotto, sotto-destra,
 * due righe sotto). Diffonde solo 3/4 dell'errore: luci e ombre restano pulite.
 */
function atkinson(src, t) {
  const w = src.width;
  const h = src.height;
  const out = new BitImage(w, h);
  const px = src.pixels;
  const data = out.data;
  const bpr = out.bytesPerRow;
  // indice nel buffer = x + 1: un bordo a sinistra, due a destra
  let r0 = new Float32Array(w + 3);
  let r1 = new Float32Array(w + 3);
  let r2 = new Float32Array(w + 3);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const outRow = y * bpr;
    for (let x = 0; x < w; x++) {
      const old = fround(px[row + x] + r0[x + 1]);
      const black = old < t;
      if (black) data[outRow + (x >>> 3)] |= 0x80 >>> (x & 7);
      const e = fround(fround(old - (black ? 0 : 255)) / 8);
      // somma in double di due float32 e poi arrotondata dal Float32Array: è la somma float32
      r0[x + 2] += e;
      r0[x + 3] += e;
      r1[x] += e;
      r1[x + 1] += e;
      r1[x + 2] += e;
      r2[x + 1] += e;
    }
    // le righe scorrono: quella appena finita torna in fondo, azzerata
    const done = r0;
    r0 = r1;
    r1 = r2;
    r2 = done;
    r2.fill(0);
  }
  return out;
}

/**
 * Floyd-Steinberg a serpentina: 7/16 avanti, 3/16 sotto-dietro, 5/16 sotto, 1/16 sotto-avanti.
 * Le righe dispari vanno da destra a sinistra: spariscono le "venature" diagonali.
 */
function floydSteinberg(src, t) {
  const w = src.width;
  const h = src.height;
  const out = new BitImage(w, h);
  const px = src.pixels;
  const data = out.data;
  const bpr = out.bytesPerRow;
  // pesi esatti in float32 (7f / 16f ecc.)
  const k7 = 7 / 16;
  const k3 = 3 / 16;
  const k5 = 5 / 16;
  const k1 = 1 / 16;
  // indice nel buffer = x + 1: un bordo per lato
  let cur = new Float32Array(w + 2);
  let next = new Float32Array(w + 2);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const outRow = y * bpr;
    if ((y & 1) === 0) {
      for (let x = 0; x < w; x++) {
        const old = fround(px[row + x] + cur[x + 1]);
        const black = old < t;
        if (black) data[outRow + (x >>> 3)] |= 0x80 >>> (x & 7);
        const e = fround(old - (black ? 0 : 255));
        cur[x + 2] += fround(e * k7);
        next[x] += fround(e * k3);
        next[x + 1] += fround(e * k5);
        next[x + 2] += fround(e * k1);
      }
    } else {
      for (let x = w - 1; x >= 0; x--) {
        const old = fround(px[row + x] + cur[x + 1]);
        const black = old < t;
        if (black) data[outRow + (x >>> 3)] |= 0x80 >>> (x & 7);
        const e = fround(old - (black ? 0 : 255));
        cur[x] += fround(e * k7);
        next[x + 2] += fround(e * k3);
        next[x + 1] += fround(e * k5);
        next[x] += fround(e * k1);
      }
    }
    const done = cur;
    cur = next;
    next = done;
    next.fill(0);
  }
  return out;
}

/** Namespace come l'object Kotlin. */
export const Ditherer = Object.freeze({ dither });
