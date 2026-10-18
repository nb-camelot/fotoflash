// Storico delle stampe nel browser: porting di HistoryRepository (Android).
// IndexedDB 'fotoflash' v1:
// - 'entries': i dati della voce (keyPath id, indice createdAt);
// - 'blobs': "<id>/print.png" (1 px = 1 punto: si ristampa identica da qui) e
//   "<id>/photo_<n>.jpg" (gli originali a colori, n da 1).
// Voce e file si scrivono in un'unica transazione: o c'è tutto o non c'è niente, come il
// meta.json scritto per ultimo su Android. Senza IndexedDB (modalità privata, browser
// vecchi) lo storico vive in memoria per la sessione e `history.persistent` è false.

export const DB_NAME = 'fotoflash';
export const DB_VERSION = 1;
export const ENTRIES_STORE = 'entries';
export const BLOBS_STORE = 'blobs';
export const MAX_ENTRIES = 200;

// Stesse stringhe di TemplateKind (core/model.js).
const TEMPLATES = ['POLAROID', 'FULL', 'STRIP', 'RECEIPT'];
// L'id finisce nell'URL (#/history/<id>) e nelle chiavi dei blob: niente '/' né altro.
const ID_RE = /^[a-z0-9-]{1,64}$/;
const PHOTO_RE = /\/photo_(\d+)\.jpg$/;
const OPEN_TIMEOUT_MS = 5000;
const CHANNEL_NAME = 'fotoflash.history';

// --- funzioni pure (testate in Node) ---------------------------------------------------

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function printKey(id) {
  return `${id}/print.png`;
}

export function photoKey(id, n) {
  return `${id}/photo_${n}.jpg`;
}

/** Estremi delle chiavi dei blob di una voce: "<id>/" … "<id>/\uffff". Escape, non il carattere nudo: gli editor lo perdono. */
export function blobKeyBounds(id) {
  return [`${id}/`, `${id}/\uffff`];
}

/** Id della voce a cui appartiene una chiave di blob, null se la chiave non è nostra. */
export function entryIdOfKey(key) {
  if (typeof key !== 'string') return null;
  const slash = key.indexOf('/');
  return slash > 0 ? key.slice(0, slash) : null;
}

