// PrinterManager con i driver (docs/DRIVERS.md): driver dalle impostazioni, opzioni e trasporto del
// lavoro, riconoscimento dopo l'abbinamento e, soprattutto, il chooser aperto DENTRO il gesto:
// ble.pair() va chiamata prima di qualsiasi await del percorso del tocco, mai dopo l'attesa
// dell'annuncio (8 s), quando Chrome ha già chiuso la finestra del gesto utente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrinterManager, PrinterTuning, driverFor, paperFor, driverOptionsFor, transportFor, buildJobBytes } from '../src/printer/manager.js';
import { createBle } from '../src/printer/ble.js';
import { phomemoM02, phomemoM02Pro, escpos58 } from '../src/printer/drivers/index.js';
import { PHOMEMO_SERVICE, PHOMEMO_WRITE } from '../src/printer/drivers/phomemo.js';
import { concatPackets } from '../src/core/escpos.js';
import { BitImage } from '../src/core/bitimage.js';
import { normalizeSettings, mergeSettings } from '../src/store/settings.js';
import { t } from '../src/i18n/i18n.js';
import { device, netum, fakeBluetooth, fastTimers, storage, delivered } from './printer-fakes.test.mjs';

/** Impostazioni come lo store vero (normalizzazione e carta allineata al driver), senza localStorage. */
function fakeSettings(initial = {}) {
  let value = normalizeSettings(initial);
  return { get: () => value, set: (patch) => { value = mergeSettings(value, patch); } };
}

