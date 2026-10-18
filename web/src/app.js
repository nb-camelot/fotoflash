// Avvio di FotoFlash web: contesto condiviso, router, service worker, installazione e aggiornamenti.
import { VERSION } from './version.js';
import { t, lang, onLangChange } from './i18n/i18n.js';
import { settings } from './store/settings.js';
import { history as historyStore } from './store/history.js';
import { PrinterManager } from './printer/manager.js';
import { createRouter } from './ui/router.js';
import { h, clear } from './ui/dom.js';
import { toast, flashButton } from './ui/components.js';
import { brandMark } from './ui/icons.js';

// Le schermate si caricano quando servono: la prima si apre prima e un modulo rotto non spegne le altre.
const ROUTES = {
  '/onboarding': () => import('./ui/screens/onboarding.js'),
  '/camera': () => import('./ui/screens/camera.js'),
  '/editor': () => import('./ui/screens/editor.js'),
  '/history': () => import('./ui/screens/history.js'),
  '/history/:id': () => import('./ui/screens/history-detail.js'),
  '/settings': () => import('./ui/screens/settings.js'),
  '/printer': () => import('./ui/screens/printer.js'),
};

// Colore della barra di sistema per schermata: il mirino è sempre scuro, l'onboarding sempre chiaro.
const ROUTE_THEME = { camera: '#0E0C0A', onboarding: '#FBF8F1' };
const INSTALL_NUDGE_KEY = 'fotoflash.installNudge';
const INSTALL_NUDGE_EVERY_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;

/** Foto in lavorazione tra fotocamera/galleria ed editor. */
function createSession() {
  const listeners = new Set();
  const session = {
    photos: [],
    source: 'camera',
    suggestedTemplate: null,
    /** set({ photos, source, suggestedTemplate }) oppure set(photos, source, suggestedTemplate). */
    set(patchOrPhotos, source, suggestedTemplate) {
      if (Array.isArray(patchOrPhotos)) {
        session.photos = patchOrPhotos;
        session.source = source || 'camera';
        session.suggestedTemplate = suggestedTemplate || null;
      } else if (patchOrPhotos && typeof patchOrPhotos === 'object') {
        for (const key of ['photos', 'source', 'suggestedTemplate']) {
          if (key in patchOrPhotos) session[key] = patchOrPhotos[key];
        }
        if (!Array.isArray(session.photos)) session.photos = [];
      }
      notify();
    },
    clear() {
      session.photos = [];
      session.source = 'camera';
      session.suggestedTemplate = null;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  function notify() {
    for (const fn of [...listeners]) {
      try {
        fn(session);
      } catch (e) {
        console.error(e);
      }
    }
  }
  return session;
}

function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true;
}

/** Invito all'installazione (beforeinstallprompt di Chrome/Edge). */
function createInstall() {
  let deferred = null;
  let installed = isStandalone();
  const listeners = new Set();
  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  };
  window.addEventListener('beforeinstallprompt', (event) => {
    // Niente mini-barra del browser: l'invito lo fa l'app, al momento giusto.
    event.preventDefault();
    deferred = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
    toast(t('app_installed'));
    keepStorage();
  });
  return {
    available: () => !!deferred && !installed,
    installed: () => installed || isStandalone(),
    async prompt() {
      if (!deferred) return 'unavailable';
      const event = deferred;
      deferred = null;
      notify();
      try {
        await event.prompt();
        const choice = await event.userChoice;
        return choice && choice.outcome ? choice.outcome : 'dismissed';
      } catch (e) {
        console.warn('[install] richiesta non riuscita', e);
        return 'unavailable';
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Chiede di non sfrattare storico e foto quando lo spazio scarseggia (concesso alle app installate). */
function keepStorage() {
  const storage = navigator.storage;
  if (!storage || typeof storage.persist !== 'function') return;
  storage.persisted()
    .then((done) => (done ? true : storage.persist()))
    .catch(() => {});
}

function applyThemeColor(routeName) {
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const forced = ROUTE_THEME[routeName];
  metas.forEach((meta) => {
    if (!meta.dataset.base) meta.dataset.base = meta.getAttribute('content') || '';
    meta.setAttribute('content', forced || meta.dataset.base);
  });
}

function readNumber(key) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeNumber(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // vale solo per questa visita
  }
}

function isLocalHost() {
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

/** Service worker: offline, e l'avviso "nuova versione" con Aggiorna (mai a metà di una stampa). */
function registerServiceWorker(ctx, whenOutsideOnboarding) {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && !isLocalHost()) return;
  const sw = navigator.serviceWorker;
  const firstInstall = !sw.controller;
  let updateRequested = false;
  let reloading = false;
  let offered = null;

  sw.addEventListener('controllerchange', () => {
    // Al primo avvio il SW prende il controllo da solo: si ricarica solo se l'ha chiesto l'utente.
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload();
  });

  function activate(worker) {
    const send = () => {
      updateRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
    // Anche durante la connessione il lavoro e gia partito: ricaricare ora lo perderebbe.
    const busy = (s) => !!s && (s.kind === 'printing' || s.kind === 'connecting');
    if (busy(ctx.printer.state)) {
      toast(t('app_update_after_print'));
      let done = false;
      let off = null;
      off = ctx.printer.subscribe((state) => {
        if (done || !state || busy(state)) return;
        done = true;
        if (typeof off === 'function') off();
        send();
      });
    } else {
      send();
    }
  }

  // Durante l'onboarding l'avviso fisso coprirebbe il pulsante principale: arriva dopo.
  function offer(worker) {
    whenOutsideOnboarding(() => {
      if (offered) return;
      offered = toast(t('app_update_available'), {
        actionText: t('app_update_action'),
        duration: 0,
        onAction: () => activate(worker),
      });
    });
  }

  sw.register('./sw.js', { scope: './' }).then((reg) => {
    if (reg.waiting && sw.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state !== 'installed') return;
        if (sw.controller) offer(worker);
        else if (firstInstall) whenOutsideOnboarding(() => toast(t('app_offline_ready')));
      });
    });
    // Le app installate restano aperte a lungo: ogni tanto si controlla se c'è una versione nuova.
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_EVERY_MS) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    });
  }).catch((e) => console.warn('[sw] registrazione non riuscita', e));
}

