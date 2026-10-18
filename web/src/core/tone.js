// Regolazioni tonali prima della retinatura: porting di Tone.kt.
// Ordine: 1) controluce, 2) contrasto locale (CLAHE), 3-4) ombre, auto-livelli, luminosità,
// contrasto e gamma in una sola LUT, 5) nitidezza. I campi di ToneAdjustments sono Float in Kotlin:
// passano per Math.fround prima di allargarsi a double, altrimenti 0.15 e 0.35 non sono gli stessi.

import { GrayImage } from './gray.js';
import { claheApply } from './clahe.js';
import { backlightScore } from './backlight.js';
import { roundToInt, toneWithDefaults } from './model.js';

const fround = Math.fround;

/** Escursione minima per lo stiramento: oltre x4 di guadagno si amplifica solo rumore. */
export const MIN_LEVELS_RANGE = 64.0;
/** Luminosità +-1 = +-100 livelli. */
export const BRIGHTNESS_LEVELS = 100.0;
/** Nitidezza 1 = maschera di contrasto con quantità 1.5 (Float). */
export const SHARPEN_GAIN = 1.5;
/** Ombre aggiunte da un controluce pieno (0.55f). */
export const BACKLIGHT_SHADOWS_BOOST = fround(0.55);
/** Contrasto locale aggiunto da un controluce pieno (0.5f). */
export const BACKLIGHT_LOCAL_BOOST = 0.5;
/** Ombre = 1 solleva il punto più schiarito (64) di 0.30 * 255 ~ 76 livelli. */
export const SHADOWS_MAX_LIFT = 0.3;
/** Guadagno della curva delle ombre: t (1 - t)^3 vale al massimo 27/256, in t = 1/4. */
export const SHADOWS_GAIN = (SHADOWS_MAX_LIFT * 256.0) / 27.0;

/** coerceIn lascia passare NaN, che poi farebbe esplodere roundToInt: qui diventa il neutro. */
function sanitize(v, min, max, neutral) {
  const f = fround(v);
  if (Number.isNaN(f)) return neutral;
  const lo = fround(min);
  const hi = fround(max);
  return f < lo ? lo : f > hi ? hi : f;
}

function clamp(v) {
  return v < 0.0 ? 0.0 : v > 255.0 ? 255.0 : v;
}

/**
 * Applica [adj] a [src] e restituisce una nuova GrayImage; [src] non viene modificata.
 * I campi assenti di [adj] valgono come in defaultTone(); quelli fuori range (o NaN) vengono
 * riportati nel range o ai neutri.
 */
export function applyTone(src, adj) {
  const a = toneWithDefaults(adj);
  // 1) controluce: si misura sull'originale, prima che le regolazioni cambino la scena
  const backlight = a.autoBacklight ? backlightScore(src) : 0;
  const shadowsBase = sanitize(a.shadows, 0, 1, 0);
  const localBase = sanitize(a.localContrast, 0, 1, 0);
  const shadows = Math.min(
    Math.max(shadowsBase, fround(shadowsBase + fround(BACKLIGHT_SHADOWS_BOOST * backlight))),
    1,
  );
  const local = Math.min(Math.max(localBase, fround(localBase + fround(BACKLIGHT_LOCAL_BOOST * backlight))), 1);

  // 2) contrasto locale
  const base = local > 0 ? claheApply(src, local) : src;

  // 3-4) ombre, livelli, luminosità, contrasto e gamma in una LUT
  const lut = toneCurve(base, a, shadows);
  const px = base.pixels;
  const n = px.length;
  const mapped = new Uint8Array(n);
  for (let i = 0; i < n; i++) mapped[i] = lut[px[i]];

  // 5) nitidezza
  const amount = fround(sanitize(a.sharpen, 0, 1, 0) * SHARPEN_GAIN);
  if (amount <= 0) return new GrayImage(src.width, src.height, mapped);
  return new GrayImage(src.width, src.height, unsharp(mapped, src.width, src.height, amount));
}

/**
 * Curva delle ombre su livelli 0..255 (non arrotondata): t' = t + amount * G * t * (1 - t)^3.
 * Nero e bianco fermi, massimo a un quarto della scala, monotona per amount in 0..1.
 * Con [amount] <= 0 restituisce [v] esatto.
 */
export function shadowLift(v, amount) {
  const f = fround(amount);
  if (f <= 0) return v;
  const t = v / 255.0;
  const u = 1.0 - t;
  // stesso ordine delle moltiplicazioni di Kotlin, da sinistra a destra
  return 255.0 * (t + f * SHADOWS_GAIN * t * u * u * u);
}

