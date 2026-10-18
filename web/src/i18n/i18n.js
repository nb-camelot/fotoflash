// Testi dell'interfaccia. Ogni area ha la sua tabella in strings/<area>.js ({ en, it }, stesse
// chiavi, prefisso dell'area) e i segnaposto sono quelli delle risorse Android (%1$s, %1$d, %1$04d, %%).
import common from './strings/common.js';
import app from './strings/app.js';
import onb from './strings/onb.js';
import set from './strings/set.js';
import prn from './strings/printer.js';
import cam from './strings/cam.js';
import ed from './strings/ed.js';
import hist from './strings/hist.js';

export const LANGS = ['en', 'it'];
const FALLBACK = 'en';
const STORE_KEY = 'fotoflash.lang';

// Fusione delle tabelle: è solo calcolo, si può fare al caricamento del modulo.
const TABLES = { en: {}, it: {} };
for (const table of [common, app, onb, set, prn, cam, ed, hist]) {
  for (const l of LANGS) Object.assign(TABLES[l], (table && table[l]) || {});
}

let forced; // undefined = non ancora letta; null = segue il sistema
let detected = null;
const listeners = new Set();
const warned = new Set();

function readForced() {
  if (forced !== undefined) return forced;
  forced = null;
  try {
    const saved = globalThis.localStorage && globalThis.localStorage.getItem(STORE_KEY);
    if (LANGS.includes(saved)) forced = saved;
  } catch {
    // senza localStorage la scelta vale solo per questa visita
  }
  return forced;
}

function detect() {
  if (detected) return detected;
  const nav = globalThis.navigator;
  const tags = nav ? [...(nav.languages || []), nav.language] : [];
  detected = FALLBACK;
  for (const tag of tags) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) {
      detected = base;
      break;
    }
  }
  return detected;
}

/** Lingua in uso: quella scelta nelle impostazioni, altrimenti quella del browser ('it' | 'en'). */
export function lang() {
  return readForced() || detect();
}

/** Scelta salvata: 'auto' quando segue il browser. */
export function langSetting() {
  return readForced() || 'auto';
}

/** Forza una lingua ('it' | 'en'); null o 'auto' torna a seguire il browser. */
export function setLang(l) {
  const before = lang();
  const value = LANGS.includes(l) ? l : null;
  forced = value;
  detected = null;
  try {
    if (value) globalThis.localStorage.setItem(STORE_KEY, value);
    else globalThis.localStorage.removeItem(STORE_KEY);
  } catch {
    // resta valida per questa visita
  }
  const after = lang();
  for (const fn of [...listeners]) {
    try {
      fn(after, before);
    } catch (e) {
      console.error(e);
    }
  }
}

/** Avvisa quando cambia la lingua scelta; restituisce la funzione per smettere. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Vero se la chiave esiste (in qualunque lingua). */
export function has(key) {
  return key in TABLES[FALLBACK] || LANGS.some((l) => key in TABLES[l]);
}

/** Testo tradotto; con argomenti applica i segnaposto come String.format di Android. */
export function t(key, ...args) {
  let text = TABLES[lang()][key];
  if (text === undefined) text = TABLES[FALLBACK][key];
  if (text === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] testo mancante: ${key}`);
    }
    return key;
  }
  return args.length ? format(text, args) : text;
}

// %[n$][flag][larghezza][.precisione](s|d|f), più %% — il sottoinsieme usato dalle risorse.
const SPEC = /%(?:(\d+)\$)?([-0+ ]*)(\d+)?(?:\.(\d+))?([sdf%])/g;

/** Formattazione alla Android, esportata per i test. */
export function format(text, args) {
  let next = 0;
  return text.replace(SPEC, (match, index, flags, width, precision, conv) => {
    if (conv === '%') return '%';
    const value = index ? args[Number(index) - 1] : args[next++];
    let out;
    if (conv === 's') {
      out = value === undefined || value === null ? '' : String(value);
    } else {
      const n = Number(value);
      const num = Number.isFinite(n) ? n : 0;
      const abs = conv === 'd' ? String(Math.trunc(Math.abs(num))) : Math.abs(num).toFixed(precision ? Number(precision) : 6);
      const sign = num < 0 && (conv === 'f' || Math.trunc(num) !== 0) ? '-' : flags.includes('+') ? '+' : '';
      const w = width ? Number(width) : 0;
      if (flags.includes('0') && !flags.includes('-') && sign.length + abs.length < w) {
        out = sign + abs.padStart(w - sign.length, '0');
      } else {
        out = sign + abs;
      }
    }
    if (width && out.length < Number(width)) {
      out = flags.includes('-') ? out.padEnd(Number(width)) : out.padStart(Number(width));
    }
    return out;
  });
}
