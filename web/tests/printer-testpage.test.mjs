// Prove della pagina di prova (porting di TestPage.kt): ASCII, a capo, riquadro, bande dei retini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asciiOnly, wrapText, widthFrame, testPagePackets, buildTestPage, FRAME_ROWS, GRADIENT_ROWS } from '../src/printer/testpage.js';
import { PaperWidth } from '../src/core/model.js';
import { concatPackets } from '../src/core/escpos.js';
import { t, setLang, lang } from '../src/i18n/i18n.js';

const SETTINGS = { paper: 'MM58', feedLines: 4, cutPaper: false, heatLevel: 0, bandHeight: 24, dither: 'ATKINSON' };
const NOW = new Date(2026, 9, 18, 14, 32);

function gsv0(bytes) {
  const out = [];
  for (let i = 0; i + 7 < bytes.length; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) {
      const x = bytes[i + 4] | (bytes[i + 5] << 8);
      const y = bytes[i + 6] | (bytes[i + 7] << 8);
      out.push({ at: i, x, y });
      i += 7 + x * y;
    }
  }
  return out;
}

// Testo della pagina senza i dati raster (che possono contenere qualunque byte).
function textOf(bytes) {
  let out = '';
  let i = 0;
  const raster = gsv0(bytes);
  for (const r of raster) {
    out += Buffer.from(bytes.slice(i, r.at)).toString('latin1');
    i = r.at + 8 + r.x * r.y;
  }
  return out + Buffer.from(bytes.slice(i)).toString('latin1');
}

test('asciiOnly: accenti, spazi speciali, punteggiatura tipografica, il resto "?"', () => {
  assert.equal(asciiOnly('Intensità: Città perché'), 'Intensita: Citta perche');
  assert.equal(asciiOnly('18 ott 2026, 14:32 '), '18 ott 2026, 14:32 ');
  assert.equal(asciiOnly('a b\tc'), 'a b c');
  assert.equal(asciiOnly('‘x’ “y” «z»'), '\'x\' "y" "z"');
  assert.equal(asciiOnly('a–b—c… · • →'), 'a-b-c... - - ->');
  assert.equal(asciiOnly('riga1\nriga2'), 'riga1\nriga2');
  assert.equal(asciiOnly('€ 😀 ß'), '? ? ?');
  assert.equal(asciiOnly(null), '');
});

test('wrapText: a capo per parole, parole lunghe spezzate, paragrafi vuoti', () => {
  assert.deepEqual(wrapText('uno due tre', 7), ['uno due', 'tre']);
  assert.deepEqual(wrapText('abcdefghij xy', 4), ['abcd', 'efgh', 'ij', 'xy']);
  assert.deepEqual(wrapText('ab  cd', 10), ['ab cd']);
  assert.deepEqual(wrapText('a\n\nb', 10), ['a', '', 'b']);
  assert.deepEqual(wrapText('', 10), ['']);
  for (const line of wrapText(t('prn_test_width'), 31)) assert.ok(line.length <= 31, line);
});

test('widthFrame: bordi di 3 punti, tacche ogni 48 punti piu lunghe ogni 192', () => {
  const img = widthFrame(384);
  assert.equal(img.height, FRAME_ROWS);
  for (const [x, y] of [[0, 0], [2, 10], [383, 10], [381, 31], [200, 0], [200, 29]]) assert.equal(img.get(x, y), true, `${x},${y}`);
  assert.equal(img.get(3, 10), false);
  assert.equal(img.get(380, 10), false);
  assert.equal(img.get(48, 3), true);
  assert.equal(img.get(49, 10), true);
  assert.equal(img.get(48, 11), false, 'tacca corta: 8 punti');
  assert.equal(img.get(192, 18), true, 'tacca lunga: 16 punti');
  assert.equal(img.get(192, 19), false);
  assert.equal(img.get(100, 15), false);
});

test('pacchetti: intestazione, larghezza, titolo, quattro retini, piede (58 mm)', () => {
  const packets = testPagePackets(PaperWidth.MM58, SETTINGS, { printerName: 'BlueTooth Printer', now: NOW });
  assert.equal(packets.length, 1 + 1 + 1 + 4 + 1);
  const bytes = concatPackets(packets);
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x1b, 0x40], 'ESC @');
  assert.deepEqual(Array.from(bytes.slice(2, 5)), [0x1b, 0x61, 1], 'intensita 0: nessun ESC 7, poi centrato');
  const raster = gsv0(bytes);
  // riquadro 32 righe = 24 + 8; ogni sfumatura 40 righe = 24 + 16
  assert.deepEqual(raster.map((r) => r.y), [24, 8, 24, 16, 24, 16, 24, 16, 24, 16]);
  assert.ok(raster.every((r) => r.x === 48));
  const text = textOf(bytes);
  assert.ok(/^[\x00-\x7f]*$/.test(text), 'solo ASCII fuori dal raster');
  assert.ok(text.includes('\x1d\x21\x11FOTOFLASH\n\x1d\x21\x00'), 'marchio grande con GS !');
  assert.ok(text.includes(asciiOnly(t('prn_test_payoff'))));
  assert.ok(text.includes(asciiOnly(t('prn_test_printer', 'BlueTooth Printer'))));
  assert.ok(text.includes(asciiOnly(t('prn_test_paper', 58, 384))));
  assert.ok(text.includes(asciiOnly(t('prn_test_dither_current', t('prn_dither_atkinson')))));
  assert.ok(text.includes(asciiOnly(t('prn_dither_bayer')) + '\n'));
  assert.ok(text.includes(asciiOnly(t('prn_test_end'))));
  assert.ok(text.includes('-'.repeat(31) + '\n'));
  assert.ok(!text.includes('-'.repeat(32)), '31 colonne a 58 mm');
  for (const line of text.split('\n')) assert.ok(line.replace(/[\x00-\x1f]|\x1b.|\x1d../g, '').length <= 31 + 3, line);
  assert.deepEqual(Array.from(bytes.slice(-3)), [0x1b, 0x64, 4], 'avanzamento finale');
  assert.deepEqual(Array.from(buildTestPage(PaperWidth.MM58, SETTINGS, { printerName: 'BlueTooth Printer', now: NOW })), Array.from(bytes));
});

