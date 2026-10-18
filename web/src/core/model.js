// Tipi condivisi del motore di stampa termica: porting di Model.kt (:core-thermal).
// Gli enum Kotlin diventano stringhe con lo stesso nome; i data class diventano oggetti semplici
// con gli stessi campi, e le funzioni default*() ne danno i valori di fabbrica.

/**
 * Larghezza della carta, punti stampabili per riga e risoluzione della testina, come l'enum
 * PaperWidth di Model.kt. M02PRO (Phomemo M02 Pro / M02S) ha 576 punti a 300 dpi = 48,8 mm, quasi
 * quanto i 384 punti a 203 dpi della 58 mm: l'impaginazione in punti esce fisicamente uguale
 * (docs/DRIVERS.md). L'ordine conta: a parità di punti paperOf() sceglie la prima (MM80).
 */
export const PaperWidth = Object.freeze({
  MM58: Object.freeze({ mm: 58, dots: 384, dpi: 203 }),
  MM80: Object.freeze({ mm: 80, dots: 576, dpi: 203 }),
  M02PRO: Object.freeze({ mm: 53, dots: 576, dpi: 300 }),
});

/** Algoritmi di retinatura, nell'ordine dell'enum Kotlin (il primo è il default). */
export const DitherAlgorithm = Object.freeze(['ATKINSON', 'FLOYD_STEINBERG', 'ORDERED_BAYER', 'THRESHOLD']);

/** Modelli di stampa. */
export const TemplateKind = Object.freeze(['POLAROID', 'FULL', 'STRIP', 'RECEIPT']);

/** Allineamento dei testi. */
export const TextAlign = Object.freeze(['START', 'CENTER', 'END']);

/** Famiglia di carattere: DISPLAY = Righteous, MONO = Space Mono, MONO_BOLD = Space Mono grassetto. */
export const FontRole = Object.freeze(['DISPLAY', 'MONO', 'MONO_BOLD']);

/** Ruolo di un blocco di testo nell'impaginazione. */
export const TextRole = Object.freeze(['EVENT_TITLE', 'CAPTION', 'HASHTAG', 'DATE', 'PRINT_NUMBER', 'BRAND', 'FOOTER']);

/** Tipi di decorazione (Decoration.DashedLine / Frame / Zigzag). */
export const DecorationType = Object.freeze({ DASHED: 'dashed', FRAME: 'frame', ZIGZAG: 'zigzag' });

/** ToneAdjustments di fabbrica: aprono le ombre e schiariscono i medi, la carta impasta gli scuri. */
export function defaultTone() {
  return {
    brightness: 0,
    contrast: 0.15,
    gamma: 1.25,
    autoLevels: true,
    sharpen: 0.5,
    shadows: 0.25,
    localContrast: 0.35,
    autoBacklight: true,
  };
}

/** PrintJobOptions di fabbrica. */
export function defaultJobOptions() {
  return { bandHeight: 24, feedLinesAfter: 4, cut: false, heat: null };
}

/** HeatSettings di fabbrica (ESC 7 n1 n2 n3). */
export function defaultHeat() {
  return { maxDots: 7, heatTime: 80, heatInterval: 2 };
}

/** TemplateTexts vuoti: le stringhe vuote e i null non occupano spazio. */
export function defaultTexts() {
  return { caption: '', eventTitle: '', hashtag: '', dateText: null, printNumber: null };
}

// I campi mancanti (undefined o null) prendono il valore di fabbrica, come i parametri di default
// dei data class Kotlin; i valori presenti passano invariati (li riportano nel range gli algoritmi).
function withDefaults(defaults, value) {
  const out = defaults;
  if (value && typeof value === 'object') {
    for (const key of Object.keys(out)) {
      const v = value[key];
      if (v !== undefined && v !== null) out[key] = v;
    }
  }
  return out;
}

/** Regolazioni complete: i campi assenti valgono come in defaultTone(). */
export function toneWithDefaults(adj) {
  return withDefaults(defaultTone(), adj);
}

/** Opzioni di stampa complete; `heat` resta null se non c'è (= default della stampante). */
export function jobOptionsWithDefaults(options) {
  const out = withDefaults(defaultJobOptions(), options);
  out.heat = options && options.heat ? withDefaults(defaultHeat(), options.heat) : null;
  return out;
}

/** Testi completi: stringhe assenti = "", data e numero assenti = null. */
export function textsWithDefaults(texts) {
  return withDefaults(defaultTexts(), texts);
}

/**
 * Carta da 'MM58' | 'MM80' | 'M02PRO' (o da un oggetto PaperWidth): restituisce { name, mm, dots, dpi }.
 * Una carta sconosciuta è un errore di programmazione e va segnalata subito.
 */
export function paperOf(paper) {
  if (typeof paper === 'string' && Object.prototype.hasOwnProperty.call(PaperWidth, paper)) {
    return { name: paper, ...PaperWidth[paper] };
  }
  if (paper && typeof paper === 'object') {
    for (const name of Object.keys(PaperWidth)) {
      if (PaperWidth[name].dots === paper.dots) return { name, ...PaperWidth[name] };
    }
  }
  throw new RangeError(`carta sconosciuta: ${String(paper && paper.dots !== undefined ? paper.dots : paper)}`);
}

/** Rettangolo in punti di stampa; right e bottom sono derivati, come in Kotlin. */
export class Rect {
  constructor(left, top, width, height) {
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
  }

  get right() {
    return this.left + this.width;
  }

  get bottom() {
    return this.top + this.height;
  }
}

/** Decoration.DashedLine: y è la prima riga del tratto. */
export function dashedLine({ y, from, to, dash = 6, gap = 4, thickness = 2 }) {
  return { type: DecorationType.DASHED, y, from, to, dash, gap, thickness };
}

/** Decoration.Frame: cornice nera attorno a un'area. */
export function frameDecoration(rect, thickness = 2) {
  return { type: DecorationType.FRAME, rect, thickness };
}

/** Decoration.Zigzag: bordo a dente di sega lungo la riga y. */
export function zigzagDecoration(y, tooth = 8) {
  return { type: DecorationType.ZIGZAG, y, tooth };
}

// ---------------------------------------------------------------- aritmetica alla Kotlin

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/**
 * Double.roundToInt() di Kotlin: Math.round di Java (pareggi verso +infinito, come Math.round di JS),
 * saturato sull'intervallo degli Int; NaN è un errore come in Kotlin.
 */
export function roundToInt(x) {
  if (Number.isNaN(x)) throw new RangeError('Cannot round NaN value.');
  if (x >= INT_MAX) return INT_MAX;
  if (x <= INT_MIN) return INT_MIN;
  return Math.round(x) + 0; // + 0: niente -0
}

/** coerceIn di Kotlin: con un NaN in ingresso restituisce NaN, come per i Float. */
export function coerceIn(v, min, max) {
  if (min > max) throw new RangeError(`intervallo vuoto: ${min}..${max}`);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Parametro intero (Int in Kotlin) che arriva da JavaScript: troncato verso lo zero;
 * NaN o non numerico prende [fallback]. Gli infiniti restano tali e li riporta nel range il chiamante.
 */
export function intArg(v, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n) || v === null || v === undefined || v === '') return fallback;
  return Math.trunc(n) + 0;
}
