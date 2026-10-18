// Ponte tra le immagini del browser (ImageBitmap, canvas, video) e il motore termico (core/),
// come BitmapBridge.kt. Lo usano il renderer delle stampe, la fotocamera e l'anteprima dal vivo.

import { GrayImage } from '../core/gray.js';
import { toRgba } from '../core/bitimage.js';

/**
 * Canvas di lavoro: OffscreenCanvas se c'è (non tocca il DOM), altrimenti un canvas del documento.
 * Per i canvas da mostrare a schermo si usa bitImageToCanvas, che restituisce sempre un elemento.
 */
export function createCanvas(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return createDomCanvas(w, h);
}

/** Canvas del documento (si può inserire nella pagina); OffscreenCanvas fuori dal DOM (worker). */
function createDomCanvas(width, height) {
  const doc = globalThis.document;
  if (doc && typeof doc.createElement === 'function') {
    const c = doc.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  throw new Error('nessun canvas disponibile in questo ambiente');
}

/** Libera subito la memoria (anche GPU) di un canvas intermedio. */
export function releaseCanvas(canvas) {
  if (canvas && typeof canvas.getContext === 'function') {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Contesto 2D per canvas da cui si leggono i pixel: willReadFrequently evita la copia dalla GPU. */
export function readableContext(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** Misure intrinseche di qualunque sorgente disegnabile (video e img hanno nomi diversi). */
export function sourceSize(source) {
  if (!source) return { width: 0, height: 0 };
  if (source.videoWidth !== undefined && source.videoHeight !== undefined && 'readyState' in source) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source.naturalWidth !== undefined && source.naturalHeight !== undefined) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (source.displayWidth !== undefined && source.displayHeight !== undefined) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  return { width: source.width ?? 0, height: source.height ?? 0 };
}

/**
 * Ritaglio centrale con il rapporto [dstW]:[dstH] dentro una sorgente [srcW] x [srcH]
 * (stessi arrotondamenti di Bitmap.centerCrop). → { sx, sy, sw, sh }
 */
export function coverCrop(srcW, srcH, dstW, dstH) {
  const targetRatio = dstW / dstH;
  const sourceRatio = srcW / srcH;
  let sw;
  let sh;
  if (sourceRatio > targetRatio) {
    // sorgente più larga: si tagliano i lati
    sh = srcH;
    sw = Math.min(srcW, Math.max(1, Math.round(srcH * targetRatio)));
  } else {
    // sorgente più alta: si tagliano sopra e sotto
    sw = srcW;
    sh = Math.min(srcH, Math.max(1, Math.round(srcW / targetRatio)));
  }
  return { sx: Math.floor((srcW - sw) / 2), sy: Math.floor((srcH - sh) / 2), sw, sh };
}

/**
 * Passaggi di riduzione per dimezzamenti successivi, come centerCrop: finché la sorgente è
 * almeno il doppio della destinazione in entrambi i lati si dimezza (divisione intera).
 * → [{ width, height }] dei passaggi intermedi, esclusa la destinazione finale.
 */
export function halvingSteps(srcW, srcH, dstW, dstH) {
  const steps = [];
  let w = srcW;
  let h = srcH;
  while (w >= dstW * 2 && h >= dstH * 2) {
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
    steps.push({ width: w, height: h });
  }
  return steps;
}

function smooth(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

/**
 * Disegna [source] in [rect] di [ctx] ritagliandola al centro (cover), come Bitmap.centerCrop:
 * le riduzioni forti passano per dimezzamenti, perché un solo drawImage su un fattore 5-10x
 * salta pixel e il retino trasforma l'aliasing in rumore ben visibile sulla carta.
 * rect: { left, top, width, height }.
 */
export function drawCover(ctx, source, rect) {
  const dw = Math.round(rect.width);
  const dh = Math.round(rect.height);
  if (!(dw > 0 && dh > 0)) return;
  const size = sourceSize(source);
  if (!(size.width > 0 && size.height > 0)) throw new Error('sorgente senza dimensioni');

  const crop = coverCrop(size.width, size.height, dw, dh);
  let current = source;
  let sx = crop.sx;
  let sy = crop.sy;
  let sw = crop.sw;
  let sh = crop.sh;
  const temps = [];
  try {
    for (const step of halvingSteps(sw, sh, dw, dh)) {
      const half = createCanvas(step.width, step.height);
      const hctx = half.getContext('2d');
      smooth(hctx);
      hctx.drawImage(current, sx, sy, sw, sh, 0, 0, step.width, step.height);
      temps.push(half);
      current = half;
      sx = 0;
      sy = 0;
      sw = step.width;
      sh = step.height;
    }
    ctx.save();
    smooth(ctx);
    ctx.drawImage(current, sx, sy, sw, sh, rect.left ?? 0, rect.top ?? 0, dw, dh);
    ctx.restore();
  } finally {
    temps.forEach(releaseCanvas);
  }
}

/** GrayImage [width] x [height] della sorgente ritagliata al centro (alpha composta su bianco dal core). */
export function grayFromSource(source, width, height) {
  const w = Math.round(width);
  const h = Math.round(height);
  const canvas = createCanvas(w, h);
  try {
    const ctx = readableContext(canvas);
    drawCover(ctx, source, { left: 0, top: 0, width: w, height: h });
    const { data } = ctx.getImageData(0, 0, w, h);
    return GrayImage.fromRgba(w, h, data);
  } finally {
    releaseCanvas(canvas);
  }
}

/** Uint8ClampedArray (quello che vuole ImageData) senza copiare se possibile. */
export function asClamped(rgba) {
  if (rgba instanceof Uint8ClampedArray) return rgba;
  return new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
}

/**
 * RGBA ingrandito di [scale] volte per replica dei pixel (vicino più prossimo): niente
 * filtri, ogni punto della testina resta un quadrato netto. Funzione pura.
 */
export function scaleRgbaNearest(rgba, width, height, scale) {
  const s = Math.max(1, Math.round(scale));
  if (s === 1) return asClamped(rgba);
  const outW = width * s;
  const out = new Uint8ClampedArray(outW * height * s * 4);
  const src32 = new Uint32Array(asClamped(rgba).slice().buffer);
  const dst32 = new Uint32Array(out.buffer);
  for (let y = 0; y < height; y++) {
    const rowStart = y * s * outW;
    for (let x = 0; x < width; x++) {
      const px = src32[y * width + x];
      const base = rowStart + x * s;
      for (let k = 0; k < s; k++) dst32[base + k] = px;
    }
    // le altre righe del blocco sono copie della prima
    for (let r = 1; r < s; r++) dst32.copyWithin(rowStart + r * outW, rowStart, rowStart + outW);
  }
  return out;
}

/**
 * Canvas in bianco e nero puro di una BitImage, 1 punto = [scale] x [scale] pixel, vicino più
 * prossimo. Restituisce un elemento <canvas> quando c'è il documento (la UI lo inserisce nella
 * pagina), un OffscreenCanvas altrimenti.
 */
export function bitImageToCanvas(img, scale = 1) {
  const s = Math.max(1, Math.round(scale));
  const w = img.width * s;
  const h = img.height * s;
  const canvas = createDomCanvas(w, h);
  const rgba = scaleRgbaNearest(toRgba(img), img.width, img.height, s);
  canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas;
}

/** PNG (o altro formato) del canvas, per Storico, download e condivisione. */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('conversione del canvas fallita'))),
      type,
      quality,
    );
  });
}
