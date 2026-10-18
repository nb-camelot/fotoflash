// Service worker di FotoFlash: l'app shell in una cache versionata, così l'app si apre anche offline.
// È un worker classico (niente import di moduli): la build di Pages sostituisce il segnaposto qui
// sotto con la versione di gradle.properties, e una versione nuova vuol dire una cache nuova.
const VERSION = '__FOTOFLASH_VERSION__';
const PREFIX = 'fotoflash-';
const CACHE = `${PREFIX}${VERSION}`;

// In locale il segnaposto resta: niente cache-first, altrimenti ogni modifica richiederebbe
// di svuotare la cache a mano. (Il confronto non ripete il segnaposto, che la build sostituirebbe.)
const DEV = VERSION.indexOf('__') === 0;

// Senza questi l'app non parte: se uno manca l'installazione fallisce e resta il SW precedente.
const CORE = [
  './',
  './index.html',
  './styles/app.css',
  './src/app.js',
];

// Il resto dell'app shell; un file assente (per esempio le icone PNG in locale) non blocca nulla.
const SHELL = [
  './manifest.webmanifest',
  './src/version.js',
  './src/core/model.js',
  './src/core/gray.js',
  './src/core/bitimage.js',
  './src/core/tone.js',
  './src/core/clahe.js',
  './src/core/backlight.js',
  './src/core/dither.js',
  './src/core/textmetrics.js',
  './src/core/template.js',
  './src/core/escpos.js',
  './src/core/bitmapfont.js',
  './src/printer/ble.js',
  './src/printer/manager.js',
  './src/printer/testpage.js',
  './src/printer/drivers/index.js',
  './src/printer/drivers/escpos.js',
  './src/printer/drivers/phomemo.js',
  './src/render/renderer.js',
  './src/render/bitmap.js',
  './src/render/fonts.js',
  './src/camera/camera.js',
  './src/camera/live.js',
  './src/media/import.js',
  './src/media/export.js',
  './src/media/zip.js',
  './src/store/settings.js',
  './src/store/history.js',
  './src/i18n/i18n.js',
  './src/i18n/strings/common.js',
  './src/i18n/strings/app.js',
  './src/i18n/strings/onb.js',
  './src/i18n/strings/set.js',
  './src/i18n/strings/printer.js',
  './src/i18n/strings/cam.js',
  './src/i18n/strings/ed.js',
  './src/i18n/strings/hist.js',
  './src/ui/dom.js',
  './src/ui/icons.js',
  './src/ui/components.js',
  './src/ui/router.js',
  './src/ui/print-sheet.js',
  './src/ui/sample-photo.js',
  './src/ui/screens/onboarding.js',
  './src/ui/screens/camera.js',
  './src/ui/screens/editor.js',
  './src/ui/screens/history.js',
  './src/ui/screens/history-detail.js',
  './src/ui/screens/settings.js',
  './src/ui/screens/printer.js',
  './fonts/righteous_regular.ttf',
  './fonts/space_mono_regular.ttf',
  './fonts/space_mono_bold.ttf',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './brand/icon.svg',
];

// Oltre questo tempo una rete lenta perde contro la copia in cache di index.html.
const NAV_TIMEOUT_MS = 3500;

async function put(cache, url) {
  // cache: 'reload' salta la cache HTTP (Pages tiene i file 10 minuti): si salva la versione nuova.
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await cache.put(url, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map((url) => put(cache, url)));
    const results = await Promise.allSettled(SHELL.map((url) => put(cache, url)));
    results.forEach((r) => {
      if (r.status === 'rejected') console.warn('[sw] non in cache:', r.reason && r.reason.message);
    });
    // Niente skipWaiting qui: la versione nuova aspetta il tocco su «Aggiorna» (messaggio SKIP_WAITING).
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)));
    if (self.registration.navigationPreload) {
      try {
        await self.registration.navigationPreload.enable();
      } catch {
        // non supportato: si va in rete normalmente
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

// L'app shell vera e propria: la cartella del sito o il suo index.html (con o senza ?query).
function isShellUrl(url) {
  const scope = new URL(self.registration.scope);
  return url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`;
}

function isShellPage(request, url) {
  return request.mode === 'navigate' || isShellUrl(url);
}

// Risposta della navigazione: quella già partita con il navigation preload, se c'è.
async function navigationResponse(event) {
  const preloaded = event.preloadResponse ? await event.preloadResponse.catch(() => null) : null;
  return preloaded || fetch(event.request);
}

// Pagine: prima la rete (così una versione nuova arriva subito), la cache se la rete manca o tarda.
// Solo l'app shell finisce sotto la chiave di index.html: un'altra pagina del sito aperta a mano
// (licenze, brand sheet) non deve sostituirla, altrimenti offline l'app non partirebbe più.
async function networkFirst(event, url) {
  const cache = await caches.open(CACHE);
  const shell = isShellUrl(url);
  let saved = Promise.resolve();
  const fromNetwork = navigationResponse(event).then((response) => {
    if (response.ok && response.type === 'basic' && !response.redirected) {
      saved = cache.put(shell ? './index.html' : event.request, response.clone());
    }
    return response;
  });
  // Il worker resta vivo finché la copia aggiornata non è salvata, anche se ha già risposto la cache.
  event.waitUntil(fromNetwork.then(() => saved).catch(() => {}));
  const fallback = async () => (shell
    ? (await cache.match('./index.html')) || (await cache.match('./'))
    : await cache.match(event.request, { ignoreSearch: true })) || Response.error();
  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAV_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([fromNetwork, slow]);
    if (first) return first;
    const cached = await fallback();
    // Se in cache non c'è niente, si aspetta comunque la rete.
    return cached.type === 'error' ? await fromNetwork : cached;
  } catch {
    return fallback();
  } finally {
    clearTimeout(timer);
    fromNetwork.catch(() => {});
  }
}

// Asset versionati: prima la cache; ciò che manca si scarica e si aggiunge.
async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok && response.type === 'basic') event.waitUntil(cache.put(event.request, response.clone()));
  return response;
}

// In sviluppo: sempre la rete, la cache solo per lavorare offline. Le navigazioni usano la
// richiesta del navigation preload, altrimenti partirebbero due volte (e Chrome lo segnala).
async function devNetworkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = event.request.mode === 'navigate' ? await navigationResponse(event) : await fetch(event.request);
    if (response.ok && response.type === 'basic') event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  } catch (e) {
    const cached = await cache.match(event.request, { ignoreSearch: true }) ||
      (event.request.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Solo GET della stessa origine; il resto lo gestisce il browser come se il SW non ci fosse.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (DEV) {
    event.respondWith(devNetworkFirst(event));
  } else if (isShellPage(request, url)) {
    event.respondWith(networkFirst(event, url));
  } else {
    event.respondWith(cacheFirst(event));
  }
});
