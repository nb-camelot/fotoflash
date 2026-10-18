// Pagina di prova: lo strumento di calibrazione, porting di TestPage.kt. Usa le stesse
// impostazioni di una stampa vera (intensita, altezza banda, avanzamento, taglio) e mostra i
// quattro retini su una sfumatura, cosi si vede subito l'effetto di ogni regolazione.
// Solo ASCII sulla carta: le codepage delle stampanti economiche variano e gli accenti escono a caso.

import { EscPosBuilder, concatPackets } from '../core/escpos.js';
import { BitImage } from '../core/bitimage.js';
import { GrayImage } from '../core/gray.js';
import { dither } from '../core/dither.js';
import { DitherAlgorithm, PaperWidth } from '../core/model.js';
import { BRAND_TEXT } from '../core/template.js';
import { t, lang } from '../i18n/i18n.js';
import { PrinterTuning } from './manager.js';

/** Altezza in punti delle bande di sfumatura (5 mm). */
export const GRADIENT_ROWS = 40;

/** Altezza in punti del riquadro di controllo larghezza. */
export const FRAME_ROWS = 32;

const DITHER_KEYS = Object.freeze({
  ATKINSON: 'prn_dither_atkinson',
  FLOYD_STEINBERG: 'prn_dither_floyd_steinberg',
  ORDERED_BAYER: 'prn_dither_bayer',
  THRESHOLD: 'prn_dither_threshold'
});

// Etichetta della modalita di invio BLE (stesse chiavi della schermata stampante).
function modeLabel(writeMode, transfer) {
  switch (writeMode) {
    case 'response-100': return t('prn_mode_response_100');
    case 'response-20': return t('prn_mode_response_20');
    case 'noresponse-20': return t('prn_mode_noresponse_20');
    default:
      return transfer && transfer.withResponse && transfer.chunk === 20 ? t('prn_mode_auto_small') : t('prn_mode_auto');
  }
}

function paperOf(paper, settings) {
  if (paper && typeof paper === 'object' && paper.dots > 0) return paper;
  const key = typeof paper === 'string' ? paper : settings && settings.paper;
  return Object.prototype.hasOwnProperty.call(PaperWidth, key) ? PaperWidth[key] : PaperWidth.MM58;
}

function formatDate(now) {
  try {
    return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(now);
  } catch (e) {
    return now.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * Riduce un testo ad ASCII stampabile, come TestPage.asciiOnly: toglie gli accenti (NFD + segni
 * combinanti), converte spazi speciali (lo spazio stretto delle date) e punteggiatura tipografica,
 * sostituisce il resto con "?". Vale anche per testi non nostri, come il nome della stampante.
 */
export function asciiOnly(text) {
  const decomposed = String(text == null ? '' : text).normalize('NFD');
  let out = '';
  for (const c of decomposed) {
    if (c >= ' ' && c <= '~') out += c;
    else if (c === '\n') out += c;
    else if (/\p{Mn}/u.test(c)) continue;
    else if (/\s/u.test(c)) out += ' ';
    else if (c === '‘' || c === '’') out += '\'';
    else if (c === '“' || c === '”' || c === '«' || c === '»') out += '"';
    else if (c === '–' || c === '—') out += '-';
    else if (c === '…') out += '...';
    else if (c === '·' || c === '•') out += '-';
    else if (c === '→') out += '->';
    else out += '?';
  }
  return out;
}

/** A capo per parole entro [columns]; le parole piu lunghe di una riga si spezzano. */
export function wrapText(text, columns) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let current = '';
    for (const rawWord of paragraph.split(' ')) {
      if (rawWord === '') continue;
      let word = rawWord;
      while (word.length > columns) {
        if (current !== '') {
          lines.push(current);
          current = '';
        }
        lines.push(word.slice(0, columns));
        word = word.slice(columns);
      }
      if (word === '') continue;
      if (current === '') current = word;
      else if (current.length + 1 + word.length <= columns) current += ' ' + word;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current !== '' || paragraph.trim() === '') lines.push(current);
  }
  return lines;
}

/** Riquadro a tutta larghezza con tacche ogni 6 mm (48 punti), piu lunghe ogni 24 mm. */
export function widthFrame(width) {
  const image = new BitImage(width, FRAME_ROWS);
  const border = 3;
  for (let x = 0; x < width; x++) {
    for (let k = 0; k < border; k++) {
      image.set(x, k, true);
      image.set(x, FRAME_ROWS - 1 - k, true);
    }
  }
  for (let y = 0; y < FRAME_ROWS; y++) {
    for (let k = 0; k < border; k++) {
      image.set(k, y, true);
      image.set(width - 1 - k, y, true);
    }
  }
  for (let x = 48; x < width - border; x += 48) {
    const length = x % 192 === 0 ? 16 : 8;
    for (let y = border; y < border + length; y++) {
      image.set(x, y, true);
      if (x + 1 < width) image.set(x + 1, y, true);
    }
  }
  return image;
}

