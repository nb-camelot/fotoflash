// Metriche dei font del brand e distribuzione dei testi in righe: porting di TextMetrics, TextFit,
// normalizeText e lineHeightFor (TemplateGeometry.kt). Le stringhe JS sono UTF-16 come quelle Java,
// quindi indici, code point e cluster coincidono con Kotlin.

import { roundToInt } from './model.js';

/** Puntini di sospensione usati per troncare. */
export const ELLIPSIS = String.fromCharCode(0x2026);

const RIGHTEOUS_UPEM = 2048.0;
const RIGHTEOUS_ELLIPSIS = 1616;
/** Space Mono è monospaziato: 612/1000 em per ogni glifo latino. */
const MONO_ADVANCE = 0.612;
const ZWJ = 0x200d;
const KEYCAP = 0x20e3;

/** Righteous, avanzamenti in unità/2048 per i codici 32..126. */
const RIGHTEOUS_ASCII = [
  573, 563, 838, 1149, 938, 1403, 995, 489, 719, 719, 1208, 995, 541, 1083, 539, 1004,
  1315, 651, 1169, 1202, 1292, 1200, 1260, 1057, 1266, 1262, 567, 567, 979, 1104, 979, 1235,
  1290, 1380, 1364, 1311, 1339, 1184, 1151, 1362, 1413, 553, 854, 1280, 1153, 1679, 1413, 1593,
  1315, 1593, 1335, 1251, 1184, 1380, 1233, 1679, 1247, 1270, 1202, 780, 1004, 780, 602, 1225,
  461, 1245, 1223, 1069, 1243, 1075, 811, 1245, 1151, 483, 487, 1104, 483, 1561, 1151, 1186,
  1247, 1245, 848, 1073, 897, 1151, 1090, 1550, 1083, 1153, 987, 956, 547, 956, 924,
];

/** Righteous, avanzamenti in unità/2048 per i codici 160..255 (Latin-1: lettere accentate). */
const RIGHTEOUS_LATIN1 = [
  573, 563, 948, 1395, 930, 1339, 551, 1167, 616, 1343, 924, 1442, 1085, 858, 901, 506,
  782, 1057, 729, 727, 461, 1171, 1655, 535, 426, 475, 885, 1440, 1329, 1305, 1452, 1233,
  1380, 1380, 1380, 1380, 1380, 1380, 2025, 1311, 1184, 1184, 1184, 1184, 553, 553, 553, 553,
  1378, 1413, 1593, 1593, 1593, 1593, 1593, 981, 1593, 1380, 1380, 1380, 1380, 1270, 1305, 1667,
  1245, 1245, 1245, 1245, 1245, 1245, 1999, 1069, 1075, 1075, 1075, 1075, 483, 483, 483, 483,
  1190, 1151, 1186, 1186, 1186, 1186, 1186, 1012, 1186, 1151, 1151, 1151, 1151, 1153, 1247, 1153,
];

// Segni combinanti (categorie Mn e Me), come Character.getType di Java
const COMBINING = /^[\p{Mn}\p{Me}]$/u;

// Gli spazi di \s nelle Regex Kotlin/Java sono solo ASCII: NBSP e gli altri spazi Unicode restano
const KOTLIN_REGEX_SPACES = /[ \t\n\x0B\f\r]+/g;

function charCount(cp) {
  return cp > 0xffff ? 2 : 1;
}

function isRegionalIndicator(cp) {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/**
 * Code point che non avanzano: ZWJ, selettori di variante, carnagioni, tag delle bandiere,
 * segni combinanti. Il keycap U+20E3 resta largo: trasforma la cifra davanti in un'emoji.
 */
export function isZeroWidth(cp) {
  if (cp === KEYCAP) return false;
  if (cp === ZWJ || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f)) {
    return true;
  }
  // sotto U+0300 non ci sono segni combinanti: si evita la regex nel caso comune
  if (cp < 0x300) return false;
  return COMBINING.test(String.fromCodePoint(cp));
}

/**
 * Char.isWhitespace() di Kotlin/JVM: Character.isWhitespace || Character.isSpaceChar, cioè i
 * controlli 9..13 e 28..31 più le categorie Zs, Zl, Zp (NBSP compreso, BOM escluso).
 */
export function isKotlinWhitespace(ch) {
  if (ch === 0x20 || (ch >= 0x09 && ch <= 0x0d) || (ch >= 0x1c && ch <= 0x1f)) return true;
  if (ch < 0xa0) return false;
  return (
    ch === 0xa0 ||
    ch === 0x1680 ||
    (ch >= 0x2000 && ch <= 0x200a) ||
    ch === 0x2028 ||
    ch === 0x2029 ||
    ch === 0x202f ||
    ch === 0x205f ||
    ch === 0x3000
  );
}

