// Import di foto dalla galleria o dal file system: ImageBitmap dritte (orientamento EXIF
// applicato) e leggere, pronte per l'editor. Come GalleryImport.kt: lato lungo fino a 2048 px.

/** Lato lungo massimo delle foto che passano all'editor (come MAX_PHOTO_SIDE su Android). */
export const MAX_PHOTO_SIDE = 2048;

/**
 * Misure dentro un lato lungo di [maxSide], stesse proporzioni, mai ingrandite.
 * Arrotondamento come Kotlin (roundToInt), minimo 1 px.
 */
export function fitWithin(width, height, maxSide = MAX_PHOTO_SIDE) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longSide = Math.max(w, h);
  if (!(maxSide > 0) || longSide <= maxSide) return { width: w, height: h };
  const scale = maxSide / longSide;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Errore con codice leggibile dalla UI: 'not-image' | 'unsupported-format' | 'unreadable'. */
function importError(code, cause) {
  const e = new Error(`immagine non importabile (${code})`);
  e.name = 'ImportError';
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

/** true se il file dichiara un tipo che non è un'immagine (un tipo vuoto si prova lo stesso). */
export function isNonImageType(type) {
  const t = String(type ?? '').trim().toLowerCase();
  return t !== '' && !t.startsWith('image/');
}

function newCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = globalThis.document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Decodifica con l'orientamento EXIF applicato; null se il browser non sa decodificarla così. */
async function decodeWithBitmap(file) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    // Browser che non conoscono l'opzione: senza opzioni l'EXIF lo applicano già di default.
    if (e?.name === 'TypeError' || e instanceof TypeError) {
      try {
        return await createImageBitmap(file);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Ripiego con <img>: decodifica formati che createImageBitmap rifiuta (HEIC su Safari) e
 * applica l'EXIF (image-orientation: from-image è il default dei browser moderni).
 */
async function decodeWithImage(file) {
  const doc = globalThis.document;
  if (!doc || typeof URL?.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(file);
  try {
    const img = doc.createElement('img');
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') {
      await img.decode();
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!(w > 0 && h > 0)) return null;
    const canvas = newCanvas(w, h);
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Riduzione di qualità a [width] x [height]. Prima createImageBitmap con resizeQuality 'high';
 * altrimenti canvas a dimezzamenti successivi (come centerCrop): il bilineare da solo su un
 * fattore forte salta pixel, e il retino trasforma l'aliasing in rumore sulla carta.
 */
async function resize(source, width, height) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    } catch {
      // opzioni di ridimensionamento non supportate: si passa dal canvas
    }
  }
  let current = source;
  let cw = source.width;
  let ch = source.height;
  const temps = [];
  while (cw >= width * 2 && ch >= height * 2) {
    const nw = Math.floor(cw / 2);
    const nh = Math.floor(ch / 2);
    const half = newCanvas(nw, nh);
    const hctx = half.getContext('2d');
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(current, 0, 0, cw, ch, 0, 0, nw, nh);
    temps.push(half);
    current = half;
    cw = nw;
    ch = nh;
  }
  const out = newCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, cw, ch, 0, 0, width, height);
  for (const t of temps) t.width = 0;
  return toBitmap(out);
}

/** ImageBitmap dal canvas se possibile (le sessioni lavorano con ImageBitmap), altrimenti il canvas. */
async function toBitmap(canvas) {
  if (typeof createImageBitmap !== 'function') return canvas;
  try {
    const bitmap = await createImageBitmap(canvas);
    canvas.width = 0;
    return bitmap;
  } catch {
    return canvas;
  }
}

function release(image) {
  if (image && typeof image.close === 'function') image.close();
  else if (image && 'width' in image && typeof image.getContext === 'function') image.width = 0;
}

/**
 * Carica una foto da un File/Blob: orientamento EXIF applicato, lato lungo al massimo [maxSide].
 * → ImageBitmap (un canvas solo nei browser senza createImageBitmap).
 * Errori con err.code: 'not-image' | 'unsupported-format' | 'unreadable'.
 */
export async function loadImageFile(file, maxSide = MAX_PHOTO_SIDE) {
  if (!file || typeof file !== 'object') throw importError('not-image');
  if (isNonImageType(file.type)) throw importError('not-image');

  let decoded;
  try {
    decoded = (await decodeWithBitmap(file)) ?? (await decodeWithImage(file));
  } catch (e) {
    throw importError('unreadable', e);
  }
  if (!decoded) throw importError('unsupported-format');

  const target = fitWithin(decoded.width, decoded.height, maxSide);
  if (target.width === decoded.width && target.height === decoded.height) {
    return typeof decoded.close === 'function' ? decoded : toBitmap(decoded);
  }
  try {
    return await resize(decoded, target.width, target.height);
  } catch (e) {
    throw importError('unreadable', e);
  } finally {
    release(decoded);
  }
}

/**
 * Carica più foto in ordine (la striscia dalla galleria). Se una fallisce libera quelle già
 * caricate e rilancia: meglio un messaggio chiaro che una striscia con un buco.
 */
export async function loadImageFiles(files, maxSide = MAX_PHOTO_SIDE) {
  const loaded = [];
  try {
    for (const file of Array.from(files ?? [])) loaded.push(await loadImageFile(file, maxSide));
  } catch (e) {
    loaded.forEach(release);
    throw e;
  }
  return loaded;
}
