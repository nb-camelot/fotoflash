// Vettori di prova condivisi Kotlin <-> JS (docs/DRIVERS.md, "Vettori di prova condivisi"): questo
// test GENERA web/tests/fixtures/drivers-golden.json dai driver della PWA e controlla che il file
// committato coincida. DriversGoldenTest (core-thermal) lo rilegge e pretende gli stessi byte, con la
// stessa divisione in pacchetti, dai driver Kotlin.
//
// - File assente: lo crea (va committato).
// - File diverso: lo riscrive e FALLISCE, così un golden vecchio non passa in CI; in locale basta
//   controllare il diff e committarlo. Mai a mano: se Kotlin e JS non coincidono è sbagliato uno
//   dei due porting, non il golden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drivers, driverById } from '../src/printer/drivers/index.js';
import { BitImage } from '../src/core/bitimage.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'drivers-golden.json');

/** Opzioni ammesse dal lettore Kotlin (DriversGoldenTest.OPTION_KEYS): un campo in più lo fa fallire. */
const OPTION_KEYS = new Set(['feedLines', 'cut', 'heatLevel', 'bandHeight', 'speed',
  'widthBytes', 'phomemoWidthBytes', 'densityOverride', 'density', 'phomemoDensity']);

const PATTERNS = ['checker8', 'diag', 'solid', 'empty'];

/** Pattern di docs/DRIVERS.md, identici a patternImage di DriversGoldenTest. */
function patternImage(pattern, width, height) {
  const img = new BitImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let black;
      switch (pattern) {
        case 'checker8': black = (((x >> 3) + (y >> 3)) % 2) === 0; break;
        case 'diag': black = x % 64 === y % 64; break;
        case 'solid': black = true; break;
        case 'empty': black = false; break;
        default: throw new Error(`pattern sconosciuto ${pattern}`);
      }
      if (black) img.set(x, y, true);
    }
  }
  return img;
}

// Opzioni di fabbrica scritte per esteso, come nell'esempio di docs/DRIVERS.md.
const BASE = Object.freeze({ feedLines: 4, cut: false, heatLevel: 0, bandHeight: 24, speed: null });

/**
 * Casi del file. I primi sette sono i casi minimi di docs/DRIVERS.md (ogni driver con checker8
 * 100×300, che per i Phomemo copre due blocchi, 255 + 45 righe, e la centratura; la M02 Pro anche
 * con 78 byte per riga e con heatLevel 3; escpos-58 con il taglio); gli altri coprono velocità,
 * densità scelta a mano, avanzamento nullo, ritaglio di un'immagine più larga e i pattern restanti.
 */
const CASES = [
  { driver: 'escpos-58', image: { width: 100, height: 300, pattern: 'checker8' }, options: { ...BASE } },
  { driver: 'escpos-80', image: { width: 100, height: 300, pattern: 'checker8' }, options: { ...BASE } },
  { driver: 'phomemo-m02', image: { width: 100, height: 300, pattern: 'checker8' }, options: { ...BASE } },
  { driver: 'phomemo-m02pro', image: { width: 100, height: 300, pattern: 'checker8' }, options: { ...BASE, widthBytes: 72 } },
  { driver: 'phomemo-m02pro', image: { width: 100, height: 300, pattern: 'checker8' }, options: { ...BASE, widthBytes: 78 } },
  { driver: 'phomemo-m02pro', image: { width: 100, height: 300, pattern: 'checker8' }, options: { ...BASE, heatLevel: 3, widthBytes: 72 } },
  { driver: 'escpos-58', image: { width: 100, height: 300, pattern: 'checker8' }, options: { ...BASE, cut: true } },
  { driver: 'escpos-58', image: { width: 384, height: 40, pattern: 'diag' }, options: { ...BASE, feedLines: 6, cut: true, heatLevel: 3, bandHeight: 16 } },
  { driver: 'escpos-80', image: { width: 700, height: 20, pattern: 'diag' }, options: { ...BASE, heatLevel: 4, bandHeight: 255 } },
  { driver: 'phomemo-m02pro', image: { width: 576, height: 20, pattern: 'diag' }, options: { ...BASE, speed: 3, densityOverride: 9, widthBytes: 72 } },
  { driver: 'phomemo-m02pro', image: { width: 384, height: 3, pattern: 'solid' }, options: { ...BASE, feedLines: 0, heatLevel: 4, widthBytes: 78 } },
  { driver: 'phomemo-m02', image: { width: 576, height: 2, pattern: 'solid' }, options: { ...BASE, heatLevel: 1, cut: true } },
  { driver: 'phomemo-m02', image: { width: 8, height: 1, pattern: 'empty' }, options: { ...BASE, feedLines: 2 } },
];

const toHex = (u8) => Buffer.from(u8).toString('hex');

function driverOf(id) {
  // Niente ripiego su escpos-58: un id sbagliato deve rompere il test, come nel lettore Kotlin.
  const d = drivers.find((x) => x.id === id);
  if (!d) throw new Error(`driver sconosciuto ${id}`);
  return d;
}

