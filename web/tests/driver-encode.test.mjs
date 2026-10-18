// Driver di stampa (web/src/printer/drivers/): byte esatti come DriversTest.kt, riconoscimento dal
// nome, ingresso da canvas e font bitmap delle pagine di prova.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  drivers, driverById, guessDriver, unsupportedModel, driverForPaper, allBleProfiles, encodeCanvas, encodeGray,
  escpos58, escpos80, phomemoM02, phomemoM02Pro, DEFAULT_DRIVER_ID,
} from '../src/printer/drivers/index.js';
import { encodePhomemo, phomemoDensity, PHOMEMO_SERVICE, PHOMEMO_WRITE, PHOMEMO_NOTIFY } from '../src/printer/drivers/phomemo.js';
import { heatFor, normalizeOptions } from '../src/printer/drivers/escpos.js';
import { BitImage, centeredOn } from '../src/core/bitimage.js';
import { GrayImage } from '../src/core/gray.js';
import { dither } from '../src/core/dither.js';
import { buildThermalJob, concatPackets } from '../src/core/escpos.js';
import { PaperWidth } from '../src/core/model.js';
import {
  FONT_5X7, glyph, glyphPixel, textWidth, drawText, textImage, wrapText, columnsFor, testPageImage,
  FIRST_CHAR, LAST_CHAR,
} from '../src/core/bitmapfont.js';

