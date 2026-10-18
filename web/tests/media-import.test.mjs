// Test dell'import di foto: misure e errori leggibili dalla UI (in Node non c'è decodifica).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, isNonImageType, loadImageFile, loadImageFiles, MAX_PHOTO_SIDE } from '../src/media/import.js';

test('fitWithin: lato lungo al massimo maxSide, proporzioni e arrotondamento come Kotlin', () => {
  assert.equal(MAX_PHOTO_SIDE, 2048);
  assert.deepEqual(fitWithin(4032, 3024), { width: 2048, height: 1536 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1536, height: 2048 });
  assert.deepEqual(fitWithin(1000, 800), { width: 1000, height: 800 }, 'mai ingrandita');
  assert.deepEqual(fitWithin(5000, 3, 2048), { width: 2048, height: 1 }, 'minimo 1 px');
  assert.deepEqual(fitWithin(3001, 2001, 1000), { width: 1000, height: 667 });
  assert.deepEqual(fitWithin(800, 600, 0), { width: 800, height: 600 }, 'maxSide non valido = nessuna riduzione');
});

test('isNonImageType: il tipo vuoto si prova a decodificare', () => {
  assert.equal(isNonImageType('image/jpeg'), false);
  assert.equal(isNonImageType('image/heic'), false);
  assert.equal(isNonImageType(''), false);
  assert.equal(isNonImageType(undefined), false);
  assert.equal(isNonImageType('application/pdf'), true);
  assert.equal(isNonImageType('text/plain'), true);
});

test('loadImageFile: un file che non è un\'immagine ha il codice not-image', async () => {
  await assert.rejects(() => loadImageFile(new Blob(['ciao'], { type: 'text/plain' })), (e) => e.code === 'not-image');
  await assert.rejects(() => loadImageFile(null), (e) => e.code === 'not-image');
});

test('loadImageFile: senza decodificatore (Node) il formato è non supportato', async () => {
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
  await assert.rejects(() => loadImageFile(png), (e) => e.code === 'unsupported-format' && e.name === 'ImportError');
});

test('loadImageFiles: il primo errore interrompe e risale', async () => {
  await assert.rejects(
    () => loadImageFiles([new Blob(['x'], { type: 'application/zip' })]),
    (e) => e.code === 'not-image',
  );
  assert.deepEqual(await loadImageFiles([]), []);
});
