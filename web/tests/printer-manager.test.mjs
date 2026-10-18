// Prove di PrinterManager: stati, esiti e byte del lavoro, con ble.js vero su una stampante finta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBle, BLE_STORE } from '../src/printer/ble.js';
import { PrinterManager, PrinterTuning, failureFor, jobOptionsFor, buildJobBytes, paperFor } from '../src/printer/manager.js';
import { BitImage } from '../src/core/bitimage.js';
import { t } from '../src/i18n/i18n.js';
import { S18F0, C2AF1, SAE30, CAE01, SFFF0, CFFF2, dom, storage, device, netum, fakeBluetooth, fastTimers, delivered, rejects } from './printer-fakes.test.mjs';

const DEFAULTS = { paper: 'MM58', feedLines: 4, cutPaper: false, heatLevel: 0, bandHeight: 24, dither: 'ATKINSON' };

function fakeSettings(overrides = {}) {
  let value = { ...DEFAULTS, ...overrides };
  return { get: () => value, set: (patch) => { value = { ...value, ...patch }; } };
}

function setup({ devices = [], remember = false, activation = null, settings = {}, idleMs = 0, bluetooth = true, store = storage() } = {}) {
  const nav = bluetooth ? fakeBluetooth({ devices, remember, activation }) : {};
  const timers = fastTimers();
  const ble = createBle({ navigator: () => nav, storage: () => store, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  const s = fakeSettings(settings);
  const mgr = new PrinterManager(s, ble, {
    idleDisconnectMs: idleMs, navigator: () => nav, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
  });
  const states = [];
  mgr.subscribe((st) => states.push(st));
  return { nav, ble, mgr, settings: s, store, states, kinds: () => states.map((st) => st.kind) };
}

/** Immagine a 1 bit con qualche punto nero, per riconoscere i byte delle bande. */
function image(width = 384, height = 50) {
  const img = new BitImage(width, height);
  for (let y = 0; y < height; y++) img.set((y * 7) % width, y, true);
  img.set(0, 0, true);
  img.set(width - 1, height - 1, true);
  return img;
}

// Posizioni dei comandi GS v 0 (1D 76 30 00) in un lavoro.
function bands(bytes) {
  const out = [];
  for (let i = 0; i + 7 < bytes.length; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) {
      out.push({ at: i, xBytes: bytes[i + 4] | (bytes[i + 5] << 8), rows: bytes[i + 6] | (bytes[i + 7] << 8) });
      i += 7 + (bytes[i + 4] | (bytes[i + 5] << 8)) * (bytes[i + 6] | (bytes[i + 7] << 8));
    }
  }
  return out;
}

test('PrinterTuning: tabella dell\'intensita e limiti come PrinterTuning.kt', () => {
  assert.equal(PrinterTuning.heatFor(0), null);
  assert.deepEqual(PrinterTuning.heatFor(1), { maxDots: 7, heatTime: 60, heatInterval: 2 });
  assert.deepEqual(PrinterTuning.heatFor(2), { maxDots: 8, heatTime: 80, heatInterval: 2 });
  assert.deepEqual(PrinterTuning.heatFor(3), { maxDots: 10, heatTime: 110, heatInterval: 2 });
  assert.deepEqual(PrinterTuning.heatFor(4), { maxDots: 11, heatTime: 140, heatInterval: 2 });
  assert.deepEqual(PrinterTuning.heatFor(9), PrinterTuning.heatFor(4));
  assert.equal(PrinterTuning.heatFor(-3), null);
  assert.equal(PrinterTuning.clampFeedLines(99), 10);
  assert.equal(PrinterTuning.clampFeedLines(-1), 0);
  assert.equal(PrinterTuning.clampBandHeight(1024), 255);
  assert.equal(PrinterTuning.clampBandHeight(1), 8);
  assert.equal(PrinterTuning.clampBandHeight('x'), 24);
  assert.equal(PrinterTuning.clampCopies(50), 10);
  assert.equal(PrinterTuning.clampCopies(0), 1);
  assert.equal(PrinterTuning.drainMillis(0), 300);
  assert.equal(PrinterTuning.drainMillis(16384), 2000);
  assert.equal(PrinterTuning.drainMillis(1e9), 4000);
  assert.equal(PrinterTuning.nearestIndex(PrinterTuning.BAND_HEIGHT_STEPS, 30), 3);
  assert.deepEqual(jobOptionsFor({ bandHeight: 64, feedLines: 20, cutPaper: true, heatLevel: 2 }),
    { bandHeight: 64, feedLinesAfter: 10, cut: true, heat: { maxDots: 8, heatTime: 80, heatInterval: 2 } });
  assert.equal(paperFor({ paper: 'MM80' }).dots, 576);
  assert.equal(paperFor({ paper: 'boh' }).dots, 384);
});

test('senza Web Bluetooth: stato unsupported e stampa UNSUPPORTED', async () => {
  const { mgr, kinds } = setup({ bluetooth: false });
  assert.equal(mgr.state.kind, 'unsupported');
  assert.equal(mgr.state.failure, 'UNSUPPORTED');
  assert.equal(mgr.state.message, t('prn_err_unsupported'));
  const r = await mgr.print(image());
  assert.deepEqual([r.ok, r.failure], [false, 'UNSUPPORTED']);
  assert.deepEqual(kinds(), ['unsupported']);
});

test('subscribe: chiamata subito; nessuna stampante = not-paired; unsubscribe', () => {
  const { mgr } = setup();
  const seen = [];
  const off = mgr.subscribe((s) => seen.push(s.kind));
  assert.deepEqual(seen, ['not-paired']);
  off();
  mgr.ble.disconnect();
  assert.deepEqual(seen, ['not-paired']);
});

test('pair(): connecting → ready con nome e profilo 18F0', async () => {
  const { mgr, nav, kinds } = setup({ devices: [netum()] });
  const p = mgr.pair();
  assert.equal(nav.requests.length, 1, 'chooser aperto nel gesto, senza attese');
  const st = await p;
  assert.equal(st.kind, 'ready');
  assert.equal(st.name, 'BlueTooth Printer');
  assert.equal(st.profile, '18F0');
  assert.equal(st.paired, true);
  assert.deepEqual(kinds(), ['not-paired', 'connecting', 'ready']);
});

test('pair() annullato: rifiuta con l\'errore originale e lo stato resta com\'era', async () => {
  const { mgr, kinds } = setup({ devices: [] });
  const e = await rejects(mgr.pair());
  assert.equal(e.name, 'NotFoundError');
  assert.equal(mgr.ble.errorCode(e), 'cancelled');
  assert.equal(mgr.state.kind, 'not-paired');
  assert.deepEqual(kinds(), ['not-paired']);
});

test('pair() su una cat printer: errore CAT_PRINTER nello stato', async () => {
  const dev = device({ name: 'MX06', services: { [SAE30]: [[CAE01, { writeWithoutResponse: true }]] } });
  const { mgr } = setup({ devices: [dev] });
  const e = await rejects(mgr.pair({ all: true }));
  assert.equal(e.code, 'cat-printer');
  assert.equal(mgr.state.kind, 'error');
  assert.equal(mgr.state.failure, 'CAT_PRINTER');
  assert.equal(mgr.state.message, t('prn_err_cat_printer'));
  assert.ok(mgr.state.detail.length > 0);
});

test('canale sconosciuto: NO_CHANNEL, poi la scelta a mano dalla diagnostica toglie l\'errore', async () => {
  const dev = device({ name: 'Strana', services: { [SFFF0]: [[CFFF2, { write: true }]] } });
  const { mgr } = setup({ devices: [dev] });
  await rejects(mgr.pair({ all: true }));
  assert.equal(mgr.state.failure, 'NO_CHANNEL');
  await mgr.ble.useCharacteristic(SFFF0, CFFF2);
  assert.equal(mgr.state.kind, 'ready');
  assert.equal(mgr.state.profile, 'manual');
  const r = await mgr.print(image(384, 10));
  assert.equal(r.ok, true);
  assert.ok(dev.writes.every((w) => w.uuid === CFFF2));
});

test('print(): byte del lavoro (ESC @, bande GS v 0, avanzamento finale), stati e avanzamento', async () => {
  const dev = netum();
  const { mgr, kinds, states } = setup({ devices: [dev] });
  await mgr.pair();
  const img = image(384, 50);
  const fractions = [];
  const r = await mgr.print(img, { onProgress: (f, done, all) => fractions.push([f, done, all]) });
  assert.equal(r.ok, true);
  const bytes = delivered(dev);
  assert.equal(r.bytes, bytes.length);
  assert.deepEqual(Array.from(buildJobBytes(img, DEFAULTS)), bytes, 'stessi byte di buildThermalJob + concatPackets');
  assert.deepEqual(bytes.slice(0, 2), [0x1b, 0x40], 'inizia con ESC @');
  assert.notEqual(bytes[2], 0x1b, 'intensita 0: nessun ESC 7');
  const b = bands(Uint8Array.from(bytes));
  assert.deepEqual(b.map((x) => x.rows), [24, 24, 2]);
  assert.ok(b.every((x) => x.xBytes === 48));
  assert.equal(b[0].at, 2, 'la prima banda segue ESC @');
  assert.deepEqual(bytes.slice(-3), [0x1b, 0x64, 4], 'finisce con ESC d 4');
  assert.deepEqual(bytes.slice(10, 10 + 48), Array.from(img.rowsSlice(0, 1)), 'righe MSB-first della BitImage');
  // stati: printing con avanzamento crescente, poi ready
  const k = kinds();
  assert.ok(k.indexOf('printing') > k.indexOf('ready'));
  assert.equal(k[k.length - 1], 'ready');
  const progress = states.filter((s) => s.kind === 'printing').map((s) => s.progress);
  assert.ok(progress.length >= 2);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1]);
  assert.equal(progress[progress.length - 1], 1);
  assert.ok(fractions.length >= 2 && fractions.length <= 101);
  assert.deepEqual(fractions[fractions.length - 1], [1, bytes.length, bytes.length]);
  assert.equal(mgr.state.progress, 0);
});

