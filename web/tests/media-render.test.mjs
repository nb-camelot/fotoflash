// Test del renderer: funzioni pure (adattamento dei testi, decorazioni, ritagli) e la
// composizione completa su un canvas finto in memoria (Node non ha Canvas 2D).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTemplate } from '../src/core/template.js';
import {
  renderPrint, fitText, wrapOrNull, wrapEllipsized, ellipsize, maxLinesFor, resolveText, formatNumberLabel,
  letterSpacingPx, alignedLeft, dashedRects, frameRects, zigzagRects, decorationRects, graphemes,
  BRAND_TEXT, TEXT_THRESHOLD, MIN_TEXT_SCALE, BRAND_LETTER_SPACING,
} from '../src/render/renderer.js';
import { coverCrop, halvingSteps, scaleRgbaNearest, sourceSize, bitImageToCanvas } from '../src/render/bitmap.js';
import { fontFor, fontUrl, ensureFonts, FONT_METRICS } from '../src/render/fonts.js';
import { BitImage } from '../src/core/bitimage.js';

// ---------------------------------------------------------------- canvas finto

/** Corpo in px dalla stringa CSS font ("700 28px ..."). */
const fontSize = (font) => Number(/([\d.]+)px/.exec(font)[1]);

/** Font monospaziato finto: ogni grafema 0,6 em, maiuscole 0,7 em, interlinea come Space Mono. */
const ADVANCE = 0.6;

class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.font = '10px sans-serif';
    this.letterSpacing = '0px';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = 'low';
    this.texts = canvas.log;
  }

  _fill(x, y, w, h, rgba) {
    const { width, height, pixels } = this.canvas;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(width, Math.round(x + w));
    const y1 = Math.min(height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) pixels.set(rgba, (yy * width + xx) * 4);
    }
  }

  fillRect(x, y, w, h) {
    const v = this.fillStyle.toLowerCase() === '#ffffff' ? 255 : 0;
    this._fill(x, y, w, h, [v, v, v, 255]);
  }

  clearRect(x, y, w, h) {
    this._fill(x, y, w, h, [0, 0, 0, 0]);
  }

  /** La "foto" finta è un grigio uniforme. */
  drawImage(src, ...args) {
    const [dx, dy, dw, dh] = args.length === 8 ? args.slice(4) : [args[0], args[1], src.width, src.height];
    const g = src.fakeGray ?? 128;
    this._fill(dx, dy, dw, dh, [g, g, g, 255]);
    // i passaggi intermedi (dimezzamenti) portano avanti lo stesso grigio
    this.canvas.fakeGray = g;
  }

  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      const from = ((y + yy) * this.canvas.width + x) * 4;
      out.set(this.canvas.pixels.subarray(from, from + w * 4), yy * w * 4);
    }
    return new FakeImageData(out, w, h);
  }

  putImageData(img, x, y) {
    for (let yy = 0; yy < img.height; yy++) {
      this.canvas.pixels.set(img.data.subarray(yy * img.width * 4, (yy + 1) * img.width * 4), ((y + yy) * this.canvas.width + x) * 4);
    }
    this.canvas.puts++;
  }

  measureText(text) {
    const size = fontSize(this.font);
    return {
      width: graphemes(text).length * ADVANCE * size,
      actualBoundingBoxAscent: FONT_METRICS.MONO.capHeight * size,
      fontBoundingBoxAscent: FONT_METRICS.MONO.ascent * size,
      fontBoundingBoxDescent: FONT_METRICS.MONO.descent * size,
    };
  }

  /** Testo finto: un rettangolo nero alto come le maiuscole, largo come la misura. */
  fillText(text, x, y) {
    const size = fontSize(this.font);
    const m = this.measureText(text);
    this.texts.push({ text, x, y, font: this.font, letterSpacing: this.letterSpacing });
    this._fill(x, y - m.actualBoundingBoxAscent, m.width, m.actualBoundingBoxAscent, [0, 0, 0, 255]);
    return size;
  }

  save() {}
  restore() {}
  setTransform() {}
  translate() {}
  scale() {}
}

class FakeCanvas {
  constructor(width, height) {
    this.log = [];
    this.puts = 0;
    this._alloc(width, height);
  }

  _alloc(width, height) {
    this._w = width;
    this._h = height;
    this.pixels = new Uint8ClampedArray(Math.max(0, width * height * 4));
  }

  get width() {
    return this._w;
  }

  set width(v) {
    this._alloc(v, this._h);
  }

  get height() {
    return this._h;
  }

  set height(v) {
    this._alloc(this._w, v);
  }

