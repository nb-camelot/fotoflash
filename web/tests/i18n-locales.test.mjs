// Lingue in più (web/src/i18n/locales/<lingua>.js, mappe piatte chiave → testo) contro l'inglese di
// tutte le tabelle web/src/i18n/strings/*.js, comprese landing (land_) e scene (scene_):
// - esattamente le chiavi inglesi, né una di più né una di meno;
// - gli stessi segnaposto (%1$s, %1$d, %1$04d, %%), con la stessa molteplicità;
// - nessun testo vuoto o non stringa;
// - nessun testo inglese lasciato uguale. Fanno eccezione, da soli: i testi senza parole (numeri,
//   segnaposto, simboli), quelli fatti solo di marchi e sigle (FotoFlash, ESC/POS, BLE, PWA, APK…),
//   le note di copyright, poche parole che in quella lingua si scrivono uguali (de «App», fr
//   «Version»…) e le chiavi elencate in `export const sameAsEnglish = [...]` del file della lingua,
//   ammesse solo per testi brevi (al massimo tre parole) e solo se davvero uguali.
// Un file ancora vuoto (export default {}) viene saltato con un messaggio: lo riempiono i traduttori.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const I18N = path.join(WEB, 'src', 'i18n');
const STRINGS = path.join(I18N, 'strings');
const LOCALES = path.join(I18N, 'locales');
const EXTRA_LANGS = ['es', 'fr', 'de'];

// Parole che restano uguali in ogni lingua: marchi, nomi propri, sigle e unità.
const SHARED_TOKENS = new Set([
  'fotoflash', 'flash', 'android', 'chrome', 'edge', 'safari', 'firefox', 'ios', 'github', 'opencode', 'oc',
  'bluetooth', 'ble', 'spp', 'gatt', 'esc', 'pos', 'escpos', 'pwa', 'apk', 'usb', 'qr', 'url', 'http', 'https',
  'phomemo', 'm02', 'm02x', 'pro', 'atkinson', 'floyd', 'steinberg', 'bayer', 'polaroid', 'righteous', 'space',
  'mono', 'sil', 'ofl', 'mit', 'ok', 'dpi', 'mm', 'px', 'ms', 's', 'kb', 'mb', 'png', 'jpeg', 'jpg', 'zip', 'svg',
  'gs', 'hashtag', 'emoji', 'instagram', 'whatsapp', 'google', 'microsoft', 'apple', 'windows', 'macos', 'linux',
  'web', 'wi', 'fi', 'id',
]);

// Parole che una lingua scrive come l'inglese (falsi allarmi del controllo "lasciato in inglese").
const SAME_WORDS = {
  es: new Set(['app', 'apps', 'online', 'offline', 'selfie', 'selfies', 'blog', 'chat', 'software', 'hardware']),
  fr: new Set(['app', 'apps', 'version', 'photo', 'photos', 'message', 'messages', 'option', 'options', 'image', 'images',
    'impression', 'design', 'menu', 'test', 'note', 'notes', 'date', 'type', 'format', 'page', 'pages', 'mode', 'ticket',
    'tickets', 'animation', 'installation', 'information', 'description', 'configuration', 'calibration', 'confirmation',
    'question', 'questions', 'distance', 'collection', 'occasion', 'notification', 'notifications', 'action', 'actions',
    'restaurant', 'guide', 'simple', 'possible', 'smartphone', 'selfie', 'selfies', 'online', 'offline', 'blog', 'parent',
    'parents', 'service', 'minute', 'minutes', 'normal', 'excellent', 'source', 'contact', 'stop']),
  de: new Set(['app', 'apps', 'version', 'timer', 'online', 'offline', 'design', 'start', 'info', 'name', 'status', 'test',
    'smartphone', 'selfie', 'selfies', 'tablet', 'browser', 'party', 'team', 'event', 'events', 'hotel', 'restaurant',
    'service', 'ticket', 'tickets', 'computer', 'laptop', 'link', 'links', 'download', 'downloads', 'feedback', 'blog',
    'details', 'detail', 'material', 'logo', 'logos', 'super', 'cool', 'baby', 'hobby', 'sport']),
};

// Espressioni che restano uguali in ogni lingua anche se fatte di parole comuni.
const SHARED_PHRASES = new Set(['open source']);

const PLACEHOLDER = /%(?:\d+\$)?[-0+ ]*\d*(?:\.\d+)?[sdf]|%%/g;
const placeholders = (text) => (String(text).match(PLACEHOLDER) || []).sort();

/** Parole del testo, senza segnaposto, URL e indirizzi: quello che un traduttore dovrebbe toccare. */
function wordsOf(text) {
  const plain = String(text)
    .replace(PLACEHOLDER, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/\b[\w.-]+\.(?:com|io|org|dev|app)\S*/gi, ' ');
  return plain.toLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) || [];
}

/**
 * Vero se un testo uguale all'inglese è accettabile in quella lingua senza dichiararlo: solo marchi,
 * sigle e numeri, oppure una parola sola che quella lingua scrive uguale («App», «Version %1$s»).
 * «Android app» invece va tradotto anche se «app» da sola andrebbe bene.
 */
