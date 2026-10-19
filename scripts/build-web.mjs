#!/usr/bin/env node
// Build del sito GitHub Pages della PWA (web/), senza dipendenze: solo Node e, per le icone PNG,
// rsvg-convert se c'è (in CI: sudo apt-get install -y librsvg2-bin).
//
//   node scripts/build-web.mjs <outDir> [--no-icons]
//
// Copia web/ (tranne tests/, dev-server.mjs, package.json), i font dell'app in fonts/, il brand
// sheet in brand/ e le licenze in licenses/; scrive src/version.js con VERSION_NAME di
// gradle.properties (+ "-" + sha corto se c'è GITHUB_SHA), mette la stessa versione nel nome della
// cache del service worker (__FOTOFLASH_VERSION__), genera le icone PNG da docs/brand/icon.svg e
// l'anteprima per i social icons/og.png (1200×630) da docs/brand/banner.svg, e alla fine verifica
// che esista ogni file citato da manifest, precache del SW, index.html e CSS. Nessuna risorsa da CDN.
// --no-icons salta le icone di proposito (build di controllo in CI) senza avvisi.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(REPO, 'web');
const FONT_DIR = path.join(REPO, 'app', 'src', 'main', 'res', 'font');
const BRAND_DIR = path.join(REPO, 'docs', 'brand');
const LICENSES_DIR = path.join(REPO, 'docs', 'licenses');
const ICON_SVG = path.join(BRAND_DIR, 'icon.svg');
const BANNER_SVG = path.join(BRAND_DIR, 'banner.svg');
const GRADLE_PROPERTIES = path.join(REPO, 'gradle.properties');

/** Voci di web/ che restano fuori dal sito pubblicato. */
const EXCLUDED = new Set(['tests', 'dev-server.mjs', 'package.json']);
/** File di sistema mai pubblicati, ovunque si trovino. */
const JUNK = new Set(['Thumbs.db', 'desktop.ini']);

export const VERSION_PLACEHOLDER = '__FOTOFLASH_VERSION__';
const FLASH = '#FFCC00';

/** Icone generate: le prime tre le elenca il manifest, apple-touch-icon la usa iOS (180 px). */
export const ICONS = [
  { file: 'icons/icon-192.png', size: 192, maskable: false },
  { file: 'icons/icon-512.png', size: 512, maskable: false },
  { file: 'icons/icon-maskable-512.png', size: 512, maskable: true },
  { file: 'icons/apple-touch-icon.png', size: 180, maskable: false },
];

/**
 * Anteprima per social e chat (og:image e twitter:image di index.html, con l'URL assoluto del sito):
 * il banner del brand riquadrato a 1200×630. Non è app shell: il service worker non la mette in cache.
 */
export const OG_IMAGE = { file: 'icons/og.png', width: 1200, height: 630 };
const PAPER = '#FBF8F1';

// Estensioni dei file che il sito serve: una stringa che finisce così, in sw.js, è un asset.
const ASSET_EXT = /\.(?:html?|m?js|css|webmanifest|json|svg|png|jpe?g|webp|gif|ico|ttf|otf|woff2?|txt|md|wasm)$/i;

// ---------------------------------------------------------------------------------------------
// Diagnostica: avvisi ed errori raccolti fino alla fine (in GitHub Actions diventano annotazioni).

const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
const warnings = [];
const errors = [];

function warn(msg) {
  warnings.push(msg);
  console.warn(IN_ACTIONS ? `::warning::${msg}` : `avviso: ${msg}`);
}

function fail(msg) {
  errors.push(msg);
  console.error(IN_ACTIONS ? `::error::${msg}` : `errore: ${msg}`);
}

/** Errore che interrompe subito la build (prerequisiti mancanti, uscita non sicura). */
class BuildError extends Error {}

// ---------------------------------------------------------------------------------------------
// Percorsi

/** Vero se `child` coincide con `parent` o sta dentro di lui (confronto giusto anche su Windows). */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Segna la cartella come build: è l'unica cartella non vuota che la build accetta di cancellare. */
export const BUILD_MARKER = '.fotoflash-web-build';

/**
 * La cartella di uscita viene cancellata e ricreata: mai il repository, una sua cartella sorgente o
 * un antenato, e mai una cartella piena che non sia una build precedente (un errore di battitura
 * non deve costare la home).
 */