/** String.trim() di Kotlin (non quello di JS, che toglie anche il BOM). */
export function kotlinTrim(s) {
  let start = 0;
  let end = s.length;
  while (start < end && isKotlinWhitespace(s.charCodeAt(start))) start++;
  while (end > start && isKotlinWhitespace(s.charCodeAt(end - 1))) end--;
  return s.substring(start, end);
}

/** String.trimEnd() di Kotlin. */
export function kotlinTrimEnd(s) {
  let end = s.length;
  while (end > 0 && isKotlinWhitespace(s.charCodeAt(end - 1))) end--;
  return s.substring(0, end);
}

/** Spazi multipli e a capo diventano uno spazio; null diventa "". */
export function normalizeText(raw) {
  if (raw === null || raw === undefined) return '';
  return kotlinTrim(String(raw).replace(KOTLIN_REGEX_SPACES, ' '));
}

/** Altezza di una riga di testo: corpo + circa 25% di aria. */
export function lineHeightFor(size) {
  return size + Math.trunc((size + 2) / 4);
}

/** Avanzamento in em; fuori dalle tabelle stime prudenti (quei glifi arrivano da font di ripiego). */
function advance(cp, font) {
  if (font === 'DISPLAY') {
    if (cp >= 32 && cp <= 126) return RIGHTEOUS_ASCII[cp - 32] / RIGHTEOUS_UPEM;
    if (cp >= 160 && cp <= 255) return RIGHTEOUS_LATIN1[cp - 160] / RIGHTEOUS_UPEM;
    if (cp === 0x2026) return RIGHTEOUS_ELLIPSIS / RIGHTEOUS_UPEM;
    if (cp <= 0x24f) return 0.7;
    if (cp <= 0xffff) return 1.0;
    return 1.25;
  }
  // MONO e MONO_BOLD
  if (cp <= 0x24f) return MONO_ADVANCE;
  if (cp <= 0xffff) return 1.0;
  return 1.25;
}

function checkFont(font) {
  if (font !== 'DISPLAY' && font !== 'MONO' && font !== 'MONO_BOLD') {
    throw new RangeError(`carattere sconosciuto: ${String(font)}`);
  }
}

/**
 * Larghezza stimata in punti di [text] al corpo [size] con il font [font] ('DISPLAY' | 'MONO' | 'MONO_BOLD').
 * Le emoji si misurano per glifo disegnato: modificatori, ZWJ e segni combinanti non occupano spazio,
 * una coppia di indicatori regionali è una bandiera sola; il code point dopo uno ZWJ conta per intero.
 */
export function textWidth(text, font, size) {
  checkFont(font);
  let em = 0.0;
  let i = 0;
  // indicatori regionali consecutivi: il secondo di ogni coppia completa la bandiera
  let regional = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    if (isRegionalIndicator(cp)) regional++;
    else regional = 0;
    const silent = isZeroWidth(cp) || (regional > 0 && regional % 2 === 0);
    if (!silent) em += advance(cp, font);
    i += charCount(cp);
  }
  return em * size;
}

/**
 * Fine (esclusa) del cluster che comincia in [start]: un code point, il secondo indicatore regionale
 * se il primo lo è, poi i code point a larghezza zero che lo seguono, il keycap e quello unito da
 * ogni ZWJ. È l'unità minima per andare a capo o troncare. [start] < s.length.
 */
export function clusterEnd(s, start) {
  let prev = s.codePointAt(start);
  let end = start + charCount(prev);
  if (isRegionalIndicator(prev) && end < s.length) {
    const next = s.codePointAt(end);
    if (isRegionalIndicator(next)) {
      end += charCount(next);
      prev = next;
    }
  }
  while (end < s.length) {
    const cp = s.codePointAt(end);
    // il keycap non è a larghezza zero ma fa parte della cifra che lo precede
    if (prev !== ZWJ && cp !== KEYCAP && !isZeroWidth(cp)) break;
    end += charCount(cp);
    prev = cp;
  }
  return end;
}

/** Namespace come l'object Kotlin. */
export const TextMetrics = Object.freeze({ width: textWidth, clusterEnd, isZeroWidth });

// ---------------------------------------------------------------- TextFit

/** Riduzione massima del corpo pur di restare su una riga, prima di andare a capo. */
export const ONE_LINE_SHRINK = 0.85;

