// Prove di ble.js con un navigator.bluetooth finto, senza stampante (come test/ble-test.js del bridge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBle, errorCode, BLE_STORE, Ble } from '../src/printer/ble.js';
import { U, S18F0, C2AF1, SFFF0, CFFF1, CFFF2, SAE30, CAE01, SISSC, CISSC, SUNDECLARED,
  dom, storage, device, netum, fakeBluetooth, fastTimers, data, delivered, rejects } from './printer-fakes.test.mjs';

function load({ devices = [], remember = false, store = storage(), throwSync = null, bluetooth = true } = {}) {
  const nav = bluetooth ? fakeBluetooth({ devices, remember, throwSync }) : { requests: [] };
  const timers = fastTimers();
  const ble = createBle({
    navigator: () => nav,
    storage: () => store,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  return { ble, nav, store };
}

test('il modulo si importa senza browser e l\'istanza condivisa dice "non supportato" in Node', async () => {
  assert.equal(typeof Ble.pair, 'function');
  assert.equal(Ble.supported(), false);
  assert.equal(await Ble.available(), null);
  assert.equal(Ble.info().status, 'idle');
});

test('pair(): requestDevice parte subito (gesto), filtri e optionalServices completi, profilo 18F0/2AF1', async () => {
  const dev = netum();
  const { ble, nav, store } = load({ devices: [dev] });
  const p = ble.pair();
  assert.equal(nav.requests.length, 1, 'requestDevice deve essere chiamata in modo sincrono');
  const info = await p;
  const opt = nav.requests[0];
  assert.ok(opt.filters.some((f) => f.services && f.services[0] === S18F0));
  assert.ok(opt.filters.some((f) => f.name === 'BlueTooth Printer'));
  ble.profiles.forEach((pr) => assert.ok(opt.optionalServices.indexOf(pr.service) >= 0, pr.name));
  assert.ok(opt.optionalServices.indexOf(SAE30) >= 0);
  assert.equal(info.profile, '18F0');
  assert.equal(info.characteristic, C2AF1);
  assert.equal(info.status, 'ready');
  assert.equal(info.paired, true);
  assert.equal(info.connected, true);
  assert.equal(ble.saved().name, 'BlueTooth Printer');
  assert.equal(JSON.parse(store.getItem(BLE_STORE)).id, 'dev-1', 'chiave fotoflash.ble');
  assert.equal(store.getItem('printbridge.ble'), null);
});

test('print() automatica: pezzi da 100 con conferma, byte identici, avanzamento', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const d = data(250);
  const prog = [];
  const r = await ble.print(d, { onProgress: (s, t) => prog.push([s, t]) });
  assert.deepEqual(dev.writes.map((w) => w.bytes.length), [100, 100, 50]);
  assert.ok(dev.writes.every((w) => w.withResponse));
  assert.deepEqual(delivered(dev), Array.from(d));
  assert.deepEqual(prog, [[100, 250], [200, 250], [250, 250]]);
  assert.equal(r.ok, true);
  assert.equal(r.bytes, 250);
  assert.equal(r.chunk, 100);
  assert.equal(dev.overlap, 0);
});

test('pausa finale: la stampa si chiude solo dopo i 300 ms di attesa', async () => {
  const dev = netum();
  const timers = fastTimers();
  const nav = fakeBluetooth({ devices: [dev] });
  const ble = createBle({ navigator: () => nav, storage: () => storage(), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  await ble.pair();
  timers.log.length = 0;
  await ble.print(data(10));
  assert.ok(timers.log.includes(300), 'attesa finale di 300 ms richiesta: ' + timers.log.join(','));
});

test('ripiego 100 -> 20 se il primo pezzo e rifiutato (NotSupportedError), ricordato', async () => {
  const dev = netum({ fail: ({ len }) => (len > 20 ? dom('NotSupportedError', 'GATT operation not supported.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const d = data(95);
  const r = await ble.print(d);
  assert.equal(r.chunk, 20);
  assert.deepEqual(dev.writes.map((w) => w.bytes.length), [20, 20, 20, 20, 15]);
  assert.deepEqual(delivered(dev), Array.from(d));
  assert.equal(ble.saved().chunk, 20);
  assert.equal(ble.info().chunk, 20);
  dev.writes.length = 0;
  const r2 = await ble.print(data(30));
  assert.equal(r2.chunk, 20, 'la stampa successiva parte gia da 20');
  assert.equal(dev.calls, 8, 'nessun nuovo tentativo da 100');
});

test('ripiego 100 -> 20 anche con InvalidModificationError', async () => {
  const dev = netum({ fail: ({ len }) => (len > 20 ? dom('InvalidModificationError', 'Value too long.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const d = data(41);
  const r = await ble.print(d);
  assert.equal(r.chunk, 20);
  assert.deepEqual(delivered(dev), Array.from(d));
});

test('errore transitorio "unknown reason": ritenta lo stesso pezzo, niente ripiego', async () => {
  const dev = netum({ fail: ({ n }) => (n === 1 ? dom('NetworkError', 'GATT operation failed for unknown reason.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const d = data(250);
  const r = await ble.print(d);
  assert.equal(r.chunk, 100);
  assert.deepEqual(delivered(dev), Array.from(d));
  assert.equal(ble.saved().chunk || null, null);
});

test('errore transitorio "already in progress": ritenta lo stesso pezzo', async () => {
  const dev = netum({ fail: ({ n }) => (n === 2 || n === 3 ? dom('NetworkError', 'GATT operation already in progress.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const d = data(250);
  await ble.print(d);
  assert.deepEqual(delivered(dev), Array.from(d));
  assert.equal(dev.calls, 5);
});

test('"unknown reason" ripetuto al primo pezzo: 3 tentativi, poi ripiego a 20', async () => {
  const dev = netum({ fail: ({ len }) => (len > 20 ? dom('NetworkError', 'GATT operation failed for unknown reason.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const d = data(45);
  const r = await ble.print(d);
  assert.equal(r.chunk, 20);
  assert.equal(dev.calls, 4 + 3, '1 + 3 tentativi da 100, poi 3 pezzi da 20');
  assert.deepEqual(delivered(dev), Array.from(d));
});

test('"unknown reason" a meta stampa oltre i tentativi: errore, niente ripiego', async () => {
  const dev = netum({ fail: ({ n }) => (n >= 1 ? dom('NetworkError', 'GATT operation failed for unknown reason.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const e = await rejects(ble.print(data(250)));
  assert.equal(e.name, 'NetworkError');
  assert.equal(dev.calls, 1 + 4);
  assert.equal(ble.info().status, 'ready');
  assert.equal(ble.info().lastErrorCode, 'network');
});

test('"GATT Error Unknown." senza conferma: nessun nuovo tentativo, lavoro interrotto', async () => {
  const dev = device({
    services: { [S18F0]: [[C2AF1, { writeWithoutResponse: true }]] },
    fail: ({ n }) => (n === 2 ? dom('NotSupportedError', 'GATT Error Unknown.') : null)
  });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const e = await rejects(ble.print(data(100)));
  assert.equal(e.message, 'GATT Error Unknown.');
  assert.equal(dev.calls, 3);
  assert.equal(errorCode(e), 'write');
});

test('solo writeWithoutResponse: pezzi da 20, nessuna conferma (neanche l\'ultimo), pausa 20 ms', async () => {
  const dev = device({ services: { [S18F0]: [[C2AF1, { writeWithoutResponse: true }]] } });
  const timers = fastTimers();
  const nav = fakeBluetooth({ devices: [dev] });
  const ble = createBle({ navigator: () => nav, storage: () => storage(), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  await ble.pair();
  timers.log.length = 0;
  const d = data(50);
  const r = await ble.print(d);
  assert.deepEqual(dev.writes.map((w) => [w.bytes.length, w.withResponse]), [[20, false], [20, false], [10, false]]);
  assert.equal(r.withResponse, false);
  assert.deepEqual(delivered(dev), Array.from(d));
  assert.equal(timers.log.filter((ms) => ms === 20).length, 2, 'pausa tra i pezzi, non dopo l\'ultimo');
});

test('automatica con write e writeWithoutResponse ma ultimo pezzo: con conferma', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  await ble.print(data(150));
  assert.deepEqual(dev.writes.map((w) => w.withResponse), [true, true]);
});

test('modalita noresponse-20 scelta a mano: anche l\'ultimo pezzo senza conferma', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  ble.setWriteMode('noresponse-20');
  await ble.print(data(41));
  assert.deepEqual(dev.writes.map((w) => [w.bytes.length, w.withResponse]), [[20, false], [20, false], [1, false]]);
  assert.equal(ble.info().writeMode, 'noresponse-20');
});

test('modalita response-20: pezzi da 20 con conferma', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  ble.setWriteMode('response-20');
  await ble.print(data(41));
  assert.deepEqual(dev.writes.map((w) => [w.bytes.length, w.withResponse]), [[20, true], [20, true], [1, true]]);
});

test('modalita response-100 e modalita sconosciuta (torna auto)', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  ble.setWriteMode('response-100');
  await ble.print(data(150));
  assert.deepEqual(dev.writes.map((w) => [w.bytes.length, w.withResponse]), [[100, true], [50, true]]);
  ble.setWriteMode('turbo');
  assert.equal(ble.info().writeMode, 'auto');
});

test('setWriteMode notifica gli ascoltatori e azzera il pezzo ricordato', async () => {
  const dev = netum({ fail: ({ len }) => (len > 20 ? dom('NotSupportedError', 'x') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  await ble.print(data(30));
  assert.equal(ble.saved().chunk, 20);
  const seen = [];
  const off = ble.on((i) => seen.push(i.writeMode));
  ble.setWriteMode('response-20');
  off();
  ble.setWriteMode('auto');
  assert.deepEqual(seen, ['response-20']);
  assert.equal(ble.saved().chunk, null);
});

test('coda: due stampe insieme non si mescolano e non si sovrappongono', async () => {
  const dev = netum({ latency: 3 });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const a = data(300, 1);
  const b = data(300, 2);
  await Promise.all([ble.print(a), ble.print(b)]);
  assert.deepEqual(delivered(dev), Array.from(a).concat(Array.from(b)));
  assert.equal(dev.overlap, 0);
});

test('coda: una stampa fallita non blocca la successiva', async () => {
  let failNext = true;
  const dev = netum({ fail: () => (failNext ? (failNext = false, dom('NotSupportedError', 'GATT Error Unknown.')) : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  ble.setWriteMode('noresponse-20');
  const p1 = ble.print(data(10));
  const p2 = ble.print(data(10, 3));
  await rejects(p1);
  await p2;
  assert.deepEqual(delivered(dev), Array.from(data(10, 3)));
});

test('cat printer (solo AE30): rifiutata con codice chiaro', async () => {
  const dev = device({ name: 'MX06', services: { [SAE30]: [[CAE01, { writeWithoutResponse: true }]] } });
  const { ble } = load({ devices: [dev] });
  const e = await rejects(ble.pair({ all: true }));
  assert.equal(e.code, 'cat-printer');
  assert.equal(errorCode(e), 'cat-printer');
  assert.equal(ble.info().status, 'error');
  assert.equal(ble.info().lastErrorCode, 'cat-printer');
});

test('pair({ all }): acceptAllDevices con tutti gli optionalServices', async () => {
  const { ble, nav } = load({ devices: [netum()] });
  await ble.pair({ all: true });
  assert.equal(nav.requests[0].acceptAllDevices, true);
  assert.equal(nav.requests[0].filters, undefined);
  assert.ok(nav.requests[0].optionalServices.indexOf(S18F0) >= 0);
});

test('canale sconosciuto: no-channel, diagnostica, scelta a mano ricordata', async () => {
  const dev = device({ name: 'Strana', services: { [SFFF0]: [[CFFF1, { notify: true }], [CFFF2, { write: true }]], [SUNDECLARED]: [[U('aaaa'), { write: true }]] } });
  const store = storage();
  const { ble } = load({ devices: [dev], store });
  const e = await rejects(ble.pair({ all: true }));
  assert.equal(e.code, 'no-channel');
  assert.equal(errorCode(e), 'no-channel');
  const list = await ble.describe();
  assert.deepEqual(list.map((s) => s.service), [SFFF0], 'il servizio non dichiarato resta invisibile');
  assert.deepEqual(list[0].characteristics.map((c) => [c.uuid, c.write]), [[CFFF1, false], [CFFF2, true]]);
  assert.equal(ble.info().status, 'error', 'senza canale la diagnostica lascia lo stato in errore');
  assert.equal(ble.info().lastErrorCode, 'no-channel');
  const info = await ble.useCharacteristic(SFFF0, CFFF2);
  assert.equal(info.profile, 'manual');
  assert.equal(info.characteristic, CFFF2);
  assert.equal(info.status, 'ready');
  await ble.print(data(30));
  assert.ok(dev.writes.every((w) => w.uuid === CFFF2));
  const saved = JSON.parse(store.getItem(BLE_STORE));
  assert.equal(saved.service, SFFF0);
  assert.equal(saved.characteristic, CFFF2);
});

test('describe() con canale gia scelto: elenco e stato pronto', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  const list = await ble.describe();
  assert.deepEqual(list.map((s) => s.service), [S18F0]);
  assert.deepEqual(list[0].characteristics.map((c) => [c.uuid, c.writeWithoutResponse, c.notify]),
    [[U('2af0'), false, true], [C2AF1, true, false]]);
  assert.equal(ble.info().status, 'ready');
});

test('UUID atteso assente nel servizio noto: usa la prima caratteristica scrivibile', async () => {
  const dev = device({ services: { [SISSC]: [[U('1111'), { notify: true }], [U('2222'), { writeWithoutResponse: true }]] } });
  const { ble } = load({ devices: [dev] });
  const info = await ble.pair();
  assert.equal(info.profile, 'ISSC');
  assert.equal(info.characteristic, U('2222'));
});

test('caratteristica attesa presente ma non scrivibile: ripiega sulla prima scrivibile', async () => {
  const dev = device({ services: { [S18F0]: [[C2AF1, { notify: true }], [U('2af2'), { write: true }]] } });
  const { ble } = load({ devices: [dev] });
  const info = await ble.pair();
  assert.equal(info.profile, '18F0');
  assert.equal(info.characteristic, U('2af2'));
});

test('profilo ISSC con UUID corretto', async () => {
  const dev = device({ services: { [SISSC]: [[CISSC, { write: true, writeWithoutResponse: true }]] } });
  const { ble } = load({ devices: [dev] });
  const info = await ble.pair();
  assert.equal(info.characteristic, CISSC);
});

test('piu profili: vince l\'ordine della tabella (18F0 prima di FFE0)', async () => {
  const dev = device({ services: { [U('ffe0')]: [[U('ffe1'), { write: true }]], [S18F0]: [[C2AF1, { write: true }]] } });
  const { ble } = load({ devices: [dev] });
  const info = await ble.pair();
  assert.equal(info.profile, '18F0');
});

test('stampante scollegata (auto-sleep): stato aggiornato, la stampa si ricollega da sola', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  const states = [];
  ble.on((i) => states.push(i.status));
  await ble.pair();
  dev.gatt.disconnect();
  assert.equal(ble.info().status, 'disconnected');
  assert.equal(ble.info().connected, false);
  const d = data(120);
  await ble.print(d);
  assert.deepEqual(delivered(dev), Array.from(d));
  assert.equal(dev.connectCalls, 2);
  assert.ok(states.indexOf('printing') >= 0);
  assert.equal(ble.info().status, 'ready');
});

test('pair(): NetworkError alla prima connessione -> ritenta una volta', async () => {
  const dev = netum({ connect: (n) => (n === 1 ? dom('NetworkError', 'Connection attempt failed.') : null) });
  const { ble } = load({ devices: [dev] });
  const info = await ble.pair();
  assert.equal(info.status, 'ready');
  assert.equal(dev.connectCalls, 2);
});

test('connessione: NetworkError poi stampa -> ritenta', async () => {
  let fails = 0;
  const dev = netum({ connect: () => (fails-- > 0 ? dom('NetworkError', 'Connection attempt failed.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  dev.gatt.disconnect();
  fails = 1;
  await ble.print(data(10));
  assert.equal(dev.connectCalls, 3);
});

test('connessione: due NetworkError di fila -> errore network, stato disconnected', async () => {
  let fails = 0;
  const dev = netum({ connect: () => (fails-- > 0 ? dom('NetworkError', 'Connection attempt failed.') : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  dev.gatt.disconnect();
  fails = 2;
  const e = await rejects(ble.print(data(10)));
  assert.equal(errorCode(e), 'network');
  assert.equal(dev.connectCalls, 3);
  assert.equal(ble.info().status, 'disconnected');
});

test('connessione appesa: errore timeout senza nuovo tentativo', async () => {
  let hang = false;
  const dev = netum({ connect: () => (hang ? 'hang' : null) });
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  dev.gatt.disconnect();
  hang = true;
  const t0 = Date.now();
  const e = await rejects(ble.print(data(10)));
  assert.equal(e.code, 'timeout');
  assert.equal(errorCode(e), 'timeout');
  assert.equal(dev.connectCalls, 2, 'un timeout non si ritenta');
  assert.ok(Date.now() - t0 < 2000);
});

test('pair({ sameName }) filtra per il nome salvato', async () => {
  const store = storage();
  const first = load({ devices: [netum()], store });
  await first.ble.pair();
  const second = load({ devices: [netum()], store });
  await second.ble.pair({ sameName: true });
  assert.deepEqual(second.nav.requests[0].filters, [{ name: 'BlueTooth Printer' }]);
  assert.ok(second.nav.requests[0].optionalServices.indexOf(S18F0) >= 0);
});

test('altra stampante: le scelte manuali della precedente vengono dimenticate', async () => {
  const store = storage();
  const a = load({ devices: [netum()], store });
  await a.ble.pair();
  a.ble.setWriteMode('response-20');
  const b = load({ devices: [netum({ name: 'MPT-II', id: 'dev-2' })], store });
  const info = await b.ble.pair();
  assert.equal(info.writeMode, 'auto');
  assert.equal(b.ble.saved().name, 'MPT-II');
});

test('reconnect() senza permessi persistenti: null (serve un tocco)', async () => {
  const store = storage();
  const a = load({ devices: [netum()], store });
  await a.ble.pair();
  const b = load({ devices: [netum()], store });
  assert.equal(b.ble.canRemember(), false);
  assert.equal(await b.ble.reconnect(), null);
  assert.equal(b.ble.info().remembered, true);
  assert.equal(b.ble.info().paired, false);
  assert.equal(b.ble.info().name, 'BlueTooth Printer');
});

test('reconnect() senza nulla di salvato: null', async () => {
  const { ble } = load({ devices: [netum()], remember: true });
  assert.equal(await ble.reconnect(), null);
});

test('reconnect() con getDevices: aspetta l\'annuncio e si ricollega da sola alla stampante ricordata', async () => {
  const store = storage();
  const dev = netum();
  const a = load({ devices: [dev], store });
  await a.ble.pair();
  dev.gatt.disconnect();
  const dev2 = netum({ advertises: true });
  dev2.allowed = dev.allowed;
  const b = load({ devices: [dev2], store, remember: true });
  assert.equal(b.ble.canRemember(), true);
  const info = await b.ble.reconnect();
  assert.equal(info.status, 'ready');
  assert.equal(b.nav.requests.length, 0, 'nessun chooser');
  assert.equal(dev2.watchCalls, 1);
  assert.equal(dev2.listenerCount('advertisementreceived'), 0, 'ascoltatore tolto');
  assert.equal(dev2.watchAborted, true, 'watchAdvertisements fermato');
});

test('reconnect() con la stampante della pagina: si ricollega senza chooser', async () => {
  const dev = netum();
  const { ble, nav } = load({ devices: [dev] });
  await ble.pair();
  dev.gatt.disconnect();
  const info = await ble.reconnect();
  assert.equal(info.status, 'ready');
  assert.equal(nav.requests.length, 1);
  assert.equal(dev.connectCalls, 2);
});

test('disconnect(): scollega e stato disconnected', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  ble.disconnect();
  assert.equal(dev.gatt.connected, false);
  assert.equal(ble.info().status, 'disconnected');
  assert.equal(ble.info().paired, true);
});

test('forget(): stato idle, salvataggio rimosso, permesso revocato', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  await ble.pair();
  await ble.forget();
  assert.equal(ble.saved(), null);
  assert.equal(ble.info().status, 'idle');
  assert.equal(ble.info().paired, false);
  assert.equal(ble.info().remembered, false);
  assert.equal(dev.forgotten, true);
  assert.equal(dev.listenerCount('gattserverdisconnected'), 0);
  const e = await rejects(ble.print(data(5)));
  assert.equal(e.code, 'no-device');
  assert.equal(errorCode(e), 'not-found');
});

test('on(): ascoltatore rotto non ferma gli altri, unsubscribe funziona', async () => {
  const dev = netum();
  const { ble } = load({ devices: [dev] });
  const seen = [];
  ble.on(() => { throw new Error('rotto'); });
  const off = ble.on((i) => seen.push(i.status));
  await ble.pair();
  assert.deepEqual(seen, ['connecting', 'ready']);
  off();
  ble.disconnect();
  assert.deepEqual(seen, ['connecting', 'ready']);
});

test('requestDevice che lancia subito (SecurityError): pair restituisce una promessa rifiutata', async () => {
  const { ble } = load({ throwSync: dom('SecurityError', 'Must be handling a user gesture to show a permission request.') });
  const p = ble.pair();
  assert.ok(p && typeof p.then === 'function');
  const e = await rejects(p);
  assert.equal(e.name, 'SecurityError');
  assert.equal(errorCode(e), 'gesture');
});

test('errorCode(): annullamento, Posizione, non trovato, rete, scrittura, sconosciuto', () => {
  assert.equal(errorCode(dom('NotFoundError', 'User cancelled the requestDevice() chooser.')), 'cancelled');
  assert.equal(errorCode(dom('NotFoundError', 'Bluetooth adapter not available. Location permission is required.')), 'location');
  assert.equal(errorCode(dom('NotFoundError', 'Bluetooth scanning is not allowed.')), 'location');
  assert.equal(errorCode(dom('NotFoundError', 'No Services found in device.')), 'not-found');
  assert.equal(errorCode(dom('NetworkError', 'Bluetooth Device is no longer in range.')), 'network');
  assert.equal(errorCode(dom('NotSupportedError', 'GATT Error Unknown.')), 'write');
  assert.equal(errorCode({ code: 'unsupported', message: 'x' }), 'unsupported');
  assert.equal(errorCode(new TypeError('boom')), 'unknown');
  assert.equal(errorCode(null), 'unknown');
  assert.equal(Ble.errorCode, errorCode);
});

test('supported()/canRemember()/available() senza Web Bluetooth', async () => {
  const { ble } = load({ bluetooth: false });
  assert.equal(ble.supported(), false);
  assert.equal(ble.canRemember(), false);
  assert.equal(await ble.available(), null);
  const e = await rejects(ble.pair());
  assert.equal(e.code, 'unsupported');
  assert.equal(errorCode(e), 'unsupported');
});

test('available(): risponde getAvailability, null se lancia', async () => {
  const { ble, nav } = load();
  assert.equal(await ble.available(), true);
  nav.bluetooth.getAvailability = () => Promise.reject(new Error('x'));
  assert.equal(await ble.available(), null);
  nav.bluetooth.getAvailability = () => { throw new Error('x'); };
  assert.equal(await ble.available(), null);
});

test('localStorage assente o che lancia: niente eccezioni, stampante non ricordata', async () => {
  const dev = netum();
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const { ble } = load({ devices: [dev], store: broken });
  const info = await ble.pair();
  assert.equal(info.status, 'ready');
  assert.equal(info.remembered, false);
  await ble.print(data(10));
  await ble.forget();
});

test('info().transfer: piano di scrittura del canale scelto (modalita, pezzo, pausa)', async () => {
  const dev = netum({ fail: ({ len }) => (len > 20 ? dom('NotSupportedError', 'x') : null) });
  const { ble } = load({ devices: [dev] });
  assert.equal(ble.info().transfer, null, 'senza canale nessun piano');
  await ble.pair();
  assert.deepEqual(ble.info().transfer, { mode: 'auto', withResponse: true, chunk: 100, pause: 0 });
  await ble.print(data(30));
  assert.deepEqual(ble.info().transfer, { mode: 'auto', withResponse: true, chunk: 20, pause: 0 });
  ble.setWriteMode('noresponse-20');
  assert.deepEqual(ble.info().transfer, { mode: 'noresponse-20', withResponse: false, chunk: 20, pause: 20 });
  const only = device({ services: { [S18F0]: [[C2AF1, { writeWithoutResponse: true }]] } });
  const other = load({ devices: [only] });
  await other.ble.pair();
  other.ble.setWriteMode('response-100');
  assert.deepEqual(other.ble.info().transfer, { mode: 'response-100', withResponse: false, chunk: 20, pause: 20 },
    'modalita con conferma senza write: si torna a 20 senza conferma');
});