test('print(): intensita, taglio, avanzamento e altezza banda dalle impostazioni', async () => {
  const dev = netum();
  const { mgr } = setup({ devices: [dev], settings: { heatLevel: 3, cutPaper: true, feedLines: 7, bandHeight: 16 } });
  await mgr.pair();
  await mgr.print(image(384, 40));
  const bytes = delivered(dev);
  assert.deepEqual(bytes.slice(0, 7), [0x1b, 0x40, 0x1b, 0x37, 10, 110, 2], 'ESC @ + ESC 7 del livello 3');
  assert.deepEqual(bands(Uint8Array.from(bytes)).map((x) => x.rows), [16, 16, 8]);
  assert.deepEqual(bytes.slice(-7), [0x1b, 0x64, 7, 0x1d, 0x56, 66, 0], 'ESC d 7 + GS V 66 0');
});

test('print(): immagine piu stretta centrata sulla carta, piu larga rifiutata senza toccare lo stato', async () => {
  const dev = netum();
  const { mgr, kinds } = setup({ devices: [dev], settings: { paper: 'MM80' } });
  await mgr.pair();
  const narrow = new BitImage(384, 8);
  for (let x = 0; x < 384; x++) narrow.set(x, 0, true);
  await mgr.print(narrow);
  const bytes = Uint8Array.from(delivered(dev));
  const [band] = bands(bytes);
  assert.equal(band.xBytes, 72, '80 mm = 576 punti = 72 byte');
  const row = Array.from(bytes.slice(band.at + 8, band.at + 8 + 72));
  assert.deepEqual(row.slice(0, 12), new Array(12).fill(0), '96 punti bianchi a sinistra');
  assert.deepEqual(row.slice(12, 60), new Array(48).fill(0xff));
  assert.deepEqual(row.slice(60), new Array(12).fill(0));

  const { mgr: m2, kinds: k2 } = setup({ devices: [netum()] });
  await m2.pair();
  const before = k2().length;
  const r = await m2.print(new BitImage(576, 8));
  assert.deepEqual([r.ok, r.failure], [false, 'RENDER_FAILED']);
  assert.equal(r.message, t('prn_err_too_wide', 80));
  assert.equal(k2().length, before, 'nessun cambio di stato');
  assert.equal(m2.state.kind, 'ready');
  assert.ok(kinds().length > 0);
});

