// Stampa diretta via Web Bluetooth (stampanti termiche BLE, senza app).
// Porting in modulo ES di RawBT.ble del bridge (nb-camelot/raw-bt-print-bridge, escpos.js >= 1.9),
// provato sulla "BlueTooth Printer" vera (profilo 18F0/2AF1): la logica resta quella. Cambiano solo
// la chiave di localStorage, gli errori (codici in .code, i testi li mette la UI) e l'accesso al
// browser, che passa da un ambiente letto solo dentro le funzioni (cosi il modulo si importa in Node).
//
// Driver (docs/DRIVERS.md): il chooser dichiara servizi e nomi di TUTTI i driver (Phomemo FF00 e
// nomi M02 compresi); il canale si sceglie prima tra i profili del driver; print() accetta per
// lavoro { chunkSize, chunkDelayMs, withoutResponse, finalDelayMs }. Senza questi valori resta la
// strategia automatica del bridge, identica, per le stampanti ESC/POS.

import { allBleProfiles, guessDriver } from './drivers/index.js';
import { ESCPOS_BLE_PROFILES, ESCPOS_NAMES, ESCPOS_NAME_PREFIXES } from './drivers/escpos.js';

/** Chiave di localStorage della stampante ricordata e delle scelte manuali. */
export const BLE_STORE = 'fotoflash.ble';

/** Tempo massimo per la connessione GATT. */
export const CONNECT_TIMEOUT_MS = 20000;

/** Attesa massima di un annuncio della stampante ricordata prima di collegarsi. */
export const ADVERTISEMENT_WAIT_MS = 8000;

/** Modalita di scrittura accettate da setWriteMode(). */
export const WRITE_MODES = ['auto', 'response-100', 'response-20', 'noresponse-20'];

// Profili dei canali seriali BLE delle stampanti termiche ESC/POS, nell'ordine in cui si
// provano: 18f0/2af1 e quello verificato sulle Netum NT-1809 e sulle "BlueTooth Printer".
// Sono quelli del driver ESC/POS (drivers/escpos.js), che li definisce una volta sola.
export const BLE_PROFILES = ESCPOS_BLE_PROFILES;

/** Profili di tutti i driver (ESC/POS e Phomemo), senza doppioni: l'ultimo ripiego di pick(). */
export const BLE_ALL_PROFILES = Object.freeze(allBleProfiles());

/** Nome del profilo quando il canale e stato scelto a mano dalla diagnostica. */
export const MANUAL_PROFILE = 'manual';

// Le "cat printer" (servizio AE30) stampano solo bitmap con un protocollo proprio, non ESC/POS.
export const BLE_CAT_SERVICE = '0000ae30-0000-1000-8000-00805f9b34fb';

function uniq(list) {
  return list.filter((x, i) => list.indexOf(x) === i);
}

// Tutti i servizi che la pagina potra usare vanno dichiarati alla scelta del dispositivo:
// quelli non elencati restano invisibili anche alla diagnostica.
export const BLE_OPTIONAL = Object.freeze(uniq(BLE_ALL_PROFILES.map((p) => p.service).concat([
  '000018f1-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe6-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
  BLE_CAT_SERVICE
])));

// Filtri del chooser: stampanti che annunciano un servizio noto o un nome tipico, di tutti i
// driver (le Phomemo si annunciano come "M02", "M02S", "M02 Pro"…). Un nome come "M02X" compare
// anche lui: dopo l'abbinamento la UI dice che quel modello non e supportato.
export const BLE_FILTERS = Object.freeze(uniq(BLE_ALL_PROFILES.map((p) => p.service))
  .map((service) => ({ services: [service] }))
  .concat(ESCPOS_NAMES.map((name) => ({ name })))
  .concat(ESCPOS_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })))
  .concat([{ namePrefix: 'M02' }]));

