// Parità con :core-thermal: i VALORI ESATTI dei test Kotlin (core-thermal/src/test/kotlin/...).
// Se un valore non coincide, è il porting a essere sbagliato: non si cambia il valore atteso.
// Ogni test riporta tra parentesi la classe e il metodo Kotlin da cui viene.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GrayImage } from '../src/core/gray.js';
import { BitImage, blit, centeredOn, countBlack, fillRect } from '../src/core/bitimage.js';
import { applyTone, levels, MIN_LEVELS_RANGE } from '../src/core/tone.js';
import { dither } from '../src/core/dither.js';
import {
  EscPosBuilder,
  EscPosStatus,
  HEADER_SIZE,
  buildThermalJob,
  concatPackets,
  rasterBand,
  resync,
  resyncFor,
  totalBytes,
} from '../src/core/escpos.js';
import { BRAND_TEXT, layoutTemplate, photoCount, printNumberText } from '../src/core/template.js';
import { normalizeText } from '../src/core/textmetrics.js';
import { DitherAlgorithm, Rect, defaultTone } from '../src/core/model.js';

// ---------------------------------------------------------------- utilità

const row = (...values) => new GrayImage(values.length, 1, Uint8Array.from(values));
const values = (img) => Array.from(img.pixels);
const applied = (adj, ...input) => values(applyTone(row(...input), adj));
const flat = (w, h, v) => new GrayImage(w, h, new Uint8Array(w * h).fill(v));
const ratio = (img) => countBlack(img) / (img.width * img.height);
const bytes = (u8) => Array.from(u8);
const header = (packet) => bytes(packet.subarray(0, HEADER_SIZE));

/** Nessuna regolazione: la curva deve essere l'identità. */
const neutral = {
  brightness: 0, contrast: 0, gamma: 1, autoLevels: false, sharpen: 0,
  shadows: 0, localContrast: 0, autoBacklight: false,
};
/** I default di prima delle ombre e del contrasto locale. */
const legacy = { ...defaultTone(), shadows: 0, localContrast: 0, autoBacklight: false };

// ---------------------------------------------------------------- GrayImage

test('GrayImage: luma Rec.601 intera (GrayImageTest.fromArgbUsesRec601Luma)', () => {
  const argb = [0xffff0000, 0xff00ff00, 0xff0000ff, 0xffffffff, 0xff000000, 0xff808080];
  assert.deepEqual(values(GrayImage.fromArgb(6, 1, argb)), [76, 150, 29, 255, 0, 128]);
  // stessi pixel in RGBA, come arrivano da un canvas
  const rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255];
  assert.deepEqual(values(GrayImage.fromRgba(6, 1, Uint8ClampedArray.from(rgba))), [76, 150, 29, 255, 0, 128]);
});

test('GrayImage: alpha composta su bianco (GrayImageTest.fromArgbCompositesAlphaOnWhite)', () => {
  assert.deepEqual(values(GrayImage.fromArgb(3, 1, [0x00000000, 0x80000000, 0x00ff0000])), [255, 127, 255]);
  const rgba = Uint8ClampedArray.from([0, 0, 0, 0, 0, 0, 0, 128, 255, 0, 0, 0]);
  assert.deepEqual(values(GrayImage.fromRgba(3, 1, rgba)), [255, 127, 255]);
});

test('GrayImage: sfumatura, istogramma e media (GrayImageTest)', () => {
  const g = GrayImage.gradient(256, 2);
  assert.equal(g.get(0, 0), 0);
  assert.equal(g.get(255, 1), 255);
  assert.equal(g.get(128, 0), 128);
  assert.equal(GrayImage.gradient(1, 1).get(0, 0), 0);
  const img = new GrayImage(4, 1, Uint8Array.from([0, 0, 255, 255]));
  const hist = img.histogram();
  assert.equal(hist[0], 2);
  assert.equal(hist[255], 2);
  assert.equal(img.mean(), 127.5);
  const white = new Int32Array(256);
  white[255] = 6;
  assert.deepEqual(new GrayImage(3, 2).histogram(), white);
});

// ---------------------------------------------------------------- BitImage

test('BitImage: righe MSB-first (BitImageTest.packsPixelsMsbFirst, slicesBands)', () => {
  const img = new BitImage(10, 2);
  assert.equal(img.bytesPerRow, 2);
  img.set(0, 0, true);
  img.set(9, 0, true);
  img.set(8, 1, true);
  assert.deepEqual(bytes(img.data), [0x80, 0x40, 0x00, 0x80]);
  const b = new BitImage(8, 3);
  b.set(0, 2, true);
  assert.deepEqual(bytes(b.rowsSlice(2, 1)), [0x80]);
});