export function checkOutDir(outDir) {
  if (isInside(REPO, outDir)) throw new BuildError(`cartella di uscita non valida: ${outDir} contiene il repository`);
  const sources = ['web', 'docs', 'app', 'core-thermal', 'scripts', 'gradle', 'signing', 'issue_plans', '.github', '.git'];
  for (const s of sources) {
    if (isInside(outDir, path.join(REPO, s))) {
      throw new BuildError(`cartella di uscita non valida: ${outDir} sta dentro ${s}/`);
    }
  }
  if (!fs.existsSync(outDir)) return;
  if (!fs.statSync(outDir).isDirectory()) throw new BuildError(`${outDir} esiste e non è una cartella`);
  const entries = fs.readdirSync(outDir);
  if (entries.length && !entries.includes(BUILD_MARKER)) {
    throw new BuildError(`${outDir} non è vuota e non è una build precedente (manca ${BUILD_MARKER}): svuotala o scegline un'altra`);
  }
}

function rel(p) {
  return path.relative(REPO, p).split(path.sep).join('/') || '.';
}

// ---------------------------------------------------------------------------------------------
// Copia

function copyTree(src, dst, { skipTop = new Set() } = {}, top = true) {
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (top && skipTop.has(entry.name)) continue;
    // niente file nascosti (.DS_Store, .gitkeep…) e niente spazzatura del sistema operativo
    if (entry.name.startsWith('.') || JUNK.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) count += copyTree(from, to, {}, false);
    else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      count++;
    }
  }
  return count;
}

function copyFonts(dist) {
  const fonts = fs.existsSync(FONT_DIR) ? fs.readdirSync(FONT_DIR).filter((f) => f.toLowerCase().endsWith('.ttf')) : [];
  if (!fonts.length) throw new BuildError(`nessun font .ttf in ${rel(FONT_DIR)}`);
  const out = path.join(dist, 'fonts');
  fs.mkdirSync(out, { recursive: true });
  for (const f of fonts) fs.copyFileSync(path.join(FONT_DIR, f), path.join(out, f));
  return fonts.length;
}

// ---------------------------------------------------------------------------------------------
// Versione