test('sfumature retinate: nero a sinistra, bianco a destra, una per algoritmo', () => {
  const bytes = buildTestPage('MM58', SETTINGS, { now: NOW });
  const raster = gsv0(bytes);
  for (const r of raster.slice(2).filter((_, i) => i % 2 === 0)) {
    const first = bytes[r.at + 8];
    const last = bytes[r.at + 8 + r.x - 1];
    assert.equal(first, 0xff, 'inizio della sfumatura nero');
    assert.equal(last, 0x00, 'fine della sfumatura bianca');
  }
  // i quattro algoritmi danno trame diverse
  const firstBands = raster.slice(2).filter((_, i) => i % 2 === 0)
    .map((r) => Buffer.from(bytes.slice(r.at + 8, r.at + 8 + r.x * r.y)).toString('hex'));
  assert.equal(new Set(firstBands).size, 4);
});

test('impostazioni: intensita, altezza banda, avanzamento, taglio, 80 mm, retino predefinito', () => {
  const settings = { ...SETTINGS, paper: 'MM80', heatLevel: 4, bandHeight: 16, feedLines: 30, cutPaper: true, dither: 'THRESHOLD' };
  const bytes = buildTestPage(undefined, settings, { now: NOW, writeMode: 'response-20', transfer: { mode: 'response-20', withResponse: true, chunk: 20, pause: 0 } });
  assert.deepEqual(Array.from(bytes.slice(0, 7)), [0x1b, 0x40, 0x1b, 0x37, 11, 140, 2]);
  const raster = gsv0(bytes);
  assert.ok(raster.every((r) => r.x === 72), '576 punti = 72 byte');
  assert.deepEqual(raster.slice(0, 2).map((r) => r.y), [16, 16]);
  assert.deepEqual(Array.from(bytes.slice(-7)), [0x1b, 0x64, 10, 0x1d, 0x56, 66, 0], 'avanzamento limitato a 10 + taglio');
  const text = textOf(bytes).replace(/\n/g, ' ');
  assert.ok(text.includes('-'.repeat(47)));
  assert.ok(text.includes(asciiOnly(t('prn_test_dither_current', t('prn_dither_threshold')))));
  assert.ok(text.includes(asciiOnly(t('prn_test_heat', t('prn_heat_level_4'), 4))));
  assert.ok(text.includes(asciiOnly(t('prn_test_transfer', 16, 20, 0))));
  assert.ok(text.includes(asciiOnly(t('prn_test_mode', t('prn_mode_response_20')))));
});

test('senza piano di invio la riga di blocco e pausa si omette; automatica a 20 byte', () => {
  const plain = textOf(buildTestPage('MM58', SETTINGS, { now: NOW })).replace(/\n/g, ' ');
  assert.ok(!plain.includes(asciiOnly(t('prn_test_transfer', 24, 100, 0))));
  assert.ok(plain.includes(asciiOnly(t('prn_test_mode', t('prn_mode_auto')))));
  const small = textOf(buildTestPage('MM58', SETTINGS, { now: NOW, transfer: { mode: 'auto', withResponse: true, chunk: 20, pause: 0 } })).replace(/\n/g, ' ');
  assert.ok(small.includes(asciiOnly(t('prn_test_mode', t('prn_mode_auto_small')))));
});

test('in italiano: testi tradotti e ridotti ad ASCII', () => {
  const before = lang();
  setLang('it');
  try {
    const text = textOf(buildTestPage('MM58', { ...SETTINGS, heatLevel: 2 }, { now: NOW })).replace(/\n/g, ' ');
    assert.ok(/^[\x00-\x7f]*$/.test(text));
    assert.ok(text.includes(asciiOnly(t('prn_test_heat', t('prn_heat_level_2'), 2))));
    assert.ok(text.includes(asciiOnly(t('prn_test_payoff'))));
  } finally {
    setLang(before === 'it' ? 'it' : null);
  }
});

test('nessun accesso al browser: GRADIENT_ROWS e FRAME_ROWS come TestPage.kt', () => {
  assert.equal(GRADIENT_ROWS, 40);
  assert.equal(FRAME_ROWS, 32);
});