test('copies: il lavoro intero ripetuto, avanzamento su tutte le copie', async () => {
  const dev = netum();
  const { mgr } = setup({ devices: [dev] });
  await mgr.pair();
  const img = image(384, 10);
  const one = Array.from(buildJobBytes(img, DEFAULTS));
  const r = await mgr.print(img, { copies: 3 });
  assert.equal(r.bytes, one.length * 3);
  assert.deepEqual(delivered(dev), one.concat(one, one));
  dev.writes.length = 0;
  await mgr.print(img, { copies: 99 });
  assert.equal(delivered(dev).length, one.length * PrinterTuning.COPIES_MAX);
});

test('BUSY: un secondo lavoro durante il primo viene rifiutato subito, lo stato resta printing', async () => {
  const dev = netum({ latency: 3 });
  const { mgr } = setup({ devices: [dev] });
  await mgr.pair();
  const first = mgr.print(image(384, 60));
  const second = await mgr.print(image(384, 10));
  assert.deepEqual([second.ok, second.failure, second.message], [false, 'BUSY', t('prn_err_busy')]);
  assert.ok(['printing', 'connecting'].includes(mgr.state.kind));
  const r = await first;
  assert.equal(r.ok, true);
  const test2 = await mgr.printTestPage();
  assert.equal(test2.ok, true, 'finito il lavoro, si stampa di nuovo');
});

