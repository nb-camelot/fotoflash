// BitImage e operazioni a 1 bit: porting di BitImageTest.kt e BitImageOpsTest.kt
// (i byte dell'impacchettamento e la centratura sono anche in core-parity.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BitImage,
  bitImageFromArgb,
  bitImageFromRgba,
  blit,
  centeredOn,
  copyBitImage,
  countBlack,
  fillRect,
  toArgb,
  toRgba,
} from '../src/core/bitimage.js';

const solid = (w, h) => {
  const img = new BitImage(w, h);
  fillRect(img, { left: 0, top: 0, width: w, height: h }, true);
  return img;
};

test('get e set a cavallo dei byte (BitImageTest.packsPixelsMsbFirst)', () => {
  const img = new BitImage(10, 2);
  img.set(9, 0, true);
  assert.ok(img.get(9, 0));
  assert.equal(img.get(1, 0), false);
  img.set(0, 0, true);
  img.set(0, 0, false);
  assert.equal(img.get(0, 0), false);
});

test('dimensioni e bande non valide sono errori', () => {
  assert.throws(() => new BitImage(0, 1), RangeError);
  assert.throws(() => new BitImage(3, -1), RangeError);
  assert.throws(() => new BitImage(8, 2, new Uint8Array(3)), RangeError);
  assert.throws(() => new BitImage(8, 4).rowsSlice(3, 2), RangeError);
  assert.throws(() => new BitImage(8, 4).rowsSlice(0, 0), RangeError);
});

test('blit dentro copia i punti neri (blitInsideCopiesBlackDots)', () => {
  const dst = new BitImage(16, 16);
  blit(dst, solid(4, 4), 2, 3);
  assert.equal(countBlack(dst), 16);
  assert.ok(dst.get(2, 3));
  assert.ok(dst.get(5, 6));
  assert.equal(dst.get(6, 3), false);
  assert.equal(dst.get(2, 7), false);
  assert.equal(dst.get(1, 3), false);
});

test('blit taglia su ogni lato (blitClipsOnEverySide)', () => {
  const src = solid(4, 4);
  const topLeft = new BitImage(8, 8);
  blit(topLeft, src, -2, -2);
  assert.equal(countBlack(topLeft), 4);
  assert.ok(topLeft.get(0, 0));
  assert.ok(topLeft.get(1, 1));
  assert.equal(topLeft.get(2, 2), false);

  const bottomRight = new BitImage(8, 8);
  blit(bottomRight, src, 6, 6);
  assert.equal(countBlack(bottomRight), 4);
  assert.ok(bottomRight.get(7, 7));
  assert.ok(bottomRight.get(6, 6));
  assert.equal(bottomRight.get(5, 5), false);

  const inside = new BitImage(5, 3);
  blit(inside, solid(20, 20), -7, -9);
  assert.equal(countBlack(inside), 15);
});

test('blit tutto fuori non fa nulla (blitFullyOutsideDoesNothing)', () => {
  const dst = new BitImage(8, 8);
  const src = solid(4, 4);
  for (const [l, t] of [[100, 0], [0, 100], [-4, 0], [0, -4], [8, 8]]) blit(dst, src, l, t);
  assert.equal(countBlack(dst), 0);
});

test('blit è un OR, il bianco non cancella (blitIsAnOrAndWhiteNeverErases)', () => {
  const dst = new BitImage(8, 1);
  dst.set(0, 0, true);
  dst.set(5, 0, true);
  const src = new BitImage(8, 1);
  src.set(1, 0, true);
  blit(dst, src, 0, 0);
  assert.ok(dst.get(0, 0));
  assert.ok(dst.get(1, 0));
  assert.ok(dst.get(5, 0));
  assert.equal(countBlack(dst), 3);
});

test('blit non allineato tiene ogni punto (blitWithUnalignedOffsetKeepsEveryDot)', () => {
  const src = new BitImage(13, 5);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 13; x++) src.set(x, y, (x + y) % 2 === 0);
  const dst = new BitImage(24, 8);
  blit(dst, src, 3, 1);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 24; x++) {
      const sx = x - 3;
      const sy = y - 1;
      const expected = sx >= 0 && sx < 13 && sy >= 0 && sy < 5 && (sx + sy) % 2 === 0;
      assert.equal(dst.get(x, y), expected, `punto ${x},${y}`);
    }
  }
});

