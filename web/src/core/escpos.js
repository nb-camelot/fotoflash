// Comandi ESC/POS e lavoro di stampa: porting di EscPos.kt e ThermalJob.kt.
// Nota: la dimensione dei caratteri si imposta con GS ! (0x1D 0x21); ESC ! (0x1B 0x21) è il
// "print mode" con un'altra codifica dei bit e darebbe caratteri sbagliati.

import { coerceIn, intArg, jobOptionsWithDefaults } from './model.js';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const DLE = 0x10;
const EOT = 0x04;
const QUESTION = 0x3f;

/** Lunghezza dell'intestazione di ogni banda: GS v 0 m xL xH yL yH. */
export const HEADER_SIZE = 8;

// Int di Kotlin riportato in [min, max]; NaN vale [fallback]
function byteArg(v, min, max, fallback) {
  return coerceIn(intArg(v, fallback), min, max);
}

/**
 * Latin-1 come String.toByteArray(ISO_8859_1) di Java: un '?' per ogni carattere non
 * rappresentabile, uno solo per una coppia di surrogati (un'emoji).
 */
function encodeLatin1(s) {
  const out = new Uint8Array(s.length);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0xff) {
      out[n++] = c;
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    out[n++] = QUESTION;
  }
  return out.subarray(0, n);
}

/** UTF-8 come Java: i surrogati isolati diventano '?' (TextEncoder metterebbe U+FFFD). */
function encodeUtf8(s) {
  const out = new Uint8Array(s.length * 3);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdfff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (cp <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else {
        out[n++] = QUESTION;
        continue;
      }
    }
    if (cp < 0x80) {
      out[n++] = cp;
    } else if (cp < 0x800) {
      out[n++] = 0xc0 | (cp >> 6);
      out[n++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[n++] = 0xe0 | (cp >> 12);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    } else {
      out[n++] = 0xf0 | (cp >> 18);
      out[n++] = 0x80 | ((cp >> 12) & 0x3f);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    }
  }
  return out.subarray(0, n);
}

/** Codifica di un testo per la stampante: 'ISO-8859-1' (default, come Kotlin) oppure 'UTF-8'. */
export function encodeText(s, charset = 'ISO-8859-1') {
  const str = String(s ?? '');
  const name = String(charset).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (name === 'ISO88591' || name === 'LATIN1') return encodeLatin1(str);
  if (name === 'UTF8') return encodeUtf8(str);
  throw new RangeError(`codifica non supportata: ${String(charset)}`);
}

/**
 * Costruttore di comandi ESC/POS (sottoinsieme delle stampanti termiche economiche da 58/80 mm).
 * Ogni metodo accoda byte e restituisce il builder, per concatenare le chiamate.
 *
 * `size` ha due facce, come in Kotlin (metodo size(w, h) e proprietà size): chiamato è il comando
 * GS ! (`b.size(2, 2)`), usato come numero è il conteggio dei byte (`+b.size`, `b.size > 0`,
 * `${b.size}`). Per un confronto stretto (===) c'è `b.length`.
 */
export class EscPosBuilder {
  #buf = new Uint8Array(64);
  #count = 0;
  #size;

  constructor() {
    const size = (width, height) => this.#setSize(width, height);
    size.valueOf = () => this.#count;
    size[Symbol.toPrimitive] = () => this.#count;
    this.#size = size;
  }

  /** Comando GS ! se chiamato, byte accodati se letto come numero. */
  get size() {
    return this.#size;
  }

  /** Byte accodati finora. */
  get length() {
    return this.#count;
  }

  /** ESC @: azzera la stampante (modo testo, allineamento, dimensioni). */
  init() {
    return this.raw(ESC, 0x40);
  }

  /** ESC t n: tabella caratteri. Il numero dipende dal firmware (spesso 16 = WPC1252). */
  codepage(n) {
    return this.raw(ESC, 0x74, byteArg(n, 0, 255, 0));
  }

  /** ESC a n: 'START' 0, 'CENTER' 1, 'END' 2. */
  align(a) {
    let n;
    switch (a) {
      case 'START':
        n = 0;
        break;
      case 'CENTER':
        n = 1;
        break;
      case 'END':
        n = 2;
        break;
      default:
        throw new RangeError(`allineamento sconosciuto: ${String(a)}`);
    }
    return this.raw(ESC, 0x61, n);
  }

