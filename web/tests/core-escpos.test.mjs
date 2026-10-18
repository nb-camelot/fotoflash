// ESC/POS e lavoro di stampa: i byte dei test Kotlin (EscPosTest, ThermalJobTest) sono in
// core-parity.test.mjs; qui le parti proprie della versione JS (doppia faccia di size, codifiche,
// opzioni parziali).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BitImage } from '../src/core/bitimage.js';
import {
  EscPosBuilder,
  EscPosRaster,
  ThermalJob,
  buildThermalJob,
  concatPackets,
  encodeText,
  rasterBand,
  totalBytes,
} from '../src/core/escpos.js';

const bytes = (u8) => Array.from(u8);

test('size: chiamato è GS !, letto è il numero di byte', () => {
  const b = new EscPosBuilder();
  assert.equal(+b.size, 0);
  b.init().size(2, 2);
  assert.deepEqual(bytes(b.bytes()), [0x1b, 0x40, 0x1d, 0x21, 0x11]);
  assert.equal(b.length, 5);
  assert.equal(+b.size, 5);
  assert.ok(b.size > 4);
  assert.equal(`${b.size}`, '5');
  assert.equal(b.size * 2, 10);
  // la stessa funzione resta valida dopo altre aggiunte
  const size = b.size;
  b.line('ok');
  assert.equal(+size, 8);
});

test('concatenazione come nella pagina di prova (TestPage.kt)', () => {
  const out = new EscPosBuilder()
    .init()
    .heat({ maxDots: 7, heatTime: 60, heatInterval: 2 })
    .align('CENTER')
    .bold(true)
    .size(2, 2)
    .line('FOTOFLASH')
    .size(1, 1)
    .bold(false)
    .align('START')
    .feed(4)
    .bytes();
  assert.deepEqual(bytes(out.subarray(0, 18)), [
    0x1b, 0x40, 0x1b, 0x37, 7, 60, 2, 0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11, 0x46, 0x4f,
  ]);
  assert.deepEqual(bytes(out.subarray(out.length - 3)), [0x1b, 0x64, 4]);
});

test('allineamento sconosciuto = errore', () => {
  assert.throws(() => new EscPosBuilder().align('LEFT'), RangeError);
  assert.throws(() => new EscPosBuilder().align(undefined), RangeError);
});

test('codifiche come Java: Latin-1 e UTF-8 con "?" per i surrogati isolati', () => {
  assert.deepEqual(bytes(encodeText('AÿĀ')), [0x41, 0xff, 0x3f]);
  assert.deepEqual(bytes(encodeText('\u{1F1EE}\u{1F1F9}')), [0x3f, 0x3f]);
  assert.deepEqual(bytes(encodeText('\ud83d')), [0x3f]);
  assert.deepEqual(bytes(encodeText('€', 'utf-8')), [0xe2, 0x82, 0xac]);
  assert.deepEqual(bytes(encodeText('\u{1F44D}', 'UTF-8')), [0xf0, 0x9f, 0x91, 0x8d]);
  assert.deepEqual(bytes(encodeText('a\udc00b', 'UTF-8')), [0x61, 0x3f, 0x62]);
  assert.deepEqual(bytes(encodeText('è', 'latin1')), [0xe8]);
  assert.throws(() => encodeText('x', 'cp437'), RangeError);
});

test('opzioni parziali del lavoro: i campi mancanti valgono come PrintJobOptions()', () => {
  const img = new BitImage(384, 50);
  const full = buildThermalJob(img, { bandHeight: 24, feedLinesAfter: 4, cut: false, heat: null });
  assert.deepEqual(buildThermalJob(img, {}), full);
  assert.deepEqual(buildThermalJob(img), full);
  assert.deepEqual(buildThermalJob(img, { bandHeight: null, heat: undefined }), full);
  // riscaldamento parziale: i campi mancanti valgono come HeatSettings()
  const heated = buildThermalJob(img, { heat: { heatTime: 140 } });
  assert.deepEqual(bytes(heated[0]), [0x1b, 0x40, 0x1b, 0x37, 7, 140, 2]);
});

test('i pacchetti concatenati sono il lavoro intero', () => {
  const img = new BitImage(16, 30);
  img.set(3, 29, true);
  const packets = ThermalJob.build(img, { bandHeight: 8, cut: true });
  const all = concatPackets(packets);
  assert.equal(all.length, ThermalJob.totalBytes(packets));
  assert.equal(totalBytes(packets), 2 + 4 * 8 + 30 * 2 + 3 + 4);
  assert.deepEqual(bytes(all.subarray(all.length - 7)), [0x1b, 0x64, 4, 0x1d, 0x56, 66, 0]);
  assert.equal(EscPosRaster.HEADER_SIZE, 8);
  assert.deepEqual(EscPosRaster.band(img, 24, 6), rasterBand(img, 24, 6));
});
