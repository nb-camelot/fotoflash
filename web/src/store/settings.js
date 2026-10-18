// Impostazioni persistenti della PWA: porting di SettingsRepository (Android).
// Un unico oggetto JSON in localStorage 'fotoflash.settings'. Lettura sempre "riparata":
// campi mancanti → default, sconosciuti → scartati, fuori range → riportati nel range
// (stessi limiti di SettingsRepository.toAppSettings). Senza localStorage (modalità privata,
// iframe sandbox, quota piena) lo store continua a funzionare in memoria.

export const SETTINGS_KEY = 'fotoflash.settings';

// Stesse stringhe degli enum Kotlin (vedi core/model.js): copiate qui perché lo store
// deve caricarsi anche se il motore non c'è.
export const PAPERS = Object.freeze(['MM58', 'MM80', 'M02PRO']);
export const DITHERS = Object.freeze(['ATKINSON', 'FLOYD_STEINBERG', 'ORDERED_BAYER', 'THRESHOLD']);
export const TEMPLATES = Object.freeze(['POLAROID', 'FULL', 'STRIP', 'RECEIPT']);

/**
 * Driver di stampa (docs/DRIVERS.md) e carta su cui stampa ciascuno: la carta discende dal
 * driver. Copia degli id di printer/drivers/, per lo stesso motivo degli enum qui sopra.
 */
export const DRIVER_PAPER = Object.freeze({
  'escpos-58': 'MM58',
  'escpos-80': 'MM80',
  'phomemo-m02': 'MM58',
  'phomemo-m02pro': 'M02PRO',
});
export const PRINTER_DRIVERS = Object.freeze(Object.keys(DRIVER_PAPER));

/** Larghezze della riga ammesse per la Phomemo M02 Pro (byte): 72 = 576 punti, 78 = 624. */
export const PHOMEMO_WIDTH_BYTES = Object.freeze([72, 78]);

/** Carta del driver [id]; un id sconosciuto vale come escpos-58. */
export function paperForDriver(id) {
  return Object.prototype.hasOwnProperty.call(DRIVER_PAPER, id) ? DRIVER_PAPER[id] : DRIVER_PAPER['escpos-58'];
}

/**
 * Driver per la carta [paper] quando a cambiare è la carta: resta [currentId] se stampa già su
 * quella carta, altrimenti l'ESC/POS della stessa larghezza (M02PRO → phomemo-m02pro).
 */
export function driverForPaper(paper, currentId = 'escpos-58') {
  if (paperForDriver(currentId) === paper && PRINTER_DRIVERS.includes(currentId)) return currentId;
  if (paper === 'MM80') return 'escpos-80';
  if (paper === 'M02PRO') return 'phomemo-m02pro';
  return 'escpos-58';
}

// Int di Kotlin: il contatore non può superarlo nemmeno qui.
const INT_MAX = 2147483647;
const LOCK_NAME = 'fotoflash.printCounter';

/** Limiti dei campi numerici, utili anche alla UI per slider e stepper. */
export const SETTINGS_RANGES = Object.freeze({
  feedLines: Object.freeze({ min: 0, max: 255 }),
  heatLevel: Object.freeze({ min: 0, max: 4 }),
  bandHeight: Object.freeze({ min: 1, max: 1024 }),
  printCounter: Object.freeze({ min: 0, max: INT_MAX }),
  timerSeconds: Object.freeze({ min: 0, max: 60 }),
  stripShots: Object.freeze({ min: 2, max: 4 }),
  copies: Object.freeze({ min: 1, max: 5 }),
  // Invio BLE: byte per scrittura (20 = carico utile con l'MTU minimo, 512 = massimo di Web
  // Bluetooth) e pausa tra due scritture; stessi limiti di PrinterTuning.kt (BLE_CHUNK_*, BLE_DELAY_*).
  bleChunkSize: Object.freeze({ min: 20, max: 512 }),
  bleChunkDelayMs: Object.freeze({ min: 0, max: 100 }),
  // Phomemo: densità del comando 1F 11 02, velocità del comando 1B 4E 0D (sperimentale).
  phomemoDensity: Object.freeze({ min: 1, max: 15 }),
  printerSpeed: Object.freeze({ min: 1, max: 5 }),
  tone: Object.freeze({
    brightness: Object.freeze({ min: -1, max: 1 }),
    contrast: Object.freeze({ min: -1, max: 1 }),
    gamma: Object.freeze({ min: 0.4, max: 2.5 }),
    sharpen: Object.freeze({ min: 0, max: 1 }),
    shadows: Object.freeze({ min: 0, max: 1 }),
    localContrast: Object.freeze({ min: 0, max: 1 }),
  }),
});

