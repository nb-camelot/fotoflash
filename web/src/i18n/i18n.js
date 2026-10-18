// Testi dell'interfaccia in cinque lingue. Inglese e italiano stanno nelle tabelle delle aree
// (strings/<area>.js: { en, it }, stesse chiavi, prefisso dell'area); spagnolo, francese e tedesco in
// locales/<lingua>.js, una mappa piatta con tutte le chiavi inglesi, caricata solo quando serve.
// Una chiave che manca in una lingua ripiega sull'inglese. I segnaposto sono quelli delle risorse
// Android (%1$s, %1$d, %1$04d, %%).
import common from './strings/common.js';
import app from './strings/app.js';
import onb from './strings/onb.js';
import set from './strings/set.js';
import prn from './strings/printer.js';
import cam from './strings/cam.js';
import ed from './strings/ed.js';
import hist from './strings/hist.js';
import land from './strings/land.js';
import scene from './strings/scene.js';

export const LANGS = ['en', 'it', 'es', 'fr', 'de'];

/** Nome di ogni lingua nella lingua stessa: è così che la si riconosce in un elenco. */
export const LANG_NAMES = Object.freeze({
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
});

const FALLBACK = 'en';
const STORE_KEY = 'fotoflash.lang';

// Lingue con le tabelle a parte: arrivano con un import dinamico, così chi non le usa non le scarica.
const LOCALE_LOADERS = {
  es: () => import('./locales/es.js'),
  fr: () => import('./locales/fr.js'),
  de: () => import('./locales/de.js'),
};

// Fusione delle tabelle en/it: è solo calcolo, si può fare al caricamento del modulo.
const TABLES = { en: {}, it: {} };
for (const table of [common, app, onb, set, prn, cam, ed, hist, land, scene]) {
  for (const l of ['en', 'it']) Object.assign(TABLES[l], (table && table[l]) || {});
}

let forced; // undefined = non ancora letta; null = segue il browser
let detected = null;
let watching = false;
const loading = new Map();
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

/** Prima lingua del browser che FotoFlash parla (navigator.languages in ordine), altrimenti l'inglese. */
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

/** Solo testi veri: una voce vuota o non stringa conta come mancante e ripiega sull'inglese. */
function cleanTable(table) {
  const out = {};
  for (const [key, value] of Object.entries(table || {})) {
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

/**
 * Carica la tabella di una lingua (es, fr, de). → Promise<boolean>: false se non c'è o non arriva
 * (per esempio offline prima che il service worker l'abbia messa in cache): si resta sull'inglese.
 */
export function loadLang(l) {
  if (TABLES[l]) return Promise.resolve(true);
  const loader = LOCALE_LOADERS[l];
  if (!loader) return Promise.resolve(false);
  if (!loading.has(l)) {
    loading.set(l, loader().then((mod) => {
      TABLES[l] = cleanTable(mod && mod.default);
      return true;
    }).catch((e) => {
      console.warn(`[i18n] lingua ${l} non caricata`, e);
      loading.delete(l);
      return false;
    }));
  }
  return loading.get(l);
}

/** Pronta la tabella della lingua in uso: l'avvio la aspetta prima di disegnare la prima schermata. */
export function ready() {
  return loadLang(lang());
}

/** Lingua in uso: quella scelta nelle impostazioni, altrimenti quella del browser. */
export function lang() {
  return readForced() || detect();
}

/** Scelta salvata: 'auto' quando segue il browser. */
export function langSetting() {
  return readForced() || 'auto';
}

/** Vero se la tabella della lingua è arrivata e ha almeno un testo. */
function hasTexts(l) {
  const table = TABLES[l];
  if (!table) return false;
  for (const key in table) if (key) return true;
  return false;
}

/**
 * Lingua in cui sono davvero scritti i testi: quella in uso, oppure l'inglese finché la sua tabella è
 * vuota o non è arrivata. È quella da mettere in lang, così il lettore di schermo usa la voce giusta.
 */
export function textLang() {
  const l = lang();
  return hasTexts(l) ? l : FALLBACK;
}

function applyToDocument() {
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = textLang();
}

function notify(after, before) {
  applyToDocument();
  for (const fn of [...listeners]) {
    try {
      fn(after, before);
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * Forza una lingua (una di LANGS); null o 'auto' torna a seguire il browser. Per en e it l'effetto è
 * immediato; per le altre lingue la tabella arriva prima di avvisare chi ascolta. → Promise<void>.
 */
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
  if (TABLES[after]) {
    notify(after, before);
    return Promise.resolve();
  }
  return loadLang(after).then(() => {
    // Nel frattempo può essere arrivata un'altra scelta: vale l'ultima.
    if (lang() === after) notify(after, before);
  });
}

/** Avvisa quando cambia la lingua scelta; restituisce la funzione per smettere. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Segue le scelte fatte in un'altra finestra della stessa origine (un'altra scheda, oppure la cornice
 * del telefono sul desktop e la pagina che la ospita): l'evento storage arriva solo alle altre.
 */
export function watchLangStorage() {
  if (watching || typeof globalThis.addEventListener !== 'function') return;
  watching = true;
  globalThis.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORE_KEY) return;
    const before = lang();
    const settingBefore = langSetting();
    forced = undefined;
    detected = null;
    const after = lang();
    // Anche «Automatica» → «Italiano» con il browser già in italiano va avvisato: cambia il chip scelto.
    if (after === before && langSetting() === settingBefore) return;
    loadLang(after).then(() => {
      if (lang() === after) notify(after, before);
    });
  });
}

/** Vero se la chiave esiste (in qualunque lingua). */
export function has(key) {
  return Object.keys(TABLES).some((l) => key in TABLES[l]);
}

/** Testo tradotto; con argomenti applica i segnaposto come String.format di Android. */
export function t(key, ...args) {
  const table = TABLES[lang()];
  let text = table ? table[key] : undefined;
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