test('nessuna stampante: NO_PRINTER nello stato, senza chooser fuori da un tocco', async () => {
  const { mgr, nav } = setup({ devices: [netum()] });
  const r = await mgr.print(image());
  assert.deepEqual([r.ok, r.failure, r.message], [false, 'NO_PRINTER', t('prn_err_no_printer')]);
  assert.equal(mgr.state.kind, 'error');
  assert.equal(mgr.state.failure, 'NO_PRINTER');
  assert.equal(nav.requests.length, 0);
  await mgr.pair();
  assert.equal(mgr.state.kind, 'ready', 'abbinata: errore tolto');
});

test('stampante ricordata, pagina ricaricata, dentro un tocco: chooser filtrato sul nome e stampa', async () => {
  const store = storage();
  const first = setup({ devices: [netum()], store });
  await first.mgr.pair();
  const dev = netum();
  const { mgr, nav } = setup({ devices: [dev], store, activation: true });
  assert.equal(mgr.state.kind, 'not-paired', 'senza getDevices serve un tocco');
  assert.equal(mgr.state.remembered, true);
  assert.equal(mgr.state.name, 'BlueTooth Printer');
  const r = await mgr.print(image(384, 10));
  assert.equal(r.ok, true);
  assert.deepEqual(nav.requests[0].filters, [{ name: 'BlueTooth Printer' }]);
  assert.ok(delivered(dev).length > 0);
});

test('stampante ricordata senza tocco: NO_PRINTER con il nome, niente chooser', async () => {
  const store = storage();
  const first = setup({ devices: [netum()], store });
  await first.mgr.pair();
  const { mgr, nav } = setup({ devices: [netum()], store, activation: false });
  const r = await mgr.print(image(384, 10));
  assert.equal(r.failure, 'NO_PRINTER');
  assert.equal(r.message, t('prn_err_not_bonded', 'BlueTooth Printer'));
  assert.equal(nav.requests.length, 0);
});