function bootError(root, error) {
  console.error('[app] avvio non riuscito', error);
  clear(root);
  root.appendChild(h('div', { class: 'ff-boot-error', role: 'alert' },
    brandMark({ size: 96 }),
    h('h1', { class: 'ff-empty__title' }, t('app_boot_error_title')),
    h('p', { class: 'ff-muted' }, t('app_boot_error_body')),
    flashButton(t('app_reload'), { icon: 'refresh', onClick: () => location.reload() })));
  document.documentElement.dataset.ffBooted = 'error';
}

/** Monta l'app nel contenitore #app di index.html. */
export function boot() {
  const root = document.getElementById('app');
  try {
    document.documentElement.lang = lang();
    const printer = new PrinterManager(settings);
    const install = createInstall();
    const ctx = {
      settings,
      history: historyStore,
      printer,
      session: createSession(),
      router: null,
      t,
      install,
      version: VERSION,
    };

    // Rotta iniziale: il primo avvio passa sempre dall'onboarding.
    const hash = location.hash.replace(/^#/, '');
    if (!settings.get().onboardingDone) {
      if (hash !== '/onboarding') window.history.replaceState(null, '', '#/onboarding');
    } else if (!hash || hash === '/') {
      window.history.replaceState(null, '', '#/camera');
    }

    // Azioni rimandate a quando si esce dall'onboarding (invito all'installazione, avvisi).
    const deferred = [];
    const whenOutsideOnboarding = (fn) => {
      const route = ctx.router && ctx.router.current();
      if (route && route.name !== 'onboarding' && settings.get().onboardingDone) fn();
      else deferred.push(fn);
    };

    let nudgeArmed = false;
    const nudgeInstall = () => {
      if (nudgeArmed || !install.available()) return;
      if (Date.now() - readNumber(INSTALL_NUDGE_KEY) < INSTALL_NUDGE_EVERY_MS) return;
      nudgeArmed = true;
      whenOutsideOnboarding(() => setTimeout(() => {
        if (!install.available()) return;
        writeNumber(INSTALL_NUDGE_KEY, Date.now());
        toast(t('app_install_prompt'), {
          actionText: t('app_install_action'),
          onAction: () => install.prompt(),
          duration: 10000,
        });
      }, 3000));
    };
    install.subscribe(nudgeInstall);

    const router = createRouter(root, ROUTES, ctx, {
      fallback: '/camera',
      onChange: (route) => {
        document.documentElement.dataset.ffBooted = '1';
        applyThemeColor(route.name);
        if (route.name !== 'onboarding' && settings.get().onboardingDone) {
          deferred.splice(0).forEach((fn) => fn());
        }
      },
    });
    ctx.router = router;

    onLangChange((next) => {
      document.documentElement.lang = next;
      router.refresh();
    });

    registerServiceWorker(ctx, whenOutsideOnboarding);
    if (install.installed()) keepStorage();
  } catch (e) {
    bootError(root, e);
  }
}

// Nel browser parte da solo; importato in Node (test degli import) non fa nulla.
if (typeof document !== 'undefined' && document.getElementById('app')) boot();
