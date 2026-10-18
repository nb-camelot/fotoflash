// GrayImage: porting di GrayImageTest.kt (i valori di luma e alpha sono in core-parity.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GrayImage, lumaOf, lumaRgb } from '../src/core/gray.js';

test('di default è tutta bianca (defaultIsAllWhite)', () => {
  const img = new GrayImage(5, 3);
  assert.equal(img.pixels.length, 15);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) assert.equal(img.get(x, y), 255);
});

test('i byte si leggono senza segno (bytesAreReadUnsigned)', () => {
  const img = new GrayImage(2, 1);
  img.set(0, 0, 200);
  img.set(1, 0, 128);
  assert.equal(img.get(0, 0), 200);
  assert.equal(img.get(1, 0), 128);
  assert.equal(img.pixels[0], 200);
});

test('set riporta nel range (setClampsOutOfRange)', () => {
  const img = new GrayImage(2, 1);
  img.set(0, 0, -40);
  img.set(1, 0, 999);
  assert.equal(img.get(0, 0), 0);
  assert.equal(img.get(1, 0), 255);
});

test('la copia è indipendente (copyIsIndependent)', () => {
  const img = new GrayImage(3, 3);
  img.set(1, 1, 10);
  const copy = img.copy();
  assert.notEqual(copy.pixels, img.pixels);
  copy.set(1, 1, 90);
  assert.equal(img.get(1, 1), 10);
  assert.equal(copy.get(1, 1), 90);
});

test('dimensioni e numero di pixel sbagliati sono errori (rejectsWrongPixelCount, rejectsEmptySize)', () => {
  assert.throws(() => new GrayImage(2, 2, new Uint8Array(3)), RangeError);
  assert.throws(() => new GrayImage(0, 4, new Uint8Array(0)), RangeError);
  assert.throws(() => new GrayImage(-1, 4), RangeError);
  assert.throws(() => new GrayImage(2.5, 4), RangeError);
  assert.throws(() => GrayImage.gradient(0, 3), RangeError);
  assert.throws(() => GrayImage.fromRgba(2, 2, new Uint8ClampedArray(15)), RangeError);
  assert.throws(() => GrayImage.fromArgb(2, 2, [0, 0, 0]), RangeError);
});

test('la sfumatura sale da nero a bianco (gradientGoesFromBlackToWhite)', () => {
  const img = GrayImage.gradient(256, 2);
  for (let x = 1; x < 256; x++) assert.ok(img.get(x, 0) >= img.get(x - 1, 0));
  const odd = GrayImage.gradient(7, 1);
  // x * 255 / 6 con la divisione intera
  assert.deepEqual(Array.from(odd.pixels), [0, 42, 85, 127, 170, 212, 255]);
});

test('Uint8Array condiviso, gli altri array copiati con i bit bassi come toByte()', () => {
  const shared = new Uint8Array(4).fill(7);
  const img = new GrayImage(2, 2, shared);
  assert.equal(img.pixels, shared);
  const fromArray = new GrayImage(3, 1, [-1, 256, 300]);
  assert.deepEqual(Array.from(fromArray.pixels), [255, 0, 44]);
});

test('luma Rec.601 intera e arrotondata', () => {
  assert.equal(lumaRgb(255, 255, 255), 255);
  assert.equal(lumaRgb(0, 0, 0), 0);
  assert.equal(lumaOf(0xff7f7f7f), 127);
  assert.equal(lumaOf(0xff808080), 128);
  // l'alpha non conta
  assert.equal(lumaOf(0x00ff0000), 76);
});

test('mean e histogram su un\'immagine qualunque', () => {
  const img = new GrayImage(2, 2, Uint8Array.from([0, 10, 20, 30]));
  assert.equal(img.mean(), 15);
  const hist = img.histogram();
  assert.equal(hist.reduce((a, b) => a + b, 0), 4);
  assert.equal(hist[20], 1);
});
