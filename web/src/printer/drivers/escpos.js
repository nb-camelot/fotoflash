// Driver ESC/POS (escpos-58, escpos-80): il lavoro di sempre, ThermalJob.build (core/escpos.js),
// dietro l'interfaccia comune dei driver (docs/DRIVERS.md). Qui stanno anche le parti che gli
// altri driver riusano senza import circolari: opzioni normalizzate, tabella dell'intensità,
// riconoscimento dal nome (classifyName) e pagina di prova raster.

import { buildThermalJob } from '../../core/escpos.js';
import { centeredOn } from '../../core/bitimage.js';
import { testPageImage } from '../../core/bitmapfont.js';
import { BRAND_TEXT } from '../../core/template.js';

// ------------------------------------------------------------------ opzioni comuni

/** DriverOptions di fabbrica, come la data class Kotlin (più le opzioni Phomemo, null = predefinite). */
export const DEFAULT_DRIVER_OPTIONS = Object.freeze({
  feedLines: 4,
  cut: false,
  heatLevel: 0,
  bandHeight: 24,
  speed: null,
  widthBytes: null,
  density: null,
});

function intOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function intOrNull(value, min, max) {
  const n = intOr(value, null);
  return n === null ? null : Math.min(max, Math.max(min, n));
}

/**
 * Opzioni del lavoro complete e sane. I limiti sono quelli dei comandi (un byte), non quelli
 * delle impostazioni: li applica chi le costruisce (PrinterManager con PrinterTuning).
 */
export function normalizeOptions(options) {
  const o = options && typeof options === 'object' ? options : {};
  return {
    feedLines: Math.min(255, Math.max(0, intOr(o.feedLines, DEFAULT_DRIVER_OPTIONS.feedLines))),
    cut: o.cut === true,
    heatLevel: intOr(o.heatLevel, DEFAULT_DRIVER_OPTIONS.heatLevel),
    bandHeight: Math.min(255, Math.max(1, intOr(o.bandHeight, DEFAULT_DRIVER_OPTIONS.bandHeight))),
    speed: intOrNull(o.speed, 0, 255),
    widthBytes: intOrNull(o.widthBytes, 1, 255),
    // densityOverride è il nome Kotlin (DriverOptions): stessi vettori, stesso significato.
    density: intOrNull(o.density ?? o.densityOverride, 1, 15),
  };
}

/**
 * Livello di intensità 0..4 → ESC 7 (stessa tabella di PrinterTuning.kt). 0 = non inviare nulla
 * e lasciare il default della stampante; fuori range viene riportato in 0..4.
 */
export function heatFor(level) {
  const l = Math.min(4, Math.max(0, intOr(level, 0)));
  switch (l) {
    case 1: return { maxDots: 7, heatTime: 60, heatInterval: 2 };
    case 2: return { maxDots: 8, heatTime: 80, heatInterval: 2 };
    case 3: return { maxDots: 10, heatTime: 110, heatInterval: 2 };
    case 4: return { maxDots: 11, heatTime: 140, heatInterval: 2 };
    default: return null;
  }
}

function textList(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [];
}

/**
 * Pagina di prova raster comune ai driver (docs/DRIVERS.md): "FOTOFLASH" a raster, le righe
 * tecniche del driver (parametri correnti), i testi del chiamante, il controllo della larghezza,
 * una sfumatura per retino, la scala di grigi e il controllo dei neri. I testi arrivano già
 * tradotti in options (subtitle, lines, widthCheck, ditherTitle, ditherLabels, currentDither,
 * footer: vedi rasterTestPageTexts in testpage.js); senza, restano le sole sigle tecniche.
 * → BitImage larga [width] punti
 */
export function rasterTestPage(driver, options, width, technical) {
  const o = options && typeof options === 'object' ? options : {};
  return testPageImage({
    width,
    dpi: driver.dpi,
    title: BRAND_TEXT,
    subtitle: typeof o.subtitle === 'string' ? o.subtitle : '',
    technical: textList(technical),
    lines: textList(o.lines),
    widthCheck: typeof o.widthCheck === 'string' ? o.widthCheck : '',
    ditherTitle: typeof o.ditherTitle === 'string' ? o.ditherTitle : '',
    ditherLabels: o.ditherLabels && typeof o.ditherLabels === 'object' ? o.ditherLabels : null,
    currentDither: o.currentDither || driver.defaultDither,
    footer: textList(o.footer),
  });
}

