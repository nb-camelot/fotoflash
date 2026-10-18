// ble.js con i driver (docs/DRIVERS.md): chooser con servizi e nomi di tutti i driver, scelta del
// canale guidata dal modello riconosciuto, trasporto per lavoro dei Phomemo (senza conferma, pezzi
// da 20 byte, pause di 15 ms, ripiego su writeValue) e strategia automatica ESC/POS invariata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBle, jobTransport, BLE_FILTERS, BLE_OPTIONAL, BLE_PROFILES, errorCode } from '../src/printer/ble.js';
import { phomemoM02Pro } from '../src/printer/drivers/index.js';
import { PHOMEMO_SERVICE, PHOMEMO_WRITE, PHOMEMO_NOTIFY } from '../src/printer/drivers/phomemo.js';
import { S18F0, C2AF1, C2AF0, dom, storage, device, fakeBluetooth, fastTimers, data, delivered, rejects } from './printer-fakes.test.mjs';

const PHOMEMO_JOB = Object.freeze({ ...phomemoM02Pro.defaultTransport });

/** Phomemo finta: servizio FF00, scrittura FF02 (con e senza conferma), notifiche FF03. */
function phomemo(extra = {}) {
  return device({
    name: 'M02 Pro',
    id: 'm02-pro',
    services: {
      [PHOMEMO_SERVICE]: [[PHOMEMO_WRITE, { write: true, writeWithoutResponse: true }], [PHOMEMO_NOTIFY, { notify: true }]]
    },
    ...extra
  });
}

