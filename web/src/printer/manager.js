// L'unico punto che stampa, come PrinterManager su Android: stato osservabile, un lavoro alla
// volta (chi arriva mentre si stampa riceve subito BUSY, niente code nascoste), collegamento
// tenuto aperto tra stampe vicine e chiuso dopo 45 s di inattivita, errori tradotti in failure
// con un messaggio per l'utente (message) e la causa tecnica (detail).
// La stampante ricordata non viene mai dimenticata da sola: solo forget() la toglie.
//
// Driver (docs/DRIVERS.md): il lavoro lo codifica il driver di settings.printerDriver (encode) e
// lo spedisce Ble.print con il trasporto del driver, sovrascritto da bleChunkSize/bleChunkDelayMs/
// bleWithoutResponse; per l'ESC/POS senza valori dell'utente resta la strategia automatica del
// bridge. Dopo un abbinamento guessDriver(nome) sceglie il driver, se l'utente non l'ha scelto a mano.
//
// Gesto utente: Chrome apre il chooser di Web Bluetooth solo dentro la finestra di un tocco.
// Quando serve un abbinamento, print/printTestPage/reconnect chiamano ble.pair() SUBITO, prima di
// qualsiasi await; il percorso silenzioso (reconnect di ble.js, che puo attendere l'annuncio per
// 8 s) non apre mai il chooser dopo: se fallisce, lo stato dice NO_PRINTER con action 'pair'.

import { Ble, errorCode, CONNECT_TIMEOUT_MS } from './ble.js';
import { buildTestPage, rasterTestPageTexts } from './testpage.js';
import { PaperWidth } from '../core/model.js';
import { concatPackets, resync } from '../core/escpos.js';
import { DRIVER_IDS, driverById, guessDriver, unsupportedModel } from './drivers/index.js';
import { heatFor as escposHeatFor } from './drivers/escpos.js';
import { t } from '../i18n/i18n.js';

// ------------------------------------------------------------------ taratura (PrinterTuning.kt)

function intOr(value, fallback) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(value, min, max, fallback) {
  return Math.min(max, Math.max(min, intOr(value, fallback)));
}

/**
 * Taratura della testina e del lavoro, come PrinterTuning.kt: intervalli ammessi, valori
 * consigliati, tabella dell'intensita e attesa di svuotamento del buffer.
 */