/** VERSION_NAME di gradle.properties, più "-" e lo sha corto se GITHUB_SHA è un hash git. */
export function readVersion(env = process.env) {
  const text = fs.readFileSync(GRADLE_PROPERTIES, 'utf8');
  const m = /^\s*VERSION_NAME\s*=\s*(\S+)\s*$/m.exec(text);
  if (!m) throw new BuildError('VERSION_NAME non trovato in gradle.properties');
  const name = m[1];
  if (!/^[0-9A-Za-z.+-]+$/.test(name)) throw new BuildError(`VERSION_NAME non valido: ${name}`);
  const sha = String(env.GITHUB_SHA || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? `${name}-${sha.slice(0, 7).toLowerCase()}` : name;
}

/** Riscrive VERSION in src/version.js lasciando intatto il resto del file. */
function writeVersion(dist, version) {
  const file = path.join(dist, 'src', 'version.js');
  const line = `export const VERSION = '${version}';`; // version ha solo [0-9A-Za-z.+-]
  const decl = /export\s+const\s+VERSION\s*=\s*(['"`])(?:\\.|(?!\1).)*\1\s*;?/;
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    if (decl.test(text)) {
      fs.writeFileSync(file, text.replace(decl, line));
      return;
    }
    fail('src/version.js non dichiara `export const VERSION = \'…\'` (contratto di docs/WEB.md): riscritto da capo, va corretto');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `// Versione mostrata nelle impostazioni, scritta da scripts/build-web.mjs (gradle.properties + commit).\n${line}\n`,
  );
}

/** Mette la versione nel nome della cache del SW: un SW diverso a ogni build fa aggiornare l'app installata. */
function stampServiceWorker(dist, version) {
  const file = path.join(dist, 'sw.js');
  if (!fs.existsSync(file)) {
    fail('manca sw.js: senza service worker la PWA non funziona offline');
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  const count = text.split(VERSION_PLACEHOLDER).length - 1;
  if (count === 0) {
    fail(`sw.js non contiene ${VERSION_PLACEHOLDER}: il nome della cache non cambierebbe tra una versione e l'altra`);
    return;
  }
  fs.writeFileSync(file, text.split(VERSION_PLACEHOLDER).join(version));
}

// ---------------------------------------------------------------------------------------------
// Icone

/**
 * Icona maskable: l'icona del brand ridotta all'80% e centrata su un quadrato pieno Flash, così il
 * foglietto resta dentro la zona sicura (cerchio di raggio 40%) qualunque forma usi il launcher.
 */
export function maskableSvg(iconSvg) {
  const open = /<svg\b[^>]*>/i.exec(iconSvg);
  const close = iconSvg.lastIndexOf('</svg>');
  if (!open || close < 0) throw new BuildError('docs/brand/icon.svg non è un SVG valido');
  const vb = /\bviewBox\s*=\s*"([^"]+)"/i.exec(open[0]);
  const viewBox = vb ? vb[1].trim() : '0 0 512 512';
  const inner = iconSvg.slice(open.index + open[0].length, close);
  // stesso giallo dell'icona, se il primo rettangolo ne dichiara uno
  const fill = /<rect\b[^>]*\bfill\s*=\s*"(#[0-9a-f]{3,8})"/i.exec(inner);
  const bg = fill ? fill[1] : FLASH;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="512" height="512">',
    `<rect width="100" height="100" fill="${bg}"/>`,
    `<svg x="10" y="10" width="80" height="80" viewBox="${viewBox}">${inner}</svg>`,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * Immagine Open Graph: il banner (1280×640, 2:1) dentro 1200×630 (1,9:1) senza deformarsi e senza
 * tagli (`meet`): le due fasce di 15 px sopra e sotto hanno il fondo del banner, quindi non si vedono.
 * Con `slice` lo scontrino e il puntino sul bordo destro restavano tagliati.
 */
export function ogSvg(bannerSvg, { width = OG_IMAGE.width, height = OG_IMAGE.height } = {}) {
  const open = /<svg\b[^>]*>/i.exec(bannerSvg);
  const close = bannerSvg.lastIndexOf('</svg>');
  if (!open || close < 0) throw new BuildError('docs/brand/banner.svg non è un SVG valido');
  const vb = /\bviewBox\s*=\s*"([^"]+)"/i.exec(open[0]);
  const viewBox = vb ? vb[1].trim() : '0 0 1280 640';
  const inner = bannerSvg.slice(open.index + open[0].length, close);
  const fill = /<rect\b[^>]*\bfill\s*=\s*"(#[0-9a-f]{3,8})"/i.exec(inner);
  const bg = fill ? fill[1] : PAPER;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="${bg}"/>`,
    `<svg x="0" y="0" width="${width}" height="${height}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`,
    '</svg>',
    '',
  ].join('\n');
}

/** Larghezza e altezza dall'intestazione IHDR di un PNG, o null se il file non è un PNG. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Una PNG da un SVG con rsvg-convert, controllandone le misure. */
function renderPng(dist, file, src, width, height) {
  const out = path.join(dist, ...file.split('/'));
  const run = spawnSync(
    'rsvg-convert',
    ['-w', String(width), '-h', String(height), '-f', 'png', '-o', out, src],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    fail(`rsvg-convert non ha generato ${file}: ${(run.stderr || run.error?.message || '').trim()}`);
    return;
  }
  const size = fs.existsSync(out) ? pngSize(out) : null;
  if (!size || size.width !== width || size.height !== height) {
    fail(`${file}: atteso un PNG ${width}×${height}, ottenuto ${size ? `${size.width}×${size.height}` : 'altro'}`);
  }
}

/**
 * Genera le PNG con rsvg-convert: le icone da docs/brand/icon.svg e l'anteprima per i social
 * (icons/og.png) da docs/brand/banner.svg. Restituisce i percorsi non generati.
 */