test('BitImage: centratura e ritaglio 58/80 mm (BitImageOpsTest.centeredOn*)', () => {
  const narrow = new BitImage(384, 3);
  narrow.set(0, 0, true);
  narrow.set(383, 2, true);
  const wide = centeredOn(narrow, 576);
  assert.equal(wide.width, 576);
  assert.equal(countBlack(wide), 2);
  assert.ok(wide.get(96, 0));
  assert.ok(wide.get(96 + 383, 2));

  const src = new BitImage(576, 2);
  for (const [x, y] of [[0, 0], [95, 0], [96, 0], [96 + 383, 1], [575, 1]]) src.set(x, y, true);
  const out = centeredOn(src, 384);
  assert.equal(countBlack(out), 2);
  assert.ok(out.get(0, 0));
  assert.ok(out.get(383, 1));

  // spostamento dispari e negativo: la divisione intera di Kotlin tronca verso lo zero (-193/2 = -96)
  const odd = new BitImage(577, 1);
  odd.set(96, 0, true);
  odd.set(95, 0, true);
  const cropped = centeredOn(odd, 384);
  assert.ok(cropped.get(0, 0));
  assert.equal(countBlack(cropped), 1);
});

test('BitImage: fillRect e blit contano i punti giusti (BitImageOpsTest)', () => {
  const img = new BitImage(8, 8);
  fillRect(img, { left: -5, top: -5, width: 10, height: 10 }, true);
  assert.equal(countBlack(img), 25);
  fillRect(img, { left: 2, top: 2, width: 100, height: 100 }, false);
  assert.equal(countBlack(img), 16);
  const solid = new BitImage(20, 20);
  fillRect(solid, { left: 0, top: 0, width: 20, height: 20 }, true);
  const inside = new BitImage(5, 3);
  blit(inside, solid, -7, -9);
  assert.equal(countBlack(inside), 15);
});

// ---------------------------------------------------------------- Tone

test('Tone: luminosità +-100 livelli (ToneTest.brightnessShiftsByHundredLevelsAndClamps)', () => {
  assert.deepEqual(applied({ ...neutral, brightness: 0.5 }, 0, 100, 200), [50, 150, 250]);
  assert.deepEqual(applied({ ...neutral, brightness: -1 }, 50, 100, 255), [0, 0, 155]);
  assert.deepEqual(applied({ ...neutral, brightness: 5 }, 0, 100), [100, 200]);
});

test('Tone: contrasto attorno al grigio medio (ToneTest.contrastScalesAroundMidGray)', () => {
  assert.deepEqual(applied({ ...neutral, contrast: 1 }, 100, 128, 156), [58, 128, 198]);
  assert.deepEqual(applied({ ...neutral, contrast: -1 }, 0, 28, 128, 228, 255), [64, 78, 128, 178, 192]);
});

test('Tone: gamma (ToneTest.gammaAboveOneBrightensMidtonesAndKeepsEnds)', () => {
  assert.deepEqual(applied({ ...neutral, gamma: 2 }, 0, 64, 128, 255), [0, 128, 181, 255]);
  assert.deepEqual(applied({ ...neutral, gamma: 0.5 }, 0, 128, 255), [0, 64, 255]);
});

test('Tone: NaN torna al neutro (ToneTest.nanAdjustmentsFallBackToNeutral)', () => {
  const adj = {
    brightness: NaN, contrast: NaN, gamma: NaN, autoLevels: false, sharpen: NaN,
    shadows: NaN, localContrast: NaN, autoBacklight: false,
  };
  assert.deepEqual(applied(adj, 0, 128, 255), [0, 128, 255]);
});

test('Tone: livelli sempre validi (ToneTest.levelsAreAlwaysAValidRange)', () => {
  const hist = new Int32Array(256);
  hist[250] = 100;
  const [lo, hi] = levels(hist, 100);
  assert.ok(hi > lo);
  assert.equal(hi, 255);
  assert.equal(lo, 255 - MIN_LEVELS_RANGE);
});

test('Tone: nitidezza 81/168 e 90/159 (ToneTest.sharpenBoostsEdgesAndLeavesFlatAreas)', () => {
  const src = new GrayImage(8, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 8; x++) src.set(x, y, x < 4 ? 100 : 150);
  const out = applyTone(src, { ...neutral, sharpen: 1 });
  assert.deepEqual(Array.from({ length: 8 }, (_, x) => out.get(x, 1)), [100, 100, 100, 81, 168, 150, 150, 150]);
  const soft = applyTone(src, { ...neutral, sharpen: 0.5 });
  assert.deepEqual(Array.from({ length: 8 }, (_, x) => soft.get(x, 1)), [100, 100, 100, 90, 159, 150, 150, 150]);
});

test('Tone: grigio medio 147 con i default, 146 senza i nuovi passi (ToneTest.defaultsBrightenMidtonesForThermalPaper)', () => {
  assert.equal(applyTone(flat(8, 8, 128), defaultTone()).get(3, 3), 147);
  assert.equal(applyTone(flat(8, 8, 128), legacy).get(3, 3), 146);
  // i campi mancanti valgono come i default di Kotlin
  assert.equal(applyTone(flat(8, 8, 128), {}).get(3, 3), 147);
});