/** checker8 di docs/DRIVERS.md: nero se ((x >> 3) + (y >> 3)) % 2 == 0. */
function checker8(width, height) {
  const img = new BitImage(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((((x >> 3) + (y >> 3)) % 2) === 0) img.set(x, y, true);
  return img;
}

const hex = (u8) => Buffer.from(u8).toString('hex');
const TAIL = ['1b6402', '1f1108', '1f110e', '1f1107', '1f1109'];

test('elenco dei driver: id, carta, punti, dpi, retino e trasporto come docs/DRIVERS.md', () => {
  assert.deepEqual(drivers.map((d) => d.id), ['escpos-58', 'escpos-80', 'phomemo-m02', 'phomemo-m02pro']);
  assert.deepEqual(drivers.map((d) => [d.paper, d.dots, d.dpi]), [['MM58', 384, 203], ['MM80', 576, 203], ['MM58', 384, 203], ['M02PRO', 576, 300]]);
  assert.deepEqual(drivers.map((d) => d.defaultDither), ['ATKINSON', 'ATKINSON', 'FLOYD_STEINBERG', 'FLOYD_STEINBERG']);
  for (const d of drivers) {
    assert.ok(PaperWidth[d.paper], d.id);
    assert.equal(PaperWidth[d.paper].dots, d.dots, d.id);
    assert.equal(PaperWidth[d.paper].dpi, d.dpi, d.id);
  }
  assert.deepEqual(PaperWidth.M02PRO, { mm: 53, dots: 576, dpi: 300 });
  assert.deepEqual(phomemoM02Pro.defaultTransport, { chunkSize: 20, chunkDelayMs: 15, withoutResponse: true, finalDelayMs: 300 });
  assert.equal(escpos58.defaultTransport.auto, true, 'ESC/POS: strategia automatica del bridge');
  assert.equal(escpos58.defaultTransport.chunkSize, 100);
  assert.equal(escpos58.defaultTransport.withoutResponse, false);
  assert.deepEqual(phomemoM02Pro.bleProfiles, [{ name: 'FF00', service: PHOMEMO_SERVICE, write: PHOMEMO_WRITE, notify: PHOMEMO_NOTIFY }]);
  assert.equal(PHOMEMO_SERVICE, '0000ff00-0000-1000-8000-00805f9b34fb');
  assert.equal(PHOMEMO_WRITE, '0000ff02-0000-1000-8000-00805f9b34fb');
  assert.equal(PHOMEMO_NOTIFY, '0000ff03-0000-1000-8000-00805f9b34fb');
  assert.equal(allBleProfiles().filter((p) => p.service === PHOMEMO_SERVICE).length, 1, 'FF00 una volta sola');
});

test('driverById: id sconosciuto o null → escpos-58', () => {
  assert.equal(DEFAULT_DRIVER_ID, 'escpos-58');
  assert.equal(driverById('phomemo-m02pro'), phomemoM02Pro);
  assert.equal(driverById('nope'), escpos58);
  assert.equal(driverById(null), escpos58);
  assert.equal(driverById(undefined), escpos58);
  assert.equal(driverForPaper('MM80', 'escpos-58'), escpos80);
  assert.equal(driverForPaper('MM58', 'phomemo-m02'), phomemoM02, 'resta sul driver che stampa gia su quella carta');
  assert.equal(driverForPaper('M02PRO'), phomemoM02Pro);
});

test('guessDriver: stesse regole di PrinterDrivers.guess (M02X → null)', () => {
  const cases = {
    'M02': 'phomemo-m02',
    'm02': 'phomemo-m02',
    'M02 1234': 'phomemo-m02',
    'M021': 'phomemo-m02',
    'Mr.in_M02': 'phomemo-m02',
    'M02 Printer': 'phomemo-m02',
    'M02 Pro': 'phomemo-m02pro',
    'M02PRO': 'phomemo-m02pro',
    'm02 pro': 'phomemo-m02pro',
    'M02S': 'phomemo-m02pro',
    '  m02s  ': 'phomemo-m02pro',
    'M02 S': 'phomemo-m02pro',
    'M02X': null,
    'M02 X': null,
    'm02x-1234': null,
    'XM02': null,
    'M02SE': null,
    // Spazio come il \s di Java: il tab sì, lo spazio unificatore (U+00A0) no, come in Kotlin
    'M02\tPro': 'phomemo-m02pro',
    'M02 Pro': null,
    'M02 X': null,
    'BlueTooth Printer': 'escpos-58',
    'bluetooth printer': 'escpos-58',
    'Printer001': 'escpos-58',
    'MPT-II': 'escpos-58',
    'NT-1809': 'escpos-58',
    'Netum G5': 'escpos-58',
    'POS-5802': 'escpos-58',
    'MTP-3': 'escpos-58',
    'Thermal Printer': null,
    'BlueTooth Printer 2': null,
    'Pixel 8': null,
    '': null,
  };
  for (const [name, id] of Object.entries(cases)) {
    const d = guessDriver(name);
    assert.equal(d ? d.id : null, id, JSON.stringify(name));
  }
  assert.equal(guessDriver(null), null);
  assert.equal(guessDriver(undefined), null);
  assert.equal(unsupportedModel('M02X'), 'phomemo-m02x');
  assert.equal(unsupportedModel('M02 Pro'), null);
  assert.equal(unsupportedModel(null), null);
  assert.equal(escpos80.matchesName('BlueTooth Printer'), false, 'la 80 mm non si riconosce dal nome');
  assert.equal(phomemoM02.matchesName('M02S'), false);
  assert.equal(phomemoM02Pro.matchesName('M02'), false);
});

test('guessDriver: gli stessi nomi di DriversTest.kt, e matchesName coerente con guess', () => {
  const kotlin = [
    [['M02 Pro', 'M02PRO', 'm02 pro', 'Phomemo M02 Pro', 'M02S', 'm02s', 'M02 S', 'M02S-A1B2'], 'phomemo-m02pro'],
    [['M02', '  m02  ', 'M02 1234', 'M02123', 'Phomemo M02', 'M02 Printer'], 'phomemo-m02'],
    [['BlueTooth Printer', 'bluetooth printer ', 'Printer001', 'MPT-II', 'NT-1809', 'Netum NT-G58', 'POS-5890', 'MTP-3'], 'escpos-58'],
    [['M02X', 'M02 X', 'Phomemo M02X', 'm02x-1234', 'Thermal Printer', '   ', 'Galaxy Buds', 'M04S', 'XM02', 'M02-1A2B'], null],
  ];
  for (const [names, id] of kotlin) {
    for (const name of names) {
      const d = guessDriver(name);
      assert.equal(d ? d.id : null, id, JSON.stringify(name));
    }
  }
  for (const name of ['M02X', 'M02 X', 'Phomemo M02X', 'm02x-1234']) assert.equal(unsupportedModel(name), 'phomemo-m02x', name);
  for (const name of [null, '', '   ', 'Galaxy Buds', 'M04S', 'XM02', 'M02-1A2B', 'M02 Pro']) assert.equal(unsupportedModel(name), null, String(name));
  // Un nome che comincia come una ESC/POS ma contiene il modello Phomemo e una Phomemo
  assert.equal(guessDriver('Printer M02').id, 'phomemo-m02');
  assert.equal(escpos58.matchesName('Printer M02'), false);
  assert.equal(escpos58.matchesName('M02'), false);
  for (const d of drivers) {
    for (const name of ['M02 Pro', 'M02', 'BlueTooth Printer', 'Printer M02 Pro', 'M02X', 'Galaxy Buds', null]) {
      assert.equal(d.matchesName(name), guessDriver(name) === d, `${d.id} / ${name}`);
    }
  }
  assert.equal(driverById(' phomemo-m02 '), phomemoM02, 'spazi ai bordi ignorati come PrinterDrivers.byId');
  assert.equal(driverById(''), escpos58);
  assert.equal(driverById('phomemo-m02x'), escpos58);
});

test('phomemo-m02pro: sequenza esatta, blocchi da 255 + 45 righe, centratura 100 → 576', () => {
  const img = checker8(100, 300);
  const packets = phomemoM02Pro.encode(img, { feedLines: 4, cut: false, heatLevel: 0, bandHeight: 24, speed: null, widthBytes: 72 });
  assert.deepEqual(packets.map(hex).slice(0, 3), ['1b40', '1b6101', '1f110204']);
  assert.deepEqual(packets.map((p) => p.length), [2, 3, 4, 8 + 72 * 255, 8 + 72 * 45, 3, 3, 3, 3, 3, 3]);
  assert.equal(hex(packets[3].slice(0, 8)), '1d7630004800ff00');
  assert.equal(hex(packets[4].slice(0, 8)), '1d76300048002d00');
  assert.deepEqual(packets.slice(5).map(hex), ['1b6404', ...TAIL]);
  const fitted = centeredOn(img, 576);
  assert.deepEqual(Array.from(packets[3].slice(8)), Array.from(fitted.rowsSlice(0, 255)));
  assert.deepEqual(Array.from(packets[4].slice(8)), Array.from(fitted.rowsSlice(255, 45)));
  // (576 - 100) / 2 = 238 punti bianchi a sinistra: il primo nero della riga 0 e il punto 238
  const row0 = packets[3].slice(8, 8 + 72);
  assert.deepEqual(Array.from(row0.slice(0, 29)), new Array(29).fill(0));
  assert.equal(row0[29], 0x03, 'punti 238 e 239 (bit 1 e 0 del byte 29), MSB a sinistra');
  // Le opzioni assenti valgono i predefiniti
  assert.deepEqual(phomemoM02Pro.encode(img, {}).map(hex), packets.map(hex));
  assert.deepEqual(phomemoM02Pro.encode(img).map(hex), packets.map(hex));
});

test('phomemo: densita da heatLevel (0→4, 1→2, 2→4, 3→6, 4→8) o da options.density (1..15)', () => {
  const img = checker8(16, 4);
  const density = (o) => phomemoM02Pro.encode(img, o)[2][3];
  assert.deepEqual([0, 1, 2, 3, 4].map((heatLevel) => density({ heatLevel })), [4, 2, 4, 6, 8]);
  assert.equal(density({ heatLevel: 9 }), 8);
  assert.equal(density({ heatLevel: -2 }), 4);
  assert.equal(density({ heatLevel: 3, density: 12 }), 12, 'la densita scelta vince');
  assert.equal(density({ density: 0 }), 1);
  assert.equal(density({ density: 99 }), 15);
  assert.equal(phomemoDensity({ heatLevel: 3 }), 6);
});

test('phomemo: velocita 1B 4E 0D ss solo se impostata, dopo la densita', () => {
  const img = checker8(16, 4);
  const off = phomemoM02Pro.encode(img, { speed: null }).map(hex);
  assert.ok(!off.some((p) => p.startsWith('1b4e0d')));
  const on = phomemoM02Pro.encode(img, { speed: 3 }).map(hex);
  assert.deepEqual(on.slice(0, 5).map((p) => p.slice(0, 16)), ['1b40', '1b6101', '1f110204', '1b4e0d03', '1d76300048000400']);
});

test('phomemo-m02pro: larghezza 78 byte (624 punti), valori non ammessi → 72', () => {
  const img = checker8(100, 10);
  const p78 = phomemoM02Pro.encode(img, { widthBytes: 78 });
  assert.equal(hex(p78[3].slice(0, 8)), '1d7630004e000a00');
  assert.equal(p78[3].length, 8 + 78 * 10);
  assert.deepEqual(Array.from(p78[3].slice(8)), Array.from(centeredOn(img, 624).data));
  assert.equal(phomemoM02Pro.rasterShape({ widthBytes: 78 }).dots, 624);
  for (const bad of [48, 60, null, 'x', 999]) {
    assert.equal(hex(phomemoM02Pro.encode(img, { widthBytes: bad })[3].slice(4, 6)), '4800', String(bad));
  }
});

test('phomemo-m02: righe da 48 byte (30 00), la larghezza 72/78 non si applica', () => {
  const img = checker8(100, 300);
  const packets = phomemoM02.encode(img, { widthBytes: 78 });
  assert.deepEqual(packets.map((p) => p.length), [2, 3, 4, 8 + 48 * 255, 8 + 48 * 45, 3, 3, 3, 3, 3, 3]);
  assert.equal(hex(packets[3].slice(0, 8)), '1d7630003000ff00');
  assert.deepEqual(Array.from(packets[3].slice(8)), Array.from(centeredOn(img, 384).rowsSlice(0, 255)));
  // Un'immagine da 576 punti viene ritagliata al centro (offset -96)
  const wide = new BitImage(576, 2);
  for (let x = 96; x < 480; x++) wide.set(x, 0, true);
  const cropped = phomemoM02.encode(wide, {});
  assert.deepEqual(Array.from(cropped[3].slice(8, 8 + 48)), new Array(48).fill(0xff));
});

test('phomemo: blocchi al limite (255 righe = 1 blocco, 256 = 255 + 1), avanzamento e coda', () => {
  const blocks = (h) => phomemoM02Pro.encode(new BitImage(576, h), {}).filter((p) => p[0] === 0x1d).map((p) => p[6]);
  assert.deepEqual(blocks(255), [255]);
  assert.deepEqual(blocks(256), [255, 1]);
  assert.deepEqual(blocks(1), [1]);
  assert.deepEqual(blocks(600), [255, 255, 90]);
  const tail = phomemoM02Pro.encode(new BitImage(8, 1), { feedLines: 7, cut: true }).slice(-6).map(hex);
  assert.deepEqual(tail, ['1b6407', ...TAIL], 'il taglio non esiste sulle Phomemo');
  assert.equal(hex(phomemoM02Pro.encode(new BitImage(8, 1), { feedLines: 0 }).slice(-6)[0]), '1b6400');
  assert.equal(hex(phomemoM02Pro.encode(new BitImage(8, 1), { feedLines: 300 }).slice(-6)[0]), '1b64ff');
  assert.deepEqual(encodePhomemo(new BitImage(8, 1), {}, 72).map(hex), phomemoM02Pro.encode(new BitImage(8, 1), {}).map(hex));
});

test('escpos-58/80: ThermalJob.build con le DriverOptions, centrata sulla carta', () => {
  const img = checker8(100, 300);
  const o = { feedLines: 4, cut: false, heatLevel: 0, bandHeight: 24 };
  const p58 = escpos58.encode(img, o);
  assert.deepEqual(p58.map(hex), buildThermalJob(centeredOn(img, 384), { bandHeight: 24, feedLinesAfter: 4, cut: false, heat: null }).map(hex));
  assert.equal(p58.length, 1 + 13 + 1, 'ESC @, 12 bande da 24 + una da 12, avanzamento');
  assert.equal(hex(p58[0]), '1b40');
  assert.equal(hex(p58[1].slice(0, 8)), '1d76300030001800');
  assert.equal(hex(p58[13].slice(0, 8)), '1d76300030000c00');
  assert.equal(hex(p58[14]), '1b6404');
  const cut = escpos58.encode(img, { ...o, cut: true, heatLevel: 3, feedLines: 2, bandHeight: 255 });
  assert.equal(hex(cut[0]), '1b401b370a6e02', 'ESC @ + ESC 7 del livello 3 nello stesso pacchetto');
  assert.equal(hex(cut[cut.length - 1]), '1b64021d564200');
  assert.deepEqual(cut.slice(1, -1).map((p) => p[6]), [255, 45]);
  const p80 = escpos80.encode(img, o);
  assert.equal(hex(p80[1].slice(0, 8)), '1d76300048001800');
  assert.deepEqual(heatFor(1), { maxDots: 7, heatTime: 60, heatInterval: 2 });
  assert.equal(heatFor(0), null);
  assert.deepEqual(heatFor(9), heatFor(4));
  assert.deepEqual(normalizeOptions(null), { feedLines: 4, cut: false, heatLevel: 0, bandHeight: 24, speed: null, widthBytes: null, density: null });
});

test('encodeCanvas: canvas → GrayImage → retino del driver → centratura → encode', () => {
  // 10x2: nero opaco a sinistra (x < 5), trasparente a destra (= carta bianca)
  const width = 10;
  const height = 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i + 3] = x < 5 ? 255 : 0;
    }
  }
  const calls = [];
  const canvas = {
    width,
    height,
    getContext: (kind) => {
      calls.push(kind);
      return { getImageData: (x, y, w, h) => { calls.push([x, y, w, h]); return { data: rgba }; } };
    },
  };
  const packets = encodeCanvas(phomemoM02Pro, canvas, { heatLevel: 3 });
  assert.deepEqual(calls, ['2d', [0, 0, 10, 2]]);
  const expected = new BitImage(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < 5; x++) expected.set(x, y, true);
  assert.deepEqual(packets.map(hex), phomemoM02Pro.encode(centeredOn(expected, 576), { heatLevel: 3 }).map(hex));
  assert.equal(packets[2][3], 6);
  // Il retino si puo scegliere; in grigi c'e anche encodeGray
  const gray = GrayImage.gradient(64, 8);
  assert.deepEqual(encodeGray(escpos58, gray, {}, 'THRESHOLD').map(hex), escpos58.encode(dither(gray, 'THRESHOLD'), {}).map(hex));
  assert.deepEqual(encodeGray(phomemoM02, gray, {}).map(hex), phomemoM02.encode(dither(gray, 'FLOYD_STEINBERG'), {}).map(hex));
  assert.throws(() => encodeCanvas(escpos58, { width: 1, height: 1, getContext: () => null }, {}));
});