export const PrinterTuning = Object.freeze({
  HEAT_LEVEL_MIN: 0,
  HEAT_LEVEL_MAX: 4,
  HEAT_LEVEL_DEFAULT: 0,
  FEED_LINES_MIN: 0,
  FEED_LINES_MAX: 10,
  FEED_LINES_DEFAULT: 4,
  BAND_HEIGHT_MIN: 8,
  BAND_HEIGHT_MAX: 255,
  BAND_HEIGHT_DEFAULT: 24,
  BAND_HEIGHT_STEPS: Object.freeze([8, 16, 24, 32, 48, 64, 96, 128, 192, 255]),
  /** Copie per lavoro: un limite evita rotoli interi per un tocco di troppo. */
  COPIES_MAX: 10,
  /** Il collegamento resta aperto tra stampe vicine, poi si libera la stampante. */
  IDLE_DISCONNECT_MS: 45000,
  /** Velocita prudente con cui la stampante svuota il buffer (stampa + buffer Bluetooth). */
  DRAIN_BYTES_PER_SECOND: 8 * 1024,
  DRAIN_MIN_MS: 300,
  DRAIN_MAX_MS: 4000,
  /** Chiavi i18n dei livelli di intensita 0..4 (impostazioni e pagina di prova). */
  HEAT_LEVEL_KEYS: Object.freeze(['prn_heat_level_0', 'prn_heat_level_1', 'prn_heat_level_2', 'prn_heat_level_3', 'prn_heat_level_4']),
  /** Invio BLE: 20 byte = carico utile con l'MTU minimo, 512 = massimo di una scrittura GATT. */
  BLE_CHUNK_MIN: 20,
  BLE_CHUNK_MAX: 512,
  BLE_DELAY_MIN: 0,
  BLE_DELAY_MAX: 100,
  /** Phomemo: densita del comando 1F 11 02 dd. */
  PHOMEMO_DENSITY_MIN: 1,
  PHOMEMO_DENSITY_MAX: 15,
  /** Velocita sperimentale (1B 4E 0D ss, comando delle M110 non verificato sulla M02 Pro). */
  SPEED_MIN: 1,
  SPEED_MAX: 5,

  clampHeatLevel(value) { return clamp(value, 0, 4, 0); },
  clampFeedLines(value) { return clamp(value, 0, 10, 4); },
  clampBandHeight(value) { return clamp(value, 8, 255, 24); },
  clampCopies(value) { return clamp(value, 1, 10, 1); },
  clampBleChunk(value) { return clamp(value, 20, 512, 20); },
  clampBleDelay(value) { return clamp(value, 0, 100, 15); },
  clampPhomemoDensity(value) { return clamp(value, 1, 15, 4); },
  clampSpeed(value) { return clamp(value, 1, 5, 3); },

  /**
   * Livello di intensita (0..4) → ESC 7. 0 = non inviare nulla e lasciare il default della
   * stampante (alcuni cloni reagiscono male a ESC 7). Salendo cresce soprattutto il tempo di
   * riscaldamento, che e cio che scurisce i punti.
   */
  heatFor(level) {
    // Una tabella sola, quella del driver ESC/POS.
    return escposHeatFor(clamp(level, 0, 4, 0));
  },

  /** Attesa prima di chiudere dopo un lavoro di [bytes] byte: chiudere subito puo troncare la coda. */
  drainMillis(bytes) {
    const n = Number(bytes);
    if (!(n > 0)) return 300;
    return Math.min(4000, Math.max(300, Math.trunc((n * 1000) / (8 * 1024))));
  },

  /** Indice del valore di [steps] piu vicino a [value], per gli slider a gradini. */
  nearestIndex(steps, value) {
    let best = 0;
    let bestDistance = Infinity;
    steps.forEach((step, index) => {
      const distance = Math.abs(step - value);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }
});

/**
 * Driver delle impostazioni (settings.printerDriver). Impostazioni senza driver (salvate prima dei
 * driver) → quello della carta: MM80 → escpos-80, M02PRO → phomemo-m02pro, altrimenti escpos-58.
 */
export function driverFor(settings) {
  const s = settings || {};
  if (DRIVER_IDS.includes(s.printerDriver)) return driverById(s.printerDriver);
  if (s.paper === 'MM80') return driverById('escpos-80');
  if (s.paper === 'M02PRO') return driverById('phomemo-m02pro');
  return driverById('escpos-58');
}

/** Carta del driver delle impostazioni ({ mm, dots, dpi }), con 58 mm se non e valida. */
export function paperFor(settings) {
  const key = driverFor(settings).paper;
  return Object.prototype.hasOwnProperty.call(PaperWidth, key) ? PaperWidth[key] : PaperWidth.MM58;
}

/** Calibrazione BLE ai predefiniti del driver (null = TransportHints del driver o strategia automatica). */
const BLE_TUNING_DEFAULTS = Object.freeze({ bleChunkSize: null, bleChunkDelayMs: null, bleWithoutResponse: null });

function nullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * DriverOptions dalle impostazioni, con i limiti di PrinterTuning (come PrinterTuning.driverOptions
 * più densità e larghezza Phomemo). null = predefinito del driver (densità da heatLevel, 72 byte,
 * velocità non inviata).
 */
export function driverOptionsFor(settings) {
  const s = settings || {};
  const speed = nullableInt(s.printerSpeed);
  const density = nullableInt(s.phomemoDensity);
  return {
    feedLines: PrinterTuning.clampFeedLines(s.feedLines),
    cut: s.cutPaper === true,
    heatLevel: PrinterTuning.clampHeatLevel(s.heatLevel),
    bandHeight: PrinterTuning.clampBandHeight(s.bandHeight),
    speed: speed === null ? null : PrinterTuning.clampSpeed(speed),
    widthBytes: nullableInt(s.phomemoWidthBytes),
    density: density === null ? null : PrinterTuning.clampPhomemoDensity(density)
  };
}

/**
 * Trasporto BLE del lavoro per Ble.print, come PrinterTuning.bleHints: TransportHints del driver
 * sovrascritti da bleChunkSize, bleChunkDelayMs e bleWithoutResponse (nei limiti BLE di
 * PrinterTuning). null = strategia automatica di ble.js, che resta quella del driver ESC/POS
 * (provata sulla stampante vera) finché l'utente non sceglie valori suoi.
 * → { chunkSize, chunkDelayMs, withoutResponse, finalDelayMs } | null
 */
export function transportFor(settings, driver = driverFor(settings)) {
  const s = settings || {};
  const base = driver.defaultTransport;
  const chunk = nullableInt(s.bleChunkSize);
  const pause = nullableInt(s.bleChunkDelayMs);
  const noResponse = typeof s.bleWithoutResponse === 'boolean' ? s.bleWithoutResponse : null;
  if (base.auto && chunk === null && pause === null && noResponse === null) return null;
  return {
    chunkSize: PrinterTuning.clampBleChunk(chunk === null ? base.chunkSize : chunk),
    chunkDelayMs: PrinterTuning.clampBleDelay(pause === null ? base.chunkDelayMs : pause),
    withoutResponse: noResponse === null ? base.withoutResponse : noResponse,
    finalDelayMs: base.finalDelayMs
  };
}

/** Opzioni di buildThermalJob dalle impostazioni, con i limiti di PrinterTuning. */
export function jobOptionsFor(settings) {
  const s = settings || {};
  return {
    bandHeight: PrinterTuning.clampBandHeight(s.bandHeight),
    feedLinesAfter: PrinterTuning.clampFeedLines(s.feedLines),
    cut: s.cutPaper === true,
    heat: PrinterTuning.heatFor(s.heatLevel)
  };
}

/**
 * Byte di una copia del lavoro, codificati dal driver delle impostazioni (ESC/POS: ESC @ (+ ESC 7),
 * bande GS v 0, avanzamento (+ taglio); Phomemo: vedi drivers/phomemo.js). Un'immagine composta
 * per carta piu stretta viene centrata dal driver.
 */
export function buildJobBytes(bitImage, settings) {
  return concatPackets(driverFor(settings).encode(bitImage, driverOptionsFor(settings)));
}

// ------------------------------------------------------------------ errori → failure

export const FAILURES = Object.freeze(['UNSUPPORTED', 'NO_PRINTER', 'BLUETOOTH_OFF', 'CONNECT_FAILED',
  'WRITE_FAILED', 'BUSY', 'RENDER_FAILED', 'CAT_PRINTER', 'NO_CHANNEL']);

// Bluetooth spento o assente: la causa vera e questa, non "stampante irraggiungibile".
const OFF_RE = /adapter (is )?(not available|not present|off|powered off|disabled)|bluetooth (is )?(off|disabled|turned off|not available)/i;

/** Causa tecnica di un errore, non tradotta (la UI la mostra in piccolo, se vuole). */
export function technicalMessage(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  return String(e.message || e.name || e);
}

function printerName(name) {
  return name || t('prn_unknown_printer');
}

// Cosa puo fare l'utente per uscire da un errore: con NO_PRINTER serve un abbinamento (un tocco).
function actionFor(failure) {
  return failure === 'NO_PRINTER' ? 'pair' : null;
}

function result(failure, message, detail) {
  return { failure, message, detail: detail || '' };
}

/**
 * Errore di Web Bluetooth o di ble.js → { failure, message, detail }. [phase] e 'connect' finche
 * non e partito il primo pezzo del lavoro, poi 'write'; [name] e il nome della stampante.
 */
export function failureFor(e, phase = 'connect', name = null) {
  const detail = technicalMessage(e);
  const who = printerName(name);
  if (e && e.code === 'no-device') return result('NO_PRINTER', t('prn_err_no_printer'), detail);
  const writing = phase === 'write';
  switch (errorCode(e)) {
    case 'unsupported': return result('UNSUPPORTED', t('prn_err_unsupported'), detail);
    case 'cat-printer': return result('CAT_PRINTER', t('prn_err_cat_printer'), detail);
    case 'no-channel': return result('NO_CHANNEL', t('prn_err_no_channel'), detail);
    // Chooser annullato o aperto senza tocco: la stampante resta da scegliere.
    case 'cancelled': return result('NO_PRINTER', t('prn_err_cancelled'), detail);
    case 'gesture': return result('NO_PRINTER', t('prn_err_gesture'), detail);
    // Su Android Chrome la ricerca richiede la Posizione attiva: e un'impostazione del telefono.
    case 'location': return result('BLUETOOTH_OFF', t('prn_err_location'), detail);
    case 'timeout':
      return result('CONNECT_FAILED', t('prn_err_connect_timeout', who, Math.round(CONNECT_TIMEOUT_MS / 1000)), detail);
    // Scrittura GATT rifiutata: durante l'invio e la stampa interrotta (come PrinterWriteException).
    case 'write':
      return writing
        ? result('WRITE_FAILED', t('prn_err_write', who), detail)
        : result('WRITE_FAILED', t('prn_err_unexpected', detail), detail);
    case 'not-found':
      if (OFF_RE.test(detail)) return result('BLUETOOTH_OFF', t('prn_err_bluetooth_off'), detail);
      if (writing) return result('WRITE_FAILED', t('prn_err_write', who), detail);
      if (/service|characteristic/i.test(detail)) return result('NO_CHANNEL', t('prn_err_no_channel'), detail);
      return result('CONNECT_FAILED', t('prn_err_not_found'), detail);
    case 'network':
      if (OFF_RE.test(detail)) return result('BLUETOOTH_OFF', t('prn_err_bluetooth_off'), detail);
      return writing
        ? result('WRITE_FAILED', t('prn_err_write', who), detail)
        : result('CONNECT_FAILED', t('prn_err_connect', who), detail);
    default:
      if (OFF_RE.test(detail)) return result('BLUETOOTH_OFF', t('prn_err_bluetooth_off'), detail);
      return writing
        ? result('WRITE_FAILED', t('prn_err_unexpected', detail), detail)
        : result('CONNECT_FAILED', t('prn_err_unknown', detail), detail);
  }
}

// Stato 'error' di ble.js senza un esito del manager (es. diagnostica): failure dal codice.
const CODE_AS_ERROR = {
  cancelled: { name: 'NotFoundError', message: 'cancelled' },
  location: { name: 'NotFoundError', message: 'location' },
  'not-found': { name: 'NotFoundError' },
  gesture: { name: 'SecurityError' },
  network: { name: 'NetworkError' },
  write: { name: 'NotSupportedError' }
};

function failureForCode(code, detail, name) {
  const like = { name: '', message: detail || '' };
  if (code === 'unsupported' || code === 'cat-printer' || code === 'no-channel' || code === 'timeout') like.code = code;
  else if (CODE_AS_ERROR[code]) Object.assign(like, CODE_AS_ERROR[code]);
  const f = failureFor(like, 'connect', name);
  return result(f.failure, f.message, detail);
}

function repeatBytes(bytes, copies) {
  if (copies <= 1) return bytes;
  const out = new Uint8Array(bytes.length * copies);
  for (let i = 0; i < copies; i++) out.set(bytes, i * bytes.length);
  return out;
}

function prepend(head, bytes) {
  if (!head || head.length === 0) return bytes;
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  return out;
}

function sameState(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

// ------------------------------------------------------------------ PrinterManager

/**
 * Stato (get state, subscribe):
 * { kind: 'unsupported'|'not-paired'|'disconnected'|'connecting'|'ready'|'printing'|'error',
 *   name, progress (0..1), failure, message (per l'utente), detail (causa tecnica),
 *   action ('pair' con NO_PRINTER: serve un tocco su «Abbina», altrimenti null),
 *   paired (dispositivo usabile in questa pagina), remembered (stampante salvata),
 *   connected, profile, writeMode, chunk,
 *   driver (id del driver corrente), unsupported ('phomemo-m02x' se la stampante e un modello
 *   riconosciuto ma non supportato, altrimenti null) }
 * 'not-paired' con remembered = stampante salvata, ma serve un tocco (pair) per riaverla;
 * 'disconnected' = la stampa si ricollega da sola. Durante un lavoro: 'connecting' finche non
 * parte il primo pezzo, poi 'printing' con progress.
 *
 * Driver (come PrinterManager.kt): currentDriver(), setDriver(id) (allinea la carta e, se il
 * retino era il predefinito del driver precedente, passa a quello del nuovo; cambiando famiglia,
 * ESC/POS ↔ Phomemo, la calibrazione BLE torna ai predefiniti del driver).
 *
 * options (per i test): { idleDisconnectMs, navigator(), setTimeout, clearTimeout, now() }.
 */
export class PrinterManager {
  constructor(settings, ble = Ble, options = {}) {
    this.settings = settings;
    this.ble = ble;
    this._idleMs = options.idleDisconnectMs === undefined ? PrinterTuning.IDLE_DISCONNECT_MS : options.idleDisconnectMs;
    this._nav = options.navigator || (() => globalThis.navigator);
    this._later = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this._cancel = options.clearTimeout || ((id) => clearTimeout(id));
    this._now = options.now || (() => Date.now());

    this._listeners = new Set();
    this._last = null;
    this._busy = false;
    this._writing = false;       // il lavoro ha cominciato a inviare (prima: si sta collegando)
    this._job = null;            // promessa che si risolve a fine lavoro
    this._closing = null;        // chiusura che aspetta lo svuotamento del buffer
    this._reconnecting = null;   // reconnect() in corso
    this._silentReconnect = false; // reconnect() senza chooser in corso
    this._silentFailed = false;  // il browser non ha restituito la stampante ricordata
    this._progress = 0;
    this._error = null;          // { failure, message, detail } dell'ultimo esito fallito
    this._resync = null;         // NUL da mandare prima del prossimo lavoro (invio interrotto)
    this._idleTimer = null;
    this._lastJobBytes = 0;
    this._lastJobEnd = 0;
    this._bleStatus = null;

    this._offBle = ble.on((info) => this._onBle(info));
    // Il driver puo cambiare anche dalle impostazioni: canale preferito e stato lo seguono.
    this._offSettings = typeof settings.subscribe === 'function'
      ? settings.subscribe(() => { this._preferDriverProfiles(); this._emit(); })
      : null;
    this._preferDriverProfiles();
  }

  /** Driver corrente (dalle impostazioni). */
  currentDriver() {
    return driverFor(this.settings.get());
  }

  /**
   * Cambia driver: id di drivers/index.js. Allinea la carta al driver e, se il retino corrente e
   * il predefinito del driver precedente, propone quello del nuovo (Floyd-Steinberg per le
   * Phomemo). Cambiando famiglia (ESC/POS ↔ Phomemo) bleChunkSize, bleChunkDelayMs e
   * bleWithoutResponse tornano a null: erano tarati sull'altra stampante.
   * opts.manual (default true): scelta dell'utente, che il riconoscimento dal nome dopo
   * un abbinamento non tocca piu (finche non si abbina un'altra stampante). → driver
   */
  setDriver(driverId, { manual = true } = {}) {
    if (!DRIVER_IDS.includes(driverId)) throw new RangeError(`unknown printer driver: ${String(driverId)}`);
    if (manual && typeof this.ble.setManualDriver === 'function') {
      try { this.ble.setManualDriver(driverId); } catch (e) { /* senza localStorage la scelta vale per questa pagina */ }
    }
    return this._applyDriver(driverId);
  }

  /** Stato attuale (oggetto nuovo, da non modificare). */
  get state() {
    return this._compute();
  }

  /** Avvisa a ogni cambio di stato; chiamata subito con lo stato attuale. → unsubscribe */
  subscribe(fn) {
    // Uno stato cambiato senza avvisi (es. prima iscrizione) lo ricevono anche gli altri.
    this._emit();
    this._listeners.add(fn);
    try { fn(this._last || this._compute()); } catch (e) { console.error(e); }
    return () => { this._listeners.delete(fn); };
  }

  /**
   * Sceglie la stampante dal chooser del browser: va chiamata DIRETTAMENTE nel gestore di un
   * tocco. opts come Ble.pair ({ all } per tutti i dispositivi, { sameName } per la stessa).
   * → Promise<state>; rifiuta con l'errore originale (annullato compreso: Ble.errorCode lo
   * riconosce) dopo aver aggiornato lo stato (l'annullamento lascia lo stato com'era).
   */
  pair(opts) {
    let pending;
    try {
      pending = this.ble.pair(opts);
    } catch (e) {
      pending = Promise.reject(e);
    }
    this._error = null;
    this._cancelIdle();
    this._emit();
    return Promise.resolve(pending).then(() => {
      this._silentFailed = false;
      this._afterPair();
      this._scheduleIdle();
      this._emit();
      return this.state;
    }, async (e) => {
      if (errorCode(e) !== 'cancelled') this._error = await this._failureAfter(e, 'connect');
      this._emit();
      throw e;
    });
  }

  /**
   * Ricollega senza chooser quando si puo (stampante della pagina o getDevices). Chiamata dentro
   * un tocco quando il percorso silenzioso non c'e (o e gia fallito), apre SUBITO il chooser
   * filtrato sulla stampante ricordata; se il percorso silenzioso fallisce dentro un tocco, lo
   * stato dice NO_PRINTER (action 'pair') invece di aprire il chooser fuori tempo. Non rifiuta mai.
   * → Promise<boolean> (true = pronta)
   */
  reconnect() {
    if (this._reconnecting) return this._reconnecting;
    const run = this._reconnectNow();
    this._reconnecting = run;
    const done = () => { if (this._reconnecting === run) this._reconnecting = null; };
    run.then(done, done);
    return run;
  }

  /**
   * Stampa un'immagine a 1 bit; copies (1..10) ripete il lavoro intero.
   * onProgress(frazione 0..1, byte inviati, byte totali), al massimo una volta per punto percentuale.
   * → { ok: true, bytes, ms } | { ok: false, failure, message, detail }
   */
  async print(bitImage, { copies = 1, onProgress } = {}) {
    // Ristampa dopo un cambio di carta: un'immagine piu larga della testina uscirebbe come
    // spazzatura, quindi si rifiuta subito, senza toccare stato e collegamento.
    const tooWide = this._tooWide(bitImage, this.settings.get());
    if (tooWide) return tooWide;
    return this._runJob((s) => this._tooWide(bitImage, s) || buildJobBytes(bitImage, s), { copies, onProgress });
  }

  /**
   * Pagina di calibrazione con le impostazioni correnti: ESC/POS → quella testuale di testpage.js
   * (come TestPage.kt); Phomemo → driver.testPage, a raster. Stesso esito di print().
   */
  async printTestPage({ onProgress } = {}) {
    return this._runJob((s) => {
      const info = this.ble.info();
      const driver = driverFor(s);
      const hints = transportFor(s, driver);
      // Con il trasporto del driver o dell'utente la pagina dice quello, non il piano automatico.
      const transfer = hints
        ? { mode: 'custom', withResponse: !hints.withoutResponse, chunk: hints.chunkSize, pause: hints.chunkDelayMs }
        : info.transfer;
      const writeMode = hints ? 'custom' : info.writeMode;
      if (driver.family === 'escpos') {
        return buildTestPage(paperFor(s), s, { printerName: info.name, writeMode, transfer });
      }
      const options = driverOptionsFor(s);
      const texts = rasterTestPageTexts(driver, s, { printerName: info.name, writeMode, transfer, options });
      return concatPackets(driver.testPage({ ...options, ...texts }));
    }, { copies: 1, onProgress, connectFirst: true });
  }

  /** Chiude subito il collegamento (dopo lo svuotamento del buffer), per liberare la stampante. */
  async disconnect() {
    this._cancelIdle();
    if (this._job) await this._job;
    if (this._closing) return this._closing;
    const closing = (async () => {
      const wait = PrinterTuning.drainMillis(this._lastJobBytes) - (this._now() - this._lastJobEnd);
      if (this._lastJobEnd && wait > 0) await new Promise((resolve) => { this._later(resolve, wait); });
      this._error = null;
      this.ble.disconnect();
      this._emit();
    })();
    this._closing = closing;
    try {
      await closing;
    } finally {
      this._closing = null;
    }
  }

  /** Dimentica la stampante (anche nel browser, se supportato), dopo l'eventuale lavoro in corso. */
  async forget() {
    this._cancelIdle();
    if (this._job) await this._job;
    this._error = null;
    this._silentFailed = false;
    this._resync = null;
    try {
      await this.ble.forget();
    } finally {
      this._emit();
    }
  }

  /** Smette di ascoltare ble.js e ferma il timer di inattivita. */
  dispose() {
    this._cancelIdle();
    if (this._offBle) this._offBle();
    this._offBle = null;
    if (this._offSettings) this._offSettings();
    this._offSettings = null;
    this._listeners.clear();
  }

  // ---------------------------------------------------------------- driver

  _patchSettings(patch) {
    const s = this.settings;
    if (typeof s.update === 'function') s.update(patch);
    else if (typeof s.set === 'function') s.set(patch);
  }

  _preferDriverProfiles() {
    if (typeof this.ble.preferProfiles !== 'function') return;
    try { this.ble.preferProfiles(this.currentDriver().bleProfiles); } catch (e) { /* ble.js finto o vecchio */ }
  }

  _applyDriver(driverId) {
    const before = this.settings.get() || {};
    const previous = driverFor(before);
    const next = driverById(driverId);
    const patch = { printerDriver: next.id, paper: next.paper };
    if (previous.id !== next.id) {
      // Retino: si propone quello del driver solo se l'utente non ne aveva scelto uno diverso.
      if (before.dither === previous.defaultDither) patch.dither = next.defaultDither;
      // Invio BLE tarato sull'altra famiglia: torna ai predefiniti del driver (stessa regola di
      // selectDriver nella UI). Serve anche qui perche il driver cambia pure dopo un abbinamento
      // dentro print/printTestPage, senza passare dalla UI: un preset Phomemo da 128 byte senza
      // conferma toglierebbe all'ESC/POS la strategia automatica del bridge.
      if (previous.family !== next.family) Object.assign(patch, BLE_TUNING_DEFAULTS);
    }
    this._patchSettings(patch);
    this._preferDriverProfiles();
    this._emit();
    return next;
  }

  // Dopo un abbinamento: il driver si riconosce dal nome, se l'utente non l'ha scelto a mano per
  // questa stampante. Un nome sconosciuto (o la M02X, non supportata) lascia il driver com'e.
  _afterPair() {
    const ble = this.ble;
    let manual = null;
    try { manual = typeof ble.manualDriver === 'function' ? ble.manualDriver() : null; } catch (e) { manual = null; }
    if (manual && DRIVER_IDS.includes(manual)) {
      if (manual !== this.currentDriver().id) this._applyDriver(manual);
      return;
    }
    const guessed = guessDriver(ble.info().name);
    const current = this.currentDriver();
    // Stessa regola di PrinterManager.select su Android: il nome non distingue una ESC/POS da 58 mm da
    // una da 80, quindi tra ESC/POS resta la scelta dell'utente; un nome sconosciuto (o la M02X) lascia
    // una ESC/POS com'è e riporta un Phomemo alla 58 mm.
    if (!guessed) {
      if (current.family !== 'escpos') this._applyDriver('escpos-58');
      return;
    }
    if (guessed.id === current.id) return;
    if (guessed.family === 'escpos' && current.family === 'escpos') return;
    this._applyDriver(guessed.id);
  }

  // ---------------------------------------------------------------- lavori

  _tooWide(bitImage, s) {
    const driver = driverFor(s);
    const dots = driver.rasterShape(driverOptionsFor(s)).dots;
    if (!bitImage || !(bitImage.width > dots)) return null;
    // Il messaggio dice per quale carta era stata composta. 576 punti possono essere la 80 mm o
    // la M02 Pro: tra le due si nomina la 80 mm, l'unica piu larga di una stampante da 384 punti.
    const papers = [PaperWidth.MM58, PaperWidth.MM80];
    const fits = papers.filter((p) => p.dots >= bitImage.width).sort((a, b) => a.dots - b.dots)[0];
    return {
      ok: false,
      failure: 'RENDER_FAILED',
      message: t('prn_err_too_wide', (fits || PaperWidth.MM80).mm),
      detail: `image ${bitImage.width} dots, ${driver.id} ${dots} dots`
    };
  }

  /**
   * Abbinamento dentro il gesto: se la stampante ricordata non e in questa pagina e il percorso
   * silenzioso non c'e (o e gia fallito), apre ORA il chooser filtrato sul suo nome. Va chiamata
   * prima di qualsiasi await. → Promise (da attendere) oppure null se non serve o non si puo.
   */
  _pairInGesture() {
    const ble = this.ble;
    const info = ble.info();
    if (info.paired || !info.remembered || !this._userActive()) return null;
    if (ble.canRemember() && !this._silentFailed) return null;
    let pending;
    try {
      pending = Promise.resolve(ble.pair({ sameName: true }));
    } catch (e) {
      pending = Promise.reject(e);
    }
    // Rifiuto gestito da chi la attende; questo evita l'avviso di promessa non gestita nel frattempo.
    pending.catch(() => {});
    return pending;
  }

  async _runJob(build, { copies = 1, onProgress, connectFirst = false } = {}) {
    const ble = this.ble;
    if (!ble.supported()) {
      return { ok: false, failure: 'UNSUPPORTED', message: t('prn_err_unsupported'), detail: 'Web Bluetooth not available' };
    }
    // Lo stato non cambia: sta gia mostrando il lavoro in corso.
    if (this._busy) return { ok: false, failure: 'BUSY', message: t('prn_err_busy'), detail: '' };
    // Prima di qualsiasi await: il chooser richiede la finestra del gesto.
    const pairing = this._pairInGesture();
    this._busy = true;
    let release;
    this._job = new Promise((resolve) => { release = resolve; });
    this._progress = 0;
    this._error = null;
    this._cancelIdle();
    let phase = 'connect';
    let sent = 0;
    let s = this.settings.get();
    this._writing = false;
    const offPhase = ble.on((i) => {
      if (i.status !== 'printing') return;
      phase = 'write';
      this._writing = true;
    });
    this._emit();
    try {
      if (pairing) {
        // Chooser gia aperto nel gesto: un rifiuto (anche l'annullamento) e l'esito del lavoro.
        await pairing;
        this._silentFailed = false;
        this._afterPair();
      }
      // Una chiusura in corso (svuotamento del buffer) finisce prima di riaprire.
      if (this._closing) await this._closing;

      const missing = await this._ensureDevice();
      if (missing) return this._fail(missing);
      if ((await ble.available()) === false) {
        return this._fail(result('BLUETOOTH_OFF', t('prn_err_bluetooth_off'), 'Bluetooth adapter not available'));
      }
      // La pagina di prova scrive sulla carta come si sta inviando: serve il canale scelto.
      if (connectFirst && !ble.info().connected) await ble.reconnect();

      // Composizione: se fallisce la stampante non c'entra, quindi niente errore nello stato.
      s = this.settings.get();
      let one;
      try {
        one = build(s);
      } catch (e) {
        console.warn('[fotoflash] composizione della stampa fallita', e);
        return { ok: false, failure: 'RENDER_FAILED', message: t('prn_err_render'), detail: technicalMessage(e) };
      }
      if (one && one.ok === false) return one;
      // Dopo un invio interrotto la stampante puo essere dentro un GS v 0 aperto: i NUL lo chiudono.
      const bytes = prepend(this._resync, repeatBytes(one, PrinterTuning.clampCopies(copies)));
      const total = bytes.length;
      // Trasporto del driver (o dell'utente); null = strategia automatica di ble.js.
      const transport = transportFor(s);
      const t0 = this._now();
      let shownPercent = -1;
      let retried = false;
      for (;;) {
        sent = 0;
        try {
          await ble.print(bytes, {
            ...(transport || {}),
            onProgress: (done, all) => {
              sent = done;
              const fraction = all > 0 ? Math.min(1, done / all) : 1;
              const percent = Math.floor(fraction * 100);
              // Al massimo un aggiornamento per punto percentuale: niente tempeste di ridisegni.
              if (percent === shownPercent) return;
              shownPercent = percent;
              this._progress = percent / 100;
              this._emit();
              if (onProgress) {
                try { onProgress(fraction, done, all); } catch (err) { console.error(err); }
              }
            }
          });
          break;
        } catch (e) {
          // Una riconnessione sola, se il collegamento e morto dopo la connessione ma prima di
          // accettare dati (come PrinterManager.kt). Una connessione fallita no: ble.js l'ha gia
          // ritentata, e un altro giro raddoppierebbe solo l'attesa prima dell'errore.
          if (!retried && phase === 'write' && sent === 0 && errorCode(e) === 'network' && ble.info().paired) {
            retried = true;
            phase = 'connect';
            this._writing = false;
            continue;
          }
          throw e;
        }
      }
      this._resync = null;
      this._progress = 1;
      this._lastJobBytes = total;
      this._lastJobEnd = this._now();
      return { ok: true, bytes: total, ms: this._lastJobEnd - t0 };
    } catch (e) {
      console.warn('[fotoflash] stampa fallita', e);
      if (phase === 'write' && sent > 0) {
        // NUL quanti ne servono a chiudere la banda (o il blocco Phomemo da 255 righe) piu lunga.
        const shape = driverFor(s).rasterShape(driverOptionsFor(s));
        this._resync = resync(shape.bytesPerRow, shape.bandRows);
      }
      return this._fail(await this._failureAfter(e, phase));
    } finally {
      offPhase();
      this._busy = false;
      this._writing = false;
      this._progress = 0;
      if (ble.info().connected) this._scheduleIdle();
      this._emit();
      this._job = null;
      release();
    }
  }

  /**
   * Stampante usabile in questa pagina, solo per la via silenziosa (getDevices + annuncio): null se
   * c'e, altrimenti NO_PRINTER. Mai il chooser qui: dopo un'attesa il gesto e scaduto, e
   * l'abbinamento l'ha gia chiesto _pairInGesture() quando serviva. Il prossimo tocco, con
   * _silentFailed, apre il chooser subito.
   */
  async _ensureDevice() {
    const ble = this.ble;
    let info = ble.info();
    if (info.paired) return null;
    if (info.remembered && ble.canRemember()) {
      if (await ble.reconnect()) return null;
      this._silentFailed = true;
    }
    info = ble.info();
    return info.remembered
      ? result('NO_PRINTER', t('prn_err_not_bonded', printerName(info.name)), 'printer not paired in this page')
      : result('NO_PRINTER', t('prn_err_no_printer'), 'no printer paired');
  }

  async _reconnectNow() {
    const ble = this.ble;
    if (!ble.supported()) return false;
    if (this._busy) {
      // Il lavoro in corso si sta gia collegando: vale il suo esito.
      await this._job;
      return ble.info().status === 'ready' && ble.info().connected;
    }
    const info = ble.info();
    this._error = null;
    if (info.paired && info.connected && info.status === 'ready') {
      // Gia collegata: un errore del lavoro precedente non vale piu.
      this._scheduleIdle();
      this._emit();
      return true;
    }
    // Prima di qualsiasi await: dentro un tocco, se serve, il chooser si apre adesso.
    const inGesture = this._userActive();
    const pairing = this._pairInGesture();
    this._cancelIdle();
    try {
      let done = null;
      if (pairing) {
        this._emit();
        done = await pairing;
        this._silentFailed = false;
        this._afterPair();
      } else if (info.paired || (info.remembered && ble.canRemember())) {
        this._silentReconnect = true;
        this._emit();
        try {
          done = await ble.reconnect();
        } finally {
          this._silentReconnect = false;
        }
        if (!done && !ble.info().paired) {
          this._silentFailed = true;
          // Toccato «Ricollega» ma il browser non ha restituito la stampante: serve «Abbina».
          if (inGesture) {
            this._error = result('NO_PRINTER', t('prn_err_not_bonded', printerName(ble.info().name)), 'printer not returned by getDevices');
          }
        }
      }
      if (done) this._scheduleIdle();
      this._emit();
      return !!done && ble.info().status === 'ready';
    } catch (e) {
      if (errorCode(e) !== 'cancelled') this._error = await this._failureAfter(e, 'connect');
      this._emit();
      return false;
    }
  }

  async _failureAfter(e, phase) {
    const f = failureFor(e, phase, this.ble.info().name);
    // Bluetooth spento durante la connessione: arriva come errore generico, ma l'azione giusta
    // e "accendi il Bluetooth", non "riprova".
    if (phase === 'connect' && f.failure === 'CONNECT_FAILED') {
      let available = null;
      try { available = await this.ble.available(); } catch (x) { available = null; }
      if (available === false) return result('BLUETOOTH_OFF', t('prn_err_bluetooth_off'), f.detail);
    }
    return f;
  }

  _fail(f) {
    this._error = result(f.failure, f.message, f.detail);
    return { ok: false, failure: f.failure, message: f.message, detail: f.detail || '', action: actionFor(f.failure) };
  }

  _userActive() {
    try {
      const nav = this._nav();
      return !!(nav && nav.userActivation && nav.userActivation.isActive);
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- collegamento

  _scheduleIdle() {
    this._cancelIdle();
    if (!(this._idleMs > 0)) return;
    this._idleTimer = this._later(() => {
      this._idleTimer = null;
      // Se nel frattempo e partito un lavoro, ci pensera lui a riprogrammare la chiusura.
      if (this._busy || this._closing) return;
      if (this.ble.info().connected) this.ble.disconnect();
    }, this._idleMs);
  }

  _cancelIdle() {
    if (this._idleTimer !== null) this._cancel(this._idleTimer);
    this._idleTimer = null;
  }

  // ---------------------------------------------------------------- stato

  _onBle(info) {
    const changed = info.status !== this._bleStatus;
    this._bleStatus = info.status;
    // Un nuovo tentativo (o un canale scelto a mano) toglie l'errore precedente.
    if (changed && !this._busy && (info.status === 'connecting' || info.status === 'ready' || info.status === 'printing')) {
      this._error = null;
    }
    // Collegata fuori da un lavoro (diagnostica, canale scelto a mano): anche cosi la stampante
    // si libera dopo l'inattivita. I lavori riprogrammano la chiusura da soli alla fine.
    if (changed && !this._busy && !this._closing && info.status === 'ready' && info.connected) this._scheduleIdle();
    this._emit();
  }

  _compute() {
    const ble = this.ble;
    let driver = 'escpos-58';
    try { driver = this.currentDriver().id; } catch (e) { /* impostazioni illeggibili: il predefinito */ }
    if (!ble.supported()) {
      return {
        kind: 'unsupported', name: null, progress: 0, failure: 'UNSUPPORTED', message: t('prn_err_unsupported'), detail: '',
        action: null, paired: false, remembered: false, connected: false, profile: null, writeMode: 'auto', chunk: null,
        driver, unsupported: null
      };
    }
    const info = ble.info();
    const base = {
      kind: 'not-paired', name: info.name, progress: 0, failure: null, message: null, detail: null, action: null,
      paired: info.paired, remembered: info.remembered, connected: info.connected,
      profile: info.profile, writeMode: info.writeMode, chunk: info.chunk,
      driver, unsupported: unsupportedModel(info.name)
    };
    if (this._busy) {
      // Prima del primo pezzo il lavoro si sta collegando (stampante ricordata, annuncio, chooser):
      // "Stampa 0%" per secondi sarebbe falso. Lo stato 'printing' di ble.js arriva qui prima
      // che il lavoro lo registri, e dopo l'ultimo pezzo ble.js torna 'ready': valgono entrambi.
      base.kind = this._writing || info.status === 'printing' ? 'printing' : 'connecting';
      if (base.kind === 'printing') base.progress = this._progress;
      return base;
    }
    if (this._silentReconnect) {
      base.kind = 'connecting';
      return base;
    }
    const error = this._error || (info.status === 'error' ? failureForCode(info.lastErrorCode, info.lastError, info.name) : null);
    if (error) {
      base.kind = 'error';
      base.failure = error.failure;
      base.message = error.message;
      base.detail = error.detail;
      base.action = actionFor(error.failure);
      return base;
    }
    if (info.status === 'connecting' || info.status === 'printing') {
      // 'printing' qui = stampa avviata direttamente su ble.js (es. diagnostica).
      base.kind = info.status;
      return base;
    }
    if (info.status === 'ready' && info.connected) {
      base.kind = 'ready';
      return base;
    }
    if (info.paired) base.kind = 'disconnected';
    else if (info.remembered && ble.canRemember() && !this._silentFailed) base.kind = 'disconnected';
    else base.kind = 'not-paired';
    return base;
  }

  _emit() {
    const next = this._compute();
    if (sameState(next, this._last)) return;
    this._last = next;
    for (const fn of [...this._listeners]) {
      try { fn(next); } catch (e) { console.error(e); }
    }
  }
}