test('Tone: pipeline precedente invariata (ToneTest.newStepsOffKeepPreviousResult)', () => {
  const w = 12;
  const h = 4;
  const src = new GrayImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src.set(x, y, (x * 37 + y * 91 + ((x * y) % 7) * 11) % 256);
  const expected = [
    0, 3, 63, 124, 192, 243, 255, 0, 9, 68, 128, 206,
    102, 186, 255, 255, 0, 50, 138, 88, 189, 255, 255, 0,
    255, 255, 0, 108, 70, 186, 255, 255, 255, 0, 111, 83,
    0, 90, 212, 181, 255, 255, 0, 0, 94, 216, 186, 255,
  ];
  assert.deepEqual(values(applyTone(src, legacy)), expected);
});

test('Tone: curva delle ombre (ToneTest.shadowsLiftOnlyDarkTones)', () => {
  assert.deepEqual(applied({ ...neutral, shadows: 1 }, 0, 16, 32, 64, 128, 192, 255), [0, 53, 93, 140, 173, 200, 255]);
  assert.deepEqual(applied({ ...neutral, shadows: 0.25 }, 0, 16, 32, 64, 128, 192, 255), [0, 25, 47, 83, 139, 194, 255]);
});

// Vettori ricavati a mano dalla semantica di Kotlin (Float allargato a Double, operazioni in float32):
// un porting che lavora in double sui campi Float dà il valore tra parentesi, e il test fallisce.
test('Tone: contrasto 0.15f (non 0.15) decide i pareggi', () => {
  // 0.15f = 0.15000000596046448 -> fattore 1.2250000089406967
  // 108: -20 * f + 128 = 103.49999982 -> 103 (in double 103.5 -> 104); 28: 5.4999991 -> 5 (6)
  assert.deepEqual(applied({ ...neutral, contrast: 0.15 }, 108, 148, 28, 228), [103, 153, 5, 251]);
});

test('Tone: luminosità 0.005f (non 0.005) decide i pareggi', () => {
  // 0.005f * 100 = 0.4999999888 -> 100 resta 100 (in double 100.5 -> 101)
  assert.deepEqual(applied({ ...neutral, brightness: 0.005 }, 100, 0, 254), [100, 0, 254]);
});

test('Tone: nitidezza in float32, il prodotto si arrotonda a pari', () => {
  // amount = 0.1f * 1.5f = 0.15000000596046448f; al centro c = 100, sfocato = 110:
  // amount * -10 = -(1.5 + 2^-24) -> in float32 il pareggio va a -1.5 -> 98.5 -> 99 (in double 98.4999999 -> 98)
  assert.deepEqual(applied({ ...neutral, sharpen: 0.1 }, 120, 100, 120), [121, 99, 121]);
});

// ---------------------------------------------------------------- Ditherer

test('Dither: bianco resta bianco e nero resta nero (DithererTest.whiteStays…, blackStays…)', () => {
  for (const alg of DitherAlgorithm) {
    assert.equal(countBlack(dither(flat(64, 32, 255), alg)), 0, `bianco con ${alg}`);
    assert.equal(countBlack(dither(flat(64, 32, 0), alg)), 64 * 32, `nero con ${alg}`);
  }
});

test('Dither: coperture sul grigio medio (DithererTest.*MidGray*)', () => {
  const fs = ratio(dither(flat(64, 64, 128), 'FLOYD_STEINBERG'));
  assert.ok(fs >= 0.4 && fs <= 0.6, `FS ${fs}`);
  const atk = ratio(dither(flat(64, 64, 128), 'ATKINSON'));
  assert.ok(atk >= 0.4 && atk <= 0.6, `Atkinson ${atk}`);
  assert.equal(countBlack(dither(flat(64, 64, 128), 'ORDERED_BAYER')), (64 * 64) / 2);
});

test('Dither: Atkinson più pulito di FS sui chiari (DithererTest.atkinsonKeepsHighlightsCleanerThanFloydSteinberg)', () => {
  const light = flat(128, 128, 200);
  const atkinson = ratio(dither(light, 'ATKINSON'));
  const fs = ratio(dither(light, 'FLOYD_STEINBERG'));
  assert.ok(atkinson < fs, `Atkinson ${atkinson}, FS ${fs}`);
  assert.ok(fs >= 0.18 && fs <= 0.25, `FS su 200: ${fs}`);
});

test('Dither: soglia stretta (DithererTest.thresholdIsStrictlyBelow)', () => {
  assert.equal(countBlack(dither(flat(16, 4, 128), 'THRESHOLD')), 0);
  assert.equal(countBlack(dither(flat(16, 4, 127), 'THRESHOLD')), 64);
  assert.equal(countBlack(dither(flat(16, 4, 128), 'THRESHOLD', 129)), 64);
});

