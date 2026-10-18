// Driver Phomemo (phomemo-m02, phomemo-m02pro): un solo codificatore, parametrizzato con la
// larghezza della riga, come PhomemoEncoder in Kotlin. Protocollo ricostruito dal reverse
// engineering (nessuna documentazione ufficiale): ryo-endo/phomemo-printer (M02 Pro via BLE),
// vivier/phomemo-tools (M02), theacodes/phomemo_m02s (M02S a 300 dpi), phomymo (Web Bluetooth).
//
// Sequenza del lavoro (docs/DRIVERS.md), UN PACCHETTO PER COMANDO, nell'ordine di invio:
//   1B 40                      ESC @, inizializza
//   1B 61 01                   allineamento al centro
//   1F 11 02 dd                densità 1..15 (da heatLevel 0→4, 1→2, 2→4, 3→6, 4→8, o da options.density)
//   1B 4E 0D ss                velocità, SOLO se options.speed != null (comando M110, non verificato)
//   1D 76 30 00 wL wH hh 00    + hh × w byte: un blocco raster per ogni gruppo di ≤ 255 righe
//                              (w = 72 byte sulla M02 Pro, 78 in opzione, 48 sulla M02; righe MSB-first, 1 = nero)
//   1B 64 nn                   avanzamento di feedLines righe
//   1B 64 02                   avanzamento finale fisso, come l'app ufficiale
//   1F 11 08 | 1F 11 0E | 1F 11 07 | 1F 11 09   chiusura: interrogazioni di stato (energia, timer, firmware, batteria)
// I vettori di web/tests/fixtures/drivers-golden.json fissano questi byte e questa divisione in pacchetti.

import { centeredOn } from '../../core/bitimage.js';
import { rasterBand } from '../../core/escpos.js';
import { normalizeOptions, rasterTestPage, technicalHead, classifyName } from './escpos.js';

/** Servizio GATT delle Phomemo: scrittura su FF02, notifiche (stato) su FF03. */
export const PHOMEMO_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
export const PHOMEMO_WRITE = '0000ff02-0000-1000-8000-00805f9b34fb';
export const PHOMEMO_NOTIFY = '0000ff03-0000-1000-8000-00805f9b34fb';

export const PHOMEMO_BLE_PROFILES = Object.freeze([
  Object.freeze({ name: 'FF00', service: PHOMEMO_SERVICE, write: PHOMEMO_WRITE, notify: PHOMEMO_NOTIFY }),
]);

/** Righe massime di un blocco GS v 0 (l'altezza sta in un byte). */
export const PHOMEMO_MAX_BLOCK_ROWS = 255;

/** Densità predefinita e tabella heatLevel (0..4) → densità (1..15). */
export const PHOMEMO_DEFAULT_DENSITY = 4;
export const DENSITY_BY_HEAT = Object.freeze([4, 2, 4, 6, 8]);

/** Larghezze della riga ammesse sulla M02 Pro: 72 byte (576 punti) o 78 (624 punti, alcune unità). */
export const M02PRO_WIDTH_BYTES = Object.freeze([72, 78]);

/**
 * Trasporto predefinito: senza conferma, 20 byte con 15 ms di pausa. Web Bluetooth non dice
 * l'MTU, e con l'MTU minimo il carico utile di una scrittura senza conferma è 20 byte.
 */
export const PHOMEMO_TRANSPORT = Object.freeze({
  chunkSize: 20,
  chunkDelayMs: 15,
  withoutResponse: true,
  finalDelayMs: 300,
});

/** Densità del lavoro: options.density (1..15) se c'è, altrimenti dalla tabella di heatLevel. */
export function phomemoDensity(options) {
  const o = normalizeOptions(options);
  if (o.density !== null) return o.density;
  const level = Math.min(4, Math.max(0, o.heatLevel));
  return DENSITY_BY_HEAT[level];
}

/**
 * Pacchetti Phomemo per [image] con righe da [widthBytes] byte: l'immagine viene centrata (o
 * ritagliata al centro) su widthBytes × 8 punti. → Uint8Array[]
 */
export function encodePhomemo(image, options, widthBytes) {
  const o = normalizeOptions(options);
  const fitted = centeredOn(image, widthBytes * 8);
  const packets = [
    Uint8Array.of(0x1b, 0x40),
    Uint8Array.of(0x1b, 0x61, 0x01),
    Uint8Array.of(0x1f, 0x11, 0x02, phomemoDensity(o)),
  ];
  if (o.speed !== null) packets.push(Uint8Array.of(0x1b, 0x4e, 0x0d, o.speed));
  for (let row = 0; row < fitted.height; row += PHOMEMO_MAX_BLOCK_ROWS) {
    packets.push(rasterBand(fitted, row, Math.min(PHOMEMO_MAX_BLOCK_ROWS, fitted.height - row)));
  }
  packets.push(Uint8Array.of(0x1b, 0x64, o.feedLines));
  packets.push(Uint8Array.of(0x1b, 0x64, 0x02));
  packets.push(Uint8Array.of(0x1f, 0x11, 0x08));
  packets.push(Uint8Array.of(0x1f, 0x11, 0x0e));
  packets.push(Uint8Array.of(0x1f, 0x11, 0x07));
  packets.push(Uint8Array.of(0x1f, 0x11, 0x09));
  return packets;
}

