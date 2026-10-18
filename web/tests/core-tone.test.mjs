// Tone: porting di ToneTest.kt (i valori esatti delle curve sono in core-parity.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GrayImage } from '../src/core/gray.js';
import { applyTone, shadowLift, toneCurve, SHADOWS_MAX_LIFT } from '../src/core/tone.js';
import { defaultTone } from '../src/core/model.js';

const neutral = {
  brightness: 0, contrast: 0, gamma: 1, autoLevels: false, sharpen: 0,
  shadows: 0, localContrast: 0, autoBacklight: false,
};
const values = (img) => Array.from(img.pixels);

test('neutro = identità, in una nuova immagine (neutralIsIdentityAndReturnsNewImage)', () => {
  const src = GrayImage.gradient(256, 2);
  const out = applyTone(src, neutral);
  assert.notEqual(out, src);
  assert.notEqual(out.pixels, src.pixels);
  assert.deepEqual(out.pixels, src.pixels);
});

test('non modifica l\'ingresso (doesNotModifyInput)', () => {
  const src = GrayImage.gradient(64, 16);
  const before = src.pixels.slice();
  applyTone(src, { brightness: 0.7, contrast: 0.9, gamma: 2, autoLevels: true, sharpen: 1 });
  assert.deepEqual(src.pixels, before);
});

test('gli auto-livelli stirano un istogramma stretto (autoLevelsStretchesNarrowHistogram)', () => {
  const w = 141;
  const src = new GrayImage(w, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < w; x++) src.set(x, y, 60 + x);
  const out = values(applyTone(src, { ...neutral, autoLevels: true }));
  assert.equal(Math.min(...out), 0);
  assert.equal(Math.max(...out), 255);
});

test('gli auto-livelli lasciano piatto un grigio piatto (autoLevelsKeepsFlatImageFlat)', () => {
  const out = values(applyTone(new GrayImage(16, 16, new Uint8Array(256).fill(128)), { ...neutral, autoLevels: true }));
  for (const v of out) assert.equal(v, 128);
  const dark = values(applyTone(new GrayImage(16, 16, new Uint8Array(256).fill(10)), { ...neutral, autoLevels: true }));
  for (const v of dark) assert.ok(v >= 0 && v <= 64, `grigio scuro piatto -> ${v}`);
});

test('i default tengono estremi e ordine della sfumatura (defaultsKeepGradientEndsAndOrder)', () => {
  const out = applyTone(GrayImage.gradient(256, 4), defaultTone());
  assert.equal(out.get(0, 0), 0);
  assert.equal(out.get(255, 0), 255);
  for (let y = 0; y < 4; y++) {
    for (let x = 1; x < 256; x++) {
      assert.ok(out.get(x, y) >= out.get(x - 1, y) - 3, `(${x}, ${y}): ${out.get(x - 1, y)} -> ${out.get(x, y)}`);
    }
  }
  let previous = -1;
  for (let block = 0; block < 16; block++) {
    let sum = 0;
    for (let x = block * 16; x < block * 16 + 16; x++) sum += out.get(x, 0);
    assert.ok(sum > previous, `blocco ${block}`);
    previous = sum;
  }
});

test('senza contrasto locale la sfumatura resta monotona (withoutLocalContrastGradientStaysMonotonic)', () => {
  const out = applyTone(GrayImage.gradient(256, 4), { ...defaultTone(), localContrast: 0 });
  assert.equal(out.get(0, 0), 0);
  assert.equal(out.get(255, 0), 255);
  for (let y = 0; y < 4; y++) for (let x = 1; x < 256; x++) assert.ok(out.get(x, y) >= out.get(x - 1, y));
});