test('Dither: bit di riempimento bianchi (DithererTest.paddingBitsStayWhite)', () => {
  const out = dither(flat(10, 4, 0), 'FLOYD_STEINBERG');
  for (let y = 0; y < 4; y++) {
    assert.equal(out.data[y * 2], 0xff);
    assert.equal(out.data[y * 2 + 1], 0xc0);
  }
});

// ---------------------------------------------------------------- EscPos

test('EscPos: comandi di base (EscPosTest.initAndBasicCommands, alignUsesEscA)', () => {
  assert.deepEqual(bytes(new EscPosBuilder().init().bytes()), [0x1b, 0x40]);
  assert.deepEqual(bytes(new EscPosBuilder().codepage(16).bytes()), [0x1b, 0x74, 16]);
  assert.deepEqual(bytes(new EscPosBuilder().bold(true).bold(false).bytes()), [0x1b, 0x45, 1, 0x1b, 0x45, 0]);
  assert.deepEqual(bytes(new EscPosBuilder().feed(3).bytes()), [0x1b, 0x64, 3]);
  const out = new EscPosBuilder().align('START').align('CENTER').align('END').bytes();
  assert.deepEqual(bytes(out), [0x1b, 0x61, 0, 0x1b, 0x61, 1, 0x1b, 0x61, 2]);
});

test('EscPos: dimensione con GS !, mai ESC ! (EscPosTest.sizeUsesGsExclamationNotEscExclamation)', () => {
  assert.deepEqual(bytes(new EscPosBuilder().size(1, 1).bytes()), [0x1d, 0x21, 0x00]);
  assert.deepEqual(bytes(new EscPosBuilder().size(2, 2).bytes()), [0x1d, 0x21, 0x11]);
  assert.deepEqual(bytes(new EscPosBuilder().size(2, 1).bytes()), [0x1d, 0x21, 0x10]);
  assert.deepEqual(bytes(new EscPosBuilder().size(1, 2).bytes()), [0x1d, 0x21, 0x01]);
  assert.deepEqual(bytes(new EscPosBuilder().size(8, 8).bytes()), [0x1d, 0x21, 0x77]);
  assert.deepEqual(bytes(new EscPosBuilder().size(0, 9).bytes()), [0x1d, 0x21, 0x07]);
});

test('EscPos: taglio, riscaldamento e avanzamento (EscPosTest.cutUsesFunctionB, heatUsesEsc7AndClamps, feedClampsToOneByte)', () => {
  assert.deepEqual(bytes(new EscPosBuilder().cut().bytes()), [0x1d, 0x56, 66, 0]);
  assert.deepEqual(bytes(new EscPosBuilder().cut(true).bytes()), [0x1d, 0x56, 66, 0]);
  assert.deepEqual(bytes(new EscPosBuilder().cut(false).bytes()), [0x1d, 0x56, 65, 0]);
  assert.deepEqual(bytes(new EscPosBuilder().heat({ maxDots: 7, heatTime: 80, heatInterval: 2 }).bytes()), [0x1b, 0x37, 7, 80, 2]);
  assert.deepEqual(bytes(new EscPosBuilder().heat({}).bytes()), [0x1b, 0x37, 7, 80, 2]);
  assert.deepEqual(
    bytes(new EscPosBuilder().heat({ maxDots: -3, heatTime: 300, heatInterval: 1000 }).bytes()),
    [0x1b, 0x37, 0, 255, 255],
  );
  assert.deepEqual(bytes(new EscPosBuilder().feed(1000).bytes()), [0x1b, 0x64, 255]);
  assert.deepEqual(bytes(new EscPosBuilder().feed(-2).bytes()), [0x1b, 0x64, 0]);
});

test('EscPos: testo Latin-1, "?" per i non rappresentabili (EscPosTest.textIsLatin1AndUnmappableBecomesQuestionMark)', () => {
  assert.deepEqual(bytes(new EscPosBuilder().text('Caffè').bytes()), [0x43, 0x61, 0x66, 0x66, 0xe8]);
  assert.deepEqual(bytes(new EscPosBuilder().text('€').bytes()), [0x3f]);
  assert.deepEqual(bytes(new EscPosBuilder().line('A').line().bytes()), [0x41, 0x0a, 0x0a]);
  assert.deepEqual(bytes(new EscPosBuilder().text('è', 'UTF-8').bytes()), [0xc3, 0xa8]);
  // come String.toByteArray di Java: un'emoji (coppia di surrogati) è un solo '?'
  assert.deepEqual(bytes(new EscPosBuilder().text('a\u{1F44D}b').bytes()), [0x61, 0x3f, 0x62]);
});

