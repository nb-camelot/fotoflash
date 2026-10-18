// ZIP senza compressione ("store"): le foto sono già JPEG/PNG, comprimerle di nuovo non rende
// e costa tempo. Formato: intestazioni locali + dati, directory centrale, record di chiusura.
// I Blob non si copiano mai in memoria JS: il CRC si calcola leggendoli a pezzi e il Blob
// finale li referenzia, così "esporta tutte le foto" regge anche centinaia di MB.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

/** Versione 2.0: la minima che tutti gli estrattori accettano per file e cartelle. */
const VERSION = 20;

/** Bit 11 del campo flag: nome e commento in UTF-8. */
export const FLAG_UTF8 = 0x0800;

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

let crcTable = null;

/** Tabella CRC-32 (polinomio riflesso 0xEDB88320), calcolata alla prima richiesta. */
function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/**
 * CRC-32 di [bytes]; per i calcoli a pezzi si passa il risultato precedente come [crc].
 * Una stringa viene codificata in UTF-8.
 */
export function crc32(bytes, crc = 0) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const t = table();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Data e ora nel formato MS-DOS (ora locale, risoluzione di 2 secondi).
 * Fuori dall'intervallo 1980..2107 si blocca agli estremi: il formato non va oltre.
 */
export function dosDateTime(when = new Date()) {
  let d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) d = new Date();
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  let day = d.getDate();
  let hours = d.getHours();
  let minutes = d.getMinutes();
  let seconds = d.getSeconds();
  if (year < 1980) {
    year = 1980; month = 1; day = 1; hours = 0; minutes = 0; seconds = 0;
  } else if (year > 2107) {
    year = 2107; month = 12; day = 31; hours = 23; minutes = 59; seconds = 58;
  }
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | (seconds >> 1),
  };
}

/**
 * Nome sicuro dentro l'archivio: barre in avanti, niente radice, niente "." o "..",
 * niente caratteri di controllo. Così l'estrazione non esce mai dalla cartella scelta.
 */
export function normalizeZipName(name) {
  const parts = String(name ?? '')
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

/** Rende unico [name] tra quelli già usati: "foto.jpg" → "foto (2).jpg". */
export function uniqueZipName(name, used) {
  const key = (s) => s.toLowerCase();
  if (!used.has(key(name))) {
    used.add(key(name));
    return name;
  }
  const slash = name.lastIndexOf('/');
  const dot = name.lastIndexOf('.');
  const hasExt = dot > slash + 1;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!used.has(key(candidate))) {
      used.add(key(candidate));
      return candidate;
    }
  }
}

function zipError(message) {
  const e = new Error(message);
  e.name = 'ZipError';
  e.code = 'zip-too-large';
  return e;
}

/** Dati di una voce come Blob o come byte, con dimensione e CRC. */
async function prepareData(data) {
  if (data == null) return { part: new Uint8Array(0), size: 0, crc: 0 };
  if (typeof data === 'string') {
    const bytes = new TextEncoder().encode(data);
    return { part: bytes, size: bytes.length, crc: crc32(bytes) };
  }
  if (data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(data);
    return { part: bytes, size: bytes.length, crc: crc32(bytes) };
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return { part: bytes, size: bytes.length, crc: crc32(bytes) };
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return { part: data, size: data.size, crc: await blobCrc(data) };
  }
  throw new TypeError('dati della voce non supportati');
}

/** CRC di un Blob letto a pezzi, senza caricarlo tutto in memoria. */
async function blobCrc(blob) {
  if (typeof blob.stream !== 'function') return crc32(new Uint8Array(await blob.arrayBuffer()));
  const reader = blob.stream().getReader();
  let crc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32(value, crc);
  }
  return crc;
}

function localHeader(nameBytes, dos, crc, size) {
  const h = new Uint8Array(30 + nameBytes.length);
  const v = new DataView(h.buffer);
  v.setUint32(0, SIG_LOCAL, true);
  v.setUint16(4, VERSION, true);
  v.setUint16(6, FLAG_UTF8, true);
  v.setUint16(8, 0, true); // metodo 0 = store
  v.setUint16(10, dos.time, true);
  v.setUint16(12, dos.date, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, size, true); // compressa = non compressa
  v.setUint32(22, size, true);
  v.setUint16(26, nameBytes.length, true);
  v.setUint16(28, 0, true);
  h.set(nameBytes, 30);
  return h;
}

function centralHeader(nameBytes, dos, crc, size, offset) {
  const h = new Uint8Array(46 + nameBytes.length);
  const v = new DataView(h.buffer);
  v.setUint32(0, SIG_CENTRAL, true);
  v.setUint16(4, VERSION, true); // creato da: MS-DOS/FAT, 2.0
  v.setUint16(6, VERSION, true);
  v.setUint16(8, FLAG_UTF8, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, dos.time, true);
  v.setUint16(14, dos.date, true);
  v.setUint32(16, crc, true);
  v.setUint32(20, size, true);
  v.setUint32(24, size, true);
  v.setUint16(28, nameBytes.length, true);
  v.setUint16(30, 0, true); // extra
  v.setUint16(32, 0, true); // commento
  v.setUint16(34, 0, true); // disco
  v.setUint16(36, 0, true); // attributi interni
  v.setUint32(38, 0, true); // attributi esterni
  v.setUint32(42, offset, true);
  h.set(nameBytes, 46);
  return h;
}

function endRecord(count, cdSize, cdOffset) {
  const h = new Uint8Array(22);
  const v = new DataView(h.buffer);
  v.setUint32(0, SIG_END, true);
  v.setUint16(4, 0, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdOffset, true);
  v.setUint16(20, 0, true);
  return h;
}

/**
 * Archivio ZIP "store" con CRC-32.
 * entries: [{ name, data: Uint8Array|ArrayBuffer|Blob|string, date: Date|number }]
 * options.onProgress(done, total): dopo ogni voce, per le esportazioni lunghe.
 * → Promise<Blob> di tipo application/zip. Nomi doppi diventano "nome (2).ext".
 */
export async function makeZip(entries, { onProgress } = {}) {
  const list = Array.from(entries ?? []);
  if (list.length > MAX_ENTRIES) throw zipError(`troppe voci per uno ZIP senza ZIP64: ${list.length}`);
  const encoder = new TextEncoder();
  const used = new Set();
  const parts = [];
  const central = [];
  let offset = 0;

  for (let i = 0; i < list.length; i++) {
    const entry = list[i] ?? {};
    const name = uniqueZipName(normalizeZipName(entry.name), used);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 0xffff) throw zipError('nome di file troppo lungo');
    const { part, size, crc } = await prepareData(entry.data);
    const dos = dosDateTime(entry.date ?? new Date());
    if (size > MAX_SIZE || offset > MAX_SIZE) throw zipError('archivio oltre 4 GB');

    const local = localHeader(nameBytes, dos, crc, size);
    central.push(centralHeader(nameBytes, dos, crc, size, offset));
    parts.push(local, part);
    offset += local.length + size;
    if (typeof onProgress === 'function') onProgress(i + 1, list.length);
  }

  let cdSize = 0;
  for (const h of central) cdSize += h.length;
  if (offset > MAX_SIZE || offset + cdSize > MAX_SIZE) throw zipError('archivio oltre 4 GB');
  parts.push(...central, endRecord(list.length, cdSize, offset));
  return new Blob(parts, { type: 'application/zip' });
}