/** Default allineati a model/AppSettings.kt (+ autoDownloadCaptures, solo web). */
export const DEFAULT_SETTINGS = deepFreeze({
  onboardingDone: false,
  paper: 'MM58',
  // Driver di stampa; la carta lo segue (DRIVER_PAPER). null = predefiniti del driver.
  printerDriver: 'escpos-58',
  bleChunkSize: null,
  bleChunkDelayMs: null,
  bleWithoutResponse: null,
  phomemoDensity: null,
  phomemoWidthBytes: 72,
  printerSpeed: null,
  feedLines: 4,
  cutPaper: false,
  heatLevel: 0,
  bandHeight: 24,
  dither: 'ATKINSON',
  tone: {
    brightness: 0,
    contrast: 0.15,
    gamma: 1.25,
    autoLevels: true,
    sharpen: 0.5,
    shadows: 0.25,
    localContrast: 0.35,
    autoBacklight: true,
  },
  template: 'POLAROID',
  eventTitle: '',
  hashtag: '',
  showDate: true,
  showPrintNumber: true,
  printCounter: 0,
  instantPrint: false,
  timerSeconds: 0,
  stripShots: 3,
  shutterSound: true,
  livePreview: true,
  copies: 1,
  // Sul web "salva in galleria" è un download a ogni scatto: spento di default.
  autoDownloadCaptures: false,
});

// --- validatori: (valore grezzo, valore di ripiego) → valore valido -------------------

const bool = () => (v, fb) => (typeof v === 'boolean' ? v : fb);
const str = () => (v, fb) => (typeof v === 'string' ? v : fb);
const oneOf = (values) => (v, fb) => (values.includes(v) ? v : fb);

// Accetta anche stringhe numeriche: i valori degli <input type="range"> sono stringhe.
function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

const int = ({ min, max }) => (v, fb) => {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const float = ({ min, max }) => (v, fb) => {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(max, Math.max(min, n));
};

// Campi "Int?" e "Boolean?" di Kotlin: null è un valore valido (= predefinito del driver).
const nullableInt = (range) => {
  const check = int(range);
  return (v, fb) => (v === null ? null : check(v, fb));
};
const nullableBool = () => (v, fb) => (v === null || typeof v === 'boolean' ? v : fb);
// Intero tra pochi valori ammessi (anche da stringa numerica).
const intOneOf = (values) => (v, fb) => {
  const n = toNumber(v);
  return values.includes(n) ? n : fb;
};

const R = SETTINGS_RANGES;

const TONE_SCHEMA = {
  brightness: float(R.tone.brightness),
  contrast: float(R.tone.contrast),
  gamma: float(R.tone.gamma),
  autoLevels: bool(),
  sharpen: float(R.tone.sharpen),
  shadows: float(R.tone.shadows),
  localContrast: float(R.tone.localContrast),
  autoBacklight: bool(),
};

const SCHEMA = {
  onboardingDone: bool(),
  paper: oneOf(PAPERS),
  printerDriver: oneOf(PRINTER_DRIVERS),
  bleChunkSize: nullableInt(R.bleChunkSize),
  bleChunkDelayMs: nullableInt(R.bleChunkDelayMs),
  bleWithoutResponse: nullableBool(),
  phomemoDensity: nullableInt(R.phomemoDensity),
  phomemoWidthBytes: intOneOf(PHOMEMO_WIDTH_BYTES),
  printerSpeed: nullableInt(R.printerSpeed),
  feedLines: int(R.feedLines),
  cutPaper: bool(),
  heatLevel: int(R.heatLevel),
  bandHeight: int(R.bandHeight),
  dither: oneOf(DITHERS),
  tone: null, // annidato: vedi normalizeSettings
  template: oneOf(TEMPLATES),
  eventTitle: str(),
  hashtag: str(),
  showDate: bool(),
  showPrintNumber: bool(),
  printCounter: int(R.printCounter),
  instantPrint: bool(),
  timerSeconds: int(R.timerSeconds),
  stripShots: int(R.stripShots),
  shutterSound: bool(),
  livePreview: bool(),
  copies: int(R.copies),
  autoDownloadCaptures: bool(),
};

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (isObject(v)) deepFreeze(v);
  return Object.freeze(o);
}

