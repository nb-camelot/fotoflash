// Retinatura: porting di DithererTest.kt (le coperture esatte sono in core-parity.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GrayImage } from '../src/core/gray.js';
import { countBlack } from '../src/core/bitimage.js';
import { dither, BAYER_8 } from '../src/core/dither.js';
import { DitherAlgorithm } from '../src/core/model.js';

const flat = (w, h, v) => new GrayImage(w, h, new Uint8Array(w * h).fill(v));

/** Copertura di neri nelle colonne [x0, x1). */
function blackRatio(img, x0, x1) {
  let n = 0;
  for (let y = 0; y < img.height; y++) for (let x = x0; x < x1; x++) if (img.get(x, y)) n++;
  return n / ((x1 - x0) * img.height);
}

test('Bayer si ripete ogni 8 punti (bayerPatternRepeatsEveryEightDots)', () => {
  const out = dither(flat(32, 32, 100), 'ORDERED_BAYER');
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      assert.equal(out.get(x, y), out.get(x + 8, y));
      assert.equal(out.get(x, y), out.get(x, y + 8));
    }
  }
  assert.equal(BAYER_8.length, 64);
});

test('soglia più alta stampa più scuro (higherThresholdPrintsDarkerWithOrderedDither)', () => {
  const src = flat(64, 64, 128);
  const normal = countBlack(dither(src, 'ORDERED_BAYER'));
  const darker = countBlack(dither(src, 'ORDERED_BAYER', 160));
  assert.ok(darker > normal, `${darker} > ${normal}`);
});

test('la sfumatura scurisce da sinistra a destra (gradientDarkensFromLeftToRightForEveryAlgorithm)', () => {
  const src = GrayImage.gradient(256, 64);
  for (const alg of DitherAlgorithm) {
    const out = dither(src, alg);
    const quarters = [0, 1, 2, 3].map((i) => blackRatio(out, i * 64, i * 64 + 64));
    assert.ok(quarters[0] > 0.75, `${alg} quarto scuro ${quarters[0]}`);
    assert.ok(quarters[3] < 0.25, `${alg} quarto chiaro ${quarters[3]}`);
    for (let i = 1; i < 4; i++) assert.ok(quarters[i] <= quarters[i - 1], `${alg} non monotono: ${quarters}`);
  }
});

test('tiene le dimensioni e non tocca l\'ingresso (keepsSizeAndDoesNotTouchInput)', () => {
  const src = GrayImage.gradient(37, 13);
  const before = src.pixels.slice();
  for (const alg of DitherAlgorithm) {
    const out = dither(src, alg);
    assert.equal(out.width, 37);
    assert.equal(out.height, 13);
    assert.equal(out.bytesPerRow, 5);
  }
  assert.deepEqual(src.pixels, before);
});

test('soglia riportata in 1..255, algoritmo sconosciuto = errore', () => {
  // soglia 0 vale 1: nessun grigio è sotto 1 tranne lo 0
  assert.equal(countBlack(dither(flat(8, 2, 1), 'THRESHOLD', 0)), 0);
  assert.equal(countBlack(dither(flat(8, 2, 0), 'THRESHOLD', 0)), 16);
  // soglia 999 vale 255: il bianco puro resta bianco
  assert.equal(countBlack(dither(flat(8, 2, 255), 'THRESHOLD', 999)), 0);
  assert.equal(countBlack(dither(flat(8, 2, 254), 'THRESHOLD', 999)), 16);
  assert.equal(countBlack(dither(flat(8, 2, 127), 'THRESHOLD', NaN)), 16);
  assert.throws(() => dither(flat(4, 4, 0), 'atkinson'), RangeError);
});

test('i bit di riempimento restano bianchi per ogni algoritmo', () => {
  for (const alg of DitherAlgorithm) {
    const out = dither(flat(10, 6, 0), alg);
    for (let y = 0; y < 6; y++) assert.equal(out.data[y * 2 + 1] & 0x3f, 0, `${alg} riga ${y}`);
  }
});

test('Floyd-Steinberg conserva la media, Atkinson schiarisce i chiari', () => {
  for (const v of [32, 64, 96, 160, 224]) {
    const fs = countBlack(dither(flat(96, 96, v), 'FLOYD_STEINBERG')) / (96 * 96);
    assert.ok(Math.abs(fs - (255 - v) / 255) < 0.03, `FS su ${v}: ${fs}`);
  }
});