function checker8(width, height) {
  const img = new BitImage(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((((x >> 3) + (y >> 3)) % 2) === 0) img.set(x, y, true);
  return img;
}

/**
 * ble.js finto che registra l'ordine delle chiamate. remembered = stampante salvata ma non in
 * questa pagina; canRemember = getDevices disponibile; found = cosa restituisce reconnect().
 */
function recordingBle({ name = 'M02 Pro', remembered = true, canRemember = false, found = false } = {}) {
  const log = [];
  const st = { paired: false, status: 'idle' };
  const info = () => ({
    status: st.status, name, paired: st.paired, remembered, connected: st.paired && st.status === 'ready',
    profile: st.paired ? 'FF00' : null, characteristic: null, writeMode: 'auto', chunk: null, transfer: null,
    lastError: null, lastErrorCode: null
  });
  const ble = {
    log,
    supported: () => true,
    canRemember: () => canRemember,
    available: () => { log.push('available'); return Promise.resolve(true); },
    info,
    on: () => () => {},
    pair: (opts) => {
      log.push('pair');
      ble.pairOptions = opts;
      st.paired = true;
      st.status = 'ready';
      return Promise.resolve(info());
    },
    reconnect: () => {
      log.push('reconnect');
      if (!found) return Promise.resolve(null);
      st.paired = true;
      st.status = 'ready';
      return Promise.resolve(info());
    },
    print: (bytes, opts) => { log.push('print'); ble.printed = { bytes, opts }; return Promise.resolve({ ok: true }); },
    disconnect: () => { st.status = 'disconnected'; },
    forget: () => Promise.resolve(),
    preferProfiles: () => {},
    manualDriver: () => null,
    setManualDriver: () => {}
  };
  return ble;
}

function managerWith(ble, { active = true, settings = {} } = {}) {
  const nav = { userActivation: { isActive: active, hasBeenActive: active } };
  const s = fakeSettings(settings);
  const mgr = new PrinterManager(s, ble, { idleDisconnectMs: 0, navigator: () => nav });
  return { mgr, settings: s };
}

// ------------------------------------------------------------------ gesto utente

test('tocco su Stampa, stampante ricordata e niente getDevices: pair() parte prima di ogni await', async () => {
  const ble = recordingBle();
  const { mgr } = managerWith(ble);
  const pending = mgr.print(checker8(384, 24));
  // Stesso tick del tocco: nessun await è ancora passato e il chooser è già stato chiesto.
  assert.deepEqual(ble.log, ['pair']);
  assert.deepEqual(ble.pairOptions, { sameName: true }, 'chooser filtrato sulla stampante ricordata');
  const r = await pending;
  assert.equal(r.ok, true);
  assert.equal(ble.log[0], 'pair');
  assert.ok(!ble.log.includes('reconnect'), 'niente attesa silenziosa quando il chooser è già aperto');
  assert.ok(ble.log.includes('print'));
});

test('tocco su Pagina di prova e su Ricollega: pair() prima di ogni await', async () => {
  const forTest = recordingBle();
  const a = managerWith(forTest, { settings: { printerDriver: 'phomemo-m02pro' } });
  const pendingTest = a.mgr.printTestPage();
  assert.deepEqual(forTest.log, ['pair']);
  const r = await pendingTest;
  assert.equal(r.ok, true);
  assert.ok(forTest.printed.bytes.length > 1000, 'pagina di prova raster inviata');
  assert.deepEqual(Array.from(forTest.printed.bytes.slice(0, 5)), [0x1b, 0x40, 0x1b, 0x61, 0x01]);

  const forReconnect = recordingBle();
  const b = managerWith(forReconnect);
  const pendingReconnect = b.mgr.reconnect();
  assert.deepEqual(forReconnect.log, ['pair']);
  assert.equal(await pendingReconnect, true);
  assert.equal(b.mgr.state.kind, 'ready');
});

test('via silenziosa fallita dentro il tocco: nessun chooser dopo l\'attesa, NO_PRINTER con «Abbina»; il tocco dopo lo apre subito', async () => {
  const ble = recordingBle({ canRemember: true, found: false });
  const { mgr } = managerWith(ble);
  const r = await mgr.print(checker8(384, 24));
  assert.deepEqual([r.ok, r.failure, r.action], [false, 'NO_PRINTER', 'pair']);
  assert.equal(r.message, t('prn_err_not_bonded', 'M02 Pro'));
  assert.ok(ble.log.includes('reconnect'), 'prima la via silenziosa (getDevices + annuncio)');
  assert.ok(!ble.log.includes('pair'), 'mai il chooser dopo un await: il gesto è scaduto');
  assert.equal(mgr.state.kind, 'error');
  assert.equal(mgr.state.failure, 'NO_PRINTER');
  assert.equal(mgr.state.action, 'pair');

  // Il tocco successivo sa che la via silenziosa non funziona: chooser subito, nello stesso tick
  ble.log.length = 0;
  const again = mgr.print(checker8(384, 24));
  assert.deepEqual(ble.log, ['pair']);
  assert.equal((await again).ok, true);
});

test('reconnect() dentro il tocco con la via silenziosa fallita: stato NO_PRINTER con «Abbina», poi pair() subito', async () => {
  const ble = recordingBle({ canRemember: true, found: false });
  const { mgr } = managerWith(ble);
  assert.equal(await mgr.reconnect(), false);
  assert.deepEqual(ble.log, ['reconnect']);
  assert.equal(mgr.state.kind, 'error');
  assert.equal(mgr.state.failure, 'NO_PRINTER');
  assert.equal(mgr.state.action, 'pair');
  ble.log.length = 0;
  const pending = mgr.reconnect();
  assert.deepEqual(ble.log, ['pair']);
  assert.equal(await pending, true);
  assert.equal(mgr.state.kind, 'ready');
});

test('via silenziosa riuscita: niente chooser, stampa', async () => {
  const ble = recordingBle({ canRemember: true, found: true });
  const { mgr } = managerWith(ble);
  const r = await mgr.print(checker8(384, 24));
  assert.equal(r.ok, true);
  assert.ok(!ble.log.includes('pair'));
  assert.deepEqual(ble.log.filter((x) => x !== 'available'), ['reconnect', 'print']);
});

test('fuori da un gesto: nessun chooser, NO_PRINTER con l\'azione «Abbina»', async () => {
  const ble = recordingBle();
  const { mgr } = managerWith(ble, { active: false });
  const r = await mgr.print(checker8(384, 24));
  assert.deepEqual([r.failure, r.action], ['NO_PRINTER', 'pair']);
  assert.ok(!ble.log.includes('pair'));
  assert.equal(await mgr.reconnect(), false);
  assert.ok(!ble.log.includes('pair'));
});

// ------------------------------------------------------------------ driver e trasporto

test('driverFor/paperFor: driver delle impostazioni, ripiego dalla carta per le impostazioni vecchie', () => {
  assert.equal(driverFor({ printerDriver: 'phomemo-m02pro' }), phomemoM02Pro);
  assert.equal(driverFor({ printerDriver: 'phomemo-m02', paper: 'MM80' }), phomemoM02);
  assert.equal(driverFor({ paper: 'MM80' }).id, 'escpos-80');
  assert.equal(driverFor({ paper: 'M02PRO' }).id, 'phomemo-m02pro');
  assert.equal(driverFor({ printerDriver: 'boh' }).id, 'escpos-58');
  assert.equal(driverFor(null).id, 'escpos-58');
  assert.deepEqual(paperFor({ printerDriver: 'phomemo-m02pro' }), { mm: 53, dots: 576, dpi: 300 });
  assert.equal(paperFor({ printerDriver: 'phomemo-m02' }).dots, 384);
});

test('driverOptionsFor: limiti di PrinterTuning, opzioni Phomemo null = predefinite del driver', () => {
  assert.deepEqual(driverOptionsFor({}), {
    feedLines: 4, cut: false, heatLevel: 0, bandHeight: 24, speed: null, widthBytes: null, density: null
  });
  assert.deepEqual(driverOptionsFor({
    feedLines: 20, cutPaper: true, heatLevel: 3, bandHeight: 4, printerSpeed: 9, phomemoWidthBytes: 78, phomemoDensity: 40
  }), { feedLines: 10, cut: true, heatLevel: 3, bandHeight: 8, speed: 5, widthBytes: 78, density: 15 });
  assert.equal(driverOptionsFor({ printerSpeed: 0 }).speed, 1);
});

test('transportFor: ESC/POS senza scelte = strategia automatica (null); Phomemo = 20 B, 15 ms, senza conferma', () => {
  assert.equal(transportFor({ printerDriver: 'escpos-58' }), null);
  assert.equal(transportFor({ printerDriver: 'escpos-80', bleChunkSize: null, bleChunkDelayMs: null, bleWithoutResponse: null }), null);
  assert.deepEqual(transportFor({ printerDriver: 'escpos-58', bleChunkSize: 60 }),
    { chunkSize: 60, chunkDelayMs: 0, withoutResponse: false, finalDelayMs: 300 });
  assert.deepEqual(transportFor({ printerDriver: 'phomemo-m02pro' }),
    { chunkSize: 20, chunkDelayMs: 15, withoutResponse: true, finalDelayMs: 300 });
  assert.deepEqual(transportFor({ printerDriver: 'phomemo-m02', bleChunkSize: 128, bleChunkDelayMs: 20 }),
    { chunkSize: 128, chunkDelayMs: 20, withoutResponse: true, finalDelayMs: 300 });
  assert.deepEqual(transportFor({ printerDriver: 'phomemo-m02pro', bleChunkSize: 4, bleChunkDelayMs: 900, bleWithoutResponse: false }),
    { chunkSize: PrinterTuning.BLE_CHUNK_MIN, chunkDelayMs: PrinterTuning.BLE_DELAY_MAX, withoutResponse: false, finalDelayMs: 300 });
});

test('buildJobBytes: i byte sono quelli del driver delle impostazioni', () => {
  const img = checker8(100, 300);
  const s = normalizeSettings({ printerDriver: 'phomemo-m02pro', heatLevel: 3, phomemoWidthBytes: 78 });
  assert.equal(s.paper, 'M02PRO', 'la carta segue il driver');
  assert.deepEqual(Array.from(buildJobBytes(img, s)), Array.from(concatPackets(phomemoM02Pro.encode(img, driverOptionsFor(s)))));
  const e = normalizeSettings({ printerDriver: 'escpos-58', cutPaper: true });
  assert.deepEqual(Array.from(buildJobBytes(img, e)), Array.from(concatPackets(escpos58.encode(img, driverOptionsFor(e)))));
});

test('stampa Phomemo attraverso ble.js: byte del driver, pezzi da 20 senza conferma, pause di 15 ms', async () => {
  const dev = device({ name: 'M02 Pro', services: { [PHOMEMO_SERVICE]: [[PHOMEMO_WRITE, { write: true, writeWithoutResponse: true }]] } });
  const nav = fakeBluetooth({ devices: [dev] });
  const timers = fastTimers(200);
  const ble = createBle({ navigator: () => nav, storage: () => storage(), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  const settings = fakeSettings({ printerDriver: 'phomemo-m02pro', dither: 'FLOYD_STEINBERG' });
  const mgr = new PrinterManager(settings, ble, { idleDisconnectMs: 0, navigator: () => nav, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  await mgr.pair();
  assert.equal(mgr.state.profile, 'FF00');
  const img = checker8(576, 6);
  timers.log.length = 0;
  const r = await mgr.print(img);
  assert.equal(r.ok, true);
  const expected = concatPackets(phomemoM02Pro.encode(img, driverOptionsFor(settings.get())));
  assert.deepEqual(delivered(dev), Array.from(expected));
  assert.ok(dev.writes.every((w) => w.withResponse === false && w.bytes.length <= 20));
  assert.equal(dev.writes.length, Math.ceil(expected.length / 20));
  assert.equal(timers.log.filter((ms) => ms === 15).length, dev.writes.length - 1);
});

// ------------------------------------------------------------------ riconoscimento dopo l'abbinamento

function realSetup(devices, settings = {}, store = storage()) {
  const nav = fakeBluetooth({ devices });
  const timers = fastTimers();
  const ble = createBle({ navigator: () => nav, storage: () => store, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  const s = fakeSettings(settings);
  const mgr = new PrinterManager(s, ble, { idleDisconnectMs: 0, navigator: () => nav, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  return { mgr, settings: s, ble, store };
}

function m02Device(name) {
  return device({ name, services: { [PHOMEMO_SERVICE]: [[PHOMEMO_WRITE, { write: true, writeWithoutResponse: true }]] } });
}

test('dopo l\'abbinamento il nome sceglie il driver, carta e retino lo seguono; la scelta a mano resta', async () => {
  const { mgr, settings } = realSetup([m02Device('M02 Pro'), m02Device('M02 Pro'), m02Device('M02')]);
  assert.equal(mgr.state.driver, 'escpos-58');
  await mgr.pair();
  assert.equal(settings.get().printerDriver, 'phomemo-m02pro');
  assert.equal(settings.get().paper, 'M02PRO');
  assert.equal(settings.get().dither, 'FLOYD_STEINBERG', 'retino proposto dal driver (era il predefinito ESC/POS)');
  assert.equal(mgr.state.driver, 'phomemo-m02pro');
  assert.equal(mgr.currentDriver(), phomemoM02Pro);

  // Scelta a mano: vale per questa stampante anche dopo un nuovo abbinamento
  mgr.setDriver('escpos-58');
  assert.equal(settings.get().paper, 'MM58');
  assert.equal(settings.get().dither, 'ATKINSON');
  await mgr.pair({ sameName: true });
  assert.equal(settings.get().printerDriver, 'escpos-58');

  // Un'altra stampante: le scelte manuali della precedente non valgono più, decide il nome
  await mgr.pair();
  assert.equal(settings.get().printerDriver, 'phomemo-m02');
  assert.equal(settings.get().paper, 'MM58');
  assert.throws(() => mgr.setDriver('phomemo-m02x'), RangeError);
});

test('retino scelto dall\'utente: il cambio di driver non lo tocca', async () => {
  const { mgr, settings } = realSetup([m02Device('M02S')], { dither: 'ORDERED_BAYER' });
  await mgr.pair();
  assert.equal(settings.get().printerDriver, 'phomemo-m02pro');
  assert.equal(settings.get().dither, 'ORDERED_BAYER');
});

test('nome ESC/POS: la 80 mm scelta dall\'utente resta; M02X: driver invariato e modello segnalato', async () => {
  const a = realSetup([netum()], { printerDriver: 'escpos-80' });
  await a.mgr.pair();
  assert.equal(a.settings.get().printerDriver, 'escpos-80');
  const b = realSetup([m02Device('M02X')]);
  await b.mgr.pair();
  assert.equal(b.settings.get().printerDriver, 'escpos-58');
  assert.equal(b.mgr.state.unsupported, 'phomemo-m02x');
});

test('cambio di famiglia (anche dopo un abbinamento, senza la UI): la calibrazione BLE torna ai predefiniti', async () => {
  const tuned = { bleChunkSize: 128, bleChunkDelayMs: 20, bleWithoutResponse: true };
  const pick = (s) => ({ bleChunkSize: s.bleChunkSize, bleChunkDelayMs: s.bleChunkDelayMs, bleWithoutResponse: s.bleWithoutResponse });
  // Phomemo «Massima» → una ESC/POS riconosciuta dal nome: la strategia automatica del bridge torna
  const a = realSetup([netum()], { printerDriver: 'phomemo-m02pro', ...tuned });
  await a.mgr.pair();
  assert.equal(a.settings.get().printerDriver, 'escpos-58');
  assert.deepEqual(pick(a.settings.get()), { bleChunkSize: null, bleChunkDelayMs: null, bleWithoutResponse: null });
  assert.equal(transportFor(a.settings.get()), null);
  // Stessa famiglia (M02 → M02 Pro): la calibrazione dell'utente resta
  const b = realSetup([m02Device('M02 Pro')], { printerDriver: 'phomemo-m02', ...tuned });
  await b.mgr.pair();
  assert.equal(b.settings.get().printerDriver, 'phomemo-m02pro');
  assert.deepEqual(pick(b.settings.get()), tuned);
  // Scelta a mano verso l'altra famiglia: stessa regola
  b.mgr.setDriver('escpos-80');
  assert.deepEqual(pick(b.settings.get()), { bleChunkSize: null, bleChunkDelayMs: null, bleWithoutResponse: null });
  // Stesso driver: niente cambia
  const c = realSetup([], { printerDriver: 'phomemo-m02pro', ...tuned });
  c.mgr.setDriver('phomemo-m02pro');
  assert.deepEqual(pick(c.settings.get()), tuned);
});

test('abbinamento dentro Stampa che cambia famiglia: il lavoro usa il driver nuovo con il suo trasporto', async () => {
  // Impostazioni ESC/POS con invio «con conferma» scelto a mano; la stampante ricordata e una M02 Pro
  const ble = recordingBle({ name: 'M02 Pro' });
  const { mgr, settings } = managerWith(ble, {
    settings: { printerDriver: 'escpos-80', bleChunkSize: 100, bleChunkDelayMs: 0, bleWithoutResponse: false }
  });
  const r = await mgr.print(checker8(576, 8));
  assert.equal(r.ok, true);
  assert.equal(settings.get().printerDriver, 'phomemo-m02pro');
  assert.equal(ble.printed.opts.chunkSize, 20);
  assert.equal(ble.printed.opts.chunkDelayMs, 15);
  assert.equal(ble.printed.opts.withoutResponse, true);
  assert.deepEqual(Array.from(ble.printed.bytes.slice(0, 5)), [0x1b, 0x40, 0x1b, 0x61, 0x01], 'byte Phomemo');
});

test('immagine troppo larga per il driver: RENDER_FAILED senza toccare la stampante', async () => {
  const ble = recordingBle();
  const { mgr } = managerWith(ble, { settings: { printerDriver: 'phomemo-m02' } });
  const r = await mgr.print(checker8(576, 8));
  assert.equal(r.failure, 'RENDER_FAILED');
  assert.deepEqual(ble.log, []);
  // 78 byte per riga: la M02 Pro accetta fino a 624 punti
  const wide = managerWith(recordingBle(), { settings: { printerDriver: 'phomemo-m02pro', phomemoWidthBytes: 78 } });
  assert.equal((await wide.mgr.print(checker8(600, 8))).ok, true);
});
