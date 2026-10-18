// Server statico per lo sviluppo locale della PWA, senza dipendenze:
//
//   node web/dev-server.mjs            → http://127.0.0.1:5173/
//   PORT=8080 node web/dev-server.mjs  (HOST cambia l'indirizzo d'ascolto)
//
// Serve web/ e, come farà il sito pubblicato, /fonts/ da app/src/main/res/font, /brand/ da docs/brand
// e /licenses/ da docs/licenses. Le icone PNG qui mancano (le genera la build): il browser usa l'SVG.
// sw.js resta com'è: con il segnaposto della versione il service worker va sempre in rete.
// 127.0.0.1 è un contesto sicuro, quindi fotocamera e Web Bluetooth funzionano senza HTTPS.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(WEB, '..');

// Prefisso URL → cartella del repository; il primo che combacia vince, '/' è web/.
const MOUNTS = [
  ['/fonts/', path.join(REPO, 'app', 'src', 'main', 'res', 'font')],
  ['/brand/', path.join(REPO, 'docs', 'brand')],
  ['/licenses/', path.join(REPO, 'docs', 'licenses')],
  ['/', WEB],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** Content-Type dall'estensione; il resto come binario generico. */
export function contentType(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * File del repository per un pathname URL già decodificato, o null se esce dalla sua cartella
 * (../, backslash, lettere di unità…): path.relative regge anche le maiuscole di Windows.
 */
export function resolveRequest(pathname) {
  if (pathname.includes('\0')) return null;
  for (const [prefix, base] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    const target = path.resolve(base, ...rest.split('/').filter(Boolean));
    const rel = path.relative(base, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return target;
  }
  return null;
}

function send(res, status, body, headers = {}) {
  const data = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : data);
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Metodo non consentito\n', { Allow: 'GET, HEAD' });
    return 405;
  }
  let pathname;
  try {
    const url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    send(res, 400, 'Richiesta non valida\n');
    return 400;
  }
  // /brand → /brand/, come per le cartelle vere
  if (MOUNTS.some(([prefix]) => prefix !== '/' && pathname === prefix.slice(0, -1))) {
    send(res, 301, `${pathname}/\n`, { Location: `${pathname}/` });
    return 301;
  }
  const file = resolveRequest(pathname);
  if (!file) {
    send(res, 403, 'Vietato\n');
    return 403;
  }

  let target = file;
  let stat = await fs.promises.stat(target).catch(() => null);
  if (stat && stat.isDirectory()) {
    // come Pages: /cartella → /cartella/, e /cartella/ → index.html
    if (!pathname.endsWith('/')) {
      const location = `${new URL(req.url, 'http://localhost').pathname}/`;
      send(res, 301, `${location}\n`, { Location: location });
      return 301;
    }
    target = path.join(target, 'index.html');
    stat = await fs.promises.stat(target).catch(() => null);
  }
  if (!stat || !stat.isFile()) {
    send(res, 404, `Non trovato: ${pathname}\n`);
    return 404;
  }

  res.writeHead(200, {
    'Content-Type': contentType(target),
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return 200;
  }
  await new Promise((resolve) => {
    const stream = fs.createReadStream(target);
    stream.on('error', () => res.destroy());
    stream.on('close', resolve);
    stream.pipe(res);
  });
  return 200;
}

/** Avvia il server; restituisce l'http.Server (utile ai test). */
export function startDevServer({ host = '127.0.0.1', port = 5173, quiet = false } = {}) {
  const server = http.createServer((req, res) => {
    handle(req, res).then(
      (status) => {
        if (!quiet) console.log(`${status} ${req.method} ${req.url}`);
      },
      (e) => {
        console.error(`errore su ${req.url}:`, e);
        if (!res.headersSent) send(res, 500, 'Errore interno\n');
        else res.destroy();
      },
    );
  });
  server.listen(port, host);
  return server;
}

function main() {
  const host = process.env.HOST || '127.0.0.1';
  const port = process.env.PORT === undefined || process.env.PORT === '' ? 5173 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT non valida: ${process.env.PORT}`);
    process.exitCode = 2;
    return;
  }
  const server = startDevServer({ host, port });
  server.on('listening', () => {
    const { port: actual } = server.address();
    const shown = host.includes(':') ? `[${host}]` : host;
    console.log(`FotoFlash web: http://${shown}:${actual}/  (Ctrl+C per fermare)`);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`porta ${port} occupata: avvia con PORT=<altra porta>`);
    else console.error(e.message);
    process.exitCode = 1;
  });
}

// Eseguito come script, non quando lo importa un test.
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

if (invokedDirectly()) main();
