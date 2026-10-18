// CLAHE: porting di ClaheTest.kt.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GrayImage } from '../src/core/gray.js';
import { claheApply } from '../src/core/clahe.js';
import { applyTone } from '../src/core/tone.js';
import { defaultTone } from '../src/core/model.js';

function image(w, h, value) {
  const img = new GrayImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(x, y, value(x, y));
  return img;
}

/** Trama deterministica che copre [span] livelli diversi. */
const texture = (x, y, span) => (x * 7 + y * 13) % span;

/** Metà sinistra scura (20..59), metà destra chiara (190..229), stessa trama. */
const twoZones = (w, h) => image(w, h, (x, y) => (x < w / 2 ? 20 : 190) + texture(x, y, 40));

/** Deviazione standard media dei blocchi 8x8: contrasto locale. */
function localStd(img, x0, x1, y0, y1) {
  let total = 0;
  let blocks = 0;
  for (let by = y0; by < y1; by += 8) {
    for (let bx = x0; bx < x1; bx += 8) {
      let sum = 0;
      let sum2 = 0;
      for (let y = by; y < by + 8; y++) {
        for (let x = bx; x < bx + 8; x++) {
          const v = img.get(x, y);
          sum += v;
          sum2 += v * v;
        }
      }
      const mean = sum / 64;
      total += Math.sqrt(sum2 / 64 - mean * mean);
      blocks++;
    }
  }
  return total / blocks;
}

function mean(img, x0, x1, y0, y1) {
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += img.get(x, y);
  return sum / ((x1 - x0) * (y1 - y0));
}

/** Salto massimo tra pixel vicini, in orizzontale e in verticale. */
function maxJump(img) {
  let jump = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x > 0) jump = Math.max(jump, Math.abs(img.get(x, y) - img.get(x - 1, y)));
      if (y > 0) jump = Math.max(jump, Math.abs(img.get(x, y) - img.get(x, y - 1)));
    }
  }
  return jump;
}

test('forza nulla = identità in una nuova immagine (zeroStrengthIsIdentityAndReturnsNewImage)', () => {
  const src = image(64, 48, (x, y) => (x * 31 + y * 17) % 256);
  for (const strength of [0, -1, NaN]) {
    const out = claheApply(src, strength);
    assert.notEqual(out, src);
    assert.notEqual(out.pixels, src.pixels);
    assert.deepEqual(out.pixels, src.pixels, `forza ${strength}`);
  }
});

test('non modifica l\'ingresso (doesNotModifyInput)', () => {
  const src = twoZones(96, 64);
  const before = src.pixels.slice();
  claheApply(src, 1);
  assert.deepEqual(src.pixels, before);
});

test('la metà scura guadagna contrasto locale (darkHalfGainsLocalContrast)', () => {
  const src = twoZones(128, 128);
  const before = localStd(src, 8, 56, 8, 120);
  const full = claheApply(src, 1);
  const mild = claheApply(src, 0.35);
  const afterFull = localStd(full, 8, 56, 8, 120);
  const afterMild = localStd(mild, 8, 56, 8, 120);
  assert.ok(afterFull > before * 2.5, `forza 1: ${before} -> ${afterFull}`);
  assert.ok(afterMild > before * 1.5, `forza 0.35: ${before} -> ${afterMild}`);
  assert.ok(afterMild < afterFull);
  assert.ok(mean(full, 8, 56, 8, 120) > mean(src, 8, 56, 8, 120) + 20);
});

test('nessuno scalino tra le tessere (noSeamsBetweenTilesOnGradients)', () => {
  const w = 384;
  const h = 384;
  const gradients = {
    orizzontale: GrayImage.gradient(w, h),
    verticale: image(w, h, (_, y) => Math.trunc((y * 255) / (h - 1))),
    diagonale: image(w, h, (x, y) => Math.trunc(((x + y) * 255) / (w + h - 2))),
    'anteprima 240x320': GrayImage.gradient(240, 320),
  };
  for (const [name, src] of Object.entries(gradients)) {
    const jump = maxJump(claheApply(src, 1));
    assert.ok(jump <= 8, `gradiente ${name}: salto di ${jump} livelli`);
  }
});

test('la forza miscela linearmente con l\'originale (strengthBlendsLinearlyWithOriginal)', () => {
  const src = twoZones(96, 96);
  const full = claheApply(src, 1);
  const half = claheApply(src, 0.5);
  for (let i = 0; i < src.pixels.length; i++) {
    const s = src.pixels[i];
    const f = full.pixels[i];
    const m = half.pixels[i];
    assert.ok(Math.abs(m - (s + f) / 2.0) <= 1.0, `pixel ${i}: ${s}, ${m}, ${f}`);
  }
});

test('le immagini piatte restano piatte (flatImagesStayFlat)', () => {
  for (const v of [0, 1, 128, 254, 255]) {
    const out = claheApply(new GrayImage(40, 40, new Uint8Array(1600).fill(v)), 1);
    const first = out.get(0, 0);
    assert.ok(Math.abs(first - v) <= 1, `grigio ${v} -> ${first}`);
    for (const p of out.pixels) assert.equal(p, first, `grigio ${v} uniforme`);
  }
});

test('immagini minuscole e sottili (tinyAndThinImagesWork)', () => {
  const sizes = [[1, 1], [1, 7], [7, 1], [2, 2], [1, 300], [300, 1], [15, 15], [17, 16], [3, 1000]];
  for (const [w, h] of sizes) {
    const src = new GrayImage(w, h, Uint8Array.from({ length: w * h }, (_, i) => (i * 53) % 256));
    const out = claheApply(src, 1);
    assert.equal(out.width, w);
    assert.equal(out.height, h);
  }
});

test('parametri strani riportati nel range (oddParametersAreSanitized)', () => {
  const src = twoZones(64, 64);
  for (const tiles of [0, -3, 1, 1000, NaN, Infinity]) claheApply(src, 1, tiles);
  for (const clip of [0, -2, NaN, 1, 1000, Infinity]) claheApply(src, 1, 8, clip);
  assert.deepEqual(claheApply(src, 7).pixels, claheApply(src, 1).pixels);
  // NaN vale come il default 2.5
  assert.deepEqual(claheApply(src, 1, 8, NaN).pixels, claheApply(src, 1).pixels);
  // null vale come il default, come nel resto del core (8 tessere, taglio 2.5)
  assert.deepEqual(claheApply(src, 1, null, null).pixels, claheApply(src, 1).pixels);
  assert.deepEqual(claheApply(src, 1, undefined, undefined).pixels, claheApply(src, 1).pixels);
});

test('la forza è un Float: 0.35 e Math.fround(0.35) danno lo stesso risultato', () => {
  const src = twoZones(64, 64);
  assert.deepEqual(claheApply(src, 0.35).pixels, claheApply(src, Math.fround(0.35)).pixels);
});

test('striscia lunga in tempi brevi (longStripIsFast)', () => {
  const src = image(384, 2000, (x, y) => Math.trunc(Math.trunc((x * 255) / 383) / 2) + texture(x, y, 23) * 4);
  const start = performance.now();
  for (let i = 0; i < 3; i++) claheApply(src, 1);
  assert.equal(applyTone(src, defaultTone()).width, 384);
  // il test Kotlin ha un timeout di 10 s
  assert.ok(performance.now() - start < 10_000);
});