test('font bitmap 5x7: 95 caratteri ASCII, glifi noti, fuori ASCII → ?', () => {
  assert.equal(FIRST_CHAR, 32);
  assert.equal(LAST_CHAR, 126);
  assert.equal(FONT_5X7.length, 95 * 5);
  assert.ok(FONT_5X7.every((b) => b < 0x80), 'solo 7 righe');
  assert.deepEqual(Array.from(glyph(' ')), [0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(glyph('A')), [0x7e, 0x11, 0x11, 0x11, 0x7e]);
  assert.deepEqual(Array.from(glyph('0')), [0x3e, 0x51, 0x49, 0x45, 0x3e]);
  assert.deepEqual(Array.from(glyph('é')), Array.from(glyph('?')));
  assert.deepEqual(Array.from(glyph(10)), Array.from(glyph('?')));
  // Ogni carattere stampabile tranne lo spazio ha almeno un punto, e i glifi sono tutti diversi
  const seen = new Set();
  for (let c = 33; c <= 126; c++) {
    const g = Array.from(glyph(c));
    assert.ok(g.some((b) => b !== 0), String.fromCharCode(c));
    seen.add(g.join(','));
  }
  assert.equal(seen.size, 94);
  // 'I': colonna centrale piena, 'T': riga in alto piena
  for (let row = 0; row < 7; row++) assert.equal(glyphPixel('I', 2, row), true);
  for (let col = 0; col < 5; col++) assert.equal(glyphPixel('T', col, 0), true);
  assert.equal(glyphPixel('T', 0, 6), false);
});

test('font bitmap: misure, disegno a scala, a capo', () => {
  assert.equal(textWidth('', 3), 0);
  assert.equal(textWidth('AB', 1), 11);
  assert.equal(textWidth('AB', 2), 22);
  assert.equal(columnsFor(384, 2), 32);
  assert.equal(columnsFor(576, 3), 32);
  const img = textImage('I', 2);
  assert.deepEqual([img.width, img.height], [10, 14]);
  for (let y = 0; y < 14; y++) assert.equal(img.get(4, y) && img.get(5, y), true, `riga ${y}`);
  assert.equal(img.get(0, 7), false);
  const page = new BitImage(20, 10);
  assert.equal(drawText(page, 'II', -3, 0, 1), 11);
  assert.equal(page.get(2, 3), false, 'il primo carattere e tagliato a sinistra');
  assert.equal(page.get(5, 3), true, 'colonna centrale della seconda I: 6 + 2 - 3');
  assert.deepEqual(wrapText('Ciao mondo bello', 10), ['Ciao mondo', 'bello']);
  assert.deepEqual(wrapText('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(wrapText('Città', 10), ['Citt?']);
  assert.deepEqual(wrapText('a\nb', 10), ['a', 'b']);
});

test('pagina di prova raster: larghezza del lavoro, titolo, sfumature dei retini', () => {
  const page = testPageImage({ width: 576, dpi: 300, title: 'FOTOFLASH', lines: ['Riga uno'], ditherLabels: {}, footer: ['Fine'] });
  assert.equal(page.width, 576);
  assert.ok(page.height > 400);
  let black = 0;
  for (let i = 0; i < page.data.length; i++) if (page.data[i]) black++;
  assert.ok(black > 1000, 'pagina non vuota');
  for (const d of drivers) {
    const packets = d.testPage({ lines: ['Hello'], heatLevel: 2 });
    assert.ok(packets.length >= 3, d.id);
    // Sulle ESC/POS il primo pacchetto e ESC @ seguito da ESC 7 dell'intensita (livello 2)
    assert.equal(hex(packets[0].slice(0, 2)), '1b40', d.id);
    const raster = packets.filter((p) => p[0] === 0x1d && p[1] === 0x76);
    const bpr = d.family === 'phomemo' ? d.rasterShape({}).bytesPerRow : d.dots / 8;
    assert.ok(raster.length > 0 && raster.every((p) => (p[4] | (p[5] << 8)) === bpr), d.id);
    const rows = raster.reduce((sum, p) => sum + (p[6] | (p[7] << 8)), 0);
    assert.ok(rows >= 400 && rows <= 4000, `${d.id}: ${rows} righe`);
    if (d.family === 'phomemo') {
      assert.equal(hex(packets[1]), '1b6101', d.id);
      assert.equal(hex(packets[2]), '1f110204', d.id);
      assert.deepEqual(packets.slice(-5).map(hex), TAIL, d.id);
    } else {
      assert.equal(hex(packets[0]), '1b401b37085002', d.id);
    }
    // Deterministica: due chiamate, gli stessi byte
    assert.deepEqual(d.testPage({ heatLevel: 2, speed: 2 }).map(hex), d.testPage({ heatLevel: 2, speed: 2 }).map(hex), d.id);
  }
  const wide = phomemoM02Pro.testPage({ widthBytes: 78 });
  assert.equal(hex(wide[3].slice(0, 8)), '1d7630004e00ff00', 'pagina larga 624 punti, primo blocco da 255 righe');
  assert.ok(wide.filter((p) => p[0] === 0x1d).every((p) => p[4] === 78));
  assert.ok(concatPackets(wide).length > 0);
  // I testi cambiano la pagina; senza testi restano titolo, righe tecniche e bande
  const plain = concatPackets(phomemoM02Pro.testPage({}));
  const custom = concatPackets(phomemoM02Pro.testPage({ subtitle: 'PROVA', lines: ['STAMPANTE DI PROVA'], widthCheck: 'BORDI', footer: ['FINE'] }));
  assert.notDeepEqual(Array.from(custom), Array.from(plain));
});

test('righe tecniche della pagina di prova: le stesse di DriverTestPage.technicalLines', () => {
  assert.deepEqual(phomemoM02Pro.technicalLines({}),
    ['phomemo-m02pro', '576 DOTS, 300 DPI, 48.8 MM', 'DENSITY 4/15, SPEED OFF', 'ROW 72 B, FEED 4']);
  assert.deepEqual(phomemoM02Pro.technicalLines({ widthBytes: 78, speed: 2, density: 10 }),
    ['phomemo-m02pro', '624 DOTS, 300 DPI, 52.8 MM', 'DENSITY 10/15, SPEED 2', 'ROW 78 B, FEED 4']);
  assert.deepEqual(escpos58.technicalLines({ heatLevel: 2, cut: true }),
    ['escpos-58', '384 DOTS, 203 DPI, 48.0 MM', 'HEAT 2/4, BAND 24', 'FEED 4, CUT ON']);
  assert.deepEqual(phomemoM02.technicalLines({ widthBytes: 78 }),
    ['phomemo-m02', '384 DOTS, 203 DPI, 48.0 MM', 'DENSITY 4/15, SPEED OFF', 'ROW 48 B, FEED 4']);
  assert.deepEqual(escpos80.technicalLines({}).slice(0, 2), ['escpos-80', '576 DOTS, 203 DPI, 72.1 MM']);
  // Nessuna riga va a capo a 384 punti x2 (30 caratteri)
  for (const d of drivers) {
    for (const line of d.technicalLines({ widthBytes: 78, speed: 255, density: 15, heatLevel: 4, bandHeight: 255, feedLines: 255, cut: true })) {
      assert.ok(line.length <= 30, `${d.id}: "${line}"`);
    }
  }
});