/** Copia indipendente: chi la riceve può modificarla senza toccare lo store. */
function cloneSettings(s) {
  return { ...s, tone: { ...s.tone } };
}

/** Copia modificabile dei default. */
export function defaultSettings() {
  return cloneSettings(DEFAULT_SETTINGS);
}

/**
 * Riporta un oggetto qualsiasi a impostazioni valide e complete. Ogni valore non valido
 * prende quello di `base` (i default al caricamento, lo stato attuale negli aggiornamenti).
 * I campi escono sempre nello stesso ordine: il confronto via JSON è affidabile.
 */
export function normalizeSettings(raw, base = DEFAULT_SETTINGS) {
  const src = isObject(raw) ? raw : {};
  const out = {};
  for (const [key, check] of Object.entries(SCHEMA)) {
    if (key === 'tone') {
      const tone = isObject(src.tone) ? src.tone : {};
      out.tone = {};
      for (const [tk, tcheck] of Object.entries(TONE_SCHEMA)) out.tone[tk] = tcheck(tone[tk], base.tone[tk]);
    } else {
      out[key] = check(src[key], base[key]);
    }
  }
  // La carta discende dal driver. Senza un driver valido (impostazioni salvate prima dei driver)
  // lo si ricava dalla carta: chi stampava su 80 mm resta su 80 mm.
  if (!PRINTER_DRIVERS.includes(src.printerDriver)) out.printerDriver = driverForPaper(out.paper, out.printerDriver);
  out.paper = paperForDriver(out.printerDriver);
  return out;
}

/**
 * Applica una patch parziale alle impostazioni correnti. `tone` si fonde campo per campo:
 * aggiornare la luminosità non deve azzerare le altre regolazioni. Carta e driver restano
 * allineati: se la patch cambia il driver la carta lo segue; se cambia solo la carta, il driver
 * diventa quello di quella carta (escpos-58 ↔ MM58, escpos-80 ↔ MM80, phomemo-m02pro ↔ M02PRO).
 */
export function mergeSettings(current, patch) {
  if (!isObject(patch)) return normalizeSettings(current, current);
  const merged = { ...current, ...patch };
  merged.tone = isObject(patch.tone) ? { ...current.tone, ...patch.tone } : current.tone;
  const driverInPatch = PRINTER_DRIVERS.includes(patch.printerDriver);
  if (!driverInPatch && PAPERS.includes(patch.paper)) merged.printerDriver = driverForPaper(patch.paper, current.printerDriver);
  return normalizeSettings(merged, current);
}

/** Legge il JSON salvato; null se manca o è illeggibile. */
export function parseStoredSettings(text) {
  if (typeof text !== 'string' || text === '') return null;
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function defaultStorage() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    // Accedere a localStorage può lanciare (iframe sandbox, cookie bloccati).
    return null;
  }
}

