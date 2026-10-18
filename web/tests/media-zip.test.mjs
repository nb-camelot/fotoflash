// Test dello ZIP "store": CRC noti, date DOS, nomi, struttura dei record letta byte per byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, dosDateTime, normalizeZipName, uniqueZipName, makeZip, FLAG_UTF8 } from '../src/media/zip.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Lettore indipendente: parte dal record di chiusura, come fanno gli estrattori. */
function parseZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50, 'firma del record di chiusura');
  const count = v.getUint16(eocd + 10, true);
  assert.equal(v.getUint16(eocd + 8, true), count, 'voci sul disco = voci totali');
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  assert.equal(v.getUint16(eocd + 20, true), 0, 'nessun commento');
  assert.equal(cdOffset + cdSize, eocd, 'la directory centrale finisce dove inizia la chiusura');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50, 'firma della directory centrale');
    const c = {
      versionMadeBy: v.getUint16(p + 4, true),
      versionNeeded: v.getUint16(p + 6, true),
      flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true),
      time: v.getUint16(p + 12, true),
      date: v.getUint16(p + 14, true),
      crc: v.getUint32(p + 16, true),
      compSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      nameLen: v.getUint16(p + 28, true),
      extraLen: v.getUint16(p + 30, true),
      commentLen: v.getUint16(p + 32, true),
      offset: v.getUint32(p + 42, true),
    };
    c.name = dec.decode(bytes.subarray(p + 46, p + 46 + c.nameLen));
    p += 46 + c.nameLen + c.extraLen + c.commentLen;

    // intestazione locale coerente con la centrale
    const l = c.offset;
    assert.equal(v.getUint32(l, true), 0x04034b50, 'firma dell\'intestazione locale');
    assert.equal(v.getUint16(l + 4, true), c.versionNeeded);
    assert.equal(v.getUint16(l + 6, true), c.flags);
    assert.equal(v.getUint16(l + 8, true), c.method);
    assert.equal(v.getUint16(l + 10, true), c.time);
    assert.equal(v.getUint16(l + 12, true), c.date);
    assert.equal(v.getUint32(l + 14, true), c.crc);
    assert.equal(v.getUint32(l + 18, true), c.compSize);
    assert.equal(v.getUint32(l + 22, true), c.size);
    const nameLen = v.getUint16(l + 26, true);
    const extraLen = v.getUint16(l + 28, true);
    assert.equal(dec.decode(bytes.subarray(l + 30, l + 30 + nameLen)), c.name);
    const start = l + 30 + nameLen + extraLen;
    c.data = bytes.subarray(start, start + c.size);
    entries.push(c);
  }
  assert.equal(p, cdOffset + cdSize, 'dimensione della directory centrale');
  return entries;
}

async function zipBytes(entries, options) {
  const blob = await makeZip(entries, options);
  assert.equal(blob.type, 'application/zip');
  return new Uint8Array(await blob.arrayBuffer());
}

test('crc32: vettori noti', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(crc32('123456789'), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32('The quick brown fox jumps over the lazy dog'), 0x414fa339);
  assert.equal(crc32(enc.encode('a')), 0xe8b7be43);
});

test('crc32: a pezzi uguale a tutto insieme', () => {
  const all = enc.encode('FotoFlash: scatta, stampa, sorridi!');
  const split = crc32(all.subarray(10), crc32(all.subarray(0, 10)));
  assert.equal(split, crc32(all));
});

test('dosDateTime: campi e risoluzione di 2 secondi', () => {
  const { date, time } = dosDateTime(new Date(2026, 9, 18, 15, 30, 13));
  assert.equal(date >> 9, 2026 - 1980);
  assert.equal((date >> 5) & 0x0f, 10);
  assert.equal(date & 0x1f, 18);
  assert.equal(time >> 11, 15);
  assert.equal((time >> 5) & 0x3f, 30);
  assert.equal((time & 0x1f) * 2, 12);
});

test('dosDateTime: fuori intervallo si blocca agli estremi', () => {
  const old = dosDateTime(new Date(1970, 0, 1, 10, 0, 0));
  assert.equal(old.date, (0 << 9) | (1 << 5) | 1);
  assert.equal(old.time, 0);
  const future = dosDateTime(new Date(2200, 0, 1));
  assert.equal(future.date >> 9, 127);
  assert.equal(dosDateTime(Date.UTC(2026, 0, 1)).date >> 9, 46, 'accetta anche i millisecondi');
});