test('reconnect(): con getDevices si ricollega da sola (disconnected → connecting → ready)', async () => {
  const store = storage();
  const first = setup({ devices: [netum()], store });
  await first.mgr.pair();
  const dev = netum({ advertises: true });
  dev.allowed = [S18F0];
  const { mgr, nav, kinds } = setup({ devices: [dev], store, remember: true });
  assert.equal(mgr.state.kind, 'disconnected');
  assert.equal(await mgr.reconnect(), true);
  assert.equal(mgr.state.kind, 'ready');
  assert.equal(nav.requests.length, 0);
  assert.deepEqual(kinds().filter((k, i, a) => k !== a[i - 1]), ['disconnected', 'connecting', 'ready']);
});

test('reconnect(): senza permessi persistenti e senza tocco restituisce false e resta not-paired', async () => {
  const store = storage();
  const first = setup({ devices: [netum()], store });
  await first.mgr.pair();
  const { mgr } = setup({ devices: [netum()], store, activation: false });
  assert.equal(await mgr.reconnect(), false);
  assert.equal(mgr.state.kind, 'not-paired');
  assert.equal(mgr.state.failure, null);
});

test('stampante spenta durante la stampa: WRITE_FAILED, poi ricollegamento e stampa con NUL di risincronizzazione', async () => {
  let kill = false;
  const dev = netum({ fail: ({ n, dev: d }) => (kill && n === 3 ? (d.gatt.disconnect(), dom('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.')) : null) });
  const { mgr } = setup({ devices: [dev] });
  await mgr.pair();
  kill = true;
  const r = await mgr.print(image(384, 60));
  assert.deepEqual([r.ok, r.failure], [false, 'WRITE_FAILED']);
  assert.equal(r.message, t('prn_err_write', 'BlueTooth Printer'));
  assert.equal(mgr.state.kind, 'error');
  assert.equal(mgr.state.failure, 'WRITE_FAILED');
  kill = false;
  dev.writes.length = 0;
  const img = image(384, 10);
  const r2 = await mgr.print(img);
  assert.equal(r2.ok, true);
  assert.equal(mgr.state.kind, 'ready');
  const bytes = delivered(dev);
  const fill = 8 + 48 * 24;
  assert.deepEqual(bytes.slice(0, fill), new Array(fill).fill(0), 'una banda intera di NUL chiude il GS v 0 rimasto aperto');
  assert.deepEqual(bytes.slice(fill), Array.from(buildJobBytes(img, DEFAULTS)));
  dev.writes.length = 0;
  await mgr.print(img);
  assert.deepEqual(delivered(dev).slice(0, 2), [0x1b, 0x40], 'la risincronizzazione si manda una volta sola');
});

test('collegamento morto prima del primo byte: una sola riconnessione automatica', async () => {
  let failFirst = false;
  const dev = netum({ fail: ({ dev: d }) => (failFirst ? (failFirst = false, d.gatt.disconnect(), dom('NetworkError', 'GATT Server is disconnected.')) : null) });
  const { mgr } = setup({ devices: [dev] });
  await mgr.pair();
  failFirst = true;
  const img = image(384, 10);
  const r = await mgr.print(img);
  assert.equal(r.ok, true);
  assert.deepEqual(delivered(dev), Array.from(buildJobBytes(img, DEFAULTS)));
  assert.equal(dev.connectCalls, 2);
});

test('connessione appesa: CONNECT_FAILED con il timeout nel messaggio', async () => {
  let hang = false;
  const dev = netum({ connect: () => (hang ? 'hang' : null) });
  const { mgr } = setup({ devices: [dev] });
  await mgr.pair();
  dev.gatt.disconnect();
  assert.equal(mgr.state.kind, 'disconnected');
  hang = true;
  const r = await mgr.print(image(384, 10));
  assert.deepEqual([r.ok, r.failure], [false, 'CONNECT_FAILED']);
  assert.equal(r.message, t('prn_err_connect_timeout', 'BlueTooth Printer', 20));
  assert.equal(mgr.state.failure, 'CONNECT_FAILED');
});

test('Bluetooth spento (getAvailability false): BLUETOOTH_OFF prima di collegarsi', async () => {
  const dev = netum();
  const { mgr, nav } = setup({ devices: [dev] });
  await mgr.pair();
  dev.gatt.disconnect();
  nav.bluetooth.getAvailability = () => Promise.resolve(false);
  const r = await mgr.print(image(384, 10));
  assert.deepEqual([r.ok, r.failure, r.message], [false, 'BLUETOOTH_OFF', t('prn_err_bluetooth_off')]);
  assert.equal(dev.connectCalls, 1, 'nessun tentativo di connessione');
});

