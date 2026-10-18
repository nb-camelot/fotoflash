// Immagine a 1 bit pronta per la testina: porting di BitImage.kt e BitImageOps.kt.
// Righe impacchettate MSB-first come le vuole GS v 0: il bit 7 del primo byte è il pixel più a
// sinistra, un bit a 1 è un punto nero. Foto retinate e testi sogliati si disegnano a parte e poi
// si sommano (OR) su un'unica BitImage.

import { lumaRgb, lumaOf } from './gray.js';

export class BitImage {
  /** [data] facoltativo: righe già impacchettate (bytesPerRow * height byte), usate così come sono. */
  constructor(width, height, data) {
    if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
      throw new RangeError(`dimensioni non valide: ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.bytesPerRow = (width + 7) >>> 3;
    const size = this.bytesPerRow * height;
    if (data === undefined || data === null) {
      this.data = new Uint8Array(size);
    } else {
      if (!(data instanceof Uint8Array) || data.length !== size) {
        throw new RangeError(`servono ${size} byte per ${width}x${height}`);
      }
      this.data = data;
    }
  }

  get(x, y) {
    return (this.data[y * this.bytesPerRow + (x >>> 3)] & (0x80 >>> (x & 7))) !== 0;
  }

  set(x, y, black) {
    const i = y * this.bytesPerRow + (x >>> 3);
    const mask = 0x80 >>> (x & 7);
    if (black) this.data[i] |= mask;
    else this.data[i] &= ~mask;
  }

  /** Copia le righe [fromRow, fromRow + rows) in un nuovo array, per inviare l'immagine a bande. */
  rowsSlice(fromRow, rows) {
    if (!(fromRow >= 0 && rows > 0 && fromRow + rows <= this.height)) throw new RangeError('bande fuori range');
    return this.data.slice(fromRow * this.bytesPerRow, (fromRow + rows) * this.bytesPerRow);
  }

  /** Copia indipendente dell'immagine. */
  copy() {
    return new BitImage(this.width, this.height, this.data.slice());
  }
}

/**
 * Somma (OR) i punti neri di [src] in [dst], con l'angolo in alto a sinistra in ([left], [top]).
 * [src] può uscire dai bordi da qualunque lato: la parte fuori viene tagliata. I punti bianchi di
 * [src] non cancellano nulla, e i bit di riempimento di fine riga non vengono mai toccati.
 */
export function blit(dst, src, left, top) {
  left = Math.trunc(left);
  top = Math.trunc(top);
  const x0 = Math.max(0, left);
  const x1 = Math.min(dst.width, left + src.width);
  const y0 = Math.max(0, top);
  const y1 = Math.min(dst.height, top + src.height);
  if (x0 >= x1 || y0 >= y1) return;
  const sd = src.data;
  const dd = dst.data;
  const sbpr = src.bytesPerRow;
  const dbpr = dst.bytesPerRow;
  for (let y = y0; y < y1; y++) {
    const srcRow = (y - top) * sbpr;
    const dstRow = y * dbpr;
    let x = x0;
    while (x < x1) {
      const sx = x - left;
      const b = sd[srcRow + (sx >>> 3)];
      if (b === 0) {
        // byte sorgente tutto bianco: si salta al byte successivo
        x += 8 - (sx & 7);
        continue;
      }
      if ((b & (0x80 >>> (sx & 7))) !== 0) dd[dstRow + (x >>> 3)] |= 0x80 >>> (x & 7);
      x++;
    }
  }
}

/**
 * L'immagine portata alla larghezza [width] della testina, con la stessa altezza: se è più stretta
 * viene centrata nel bianco, se è più larga si ritaglia la parte centrale. Con la larghezza giusta
 * restituisce la stessa immagine, senza copiarla (ristampa dopo un cambio di carta 58/80 mm).
 */
export function centeredOn(img, width) {
  if (width === img.width) return img;
  const out = new BitImage(width, img.height);
  // divisione intera di Kotlin: tronca verso lo zero anche quando si ritaglia (offset negativo)
  blit(out, img, Math.trunc((width - img.width) / 2), 0);
  return out;
}

/** Riempie [rect] ({left, top, width, height}) di nero o di bianco, tagliando ciò che esce. */
export function fillRect(img, rect, black) {
  const left = Math.trunc(rect.left);
  const top = Math.trunc(rect.top);
  const x0 = Math.max(0, left);
  const x1 = Math.min(img.width, left + Math.trunc(rect.width));
  const y0 = Math.max(0, top);
  const y1 = Math.min(img.height, top + Math.trunc(rect.height));
  if (x0 >= x1 || y0 >= y1) return;
  const data = img.data;
  const bpr = img.bytesPerRow;
  for (let y = y0; y < y1; y++) {
    const row = y * bpr;
    for (let x = x0; x < x1; x++) {
      const i = row + (x >>> 3);
      const mask = 0x80 >>> (x & 7);
      if (black) data[i] |= mask;
      else data[i] &= ~mask;
    }
  }
}

/** Pixel RGBA (riga per riga) per mostrare o salvare la stampa: colori come [r, g, b, a]. */
export function toRgba(img, black = [0, 0, 0, 255], white = [255, 255, 255, 255]) {
  const { width, height, bytesPerRow, data } = img;
  const out = new Uint8ClampedArray(width * height * 4);
  const [br, bg, bb, ba] = black;
  const [wr, wg, wb, wa] = white;
  let o = 0;
  for (let y = 0; y < height; y++) {
    const row = y * bytesPerRow;
    for (let x = 0; x < width; x++, o += 4) {
      if ((data[row + (x >>> 3)] & (0x80 >>> (x & 7))) !== 0) {
        out[o] = br;
        out[o + 1] = bg;
        out[o + 2] = bb;
        out[o + 3] = ba;
      } else {
        out[o] = wr;
        out[o + 1] = wg;
        out[o + 2] = wb;
        out[o + 3] = wa;
      }
    }
  }
  return out;
}

/** Interi ARGB (riga per riga), come toArgb di Kotlin. */
export function toArgb(img, black = 0xff000000 | 0, white = 0xffffffff | 0) {
  const { width, height, bytesPerRow, data } = img;
  const out = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * bytesPerRow;
    const outRow = y * width;
    for (let x = 0; x < width; x++) {
      out[outRow + x] = (data[row + (x >>> 3)] & (0x80 >>> (x & 7))) !== 0 ? black : white;
    }
  }
  return out;
}

/**
 * Pixel RGBA in 1 bit con una soglia secca: nero se luma < [threshold] e alpha >= 128.
 * Serve per testi e grafica già in bianco e nero, non per le foto (quelle si retinano).
 */
export function bitImageFromRgba(width, height, rgba, threshold = 128) {
  const out = new BitImage(width, height);
  const n = width * height;
  if (!rgba || rgba.length < n * 4) {
    throw new RangeError(`servono ${n} pixel RGBA, ricevuti ${rgba ? Math.floor(rgba.length / 4) : 0}`);
  }
  const data = out.data;
  const bpr = out.bytesPerRow;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const outRow = y * bpr;
    for (let x = 0; x < width; x++) {
      const j = (row + x) * 4;
      if (rgba[j + 3] >= 128 && lumaRgb(rgba[j], rgba[j + 1], rgba[j + 2]) < threshold) {
        data[outRow + (x >>> 3)] |= 0x80 >>> (x & 7);
      }
    }
  }
  return out;
}

/** Interi ARGB in 1 bit, come bitImageFromArgb di Kotlin. */
export function bitImageFromArgb(width, height, argb, threshold = 128) {
  const out = new BitImage(width, height);
  const n = width * height;
  if (!argb || argb.length < n) {
    throw new RangeError(`servono ${n} pixel ARGB, ricevuti ${argb ? argb.length : 0}`);
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const c = argb[row + x];
      if (c >>> 24 >= 128 && lumaOf(c) < threshold) out.set(x, y, true);
    }
  }
  return out;
}

/** Copia indipendente dell'immagine. */
export function copyBitImage(img) {
  return img.copy();
}

// Bit a 1 per ogni valore di byte.
const POPCOUNT = (() => {
  const t = new Uint8Array(256);
  for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >>> 1];
  return t;
})();

/** Numero di punti neri: misura quanta testina si scalda (e quanta carta si annerisce). */
export function countBlack(img) {
  const data = img.data;
  let n = 0;
  for (let i = 0; i < data.length; i++) n += POPCOUNT[data[i]];
  return n;
}
