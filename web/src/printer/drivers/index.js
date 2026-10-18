// Driver di stampa intercambiabili (docs/DRIVERS.md): stessi id, stessi byte e stesse regole di
// riconoscimento dei driver Kotlin di core-thermal. Il resto dell'app non sa con quale stampante
// sta parlando: chiede al driver i byte (encode) e i parametri di trasporto (defaultTransport).
//
// driver = { id, displayName, family: 'escpos'|'phomemo', paper: 'MM58'|'MM80'|'M02PRO', dots, dpi,
//            links, bleProfiles, defaultDither, defaultTransport: { chunkSize, chunkDelayMs,
//            withoutResponse, finalDelayMs, auto? }, matchesName(name), rasterShape(options),
//            technicalLines(options), encode(bitImage, options) → Uint8Array[],
//            testPage(options) → Uint8Array[] }   (Phomemo anche widthOptions e widthBytesFor(options))
// options (DriverOptions): { feedLines = 4, cut = false, heatLevel = 0, bandHeight = 24, speed = null,
//            widthBytes = null (Phomemo M02 Pro: 72 | 78), density = null (Phomemo: 1..15; in Kotlin
//            densityOverride) }; testPage accetta in più i testi di rasterTestPageTexts (testpage.js).

import { escpos58, escpos80, ESCPOS_BLE_PROFILES, DEFAULT_DRIVER_OPTIONS, normalizeOptions, classifyName } from './escpos.js';
import { phomemoM02, phomemoM02Pro, PHOMEMO_BLE_PROFILES } from './phomemo.js';
import { GrayImage } from '../../core/gray.js';
import { centeredOn } from '../../core/bitimage.js';
import { dither as ditherImage } from '../../core/dither.js';

export { escpos58, escpos80, phomemoM02, phomemoM02Pro, DEFAULT_DRIVER_OPTIONS, normalizeOptions, classifyName };

/** Tutti i driver, in ordine di presentazione. */
export const drivers = Object.freeze([escpos58, escpos80, phomemoM02, phomemoM02Pro]);

/** Driver predefinito (e ripiego per un id sconosciuto). */
export const DEFAULT_DRIVER_ID = 'escpos-58';

export const DRIVER_IDS = Object.freeze(drivers.map((d) => d.id));

/** Driver con questo id (spazi ai bordi ignorati); id sconosciuto o null → escpos-58. */
export function driverById(id) {
  const key = typeof id === 'string' ? id.trim() : id;
  return drivers.find((d) => d.id === key) || escpos58;
}

/**
 * Driver suggerito dal nome annunciato dalla stampante, con le regole di PrinterDrivers.guess
 * (classifyName): M02 Pro / M02PRO / M02S → phomemo-m02pro; M02 (seguito solo da cifre o spazi)
 * → phomemo-m02; M02X → null (protocollo diverso, vedi unsupportedModel); nomi ESC/POS tipici
 * ("BlueTooth Printer", "Printer…", "MPT…", "NT-…", "Netum…", "POS…", "MTP…") → escpos-58 (dal
 * nome non si capisce la larghezza); altrimenti null. Maiuscole e spazi ai bordi non contano.
 */
export function guessDriver(name) {
  switch (classifyName(name)) {
    case 'phomemo-m02pro': return phomemoM02Pro;
    case 'phomemo-m02': return phomemoM02;
    case 'escpos': return escpos58;
    default: return null;
  }
}

/** Modello riconosciuto ma non supportato ('phomemo-m02x'), altrimenti null: la UI lo dice. */
export function unsupportedModel(name) {
  return classifyName(name) === 'unsupported' ? 'phomemo-m02x' : null;
}

/** Driver che stampa sulla carta [paper], restando su [currentId] se va già bene. */
export function driverForPaper(paper, currentId = DEFAULT_DRIVER_ID) {
  const current = driverById(currentId);
  if (current.paper === paper) return current;
  return drivers.find((d) => d.family === 'escpos' && d.paper === paper) ||
    drivers.find((d) => d.paper === paper) || current;
}

/** Profili BLE di tutti i driver senza doppioni (stesso servizio e stessa scrittura), ESC/POS prima. */
export function allBleProfiles() {
  const out = [];
  for (const p of ESCPOS_BLE_PROFILES.concat(PHOMEMO_BLE_PROFILES)) {
    if (!out.some((q) => q.service === p.service && q.write === p.write)) out.push(p);
  }
  return out;
}

/**
 * Ingresso generico da un'immagine in grigi (come encodeGray in Kotlin): retino del driver (o
 * [algorithm]), centratura sui punti del lavoro, encode. → Uint8Array[]
 */
export function encodeGray(driver, gray, options, algorithm = driver.defaultDither) {
  const bits = ditherImage(gray, algorithm);
  return driver.encode(centeredOn(bits, driver.rasterShape(options).dots), options);
}

/**
 * Ingresso comune da canvas (OffscreenCanvas o HTMLCanvasElement, 1 px = 1 punto):
 * pixel RGBA → GrayImage.fromRgba → retino del driver → BitImage → centeredOn → encode.
 * → Uint8Array[]
 */
export function encodeCanvas(driver, canvas, options, algorithm = driver.defaultDither) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas without a 2D context');
  const { data } = ctx.getImageData(0, 0, width, height);
  return encodeGray(driver, GrayImage.fromRgba(width, height, data), options, algorithm);
}