function defaultLocks() {
  try {
    const locks = globalThis.navigator?.locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

/**
 * Crea uno store indipendente. L'app usa il singleton `settings`; le opzioni servono ai test.
 * @param {{ key?: string, storage?: () => Storage|null, locks?: () => LockManager|null,
 *           listenStorage?: boolean }} [options]
 */
export function createSettings(options = {}) {
  const key = options.key ?? SETTINGS_KEY;
  const getStorage = options.storage ?? defaultStorage;
  const getLocks = options.locks ?? defaultLocks;
  const listenStorage = options.listenStorage ?? true;

  const listeners = new Set();
  let state = null;
  // true quando la copia in memoria coincide con quella salvata: solo allora si può rileggere.
  let synced = false;
  let warned = false;

  function warnOnce(message, error) {
    if (warned) return;
    warned = true;
    console.warn(`[settings] ${message}`, error ?? '');
  }

  function readStored() {
    const storage = getStorage();
    if (!storage) return { ok: false, value: null };
    try {
      return { ok: true, value: parseStoredSettings(storage.getItem(key)) };
    } catch (e) {
      warnOnce('localStorage illeggibile, impostazioni solo in memoria', e);
      return { ok: false, value: null };
    }
  }

  function writeStored(next) {
    const storage = getStorage();
    if (!storage) {
      synced = false;
      return;
    }
    try {
      storage.setItem(key, JSON.stringify(next));
      synced = true;
    } catch (e) {
      // Quota piena o storage bloccato: si continua in memoria.
      synced = false;
      warnOnce('impostazioni non salvate, restano in memoria', e);
    }
  }

  function ensure() {
    if (state) return;
    const { ok, value } = readStored();
    state = normalizeSettings(value);
    synced = ok;
    if (listenStorage) attachStorageListener();
  }

  // Un'altra scheda (o la PWA installata) ha cambiato le impostazioni: ci si allinea.
  function attachStorageListener() {
    try {
      if (typeof globalThis.addEventListener !== 'function') return;
      globalThis.addEventListener('storage', (event) => {
        if (event.key !== key && event.key !== null) return;
        const storage = getStorage();
        if (!storage || (event.storageArea && event.storageArea !== storage)) return;
        resync();
      });
    } catch {
      // Ambienti senza eventi globali: nessuna sincronizzazione tra schede.
    }
  }

  function resync() {
    const { ok, value } = readStored();
    if (!ok) return;
    const next = normalizeSettings(value);
    synced = true;
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    notify();
  }

  function notify() {
    for (const fn of [...listeners]) {
      try {
        fn(cloneSettings(state));
      } catch (e) {
        console.error('[settings] errore in un subscriber', e);
      }
    }
  }

  // force: riscrive anche se non cambia nulla (reset sopra un JSON salvato rovinato).
  function commit(next, force = false) {
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    if (!changed && !force) return false;
    state = next;
    writeStored(state);
    if (changed) notify();
    return changed;
  }

  // Incremento atomico: rilegge il valore salvato (un'altra scheda può averlo fatto avanzare),
  // incrementa e salva senza attese in mezzo.
  function bump() {
    ensure();
    if (synced) {
      const { ok, value } = readStored();
      if (ok && value) state = normalizeSettings(value);
    }
    const n = Math.min(INT_MAX, Math.max(0, state.printCounter) + 1);
    commit({ ...cloneSettings(state), printCounter: n });
    return n;
  }

  return {
    /** Copia delle impostazioni correnti. */
    get() {
      ensure();
      return cloneSettings(state);
    },

    /**
     * patch parziale ({ paper: 'MM80' }, { tone: { brightness: 0.2 } }) oppure funzione
     * (copia delle impostazioni) → patch/oggetto intero, o nulla se ha modificato la copia.
     * Restituisce le impostazioni risultanti; notifica solo se qualcosa è cambiato.
     */
    update(patchOrFn) {
      ensure();
      let patch = patchOrFn;
      if (typeof patchOrFn === 'function') {
        const draft = cloneSettings(state);
        const result = patchOrFn(draft);
        patch = isObject(result) ? result : draft;
      }
      if (isObject(patch)) commit(mergeSettings(state, patch));
      return cloneSettings(state);
    },

    /** fn(impostazioni) a ogni cambiamento (non subito). → unsubscribe */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      ensure();
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    /** Incrementa il contatore delle stampe, lo salva e restituisce il nuovo numero. */
    async nextPrintNumber() {
      const locks = getLocks();
      if (locks) {
        // Web Locks: atomico anche tra più schede aperte sullo stesso sito.
        let ran = false;
        try {
          return await locks.request(LOCK_NAME, () => {
            ran = true;
            return bump();
          });
        } catch (e) {
          if (ran) throw e;
        }
      }
      return bump();
    },

    /** Tutte le impostazioni ai valori predefiniti (contatore e onboarding compresi). */
    reset() {
      ensure();
      commit(defaultSettings(), true);
      return cloneSettings(state);
    },
  };
}

/** Lo store dell'app. Non tocca localStorage finché non lo si usa. */
export const settings = createSettings();