function intIn(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/**
 * Trasporto chiesto da un lavoro (TransportHints del driver, sovrascritti dalle impostazioni):
 * { chunkSize, chunkDelayMs, withoutResponse, finalDelayMs } normalizzati, oppure null se non ne
 * arriva nessuno (= strategia automatica). 512 byte e il massimo di una scrittura Web Bluetooth.
 */
export function jobTransport(opts) {
  if (!opts || typeof opts !== 'object') return null;
  const given = (k) => opts[k] !== undefined && opts[k] !== null;
  if (!given('chunkSize') && !given('chunkDelayMs') && !given('withoutResponse')) return null;
  return {
    chunkSize: intIn(opts.chunkSize, 1, 512, 20),
    chunkDelayMs: intIn(opts.chunkDelayMs, 0, 5000, 0),
    withoutResponse: opts.withoutResponse === true,
    finalDelayMs: intIn(opts.finalDelayMs, 0, 10000, 300)
  };
}

/** Errore del modulo: il codice (.code) e cio che conta, il messaggio e solo tecnico. */
export function bleError(code, message) {
  const e = new Error(message || code);
  e.name = 'FotoFlashBleError';
  e.code = code;
  return e;
}

/**
 * Classifica un errore di Web Bluetooth o del modulo, nello stesso ordine di explain() del bridge.
 * 'no-device' (nessuna stampante in questa pagina) ricade in 'not-found'.
 * @returns {'cancelled'|'unsupported'|'cat-printer'|'no-channel'|'timeout'|'location'|'not-found'|'gesture'|'network'|'write'|'unknown'}
 */
export function errorCode(e) {
  if (!e) return 'unknown';
  // Le DOMException hanno un .code numerico storico: qui contano solo i codici stringa del modulo.
  const code = typeof e.code === 'string' ? e.code : '';
  if (code === 'cat-printer' || code === 'no-channel' || code === 'unsupported' || code === 'timeout') return code;
  if (code === 'no-device') return 'not-found';
  const name = e.name || '';
  const msg = e.message || String(e);
  if (name === 'NotFoundError' && /cancel/i.test(msg)) return 'cancelled';
  if (name === 'NotFoundError' && /permission|location|scan/i.test(msg)) return 'location';
  if (name === 'NotFoundError') return 'not-found';
  if (name === 'SecurityError') return 'gesture';
  if (name === 'NetworkError') return 'network';
  if (name === 'NotSupportedError' || name === 'InvalidModificationError') return 'write';
  return 'unknown';
}

/**
 * Crea un'istanza indipendente (stato, coda, ascoltatori). L'app usa l'istanza condivisa Ble;
 * i test passano un ambiente finto: { navigator(), storage(), setTimeout, clearTimeout, now() }.
 */
export function createBle(env = {}) {
  const getNavigator = env.navigator || (() => globalThis.navigator);
  const getStorage = env.storage || (() => globalThis.localStorage);
  const later = env.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const cancel = env.clearTimeout || ((id) => clearTimeout(id));
  const now = env.now || (() => Date.now());

  function delay(ms) { return new Promise((resolve) => { later(resolve, ms); }); }

  function bluetooth() {
    const nav = getNavigator();
    return (nav && nav.bluetooth) || null;
  }

  const state = {
    device: null, server: null, char: null, profile: null, preferred: null,
    status: 'idle', lastError: null, listeners: [], queue: Promise.resolve()
  };

  function saved() {
    try {
      const store = getStorage();
      const s = store && store.getItem(BLE_STORE);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function save(patch) {
    try {
      const cur = saved() || {};
      for (const k of Object.keys(patch)) cur[k] = patch[k];
      getStorage().setItem(BLE_STORE, JSON.stringify(cur));
    } catch (e) { /* senza localStorage la stampante non viene ricordata */ }
  }
  function clearSaved() {
    try { getStorage().removeItem(BLE_STORE); } catch (e) { /* niente da fare */ }
  }

  // Come si scrive sul canale scelto: modalita, conferma, pezzo e pausa (null senza canale).
  // Automatico: con conferma da 100 byte se la caratteristica lo permette (20 se la stampante li
  // ha rifiutati), altrimenti senza conferma da 20 byte con 20 ms di pausa.
  function plan() {
    const c = state.char;
    if (!c) return null;
    const props = c.properties || {};
    const s = saved() || {};
    const mode = s.writeMode || 'auto';
    if (mode === 'noresponse-20' && props.writeWithoutResponse) return { mode, withResponse: false, chunk: 20, pause: 20 };
    if (mode === 'response-20' && props.write) return { mode, withResponse: true, chunk: 20, pause: 0 };
    if (mode === 'response-100' && props.write) return { mode, withResponse: true, chunk: 100, pause: 0 };
    if (props.write) return { mode, withResponse: true, chunk: s.chunk === 20 ? 20 : 100, pause: 0 };
    return { mode, withResponse: false, chunk: 20, pause: 20 };
  }

  function info() {
    const d = state.device;
    const c = state.char;
    const s = saved() || {};
    const err = state.lastError;
    return {
      status: state.status,
      // Senza nome lo dice la UI: qui niente testi.
      name: d ? (d.name || s.name || null) : (s.name || null),
      paired: !!d,
      connected: !!(d && d.gatt && d.gatt.connected),
      profile: state.profile,
      characteristic: c ? c.uuid : null,
      writeMode: s.writeMode || 'auto',
      chunk: s.chunk || null,
      transfer: plan(),
      remembered: !!s.name,
      lastError: err ? (err.message || String(err)) : null,
      lastErrorCode: err ? errorCode(err) : null
    };
  }

  function setStatus(status, err) {
    state.status = status;
    state.lastError = err || null;
    const snapshot = info();
    state.listeners.slice().forEach((fn) => {
      try { fn(snapshot); } catch (e) { /* ascoltatore rotto */ }
    });
  }

  function onDisconnect() {
    state.server = null;
    state.char = null;
    if (state.status !== 'idle') setStatus('disconnected');
  }

  function adopt(device) {
    if (state.device === device) return;
    const old = state.device;
    if (old) {
      try { old.removeEventListener('gattserverdisconnected', onDisconnect); } catch (e) { /* vecchio dispositivo */ }
      try { if (old.gatt.connected) old.gatt.disconnect(); } catch (e) { /* gia scollegato */ }
    }
    state.device = device;
    state.server = null;
    state.char = null;
    state.profile = null;
    device.addEventListener('gattserverdisconnected', onDisconnect);
  }

  function withTimeout(promise, ms, what) {
    let timer;
    return Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = later(() => {
          reject(bleError('timeout', what + ': no answer within ' + Math.round(ms / 1000) + ' s'));
        }, ms);
      })
    ]).then((v) => { cancel(timer); return v; }, (e) => { cancel(timer); throw e; });
  }

  // Solo la connessione GATT, senza scegliere il canale (serve anche alla diagnostica).
  function connectRaw() {
    const d = state.device;
    if (!d) return Promise.reject(bleError('no-device', 'no printer paired'));
    if (d.gatt.connected && state.server) return Promise.resolve(state.server);
    setStatus('connecting');
    return withTimeout(d.gatt.connect(), CONNECT_TIMEOUT_MS, 'GATT connect').then((server) => {
      state.server = server;
      return server;
    }, (e) => {
      try { d.gatt.disconnect(); } catch (x) { /* niente da chiudere */ }
      throw e;
    });
  }

  function writable(c) {
    return !!(c && c.properties && (c.properties.write || c.properties.writeWithoutResponse));
  }

  // Profili nell'ordine in cui si provano: quelli del modello riconosciuto dal nome, poi quelli
  // del driver scelto (preferProfiles), poi tutti gli altri noti. Senza doppioni.
  function profileOrder(d) {
    const guessed = guessDriver(d && d.name);
    const lists = [guessed ? guessed.bleProfiles : [], state.preferred || [], BLE_ALL_PROFILES];
    const out = [];
    lists.forEach((list) => list.forEach((p) => {
      if (!out.some((q) => q.service === p.service && q.write === p.write)) out.push(p);
    }));
    return out;
  }

  // Sceglie il canale di stampa: prima quello scelto a mano dall'utente, poi i profili noti.
  function pick(server) {
    const s = saved() || {};
    const d = state.device;
    const override = s.service && s.characteristic && (!s.name || s.name === d.name)
      ? { service: s.service, char: s.characteristic } : null;
    return server.getPrimaryServices().then((services) => {
      const byUuid = {};
      services.forEach((svc) => { byUuid[svc.uuid] = svc; });
      const tries = [];
      if (override && byUuid[override.service]) {
        tries.push({ name: MANUAL_PROFILE, service: byUuid[override.service], write: override.char });
      }
      profileOrder(d).forEach((p) => {
        if (byUuid[p.service]) tries.push({ name: p.name, service: byUuid[p.service], write: p.write });
      });
      function next(i) {
        if (i >= tries.length) {
          if (byUuid[BLE_CAT_SERVICE]) {
            throw bleError('cat-printer', 'cat printer (service AE30): proprietary bitmap protocol, not ESC/POS');
          }
          throw bleError('no-channel', 'no known print channel (services: ' +
            (services.map((svc) => svc.uuid).join(', ') || 'none') + ')');
        }
        const t = tries[i];
        return t.service.getCharacteristic(t.write).then((c) => {
          if (writable(c)) return { profile: t.name, char: c };
          throw new Error('not writable');
        }).catch(() => {
          // UUID atteso assente: prende la prima caratteristica scrivibile dello stesso servizio.
          return t.service.getCharacteristics().then((list) => {
            const c = list.filter(writable)[0];
            if (c) return { profile: t.name, char: c };
            return next(i + 1);
          }, () => next(i + 1));
        });
      }
      return next(0);
    }).then((found) => {
      state.char = found.char;
      state.profile = found.profile;
      return found;
    });
  }

  function connect() {
    if (state.device && state.device.gatt.connected && state.char) return Promise.resolve();
    return connectRaw().then(pick).then(() => {
      setStatus('ready');
    }, (e) => {
      setStatus('error', e);
      throw e;
    });
  }

  // Un collegamento caduto (stampante appena risvegliata dall'auto-sleep) si ritenta una
  // volta; un timeout no, altrimenti l'errore arriverebbe dopo oltre 40 s.
  function ensure() {
    return connect().catch((e) => {
      if (!state.device || !e || e.name !== 'NetworkError') throw e;
      return delay(1500).then(connect);
    });
  }

  function writeOne(c, piece, withResponse) {
    if (withResponse) return c.writeValueWithResponse ? c.writeValueWithResponse(piece) : c.writeValue(piece);
    return c.writeValueWithoutResponse ? c.writeValueWithoutResponse(piece) : c.writeValue(piece);
  }

  function report(onProgress, done, total) {
    if (!onProgress) return;
    try { onProgress(done, total); } catch (e) { /* callback della pagina */ }
  }

  // Piano di un lavoro con trasporto esplicito (driver o impostazioni). Le proprieta della
  // caratteristica si rispettano: niente scritture senza conferma dove non sono ammesse, e
  // viceversa. Stessa forma di plan(), con la pausa finale in piu.
  function customPlan(c, t) {
    const props = c.properties || {};
    let withResponse = !t.withoutResponse;
    if (withResponse && props.writeWithoutResponse && !props.write) withResponse = false;
    if (!withResponse && props.write && !props.writeWithoutResponse) withResponse = true;
    if (!withResponse && typeof c.writeValueWithoutResponse !== 'function') withResponse = true;
    return { mode: 'custom', withResponse, chunk: t.chunkSize, pause: t.chunkDelayMs, final: t.finalDelayMs };
  }

  // Scrittura con conferma; dopo un ripiego si usa writeValue (conferma se la caratteristica la
  // prevede), come chiede il protocollo Phomemo quando la scrittura senza conferma fallisce.
  function writeConfirmed(c, piece, fallback) {
    if (fallback && typeof c.writeValue === 'function') return c.writeValue(piece);
    return typeof c.writeValueWithResponse === 'function' ? c.writeValueWithResponse(piece) : c.writeValue(piece);
  }

  // Scrive a pezzi con il trasporto del lavoro, alla lettera: pezzi di chunk byte, pausa dopo ogni
  // pezzo tranne l'ultimo (anche l'ultimo pezzo resta senza conferma, se cosi chiede il driver),
  // attesa finale. Se una scrittura senza conferma viene rifiutata con la stampante ancora
  // collegata (dopo i tentativi per gli errori transitori), si ripiega su writeValue per il resto
  // del lavoro ripartendo dallo stesso pezzo: una scrittura rifiutata non e partita. Niente
  // salvataggi: il trasporto lo decidono il driver e le impostazioni.
  function writeCustom(c, data, onProgress, t) {
    const p = customPlan(c, t);
    let withResp = p.withResponse;
    let fellBack = false;
    const t0 = now();
    let off = 0;
    let retries = 0;
    function step() {
      if (off >= data.length) {
        return delay(p.final).then(() => ({
          ok: true, bytes: data.length, ms: now() - t0, chunk: p.chunk, withResponse: withResp, mode: p.mode, fallback: fellBack
        }));
      }
      const piece = data.slice(off, off + p.chunk);
      const last = off + piece.length >= data.length;
      let pending;
      try {
        pending = withResp ? writeConfirmed(c, piece, fellBack) : c.writeValueWithoutResponse(piece);
      } catch (e) {
        pending = Promise.reject(e);
      }
      return Promise.resolve(pending).then(() => {
        off += piece.length;
        retries = 0;
        report(onProgress, off, data.length);
        return p.pause && !last ? delay(p.pause).then(step) : step();
      }, (e) => {
        const name = (e && e.name) || '';
        const msg = (e && e.message) || '';
        const transient = /operation failed for unknown reason|already in progress/i.test(msg);
        if (transient && retries < 3) {
          retries++;
          return delay(80 * retries).then(step);
        }
        const connected = !!(state.device && state.device.gatt.connected);
        if (!withResp && !fellBack && connected && name !== 'NetworkError') {
          fellBack = true;
          withResp = true;
          retries = 0;
          return step();
        }
        throw e;
      });
    }
    return step();
  }

  // Scrive a pezzi, una scrittura alla volta. Automatico: con conferma da 100 byte se la
  // caratteristica lo permette (se la stampante li rifiuta si scende a 20), altrimenti senza
  // conferma da 20 byte con 20 ms di pausa e l'ultimo pezzo con conferma quando possibile.
  // Le modalita scelte a mano si applicano alla lettera, anche all'ultimo pezzo.
  // [transport] (jobTransport) sostituisce tutto questo con il trasporto del lavoro.
  function write(bytes, onProgress, transport) {
    const c = state.char;
    if (!c) {
      // Collegamento caduto tra la connessione e il primo pezzo: come una scrittura rifiutata.
      const e = new Error('GATT Server is disconnected');
      e.name = 'NetworkError';
      return Promise.reject(e);
    }
    if (transport) return writeCustom(c, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), onProgress, transport);
    const props = c.properties || {};
    const p = plan();
    const mode = p.mode;
    const withResp = p.withResponse;
    const pause = p.pause;
    let chunk = p.chunk;
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const t0 = now();
    let off = 0;
    let retries = 0;
    function step() {
      if (off >= data.length) {
        // La stampante deve finire di ricevere: niente altro sul collegamento per un attimo.
        return delay(300).then(() => ({ ok: true, bytes: data.length, ms: now() - t0, chunk, withResponse: withResp }));
      }
      const piece = data.slice(off, off + chunk);
      const last = off + piece.length >= data.length;
      const resp = withResp || (mode === 'auto' && last && !!props.write);
      return writeOne(c, piece, resp).then(() => {
        off += piece.length;
        retries = 0;
        if (onProgress) {
          try { onProgress(off, data.length); } catch (e) { /* callback della pagina */ }
        }
        return pause && !last ? delay(pause).then(step) : step();
      }, (e) => {
        const msg = (e && e.message) || '';
        const transient = /operation failed for unknown reason|already in progress/i.test(msg);
        if (transient && retries < 3) {
          // Il pezzo non e partito (collegamento occupato): si ritenta lo stesso pezzo.
          retries++;
          return delay(80 * retries).then(step);
        }
        const connected = state.device && state.device.gatt.connected;
        if (off === 0 && withResp && chunk > 20 && connected &&
            (e.name === 'NotSupportedError' || e.name === 'InvalidModificationError' || transient)) {
          // Primo pezzo rifiutato anche dopo i tentativi (spesso una scrittura lunga che il
          // firmware non gestisce): con conferma non e stato stampato nulla, si scende a 20 byte.
          chunk = 20;
          retries = 0;
          if (mode === 'auto') save({ chunk: 20 });
          return step();
        }
        throw e;
      });
    }
    return step();
  }

  function waitAdvertisement(d, ms) {
    if (!d.watchAdvertisements) return Promise.resolve();
    return new Promise((resolve) => {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let done = false;
      let timer = null;
      function finish() {
        if (done) return;
        done = true;
        if (timer !== null) cancel(timer);
        try { d.removeEventListener('advertisementreceived', finish); } catch (e) { /* niente */ }
        try { if (ctl) ctl.abort(); } catch (e) { /* niente */ }
        resolve();
      }
      d.addEventListener('advertisementreceived', finish);
      timer = later(finish, ms);
      try {
        const p = d.watchAdvertisements(ctl ? { signal: ctl.signal } : undefined);
        if (p && p.catch) p.catch(finish);
      } catch (e) { finish(); }
    });
  }

  const api = {
    profiles: BLE_PROFILES,
    optionalServices: BLE_OPTIONAL,
    filters: BLE_FILTERS,
    // Web Bluetooth c'e (Chrome Android e desktop; non Safari iOS ne Firefox).
    supported() {
      const b = bluetooth();
      return !!(b && b.requestDevice);
    },
    // Radio Bluetooth presente (null se non si puo sapere).
    available() {
      const b = bluetooth();
      if (!b || !b.getAvailability) return Promise.resolve(null);
      try {
        return Promise.resolve(b.getAvailability()).catch(() => null);
      } catch (e) { return Promise.resolve(null); }
    },
    // Il browser puo ricordare la stampante tra una visita e l'altra (getDevices). Su Chrome
    // stabile richiede chrome://flags/#enable-web-bluetooth-new-permissions-backend.
    canRemember() {
      const b = bluetooth();
      return !!(b && typeof b.getDevices === 'function');
    },
    saved,
    info,
    on(fn) {
      state.listeners.push(fn);
      return () => { state.listeners = state.listeners.filter((f) => f !== fn); };
    },
    // Va chiamata DIRETTAMENTE nel gestore di un tocco: il chooser richiede un gesto utente.
    // opts.sameName: solo la stampante gia usata (un tocco); opts.all: tutti i dispositivi.
    pair(opts) {
      const o = opts || {};
      if (!api.supported()) {
        return Promise.reject(bleError('unsupported', 'Web Bluetooth not available in this browser'));
      }
      const s = saved() || {};
      const options = o.all
        ? { acceptAllDevices: true, optionalServices: BLE_OPTIONAL.slice() }
        : (o.sameName && s.name)
          ? { filters: [{ name: s.name }], optionalServices: BLE_OPTIONAL.slice() }
          : { filters: BLE_FILTERS.map((f) => Object.assign({}, f)), optionalServices: BLE_OPTIONAL.slice() };
      let req;
      try {
        req = bluetooth().requestDevice(options);
      } catch (e) {
        return Promise.reject(e);
      }
      return Promise.resolve(req).then((device) => {
        // Un'altra stampante: le scelte manuali fatte per la precedente non valgono piu.
        if (s.name && device.name && s.name !== device.name) clearSaved();
        adopt(device);
        save({ name: device.name || null, id: device.id });
        return ensure();
      }).then(info);
    },
    // Senza gesto: riusa la stampante di questa pagina o, se il browser lo permette, quella
    // ricordata. Restituisce null se serve un tocco (pair con sameName).
    reconnect() {
      if (state.device) return ensure().then(info);
      const s = saved();
      if (!s || !api.canRemember()) return Promise.resolve(null);
      return Promise.resolve(bluetooth().getDevices()).then((list) => {
        const d = list.filter((x) => s.id && x.id === s.id)[0] ||
          list.filter((x) => s.name && x.name === s.name)[0];
        if (!d) return null;
        adopt(d);
        return waitAdvertisement(d, ADVERTISEMENT_WAIT_MS).then(ensure).then(info);
      });
    },
    // Stampa i byte del driver. opts.onProgress(inviati, totali). Le stampe vanno in coda.
    // opts.chunkSize / chunkDelayMs / withoutResponse / finalDelayMs: trasporto di questo lavoro
    // (vedi jobTransport); senza, la strategia automatica (o la modalita scelta con setWriteMode).
    print(bytes, opts) {
      const o = opts || {};
      const transport = jobTransport(o);
      function job() {
        if (!state.device) return Promise.reject(bleError('no-device', 'no printer paired'));
        return ensure().then(() => {
          setStatus('printing');
          return write(bytes, o.onProgress, transport);
        }).then((r) => {
          setStatus('ready');
          return r;
        }, (e) => {
          const connected = state.device && state.device.gatt.connected;
          setStatus(connected ? 'ready' : 'disconnected', e);
          throw e;
        });
      }
      const p = state.queue.then(job, job);
      state.queue = p.catch(() => {});
      return p;
    },
    disconnect() {
      const d = state.device;
      try { if (d && d.gatt.connected) d.gatt.disconnect(); } catch (e) { /* gia scollegata */ }
      setStatus('disconnected');
    },
    // Dimentica la stampante (anche nel browser, se supportato).
    forget() {
      const d = state.device;
      clearSaved();
      if (d) {
        try { d.removeEventListener('gattserverdisconnected', onDisconnect); } catch (e) { /* niente */ }
        try { if (d.gatt.connected) d.gatt.disconnect(); } catch (e) { /* niente */ }
      }
      state.device = null;
      state.server = null;
      state.char = null;
      state.profile = null;
      setStatus('idle');
      return d && d.forget ? Promise.resolve(d.forget()).catch(() => {}) : Promise.resolve();
    },
    // Diagnostica: servizi e caratteristiche visibili, con le proprieta.
    // Lo stato finale e 'ready' se c'e un canale di stampa, altrimenti 'error' con il motivo
    // (il bridge usava 'connected', che il contratto web non prevede).
    describe() {
      return connectRaw().then((server) => server.getPrimaryServices()).then((services) => {
        return Promise.all(services.map((svc) => svc.getCharacteristics().then((list) => ({
          service: svc.uuid,
          characteristics: list.map((c) => {
            const p = c.properties || {};
            return { uuid: c.uuid, write: !!p.write, writeWithoutResponse: !!p.writeWithoutResponse, notify: !!p.notify, read: !!p.read };
          })
        }), () => ({ service: svc.uuid, characteristics: [] }))));
      }).then((list) => {
        if (state.char) {
          setStatus('ready');
          return list;
        }
        // Nessun canale scelto su questa connessione: lo si cerca ora, cosi lo stato dice la verita.
        return pick(state.server).then(() => { setStatus('ready'); return list; },
          (e) => { setStatus('error', e); return list; });
      }, (e) => {
        setStatus('error', e);
        throw e;
      });
    },
    // Scelta manuale del canale (dalla diagnostica), ricordata per questa stampante.
    useCharacteristic(serviceUuid, charUuid) {
      save({ service: serviceUuid, characteristic: charUuid, chunk: null });
      state.char = null;
      if (!state.server) return Promise.resolve(info());
      return pick(state.server).then(() => { setStatus('ready'); return info(); },
        (e) => { setStatus('error', e); throw e; });
    },
    // 'auto' | 'response-100' | 'response-20' | 'noresponse-20'
    setWriteMode(mode) {
      save({ writeMode: WRITE_MODES.indexOf(mode) >= 0 ? mode : 'auto', chunk: null });
      setStatus(state.status, state.lastError);
    },
    // Profili del driver scelto, provati per primi alla prossima scelta del canale (dopo quelli
    // del modello riconosciuto dal nome). null = nessuna preferenza.
    preferProfiles(profiles) {
      state.preferred = Array.isArray(profiles) && profiles.length > 0 ? profiles.slice() : null;
    },
    // Driver scelto a mano per la stampante ricordata: come le altre scelte manuali si perde
    // dimenticandola o abbinandone un'altra, cosi il riconoscimento dal nome torna a decidere.
    manualDriver() {
      const s = saved() || {};
      return typeof s.driver === 'string' ? s.driver : null;
    },
    setManualDriver(id) {
      save({ driver: typeof id === 'string' && id !== '' ? id : null });
    },
    jobTransport,
    errorCode
  };
  return api;
}

/** Istanza condivisa dall'app: una sola stampante, una sola coda. */
export const Ble = createBle();

export default Ble;
