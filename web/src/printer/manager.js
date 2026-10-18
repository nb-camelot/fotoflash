// L'unico punto che stampa, come PrinterManager su Android: stato osservabile, un lavoro alla
// volta (chi arriva mentre si stampa riceve subito BUSY, niente code nascoste), collegamento
// tenuto aperto tra stampe vicine e chiuso dopo 45 s di inattivita, errori tradotti in failure
// con un messaggio per l'utente (message) e la causa tecnica (detail).
// La stampante ricordata non viene mai dimenticata da sola: solo forget() la toglie.

import { Ble, errorCode, CONNECT_TIMEOUT_MS } from './ble.js';
import { buildTestPage } from './testpage.js';
import { PaperWidth } from '../core/model.js';
import { centeredOn } from '../core/bitimage.js';
import { buildThermalJob, concatPackets, resync } from '../core/escpos.js';
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

  clampHeatLevel(value) { return clamp(value, 0, 4, 0); },
  clampFeedLines(value) { return clamp(value, 0, 10, 4); },
  clampBandHeight(value) { return clamp(value, 8, 255, 24); },
  clampCopies(value) { return clamp(value, 1, 10, 1); },

  /**
   * Livello di intensita (0..4) → ESC 7. 0 = non inviare nulla e lasciare il default della
   * stampante (alcuni cloni reagiscono male a ESC 7). Salendo cresce soprattutto il tempo di
   * riscaldamento, che e cio che scurisce i punti.
   */
  heatFor(level) {
    switch (clamp(level, 0, 4, 0)) {
      case 1: return { maxDots: 7, heatTime: 60, heatInterval: 2 };
      case 2: return { maxDots: 8, heatTime: 80, heatInterval: 2 };
      case 3: return { maxDots: 10, heatTime: 110, heatInterval: 2 };
      case 4: return { maxDots: 11, heatTime: 140, heatInterval: 2 };
      default: return null;
    }
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

/** Carta delle impostazioni ('MM58' | 'MM80'), con 58 mm se il valore non e valido. */
export function paperFor(settings) {
  const key = settings && settings.paper;
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PaperWidth, key) ? PaperWidth[key] : PaperWidth.MM58;
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

/** Byte di una copia del lavoro: ESC @ (+ ESC 7), bande GS v 0, avanzamento (+ taglio). */
export function buildJobBytes(bitImage, settings) {
  const dots = paperFor(settings).dots;
  // Composta per carta piu stretta: la si centra invece di lasciarla attaccata a sinistra.
  const fitted = bitImage.width < dots ? centeredOn(bitImage, dots) : bitImage;
  return concatPackets(buildThermalJob(fitted, jobOptionsFor(settings)));
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
 *   paired (dispositivo usabile in questa pagina), remembered (stampante salvata),
 *   connected, profile, writeMode, chunk }
 * 'not-paired' con remembered = stampante salvata, ma serve un tocco (pair) per riaverla;
 * 'disconnected' = la stampa si ricollega da sola. Durante un lavoro: 'connecting' finche non
 * parte il primo pezzo, poi 'printing' con progress.
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
   * Ricollega senza chooser quando si puo (stampante della pagina o getDevices); chiamata dentro
   * un tocco riapre il chooser filtrato sulla stampante ricordata. Non rifiuta mai.
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

  /** Pagina di calibrazione (come TestPage.kt) con le impostazioni correnti. Stesso esito di print(). */
  async printTestPage({ onProgress } = {}) {
    return this._runJob((s) => {
      const info = this.ble.info();
      return buildTestPage(paperFor(s), s, { printerName: info.name, writeMode: info.writeMode, transfer: info.transfer });
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
    this._listeners.clear();
  }

  // ---------------------------------------------------------------- lavori

  _tooWide(bitImage, s) {
    const paper = paperFor(s);
    if (!bitImage || !(bitImage.width > paper.dots)) return null;
    // Il messaggio dice per quale carta era stata composta.
    const fits = Object.values(PaperWidth).filter((p) => p.dots >= bitImage.width).sort((a, b) => a.dots - b.dots)[0];
    const widest = Object.values(PaperWidth).sort((a, b) => b.dots - a.dots)[0];
    return {
      ok: false,
      failure: 'RENDER_FAILED',
      message: t('prn_err_too_wide', (fits || widest).mm),
      detail: `image ${bitImage.width} dots, paper ${paper.dots} dots`
    };
  }

  async _runJob(build, { copies = 1, onProgress, connectFirst = false } = {}) {
    const ble = this.ble;
    if (!ble.supported()) {
      return { ok: false, failure: 'UNSUPPORTED', message: t('prn_err_unsupported'), detail: 'Web Bluetooth not available' };
    }
    // Lo stato non cambia: sta gia mostrando il lavoro in corso.
    if (this._busy) return { ok: false, failure: 'BUSY', message: t('prn_err_busy'), detail: '' };
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
      const t0 = this._now();
      let shownPercent = -1;
      let retried = false;
      for (;;) {
        sent = 0;
        try {
          await ble.print(bytes, {
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
        const bpr = Math.ceil(paperFor(s).dots / 8);
        this._resync = resync(bpr, PrinterTuning.clampBandHeight(s.bandHeight));
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

  // Stampante usabile in questa pagina: null se c'e, altrimenti { failure, message, detail }.
  async _ensureDevice() {
    const ble = this.ble;
    let info = ble.info();
    if (info.paired) return null;
    if (info.remembered && ble.canRemember()) {
      if (await ble.reconnect()) return null;
      this._silentFailed = true;
    }
    info = ble.info();
    if (info.remembered && this._userActive()) {
      // Dentro un tocco: un solo passo nel chooser, filtrato sulla stampante ricordata.
      await ble.pair({ sameName: true });
      this._silentFailed = false;
      return null;
    }
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
    this._cancelIdle();
    try {
      let done = null;
      if (info.paired || (info.remembered && ble.canRemember())) {
        this._silentReconnect = true;
        this._emit();
        try {
          done = await ble.reconnect();
        } finally {
          this._silentReconnect = false;
        }
        if (!done && !ble.info().paired) this._silentFailed = true;
      }
      const now = ble.info();
      if (!done && !now.paired && now.remembered && this._userActive()) {
        done = await ble.pair({ sameName: true });
        this._silentFailed = false;
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
    return { ok: false, failure: f.failure, message: f.message, detail: f.detail || '' };
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
    if (!ble.supported()) {
      return {
        kind: 'unsupported', name: null, progress: 0, failure: 'UNSUPPORTED', message: t('prn_err_unsupported'), detail: '',
        paired: false, remembered: false, connected: false, profile: null, writeMode: 'auto', chunk: null
      };
    }
    const info = ble.info();
    const base = {
      kind: 'not-paired', name: info.name, progress: 0, failure: null, message: null, detail: null,
      paired: info.paired, remembered: info.remembered, connected: info.connected,
      profile: info.profile, writeMode: info.writeMode, chunk: info.chunk
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