test('curva delle ombre monotona con estremi fermi (shadowCurveIsMonotonicAndKeepsEnds)', () => {
  for (let step = 0; step <= 20; step++) {
    // step / 20f in Kotlin: divisione in float32
    const amount = Math.fround(step / 20);
    assert.ok(Math.abs(shadowLift(0, amount)) < 1e-9);
    assert.ok(Math.abs(shadowLift(255, amount) - 255) < 1e-9);
    let previous = -1;
    for (let i = 0; i <= 1020; i++) {
      const v = shadowLift(i / 4.0, amount);
      assert.ok(v > previous, `ombre ${amount}, livello ${i / 4}: ${v} < ${previous}`);
      previous = v;
    }
  }
  const dark = shadowLift(64, 1) - 64;
  const light = shadowLift(192, 1) - 192;
  assert.ok(Math.abs(dark - 255 * SHADOWS_MAX_LIFT) <= 0.5);
  assert.ok(light < dark / 8, `a 192: +${light}`);
});

/** Soggetto ovale scuro e testurizzato al centro, sfondo quasi bianco: il controluce tipico. */
function backlitScene(w, h, subject, background) {
  const img = new GrayImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2.0) / (0.3 * w);
      const dy = (y + 0.5 - h / 2.0) / (0.35 * h);
      img.set(x, y, dx * dx + dy * dy <= 1.0 ? subject + ((x * 7 + y * 13) % 30) : background + ((x * 5 + y * 3) % 25));
    }
  }
  return img;
}

function mean(img, x0, x1, y0, y1) {
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += img.get(x, y);
  return sum / ((x1 - x0) * (y1 - y0));
}

test('il controluce automatico apre il soggetto (autoBacklightOpensTheSubject)', () => {
  const src = backlitScene(120, 160, 40, 225);
  const on = applyTone(src, defaultTone());
  const off = applyTone(src, { ...defaultTone(), autoBacklight: false });
  const faceOn = mean(on, 45, 75, 50, 110);
  const faceOff = mean(off, 45, 75, 50, 110);
  assert.ok(faceOn > faceOff + 30, `viso: ${faceOff} senza, ${faceOn} con`);
  assert.ok(faceOn > mean(src, 45, 75, 50, 110), `viso leggibile: ${faceOn}`);
  assert.ok(mean(on, 0, 10, 0, 160) > 200);
});

test('senza controluce il controluce automatico non cambia nulla (autoBacklightChangesNothingWithoutBacklight)', () => {
  const src = new GrayImage(120, 160);
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 120; x++) {
      const dx = (x + 0.5 - 60.0) / 36.0;
      const dy = (y + 0.5 - 80.0) / 56.0;
      src.set(x, y, dx * dx + dy * dy <= 1.0 ? 200 + ((x * 7 + y * 13) % 40) : 20 + ((x * 5 + y * 3) % 30));
    }
  }
  assert.deepEqual(applyTone(src, { ...defaultTone(), autoBacklight: false }).pixels, applyTone(src, defaultTone()).pixels);
});

test('le immagini minuscole funzionano (tinyImagesWork)', () => {
  const sizes = [[1, 1], [1, 7], [7, 1], [2, 2], [1, 300], [300, 1], [3, 17]];
  const strong = { ...defaultTone(), shadows: 1, localContrast: 1, sharpen: 1 };
  for (const [w, h] of sizes) {
    const src = new GrayImage(w, h, Uint8Array.from({ length: w * h }, (_, i) => (i * 53) % 256));
    for (const adj of [defaultTone(), strong, neutral]) {
      const out = applyTone(src, adj);
      assert.equal(out.width, w);
      assert.equal(out.height, h);
    }
  }
});

test('la LUT è di 256 valori 0..255 e i campi mancanti valgono come i default', () => {
  const src = GrayImage.gradient(64, 4);
  const lut = toneCurve(src, {});
  assert.equal(lut.length, 256);
  for (const v of lut) assert.ok(v >= 0 && v <= 255);
  assert.deepEqual(lut, toneCurve(src, defaultTone()));
  assert.deepEqual(applyTone(src, undefined).pixels, applyTone(src, defaultTone()).pixels);
});