  getContext() {
    this.ctx ??= new FakeContext(this);
    return this.ctx;
  }
}

const saved = {};
before(() => {
  saved.OffscreenCanvas = globalThis.OffscreenCanvas;
  saved.ImageData = globalThis.ImageData;
  globalThis.OffscreenCanvas = FakeCanvas;
  globalThis.ImageData = FakeImageData;
});
after(() => {
  globalThis.OffscreenCanvas = saved.OffscreenCanvas;
  globalThis.ImageData = saved.ImageData;
});

/** Tutti i canvas creati dal renderer, per guardare i testi disegnati. */
function trackCanvases() {
  const created = [];
  globalThis.OffscreenCanvas = class extends FakeCanvas {
    constructor(w, h) {
      super(w, h);
      created.push(this);
    }
  };
  return created;
}

// ---------------------------------------------------------------- metriche pure

/** Metriche monospaziate finte: 0,6 em a grafema, interlinea di Space Mono. */
const mono = {
  width: (text, size) => graphemes(text).length * ADVANCE * size,
  spacing: (size) => FONT_METRICS.MONO.spacing * size,
};

test('costanti come PrintRenderer.kt', () => {
  assert.equal(BRAND_TEXT, 'FOTOFLASH');
  assert.equal(TEXT_THRESHOLD, 150);
  assert.equal(MIN_TEXT_SCALE, 0.7);
  assert.equal(BRAND_LETTER_SPACING, 0.08);
});

test('maxLinesFor: troncamento, almeno 1, al massimo 4', () => {
  assert.equal(maxLinesFor(41.468, 35), 1);
  assert.equal(maxLinesFor(29.62, 100), 3);
  assert.equal(maxLinesFor(10, 1000), 4);
  assert.equal(maxLinesFor(0, 50), 1);
});

test('fitText: corpo pieno quando ci sta', () => {
  assert.deepEqual(fitText('CIAO', 28, { left: 0, top: 0, width: 344, height: 35 }, mono), { size: 28, lines: ['CIAO'] });
});

test('fitText: riduce di un punto alla volta prima di troncare', () => {
  // 10 grafemi: 168 px a 28, 150 px a 25
  assert.deepEqual(fitText('ABCDEFGHIJ', 28, { left: 0, top: 0, width: 150, height: 35 }, mono), { size: 25, lines: ['ABCDEFGHIJ'] });
});

test('fitText: al 70% tronca con i puntini', () => {
  const fit = fitText('ABCDEFGHIJKLMNOPQRST', 28, { left: 0, top: 0, width: 150, height: 35 }, mono);
  assert.ok(Math.abs(fit.size - 19.6) < 1e-9);
  assert.deepEqual(fit.lines, ['ABCDEFGHIJK…']);
});

test('fitText: va a capo se il riquadro è alto abbastanza', () => {
  const fit = fitText('uno due tre quattro', 20, { left: 0, top: 0, width: 100, height: 100 }, mono);
  assert.deepEqual(fit, { size: 20, lines: ['uno due', 'tre', 'quattro'] });
});

test('fitText: corpo minimo 8 punti', () => {
  const fit = fitText('x', 4, { left: 0, top: 0, width: 100, height: 20 }, mono);
  assert.equal(fit.size, 8);
});

test('wrapOrNull: parola troppo lunga o troppe righe = null', () => {
  const m = (t) => t.length * 10;
  assert.deepEqual(wrapOrNull('ab cd', m, 100, 1), ['ab cd']);
  assert.equal(wrapOrNull('abcdefghijk', m, 100, 3), null);
  assert.equal(wrapOrNull('aaaa bbbb cccc', m, 50, 2), null);
  assert.deepEqual(wrapOrNull('aaaa bbbb cccc', m, 50, 3), ['aaaa', 'bbbb', 'cccc']);
});

test('ellipsize e wrapEllipsized', () => {
  const m = (t) => graphemes(t).length * 10;
  assert.equal(ellipsize('abc', m, 30), 'abc');
  assert.equal(ellipsize('abcdef', m, 40), 'abc…');
  assert.equal(ellipsize('abcdef', m, 5), '');
  assert.equal(ellipsize('🇮🇹🇮🇹🇮🇹', m, 25), '🇮🇹…', 'una bandiera non si spezza');
  assert.deepEqual(wrapEllipsized('aaaa bbbb cccc dddd', m, 50, 2), ['aaaa', 'bbbb…']);
  assert.deepEqual(wrapEllipsized('aaaaaaaaaa bb', m, 50, 3), ['aaaa…']);
  assert.deepEqual(wrapEllipsized('aa bb', m, 50, 1), ['aa bb']);
});

