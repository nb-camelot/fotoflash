// Uscita dei file dall'app: download e condivisione (Web Share con file).
// Sul web "salva in galleria" è un download: il browser lo mette nella cartella Download,
// e su Android la Galleria lo trova da lì.

/** L'URL del Blob vive un po' dopo il clic: revocarlo subito interrompe il download su alcuni browser. */
const REVOKE_DELAY_MS = 60_000;

/** Pausa tra download in serie: Chrome chiede il permesso una volta sola e non ne perde nessuno. */
const DOWNLOAD_SPACING_MS = 300;

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
};

/** Estensione suggerita per un tipo MIME ("bin" se sconosciuto). */
export function extensionFor(type) {
  return EXTENSIONS[String(type ?? '').split(';')[0].trim().toLowerCase()] ?? 'bin';
}

/** Nome di file con data e ora locali: "fotoflash-20261018-153012.png". */
export function exportFileName(prefix = 'fotoflash', ext = 'png', when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const cleanExt = String(ext ?? '').replace(/^\.+/, '');
  return cleanExt ? `${prefix}-${stamp}.${cleanExt}` : `${prefix}-${stamp}`;
}

/** Nome valido sui file system comuni: niente separatori né caratteri riservati. */
export function safeFileName(name, fallback = 'fotoflash') {
  const clean = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180);
  return clean || fallback;
}

/** Un File dal Blob (Web Share accetta solo File con nome); un File resta com'è. */
export function fileFromBlob(blob, name) {
  if (typeof File !== 'undefined' && blob instanceof File && (!name || blob.name === name)) return blob;
  const type = blob?.type || 'application/octet-stream';
  const fileName = safeFileName(name || blob?.name || `fotoflash.${extensionFor(type)}`);
  return new File([blob], fileName, { type, lastModified: Date.now() });
}

/** Scarica [blob] con il nome [filename] tramite un link temporaneo. */
export function downloadBlob(blob, filename) {
  const doc = globalThis.document;
  if (!doc || typeof URL?.createObjectURL !== 'function') {
    throw new Error('download non disponibile in questo ambiente');
  }
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = safeFileName(filename || blob?.name || `fotoflash.${extensionFor(blob?.type)}`);
  a.rel = 'noopener';
  a.style.display = 'none';
  (doc.body ?? doc.documentElement).appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    const timer = setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    // in Node (test) il timer non deve tenere vivo il processo; nel browser è un numero
    timer?.unref?.();
  }
}

/** true se il browser sa condividere proprio questi file (Chrome Android, Edge/Chrome desktop recenti). */
export function canShareFiles(files) {
  const nav = globalThis.navigator;
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: Array.from(files ?? []) }) === true;
  } catch {
    return false;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Condivide [files] con il foglio di condivisione del sistema; dove manca, li scarica uno per uno.
 * → 'shared' | 'cancelled' (l'utente ha chiuso il foglio: niente download) | 'downloaded' | 'none'.
 * Va chiamata vicino al tocco: Web Share vuole un gesto recente, altrimenti si ripiega sul download.
 */
export async function shareFiles(files, { title, text } = {}) {
  const list = Array.from(files ?? [])
    .filter(Boolean)
    .map((f, i) => fileFromBlob(f, f?.name || `fotoflash-${i + 1}.${extensionFor(f?.type)}`));
  if (list.length === 0) return 'none';

  if (canShareFiles(list)) {
    const data = { files: list };
    if (title) data.title = String(title);
    if (text) data.text = String(text);
    try {
      await globalThis.navigator.share(data);
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (gesto scaduto), DataError, NotSupportedError: si scarica.
    }
  }

  for (let i = 0; i < list.length; i++) {
    if (i > 0) await wait(DOWNLOAD_SPACING_MS);
    downloadBlob(list[i], list[i].name);
  }
  return 'downloaded';
}