// ------------------------------------------------------------------ nomi annunciati

// Le regole (e l'ordine: M02X, poi M02 Pro / M02S, poi la M02 liscia) stanno in classifyName di
// drivers/escpos.js, le stesse di DriverNames in Drivers.kt.

/** La Phomemo M02X usa un protocollo diverso e incompatibile: si riconosce per avvisare. */
export function isM02X(name) {
  return classifyName(name) === 'unsupported';
}

/** "M02 Pro", "M02PRO", "M02S" (anche con spazi e minuscole), mai la M02X. */
export function matchesM02Pro(name) {
  return classifyName(name) === 'phomemo-m02pro';
}

/** "M02" da solo o seguito da cifre o spazi; mai S, X o Pro. */
export function matchesM02(name) {
  return classifyName(name) === 'phomemo-m02';
}

// ------------------------------------------------------------------ driver

function makePhomemoDriver({ id, displayName, paper, dots, dpi, widths, matches }) {
  // Larghezza della riga del lavoro: la M02 ne ha una sola, la M02 Pro accetta 72 o 78.
  const widthBytesOf = (options) => {
    const o = normalizeOptions(options);
    return widths.includes(o.widthBytes) ? o.widthBytes : widths[0];
  };
  const driver = {
    id,
    displayName,
    family: 'phomemo',
    paper,
    dots,
    dpi,
    links: Object.freeze(['BLE']),
    bleProfiles: PHOMEMO_BLE_PROFILES,
    defaultDither: 'FLOYD_STEINBERG',
    defaultTransport: PHOMEMO_TRANSPORT,
    widthOptions: Object.freeze(widths.slice()),

    matchesName(name) {
      return matches(name);
    },

    /** Geometria del raster: punti e byte per riga del lavoro, righe per blocco. */
    rasterShape(options) {
      const bytesPerRow = widthBytesOf(options);
      return { dots: bytesPerRow * 8, bytesPerRow, bandRows: PHOMEMO_MAX_BLOCK_ROWS };
    },

    encode(image, options) {
      return encodePhomemo(image, options, widthBytesOf(options));
    },

    /** Byte per riga del lavoro: 48 sulla M02; 72 o 78 (options.widthBytes) sulla M02 Pro. */
    widthBytesFor(options) {
      return widthBytesOf(options);
    },

    /**
     * Righe tecniche della pagina di prova, come DriverTestPage.technicalLines: id, punti/dpi/mm,
     * densità e velocità, byte per riga e avanzamento. Ognuna sta in 30 caratteri.
     */
    technicalLines(options) {
      const o = normalizeOptions(options);
      const widthBytes = widthBytesOf(o);
      return technicalHead(driver, widthBytes * 8).concat([
        `DENSITY ${phomemoDensity(o)}/15, SPEED ${o.speed === null ? 'OFF' : o.speed}`,
        `ROW ${widthBytes} B, FEED ${o.feedLines}`,
      ]);
    },

    /**
     * Pagina di prova raster (la M02 Pro non ha font ESC/POS affidabili), larga quanto il lavoro
     * (624 punti con 78 byte per riga): vedi rasterTestPage.
     */
    testPage(options) {
      const width = widthBytesOf(options) * 8;
      return driver.encode(rasterTestPage(driver, options, width, driver.technicalLines(options)), options);
    },
  };
  return Object.freeze(driver);
}

/** Phomemo M02 (non Pro): 384 punti = 48 byte a 203 dpi, stessa impaginazione della 58 mm. */
export const phomemoM02 = makePhomemoDriver({
  id: 'phomemo-m02', displayName: 'Phomemo M02', paper: 'MM58', dots: 384, dpi: 203, widths: [48], matches: matchesM02,
});

/** Phomemo M02 Pro (anche M02S): 576 punti = 72 byte a 300 dpi, opzione 78 byte. */
export const phomemoM02Pro = makePhomemoDriver({
  id: 'phomemo-m02pro', displayName: 'Phomemo M02 Pro', paper: 'M02PRO', dots: 576, dpi: 300, widths: [72, 78], matches: matchesM02Pro,
});