test('failureFor: mappa degli errori di Web Bluetooth', () => {
  assert.equal(failureFor(dom('NotFoundError', 'User cancelled the requestDevice() chooser.')).failure, 'NO_PRINTER');
  assert.equal(failureFor(dom('NotFoundError', 'Bluetooth adapter not available.')).failure, 'BLUETOOTH_OFF');
  assert.equal(failureFor(dom('NotFoundError', 'Location permission is required.')).failure, 'BLUETOOTH_OFF');
  assert.equal(failureFor(dom('NotFoundError', 'No Services found in device.')).failure, 'NO_CHANNEL');
  assert.equal(failureFor(dom('SecurityError', 'Must be handling a user gesture.')).failure, 'NO_PRINTER');
  assert.equal(failureFor(dom('NetworkError', 'Connection attempt failed.')).failure, 'CONNECT_FAILED');
  assert.equal(failureFor(dom('NetworkError', 'GATT Server is disconnected.'), 'write').failure, 'WRITE_FAILED');
  const w = failureFor(dom('NotSupportedError', 'GATT Error Unknown.'), 'write', 'MPT-II');
  assert.equal(w.failure, 'WRITE_FAILED');
  assert.equal(w.message, t('prn_err_write', 'MPT-II'), 'scrittura rifiutata durante l\'invio: stampa interrotta');
  assert.equal(w.detail, 'GATT Error Unknown.');
  assert.equal(failureFor({ code: 'no-device', message: 'x' }).failure, 'NO_PRINTER');
  assert.equal(failureFor({ code: 'timeout', message: 'x' }).failure, 'CONNECT_FAILED');
  assert.equal(failureFor(new TypeError('boom'), 'write').failure, 'WRITE_FAILED');
  const f = failureFor(dom('NetworkError', 'Connection attempt failed.'), 'connect', 'MPT-II');
  assert.equal(f.message, t('prn_err_connect', 'MPT-II'));
  assert.equal(f.detail, 'Connection attempt failed.');
});

test('inattivita: dopo idleDisconnectMs il collegamento si chiude e lo stato e disconnected', async () => {
  const dev = netum();
  const { mgr } = setup({ devices: [dev], idleMs: 2000 });
  await mgr.pair();
  await mgr.print(image(384, 10));
  assert.equal(mgr.state.kind, 'ready');
  // 2000 ms a velocita x50 = 40 ms: si aspetta la chiusura, con un limite.
  for (let i = 0; i < 200 && dev.gatt.connected; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(dev.gatt.connected, false);
  assert.equal(mgr.state.kind, 'disconnected');
  const r = await mgr.print(image(384, 10));
  assert.equal(r.ok, true, 'la stampa successiva si ricollega da sola');
  mgr.dispose();
});

test('disconnect() e forget()', async () => {
  const dev = netum();
  const { mgr, store } = setup({ devices: [dev] });
  await mgr.pair();
  await mgr.print(image(384, 10));
  await mgr.disconnect();
  assert.equal(dev.gatt.connected, false);
  assert.equal(mgr.state.kind, 'disconnected');
  await mgr.forget();
  assert.equal(mgr.state.kind, 'not-paired');
  assert.equal(mgr.state.remembered, false);
  assert.equal(store.getItem(BLE_STORE), null);
  assert.equal(dev.forgotten, true);
});

test('printTestPage(): pagina di prova con le impostazioni e il nome della stampante', async () => {
  const dev = netum();
  const { mgr } = setup({ devices: [dev], settings: { heatLevel: 1, feedLines: 2 } });
  await mgr.pair();
  dev.gatt.disconnect();
  const r = await mgr.printTestPage();
  assert.equal(r.ok, true);
  const bytes = Uint8Array.from(delivered(dev));
  assert.deepEqual(Array.from(bytes.slice(0, 7)), [0x1b, 0x40, 0x1b, 0x37, 7, 60, 2]);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.includes('FOTOFLASH'));
  assert.ok(text.includes('BlueTooth Printer'));
  // Le righe vanno a capo a 31 colonne: si confronta il testo senza a capo.
  assert.ok(text.replace(/\n/g, ' ').includes(t('prn_test_transfer', 24, 100, 0)), 'blocco e pausa dell\'invio BLE');
  assert.deepEqual(Array.from(bytes.slice(-3)), [0x1b, 0x64, 2]);
});