test('letterSpacingPx e alignedLeft', () => {
  assert.equal(letterSpacingPx(0.08, 48), 4);
  assert.equal(letterSpacingPx(0.08, 72), 6);
  assert.equal(letterSpacingPx(0, 48), 0);
  const rect = { left: 16, top: 0, width: 352, height: 40 };
  assert.equal(alignedLeft('CENTER', rect, 100), 16 + 176 - 50);
  assert.equal(alignedLeft('START', rect, 100), 16);
  assert.equal(alignedLeft('END', rect, 100), 268);
});

// ---------------------------------------------------------------- testi fissi

test('formatNumberLabel: come getString con %1$04d', () => {
  assert.equal(formatNumberLabel('RICORDO N. %1$04d', 42), 'RICORDO N. 0042');
  assert.equal(formatNumberLabel('MEMORY NO. %1$04d', 12345), 'MEMORY NO. 12345');
  assert.equal(formatNumberLabel('N. %d', 7), 'N. 7');
  assert.equal(formatNumberLabel('%1$s!', '0042'), '0042!');
});

test('resolveText: marchio, piede e numero dalle etichette', () => {
  const labels = { footer: 'Grazie per il sorriso!', printNumber: (n) => `RICORDO N. ${String(n).padStart(4, '0')}` };
  const texts = { printNumber: 42 };
  assert.equal(resolveText({ role: 'BRAND', text: 'FOTOFLASH' }, texts, labels), 'FOTOFLASH');
  assert.equal(resolveText({ role: 'BRAND', text: '  ' }, texts, {}), 'FOTOFLASH');
  assert.equal(resolveText({ role: 'BRAND', text: 'FOTOFLASH' }, texts, { brand: 'FESTA' }), 'FESTA');
  assert.equal(resolveText({ role: 'FOOTER', text: '' }, texts, labels), 'Grazie per il sorriso!');
  assert.equal(resolveText({ role: 'FOOTER', text: '' }, texts, {}), '');
  assert.equal(resolveText({ role: 'PRINT_NUMBER', text: 'N. 0042' }, texts, labels), 'RICORDO N. 0042');
  assert.equal(resolveText({ role: 'PRINT_NUMBER', text: 'N. 0042' }, texts, {}), 'N. 0042');
  assert.equal(resolveText({ role: 'PRINT_NUMBER', text: 'N. 0042' }, texts, { printNumber: 'MEMORY NO. %1$04d' }), 'MEMORY NO. 0042');
  // una traduzione che non espande il segnaposto viene completata
  assert.equal(resolveText({ role: 'PRINT_NUMBER', text: 'N. 0042' }, texts, { printNumber: () => 'RICORDO N. %1$04d' }), 'RICORDO N. 0042');
  assert.equal(resolveText({ role: 'PRINT_NUMBER', text: 'N. 0042' }, texts, { printNumber: () => '' }), 'N. 0042');
  assert.equal(resolveText({ role: 'PRINT_NUMBER', text: 'N. 0042' }, {}, labels), 'N. 0042');
  assert.equal(resolveText({ role: 'CAPTION', text: 'Ciao' }, texts, labels), 'Ciao');
});

// ---------------------------------------------------------------- decorazioni

test('dashedRects: trattini 6/4 da from a to, l\'ultimo tagliato', () => {
  const rects = dashedRects({ type: 'dashed', y: 100, from: 16, to: 368, dash: 6, gap: 4, thickness: 2 });
  assert.equal(rects.length, 36);
  assert.deepEqual(rects[0], [16, 100, 6, 2]);
  assert.deepEqual(rects[1], [26, 100, 6, 2]);
  assert.deepEqual(rects.at(-1), [366, 100, 2, 2]);
});

test('frameRects: cornice interna, spessore limitato', () => {
  assert.deepEqual(frameRects({ rect: { left: 10, top: 20, width: 100, height: 50 }, thickness: 2 }), [
    [10, 20, 100, 2], [10, 68, 100, 2], [10, 20, 2, 50], [108, 20, 2, 50],
  ]);
  assert.equal(frameRects({ rect: { left: 0, top: 0, width: 100, height: 50 }, thickness: 100 })[0][3], 26);
});

test('zigzagRects: triangoli senza antialias, regola del centro del pixel', () => {
  const rects = zigzagRects({ type: 'zigzag', y: 10, tooth: 8 }, 16);
  assert.deepEqual(rects, [
    [0, 10, 7, 1], [1, 11, 5, 1], [2, 12, 3, 1], [3, 13, 1, 1],
    [8, 10, 7, 1], [9, 11, 5, 1], [10, 12, 3, 1], [11, 13, 1, 1],
  ]);
});