function sameIsFine(en, l) {
  if (/copyright|\(c\)|©/i.test(en)) return true; // note legali: restano come sono
  const words = wordsOf(en);
  if (!words.length) return true;
  if (SHARED_PHRASES.has(words.join(' '))) return true;
  if (words.every((w) => SHARED_TOKENS.has(w) || /^[a-z]?\d+[a-z\d]*$/.test(w))) return true;
  return words.length === 1 && (SAME_WORDS[l] || new Set()).has(words[0]);
}

/** Inglese di riferimento: tutte le chiavi en delle tabelle delle aree, con l'area di provenienza. */
async function englishTable() {
  const en = {};
  const files = fs.readdirSync(STRINGS).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(STRINGS, file)).href);
    Object.assign(en, (mod.default && mod.default.en) || {});
  }
  return en;
}

const short = (s) => {
  const one = String(s).replace(/\s+/g, ' ');
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
};

test('esistono le tabelle delle lingue in più', () => {
  const missing = EXTRA_LANGS.filter((l) => !fs.existsSync(path.join(LOCALES, `${l}.js`)));
  assert.deepEqual(missing, [], `mancano: ${missing.map((l) => `web/src/i18n/locales/${l}.js`).join(', ')}`);
});

for (const l of EXTRA_LANGS) {
  test(`locales/${l}.js: stesse chiavi e segnaposto dell'inglese, tutto tradotto`, async (tc) => {
    const file = path.join(LOCALES, `${l}.js`);
    if (!fs.existsSync(file)) {
      tc.skip(`locales/${l}.js non esiste`);
      return;
    }
    const mod = await import(pathToFileURL(file).href);
    const table = mod.default;
    assert.ok(table && typeof table === 'object' && !Array.isArray(table), `locales/${l}.js: serve export default { chiave: 'testo', … }`);
    if (Object.keys(table).length === 0) {
      tc.skip(`locales/${l}.js è ancora vuoto: in attesa dei traduttori (si ripiega sull'inglese)`);
      return;
    }
    const en = await englishTable();
    const declared = new Set(Array.isArray(mod.sameAsEnglish) ? mod.sameAsEnglish : []);
    const problems = [];

    const missing = Object.keys(en).filter((k) => !(k in table));
    const extra = Object.keys(table).filter((k) => !(k in en));
    if (missing.length) problems.push(`${missing.length} chiavi mancanti: ${missing.join(', ')}`);
    if (extra.length) problems.push(`${extra.length} chiavi che l'inglese non ha: ${extra.join(', ')}`);

    for (const [key, value] of Object.entries(table)) {
      if (!(key in en)) continue;
      if (typeof value !== 'string' || value.trim() === '') {
        problems.push(`${key}: testo vuoto o non stringa`);
        continue;
      }
      const want = placeholders(en[key]);
      const got = placeholders(value);
      if (want.join(' ') !== got.join(' ')) {
        problems.push(`${key}: segnaposto [${got.join(' ')}] invece di [${want.join(' ')}]`);
      }
      if (value === en[key] && !sameIsFine(en[key], l)) {
        if (!declared.has(key)) problems.push(`${key}: lasciato in inglese («${short(value)}»)`);
        else if (wordsOf(en[key]).length > 3) problems.push(`${key}: sameAsEnglish vale solo per testi di al massimo tre parole`);
      }
    }
    for (const key of declared) {
      if (!(key in en)) problems.push(`sameAsEnglish: ${key} non è una chiave inglese`);
      else if (table[key] !== en[key]) problems.push(`sameAsEnglish: ${key} non è uguale all'inglese (o manca): va tolto dall'elenco`);
    }
    assert.equal(problems.length, 0, `locales/${l}.js:\n  ${problems.join('\n  ')}`);
  });
}

test('le regole delle eccezioni riconoscono marchi e testi senza parole', () => {
  assert.ok(sameIsFine('%1$d/%2$d', 'de'));
  assert.ok(sameIsFine('%1$d s', 'fr'));
  assert.ok(sameIsFine('ESC/POS 58 mm', 'es'));
  assert.ok(sameIsFine('Floyd-Steinberg', 'fr'));
  assert.ok(sameIsFine('Copyright 2016 The Space Mono Project Authors (https://github.com/googlefonts/spacemono).', 'de'));
  assert.ok(sameIsFine('App', 'de'));
  assert.ok(sameIsFine('Version', 'fr'));
  assert.ok(sameIsFine('Version %1$s', 'de'));
  assert.ok(sameIsFine('Open source', 'es'));
  assert.ok(!sameIsFine('Version', 'es'));
  assert.ok(!sameIsFine('Android app', 'es'));
  assert.ok(!sameIsFine('Export', 'de'));
  assert.ok(!sameIsFine('Print', 'de'));
  assert.ok(!sameIsFine('Snap. Print. Smile.', 'fr'));
  assert.deepEqual(placeholders('Printing %1$d%% · no. %2$04d of %3$s'), ['%%', '%1$d', '%2$04d', '%3$s'].sort());
});