function generate() {
  return {
    about: 'Generato da web/tests/driver-golden.test.mjs, non modificare a mano: docs/DRIVERS.md, "Vettori di prova condivisi".',
    cases: CASES.map((c) => ({
      driver: c.driver,
      image: { ...c.image },
      options: { ...c.options },
      packetsHex: driverOf(c.driver).encode(patternImage(c.image.pattern, c.image.width, c.image.height), c.options).map(toHex),
    })),
  };
}

function serialize(golden) {
  return JSON.stringify(golden, null, 2) + '\n';
}

test('golden: i casi rispettano il formato che legge DriversGoldenTest', () => {
  for (const c of CASES) {
    assert.ok(drivers.some((d) => d.id === c.driver), c.driver);
    assert.ok(PATTERNS.includes(c.image.pattern), c.image.pattern);
    assert.ok(Number.isInteger(c.image.width) && c.image.width > 0 && Number.isInteger(c.image.height) && c.image.height > 0);
    for (const key of Object.keys(c.options)) assert.ok(OPTION_KEYS.has(key), `opzione ${key} sconosciuta al lettore Kotlin`);
  }
  // I casi minimi di docs/DRIVERS.md (gli stessi controlli di goldenFileHasTheMinimumCases)
  for (const d of drivers) {
    assert.ok(CASES.some((c) => c.driver === d.id && c.image.pattern === 'checker8' && c.image.width === 100 && c.image.height === 300), d.id);
  }
  assert.ok(CASES.some((c) => c.driver === 'phomemo-m02pro' && c.options.widthBytes === 78));
  assert.ok(CASES.some((c) => c.driver === 'phomemo-m02pro' && c.options.heatLevel === 3));
  assert.ok(CASES.some((c) => c.driver === 'escpos-58' && c.options.cut === true));
});

test('golden: i byte attesi da DriversTest.kt per la M02 Pro 100x300', () => {
  const g = generate();
  const m02pro = g.cases.find((c) => c.driver === 'phomemo-m02pro' && c.options.widthBytes === 72 && c.options.heatLevel === 0 && c.image.height === 300);
  const sizes = m02pro.packetsHex.map((h) => h.length / 2);
  assert.deepEqual(sizes, [2, 3, 4, 8 + 72 * 255, 8 + 72 * 45, 3, 3, 3, 3, 3, 3]);
  assert.deepEqual(m02pro.packetsHex.slice(0, 3), ['1b40', '1b6101', '1f110204']);
  assert.equal(m02pro.packetsHex[3].slice(0, 16), '1d7630004800ff00');
  assert.equal(m02pro.packetsHex[4].slice(0, 16), '1d76300048002d00');
  assert.deepEqual(m02pro.packetsHex.slice(5), ['1b6404', '1b6402', '1f1108', '1f110e', '1f1107', '1f1109']);
  // (576 - 100) / 2 = 238 punti bianchi, poi i primi due neri del quadretto: byte 29 = 0x03
  assert.equal(m02pro.packetsHex[3].slice(16 + 2 * 29, 16 + 2 * 30), '03');
  const heat3 = g.cases.find((c) => c.driver === 'phomemo-m02pro' && c.options.heatLevel === 3);
  assert.equal(heat3.packetsHex[2], '1f110206');
  const w78 = g.cases.find((c) => c.driver === 'phomemo-m02pro' && c.options.widthBytes === 78 && c.image.height === 300);
  assert.equal(w78.packetsHex[3].slice(0, 16), '1d7630004e00ff00');
  const speed = g.cases.find((c) => c.options.speed === 3);
  assert.deepEqual(speed.packetsHex.slice(2, 4), ['1f110209', '1b4e0d03']);
  const cut = g.cases.find((c) => c.driver === 'escpos-58' && c.options.cut === true && c.image.height === 300);
  assert.equal(cut.packetsHex[0], '1b40');
  assert.equal(cut.packetsHex[cut.packetsHex.length - 1], '1b64041d564200');
  assert.equal(cut.packetsHex.length, 1 + 13 + 1, 'ESC @, 12 bande da 24 righe + una da 12, avanzamento e taglio');
});

test('golden: web/tests/fixtures/drivers-golden.json coincide con i driver (se manca lo crea)', (t) => {
  const golden = generate();
  const text = serialize(golden);
  if (!existsSync(FIXTURE)) {
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, text, 'utf8');
    t.diagnostic(`creato ${FIXTURE}: va committato`);
  }
  const committed = readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n');
  if (committed !== text) {
    writeFileSync(FIXTURE, text, 'utf8');
    assert.fail(`${FIXTURE} era diverso dai byte dei driver ed è stato rigenerato: controlla il diff ` +
      '(cambia anche il lato Kotlin?) e committalo. Si rigenera solo da qui, mai a mano.');
  }
  // Il file si rilegge e ogni caso ridà i byte dei driver, pacchetto per pacchetto.
  const parsed = JSON.parse(committed);
  assert.equal(parsed.cases.length, CASES.length);
  for (const c of parsed.cases) {
    const live = driverById(c.driver).encode(patternImage(c.image.pattern, c.image.width, c.image.height), c.options).map(toHex);
    assert.deepEqual(c.packetsHex, live, `${c.driver} ${c.image.pattern} ${c.image.width}x${c.image.height}`);
  }
});