/**
 * Curva tonale (ombre, auto-livelli, luminosità, contrasto, gamma) come LUT di 256 valori 0..255.
 * Dipende dall'immagine solo per gli auto-livelli, calcolati sull'istogramma dopo le ombre.
 */
export function toneCurve(src, adj, shadows = 0) {
  const a = toneWithDefaults(adj);
  const brightness = sanitize(a.brightness, -1, 1, 0);
  const contrast = sanitize(a.contrast, -1, 1, 0);
  const gamma = sanitize(a.gamma, 0.4, 2.5, 1);
  // contrasto: -1 dimezza l'escursione, +1 la moltiplica per 2.5, 0 la lascia com'è
  const factor = contrast >= 0.0 ? 1.0 + 1.5 * contrast : 1.0 + 0.5 * contrast;
  const invGamma = 1.0 / gamma;
  const sf = fround(shadows);
  const lift = Number.isNaN(sf) ? 0 : sf < 0 ? 0 : sf > 1 ? 1 : sf;
  const lifted = new Float64Array(256);
  for (let v = 0; v < 256; v++) lifted[v] = shadowLift(v, lift);

  let lo = 0.0;
  let hi = 255.0;
  if (a.autoLevels) {
    const hist = src.histogram();
    // istogramma dell'immagine come sarebbe dopo le ombre: i livelli si misurano lì
    let histLifted = hist;
    if (lift > 0) {
      histLifted = new Int32Array(256);
      for (let v = 0; v < 256; v++) {
        const r = roundToInt(lifted[v]);
        histLifted[r < 0 ? 0 : r > 255 ? 255 : r] += hist[v];
      }
    }
    const range = levels(histLifted, src.pixels.length);
    lo = range[0];
    hi = range[1];
  }
  const span = hi - lo;

  const lut = new Int32Array(256);
  for (let v = 0; v < 256; v++) {
    let x = lifted[v];
    if (a.autoLevels) x = clamp(((x - lo) * 255.0) / span);
    x = clamp(x + brightness * BRIGHTNESS_LEVELS);
    x = clamp((x - 128.0) * factor + 128.0);
    x = clamp(255.0 * Math.pow(x / 255.0, invGamma));
    lut[v] = roundToInt(x);
  }
  return lut;
}

/**
 * Livelli di nero e di bianco: percentili 1% e 99% dell'istogramma. Se l'escursione è troppo
 * stretta la si allarga attorno al centro fino a MIN_LEVELS_RANGE. Restituisce sempre hi > lo.
 */
export function levels(hist, total) {
  const cut = Math.max(1, Math.trunc(total / 100));
  let lo = 0;
  let acc = 0;
  while (lo < 255) {
    acc += hist[lo];
    if (acc >= cut) break;
    lo++;
  }
  let hi = 255;
  acc = 0;
  while (hi > 0) {
    acc += hist[hi];
    if (acc >= cut) break;
    hi--;
  }
  let l = Math.min(lo, hi);
  let h = Math.max(lo, hi);
  if (h - l < MIN_LEVELS_RANGE) {
    const mid = (l + h) / 2.0;
    l = mid - MIN_LEVELS_RANGE / 2.0;
    h = mid + MIN_LEVELS_RANGE / 2.0;
    if (l < 0.0) {
      l = 0.0;
      h = MIN_LEVELS_RANGE;
    }
    if (h > 255.0) {
      h = 255.0;
      l = 255.0 - MIN_LEVELS_RANGE;
    }
  }
  return [l, h];
}

/**
 * Maschera di contrasto: v + amount * (v - sfocato), con sfocatura binomiale 3x3
 * (1 2 1 / 2 4 2 / 1 2 1, /16) e bordi replicati. Le zone uniformi restano identiche.
 * [amount] è un Float: prodotto e somma in float32, come in Kotlin.
 */
function unsharp(px, w, h, amount) {
  // passata orizzontale: somme pesate 1-2-1, valori 0..1020
  const hsum = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : w - 1;
      hsum[row + x] = px[row + xl] + 2 * px[row + x] + px[row + xr];
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const row = y * w;
    const down = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const blur = (hsum[up + x] + 2 * hsum[row + x] + hsum[down + x] + 8) >> 4;
      const c = px[row + x];
      const v = fround(c + fround(amount * (c - blur)));
      out[row + x] = roundToInt(clamp(v));
    }
  }
  return out;
}

/** Namespace come l'object Kotlin. */
export const Tone = Object.freeze({
  apply: applyTone,
  curve: toneCurve,
  levels,
  shadowLift,
  MIN_LEVELS_RANGE,
  SHADOWS_MAX_LIFT,
  SHADOWS_GAIN,
});