  /** ESC E n: grassetto. */
  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! n: moltiplicatori di larghezza e altezza 1..8, n = ((w-1) << 4) | (h-1). Si usa come size(w, h). */
  #setSize(width, height) {
    const w = byteArg(width, 1, 8, 1) - 1;
    const h = byteArg(height, 1, 8, 1) - 1;
    return this.raw(GS, 0x21, (w << 4) | h);
  }

  /** Testo codificato con [charset] (default Latin-1); i caratteri non rappresentabili diventano '?'. */
  text(s, charset = 'ISO-8859-1') {
    return this.append(encodeText(s, charset));
  }

  /** Testo seguito da LF. */
  line(s = '') {
    return this.text(s).raw(LF);
  }

  /** ESC d n: stampa il buffer e avanza di n righe (0..255). */
  feed(lines) {
    return this.raw(ESC, 0x64, byteArg(lines, 0, 255, 0));
  }

  /** GS V m 0 (funzione B): avanza fino alla taglierina e taglia; parziale m = 66, completo m = 65. */
  cut(partial = true) {
    return this.raw(GS, 0x56, partial ? 66 : 65, 0);
  }

  /** ESC 7 n1 n2 n3: punti scaldati insieme, tempo di riscaldamento, intervallo (0..255). */
  heat(heat = {}) {
    const h = heat || {};
    return this.raw(
      ESC,
      0x37,
      byteArg(h.maxDots ?? 7, 0, 255, 7),
      byteArg(h.heatTime ?? 80, 0, 255, 80),
      byteArg(h.heatInterval ?? 2, 0, 255, 2),
    );
  }

  /**
   * DLE EOT 4: chiede lo stato del sensore carta (un byte di risposta, da leggere con EscPosStatus).
   * Comando in tempo reale: mai in mezzo ai dati raster, e molte stampanti non rispondono affatto.
   */
  paperStatusRequest() {
    return this.raw(DLE, EOT, 4);
  }

  /** Immagine raster a bande di [bandHeight] righe (1..255), un comando GS v 0 per banda. */
  raster(image, bandHeight = 24) {
    const band = byteArg(bandHeight, 1, 255, 24);
    let row = 0;
    while (row < image.height) {
      const rows = Math.min(band, image.height - row);
      this.append(rasterBand(image, row, rows));
      row += rows;
    }
    return this;
  }

  /** Byte grezzi; ogni valore viene troncato a 8 bit. */
  raw(...bytes) {
    this.#ensure(bytes.length);
    const buf = this.#buf;
    for (const b of bytes) buf[this.#count++] = b & 0xff;
    return this;
  }

  /** Accoda un blocco di byte già pronto (per esempio una banda raster). */
  append(data) {
    const len = data.length;
    this.#ensure(len);
    this.#buf.set(data, this.#count);
    this.#count += len;
    return this;
  }

  /** Copia dei byte accodati. */
  bytes() {
    return this.#buf.slice(0, this.#count);
  }

  #ensure(extra) {
    const needed = this.#count + extra;
    if (needed > this.#buf.length) {
      const grown = new Uint8Array(Math.max(needed, this.#buf.length * 2));
      grown.set(this.#buf.subarray(0, this.#count));
      this.#buf = grown;
    }
  }
}

/**
 * Risposta a DLE EOT 4: bit 1 e 4 sempre a 1, bit 0 e 7 sempre a 0; bit 2-3 = carta quasi finita,
 * bit 5-6 = carta finita. Un byte che non rispetta i bit fissi dà null: meglio "non so" che un falso allarme.
 */
export const EscPosStatus = Object.freeze({
  /** true = carta finita, false = carta presente, null = risposta non valida. */
  paperEnd(b) {
    return isValidStatus(b) ? (b & 0x60) !== 0 : null;
  },
  /** true = carta quasi finita, null = risposta non valida. */
  paperNearEnd(b) {
    return isValidStatus(b) ? (b & 0x0c) !== 0 : null;
  },
});

function isValidStatus(b) {
  return Number.isInteger(b) && b >= 0 && b <= 255 && (b & 0x93) === 0x12;
}

/**
 * Una banda GS v 0: GS v 0 m=0 xL xH yL yH seguita dalle righe [fromRow, fromRow + rows) di [img].
 * x = byte per riga, y = righe della banda, entrambi little-endian.
 */
export function rasterBand(img, fromRow, rows) {
  if (!(fromRow >= 0 && rows > 0 && fromRow + rows <= img.height)) {
    throw new RangeError(`banda fuori range: righe ${fromRow}+${rows} su ${img.height}`);
  }
  if (!(rows <= 0xffff && img.bytesPerRow <= 0xffff)) throw new RangeError('banda troppo grande');
  const bpr = img.bytesPerRow;
  const out = new Uint8Array(HEADER_SIZE + bpr * rows);
  out[0] = 0x1d;
  out[1] = 0x76;
  out[2] = 0x30;
  out[3] = 0x00;
  out[4] = bpr & 0xff;
  out[5] = (bpr >> 8) & 0xff;
  out[6] = rows & 0xff;
  out[7] = (rows >> 8) & 0xff;
  out.set(img.data.subarray(fromRow * bpr, (fromRow + rows) * bpr), HEADER_SIZE);
  return out;
}

/**
 * Pacchetti in ordine di invio, come ThermalJob.build:
 * 1. ESC @ (+ ESC 7 se options.heat non è null);
 * 2. una banda GS v 0 per pacchetto, di options.bandHeight righe (1..255; l'ultima può essere più corta);
 * 3. ESC d options.feedLinesAfter (+ GS V 66 0, taglio parziale, se options.cut).
 * Un pacchetto per banda permette di misurare l'avanzamento; ogni comando sta in un pacchetto.
 */
export function buildThermalJob(img, options) {
  const o = jobOptionsWithDefaults(options);
  const packets = [];

  const head = new EscPosBuilder().init();
  if (o.heat != null) head.heat(o.heat);
  packets.push(head.bytes());

  const band = byteArg(o.bandHeight, 1, 255, 24);
  let row = 0;
  while (row < img.height) {
    const rows = Math.min(band, img.height - row);
    packets.push(rasterBand(img, row, rows));
    row += rows;
  }

  const tail = new EscPosBuilder().feed(o.feedLinesAfter);
  if (o.cut) tail.cut(true);
  packets.push(tail.bytes());
  return packets;
}

/** Byte totali di un lavoro: per la percentuale e per l'attesa di svuotamento del buffer. */
export function totalBytes(packets) {
  let n = 0;
  for (const p of packets) n += p.length;
  return n;
}

/** Tutti i pacchetti in un unico Uint8Array, nello stesso ordine. */
export function concatPackets(packets) {
  const out = new Uint8Array(totalBytes(packets));
  let at = 0;
  for (const p of packets) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Risincronizzazione dopo una banda GS v 0 interrotta di [bytesPerRow] byte per riga e [bandHeight]
 * righe (1..255): tanti NUL quanti ne servono a chiudere anche una banda appena cominciata. Dentro
 * il comando aperto diventano righe bianche; fuori da un comando le stampanti ignorano lo 0x00.
 */
export function resync(bytesPerRow, bandHeight) {
  const bpr = Math.max(1, intArg(bytesPerRow, 1));
  return new Uint8Array(HEADER_SIZE + bpr * byteArg(bandHeight, 1, 255, 24));
}

/**
 * Risincronizzazione dimensionata sul lavoro INTERROTTO: NUL lunghi quanto il pacchetto più grande.
 * Va inviata una volta sola, prima del lavoro successivo, e solo dopo un invio interrotto.
 * Lista vuota = array vuoto.
 */
export function resyncFor(packets) {
  let max = 0;
  for (const p of packets) if (p.length > max) max = p.length;
  return new Uint8Array(max);
}

/** Namespace come gli object Kotlin. */
export const EscPosRaster = Object.freeze({ HEADER_SIZE, band: rasterBand });
export const ThermalJob = Object.freeze({ build: buildThermalJob, totalBytes, resync, resyncFor });
