// Controluce: porting di BacklightTest.kt.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GrayImage } from '../src/core/gray.js';
import { backlightScore } from '../src/core/backlight.js';

/** Scena con un soggetto ovale al centro (semiassi rx x larghezza e ry x altezza) e uno sfondo. */
function scene(w, h, { rx = 0.3, ry = 0.35, subject, background }) {
  const img = new GrayImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2.0) / (rx * w);
      const dy = (y + 0.5 - h / 2.0) / (ry * h);
      img.set(x, y, dx * dx + dy * dy <= 1.0 ? subject(x, y) : background(x, y));
    }
  }
  return img;
}

const flat = (w, h, v) => new GrayImage(w, h, new Uint8Array(w * h).fill(v));

test('soggetto scuro su bianco = controluce forte (darkSubjectOnWhiteBackgroundIsStrongBacklight)', () => {
  const img = scene(120, 160, {
    subject: (x, y) => 40 + ((x * 7 + y * 13) % 30),
    background: (x, y) => 225 + ((x * 5 + y * 3) % 25),
  });
  const score = backlightScore(img);
  assert.ok(score >= 0.9, `controluce netto: ${score}`);
});

test('l\'esempio documentato vale 1 (documentedExampleScoresFull)', () => {
  const img = scene(240, 320, { rx: 0.43, ry: 0.43, subject: () => 89, background: () => 201 });
  assert.ok(Math.abs(backlightScore(img) - 1) <= 1e-6);
});

test('le scene uniformi non sono in controluce (uniformScenesAreNotBacklit)', () => {
  for (const v of [0, 30, 128, 230, 255]) assert.equal(backlightScore(flat(240, 320, v)), 0, `grigio ${v}`);
});

test('soggetto chiaro su scuro non è controluce (brightSubjectOnDarkBackgroundIsNotBacklit)', () => {
  const img = scene(240, 320, { subject: () => 220, background: (x, y) => 20 + ((x + y) % 30) });
  assert.equal(backlightScore(img), 0);
});

test('scena scura con bordo poco più chiaro (darkSceneWithSlightlyBrighterBorderIsNotBacklit)', () => {
  const img = scene(240, 320, { rx: 0.43, ry: 0.43, subject: () => 40, background: () => 100 });
  assert.ok(backlightScore(img) < 0.1);
});

test('il punteggio cresce con il soggetto più scuro (scoreGrowsAsTheSubjectGetsDarker)', () => {
  let previous = -1;
  for (const subject of [220, 180, 150, 120, 90, 60]) {
    const img = scene(240, 320, { rx: 0.43, ry: 0.43, subject: () => subject, background: () => 230 });
    const score = backlightScore(img);
    assert.ok(score >= previous, `soggetto ${subject}: ${score} < ${previous}`);
    previous = score;
  }
  assert.ok(Math.abs(previous - 1) <= 1e-6);
});

test('il cielo bianco conta anche con il prato scuro (whiteSkyCountsEvenWithDarkGround)', () => {
  const skyWhite = scene(240, 320, { rx: 0.43, ry: 0.43, subject: () => 50, background: (_, y) => (y < 160 ? 250 : 90) });
  const skyGray = scene(240, 320, { rx: 0.43, ry: 0.43, subject: () => 50, background: (_, y) => (y < 160 ? 215 : 90) });
  assert.ok(backlightScore(skyWhite) >= 0.9, `cielo bianco: ${backlightScore(skyWhite)}`);
  assert.ok(backlightScore(skyGray) < 0.2, `cielo grigio: ${backlightScore(skyGray)}`);
});

test('le immagini minuscole non falliscono (tinyImagesNeverFail)', () => {
  assert.equal(backlightScore(flat(1, 1, 0)), 0);
  for (const [w, h] of [[1, 7], [7, 1], [2, 2], [1, 300], [300, 1], [3, 3]]) {
    const img = new GrayImage(w, h, Uint8Array.from({ length: w * h }, (_, i) => (i % 3 === 0 ? 255 : 10)));
    const score = backlightScore(img);
    assert.ok(score >= 0 && score <= 1, `${w}x${h}: ${score}`);
  }
});

test('il punteggio è sempre in 0..1 ed è un float32 (scoreIsAlwaysInRange)', () => {
  // stesso generatore congruenziale a 64 bit del test Kotlin
  let seed = 12345n;
  for (let n = 0; n < 20; n++) {
    const w = 8 + n * 13;
    const h = 5 + n * 17;
    const px = new Uint8Array(w * h);
    for (let i = 0; i < px.length; i++) {
      seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
      px[i] = Number(seed >> 56n);
    }
    const score = backlightScore(new GrayImage(w, h, px));
    assert.ok(score >= 0 && score <= 1, `${w}x${h}: ${score}`);
    assert.equal(score, Math.fround(score));
  }
});