test('normalizeZipName: niente radice, niente "..", barre in avanti', () => {
  assert.equal(normalizeZipName('foto.jpg'), 'foto.jpg');
  assert.equal(normalizeZipName('/abs/foto.jpg'), 'abs/foto.jpg');
  assert.equal(normalizeZipName('..\\..\\evil\\x.jpg'), 'evil/x.jpg');
  assert.equal(normalizeZipName('a/./b//c.png'), 'a/b/c.png');
  assert.equal(normalizeZipName('nome\u0000strano.jpg'), 'nomestrano.jpg');
  assert.equal(normalizeZipName(''), 'file');
  assert.equal(normalizeZipName(undefined), 'file');
});

test('uniqueZipName: i doppioni prendono un numero', () => {
  const used = new Set();
  assert.equal(uniqueZipName('foto.jpg', used), 'foto.jpg');
  assert.equal(uniqueZipName('foto.jpg', used), 'foto (2).jpg');
  assert.equal(uniqueZipName('FOTO.jpg', used), 'FOTO (3).jpg');
  assert.equal(uniqueZipName('cartella.x/senza', used), 'cartella.x/senza');
  assert.equal(uniqueZipName('cartella.x/senza', used), 'cartella.x/senza (2)');
});

test('makeZip: struttura dei record, store, UTF-8, CRC e offset', async () => {
  const when = new Date(2026, 9, 18, 9, 41, 22);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const entries = [
    { name: 'fotoflash-1.jpg', data: jpeg, date: when },
    { name: 'città/ricordo è bello.txt', data: 'Grazie per il sorriso!', date: when },
    { name: 'vuoto.bin', data: new Uint8Array(0), date: when },
    { name: 'blob.png', data: new Blob([enc.encode('PNG'), enc.encode('-dati')]), date: when.getTime() },
  ];
  const bytes = await zipBytes(entries);
  const parsed = parseZip(bytes);
  assert.equal(parsed.length, 4);

  const dos = dosDateTime(when);
  const expected = [jpeg, enc.encode('Grazie per il sorriso!'), new Uint8Array(0), enc.encode('PNG-dati')];
  parsed.forEach((e, i) => {
    assert.equal(e.name, entries[i].name);
    assert.equal(e.method, 0, 'store');
    assert.equal(e.flags & FLAG_UTF8, FLAG_UTF8, 'bit 11 per i nomi UTF-8');
    assert.equal(e.versionNeeded, 20);
    assert.equal(e.compSize, e.size);
    assert.equal(e.size, expected[i].length);
    assert.deepEqual([...e.data], [...expected[i]]);
    assert.equal(e.crc, crc32(expected[i]));
    assert.equal(e.date, dos.date);
    assert.equal(e.time, dos.time);
  });
  // il nome con accenti occupa i byte UTF-8, non i caratteri
  assert.equal(parsed[1].nameLen, enc.encode(entries[1].name).length);
  // le voci sono contigue: ogni intestazione locale segue i dati della precedente
  assert.equal(parsed[0].offset, 0);
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    assert.equal(parsed[i].offset, prev.offset + 30 + prev.nameLen + prev.size);
  }
});

test('makeZip: nomi doppi resi unici, avanzamento chiamato per ogni voce', async () => {
  const calls = [];
  const bytes = await zipBytes(
    [
      { name: 'a.jpg', data: new Uint8Array([1]) },
      { name: 'a.jpg', data: new Uint8Array([2]) },
      { name: '../a.jpg', data: new Uint8Array([3]) },
    ],
    { onProgress: (done, total) => calls.push([done, total]) },
  );
  const names = parseZip(bytes).map((e) => e.name);
  assert.deepEqual(names, ['a.jpg', 'a (2).jpg', 'a (3).jpg']);
  assert.deepEqual(calls, [[1, 3], [2, 3], [3, 3]]);
});

test('makeZip: archivio vuoto = solo il record di chiusura', async () => {
  const bytes = await zipBytes([]);
  assert.equal(bytes.length, 22);
  assert.deepEqual(parseZip(bytes), []);
});

test('makeZip: dati non supportati sono un errore', async () => {
  await assert.rejects(() => makeZip([{ name: 'x', data: 42 }]), TypeError);
});

test('makeZip: troppe voci per uno ZIP senza ZIP64', async () => {
  await assert.rejects(
    () => makeZip(Array.from({ length: 0x10000 }, () => ({ name: 'x', data: new Uint8Array(0) }))),
    (e) => e.code === 'zip-too-large',
  );
});