test('EscPos: byte grezzi a 8 bit e crescita del buffer (EscPosTest.rawTruncatesToEightBitsAndSizeCounts)', () => {
  const b = new EscPosBuilder().raw(0x1b, 0x140, -1);
  assert.deepEqual(bytes(b.bytes()), [0x1b, 0x40, 0xff]);
  assert.equal(+b.size, 3);
  assert.equal(b.length, 3);
  const big = new EscPosBuilder();
  for (let i = 0; i < 1000; i++) big.raw(i);
  assert.equal(big.length, 1000);
  assert.equal(`${big.size}`, '1000');
  const out = big.bytes();
  for (let i = 0; i < 1000; i++) assert.equal(out[i], i & 0xff);
});

test('EscPos: intestazione GS v 0 (EscPosTest.bandHeaderHasBytesPerRowAndRows, bandHeaderIsLittleEndian, bandCarriesTheRequestedRows)', () => {
  const img = new BitImage(20, 5);
  img.set(0, 0, true);
  img.set(19, 4, true);
  const band = rasterBand(img, 0, 5);
  assert.equal(band.length, HEADER_SIZE + 3 * 5);
  assert.deepEqual(header(band), [0x1d, 0x76, 0x30, 0x00, 3, 0, 5, 0]);
  assert.equal(band[8], 0x80);
  assert.equal(band[8 + 4 * 3 + 2], 0x10);

  const wide = rasterBand(new BitImage(2056, 300), 0, 300);
  assert.deepEqual(header(wide), [0x1d, 0x76, 0x30, 0x00, 1, 1, 44, 1]);
  assert.equal(wide.length, 8 + 257 * 300);

  const small = new BitImage(8, 4);
  small.set(0, 2, true);
  small.set(7, 3, true);
  assert.deepEqual(bytes(rasterBand(small, 2, 2)), [0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0x80, 0x01]);
  assert.throws(() => rasterBand(new BitImage(8, 4), 3, 2), RangeError);
});

test('EscPos: raster a bande con l\'ultima corta e banda riportata nel range (EscPosTest.raster*)', () => {
  const out = new EscPosBuilder().raster(new BitImage(16, 50), 24).bytes();
  assert.equal(out.length, 3 * 8 + 2 * 50);
  const second = 8 + 2 * 24;
  const third = second + 8 + 2 * 24;
  assert.deepEqual(bytes(out.subarray(0, 8)), [0x1d, 0x76, 0x30, 0x00, 2, 0, 24, 0]);
  assert.deepEqual(bytes(out.subarray(second, second + 8)), [0x1d, 0x76, 0x30, 0x00, 2, 0, 24, 0]);
  assert.deepEqual(bytes(out.subarray(third, third + 8)), [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]);

  const img = new BitImage(8, 300);
  assert.equal(new EscPosBuilder().raster(img, 0).length, 300 * (8 + 1));
  const big = new EscPosBuilder().raster(img, 1000).bytes();
  assert.equal(big.length, 2 * 8 + 300);
  assert.equal(big[6], 255);
  assert.equal(big[8 + 255 + 6], 45);
});

test('EscPos: stato della carta DLE EOT 4 (EscPosTest.paperStatus*)', () => {
  assert.deepEqual(bytes(new EscPosBuilder().paperStatusRequest().bytes()), [0x10, 0x04, 0x04]);
  assert.equal(EscPosStatus.paperEnd(0x12), false);
  assert.equal(EscPosStatus.paperNearEnd(0x12), false);
  assert.equal(EscPosStatus.paperEnd(0x72), true);
  assert.equal(EscPosStatus.paperEnd(0x1e), false);
  assert.equal(EscPosStatus.paperNearEnd(0x1e), true);
  assert.equal(EscPosStatus.paperEnd(0x7e), true);
  assert.equal(EscPosStatus.paperNearEnd(0x7e), true);
  for (const b of [0x00, 0xff, 0x92, -1]) assert.equal(EscPosStatus.paperEnd(b), null);
  assert.equal(EscPosStatus.paperNearEnd(0x13), null);
});

test('EscPos: append e concatenazione (EscPosTest.appendAndChaining)', () => {
  const out = new EscPosBuilder().init().append(Uint8Array.from([1, 2, 3])).align('CENTER').bytes();
  assert.deepEqual(bytes(out), [0x1b, 0x40, 1, 2, 3, 0x1b, 0x61, 1]);
});

// ---------------------------------------------------------------- ThermalJob

