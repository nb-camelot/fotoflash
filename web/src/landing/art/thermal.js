// Le foto delle illustrazioni sono vere stampe termiche: un disegno su canvas passa dal motore
// (regolazioni + retino Atkinson, come in stampa) e diventa una BitImage. Per mostrarla:
// - runsPath(): tracciato SVG con i punti neri riga per riga (nitido a ogni ingrandimento, si muove
//   con la carta); è puro e si prova in Node;
// - bitsToDataUrl(): PNG ingrandito a blocchi interi, per la foto grande della hero.
// I risultati restano in una cache del modulo: rientrando nella pagina non si ricalcola nulla.
import { GrayImage } from '../../core/gray.js';
import { applyTone } from '../../core/tone.js';
import { dither } from '../../core/dither.js';
import { defaultTone } from '../../core/model.js';
import { toRgba } from '../../core/bitimage.js';
import { createCanvas, readableContext, releaseCanvas, scaleRgbaNearest } from '../../render/bitmap.js';

/** Inchiostro della carta (Ink) e carta trasparente: sotto c'è il foglio disegnato. */
const INK = [22, 19, 15, 255];
const CLEAR = [251, 248, 241, 0];

/** Regolazioni per le miniature: niente contrasto locale né controluce su pochi punti. */
export function miniTone() {
  return { ...defaultTone(), localContrast: 0, autoBacklight: false, sharpen: 0.25 };
}

/**
 * Punti della foto della hero per una larghezza a schermo di [cssWidth] px: circa 1,25 px per
 * punto, tra [min] e [max] (≈ 180, come chiesto dal brief), multipli di 4. Senza misura: [max].
 */
export function photoDots(cssWidth, { min = 96, max = 180, pxPerDot = 1.25 } = {}) {
  if (!(Number.isFinite(cssWidth) && cssWidth > 0)) return max;
  const dots = Math.round(cssWidth / pxPerDot / 4) * 4;
  return Math.max(min, Math.min(max, dots));
}

/**
 * Tracciato SVG dei punti neri di [bits]: un rettangolo alto 1 per ogni tratto orizzontale
 * continuo, 1 unità = 1 punto. Riempito con l'inchiostro, dà la stampa esatta. Funzione pura.
 */
export function runsPath(bits) {
  const { width, height } = bits;
  const parts = [];
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!bits.get(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && bits.get(x, y)) x++;
      parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
    }
  }
  return parts.join('');
}

/** Disegna con [draw](ctx, w, h) su fondo bianco e restituisce i grigi. Solo nel browser. */
export function drawGray(draw, width, height) {
  const canvas = createCanvas(width, height);
  try {
    const ctx = readableContext(canvas);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    draw(ctx, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return GrayImage.fromRgba(width, height, data);
  } finally {
    releaseCanvas(canvas);
  }
}

/** Grigi → BitImage come in stampa: regolazioni (null = nessuna) e retino. */
export function toThermal(gray, { tone = defaultTone(), algorithm = 'ATKINSON' } = {}) {
  return dither(tone ? applyTone(gray, tone) : gray, algorithm);
}

const cache = new Map();

/**
 * BitImage di un disegno, calcolata una volta per chiave e misura. [draw] riceve (ctx, w, h).
 * Nel browser; in caso di errore (niente canvas) restituisce null e l'illustrazione resta senza foto.
 */
export function thermalPhoto(key, draw, { width, height, tone = miniTone(), algorithm = 'ATKINSON' }) {
  const id = `${key}:${width}x${height}:${algorithm}`;
  if (cache.has(id)) return cache.get(id);
  let bits = null;
  try {
    bits = toThermal(drawGray(draw, width, height), { tone, algorithm });
  } catch (e) {
    console.warn('[landing] foto termica non disponibile', e);
  }
  cache.set(id, bits);
  return bits;
}

/** Tracciato dei punti della foto [key], dalla cache come thermalPhoto. '' se non disponibile. */
export function thermalPath(key, draw, size) {
  const id = `path:${key}:${size.width}x${size.height}`;
  if (cache.has(id)) return cache.get(id);
  const bits = thermalPhoto(key, draw, size);
  const d = bits ? runsPath(bits) : '';
  cache.set(id, d);
  return d;
}

/**
 * PNG della BitImage con ogni punto ingrandito a un blocco di [scale] x [scale] pixel: il browser
 * lo rimpicciolisce senza le irregolarità di un ingrandimento frazionario. Solo nel browser.
 */
export function bitsToDataUrl(bits, scale = 3) {
  const s = Math.max(1, Math.round(scale));
  const w = bits.width * s;
  const h = bits.height * s;
  const rgba = scaleRgbaNearest(toRgba(bits, INK, CLEAR), bits.width, bits.height, s);
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  const url = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  return url;
}
