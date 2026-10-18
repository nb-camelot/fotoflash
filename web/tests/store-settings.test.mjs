// Test dello store delle impostazioni (web/src/store/settings.js) con uno shim di localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSettings,
  defaultSettings,
  normalizeSettings,
  mergeSettings,
  parseStoredSettings,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
} from '../src/store/settings.js';

/** localStorage minimo su una Map; `failGet`/`failSet` simulano storage bloccato o pieno. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    failGet: false,
    failSet: false,
    getItem(k) {
      if (this.failGet) throw new Error('SecurityError');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (this.failSet) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

function storeOn(storage, extra = {}) {
  return createSettings({ storage: () => storage, locks: () => null, listenStorage: false, ...extra });
}

function saved(storage) {
  return JSON.parse(storage.map.get(SETTINGS_KEY));
}

test('i default coincidono con AppSettings.kt (+ autoDownloadCaptures)', () => {
  assert.deepEqual(defaultSettings(), {
    onboardingDone: false,
    paper: 'MM58',
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
    autoDownloadCaptures: false,
  });
  // I campi solo Android non esistono sul web.
  for (const k of ['printerAddress', 'printerName', 'chunkSize', 'chunkDelayMs', 'autoSaveCaptures']) {
    assert.equal(k in DEFAULT_SETTINGS, false, k);
  }
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS) && Object.isFrozen(DEFAULT_SETTINGS.tone));
});

test('storage vuoto: default, e nessuna scrittura finché non si cambia qualcosa', () => {
  const storage = memoryStorage();
  const s = storeOn(storage);
  assert.deepEqual(s.get(), defaultSettings());
  assert.equal(storage.map.size, 0);
});

test('merge con i default: campi mancanti, sconosciuti e non validi', () => {
  const storage = memoryStorage({
    [SETTINGS_KEY]: JSON.stringify({
      paper: 'MM80',
      dither: 'SPIRAL', // enum sconosciuto → default
      template: 'STRIP',
      feedLines: 999, // → 255
      heatLevel: -3, // → 0
      bandHeight: 0, // → 1
      timerSeconds: 3.6, // intero → 4
      stripShots: 9, // → 4
      copies: 0, // → 1
      printCounter: -5, // → 0
      eventTitle: 42, // non stringa → default
      hashtag: '#festa',
      showDate: 'yes', // non booleano → default
      cutPaper: true,
      tone: { brightness: 3, gamma: 'NaN', sharpen: 0.2, extra: 1 },
      printerAddress: 'AA:BB', // campo Android: scartato
      futureField: { a: 1 },
    }),
  });
  const v = storeOn(storage).get();
  assert.equal(v.paper, 'MM80');
  assert.equal(v.dither, 'ATKINSON');
  assert.equal(v.template, 'STRIP');
  assert.equal(v.feedLines, 255);
  assert.equal(v.heatLevel, 0);
  assert.equal(v.bandHeight, 1);
  assert.equal(v.timerSeconds, 4);
  assert.equal(v.stripShots, 4);
  assert.equal(v.copies, 1);
  assert.equal(v.printCounter, 0);
  assert.equal(v.eventTitle, '');
  assert.equal(v.hashtag, '#festa');
  assert.equal(v.showDate, true);
  assert.equal(v.cutPaper, true);
  assert.deepEqual(v.tone, { ...DEFAULT_SETTINGS.tone, brightness: 1, sharpen: 0.2 });
  assert.equal('printerAddress' in v, false);
  assert.equal('futureField' in v, false);
  assert.equal('extra' in v.tone, false);
  assert.deepEqual(Object.keys(v), Object.keys(DEFAULT_SETTINGS));
});

test('JSON rovinato o non oggetto: si riparte dai default', () => {
  for (const bad of ['{nope', '[]', '42', 'null', '']) {
    const storage = memoryStorage({ [SETTINGS_KEY]: bad });
    assert.deepEqual(storeOn(storage).get(), defaultSettings(), bad);
  }
  assert.equal(parseStoredSettings(undefined), null);
});

test('normalizeSettings: NaN/Infinity e stringhe numeriche', () => {
  const v = normalizeSettings({ copies: '3', feedLines: Infinity, tone: { contrast: '-0.5', gamma: NaN } });
  assert.equal(v.copies, 3);
  assert.equal(v.feedLines, 4);
  assert.equal(v.tone.contrast, -0.5);
  assert.equal(v.tone.gamma, 1.25);
  assert.equal(normalizeSettings({ copies: '' }).copies, 1);
});

test('update con patch: persiste, tone si fonde campo per campo, valori non validi restano quelli attuali', () => {
  const storage = memoryStorage();
  const s = storeOn(storage);
  s.update({ tone: { brightness: 0.3, sharpen: 0.9 }, paper: 'MM80' });
  s.update({ tone: { brightness: -0.2 } });
  const v = s.get();
  assert.equal(v.tone.brightness, -0.2);
  assert.equal(v.tone.sharpen, 0.9);
  assert.equal(v.tone.gamma, 1.25);
  assert.equal(v.paper, 'MM80');
  // enum non valido in una patch: si tiene il valore attuale, non il default
  s.update({ paper: 'A4', copies: 12 });
  assert.equal(s.get().paper, 'MM80');
  assert.equal(s.get().copies, 5);
  assert.deepEqual(saved(storage), s.get());
});

test('update con funzione: patch restituita, oggetto intero o bozza modificata', () => {
  const s = storeOn(memoryStorage());
  const r1 = s.update((cur) => ({ copies: cur.copies + 1 }));
  assert.equal(r1.copies, 2);
  s.update((cur) => ({ ...cur, eventTitle: 'Festa' }));
  assert.equal(s.get().eventTitle, 'Festa');
  s.update((draft) => {
    draft.tone.shadows = 0.8;
    draft.showDate = false;
  });
  assert.equal(s.get().tone.shadows, 0.8);
  assert.equal(s.get().showDate, false);
  // argomenti senza senso non cambiano nulla
  assert.deepEqual(s.update(null), s.get());
  assert.deepEqual(s.update(7), s.get());
});

test('get restituisce copie: modificarle non tocca lo store', () => {
  const s = storeOn(memoryStorage());
  const v = s.get();
  v.copies = 4;
  v.tone.brightness = 1;
  assert.equal(s.get().copies, 1);
  assert.equal(s.get().tone.brightness, 0);
});

test('subscribe: notifica solo i cambiamenti, unsubscribe, errori isolati', () => {
  const s = storeOn(memoryStorage());
  const seen = [];
  s.subscribe(() => {
    throw new Error('subscriber rotto');
  });
  const unsubscribe = s.subscribe((v) => seen.push(v.copies));
  assert.deepEqual(seen, [], 'nessuna chiamata alla sottoscrizione');
  const origError = console.error;
  console.error = () => {};
  try {
    s.update({ copies: 2 });
    s.update({ copies: 2 }); // nessun cambiamento → nessuna notifica
    s.update({ copies: 3 });
    unsubscribe();
    s.update({ copies: 4 });
  } finally {
    console.error = origError;
  }
  assert.deepEqual(seen, [2, 3]);
  assert.equal(typeof s.subscribe(null), 'function');
});

test('nextPrintNumber: incrementa, salva, notifica e restituisce il nuovo numero', async () => {
  const storage = memoryStorage();
  const s = storeOn(storage);
  const seen = [];
  s.subscribe((v) => seen.push(v.printCounter));
  assert.equal(await s.nextPrintNumber(), 1);
  assert.equal(await s.nextPrintNumber(), 2);
  const [a, b] = await Promise.all([s.nextPrintNumber(), s.nextPrintNumber()]);
  assert.deepEqual([a, b], [3, 4]);
  assert.equal(saved(storage).printCounter, 4);
  assert.deepEqual(seen, [1, 2, 3, 4]);
  // Un nuovo store sullo stesso storage (ricarica della pagina) riparte da lì.
  assert.equal(await storeOn(storage).nextPrintNumber(), 5);
});

test('nextPrintNumber rilegge il valore salvato da un\'altra scheda', async () => {
  const storage = memoryStorage();
  const tabA = storeOn(storage);
  const tabB = storeOn(storage);
  tabA.get();
  tabB.get();
  assert.equal(await tabA.nextPrintNumber(), 1);
  assert.equal(await tabB.nextPrintNumber(), 2);
  assert.equal(await tabA.nextPrintNumber(), 3);
});

test('nextPrintNumber usa Web Locks quando ci sono', async () => {
  const requested = [];
  const locks = {
    async request(name, cb) {
      requested.push(name);
      return cb();
    },
  };
  const s = createSettings({ storage: () => memoryStorage(), locks: () => locks, listenStorage: false });
  assert.equal(await s.nextPrintNumber(), 1);
  assert.deepEqual(requested, ['fotoflash.printCounter']);
  // Lock non disponibile (rifiutato prima di partire): si incrementa lo stesso, una volta sola.
  const broken = { request: async () => { throw new Error('SecurityError'); } };
  const s2 = createSettings({ storage: () => memoryStorage(), locks: () => broken, listenStorage: false });
  assert.equal(await s2.nextPrintNumber(), 1);
  assert.equal(s2.get().printCounter, 1);
});

test('reset: default, salvati e notificati', () => {
  const storage = memoryStorage({ [SETTINGS_KEY]: '{rotto' });
  const s = storeOn(storage);
  s.update({ paper: 'MM80', printCounter: 41, onboardingDone: true, tone: { gamma: 2 } });
  let notified = 0;
  s.subscribe(() => notified++);
  const v = s.reset();
  assert.deepEqual(v, defaultSettings());
  assert.deepEqual(saved(storage), defaultSettings());
  assert.equal(notified, 1);
  // Reset sopra un JSON rovinato con lo stato già ai default: si riscrive comunque.
  const storage2 = memoryStorage({ [SETTINGS_KEY]: '{rotto' });
  storeOn(storage2).reset();
  assert.deepEqual(saved(storage2), defaultSettings());
});

test('senza localStorage funziona in memoria', async () => {
  const s = createSettings({ storage: () => null, locks: () => null, listenStorage: false });
  s.update({ hashtag: '#gita' });
  assert.equal(s.get().hashtag, '#gita');
  assert.equal(await s.nextPrintNumber(), 1);
  assert.equal(await s.nextPrintNumber(), 2);
  assert.deepEqual(s.reset(), defaultSettings());
});

test('localStorage che lancia (bloccato o pieno): si continua in memoria', async () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const blocked = memoryStorage();
    blocked.failGet = true;
    blocked.failSet = true;
    const s = storeOn(blocked);
    assert.deepEqual(s.get(), defaultSettings());
    s.update({ copies: 3 });
    assert.equal(s.get().copies, 3);
    assert.equal(await s.nextPrintNumber(), 1);

    // Lettura ok ma scrittura fallita: la memoria è più avanti dello storage, non va persa.
    const full = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ printCounter: 10 }) });
    const s2 = storeOn(full);
    assert.equal(s2.get().printCounter, 10);
    full.failSet = true;
    assert.equal(await s2.nextPrintNumber(), 11);
    assert.equal(await s2.nextPrintNumber(), 12);
    assert.equal(s2.get().printCounter, 12);
  } finally {
    console.warn = origWarn;
  }
});

test('mergeSettings non modifica gli argomenti', () => {
  const cur = defaultSettings();
  const patch = { tone: { brightness: 0.5 } };
  const next = mergeSettings(cur, patch);
  assert.equal(next.tone.brightness, 0.5);
  assert.equal(cur.tone.brightness, 0);
  assert.deepEqual(patch, { tone: { brightness: 0.5 } });
});

test('il singleton non tocca localStorage al caricamento e poi lo usa', async () => {
  const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ paper: 'MM80' }) });
  let reads = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      reads++;
      return storage;
    },
  });
  try {
    const mod = await import(`../src/store/settings.js?singleton=${Date.now()}`);
    assert.equal(reads, 0, 'nessun accesso a localStorage durante l\'import');
    assert.equal(mod.settings.get().paper, 'MM80');
    assert.ok(reads > 0);
    mod.settings.update({ copies: 2 });
    assert.equal(saved(storage).copies, 2);
    assert.equal(await mod.settings.nextPrintNumber(), 1);
  } finally {
    delete globalThis.localStorage;
  }
});

test('sincronizzazione tra schede con l\'evento storage', () => {
  const storage = memoryStorage();
  const handlers = [];
  const origAdd = globalThis.addEventListener;
  globalThis.addEventListener = (type, fn) => {
    if (type === 'storage') handlers.push(fn);
  };
  try {
    const s = createSettings({ storage: () => storage, locks: () => null });
    const seen = [];
    s.subscribe((v) => seen.push(v.eventTitle));
    assert.equal(handlers.length, 1);
    // Un'altra scheda scrive.
    storage.map.set(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), eventTitle: 'Matrimonio' }));
    handlers[0]({ key: SETTINGS_KEY, storageArea: storage });
    handlers[0]({ key: 'altro', storageArea: storage }); // chiave diversa: ignorata
    assert.equal(s.get().eventTitle, 'Matrimonio');
    assert.deepEqual(seen, ['Matrimonio']);
  } finally {
    if (origAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = origAdd;
  }
});