test('ThermalJob: ESC @, bande e avanzamento (ThermalJobTest.defaultJobIsInitBandsAndFeed, totalBytesSumsPackets)', () => {
  const packets = buildThermalJob(new BitImage(384, 50), undefined);
  assert.equal(packets.length, 5);
  assert.deepEqual(bytes(packets[0]), [0x1b, 0x40]);
  assert.deepEqual(header(packets[1]), [0x1d, 0x76, 0x30, 0x00, 48, 0, 24, 0]);
  assert.deepEqual(header(packets[2]), [0x1d, 0x76, 0x30, 0x00, 48, 0, 24, 0]);
  assert.deepEqual(header(packets[3]), [0x1d, 0x76, 0x30, 0x00, 48, 0, 2, 0]);
  assert.equal(packets[1].length, 8 + 48 * 24);
  assert.equal(packets[3].length, 8 + 48 * 2);
  assert.deepEqual(bytes(packets[4]), [0x1b, 0x64, 4]);
  assert.equal(totalBytes(packets), 2 + (8 + 48 * 24) * 2 + (8 + 48 * 2) + 3);
  assert.equal(concatPackets(packets).length, totalBytes(packets));
});

test('ThermalJob: ESC 7 nel primo pacchetto, taglio nell\'ultimo (ThermalJobTest.heatGoesInTheFirstPacketAndCutInTheLast)', () => {
  const options = { bandHeight: 24, feedLinesAfter: 6, cut: true, heat: { maxDots: 9, heatTime: 120, heatInterval: 3 } };
  const packets = buildThermalJob(new BitImage(384, 24), options);
  assert.equal(packets.length, 3);
  assert.deepEqual(bytes(packets[0]), [0x1b, 0x40, 0x1b, 0x37, 9, 120, 3]);
  assert.deepEqual(bytes(packets[2]), [0x1b, 0x64, 6, 0x1d, 0x56, 66, 0]);
});

test('ThermalJob: le bande ricompongono l\'immagine (ThermalJobTest.bandsCarryTheWholeImageInOrder)', () => {
  const img = new BitImage(20, 37);
  for (let y = 0; y < 37; y++) for (let x = 0; x < 20; x++) img.set(x, y, (x * 3 + y * 5) % 7 === 0);
  const packets = buildThermalJob(img, { bandHeight: 10 });
  const bands = packets.slice(1, packets.length - 1);
  assert.deepEqual(bands.map((b) => b[6]), [10, 10, 10, 7]);
  assert.deepEqual(concatPackets(bands.map((b) => b.subarray(HEADER_SIZE))), img.data);
});

test('ThermalJob: banda nel range, avanzamento 0 (ThermalJobTest.bandHeightIsClamped, zeroFeedStillClosesTheJob)', () => {
  const img = new BitImage(8, 600);
  assert.equal(buildThermalJob(img, { bandHeight: 0 }).length, 600 + 2);
  const huge = buildThermalJob(img, { bandHeight: 999 });
  assert.equal(huge.length, 3 + 2);
  assert.equal(huge[3][6], 90);
  const packets = buildThermalJob(new BitImage(8, 1), { feedLinesAfter: 0 });
  assert.deepEqual(bytes(packets[packets.length - 1]), [0x1b, 0x64, 0]);
});

test('ThermalJob: risincronizzazione (ThermalJobTest.resync*)', () => {
  const fill = resync(48, 24);
  assert.equal(fill.length, 8 + 48 * 24);
  assert.ok(fill.every((b) => b === 0));
  assert.equal(resync(0, 0).length, 8 + 1 * 1);
  assert.equal(resync(72, 999).length, 8 + 72 * 255);
  assert.equal(resyncFor(buildThermalJob(new BitImage(384, 50))).length, 8 + 48 * 24);
  assert.equal(resyncFor(buildThermalJob(new BitImage(576, 300), { bandHeight: 200 })).length, 8 + 72 * 200);
  assert.equal(resyncFor([new Uint8Array(3), new Uint8Array(5), new Uint8Array(1)]).length, 5);
  assert.equal(resyncFor([]).length, 0);
});

// ---------------------------------------------------------------- TemplateGeometry

const empty = {};
const full = {
  caption: 'Ciao mamma!',
  eventTitle: 'Festa di Leo',
  hashtag: 'festa2026',
  dateText: '17/10/2026 15:42',
  printNumber: 42,
};
const roles = (layout) => layout.texts.map((t) => t.role);

test('Template: altezze con tutti i testi a 384 punti, 464/592/1002/702', () => {
  assert.equal(layoutTemplate('POLAROID', 'MM58', 3, full).height, 464);
  assert.equal(layoutTemplate('FULL', 'MM58', 3, full).height, 592);
  assert.equal(layoutTemplate('STRIP', 'MM58', 3, full).height, 1002);
  assert.equal(layoutTemplate('RECEIPT', 'MM58', 3, full).height, 702);
});

test('Template: Polaroid senza testi (TemplateGeometryTest.polaroidWithoutTextsIsASquareWithEqualMargins)', () => {
  const layout = layoutTemplate('POLAROID', 'MM58', 1, empty);
  assert.deepEqual(layout.photos, [new Rect(16, 16, 352, 352)]);
  assert.equal(layout.height, 384);
  assert.equal(layout.texts.length, 0);
  assert.equal(layout.decorations.length, 0);
});