function buildIcons(dist, { skip }) {
  const skipped = new Set();
  if (skip) {
    for (const icon of ICONS) skipped.add(icon.file);
    skipped.add(OG_IMAGE.file);
    console.log('icone: saltate (--no-icons)');
    return skipped;
  }
  const probe = spawnSync('rsvg-convert', ['--version'], { encoding: 'utf8' });
  if (probe.error) {
    for (const icon of ICONS) skipped.add(icon.file);
    skipped.add(OG_IMAGE.file);
    warn(
      'rsvg-convert non trovato: icone PNG e anteprima per i social (icons/og.png) non generate ' +
        '(in CI: sudo apt-get install -y librsvg2-bin). Il sito funziona, ma senza le PNG la PWA non è ' +
        'installabile ovunque e i link condivisi non hanno l\'immagine.',
    );
    return skipped;
  }
  const iconSvg = fs.readFileSync(ICON_SVG, 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fotoflash-icons-'));
  try {
    const maskable = path.join(tmp, 'icon-maskable.svg');
    fs.writeFileSync(maskable, maskableSvg(iconSvg));
    fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
    for (const icon of ICONS) {
      renderPng(dist, icon.file, icon.maskable ? maskable : ICON_SVG, icon.size, icon.size);
    }
    if (fs.existsSync(BANNER_SVG)) {
      const og = path.join(tmp, 'og.svg');
      fs.writeFileSync(og, ogSvg(fs.readFileSync(BANNER_SVG, 'utf8')));
      renderPng(dist, OG_IMAGE.file, og, OG_IMAGE.width, OG_IMAGE.height);
    } else {
      skipped.add(OG_IMAGE.file);
      warn(`manca ${rel(BANNER_SVG)}: niente anteprima per i social (${OG_IMAGE.file})`);
    }
    console.log(`icone: ${ICONS.length} PNG e l'anteprima ${OG_IMAGE.width}×${OG_IMAGE.height} generate con ${probe.stdout.trim().split('\n')[0]}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return skipped;
}

// ---------------------------------------------------------------------------------------------
// Lettura del JavaScript: commenti tolti e letterali stringa, quanto basta per sw.js.

const REGEX_AFTER = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Valori delle stringhe letterali ('…', "…" e `…` senza ${}) fuori dai commenti. Le regex letterali
 * vengono saltate, così un apice dentro una regex non apre una stringa finta.
 */
export function stringLiterals(src) {
  const out = [];
  const n = src.length;
  const stack = []; // template aperti con ${: profondità delle graffe nell'espressione
  let prev = '';
  let i = 0;

  const readTemplate = (tpl) => {
    let value = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        value += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        tpl.parts.push(value);
        if (tpl.parts.length === 1) out.push(tpl.parts[0]);
        prev = 'lit';
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        tpl.parts.push(value);
        stack.push({ tpl, depth: 0 });
        prev = '{';
        return;
      }
      value += c;
      i++;
    }
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
        i++;
        readTemplate(top.tpl);
        continue;
      }
      prev = c;
      i++;
      continue;
    }
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let value = '';
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') {
          value += src[i + 1] ?? '';
          i += 2;
        } else value += src[i++];
      }
      i++;
      out.push(value);
      prev = 'lit';
      continue;
    }
    if (c === '`') {
      i++;
      readTemplate({ parts: [] });
      continue;
    }
    if (c === '/') {
      if (prev === '' || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || REGEX_AFTER.has(prev)) {
        // regex letterale: fino alla / di chiusura fuori da una classe [...]
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
  return out;
}

/**
 * Stringhe di sw.js che sembrano file del sito: "./…" oppure un nome relativo con estensione web.
 * Quelle che cominciano con "/" sono confronti sul pathname (es. endsWith('/sw.js')), non precache.
 */
export function precacheEntries(swSource) {
  const found = new Set();
  for (const s of stringLiterals(swSource)) {
    if (!s || /\s/.test(s) || s.startsWith('/')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) continue; // URL assoluti
    const p = s.replace(/[?#].*$/, '');
    if (s === './' || s === '.' || p.startsWith('./') || p.startsWith('../')) found.add(s);
    else if (ASSET_EXT.test(p) && /^[\w-][\w./-]*$/.test(p)) found.add(s);
  }
  return [...found];
}

// ---------------------------------------------------------------------------------------------
// Verifica del sito

/**
 * Risolve un riferimento locale rispetto alla cartella del file che lo cita.
 * → { skip } per URL esterni e ancore, { error } per percorsi assoluti o fuori dal sito, { file } altrimenti.
 */
function resolveRef(dist, fromDir, ref) {
  const raw = String(ref || '').trim();
  if (!raw || raw.startsWith('#')) return { skip: true };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return { skip: true };
  if (raw.startsWith('/')) return { error: 'percorso assoluto: il sito vive sotto /fotoflash/, servono percorsi relativi' };
  let p = raw.replace(/[?#].*$/, '');
  try {
    p = decodeURI(p);
  } catch {
    return { error: 'percorso con codifica non valida' };
  }
  if (p === '' || p === '.' || p.endsWith('/')) p += (p === '.' ? '/' : '') + 'index.html';
  const file = path.resolve(fromDir, ...p.split('/'));
  if (!isInside(file, dist)) return { error: 'percorso fuori dal sito' };
  return { file };
}

function checkRefs(dist, where, refs, { iconSkipped, fromDir = dist }) {
  let ok = 0;
  for (const ref of refs) {
    const r = resolveRef(dist, fromDir, ref);
    if (r.skip) continue;
    if (r.error) {
      fail(`${where}: "${ref}" — ${r.error}`);
      continue;
    }
    const relPath = path.relative(dist, r.file).split(path.sep).join('/');
    if (fs.existsSync(r.file) && fs.statSync(r.file).isFile()) {
      ok++;
    } else if (iconSkipped.has(relPath)) {
      // icona che non si è potuta generare: già segnalata
    } else {
      fail(`${where}: "${ref}" non esiste nel sito (${relPath})`);
    }
  }
  return ok;
}

/** Riferimenti locali in index.html: src e href di script, link, img, meta… */
function htmlRefs(html) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const refs = [];
  const re = /\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (let m; (m = re.exec(noComments)); ) refs.push(m[1] ?? m[2]);
  return refs;
}

/** Riferimenti url(…) di un foglio di stile (font, immagini), relativi al file CSS stesso. */
function cssRefs(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const refs = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
  for (let m; (m = re.exec(noComments)); ) refs.push(m[1] ?? m[2] ?? m[3]);
  return refs;
}

/** File del sito con quell'estensione, cartelle in `skipTop` escluse (solo al primo livello). */
function filesWithExt(dir, ext, skipTop = new Set(), out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipTop.has(entry.name)) filesWithExt(full, ext, new Set(), out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) out.push(full);
  }
  return out;
}

function manifestRefs(manifest) {
  const refs = [];
  const icons = (list) => (Array.isArray(list) ? list.forEach((i) => i && i.src && refs.push(i.src)) : undefined);
  icons(manifest.icons);
  icons(manifest.screenshots);
  if (Array.isArray(manifest.shortcuts)) {
    for (const s of manifest.shortcuts) {
      if (!s) continue;
      if (s.url) refs.push(s.url);
      icons(s.icons);
    }
  }
  if (manifest.start_url) refs.push(manifest.start_url);
  return refs;
}

function verifySite(dist, iconSkipped) {
  // manifest
  const manifestFile = path.join(dist, 'manifest.webmanifest');
  if (!fs.existsSync(manifestFile)) fail('manca manifest.webmanifest');
  else {
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (e) {
      fail(`manifest.webmanifest non è JSON valido: ${e.message}`);
    }
    if (manifest) {
      const n = checkRefs(dist, 'manifest.webmanifest', manifestRefs(manifest), { iconSkipped });
      console.log(`manifest: ${n} riferimenti verificati`);
    }
  }

  // precache del service worker
  const swFile = path.join(dist, 'sw.js');
  if (fs.existsSync(swFile)) {
    const entries = precacheEntries(fs.readFileSync(swFile, 'utf8'));
    if (!entries.length) fail('sw.js: nessun file da mettere in cache riconosciuto (atteso un elenco di stringhe come "./index.html")');
    const n = checkRefs(dist, 'sw.js', entries, { iconSkipped });
    console.log(`precache del SW: ${n} file verificati`);
    // Un modulo fuori dalla precache arriva in cache solo se è stato caricato almeno una volta online.
    const cached = new Set();
    for (const e of entries) {
      const r = resolveRef(dist, dist, e);
      if (r.file) cached.add(path.relative(dist, r.file).split(path.sep).join('/'));
    }
    const srcDir = path.join(dist, 'src');
    const modules = fs.existsSync(srcDir)
      ? filesWithExt(srcDir, '.js').map((f) => path.relative(dist, f).split(path.sep).join('/'))
      : [];
    if (!modules.length) fail('src/: nessun modulo .js nel sito');
    const missing = modules.filter((f) => !cached.has(f)).sort();
    if (missing.length) warn(`sw.js: ${missing.length} moduli non sono nella precache (offline mancano finché non si aprono online): ${missing.join(', ')}`);
  }

  // app shell
  const indexFile = path.join(dist, 'index.html');
  if (!fs.existsSync(indexFile)) fail('manca index.html');
  else {
    const n = checkRefs(dist, 'index.html', htmlRefs(fs.readFileSync(indexFile, 'utf8')), { iconSkipped });
    console.log(`index.html: ${n} riferimenti verificati`);
  }

  // fogli di stile: i font di @font-face sono relativi al CSS (../fonts/…), non alla radice
  let cssOk = 0;
  for (const file of filesWithExt(dist, '.css', new Set(['brand']))) {
    const where = path.relative(dist, file).split(path.sep).join('/');
    cssOk += checkRefs(dist, where, cssRefs(fs.readFileSync(file, 'utf8')), { iconSkipped, fromDir: path.dirname(file) });
  }
  console.log(`CSS: ${cssOk} riferimenti verificati`);
}

/** File pubblicati e dimensione totale (i file nascosti, come il marcatore, restano fuori dal sito). */
function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = dirStats(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files++;
      bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

// ---------------------------------------------------------------------------------------------

export function build(outArg, { noIcons = false, env = process.env } = {}) {
  // ogni build ha la sua diagnostica, anche se un test ne lancia più d'una nello stesso processo
  warnings.length = 0;
  errors.length = 0;
  const dist = path.resolve(outArg);
  checkOutDir(dist);
  if (!fs.existsSync(ICON_SVG)) throw new BuildError(`manca ${rel(ICON_SVG)}`);

  const version = readVersion(env);
  console.log(`FotoFlash web ${version} → ${dist}`);

  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  // file nascosti: upload-pages-artifact li lascia fuori dal sito. Il .gitignore tiene fuori da git
  // una build fatta dentro il repository (node scripts/build-web.mjs dist).
  fs.writeFileSync(path.join(dist, BUILD_MARKER), 'Cartella generata da scripts/build-web.mjs: viene cancellata a ogni build.\n');
  fs.writeFileSync(path.join(dist, '.gitignore'), '*\n');
  const copied = copyTree(WEB, dist, { skipTop: EXCLUDED });
  const fonts = copyFonts(dist);
  const brand = copyTree(BRAND_DIR, path.join(dist, 'brand'));
  const licenses = copyTree(LICENSES_DIR, path.join(dist, 'licenses'));
  console.log(`copiati: web ${copied}, font ${fonts}, brand ${brand}, licenze ${licenses}`);

  writeVersion(dist, version);
  stampServiceWorker(dist, version);
  const iconSkipped = buildIcons(dist, { skip: noIcons });
  verifySite(dist, iconSkipped);

  const { files, bytes } = dirStats(dist);
  console.log(`sito: ${files} file, ${(bytes / 1024).toFixed(0)} KiB`);
  return { dist, version, errors: [...errors], warnings: [...warnings] };
}

function main(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  const unknown = [...flags].filter((f) => f !== '--no-icons');
  if (positional.length !== 1 || unknown.length) {
    console.error('uso: node scripts/build-web.mjs <outDir> [--no-icons]');
    return 2;
  }
  try {
    const result = build(positional[0], { noIcons: flags.has('--no-icons') });
    if (result.errors.length) {
      console.error(`build NON valida: ${result.errors.length} errori, ${result.warnings.length} avvisi`);
      return 1;
    }
    console.log(`build pronta: ${result.version}${result.warnings.length ? ` (${result.warnings.length} avvisi)` : ''}`);
    return 0;
  } catch (e) {
    if (e instanceof BuildError) {
      console.error(IN_ACTIONS ? `::error::${e.message}` : `errore: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

/** Vero se il file è lo script lanciato da riga di comando (non quando lo importa un test). */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(process.argv[1]);
    const b = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main(process.argv);
