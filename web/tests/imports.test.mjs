// Controllo dei moduli di web/src, statico e dinamico, senza DOM e senza dipendenze:
// - i file previsti dalla struttura di docs/WEB.md esistono;
// - ogni import è relativo, con estensione, e punta a un file che esiste (il sito vive sotto
//   /fotoflash/ e il browser non risolve né percorsi assoluti né pacchetti);
// - ogni .js si importa in Node, dove window, document, navigator e gli storage qui non esistono:
//   usarli al caricamento è vietato (docs/WEB.md) e fa fallire il test con file e riga;
// - le tabelle i18n hanno le stesse chiavi in en e it, con il prefisso dell'area;
// - le chiavi passate a t() sono nelle tabelle, in en e in it. Si controllano le chiavi ricavabili dal
//   testo: letterali ('ed_title'), rami di un'espressione (cond ? 'a' : 'b', x || 'c') e template
//   (`ed_fail_${k}_title`, almeno una chiave deve combaciare). Chiavi da variabili, come
//   t(TAB_LABELS[tab]), non si possono ricavare e restano escluse; in compenso ogni stringa del codice
//   con il prefisso di un'area ('prn_err_busy') è trattata come chiave e deve esistere anche lei.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WEB, '..');
const SRC = path.join(WEB, 'src');
const STRINGS = path.join(SRC, 'i18n', 'strings');
const REAL_REPO = fs.realpathSync.native(REPO);

/** File della struttura di docs/WEB.md (le schermate le controlla l'import di app.js e del router). */
const CONTRACT_FILES = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'styles/app.css',
  'src/app.js',
  'src/version.js',
  ...['model', 'gray', 'bitimage', 'tone', 'clahe', 'backlight', 'dither', 'textmetrics', 'template', 'escpos'].map(
    (m) => `src/core/${m}.js`,
  ),
  'src/printer/ble.js',
  'src/printer/manager.js',
  'src/printer/testpage.js',
  'src/render/renderer.js',
  'src/render/bitmap.js',
  'src/render/fonts.js',
  'src/camera/camera.js',
  'src/camera/live.js',
  'src/media/import.js',
  'src/media/export.js',
  'src/media/zip.js',
  'src/store/settings.js',
  'src/store/history.js',
  'src/i18n/i18n.js',
  ...['common', 'cam', 'ed', 'hist', 'set', 'printer', 'onb', 'app'].map((a) => `src/i18n/strings/${a}.js`),
  'src/ui/dom.js',
  'src/ui/icons.js',
  'src/ui/components.js',
  'src/ui/router.js',
];

// Ambiente senza browser, uguale su ogni versione di Node: Node 21+ definisce navigator (e le versioni
// recenti gli storage), quindi un modulo che li usa al caricamento passerebbe qui e cadrebbe in CI
// (Node 20). Tolte di mezzo, una lettura al caricamento fallisce; un controllo come
// `typeof document !== 'undefined'` (l'avvio di app.js) resta valido.
const BROWSER_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'location'];
for (const name of BROWSER_GLOBALS) {
  try {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: undefined });
  } catch {
    // proprietà non configurabile in questa versione di Node: resta quella originale
  }
}

// ---------------------------------------------------------------------------------------------
// Utilità

const rel = (file) => path.relative(REPO, file).split(path.sep).join('/');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