test('Template: fascia della Polaroid (TemplateGeometryTest.polaroidBandHoldsCaptionAndDate)', () => {
  const layout = layoutTemplate('POLAROID', 'MM58', 3, full);
  assert.deepEqual(layout.photos, [new Rect(16, 16, 352, 352)]);
  const photoBottom = layout.photos[0].bottom;
  assert.ok(layout.height - photoBottom >= 96);
  assert.deepEqual(roles(layout), ['CAPTION', 'DATE']);
  const [caption, date] = layout.texts;
  assert.equal(caption.text, 'Ciao mamma!');
  assert.equal(caption.font, 'MONO_BOLD');
  assert.equal(caption.sizeDots, 28);
  assert.equal(caption.align, 'CENTER');
  assert.equal(date.font, 'MONO');
  assert.equal(date.sizeDots, 20);
  const above = caption.rect.top - photoBottom;
  const below = layout.height - date.rect.bottom;
  assert.ok(Math.abs(above - below) <= 1, `sopra ${above}, sotto ${below}`);
  assert.equal(layout.decorations.length, 0);
});

test('Template: Pieno a filo 3:4 (TemplateGeometryTest.fullIsEdgeToEdgeThreeByFour)', () => {
  const bare = layoutTemplate('FULL', 'MM58', 1, empty);
  assert.deepEqual(bare.photos, [new Rect(0, 0, 384, 512)]);
  assert.equal(bare.height, 512);
  const withTexts = layoutTemplate('FULL', 'MM58', 1, full);
  assert.deepEqual(withTexts.photos, [new Rect(0, 0, 384, 512)]);
  assert.deepEqual(roles(withTexts), ['CAPTION', 'DATE']);
  assert.ok(withTexts.texts[0].rect.top >= 512);
});

test('Template: Striscia 4:3 con stacchi (TemplateGeometryTest.stripStacksFourByThreePhotosWithGaps)', () => {
  const layout = layoutTemplate('STRIP', 'MM58', 3, full);
  assert.equal(layout.photos.length, 3);
  for (const p of layout.photos) {
    assert.equal(p.left, 16);
    assert.equal(p.width, 352);
    assert.equal(p.height, 264);
  }
  for (let i = 1; i < 3; i++) assert.equal(layout.photos[i].top - layout.photos[i - 1].bottom, 12);
  const title = layout.texts[0];
  assert.equal(title.role, 'EVENT_TITLE');
  assert.equal(title.font, 'DISPLAY');
  assert.equal(title.sizeDots, 40);
  assert.ok(title.rect.bottom <= layout.photos[0].top);
  const last = layout.photos[layout.photos.length - 1].bottom;
  assert.deepEqual(layout.texts.filter((t) => t.rect.top >= last).map((t) => t.role), ['CAPTION', 'DATE', 'HASHTAG']);
  assert.equal(layout.texts.find((t) => t.role === 'HASHTAG').text, '#festa2026');
});

test('Template: numero di foto (TemplateGeometryTest.stripPhotoCountIsClamped, singlePhotoTemplatesIgnorePhotoCount)', () => {
  assert.equal(layoutTemplate('STRIP', 'MM58', 0, empty).photos.length, 1);
  assert.equal(layoutTemplate('STRIP', 'MM58', -3, empty).photos.length, 1);
  assert.equal(layoutTemplate('STRIP', 'MM58', 4, empty).photos.length, 4);
  assert.equal(layoutTemplate('STRIP', 'MM58', 9, empty).photos.length, 4);
  assert.equal(photoCount('STRIP', 9), 4);
  assert.equal(photoCount('POLAROID', 3), 1);
  for (const kind of ['POLAROID', 'FULL', 'RECEIPT']) assert.equal(layoutTemplate(kind, 'MM58', 4, full).photos.length, 1);
});

test('Template: Scontrino a sezioni (TemplateGeometryTest.receiptHasSectionsSeparatedByDashedLines)', () => {
  const layout = layoutTemplate('RECEIPT', 'MM58', 1, full);
  assert.deepEqual(layout.photos, [new Rect(16, 146, 352, 352)]);
  assert.deepEqual(roles(layout), ['BRAND', 'EVENT_TITLE', 'CAPTION', 'HASHTAG', 'PRINT_NUMBER', 'DATE', 'FOOTER']);
  const brand = layout.texts.find((t) => t.role === 'BRAND');
  assert.equal(brand.text, BRAND_TEXT);
  assert.equal(brand.font, 'DISPLAY');
  assert.equal(brand.sizeDots, 48);
  assert.equal(layout.texts.find((t) => t.role === 'PRINT_NUMBER').text, 'N. 0042');
  const footer = layout.texts[layout.texts.length - 1];
  assert.equal(footer.role, 'FOOTER');
  assert.equal(footer.text, '');
  const lines = layout.decorations.filter((d) => d.type === 'dashed');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].y < layout.photos[0].top);
  assert.ok(lines[1].y > layout.photos[0].bottom);
  assert.ok(lines[2].y < footer.rect.top);
  assert.equal(layout.height, 702);
});