/** Numero della foto in "<id>/photo_<n>.jpg", null per le altre chiavi. */
export function photoIndexOfKey(key) {
  const m = typeof key === 'string' ? PHOTO_RE.exec(key) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Chiave d'ordine della voce nuova: coincide con createdAt finché l'orologio va avanti, ma
 * cresce sempre. Con l'ora del dispositivo tornata indietro le stampe nuove restano in cima e
 * non vengono potate come "le più vecchie" (stessa regola di HistoryRepository).
 */
export function nextSeq(lastSeq, now) {
  return Math.max((Number.isFinite(lastSeq) ? lastSeq : 0) + 1, now);
}

function orderKey(e) {
  return Number.isFinite(e.seq) ? e.seq : e.createdAt;
}

/** Più recenti prima: seq, poi createdAt, poi id (ordine stabile anche a parità). */
export function compareEntries(a, b) {
  return (orderKey(b) - orderKey(a)) || (b.createdAt - a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export function sortEntries(list) {
  return [...list].sort(compareEntries);
}

/**
 * Tiene al massimo `max` voci, le più recenti. `protectId` (la voce appena aggiunta) non si
 * pota mai: si scartano solo le altre. → { keep (ordinate), evict }
 */
export function pruneEntries(list, max = MAX_ENTRIES, protectId = null) {
  const sorted = sortEntries(list);
  const protectedEntry = protectId == null ? null : sorted.find((e) => e.id === protectId) ?? null;
  let room = Math.max(0, Math.floor(max)) - (protectedEntry ? 1 : 0);
  const keep = [];
  const evict = [];
  for (const e of sorted) {
    if (e === protectedEntry) {
      keep.push(e);
    } else if (room > 0) {
      keep.push(e);
      room -= 1;
    } else {
      evict.push(e);
    }
  }
  return { keep, evict };
}

/** Voce valida e completa a partire da dati salvati o in ingresso; null se inutilizzabile. */
export function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object' || !isValidId(raw.id)) return null;
  if (!Number.isFinite(raw.createdAt)) return null;
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    seq: Number.isFinite(raw.seq) ? raw.seq : raw.createdAt,
    // Un modello sconosciuto (rinominato in futuro) torna Polaroid, come su Android.
    template: TEMPLATES.includes(raw.template) ? raw.template : 'POLAROID',
    caption: typeof raw.caption === 'string' ? raw.caption : '',
    printNumber: Number.isInteger(raw.printNumber) && raw.printNumber >= 0 ? raw.printNumber : null,
    printed: raw.printed === true,
    photoCount: Number.isInteger(raw.photoCount) && raw.photoCount >= 0 ? raw.photoCount : 0,
  };
}

/**
 * Dal contenuto grezzo del database alle voci da mostrare e alle pulizie da fare:
 * voci illeggibili o senza print.png, voci oltre il massimo, blob orfani.
 * → { entries (ordinate), dropIds (chiavi di voci da eliminare), orphanKeys }
 */
export function planLoad(rawEntries, blobKeys, max = MAX_ENTRIES) {
  const keySet = new Set(blobKeys.filter((k) => typeof k === 'string'));
  const photoCounts = new Map();
  for (const k of keySet) {
    if (photoIndexOfKey(k) == null) continue;
    const id = entryIdOfKey(k);
    photoCounts.set(id, (photoCounts.get(id) ?? 0) + 1);
  }
  const valid = new Map();
  const dropIds = [];
  for (const raw of rawEntries) {
    const entry = normalizeEntry(raw);
    if (entry && valid.has(entry.id)) continue; // doppione: la chiave è unica, non succede
    if (!entry || !keySet.has(printKey(entry.id))) {
      // Senza la stampa la voce non si può mostrare né ristampare: meglio liberare spazio.
      if (raw && raw.id != null) dropIds.push(raw.id);
      continue;
    }
    // Il numero di foto si ricava da quello che c'è davvero.
    entry.photoCount = photoCounts.get(entry.id) ?? 0;
    valid.set(entry.id, entry);
  }
  const { keep, evict } = pruneEntries([...valid.values()], max);
  for (const e of evict) dropIds.push(e.id);
  const kept = new Set(keep.map((e) => e.id));
  const orphanKeys = [...keySet].filter((k) => !kept.has(entryIdOfKey(k)));
  return { entries: keep, dropIds, orphanKeys };
}

// --- utilità ---------------------------------------------------------------------------

function isBlob(v) {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

function copy(entry) {
  return { ...entry };
}

/** UUID v4: randomUUID esiste solo in contesti sicuri, getRandomValues anche su http. */
export function randomId() {
  const c = globalThis.crypto;
  try {
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // Contesto non sicuro: si ripiega sotto.
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- backend in memoria -----------------------------------------------------------------

function memoryBackend() {
  const entries = new Map();
  const blobs = new Map();

  function drop(id) {
    entries.delete(id);
    const prefix = `${id}/`;
    for (const k of [...blobs.keys()]) if (k.startsWith(prefix)) blobs.delete(k);
  }

  return {
    persistent: false,
    async load() {
      return { entries: [...entries.values()].map(copy), blobKeys: [...blobs.keys()] };
    },
    async commitAdd(entry, files, evictIds) {
      for (const id of evictIds) drop(id);
      entries.set(entry.id, copy(entry));
      for (const [k, b] of files) blobs.set(k, b);
    },
    async putEntry(entry) {
      entries.set(entry.id, copy(entry));
    },
    async removeEntry(id) {
      drop(id);
    },
    async purge(entryIds, blobKeys) {
      for (const id of entryIds) entries.delete(id);
      for (const k of blobKeys) blobs.delete(k);
    },
    async clearAll() {
      entries.clear();
      blobs.clear();
    },
    async getBlob(key) {
      return blobs.get(key) ?? null;
    },
    async getBlobs(id) {
      const prefix = `${id}/`;
      return [...blobs.entries()].filter(([k]) => k.startsWith(prefix));
    },
  };
}

// --- backend IndexedDB ------------------------------------------------------------------

function upgrade(db) {
  if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
    const entries = db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' });
    entries.createIndex('createdAt', 'createdAt');
  }
  if (!db.objectStoreNames.contains(BLOBS_STORE)) db.createObjectStore(BLOBS_STORE);
}

/** Apre il database; rifiuta anche se l'apertura non risponde (alcune modalità private). */
function openDb(factory, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return false;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
      return true;
    };
    let req;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (e) {
      // Firefox in navigazione privata (versioni vecchie) lancia subito.
      finish(reject, e);
      return;
    }
    timer = setTimeout(() => finish(reject, new Error('IndexedDB: apertura senza risposta')), timeoutMs);
    req.onupgradeneeded = () => {
      try {
        upgrade(req.result);
      } catch (e) {
        try {
          req.transaction?.abort();
        } catch {
          // già annullata
        }
        finish(reject, e);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Arrivata dopo il timeout: lo storico è già in memoria, il database non serve più.
      if (!finish(resolve, db)) db.close();
    };
    req.onerror = (event) => {
      event?.preventDefault?.();
      finish(reject, req.error ?? new Error('IndexedDB: apertura fallita'));
    };
    // onblocked: un'altra scheda tiene aperta una versione vecchia; si aspetta (c'è il timeout).
  });
}

/**
 * Esegue `fn(tx)` in una transazione e risolve al commit con il risultato di `fn`
 * (se è una funzione, viene chiamata al commit: serve a leggere i risultati delle richieste).
 * Dentro `fn` niente await: la transazione si chiuderebbe da sola.
 */
function runTx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let tx;
    let result;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => {
      try {
        resolve(typeof result === 'function' ? result() : result);
      } catch (e) {
        reject(e);
      }
    };
    // Un errore di una richiesta annulla la transazione: si rifiuta in onabort, una volta sola.
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: transazione annullata'));
    try {
      result = fn(tx);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // già chiusa
      }
      reject(e);
    }
  });
}