test('reconnect() con la stampante gia collegata: true e l\'errore del lavoro precedente sparisce', async () => {
  let fail = false;
  const dev = netum({ fail: () => (fail ? dom('NotSupportedError', 'GATT Error Unknown.') : null) });
  const { mgr } = setup({ devices: [dev] });
  await mgr.pair();
  mgr.ble.setWriteMode('response-20');
  fail = true;
  const r = await mgr.print(image(384, 10));
  assert.equal(r.failure, 'WRITE_FAILED');
  assert.equal(mgr.state.kind, 'error');
  fail = false;
  assert.equal(await mgr.reconnect(), true);
  assert.equal(mgr.state.kind, 'ready');
});

test('lavoro in attesa della stampante ricordata (nessun annuncio): connecting, mai "printing 0%"', async () => {
  const store = storage();
  const first = setup({ devices: [netum()], store });
  await first.mgr.pair();
  const dev = netum(); // non annuncia: si aspetta tutto ADVERTISEMENT_WAIT_MS (160 ms a x50)
  dev.allowed = [S18F0];
  const { mgr, states } = setup({ devices: [dev], store, remember: true });
  const job = mgr.print(image(384, 10));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(dev.connectCalls, 0, 'ancora in attesa dell\'annuncio');
  assert.equal(mgr.state.kind, 'connecting');
  const r = await job;
  assert.equal(r.ok, true);
  const distinct = states.map((st) => st.kind).filter((k, i, a) => k !== a[i - 1]);
  assert.deepEqual(distinct, ['disconnected', 'connecting', 'printing', 'ready']);
  assert.ok(delivered(dev).length > 0);
});

test('connessione fallita (NetworkError): niente giro in piu del manager oltre al ritentativo di ble.js', async () => {
  let down = false;
  const dev = netum({ connect: () => (down ? dom('NetworkError', 'Connection attempt failed.') : null) });
  const { mgr } = setup({ devices: [dev] });
  await mgr.pair();
  dev.gatt.disconnect();
  down = true;
  const r = await mgr.print(image(384, 10));
  assert.deepEqual([r.ok, r.failure], [false, 'CONNECT_FAILED']);
  assert.equal(r.message, t('prn_err_connect', 'BlueTooth Printer'));
  assert.equal(dev.connectCalls, 1 + 2, 'abbinamento + due tentativi di ble.js');
});

test('collegata fuori da un lavoro (abbinamento diretto da ble.js): chiusa anche lei dopo l\'inattivita', async () => {
  const dev = netum();
  const { mgr } = setup({ devices: [dev], idleMs: 2000 });
  await mgr.ble.pair();
  assert.equal(mgr.state.kind, 'ready');
  for (let i = 0; i < 200 && dev.gatt.connected; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(dev.gatt.connected, false);
  assert.equal(mgr.state.kind, 'disconnected');
  mgr.dispose();
});

test('il collegamento cade tra connessione e primo pezzo: riconnessione e stampa riuscita', async () => {
  const dev = netum();
  const { mgr, ble } = setup({ devices: [dev] });
  await mgr.pair();
  let dropped = false;
  ble.on((i) => {
    if (i.status === 'printing' && !dropped) {
      dropped = true;
      dev.gatt.disconnect();
    }
  });
  const img = image(384, 10);
  const r = await mgr.print(img);
  assert.equal(r.ok, true);
  assert.deepEqual(delivered(dev), Array.from(buildJobBytes(img, DEFAULTS)));
  assert.equal(dev.connectCalls, 2);
});
