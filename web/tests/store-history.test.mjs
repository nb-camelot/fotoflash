// Test dello storico (web/src/store/history.js): logica pura, modalità in memoria e il
// percorso IndexedDB su un finto IndexedDB minimo (transazioni atomiche, chiavi ordinate).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHistory,
  isValidId,
  printKey,
  photoKey,
  blobKeyBounds,
  entryIdOfKey,
  photoIndexOfKey,
  nextSeq,
  sortEntries,
  pruneEntries,
  normalizeEntry,
  planLoad,
  randomId,
  MAX_ENTRIES,
} from '../src/store/history.js';

// --- utilità ---------------------------------------------------------------------------

const png = (label = 'print') => new Blob([label], { type: 'image/png' });
const jpg = (label) => new Blob([label], { type: 'image/jpeg' });

function entry(id, createdAt, extra = {}) {
  return { id, createdAt, seq: createdAt, template: 'POLAROID', caption: '', printNumber: null, printed: false, photoCount: 0, ...extra };
}

/** Orologio finto: ogni chiamata restituisce il valore successivo della lista (poi l'ultimo). */
function clock(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Id deterministici e validi: e001, e002, … */
function counterIds(prefix = 'e') {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(3, '0')}`;
}

async function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}

// --- finto IndexedDB -------------------------------------------------------------------
// Solo ciò che usa history.js. Le scritture vanno su una copia e si applicano al commit:
// un errore annulla tutta la transazione, come nel browser.

class FakeKeyRange {
  constructor(lower, upper) {
    this.lower = lower;
    this.upper = upper;
  }
  static bound(lower, upper) {
    return new FakeKeyRange(lower, upper);
  }
  includes(k) {
    return k >= this.lower && k <= this.upper;
  }
}

const matches = (query, key) => (query instanceof FakeKeyRange ? query.includes(key) : query === key);
const sortedKeys = (map) => [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

class FakeStore {
  constructor(tx, name) {
    this.tx = tx;
    this.def = tx.db.rec.stores.get(name);
    this.data = tx.work.get(name);
  }
  put(value, key) {
    if (this.tx.mode !== 'readwrite') throw new Error('ReadOnlyError');
    const k = this.def.keyPath ? value[this.def.keyPath] : key;
    const stored = this.def.keyPath ? structuredClone(value) : value;
    return this.tx.request(() => {
      if (this.tx.db.factory.failPut?.(k)) throw new Error('QuotaExceededError');
      this.data.set(k, stored);
      return k;
    });
  }
  get(key) {
    return this.tx.request(() => {
      const v = this.data.get(key);
      return v !== undefined && this.def.keyPath ? structuredClone(v) : v;
    });
  }
  delete(query) {
    if (this.tx.mode !== 'readwrite') throw new Error('ReadOnlyError');
    return this.tx.request(() => {
      for (const k of [...this.data.keys()]) if (matches(query, k)) this.data.delete(k);
    });
  }
  clear() {
    if (this.tx.mode !== 'readwrite') throw new Error('ReadOnlyError');
    return this.tx.request(() => {
      this.data.clear();
    });
  }
  getAllKeys(query) {
    return this.tx.request(() => sortedKeys(this.data).filter((k) => query === undefined || matches(query, k)));
  }
  getAll(query) {
    return this.tx.request(() =>
      sortedKeys(this.data)
        .filter((k) => query === undefined || matches(query, k))
        .map((k) => (this.def.keyPath ? structuredClone(this.data.get(k)) : this.data.get(k))),
    );
  }
}

class FakeTx {
  constructor(db, names, mode) {
    this.db = db;
    this.names = names;
    this.mode = mode;
    this.pending = 0;
    this.done = false;
    this.error = null;
    this.oncomplete = null;
    this.onabort = null;
    this.work = new Map(names.map((n) => [n, new Map(db.rec.stores.get(n).data)]));
    setTimeout(() => this.maybeFinish());
  }
  objectStore(name) {
    if (!this.names.includes(name)) throw new Error('NotFoundError');
    return new FakeStore(this, name);
  }
  request(fn) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    this.pending++;
    queueMicrotask(() => {
      if (this.done) return;
      try {
        req.result = fn();
      } catch (e) {
        req.error = e;
        this.error = e;
        this.pending--;
        this.abort();
        return;
      }
      this.pending--;
      req.onsuccess?.({});
      setTimeout(() => this.maybeFinish());
    });
    return req;
  }
  maybeFinish() {
    if (this.done || this.pending > 0) return;
    this.done = true;
    if (this.mode === 'readwrite') for (const [n, m] of this.work) this.db.rec.stores.get(n).data = m;
    this.oncomplete?.({});
  }
  abort() {
    if (this.done) throw new Error('InvalidStateError');
    this.done = true;
    setTimeout(() => this.onabort?.({}));
  }
}

class FakeDB {
  constructor(factory, rec) {
    this.factory = factory;
    this.rec = rec;
    this.closed = false;
    this.onclose = null;
    this.onversionchange = null;
  }
  get objectStoreNames() {
    const names = [...this.rec.stores.keys()];
    return { contains: (n) => names.includes(n) };
  }
  createObjectStore(name, opts = {}) {
    const store = { keyPath: opts.keyPath ?? null, data: new Map(), indexes: new Set() };
    this.rec.stores.set(name, store);
    return { createIndex: (indexName) => store.indexes.add(indexName) };
  }
  transaction(names, mode = 'readonly') {
    if (this.closed) throw new Error('InvalidStateError');
    return new FakeTx(this, [].concat(names), mode);
  }
  close() {
    this.closed = true;
  }
}

function fakeIndexedDB({ open = 'ok' } = {}) {
  const factory = {
    databases: new Map(),
    handles: [],
    opened: 0,
    failPut: null,
    open(name, version) {
      factory.opened++;
      if (open === 'throw') throw new Error('InvalidStateError');
      const req = { result: null, error: null, transaction: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => {
        if (open === 'hang') return;
        if (open === 'error') {
          req.error = new Error('UnknownError');
          req.onerror?.({ preventDefault() {} });
          return;
        }
        let rec = factory.databases.get(name);
        if (!rec) {
          rec = { version: 0, stores: new Map() };
          factory.databases.set(name, rec);
        }
        const db = new FakeDB(factory, rec);
        factory.handles.push(db);
        req.result = db;
        if (rec.version < version) {
          rec.version = version;
          req.onupgradeneeded?.({});
        }
        req.onsuccess?.({});
      });
      return req;
    },
    /** Contenuto di uno store del database 'fotoflash'. */
    store(name) {
      return factory.databases.get('fotoflash')?.stores.get(name)?.data ?? new Map();
    },
  };
  return factory;
}

// Un canale per database finto: le "schede" dello stesso test si parlano, i test no.
let channels = 0;
function idbHistory(factory, extra = {}) {
  factory.channelName ??= `fotoflash.history.test${++channels}`;
  return createHistory({
    indexedDB: factory,
    IDBKeyRange: FakeKeyRange,
    newId: counterIds(),
    channelName: factory.channelName,
    ...extra,
  });
}

// --- funzioni pure ---------------------------------------------------------------------

test('chiavi dei blob e id', () => {
  assert.equal(printKey('abc'), 'abc/print.png');
  assert.equal(photoKey('abc', 1), 'abc/photo_1.jpg');
  assert.deepEqual(blobKeyBounds('abc'), ['abc/', 'abc/\uffff']);
  assert.equal(entryIdOfKey('abc/photo_2.jpg'), 'abc');
  assert.equal(entryIdOfKey('senza-barra'), null);
  assert.equal(photoIndexOfKey('abc/photo_12.jpg'), 12);
  assert.equal(photoIndexOfKey('abc/print.png'), null);
  // "abc-1/…" non cade nell'intervallo di "abc"
  const [lo, hi] = blobKeyBounds('abc');
  const inRange = (k) => k >= lo && k <= hi;
  assert.ok(inRange('abc/print.png') && inRange('abc/photo_3.jpg'));
  assert.ok(!inRange('abc-1/print.png') && !inRange('abcd/print.png') && !inRange('ab/print.png'));
  assert.ok(isValidId('0f8e2a3c-1b2d-4c5e-9f00-112233445566'));
  for (const bad of ['', 'A', 'a/b', '../x', 'a b', 'x'.repeat(65), 42, null]) assert.equal(isValidId(bad), false, String(bad));
});

test('randomId: UUID v4 valido e diverso ogni volta, anche senza randomUUID', () => {
  const ids = new Set(Array.from({ length: 200 }, () => randomId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(isValidId(id), id);
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (a) => desc.get ? desc.get.call(globalThis).getRandomValues(a) : desc.value.getRandomValues(a) },
  });
  try {
    const id = randomId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', desc);
  }
});

test('nextSeq cresce sempre, anche con l\'orologio indietro', () => {
  assert.equal(nextSeq(0, 1000), 1000);
  assert.equal(nextSeq(1000, 1000), 1001);
  assert.equal(nextSeq(5000, 1000), 5001);
  assert.equal(nextSeq(NaN, 7), 7);
});

test('sortEntries: più recenti prima, ordine stabile a parità', () => {
  const list = [entry('a', 1), entry('c', 3), entry('b', 2), entry('d', 2, { seq: 9 }), entry('e', 3)];
  assert.deepEqual(sortEntries(list).map((e) => e.id), ['d', 'e', 'c', 'b', 'a']);
  assert.deepEqual(list.map((e) => e.id), ['a', 'c', 'b', 'd', 'e'], 'non modifica l\'input');
  // Senza seq si usa createdAt.
  const noSeq = [{ ...entry('x', 5), seq: undefined }, entry('y', 6)];
  assert.deepEqual(sortEntries(noSeq).map((e) => e.id), ['y', 'x']);
});

test('pruneEntries: tiene le più recenti, non pota mai la voce protetta', () => {
  const list = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, i));
  const r = pruneEntries(list, 3);
  assert.deepEqual(r.keep.map((e) => e.id), ['e4', 'e3', 'e2']);
  assert.deepEqual(r.evict.map((e) => e.id), ['e1', 'e0']);
  // La voce protetta è la più vecchia: resta, e si scarta una delle altre al suo posto.
  const p = pruneEntries(list, 3, 'e0');
  assert.deepEqual(p.keep.map((e) => e.id), ['e4', 'e3', 'e0']);
  assert.deepEqual(p.evict.map((e) => e.id), ['e2', 'e1']);
  assert.deepEqual(pruneEntries(list, 10).evict, []);
  assert.deepEqual(pruneEntries([], 3), { keep: [], evict: [] });
  assert.deepEqual(pruneEntries(list, 0, 'e3').keep.map((e) => e.id), ['e3']);
  assert.equal(MAX_ENTRIES, 200);
});

test('normalizeEntry ripara o scarta', () => {
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry({ id: 'BAD/ID', createdAt: 1 }), null);
  assert.equal(normalizeEntry({ id: 'ok', createdAt: 'ieri' }), null);
  assert.deepEqual(normalizeEntry({ id: 'ok', createdAt: 10, template: 'SPIRAL', caption: 5, printNumber: 1.5, printed: 'yes', photoCount: -1, extra: 1 }), {
    id: 'ok',
    createdAt: 10,
    seq: 10,
    template: 'POLAROID',
    caption: '',
    printNumber: null,
    printed: false,
    photoCount: 0,
  });
  assert.equal(normalizeEntry({ id: 'ok', createdAt: 10, printNumber: 42, template: 'RECEIPT' }).printNumber, 42);
});

test('planLoad: voci senza stampa, eccedenti, illeggibili e blob orfani', () => {
  const raws = [
    entry('a', 1),
    entry('b', 2),
    entry('c', 3),
    entry('d', 4),
    entry('nostampa', 5),
    { id: 'BAD', createdAt: 1 },
  ];
  const keys = [
    'a/print.png', 'b/print.png', 'b/photo_1.jpg', 'b/photo_2.jpg', 'c/print.png', 'd/print.png',
    'nostampa/photo_1.jpg', 'orfano/print.png',
  ];
  const plan = planLoad(raws, keys, 3);
  assert.deepEqual(plan.entries.map((e) => e.id), ['d', 'c', 'b']);
  assert.equal(plan.entries.find((e) => e.id === 'b').photoCount, 2, 'contate dai blob reali');
  assert.deepEqual(plan.dropIds.sort(), ['BAD', 'a', 'nostampa']);
  assert.deepEqual(plan.orphanKeys.sort(), ['a/print.png', 'nostampa/photo_1.jpg', 'orfano/print.png']);
});

// --- modalità in memoria (Node non ha IndexedDB) ------------------------------------------

test('senza IndexedDB: storico in memoria e persistent=false', async () => {
  const h = createHistory({ indexedDB: null });
  assert.equal(h.persistent, false);
  assert.equal(await h.ready(), false);
  assert.deepEqual(await h.list(), []);
});

test('add/list/get/printBlob/originals/markPrinted/remove', async () => {
  const h = createHistory({ indexedDB: null, now: clock(1000, 2000, 3000), newId: counterIds() });
  const photos = Array.from({ length: 11 }, (_, i) => jpg(`foto${i + 1}`));
  const a = await h.add({ printPng: png('A'), originals: photos, template: 'STRIP', caption: 'Festa', printNumber: 7, printed: true });
  assert.deepEqual(a, { id: 'e001', createdAt: 1000, seq: 1000, template: 'STRIP', caption: 'Festa', printNumber: 7, printed: true, photoCount: 11 });
  const b = await h.add({ printPng: png('B'), originals: ['non un blob', null, jpg('x')], template: 'NOPE' });
  assert.equal(b.template, 'POLAROID');
  assert.equal(b.photoCount, 1);
  assert.equal(b.printed, false);
  assert.equal(b.printNumber, null);

  assert.deepEqual((await h.list()).map((e) => e.id), ['e002', 'e001']);
  assert.deepEqual(await h.get('e001'), a);
  assert.equal(await h.get('manca'), null);
  assert.equal(await h.get('../x'), null);

  assert.equal(await (await h.printBlob('e001')).text(), 'A');
  assert.equal(await h.printBlob('manca'), null);
  // Ordine degli scatti numerico (photo_10 dopo photo_9), non alfabetico.
  const texts = await Promise.all((await h.originals('e001')).map((x) => x.text()));
  assert.deepEqual(texts, photos.map((_, i) => `foto${i + 1}`));
  assert.deepEqual(await h.originals('manca'), []);

  assert.equal((await h.markPrinted('e002')).printed, true);
  assert.equal((await h.get('e002')).printed, true);
  assert.equal(await h.markPrinted('manca'), null);

  assert.equal(await h.remove('e001'), true);
  assert.equal(await h.remove('e001'), false);
  assert.equal(await h.printBlob('e001'), null);
  assert.deepEqual(await h.originals('e001'), []);
  assert.deepEqual((await h.list()).map((e) => e.id), ['e002']);
});

test('le copie restituite non toccano lo storico', async () => {
  const h = createHistory({ indexedDB: null, newId: counterIds() });
  const e = await h.add({ printPng: png(), template: 'FULL' });
  e.caption = 'modificata';
  (await h.list())[0].printed = true;
  assert.equal((await h.get(e.id)).caption, '');
  assert.equal((await h.get(e.id)).printed, false);
});

test('add senza PNG valido rifiuta', async () => {
  const h = createHistory({ indexedDB: null });
  await assert.rejects(h.add({ printPng: 'data:image/png;base64,' }), TypeError);
  await assert.rejects(h.add(), TypeError);
});

test('id univoci: un id già usato o non valido si scarta', async () => {
  const ids = ['dup', 'dup', 'NON/VALIDO', 'nuovo'];
  const h = createHistory({ indexedDB: null, newId: () => ids.shift() });
  assert.equal((await h.add({ printPng: png() })).id, 'dup');
  assert.equal((await h.add({ printPng: png() })).id, 'nuovo');
  const r = createHistory({ indexedDB: null });
  const many = await Promise.all(Array.from({ length: 50 }, () => r.add({ printPng: png() })));
  assert.equal(new Set(many.map((e) => e.id)).size, 50);
});

test('stesso millisecondo e orologio indietro: la voce nuova resta in cima', async () => {
  const h = createHistory({ indexedDB: null, now: clock(5000, 5000, 1000), newId: counterIds() });
  await h.add({ printPng: png() });
  await h.add({ printPng: png() });
  await h.add({ printPng: png() });
  const list = await h.list();
  assert.deepEqual(list.map((e) => e.id), ['e003', 'e002', 'e001']);
  assert.deepEqual(list.map((e) => e.seq), [5002, 5001, 5000]);
  assert.equal(list[0].createdAt, 1000, 'createdAt resta l\'ora vera dello scatto');
});

test('massimo 200 voci: le più vecchie spariscono con i loro file', async () => {
  let t = 0;
  const h = createHistory({ indexedDB: null, now: () => ++t, newId: counterIds('v') });
  for (let i = 0; i < 201; i++) await h.add({ printPng: png(`p${i}`), originals: [jpg(`o${i}`)] });
  const list = await h.list();
  assert.equal(list.length, 200);
  assert.equal(list[0].id, 'v201');
  assert.equal(list.at(-1).id, 'v002');
  assert.equal(await h.get('v001'), null);
  assert.equal(await h.printBlob('v001'), null);
  assert.deepEqual(await h.originals('v001'), []);
});

test('add concorrenti: serializzate, nessuna persa', async () => {
  const h = createHistory({ indexedDB: null, max: 5 });
  await Promise.all(Array.from({ length: 12 }, (_, i) => h.add({ printPng: png(`p${i}`) })));
  assert.equal((await h.list()).length, 5);
});

test('clear: voci e file spariscono, una notifica sola', async () => {
  const h = createHistory({ indexedDB: null, newId: counterIds() });
  await h.add({ printPng: png('A'), originals: [jpg('a')] });
  await h.add({ printPng: png('B') });
  const seen = [];
  h.subscribe((list) => seen.push(list.length));
  await h.clear();
  assert.deepEqual(await h.list(), []);
  assert.equal(await h.printBlob('e001'), null);
  assert.deepEqual(await h.originals('e001'), []);
  await h.clear(); // già vuoto: nessuna notifica
  assert.deepEqual(seen, [0]);
  // Dopo la pulizia si continua a registrare normalmente.
  assert.equal((await h.add({ printPng: png('C') })).id, 'e003');
});

test('subscribe: lista ordinata a ogni cambiamento, non alla sottoscrizione', async () => {
  const h = createHistory({ indexedDB: null, now: clock(1, 2), newId: counterIds() });
  const seen = [];
  const err = console.error;
  console.error = () => {};
  try {
    h.subscribe(() => {
      throw new Error('subscriber rotto');
    });
    const unsubscribe = h.subscribe((list) => seen.push(list.map((e) => `${e.id}:${e.printed}`)));
    await Promise.resolve();
    assert.deepEqual(seen, []);
    await h.add({ printPng: png() });
    await h.add({ printPng: png() });
    await h.markPrinted('e001');
    await h.markPrinted('e001'); // già stampata: nessuna notifica
    await h.remove('manca'); // non c'era: nessuna notifica
    await h.remove('e002');
    unsubscribe();
    await h.add({ printPng: png() });
  } finally {
    console.error = err;
  }
  assert.deepEqual(seen, [['e001:false'], ['e002:false', 'e001:false'], ['e002:false', 'e001:true'], ['e001:true']]);
});

test('il singleton si importa senza toccare IndexedDB e in Node degrada in memoria', async () => {
  let reads = 0;
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get() {
      reads++;
      return undefined;
    },
  });
  try {
    const mod = await import(`../src/store/history.js?singleton=${Date.now()}`);
    assert.equal(reads, 0, 'nessun accesso a indexedDB durante l\'import');
    const e = await mod.history.add({ printPng: png('S'), template: 'RECEIPT', printNumber: 1 });
    assert.equal(mod.history.persistent, false);
    assert.equal((await mod.history.list())[0].id, e.id);
  } finally {
    delete globalThis.indexedDB;
  }
});

// --- percorso IndexedDB (finto) ---------------------------------------------------------

test('IndexedDB che non si apre: si degrada in memoria', async () => {
  await quietly(async () => {
    for (const open of ['throw', 'error', 'hang']) {
      const h = createHistory({ indexedDB: fakeIndexedDB({ open }), IDBKeyRange: FakeKeyRange, openTimeoutMs: 30 });
      assert.equal(h.persistent, true, 'prima di aprire si presume persistente');
      assert.equal(await h.ready(), false, open);
      assert.equal(h.persistent, false);
      const e = await h.add({ printPng: png() });
      assert.equal((await h.get(e.id)).id, e.id);
    }
  });
  // Senza IDBKeyRange non si usa IndexedDB.
  assert.equal(await createHistory({ indexedDB: fakeIndexedDB(), IDBKeyRange: null }).ready(), false);
});

test('IndexedDB: schema, scritture e rilettura da una nuova sessione', async () => {
  const idb = fakeIndexedDB();
  const h = idbHistory(idb, { now: clock(100, 200) });
  assert.equal(await h.ready(), true);
  const rec = idb.databases.get('fotoflash');
  assert.equal(rec.version, 1);
  assert.equal(rec.stores.get('entries').keyPath, 'id');
  assert.ok(rec.stores.get('entries').indexes.has('createdAt'));
  assert.equal(rec.stores.get('blobs').keyPath, null);

  await h.add({ printPng: png('uno'), originals: [jpg('a'), jpg('b')], template: 'STRIP', caption: 'Gita' });
  await h.add({ printPng: png('due'), template: 'RECEIPT', printNumber: 42, printed: true });
  assert.deepEqual(sortedKeys(idb.store('blobs')), ['e001/photo_1.jpg', 'e001/photo_2.jpg', 'e001/print.png', 'e002/print.png']);
  assert.equal(idb.store('entries').get('e001').caption, 'Gita');

  // Nuova sessione sullo stesso database.
  const again = idbHistory(idb);
  const list = await again.list();
  assert.deepEqual(list.map((e) => e.id), ['e002', 'e001']);
  assert.deepEqual(list[1], { id: 'e001', createdAt: 100, seq: 100, template: 'STRIP', caption: 'Gita', printNumber: null, printed: false, photoCount: 2 });
  assert.equal(await (await again.printBlob('e002')).text(), 'due');
  assert.deepEqual(await Promise.all((await again.originals('e001')).map((b) => b.text())), ['a', 'b']);

  await again.markPrinted('e001');
  assert.equal(idb.store('entries').get('e001').printed, true);
  await again.remove('e001');
  assert.deepEqual(sortedKeys(idb.store('blobs')), ['e002/print.png']);
  assert.deepEqual(sortedKeys(idb.store('entries')), ['e002']);
});

test('IndexedDB: la cancellazione per intervallo non tocca voci con id simili', async () => {
  const idb = fakeIndexedDB();
  const ids = ['abc', 'abc-1', 'abcd'];
  const h = idbHistory(idb, { newId: () => ids.shift() });
  for (let i = 0; i < 3; i++) await h.add({ printPng: png(), originals: [jpg('x')] });
  await h.remove('abc');
  assert.deepEqual(sortedKeys(idb.store('blobs')), ['abc-1/photo_1.jpg', 'abc-1/print.png', 'abcd/photo_1.jpg', 'abcd/print.png']);
});

test('IndexedDB: potatura nella stessa transazione dell\'aggiunta', async () => {
  const idb = fakeIndexedDB();
  let t = 0;
  const h = idbHistory(idb, { max: 3, now: () => ++t });
  for (let i = 0; i < 5; i++) await h.add({ printPng: png(`p${i}`), originals: [jpg(`o${i}`)] });
  assert.deepEqual(sortedKeys(idb.store('entries')), ['e003', 'e004', 'e005']);
  assert.deepEqual(sortedKeys(idb.store('blobs')), [
    'e003/photo_1.jpg', 'e003/print.png', 'e004/photo_1.jpg', 'e004/print.png', 'e005/photo_1.jpg', 'e005/print.png',
  ]);
});

test('IndexedDB: una scrittura fallita annulla tutta la voce e rifiuta', async () => {
  const idb = fakeIndexedDB();
  const h = idbHistory(idb);
  await h.add({ printPng: png('ok') });
  idb.failPut = (key) => key === 'e002/photo_2.jpg';
  await assert.rejects(h.add({ printPng: png('ko'), originals: [jpg('1'), jpg('2')] }), /QuotaExceededError/);
  assert.deepEqual(sortedKeys(idb.store('entries')), ['e001']);
  assert.deepEqual(sortedKeys(idb.store('blobs')), ['e001/print.png']);
  assert.deepEqual((await h.list()).map((e) => e.id), ['e001']);
  // Lo storico resta utilizzabile.
  idb.failPut = null;
  assert.equal((await h.add({ printPng: png('di nuovo') })).id, 'e003');
  assert.equal((await h.list()).length, 2);
});

test('IndexedDB: all\'apertura si puliscono voci rotte, eccedenti e blob orfani', async () => {
  const idb = fakeIndexedDB();
  const first = idbHistory(idb, { now: clock(1, 2, 3) });
  for (let i = 0; i < 3; i++) await first.add({ printPng: png(), originals: [jpg('x')] });
  // Danni simulati: voce senza stampa, voce illeggibile, blob orfano.
  idb.store('blobs').delete('e002/print.png');
  idb.store('entries').set('XX', { id: 'XX', createdAt: 'boh' });
  idb.store('blobs').set('fantasma/print.png', png());

  const h = idbHistory(idb, { max: 1 });
  const list = await h.list();
  assert.deepEqual(list.map((e) => e.id), ['e003']);
  // La pulizia finisce prima che lo storico sia pronto; remove di una voce assente non cambia nulla.
  assert.equal(await h.remove('nessuna'), false);
  assert.deepEqual(sortedKeys(idb.store('entries')), ['e003']);
  assert.deepEqual(sortedKeys(idb.store('blobs')), ['e003/photo_1.jpg', 'e003/print.png']);
});

test('IndexedDB: database chiuso dal browser, si riapre alla prossima operazione', async () => {
  const idb = fakeIndexedDB();
  const h = idbHistory(idb);
  await h.add({ printPng: png() });
  assert.equal(idb.opened, 1);
  // Il browser chiude l'handle in uso (dati del sito cancellati) o un'altra scheda chiede
  // un aggiornamento di versione: in entrambi i casi la prossima operazione riapre.
  const first = idb.handles.at(-1);
  first.close();
  first.onclose?.();
  await h.add({ printPng: png() });
  assert.equal(idb.opened, 2);
  const second = idb.handles.at(-1);
  second.onversionchange?.();
  assert.equal(second.closed, true, 'su versionchange l\'handle si chiude');
  assert.equal((await h.markPrinted('e001')).printed, true);
  assert.equal(idb.opened, 3);
  assert.deepEqual(sortedKeys(idb.store('entries')), ['e001', 'e002']);
});

test('IndexedDB: due schede sullo stesso database si allineano', async () => {
  const idb = fakeIndexedDB();
  const tabA = idbHistory(idb, { newId: counterIds('a') });
  const tabB = idbHistory(idb, { newId: counterIds('b') });
  await tabA.ready();
  await tabB.ready();
  const seen = new Promise((resolve) => {
    const unsubscribe = tabA.subscribe((list) => {
      unsubscribe();
      resolve(list.map((e) => e.id));
    });
  });
  await tabB.add({ printPng: png('da B') });
  assert.deepEqual(await seen, ['b001']);
  assert.deepEqual((await tabA.list()).map((e) => e.id), ['b001']);
  // La potatura di A tiene conto della voce scritta da B.
  await tabA.add({ printPng: png('da A') });
  assert.deepEqual(sortedKeys(idb.store('entries')), ['a001', 'b001']);
});

test('IndexedDB: letture insieme dopo una chiusura riaprono il database una volta sola', async () => {
  const idb = fakeIndexedDB();
  const h = idbHistory(idb);
  const e = await h.add({ printPng: png('uno'), originals: [jpg('a')] });
  const first = idb.handles.at(-1);
  first.close();
  first.onclose?.();
  // Come le miniature della griglia: più letture partono insieme.
  const [blob, photos, again] = await Promise.all([h.printBlob(e.id), h.originals(e.id), h.printBlob(e.id)]);
  assert.equal(await blob.text(), 'uno');
  assert.equal(await again.text(), 'uno');
  assert.equal(photos.length, 1);
  assert.equal(idb.opened, 2, 'una sola riapertura');
  assert.equal(idb.handles.filter((d) => !d.closed).length, 1, 'nessun handle rimasto aperto per niente');
});

test('IndexedDB: clear svuota entrambi gli store e allinea le altre schede', async () => {
  const idb = fakeIndexedDB();
  const tabA = idbHistory(idb, { newId: counterIds('a') });
  const tabB = idbHistory(idb, { newId: counterIds('b') });
  await tabA.add({ printPng: png(), originals: [jpg('x')] });
  assert.equal((await tabB.list()).length, 1);
  const seen = new Promise((resolve) => {
    const unsubscribe = tabB.subscribe((list) => {
      unsubscribe();
      resolve(list.length);
    });
  });
  await tabA.clear();
  assert.equal(idb.store('entries').size, 0);
  assert.equal(idb.store('blobs').size, 0);
  assert.equal(await seen, 0);
  assert.deepEqual(await tabB.list(), []);
});

test('IndexedDB: database eliminato da fuori, lo storico si svuota e poi si ricrea', async () => {
  const idb = fakeIndexedDB();
  const h = idbHistory(idb);
  await h.add({ printPng: png() });
  const seen = [];
  h.subscribe((list) => seen.push(list.length));
  // deleteDatabase: versionchange con newVersion null su ogni connessione aperta.
  const handle = idb.handles.at(-1);
  idb.databases.delete('fotoflash');
  handle.onversionchange?.({ oldVersion: 1, newVersion: null });
  assert.equal(handle.closed, true);
  // Un'operazione serializzata arriva dopo lo svuotamento.
  assert.equal(await h.remove('nessuna'), false);
  assert.deepEqual(seen, [0]);
  assert.deepEqual(await h.list(), []);
  // La prossima scrittura ricrea il database, vuoto.
  const e = await h.add({ printPng: png('nuova') });
  assert.deepEqual((await h.list()).map((x) => x.id), [e.id]);
  assert.deepEqual(sortedKeys(idb.store('entries')), [e.id]);
});
