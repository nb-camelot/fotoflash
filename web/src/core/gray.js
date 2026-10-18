// Immagine in scala di grigi: porting di GrayImage.kt.
// Un byte per pixel (Uint8Array), 0 = nero, 255 = bianco: il bianco è la carta, il nero ciò che
// la testina scalda. get/set non controllano i limiti, per restare veloci nei cicli.

function checkSize(width, height) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
    throw new RangeError(`dimensioni non valide: ${width}x${height}`);
  }
}

/** Luma Rec.601 intera e arrotondata (0.299 R + 0.587 G + 0.114 B), come lumaOf di Kotlin. */
export function lumaRgb(r, g, b) {
  return Math.trunc((r * 299 + g * 587 + b * 114 + 500) / 1000);
}

/** Luma di un intero ARGB (alpha ignorata). */
export function lumaOf(argb) {
  return lumaRgb((argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff);
}

// Composizione su bianco: l*a + 255*(1-a), arrotondata con la stessa divisione intera di Kotlin.
function composite(l, a) {
  return a === 255 ? l : Math.trunc((l * a + 255 * (255 - a) + 127) / 255);
}

export class GrayImage {
  /**
   * [pixels] facoltativo: Uint8Array usato così com'è (come il ByteArray di Kotlin), oppure un
   * array o typed array copiato; senza pixel l'immagine è tutta bianca.
   */
  constructor(width, height, pixels) {
    checkSize(width, height);
    const n = width * height;
    let px;
    if (pixels === undefined || pixels === null) {
      px = new Uint8Array(n).fill(255);
    } else if (pixels instanceof Uint8Array) {
      px = pixels;
    } else if (ArrayBuffer.isView(pixels) || Array.isArray(pixels)) {
      // come toByte(): si tengono gli 8 bit bassi
      px = Uint8Array.from(pixels, (v) => v & 0xff);
    } else {
      throw new TypeError('pixel non validi: serve un Uint8Array');
    }
    if (px.length !== n) {
      throw new RangeError(`servono ${n} pixel per ${width}x${height}, ricevuti ${px.length}`);
    }
    this.width = width;
    this.height = height;
    this.pixels = px;
  }

  /** Luminanza del pixel, 0..255. */
  get(x, y) {
    return this.pixels[y * this.width + x];
  }

  /** Imposta la luminanza; i valori fuori range vengono riportati in 0..255. */
  set(x, y, v) {
    this.pixels[y * this.width + x] = v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /** Copia indipendente: modificarla non tocca l'originale. */
  copy() {
    return new GrayImage(this.width, this.height, this.pixels.slice());
  }

  /** Istogramma delle luminanze: 256 contatori. */
  histogram() {
    const hist = new Int32Array(256);
    const px = this.pixels;
    for (let i = 0; i < px.length; i++) hist[px[i]]++;
    return hist;
  }

  /** Luminanza media, utile per diagnosi e test. */
  mean() {
    const px = this.pixels;
    let sum = 0;
    for (let i = 0; i < px.length; i++) sum += px[i];
    return sum / px.length;
  }

  /**
   * Pixel RGBA (come ImageData.data, non premoltiplicati) in grigi.
   * L'alpha viene composta su bianco: un PNG trasparente diventa carta, non inchiostro.
   */
  static fromRgba(width, height, rgba) {
    checkSize(width, height);
    const n = width * height;
    if (!rgba || rgba.length < n * 4) {
      throw new RangeError(`servono ${n} pixel RGBA, ricevuti ${rgba ? Math.floor(rgba.length / 4) : 0}`);
    }
    const out = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      out[i] = composite(lumaRgb(rgba[j], rgba[j + 1], rgba[j + 2]), rgba[j + 3]);
    }
    return new GrayImage(width, height, out);
  }

  /** Interi ARGB (come Bitmap.getPixels di Android): stessa conversione di GrayImage.fromArgb. */
  static fromArgb(width, height, argb) {
    checkSize(width, height);
    const n = width * height;
    if (!argb || argb.length < n) {
      throw new RangeError(`servono ${n} pixel ARGB, ricevuti ${argb ? argb.length : 0}`);
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = argb[i];
      out[i] = composite(lumaOf(c), c >>> 24);
    }
    return new GrayImage(width, height, out);
  }

  /** Sfumatura orizzontale da nero (a sinistra) a bianco (a destra): per test e calibrazione. */
  static gradient(width, height) {
    checkSize(width, height);
    const out = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
      const v = width === 1 ? 0 : Math.trunc((x * 255) / (width - 1));
      for (let y = 0; y < height; y++) out[y * width + x] = v;
    }
    return new GrayImage(width, height, out);
  }
}