// ------------------------------------------------------------------ BLE e nomi

/**
 * Canali seriali BLE delle stampanti ESC/POS, nell'ordine in cui si provano (quelli del bridge
 * raw-bt-print-bridge): 18F0/2AF1 è il canale verificato sulle Netum e sulle "BlueTooth Printer".
 */
export const ESCPOS_BLE_PROFILES = Object.freeze([
  { name: '18F0', service: '000018f0-0000-1000-8000-00805f9b34fb', write: '00002af1-0000-1000-8000-00805f9b34fb' },
  { name: 'E7810A71', service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', write: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
  { name: 'ISSC', service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', write: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  { name: 'FF00', service: '0000ff00-0000-1000-8000-00805f9b34fb', write: '0000ff02-0000-1000-8000-00805f9b34fb' },
  { name: 'FFE0', service: '0000ffe0-0000-1000-8000-00805f9b34fb', write: '0000ffe1-0000-1000-8000-00805f9b34fb' },
  { name: 'Nordic UART', service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' },
].map((p) => Object.freeze(p)));

/** Nomi annunciati tipici delle stampanti ESC/POS economiche: uno esatto e alcuni prefissi. */
export const ESCPOS_NAMES = Object.freeze(['BlueTooth Printer']);
export const ESCPOS_NAME_PREFIXES = Object.freeze(['Printer', 'MPT', 'NT-', 'Netum', 'POS', 'MTP']);

/**
 * Il nome annunciato è quello di una stampante ESC/POS tipica? Confronto senza maiuscole e spazi
 * ai bordi: i firmware scrivono lo stesso modello in modi diversi ("BlueTooth Printer", "Bluetooth printer").
 * Solo la forma del nome: per il driver vale classifyName, dove i modelli Phomemo vincono.
 */
export function matchesEscposName(name) {
  if (typeof name !== 'string') return false;
  const n = name.trim().toUpperCase();
  if (n === '') return false;
  if (ESCPOS_NAMES.some((x) => x.toUpperCase() === n)) return true;
  return ESCPOS_NAME_PREFIXES.some((p) => n.startsWith(p.toUpperCase()));
}

// Modelli Phomemo cercati come parola: "M02" all'inizio o dopo un separatore ("Mr.in_M02"), mai
// coda di un'altra sigla ("XM02"). Stesse espressioni di DriverNames in Drivers.kt, con lo spazio
// di Java: il \s di Java è solo [ \t\n\x0B\f\r], quello di JS comprende anche gli spazi Unicode
// (es. U+00A0) e farebbe riconoscere nomi che l'app scarta.
const M02X_RE = /(?:^|[^A-Z0-9])M02[ \t\n\x0B\f\r]*X/;
const M02PRO_RE = /(?:^|[^A-Z0-9])M02[ \t\n\x0B\f\r]*(?:PRO|S)(?![A-Z])/;
const M02_RE = /(?:^|[^A-Z0-9])M02(?=[ \t\n\x0B\f\r\d]|$)/;

/**
 * Famiglia riconosciuta dal nome annunciato, con le regole di DriverNames.classify (Kotlin), in
 * quest'ordine: 'unsupported' (M02X, protocollo diverso), 'phomemo-m02pro' (M02 Pro, M02PRO,
 * M02S), 'phomemo-m02' (M02 da solo o seguito da cifre/spazi), 'escpos' (nomi ESC/POS tipici),
 * altrimenti null. I Phomemo vengono prima, così "Printer M02" non finisce tra le ESC/POS.
 * Qui e non in phomemo.js perché anche i driver ESC/POS ne hanno bisogno, senza import circolari.
 */
export function classifyName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toUpperCase();
  if (n === '') return null;
  if (M02X_RE.test(n)) return 'unsupported';
  if (M02PRO_RE.test(n)) return 'phomemo-m02pro';
  if (M02_RE.test(n)) return 'phomemo-m02';
  if (matchesEscposName(n)) return 'escpos';
  return null;
}

// ------------------------------------------------------------------ righe tecniche

/** Punti → millimetri con un decimale, senza Locale (come DriverTestPage.technicalLines): "48.8". */
function mmText(dots, dpi) {
  const tenths = Math.trunc((dots * 254 + Math.trunc(dpi / 2)) / dpi);
  return `${Math.trunc(tenths / 10)}.${tenths % 10}`;
}

/**
 * Prime due righe tecniche della pagina di prova, uguali a quelle dell'app: id del driver, poi
 * punti, dpi e larghezza stampata ("576 DOTS, 300 DPI, 48.8 MM"). Sigle tecniche, non tradotte.
 */
export function technicalHead(driver, dots) {
  return [driver.id, `${dots} DOTS, ${driver.dpi} DPI, ${mmText(dots, driver.dpi)} MM`];
}

// ------------------------------------------------------------------ driver

/**
 * Trasporto predefinito sul web: la strategia automatica del bridge, provata sulla stampante vera
 * (con conferma a pezzi da 100 byte, che scende a 20 se la stampante li rifiuta). auto = true dice
 * a PrinterManager di lasciarla a ble.js finché l'utente non sceglie valori suoi.
 */
export const ESCPOS_TRANSPORT = Object.freeze({
  chunkSize: 100,
  chunkDelayMs: 0,
  withoutResponse: false,
  finalDelayMs: 300,
  auto: true,
});

function makeEscposDriver({ id, displayName, paper, dots }) {
  const driver = {
    id,
    displayName,
    family: 'escpos',
    paper,
    dots,
    dpi: 203,
    links: Object.freeze(['CLASSIC', 'BLE']),
    bleProfiles: ESCPOS_BLE_PROFILES,
    defaultDither: 'ATKINSON',
    defaultTransport: ESCPOS_TRANSPORT,

    /** Riconoscimento dal nome: le 58 mm tipiche (la 80 mm non si distingue dal nome). */
    matchesName(name) {
      return id === 'escpos-58' && classifyName(name) === 'escpos';
    },

    /** Geometria del raster: punti e byte per riga, righe per banda GS v 0. */
    rasterShape(options) {
      const o = normalizeOptions(options);
      return { dots, bytesPerRow: Math.ceil(dots / 8), bandRows: o.bandHeight };
    },

    /**
     * Pacchetti in ordine di invio, come ThermalJob.build: [ESC @ (+ ESC 7)], una banda GS v 0 per
     * pacchetto, [ESC d n (+ GS V 66 0)]. L'immagine viene centrata o ritagliata sui punti della carta.
     */
    encode(image, options) {
      const o = normalizeOptions(options);
      return buildThermalJob(centeredOn(image, dots), {
        bandHeight: o.bandHeight,
        feedLinesAfter: o.feedLines,
        cut: o.cut,
        heat: heatFor(o.heatLevel),
      });
    },

    /**
     * Righe tecniche della pagina di prova, come DriverTestPage.technicalLines: id, punti/dpi/mm,
     * intensità e banda, avanzamento e taglio. Ognuna sta in 30 caratteri.
     */
    technicalLines(options) {
      const o = normalizeOptions(options);
      const heat = Math.min(4, Math.max(0, o.heatLevel));
      return technicalHead(driver, dots).concat([
        `HEAT ${heat}/4, BAND ${o.bandHeight}`,
        `FEED ${o.feedLines}, CUT ${o.cut ? 'ON' : 'OFF'}`,
      ]);
    },

    /** Pagina di prova raster (sul web PrinterManager usa quella testuale di testpage.js). */
    testPage(options) {
      return driver.encode(rasterTestPage(driver, options, dots, driver.technicalLines(options)), options);
    },
  };
  return Object.freeze(driver);
}

/** ESC/POS 58 mm: 384 punti a 203 dpi (la "BlueTooth Printer", le Netum). */
export const escpos58 = makeEscposDriver({ id: 'escpos-58', displayName: 'ESC/POS 58 mm', paper: 'MM58', dots: 384 });

/** ESC/POS 80 mm: 576 punti a 203 dpi. */
export const escpos80 = makeEscposDriver({ id: 'escpos-80', displayName: 'ESC/POS 80 mm', paper: 'MM80', dots: 576 });