test('decorationRects: tipi del core e alias', () => {
  const layout = {
    width: 32,
    decorations: [
      { type: 'dashed', y: 0, from: 0, to: 10, dash: 6, gap: 4, thickness: 2 },
      { type: 'Frame', rect: { left: 0, top: 0, width: 10, height: 10 }, thickness: 1 },
      { type: 'ZIGZAG', y: 20, tooth: 8 },
      { type: 'sconosciuta' },
    ],
  };
  assert.equal(decorationRects(layout).length, 1 + 4 + 16);
});

// ---------------------------------------------------------------- bitmap e font

test('coverCrop: stessi ritagli di Bitmap.centerCrop', () => {
  assert.deepEqual(coverCrop(4000, 3000, 352, 352), { sx: 500, sy: 0, sw: 3000, sh: 3000 });
  assert.deepEqual(coverCrop(3000, 4000, 352, 264), { sx: 0, sy: 875, sw: 3000, sh: 2250 });
  assert.deepEqual(coverCrop(384, 512, 384, 512), { sx: 0, sy: 0, sw: 384, sh: 512 });
  assert.deepEqual(coverCrop(1001, 1000, 1, 1), { sx: 0, sy: 0, sw: 1000, sh: 1000 });
});

test('halvingSteps: dimezza finché la sorgente è il doppio in entrambi i lati', () => {
  assert.deepEqual(halvingSteps(3000, 2250, 352, 264), [
    { width: 1500, height: 1125 }, { width: 750, height: 562 }, { width: 375, height: 281 },
  ]);
  assert.deepEqual(halvingSteps(700, 2000, 352, 264), []);
});

test('scaleRgbaNearest: replica dei pixel senza filtri', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const out = scaleRgbaNearest(rgba, 2, 1, 2);
  const px = (x, y) => out[(y * 4 + x) * 4];
  assert.equal(out.length, 4 * 2 * 4);
  assert.deepEqual([px(0, 0), px(1, 0), px(2, 0), px(3, 0), px(0, 1), px(3, 1)], [0, 0, 255, 255, 0, 255]);
  assert.equal(scaleRgbaNearest(rgba, 2, 1, 1), rgba);
});

test('sourceSize: video, img e bitmap', () => {
  assert.deepEqual(sourceSize({ videoWidth: 640, videoHeight: 480, readyState: 4, width: 300, height: 400 }), { width: 640, height: 480 });
  assert.deepEqual(sourceSize({ naturalWidth: 10, naturalHeight: 20, width: 1, height: 2 }), { width: 10, height: 20 });
  assert.deepEqual(sourceSize({ width: 7, height: 8 }), { width: 7, height: 8 });
});

test('fontFor, fontUrl e metriche', () => {
  assert.equal(fontFor('MONO_BOLD', 28), '700 28px "Space Mono", monospace');
  assert.equal(fontFor('MONO', 20), '400 20px "Space Mono", monospace');
  assert.equal(fontFor('DISPLAY', 19.6), '400 19.6px "Righteous", sans-serif');
  assert.match(fontUrl('righteous_regular.ttf'), /\/web\/fonts\/righteous_regular\.ttf$/);
  assert.ok(Math.abs(FONT_METRICS.DISPLAY.spacing - 1.2417) < 1e-3);
  assert.equal(FONT_METRICS.MONO.capHeight, 0.7);
});

test('ensureFonts senza FontFace (Node) risponde false senza errori', async () => {
  assert.equal(await ensureFonts(), false);
});

test('bitImageToCanvas: bianco e nero, ingrandimento intero', () => {
  const img = new BitImage(3, 2);
  img.set(0, 0, true);
  img.set(2, 1, true);
  const canvas = bitImageToCanvas(img, 2);
  assert.equal(canvas.width, 6);
  assert.equal(canvas.height, 4);
  const at = (x, y) => canvas.pixels[(y * 6 + x) * 4];
  assert.deepEqual([at(0, 0), at(1, 1), at(2, 0), at(4, 2), at(5, 3), at(3, 3)], [0, 0, 255, 0, 0, 255]);
});

// ---------------------------------------------------------------- composizione completa

const labels = { footer: 'Grazie per il sorriso!', printNumber: (n) => `RICORDO N. ${String(n).padStart(4, '0')}` };
const photo = (gray = 128, width = 1600, height = 1200) => ({ width, height, fakeGray: gray });