const REGEX_AFTER = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Lettura minima del JavaScript: il codice con i commenti sostituiti da spazi (stesse posizioni) e i
 * letterali stringa e template con le loro posizioni. Le regex letterali si saltano, così un apice
 * dentro /['"]/ non apre una stringa finta.
 * → { code, tokens: [{ type: 'str', start, end, value } | { type: 'tpl', start, end, parts, exprs }] }
 */
function scanJs(src) {
  const n = src.length;
  const chars = src.split('');
  const tokens = [];
  const stack = []; // template con ${ aperto: profondità delle graffe nell'espressione
  let prev = '';
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (chars[k] !== '\n') chars[k] = ' ';
  };
  const readTemplate = (tok) => {
    let value = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        value += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '`') {
        tok.parts.push(value);
        i++;
        tok.end = i;
        prev = 'lit';
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        tok.parts.push(value);
        i += 2;
        stack.push({ tok, depth: 0, start: i });
        prev = '{';
        return;
      }
      value += c;
      i++;
    }
    tok.parts.push(value);
    tok.end = n;
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (stack.length && (c === '{' || c === '}')) {
      const top = stack[stack.length - 1];
      if (c === '{') top.depth++;
      else if (top.depth > 0) top.depth--;
      else {
        stack.pop();
        top.tok.exprs.push([top.start, i]);
        i++;
        readTemplate(top.tok);
        continue;
      }
      prev = c;
      i++;
      continue;
    }
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      let value = '';
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') {
          value += src[i + 1] ?? '';
          i += 2;
        } else value += src[i++];
      }
      i++;
      tokens.push({ type: 'str', start, end: i, value });
      prev = 'lit';
      continue;
    }
    if (c === '`') {
      const tok = { type: 'tpl', start: i, end: n, parts: [], exprs: [] };
      tokens.push(tok);
      i++;
      readTemplate(tok);
      continue;
    }
    if (c === '/') {
      if (prev === '' || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || REGEX_AFTER.has(prev)) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== '\n') {
          const r = src[j];
          if (r === '\\') {
            j += 2;
            continue;
          }
          if (inClass) {
            if (r === ']') inClass = false;
          } else if (r === '[') inClass = true;
          else if (r === '/') break;
          j++;
        }
        if (j < n && src[j] === '/') {
          j++;
          while (j < n && /[a-z]/i.test(src[j])) j++;
          i = j;
          prev = 'lit';
          continue;
        }
      }
      prev = '/';
      i++;
      continue;
    }
    if (/[\w$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      prev = src.slice(i, j);
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  tokens.sort((a, b) => a.start - b.start);
  return { code: chars.join(''), tokens };
}

/** Vero se la posizione cade nel testo di un letterale (non nell'espressione ${…} di un template). */
function insideLiteral(tokens, pos) {
  for (const tok of tokens) {
    if (tok.start > pos) break;
    if (pos >= tok.end) continue;
    if (tok.type === 'str') return true;
    if (!tok.exprs.some(([s, e]) => pos >= s && pos < e)) return true;
  }
  return false;
}

/** Specificatori di import ed export statici e di import() con stringa letterale. */
function importsOf(src) {
  const { code, tokens } = scanJs(src);
  const byStart = new Map(tokens.map((t) => [t.start, t]));
  const found = [];
  const dynamic = [];
  const take = (quote, at) => {
    const tok = byStart.get(quote);
    if (tok && tok.type === 'str') found.push({ spec: tok.value, line: lineOf(src, at) });
  };
  const keyword = (m) => !insideLiteral(tokens, m.index) && code[m.index - 1] !== '.';

  const reFrom = /\b(?:import|export)\b[\w$\s{},*]*?\bfrom\s*(['"])/g;
  for (let m; (m = reFrom.exec(code)); ) if (keyword(m)) take(m.index + m[0].length - 1, m.index);

  const reBare = /\bimport\s*(['"])/g;
  for (let m; (m = reBare.exec(code)); ) if (keyword(m)) take(m.index + m[0].length - 1, m.index);

  const reDyn = /\bimport\s*\(\s*/g;
  for (let m; (m = reDyn.exec(code)); ) {
    if (!keyword(m)) continue;
    const at = m.index + m[0].length;
    const tok = byStart.get(at);
    if (tok && tok.type === 'str') found.push({ spec: tok.value, line: lineOf(src, m.index) });
    else dynamic.push(lineOf(src, m.index));
  }
  return { found, dynamic };
}

const KEY_SHAPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Chiavi passate a t(…) e ctx.t(…): { keys: [{ key, line }], patterns: [{ re, text, line }], dynamic }.
 */
function translationCalls(src) {
  const { code, tokens } = scanJs(src);
  const byStart = new Map(tokens.map((t) => [t.start, t]));
  const keys = [];
  const patterns = [];
  let dynamic = 0;
  const re = /(?<![\w$])t\s*\(/g;
  for (let m; (m = re.exec(code)); ) {
    if (insideLiteral(tokens, m.index)) continue;
    if (/\bfunction\s*$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue; // la definizione
    const line = lineOf(src, m.index);
    const from = m.index + m[0].length;
    // fine del primo argomento: virgola o parentesi chiusa allo stesso livello
    let depth = 0;
    let j = from;
    while (j < code.length) {
      const tok = byStart.get(j);
      if (tok) {
        j = tok.end;
        continue;
      }
      const c = code[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
      j++;
    }
    const inArg = tokens.filter((t) => t.start >= from && t.end <= j);
    const argText = code.slice(from, j).trim();
    const single = inArg.length >= 1 && argText === src.slice(inArg[0].start, inArg[0].end);
    let got = 0;
    for (const tok of single ? [inArg[0]] : inArg) {
      if (tok.type === 'str') {
        if (single || KEY_SHAPE.test(tok.value)) {
          keys.push({ key: tok.value, line });
          got++;
        }
      } else if (tok.parts.length === 1) {
        if (single || KEY_SHAPE.test(tok.parts[0])) {
          keys.push({ key: tok.parts[0], line });
          got++;
        }
      } else if (single || /^[a-z][a-z0-9]*_/.test(tok.parts[0])) {
        const text = tok.parts.join('${…}');
        patterns.push({ re: new RegExp(`^${tok.parts.map(escapeRe).join('.+')}$`), text, line });
        got++;
      }
    }
    if (!got) dynamic++;
  }
  return { keys, patterns, dynamic };
}

/** Errore d'import leggibile: percorsi relativi al repository e, per i moduli mancanti, chi li cita. */
function describeImportError(file, e) {
  const clean = (s) => String(s).split(pathToFileURL(REPO).href + '/').join('').split(REPO + path.sep).join('').split(path.sep).join('/');
  if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
    return `${rel(file)}: non si importa perché manca un modulo — ${clean(e.message)}`;
  }
  const stack = clean((e && e.stack) || e).split('\n').slice(0, 6).join('\n    ');
  return `${rel(file)} lancia all'import:\n    ${stack}`;
}

async function loadTables() {
  const tables = {};
  for (const file of fs.existsSync(STRINGS) ? fs.readdirSync(STRINGS).filter((f) => f.endsWith('.js')).sort() : []) {
    const area = file.slice(0, -3);
    const mod = await import(pathToFileURL(path.join(STRINGS, file)).href);
    tables[area] = mod.default;
  }
  return tables;
}

const files = walk(SRC);
const codeFiles = files.filter((f) => !f.startsWith(path.join(SRC, 'i18n') + path.sep));

// ---------------------------------------------------------------------------------------------

test('esistono tutti i file della struttura di docs/WEB.md', () => {
  const missing = CONTRACT_FILES.filter((f) => !fs.existsSync(path.join(WEB, ...f.split('/'))));
  assert.equal(
    missing.length,
    0,
    `mancano ${missing.length} file previsti da docs/WEB.md:\n  ${missing.map((f) => `web/${f}`).join('\n  ')}`,
  );
});

test('gli import sono relativi, con estensione, verso file che esistono', () => {
  assert.ok(files.length > 0, 'nessun modulo in web/src');
  const problems = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const { found } = importsOf(src);
    for (const { spec, line } of found) {
      const where = `${rel(file)}:${line} → '${spec}'`;
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        problems.push(`${where}: import non relativo (niente pacchetti, URL o percorsi assoluti)`);
        continue;
      }
      if (!/\.m?js$/.test(spec)) {
        problems.push(`${where}: manca l'estensione .js`);
        continue;
      }
      const target = path.resolve(path.dirname(file), ...spec.split('/'));
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        problems.push(`${where}: il file ${rel(target)} non esiste`);
        continue;
      }
      // Windows e macOS perdonano le maiuscole, GitHub Pages no: si confronta con il nome vero
      const real = path.relative(REAL_REPO, fs.realpathSync.native(target)).split(path.sep).join('/');
      if (real !== rel(target)) problems.push(`${where}: maiuscole diverse dal file vero (${real})`);
    }
  }
  assert.equal(problems.length, 0, `${problems.length} import da correggere:\n  ${problems.join('\n  ')}`);
});

test('ogni modulo di web/src si importa in Node, senza DOM', async (tc) => {
  assert.ok(files.length > 0, 'nessun modulo in web/src');
  for (const file of files) {
    await tc.test(rel(file), { timeout: 15000 }, async () => {
      try {
        await import(pathToFileURL(file).href);
      } catch (e) {
        throw new Error(describeImportError(file, e));
      }
    });
  }
});

test('tabelle i18n: en e it con le stesse chiavi e il prefisso dell\'area', async () => {
  const tables = await loadTables();
  assert.ok(Object.keys(tables).length > 0, 'nessuna tabella in web/src/i18n/strings');
  const problems = [];
  for (const [area, table] of Object.entries(tables)) {
    const where = `i18n/strings/${area}.js`;
    if (!table || typeof table.en !== 'object' || typeof table.it !== 'object') {
      problems.push(`${where}: serve export default { en: {…}, it: {…} }`);
      continue;
    }
    const en = Object.keys(table.en);
    const it = Object.keys(table.it);
    const onlyEn = en.filter((k) => !(k in table.it));
    const onlyIt = it.filter((k) => !(k in table.en));
    if (onlyEn.length) problems.push(`${where}: solo in en: ${onlyEn.join(', ')}`);
    if (onlyIt.length) problems.push(`${where}: solo in it: ${onlyIt.join(', ')}`);
    // Le stringhe della stampante stanno in printer.js («prn» è un nome riservato di Windows), con prefisso prn_.
    const prefix = area === 'printer' ? 'prn' : area;
    const wrong = [...new Set([...en, ...it])].filter((k) => !k.startsWith(`${prefix}_`));
    if (wrong.length) problems.push(`${where}: chiavi senza il prefisso ${prefix}_: ${wrong.join(', ')}`);
    for (const l of ['en', 'it']) {
      const bad = Object.entries(table[l]).filter(([, v]) => typeof v !== 'string' || v === '').map(([k]) => k);
      if (bad.length) problems.push(`${where}: testi ${l} vuoti o non stringa: ${bad.join(', ')}`);
    }
  }
  assert.equal(problems.length, 0, problems.join('\n'));
});

test("le chiavi passate a t() esistono in en e in it", async () => {
  const tables = await loadTables();
  const en = new Set();
  const it = new Set();
  for (const table of Object.values(tables)) {
    if (table && table.en) Object.keys(table.en).forEach((k) => en.add(k));
    if (table && table.it) Object.keys(table.it).forEach((k) => it.add(k));
  }
  const problems = [];
  let checked = 0;
  for (const file of codeFiles) {
    const { keys, patterns } = translationCalls(fs.readFileSync(file, 'utf8'));
    for (const { key, line } of keys) {
      checked++;
      const miss = [!en.has(key) && 'en', !it.has(key) && 'it'].filter(Boolean);
      if (miss.length) problems.push(`${rel(file)}:${line}: t('${key}') manca in ${miss.join(' e ')}`);
    }
    for (const { re, text, line } of patterns) {
      checked++;
      const miss = [![...en].some((k) => re.test(k)) && 'en', ![...it].some((k) => re.test(k)) && 'it'].filter(Boolean);
      if (miss.length) problems.push(`${rel(file)}:${line}: t(\`${text}\`) non corrisponde a nessuna chiave in ${miss.join(' e ')}`);
    }
  }
  assert.equal(problems.length, 0, `${problems.length} chiavi su ${checked} non trovate:\n  ${problems.join('\n  ')}`);
});

// Chiavi passate in modo indiretto (messaggi di errore del PrinterManager, mappe di etichette):
// ogni stringa con il prefisso di un'area, come 'prn_err_busy', è una chiave e deve esistere.
test("le stringhe con il prefisso di un'area sono chiavi in en e in it", async () => {
  const tables = await loadTables();
  const areas = Object.keys(tables);
  assert.ok(areas.length > 0, 'nessuna tabella in web/src/i18n/strings');
  const shape = new RegExp(`^(?:${areas.map(escapeRe).join('|')})_[a-z0-9]+(?:_[a-z0-9]+)*$`);
  const en = new Set(Object.values(tables).flatMap((tb) => Object.keys((tb && tb.en) || {})));
  const it = new Set(Object.values(tables).flatMap((tb) => Object.keys((tb && tb.it) || {})));
  const problems = [];
  for (const file of codeFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const tok of scanJs(src).tokens) {
      if (tok.type !== 'str' || !shape.test(tok.value)) continue;
      const miss = [!en.has(tok.value) && 'en', !it.has(tok.value) && 'it'].filter(Boolean);
      if (miss.length) problems.push(`${rel(file)}:${lineOf(src, tok.start)}: '${tok.value}' manca in ${miss.join(' e ')}`);
    }
  }
  assert.equal(problems.length, 0, `${problems.length} chiavi indirette non trovate:\n  ${problems.join('\n  ')}`);
});