/**
 * Corpo e righe di un testo che deve stare in [avail] punti: { size, lines }.
 * In ordine: una riga al corpo pieno (o ridotto fino all'85%); poi, se [maxLines] > 1, righe a capo
 * tra le parole riducendo il corpo fino a [minSize] (due righe bilanciate); altrimenti una riga fino
 * a [minSize]; in ultimo spezza le parole e tronca con l'ellissi.
 */
export function fitText(text, font, nominal, minSize, avail, maxLines) {
  checkFont(font);
  const oneLineFloor = Math.min(nominal, Math.max(minSize, roundToInt(nominal * ONE_LINE_SHRINK)));
  for (let s = nominal; s >= oneLineFloor; s--) {
    if (textWidth(text, font, s) <= avail) return { size: s, lines: [text] };
  }
  if (maxLines > 1) {
    for (let s = nominal; s >= minSize; s--) {
      const lines = wrapWords(text, font, s, avail);
      if (lines !== null && lines.length <= maxLines) {
        const balanced = lines.length === 2 ? balance(text, font, s, avail) : null;
        return { size: s, lines: balanced ?? lines };
      }
    }
  } else {
    for (let s = oneLineFloor - 1; s >= minSize; s--) {
      if (textWidth(text, font, s) <= avail) return { size: s, lines: [text] };
    }
  }
  const hard = wrapHard(text, font, minSize, avail);
  return { size: minSize, lines: limit(hard, Math.max(1, maxLines), font, minSize, avail) };
}

/** A capo tra le parole (greedy); null se una parola da sola non ci sta. */
export function wrapWords(text, font, size, avail) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (word.length === 0) continue;
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (textWidth(candidate, font, size) <= avail) {
      line = candidate;
      continue;
    }
    if (line.length === 0 || textWidth(word, font, size) > avail) return null;
    lines.push(line);
    line = word;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Due righe di lunghezza simile: un titolo centrato con la seconda riga corta sembra un errore. */
function balance(text, font, size, avail) {
  const words = text.split(' ').filter((w) => w.length > 0);
  let best = null;
  let bestWidth = Number.MAX_VALUE;
  for (let i = 1; i < words.length; i++) {
    const first = words.slice(0, i).join(' ');
    const second = words.slice(i).join(' ');
    const w = Math.max(textWidth(first, font, size), textWidth(second, font, size));
    if (w <= avail && w < bestWidth) {
      bestWidth = w;
      best = [first, second];
    }
  }
  return best;
}

/** A capo spezzando anche le parole troppo lunghe. */
function wrapHard(text, font, size, avail) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (word.length === 0) continue;
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (textWidth(candidate, font, size) <= avail) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    let rest = word;
    while (rest.length > 0 && textWidth(rest, font, size) > avail) {
      const n = fittingPrefix(rest, font, size, avail);
      lines.push(rest.substring(0, n));
      rest = rest.substring(n);
    }
    line = rest;
  }
  if (line.length > 0) lines.push(line);
  if (lines.length === 0) lines.push('');
  return lines;
}

/**
 * Lunghezza del prefisso più lungo che sta in [avail]; almeno un cluster, per avanzare sempre.
 * Si taglia solo tra cluster: mai tra le due metà di una bandiera o subito dopo uno ZWJ.
 */
function fittingPrefix(s, font, size, avail) {
  let end = clusterEnd(s, 0);
  while (end < s.length) {
    const next = clusterEnd(s, end);
    if (textWidth(s.substring(0, next), font, size) > avail) break;
    end = next;
  }
  return end;
}

/** Tiene al massimo [maxLines] righe; se ne taglia, l'ultima finisce con l'ellissi. */
function limit(lines, maxLines, font, size, avail) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kotlinTrimEnd(kept[maxLines - 1]);
  while (last.length > 0 && textWidth(last + ELLIPSIS, font, size) > avail) {
    last = kotlinTrimEnd(dropLastCluster(last));
  }
  kept[maxLines - 1] = last + ELLIPSIS;
  return kept;
}

/** Toglie l'ultimo cluster intero: una bandiera o un'emoji composta spariscono tutte insieme. */
function dropLastCluster(s) {
  // i cluster si contano dall'inizio: le coppie di indicatori regionali dipendono dalla parità
  let start = 0;
  let lastStart = 0;
  while (start < s.length) {
    lastStart = start;
    start = clusterEnd(s, start);
  }
  return s.substring(0, lastStart);
}

/** Namespace come l'object Kotlin. */
export const TextFit = Object.freeze({ fit: fitText, wrapWords });