function load(devices) {
  const nav = fakeBluetooth({ devices });
  const timers = fastTimers();
  const ble = createBle({ navigator: () => nav, storage: () => storage(), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  return { ble, nav, timers };
}

/** La caratteristica di scrittura vera del dispositivo finto (lo stesso oggetto che usa ble.js). */
async function writeChar(dev) {
  const server = await dev.gatt.connect();
  const services = await server.getPrimaryServices();
  const svc = services.find((s) => s.uuid === PHOMEMO_SERVICE);
  return svc.getCharacteristic(PHOMEMO_WRITE);
}

test('chooser: servizi e nomi di tutti i driver, FF00 una volta sola, nomi M02*', async () => {
  assert.ok(BLE_FILTERS.some((f) => f.namePrefix === 'M02'), 'le Phomemo si annunciano come M02, M02S, M02 Pro');
  assert.equal(BLE_FILTERS.filter((f) => f.services && f.services[0] === PHOMEMO_SERVICE).length, 1);
  assert.equal(BLE_OPTIONAL.filter((s) => s === PHOMEMO_SERVICE).length, 1);
  assert.equal(new Set(BLE_OPTIONAL).size, BLE_OPTIONAL.length, 'nessun servizio ripetuto');
  // I profili ESC/POS restano quelli del bridge, nello stesso ordine
  assert.deepEqual(BLE_PROFILES.map((p) => p.name), ['18F0', 'E7810A71', 'ISSC', 'FF00', 'FFE0', 'Nordic UART']);
  const dev = phomemo();
  const { ble, nav } = load([dev]);
  const pending = ble.pair();
  assert.equal(nav.requests.length, 1, 'requestDevice nello stesso tick del tocco');
  const info = await pending;
  assert.ok(nav.requests[0].optionalServices.includes(PHOMEMO_SERVICE));
  assert.ok(nav.requests[0].filters.some((f) => f.namePrefix === 'M02'));
  assert.equal(info.profile, 'FF00');
  assert.equal(info.characteristic, PHOMEMO_WRITE);
});

test('canale: il modello riconosciuto dal nome decide l\'ordine dei profili', async () => {
  const both = (name) => device({
    name,
    services: {
      [S18F0]: [[C2AF0, { notify: true }], [C2AF1, { write: true, writeWithoutResponse: true }]],
      [PHOMEMO_SERVICE]: [[PHOMEMO_WRITE, { write: true, writeWithoutResponse: true }]]
    }
  });
  const a = load([both('M02 Pro')]);
  assert.equal((await a.ble.pair()).profile, 'FF00', 'M02 Pro: prima il profilo Phomemo');
  const b = load([both('BlueTooth Printer')]);
  assert.equal((await b.ble.pair()).profile, '18F0', 'ESC/POS: ordine del bridge');
  // Nome sconosciuto: vale il driver scelto (preferProfiles), poi l'ordine del bridge
  const c = load([both('Stampante')]);
  c.ble.preferProfiles(phomemoM02Pro.bleProfiles);
  assert.equal((await c.ble.pair()).profile, 'FF00');
  const d = load([both('Stampante')]);
  assert.equal((await d.ble.pair()).profile, '18F0');
});

test('Phomemo: senza conferma a pezzi da 20 byte, 15 ms tra i pezzi, anche l\'ultimo senza conferma', async () => {
  const dev = phomemo();
  const { ble, timers } = load([dev]);
  await ble.pair();
  timers.log.length = 0;
  const bytes = data(50);
  const progress = [];
  const r = await ble.print(bytes, { ...PHOMEMO_JOB, onProgress: (done, all) => progress.push([done, all]) });
  assert.deepEqual(dev.writes.map((w) => w.bytes.length), [20, 20, 10]);
  assert.ok(dev.writes.every((w) => w.withResponse === false));
  assert.ok(dev.writes.every((w) => w.uuid === PHOMEMO_WRITE));
  assert.deepEqual(delivered(dev), Array.from(bytes));
  assert.deepEqual(timers.log, [15, 15, 300], 'due pause tra i tre pezzi, poi l\'attesa finale');
  assert.deepEqual(progress, [[20, 50], [40, 50], [50, 50]]);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'custom');
  assert.equal(r.withResponse, false);
  assert.equal(r.fallback, false);
  assert.equal(dev.overlap, 0, 'una scrittura alla volta');
});

test('Phomemo: preset Veloce (60 byte, 20 ms) applicato alla lettera', async () => {
  const dev = phomemo();
  const { ble, timers } = load([dev]);
  await ble.pair();
  timers.log.length = 0;
  await ble.print(data(130), { chunkSize: 60, chunkDelayMs: 20, withoutResponse: true });
  assert.deepEqual(dev.writes.map((w) => w.bytes.length), [60, 60, 10]);
  assert.deepEqual(timers.log, [20, 20, 300]);
});

test('Phomemo: se writeValueWithoutResponse fallisce si ripiega su writeValue dallo stesso pezzo', async () => {
  const dev = phomemo({
    fail: ({ n, withResponse }) => (n === 0 && !withResponse ? dom('NotSupportedError', 'GATT operation not permitted.') : null)
  });
  const { ble } = load([dev]);
  await ble.pair();
  const c = await writeChar(dev);
  const viaWriteValue = [];
  c.writeValue = (v) => {
    viaWriteValue.push(v.length);
    return c.writeValueWithResponse(v);
  };
  const bytes = data(50);
  const r = await ble.print(bytes, PHOMEMO_JOB);
  assert.deepEqual(viaWriteValue, [20, 20, 10], 'tutto il lavoro con writeValue, ripartendo dal primo pezzo');
  assert.deepEqual(delivered(dev), Array.from(bytes), 'nessun byte perso o ripetuto');
  assert.equal(r.fallback, true);
  assert.equal(r.withResponse, true);
});

test('Phomemo: un errore transitorio ritenta lo stesso pezzo senza ripiego', async () => {
  const dev = phomemo({
    fail: ({ n }) => (n === 0 ? dom('NetworkError', 'GATT operation failed for unknown reason.') : null)
  });
  const { ble, timers } = load([dev]);
  await ble.pair();
  timers.log.length = 0;
  const bytes = data(30);
  const r = await ble.print(bytes, PHOMEMO_JOB);
  assert.deepEqual(delivered(dev), Array.from(bytes));
  assert.ok(dev.writes.every((w) => w.withResponse === false));
  assert.equal(r.fallback, false);
  assert.ok(timers.log.includes(80), 'attesa prima del nuovo tentativo: ' + timers.log.join(','));
});

test('Phomemo: stampante scollegata durante l\'invio, nessun ripiego e errore di rete', async () => {
  const dev = phomemo({
    fail: ({ n, dev: d }) => {
      if (n !== 1) return null;
      d.gatt.disconnect();
      return dom('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.');
    }
  });
  const { ble } = load([dev]);
  await ble.pair();
  const c = await writeChar(dev);
  let viaWriteValue = 0;
  c.writeValue = (v) => { viaWriteValue++; return c.writeValueWithResponse(v); };
  const e = await rejects(ble.print(data(60), PHOMEMO_JOB));
  assert.equal(errorCode(e), 'network');
  assert.equal(viaWriteValue, 0);
});

test('caratteristica solo con conferma: il trasporto senza conferma diventa con conferma', async () => {
  const dev = device({ name: 'M02', services: { [PHOMEMO_SERVICE]: [[PHOMEMO_WRITE, { write: true }]] } });
  const { ble } = load([dev]);
  await ble.pair();
  const r = await ble.print(data(45), PHOMEMO_JOB);
  assert.deepEqual(dev.writes.map((w) => w.bytes.length), [20, 20, 5]);
  assert.ok(dev.writes.every((w) => w.withResponse === true));
  assert.equal(r.withResponse, true);
});

test('senza trasporto del lavoro resta la strategia automatica del bridge (con conferma, 100 byte)', async () => {
  const dev = phomemo();
  const { ble } = load([dev]);
  await ble.pair();
  const r = await ble.print(data(250), { onProgress: () => {} });
  assert.deepEqual(dev.writes.map((w) => w.bytes.length), [100, 100, 50]);
  assert.ok(dev.writes.every((w) => w.withResponse));
  assert.equal(r.chunk, 100);
  assert.equal(r.mode, undefined, 'nessun piano "custom"');
});

test('jobTransport: null senza valori (strategia automatica), altrimenti normalizzato', () => {
  assert.equal(jobTransport(null), null);
  assert.equal(jobTransport(undefined), null);
  assert.equal(jobTransport({}), null);
  assert.equal(jobTransport({ onProgress: () => {} }), null);
  assert.equal(jobTransport({ chunkSize: null, chunkDelayMs: null, withoutResponse: null }), null);
  assert.deepEqual(jobTransport(PHOMEMO_JOB), { chunkSize: 20, chunkDelayMs: 15, withoutResponse: true, finalDelayMs: 300 });
  assert.deepEqual(jobTransport({ chunkSize: 4096, chunkDelayMs: -5, withoutResponse: 'si' }),
    { chunkSize: 512, chunkDelayMs: 0, withoutResponse: false, finalDelayMs: 300 });
  assert.deepEqual(jobTransport({ chunkSize: '60' }), { chunkSize: 60, chunkDelayMs: 0, withoutResponse: false, finalDelayMs: 300 });
});