function idbBackend(factory, keyRange, firstDb, timeoutMs, onDeleted) {
  let current = null;
  let opening = null;

  function adopt(db) {
    current = db;
    // Un'altra scheda vuole aggiornare lo schema, o il browser ha chiuso il database
    // (dati del sito cancellati): si molla l'handle e alla prossima operazione si riapre.
    db.onversionchange = (event) => {
      db.close();
      if (current === db) current = null;
      // newVersion null = deleteDatabase (es. "Cancella dati"): le voci in memoria non valgono più.
      if (event && event.newVersion === null && typeof onDeleted === 'function') onDeleted();
    };
    db.onclose = () => {
      if (current === db) current = null;
    };
    return db;
  }

  adopt(firstDb);

  // Più letture insieme (le miniature) dopo una chiusura: una sola riapertura, niente handle orfani.
  function db() {
    if (current) return Promise.resolve(current);
    opening ??= openDb(factory, timeoutMs).then(adopt).finally(() => {
      opening = null;
    });
    return opening;
  }

  function rangeOf(id) {
    const [lower, upper] = blobKeyBounds(id);
    return keyRange.bound(lower, upper);
  }

  return {
    persistent: true,
    async load() {
      return runTx(await db(), [ENTRIES_STORE, BLOBS_STORE], 'readonly', (tx) => {
        const entries = tx.objectStore(ENTRIES_STORE).getAll();
        const keys = tx.objectStore(BLOBS_STORE).getAllKeys();
        return () => ({ entries: entries.result ?? [], blobKeys: keys.result ?? [] });
      });
    },
    async commitAdd(entry, files, evictIds) {
      return runTx(await db(), [ENTRIES_STORE, BLOBS_STORE], 'readwrite', (tx) => {
        const entries = tx.objectStore(ENTRIES_STORE);
        const blobs = tx.objectStore(BLOBS_STORE);
        for (const id of evictIds) {
          entries.delete(id);
          blobs.delete(rangeOf(id));
        }
        for (const [k, b] of files) blobs.put(b, k);
        entries.put(entry);
      });
    },
    async putEntry(entry) {
      return runTx(await db(), [ENTRIES_STORE], 'readwrite', (tx) => {
        tx.objectStore(ENTRIES_STORE).put(entry);
      });
    },
    async removeEntry(id) {
      return runTx(await db(), [ENTRIES_STORE, BLOBS_STORE], 'readwrite', (tx) => {
        tx.objectStore(ENTRIES_STORE).delete(id);
        tx.objectStore(BLOBS_STORE).delete(rangeOf(id));
      });
    },
    async purge(entryIds, blobKeys) {
      return runTx(await db(), [ENTRIES_STORE, BLOBS_STORE], 'readwrite', (tx) => {
        const entries = tx.objectStore(ENTRIES_STORE);
        const blobs = tx.objectStore(BLOBS_STORE);
        for (const id of entryIds) entries.delete(id);
        for (const k of blobKeys) blobs.delete(k);
      });
    },
    async clearAll() {
      return runTx(await db(), [ENTRIES_STORE, BLOBS_STORE], 'readwrite', (tx) => {
        tx.objectStore(ENTRIES_STORE).clear();
        tx.objectStore(BLOBS_STORE).clear();
      });
    },
    async getBlob(key) {
      return runTx(await db(), [BLOBS_STORE], 'readonly', (tx) => {
        const req = tx.objectStore(BLOBS_STORE).get(key);
        return () => req.result ?? null;
      });
    },
    async getBlobs(id) {
      return runTx(await db(), [BLOBS_STORE], 'readonly', (tx) => {
        const store = tx.objectStore(BLOBS_STORE);
        const keys = store.getAllKeys(rangeOf(id));
        const values = store.getAll(rangeOf(id));
        // Stesso intervallo, stesso ordine: chiavi e valori si accoppiano per posizione.
        return () => (keys.result ?? []).map((k, i) => [k, values.result[i]]);
      });
    },
  };
}