test('renderPrint: scontrino completo, misure del core e testi fissi dalle etichette', async () => {
  const created = trackCanvases();
  const texts = { caption: 'Festa!', eventTitle: 'Compleanno', hashtag: 'ff', dateText: '18/10/2026', printNumber: 42 };
  const request = { photos: [photo()], template: 'RECEIPT', paper: 'MM58', dither: 'ATKINSON', tone: {}, texts, labels };
  const { bitImage, canvas } = await renderPrint(request);
  const layout = layoutTemplate('RECEIPT', 'MM58', 1, texts);

  assert.equal(bitImage.width, 384);
  assert.equal(bitImage.height, layout.height);
  assert.equal(canvas.width, bitImage.width);
  assert.equal(canvas.height, bitImage.height);

  // testi disegnati: quelli del core più marchio, numero e piede risolti
  const drawn = created.flatMap((c) => c.log).map((l) => l.text);
  for (const s of ['FOTOFLASH', 'Compleanno', 'Festa!', '#ff', 'RICORDO N. 0042', '18/10/2026', 'Grazie per il sorriso!']) {
    assert.ok(drawn.includes(s), `manca "${s}" tra ${JSON.stringify(drawn)}`);
  }
  // marchio con spaziatura arrotondata e mezza spaziatura prima del primo glifo
  const brand = created.flatMap((c) => c.log).find((l) => l.text === 'FOTOFLASH');
  assert.equal(brand.letterSpacing, '4px');
  const brandBlock = layout.texts.find((b) => b.role === 'BRAND');
  const width = 9 * ADVANCE * 48 + 9 * 4;
  assert.ok(Math.abs(brand.x - (alignedLeft('CENTER', brandBlock.rect, width) + 2)) < 1e-9);

  // le righe tratteggiate ci sono, nei punti del core
  for (const d of layout.decorations) {
    assert.equal(bitImage.get(d.from, d.y), true, 'inizio del trattino');
    assert.equal(bitImage.get(d.from + d.dash, d.y), false, 'pausa tra i trattini');
    assert.equal(bitImage.get(d.from, d.y + d.thickness), false, 'spessore');
  }
  // la foto è retinata: un grigio medio diventa un misto di punti neri e bianchi
  const r = layout.photos[0];
  let black = 0;
  for (let y = r.top; y < r.top + r.height; y++) for (let x = r.left; x < r.left + r.width; x++) black += bitImage.get(x, y) ? 1 : 0;
  const coverage = black / (r.width * r.height);
  assert.ok(coverage > 0.1 && coverage < 0.9, `copertura ${coverage}`);
  // margini della foto bianchi
  assert.equal(bitImage.get(r.left - 1, r.top + 10), false);
});

test('renderPrint: striscia da 3, ogni riquadro ha la sua foto', async () => {
  const photos = [photo(0), photo(255), photo(0)];
  const { bitImage } = await renderPrint({ photos, template: 'STRIP', paper: 'MM58', dither: 'THRESHOLD', tone: { autoLevels: false, autoBacklight: false, localContrast: 0, sharpen: 0, shadows: 0, contrast: 0, gamma: 1 }, texts: {}, labels });
  const layout = layoutTemplate('STRIP', 'MM58', 3, {});
  assert.equal(layout.photos.length, 3);
  assert.equal(bitImage.height, layout.height);
  const center = (r) => bitImage.get(r.left + (r.width >> 1), r.top + (r.height >> 1));
  assert.deepEqual(layout.photos.map(center), [true, false, true]);
});

test('renderPrint: 80 mm e modello senza testi (solo foto)', async () => {
  const { bitImage } = await renderPrint({ photos: [photo()], template: 'FULL', paper: 'MM80', texts: {}, labels });
  const layout = layoutTemplate('FULL', 'MM80', 1, {});
  assert.equal(bitImage.width, 576);
  assert.equal(bitImage.height, layout.height);
});

test('renderPrint: errori con codice', async () => {
  await assert.rejects(() => renderPrint({ photos: [], template: 'POLAROID', paper: 'MM58' }), (e) => e.code === 'no-photos');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => renderPrint({ photos: [photo()], template: 'POLAROID', paper: 'MM58', texts: {}, signal: controller.signal }),
    (e) => e.name === 'AbortError',
  );
  await assert.rejects(
    () => renderPrint({ photos: [{ width: 0, height: 0 }], template: 'POLAROID', paper: 'MM58', texts: {} }),
    (e) => e.code === 'render-failed',
  );
});