/**
 * Pacchetti in ordine di invio, come TestPage.build: intestazione, controllo larghezza, titolo
 * dei retini, un retino per pacchetto, piede con l'avanzamento finale.
 * extra: { printerName, writeMode, transfer (Ble.info().transfer), now }
 */
export function testPagePackets(paper, settings = {}, extra = {}) {
  const s = settings || {};
  const p = paperOf(paper, s);
  const dots = p.dots;
  // Una colonna in meno del massimo: alcune stampanti a riga piena vanno a capo da sole
  // e il LF successivo lascerebbe una riga vuota.
  const columns = (dots <= PaperWidth.MM58.dots ? 32 : 48) - 1;
  const bandHeight = PrinterTuning.clampBandHeight(s.bandHeight);
  const heatLevel = PrinterTuning.clampHeatLevel(s.heatLevel);
  const rule = '-'.repeat(columns);
  const now = extra.now instanceof Date ? extra.now : new Date();
  const writeMode = extra.writeMode || 'auto';
  const transfer = extra.transfer || null;
  const packets = [];
  const lines = (builder, text) => {
    wrapText(asciiOnly(text), columns).forEach((line) => builder.line(line));
    return builder;
  };

  // Intestazione con i dati della taratura corrente
  const header = new EscPosBuilder().init();
  const heat = PrinterTuning.heatFor(heatLevel);
  if (heat) header.heat(heat);
  header.align('CENTER')
    .bold(true)
    .size(2, 2)
    .line(asciiOnly(BRAND_TEXT.toUpperCase()))
    .size(1, 1)
    .bold(false)
    .line(asciiOnly(t('prn_test_payoff')))
    .line(rule)
    .align('START');
  const info = [
    t('prn_test_printer', extra.printerName || '-'),
    t('prn_test_date', formatDate(now)),
    t('prn_test_paper', p.mm, dots),
    t('prn_test_heat', t(PrinterTuning.HEAT_LEVEL_KEYS[heatLevel]), heatLevel)
  ];
  // Sul web blocco e pausa sono quelli dell'invio BLE (pezzi da 20/100 byte), non del socket.
  if (transfer) info.push(t('prn_test_transfer', bandHeight, transfer.chunk, transfer.pause));
  info.push(t('prn_test_mode', modeLabel(writeMode, transfer)));
  info.forEach((text) => lines(header, text));
  header.line(rule);
  packets.push(header.bytes());

  // Controllo larghezza: se un bordo laterale manca, la larghezza carta e sbagliata
  const frame = lines(new EscPosBuilder().align('START'), t('prn_test_width'));
  frame.raster(widthFrame(dots), bandHeight).line('');
  packets.push(frame.bytes());

  // Un retino per pacchetto: la sfumatura nero → bianco mostra come rende ogni metodo
  packets.push(lines(new EscPosBuilder().align('START'), t('prn_test_dither')).bytes());
  for (const algorithm of DitherAlgorithm) {
    const name = t(DITHER_KEYS[algorithm]);
    const label = algorithm === s.dither ? t('prn_test_dither_current', name) : name;
    const band = dither(GrayImage.gradient(dots, GRADIENT_ROWS), algorithm);
    const block = lines(new EscPosBuilder().align('START'), label);
    block.raster(band, bandHeight).line('');
    packets.push(block.bytes());
  }

  // Consigli e avanzamento finale (con le impostazioni reali: anche questo si calibra)
  const footer = new EscPosBuilder().align('START').line(rule);
  ['prn_test_tip_pale', 'prn_test_tip_broken', 'prn_test_tip_blank'].forEach((key) => lines(footer, t(key)));
  footer.align('CENTER')
    .line(rule)
    .line(asciiOnly(t('prn_test_end')))
    .align('START')
    .feed(PrinterTuning.clampFeedLines(s.feedLines));
  if (s.cutPaper === true) footer.cut();
  packets.push(footer.bytes());
  return packets;
}

/**
 * Pagina di prova pronta per Ble.print. [paper]: PaperWidth ({ mm, dots }) o 'MM58' | 'MM80'
 * (senza, quella delle impostazioni). → Uint8Array
 */
export function buildTestPage(paper, settings = {}, extra = {}) {
  return concatPackets(testPagePackets(paper, settings, extra));
}