async function openBackend(factory, keyRange, timeoutMs, onDeleted) {
  if (!factory || typeof factory.open !== 'function' || !keyRange || typeof keyRange.bound !== 'function') {
    return memoryBackend();
  }
  try {
    return idbBackend(factory, keyRange, await openDb(factory, timeoutMs), timeoutMs, onDeleted);
  } catch (e) {
    console.warn('[history] IndexedDB non disponibile: storico solo in memoria', e);
    return memoryBackend();
  }
}

function defaultFactory() {
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    // Alcuni browser lanciano già leggendo indexedDB con i cookie bloccati.
    return null;
  }
}

function defaultKeyRange() {
  try {
    return globalThis.IDBKeyRange ?? null;
  } catch {
    return null;
  }
}

// --- store ------------------------------------------------------------------------------

/**
 * Crea uno storico indipendente. L'app usa il singleton `history`; le opzioni servono ai test.
 * @param {{ indexedDB?: IDBFactory|null, IDBKeyRange?: object, max?: number,
 *           now?: () => number, newId?: () => string, openTimeoutMs?: number,
 *           channelName?: string|null }} [options]
 */
export function createHistory(options = {}) {
  const channelName = 'channelName' in options ? options.channelName : CHANNEL_NAME;
  const getFactory = 'indexedDB' in options ? () => options.indexedDB : defaultFactory;
  const getKeyRange = 'IDBKeyRange' in options ? () => options.IDBKeyRange : defaultKeyRange;
  const max = options.max ?? MAX_ENTRIES;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? randomId;
  const openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS;

  const listeners = new Set();
  let backend = null;
  let cache = [];
  let lastSeq = 0;
  let readyPromise = null;
  let queue = Promise.resolve();
  let channel = null;

  function ready() {
    readyPromise ??= init();
    return readyPromise;
  }

  async function init() {
    backend = await openBackend(getFactory(), getKeyRange(), openTimeoutMs, onDatabaseDeleted);
    try {
      await reload(true);
    } catch (e) {
      if (!backend.persistent) throw e;
      // Database aperto ma illeggibile: per questa sessione meglio la memoria che niente.
      console.warn('[history] storico illeggibile: si continua in memoria', e);
      backend = memoryBackend();
      cache = [];
    }
    if (backend.persistent) openChannel();
  }

  // Database eliminato da fuori (deleteDatabase): lo storico in memoria va svuotato.
  function onDatabaseDeleted() {
    serial(async () => {
      if (cache.length === 0) return;
      cache = [];
      notify();
    }).catch(() => {});
  }

  /** Rilegge dal backend; con `clean` elimina voci rotte, eccedenti e blob orfani. */
  async function reload(clean) {
    const snapshot = await backend.load();
    const plan = planLoad(snapshot.entries, snapshot.blobKeys, max);
    cache = plan.entries;
    lastSeq = cache.reduce((m, e) => Math.max(m, e.seq), lastSeq);
    if (clean && (plan.dropIds.length > 0 || plan.orphanKeys.length > 0)) {
      try {
        await backend.purge(plan.dropIds, plan.orphanKeys);
      } catch (e) {
        console.warn('[history] pulizia dello storico non riuscita', e);
      }
    }
  }

  // Più schede (o la PWA installata e il browser) sullo stesso database: chi scrive avvisa
  // le altre, che rileggono. Senza BroadcastChannel ognuna resta con la sua copia.
  function openChannel() {
    try {
      if (!channelName || typeof BroadcastChannel !== 'function') return;
      channel = new BroadcastChannel(channelName);
      // Solo in Node (test): il canale non deve tenere vivo il processo.
      channel.unref?.();
      channel.onmessage = () => {
        serial(async () => {
          await reload(false);
          notify();
        }).catch((e) => console.warn('[history] aggiornamento da un\'altra scheda non riuscito', e));
      };
    } catch {
      channel = null;
    }
  }

  function broadcast() {
    try {
      channel?.postMessage('changed');
    } catch {
      // canale chiuso: le altre schede si allineeranno al prossimo avvio
    }
  }

  // Le scritture passano una alla volta: la potatura si calcola sempre sullo stato vero.
  function serial(op) {
    const run = queue.then(op);
    queue = run.catch(() => {});
    return run;
  }

  function notify() {
    for (const fn of [...listeners]) {
      try {
        fn(cache.map(copy));
      } catch (e) {
        console.error('[history] errore in un subscriber', e);
      }
    }
  }

  function find(id) {
    return cache.find((e) => e.id === id) ?? null;
  }

  function uniqueId() {
    for (;;) {
      const id = String(newId()).toLowerCase();
      if (isValidId(id) && !find(id)) return id;
    }
  }

  return {
    /** false se lo storico vive solo in memoria (esatto dopo la prima operazione attesa). */
    get persistent() {
      return backend ? backend.persistent : getFactory() != null && getKeyRange() != null;
    },

    /** Attende l'apertura dello storico; → persistent. */
    async ready() {
      await ready();
      return backend.persistent;
    },

    /** Voci più recenti prima. */
    async list() {
      await ready();
      return cache.map(copy);
    },

    async get(id) {
      if (!isValidId(id)) return null;
      await ready();
      const entry = find(id);
      return entry ? copy(entry) : null;
    },

    /**
     * Registra una stampa (anche solo salvata). → la voce creata.
     * Rifiuta se l'archivio non riesce a scriverla: la stampa non deve dipenderne,
     * chi chiama gestisce l'errore.
     */
    async add({ printPng, originals = [], template, caption = '', printNumber = null, printed = false } = {}) {
      if (!isBlob(printPng)) throw new TypeError('history.add: printPng deve essere un Blob');
      const photos = (Array.isArray(originals) ? originals : []).filter(isBlob);
      return serial(async () => {
        await ready();
        const createdAt = now();
        const seq = nextSeq(lastSeq, createdAt);
        const id = uniqueId();
        const entry = normalizeEntry({
          id,
          createdAt,
          seq,
          template,
          caption: typeof caption === 'string' ? caption : '',
          printNumber,
          printed: printed === true,
          photoCount: photos.length,
        });
        const files = [[printKey(id), printPng], ...photos.map((b, i) => [photoKey(id, i + 1), b])];
        const { keep, evict } = pruneEntries([...cache, entry], max, id);
        await backend.commitAdd(entry, files, evict.map((e) => e.id));
        lastSeq = Math.max(lastSeq, seq);
        cache = keep;
        notify();
        broadcast();
        return copy(entry);
      });
    },

    /** Segna la voce come stampata. → la voce aggiornata, null se non esiste. */
    async markPrinted(id) {
      if (!isValidId(id)) return null;
      return serial(async () => {
        await ready();
        const current = find(id);
        if (!current) return null;
        if (current.printed) return copy(current);
        const updated = { ...current, printed: true };
        await backend.putEntry(updated);
        cache = cache.map((e) => (e.id === id ? updated : e));
        notify();
        broadcast();
        return copy(updated);
      });
    },

    /** Elimina la voce e i suoi file. → true se c'era. */
    async remove(id) {
      if (!isValidId(id)) return false;
      return serial(async () => {
        await ready();
        const existed = find(id) != null;
        // Si cancella anche se non è in elenco: toglie eventuali file rimasti orfani.
        await backend.removeEntry(id);
        if (!existed) return false;
        cache = cache.filter((e) => e.id !== id);
        notify();
        broadcast();
        return true;
      });
    },

    /**
     * Svuota lo storico, voci e file, in una transazione (extra rispetto a WEB.md: serve a
     * "Cancella dati"). Le altre schede si allineano con il canale, senza chiudere il database.
     */
    async clear() {
      return serial(async () => {
        await ready();
        await backend.clearAll();
        const had = cache.length > 0;
        cache = [];
        if (had) notify();
        broadcast();
      });
    },

    /** PNG della stampa (1 px = 1 punto), null se manca. */
    async printBlob(id) {
      if (!isValidId(id)) return null;
      await ready();
      try {
        const blob = await backend.getBlob(printKey(id));
        return isBlob(blob) ? blob : null;
      } catch (e) {
        console.warn(`[history] stampa ${id} illeggibile`, e);
        return null;
      }
    },

    /** Foto originali nell'ordine degli scatti; [] se non ce ne sono. */
    async originals(id) {
      if (!isValidId(id)) return [];
      await ready();
      try {
        const pairs = await backend.getBlobs(id);
        return pairs
          .map(([k, b]) => [photoIndexOfKey(k), b])
          .filter(([n, b]) => n != null && isBlob(b))
          .sort((a, b) => a[0] - b[0])
          .map(([, b]) => b);
      } catch (e) {
        console.warn(`[history] originali di ${id} illeggibili`, e);
        return [];
      }
    },

    /** fn(voci, più recenti prima) a ogni cambiamento (non subito). → unsubscribe */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** Lo storico dell'app. Non apre IndexedDB finché non lo si usa. */
export const history = createHistory();