test('blit non scrive mai nei bit di riempimento', () => {
  const dst = new BitImage(10, 1);
  blit(dst, solid(16, 1), 0, 0);
  assert.deepEqual(Array.from(dst.data), [0xff, 0xc0]);
});

test('centeredOn con la stessa larghezza restituisce la stessa immagine (centeredOnWithTheSameWidthReturnsTheImage)', () => {
  const src = solid(384, 4);
  assert.equal(centeredOn(src, 384), src);
});

test('fillRect taglia e cancella (fillRectClipsAndClears)', () => {
  const img = new BitImage(8, 8);
  fillRect(img, { left: -5, top: -5, width: 10, height: 10 }, true);
  assert.equal(countBlack(img), 25);
  assert.ok(img.get(4, 4));
  assert.equal(img.get(5, 5), false);
  fillRect(img, { left: 2, top: 2, width: 100, height: 100 }, false);
  assert.equal(countBlack(img), 25 - 9);
  fillRect(img, { left: 50, top: 50, width: 4, height: 4 }, true);
  assert.equal(countBlack(img), 16);
});

test('toArgb e toRgba mappano i punti sui colori (toArgbMapsDotsToColors)', () => {
  const img = new BitImage(3, 2);
  img.set(0, 0, true);
  img.set(2, 1, true);
  const white = 0xffffffff | 0;
  const black = 0xff000000 | 0;
  assert.deepEqual(Array.from(toArgb(img)), [black, white, white, white, white, black]);
  const ink = 0xff16130f | 0;
  const paper = 0xfffbf8f1 | 0;
  assert.deepEqual(Array.from(toArgb(img, ink, paper)), [ink, paper, paper, paper, paper, ink]);
  const rgba = toRgba(img, [0x16, 0x13, 0x0f, 255], [0xfb, 0xf8, 0xf1, 255]);
  assert.ok(rgba instanceof Uint8ClampedArray);
  assert.deepEqual(Array.from(rgba.subarray(0, 8)), [0x16, 0x13, 0x0f, 255, 0xfb, 0xf8, 0xf1, 255]);
  assert.deepEqual(Array.from(toRgba(img).subarray(20, 24)), [0, 0, 0, 255]);
});

test('da ARGB/RGBA con luma e alpha (bitImageFromArgbUsesLumaAndAlpha)', () => {
  const argb = [0xff000000, 0x7f000000, 0x80000000, 0xff7f7f7f, 0xff808080, 0xffff0000];
  const expected = [true, false, true, true, false, true];
  const img = bitImageFromArgb(6, 1, argb);
  assert.deepEqual(Array.from({ length: 6 }, (_, x) => img.get(x, 0)), expected);
  assert.equal(bitImageFromArgb(6, 1, argb, 60).get(5, 0), false);

  const rgba = Uint8ClampedArray.from([
    0, 0, 0, 255, 0, 0, 0, 127, 0, 0, 0, 128, 127, 127, 127, 255, 128, 128, 128, 255, 255, 0, 0, 255,
  ]);
  const fromRgba = bitImageFromRgba(6, 1, rgba);
  assert.deepEqual(Array.from({ length: 6 }, (_, x) => fromRgba.get(x, 0)), expected);
  assert.equal(bitImageFromRgba(6, 1, rgba, 60).get(5, 0), false);
  assert.throws(() => bitImageFromRgba(2, 2, new Uint8ClampedArray(8)), RangeError);
});

test('andata e ritorno senza perdite (argbRoundTripIsLossless)', () => {
  const img = new BitImage(19, 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 19; x++) img.set(x, y, (x * 7 + y * 3) % 5 === 0);
  assert.deepEqual(bitImageFromArgb(19, 7, toArgb(img)).data, img.data);
  assert.deepEqual(bitImageFromRgba(19, 7, toRgba(img)).data, img.data);
});

test('copia indipendente e conteggio dei punti (copyIsIndependentAndCountBlackCountsDots)', () => {
  const img = solid(10, 3);
  assert.equal(countBlack(img), 30);
  const copy = copyBitImage(img);
  assert.notEqual(copy.data, img.data);
  copy.set(0, 0, false);
  assert.equal(countBlack(img), 30);
  assert.equal(countBlack(copy), 29);
  assert.equal(countBlack(img.copy()), 30);
});