test('Template: Scontrino senza testi facoltativi (TemplateGeometryTest.receiptWithoutOptionalTextsKeepsBrandAndFooterOnly)', () => {
  const layout = layoutTemplate('RECEIPT', 'MM58', 1, empty);
  assert.deepEqual(roles(layout), ['BRAND', 'FOOTER']);
  assert.equal(layout.decorations.length, 2);
  assert.equal(layout.height, 504);
});

test('Template: 80 mm scala di 1.5 (TemplateGeometryTest.eightyMillimetersScalesByOneAndAHalf)', () => {
  const polaroid = layoutTemplate('POLAROID', 'MM80', 1, empty);
  assert.equal(polaroid.width, 576);
  assert.deepEqual(polaroid.photos, [new Rect(24, 24, 528, 528)]);
  assert.equal(polaroid.height, 576);
  assert.deepEqual(layoutTemplate('FULL', 'MM80', 1, empty).photos, [new Rect(0, 0, 576, 768)]);
  const strip = layoutTemplate('STRIP', 'MM80', 3, full);
  for (const p of strip.photos) {
    assert.equal(p.left, 24);
    assert.equal(p.width, 528);
    assert.equal(p.height, 396);
  }
  for (let i = 1; i < 3; i++) assert.equal(strip.photos[i].top - strip.photos[i - 1].bottom, 18);
  assert.equal(strip.texts.find((t) => t.role === 'EVENT_TITLE').sizeDots, 60);
  const receipt = layoutTemplate('RECEIPT', 'MM80', 1, full);
  assert.equal(receipt.texts.find((t) => t.role === 'BRAND').sizeDots, 72);
  assert.equal(receipt.decorations.find((d) => d.type === 'dashed').thickness, 3);
  for (const kind of ['POLAROID', 'FULL', 'STRIP', 'RECEIPT']) {
    const small = layoutTemplate(kind, 'MM58', 3, full);
    const big = layoutTemplate(kind, 'MM80', 3, full);
    assert.ok(Math.abs(big.height - small.height * 1.5) <= 6, `${kind}: ${big.height} contro ${small.height} x 1.5`);
    assert.deepEqual(roles(big), roles(small));
    assert.equal(big.photos.length, small.photos.length);
  }
});

test('Template: numero progressivo (TemplateGeometryTest.printNumberIsZeroPadded)', () => {
  assert.equal(printNumberText(42), 'N. 0042');
  assert.equal(printNumberText(0), 'N. 0000');
  assert.equal(printNumberText(12345), 'N. 12345');
  assert.equal(printNumberText(-7), 'N. 0000');
});

test('Testi: spazi come le Regex e il trim di Kotlin (normalizeText)', () => {
  assert.equal(normalizeText('  Festa \n\t di   Leo  '), 'Festa di Leo');
  assert.equal(normalizeText(null), '');
  // \s di Java è solo ASCII: gli NBSP interni restano; il trim di Kotlin toglie anche gli NBSP ai bordi
  assert.equal(normalizeText('a  b'), 'a  b');
  assert.equal(normalizeText(' ciao　'), 'ciao');
  // il BOM non è spazio per Kotlin (il trim di JS lo toglierebbe)
  assert.equal(normalizeText('﻿ciao'), '﻿ciao');
});

// ---------------------------------------------------------------- prestazioni

test('Prestazioni: tono + retino su 384x2000 (ClaheTest.longStripIsFast)', (t) => {
  // una foto della Striscia su carta da 58 mm
  const src = new GrayImage(384, 2000);
  for (let y = 0; y < 2000; y++) {
    for (let x = 0; x < 384; x++) src.set(x, y, Math.trunc(Math.trunc((x * 255) / 383) / 2) + ((x * 7 + y * 13) % 23) * 4);
  }
  // riscaldamento del JIT, poi la misura che conta
  dither(applyTone(src, defaultTone()), 'ATKINSON');
  const times = {};
  for (const alg of DitherAlgorithm) {
    const start = performance.now();
    const out = dither(applyTone(src, defaultTone()), alg);
    times[alg] = Math.round(performance.now() - start);
    assert.equal(out.width, 384);
    assert.equal(out.height, 2000);
  }
  t.diagnostic(`tono + retino 384x2000 (ms): ${JSON.stringify(times)}`);
  // limite largo apposta: le macchine della CI sono lente e un test instabile bloccherebbe Pages
  for (const alg of DitherAlgorithm) assert.ok(times[alg] < 1500, `${alg}: ${times[alg]} ms`);
});
