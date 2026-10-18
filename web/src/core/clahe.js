// Contrasto locale adattivo (CLAHE): porting di Clahe.kt.
// Equalizza ogni zona con il suo istogramma tagliato, poi interpola tra le tessere: il viso in
// ombra si apre e il cielo resta com'è. Stessi passi, stesso ordine e stessa aritmetica di Kotlin.

import { GrayImage } from './gray.js';
import { intArg, roundToInt } from './model.js';

/** Lato minimo di una tessera: 16x16 = 256 pixel, un conteggio medio per livello. */
export const MIN_TILE_SIDE = 16;

/** Limite di taglio usato se il chiamante passa NaN. */
export const DEFAULT_CLIP_LIMIT = 2.5;

const LEVELS = 256;

/**
 * Applica CLAHE a [src] e restituisce una nuova immagine; [src] non viene modificata.
 * [strength] 0..1 (Float in Kotlin): miscela con l'originale, 0 restituisce una copia identica.
 * [tiles] tessere sul lato corto (almeno 1, meno se le tessere scenderebbero sotto i 16 px).
 * [clipLimit] pendenza massima della curva locale (almeno 1).
 */
export function claheApply(src, strength, tiles = 8, clipLimit = DEFAULT_CLIP_LIMIT) {
  // i parametri sono Float in Kotlin: si passa per float32 prima di allargarli a double
  const f = Math.fround(strength);
  const s = Number.isNaN(f) ? 0 : f < 0 ? 0 : f > 1 ? 1 : f;
  if (s <= 0) return src.copy();
  // null/undefined valgono come i default, come negli altri moduli del core
  const c = Math.fround(clipLimit ?? DEFAULT_CLIP_LIMIT);
  const clip = Number.isNaN(c) ? DEFAULT_CLIP_LIMIT : c < 1 ? 1 : c;
  const t = intArg(tiles, 8);

  const w = src.width;
  const h = src.height;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  const nShort = clampInt(t, 1, Math.max(1, Math.trunc(shortSide / MIN_TILE_SIDE)));
  const side = shortSide / nShort;
  const nLong = clampInt(roundToInt(longSide / side), 1, Math.max(1, Math.trunc(longSide / MIN_TILE_SIDE)));
  const nx = w <= h ? nShort : nLong;
  const ny = w <= h ? nLong : nShort;

  const xStarts = starts(w, nx);
  const yStarts = starts(h, ny);
  const tileX = tileOf(w, xStarts);
  const tileY = tileOf(h, yStarts);

  // 1) istogrammi: 256 contatori per tessera, in un unico array
  const px = src.pixels;
  const hist = new Int32Array(nx * ny * LEVELS);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const tileRow = tileY[y] * nx;
    for (let x = 0; x < w; x++) {
      hist[((tileRow + tileX[x]) << 8) + px[row + x]]++;
    }
  }

  // 2-3) taglio, ridistribuzione e LUT per tessera
  const luts = new Float64Array(nx * ny * LEVELS);
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const area = (xStarts[tx + 1] - xStarts[tx]) * (yStarts[ty + 1] - yStarts[ty]);
      buildLut(hist, luts, (ty * nx + tx) << 8, area, clip);
    }
  }

  // 4) indici e pesi dell'interpolazione, per colonna e per riga
  const x0 = new Int32Array(w);
  const x1 = new Int32Array(w);
  const wx = new Float64Array(w);
  interpolation(xStarts, nx, x0, x1, wx);
  const y0 = new Int32Array(h);
  const y1 = new Int32Array(h);
  const wy = new Float64Array(h);
  interpolation(yStarts, ny, y0, y1, wy);

  // 5) interpolazione bilineare e miscela con l'originale
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const top = y0[y] * nx;
    const bottom = y1[y] * nx;
    const fy = wy[y];
    for (let x = 0; x < w; x++) {
      const v = px[row + x];
      const a = luts[((top + x0[x]) << 8) + v];
      const b = luts[((top + x1[x]) << 8) + v];
      const cc = luts[((bottom + x0[x]) << 8) + v];
      const d = luts[((bottom + x1[x]) << 8) + v];
      const fx = wx[x];
      const upper = a + fx * (b - a);
      const lower = cc + fx * (d - cc);
      const equalized = upper + fy * (lower - upper);
      const mixed = v + s * (equalized - v);
      // (mixed + 0.5).toInt(): troncamento verso lo zero, poi 0..255
      const r = Math.trunc(mixed + 0.5);
      out[row + x] = r < 0 ? 0 : r > 255 ? 255 : r;
    }
  }
  return new GrayImage(w, h, out);
}

function clampInt(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Inizio di ogni tessera lungo un asse di [length] pixel diviso in [count] parti, più la fine. */
function starts(length, count) {
  const out = new Int32Array(count + 1);
  for (let i = 0; i <= count; i++) out[i] = Math.floor((i * length) / count);
  return out;
}

/** Tessera di appartenenza di ogni pixel lungo l'asse. */
function tileOf(length, st) {
  const out = new Int32Array(length);
  for (let t = 0; t < st.length - 1; t++) {
    for (let i = st[t]; i < st[t + 1]; i++) out[i] = t;
  }
  return out;
}

/**
 * Per ogni pixel lungo l'asse: le due tessere i cui centri lo circondano e il peso della seconda.
 * Prima del primo centro e dopo l'ultimo vale una sola tessera.
 */
function interpolation(st, count, i0, i1, weight) {
  const centers = new Float64Array(count);
  for (let i = 0; i < count; i++) centers[i] = (st[i] + st[i + 1]) / 2.0;
  let k = 0;
  for (let i = 0; i < i0.length; i++) {
    const p = i + 0.5;
    while (k + 1 < count && centers[k + 1] <= p) k++;
    if (k === count - 1 || p <= centers[k]) {
      i0[i] = k;
      i1[i] = k;
      weight[i] = 0.0;
    } else {
      i0[i] = k;
      i1[i] = k + 1;
      weight[i] = (p - centers[k]) / (centers[k + 1] - centers[k]);
    }
  }
}

/** LUT di una tessera: istogramma tagliato, eccesso ridistribuito, CDF a metà gradino. */
function buildLut(hist, luts, base, area, clipLimit) {
  const clip = (clipLimit * area) / LEVELS;
  let excess = 0.0;
  for (let v = 0; v < LEVELS; v++) {
    const count = hist[base + v];
    if (count > clip) excess += count - clip;
  }
  const spread = excess / LEVELS;
  const scale = LEVELS / area;
  let cumulative = 0.0;
  for (let v = 0; v < LEVELS; v++) {
    const count = Math.min(hist[base + v], clip) + spread;
    const mapped = (cumulative + count / 2.0) * scale - 0.5;
    luts[base + v] = mapped < 0.0 ? 0.0 : mapped > 255.0 ? 255.0 : mapped;
    cumulative += count;
  }
}

/** Namespace come l'object Kotlin. */
export const Clahe = Object.freeze({ apply: claheApply, MIN_TILE_SIDE, DEFAULT_CLIP_LIMIT });
