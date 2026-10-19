// Avvio di FotoFlash web: contesto condiviso, router, service worker, installazione e aggiornamenti.
// Tre modi, decisi all'avvio:
// - app: telefono, finestra stretta o app installata, come sempre (più la rotta #/landing);
// - desktop: schermo largo nel browser, con la presentazione (landing) e il "palcoscenico", cioè l'app
//   dentro una cornice di telefono. La cornice è un iframe della stessa pagina: l'app ci gira con le
//   misure di un telefono vero (altezze, avvisi, dialoghi), senza ritocchi alle schermate;
// - incorniciata: l'app dentro quell'iframe, che parla con la pagina che la ospita.
import { VERSION } from './version.js';
import {
  t, textLang, ready as langReady, setLang, langSetting, onLangChange, watchLangStorage, LANGS, LANG_NAMES,
} from './i18n/i18n.js';
import { settings } from './store/settings.js';
import { history as historyStore } from './store/history.js';
import { PrinterManager } from './printer/manager.js';
import { createRouter } from './ui/router.js';
import { h, clear } from './ui/dom.js';
import { toast, flashButton, ghostButton, chipsRow } from './ui/components.js';
import { brandMark, wordmark } from './ui/icons.js';
import { shouldShowLanding } from './landing/gate.js';

// La presentazione si scarica solo quando serve: sul telefono di solito mai.
const loadLanding = () => import('./landing/landing.js');

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

// Colore della barra di sistema per schermata: il mirino è sempre scuro, onboarding e presentazione
// sempre chiari.
const ROUTE_THEME = { camera: '#0E0C0A', onboarding: '#FBF8F1', landing: '#FBF8F1' };
const INSTALL_NUDGE_KEY = 'fotoflash.installNudge';
const INSTALL_NUDGE_EVERY_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;

// Messaggi tra la pagina del palcoscenico e l'app nella cornice (stessa origine, controllata).
const MSG_ROUTE = 'fotoflash:route';     // app → pagina: la schermata è cambiata (hash)
const MSG_LANDING = 'fotoflash:landing'; // app → pagina: apri la presentazione
const MSG_GO = 'fotoflash:go';           // pagina → app: vai a questa schermata
const EMBED_PARAM = 'embed';
const LANDING_PATH = '/landing';
const DEFAULT_APP_PATH = '/camera';
// La cornice prova tutto quello che serve all'app: fotocamera, Bluetooth, appunti, condivisione.
const FRAME_ALLOW = 'camera; microphone; bluetooth; clipboard-write; web-share; fullscreen';
// Per quanto, dopo una lingua scelta nel pannello, il fuoco tolto dalla cornice torna al chip.
const KEEP_FOCUS_MS = 4000;
// Quando c'è la cornice (le stesse misure di app.css): sotto, l'app torna la colonna di sempre.
const STAGE_MEDIA = '(min-width: 960px) and (min-height: 540px)';
// Spazio lasciato sotto il telefono per la sua ombra piena (come in app.css).
const PHONE_SHADOW_PX = 16;

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

/** Vero se questa pagina è l'app dentro la cornice del palcoscenico (e non un iframe qualunque). */
function isEmbedded() {
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true; // pagina che ci ospita di un'altra origine: è comunque un iframe
  }
  return framed && new URLSearchParams(location.search).has(EMBED_PARAM);
}

/** '#/camera?x' → '/camera'; vuoto → ''. */
function pathOf(hash) {
  let p = String(hash || '').replace(/^#/, '');
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p === '/' ? '' : p;
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

/** Vista della pagina ('app' | 'landing' | 'stage'): la usa app.css per la larghezza della colonna. */
function setView(view) {
  document.documentElement.dataset.ffView = view;
  applyTitle();
}

/** Titolo della scheda: con il motto sulla presentazione, il solo nome nell'app. */
function applyTitle() {
  const view = document.documentElement.dataset.ffView;
  document.title = view === 'landing' ? `${t('app_name')} · ${t('common_payoff')}` : t('app_name');
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

function canUseServiceWorker() {
  return 'serviceWorker' in navigator && (location.protocol === 'https:' || isLocalHost());
}

/** Service worker: offline, e l'avviso "nuova versione" con Aggiorna (mai a metà di una stampa). */
function registerServiceWorker(ctx, whenOutsideOnboarding) {
  if (!canUseServiceWorker()) return;
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

/** Modulo della presentazione, con il suo mountLanding. */
async function landingModule() {
  const mod = await loadLanding();
  if (!mod || typeof mod.mountLanding !== 'function') throw new Error('mountLanding() mancante');
  return mod;
}

/**
 * Monta la presentazione: mountLanding(root, ctx) → unmount (anche come Promise). La vista 'landing'
 * toglie alla colonna i 480 px dell'app finché la presentazione resta montata.
 */
async function mountLandingView(mod, root, ctx, { onUnmount } = {}) {
  setView('landing');
  let unmount = null;
  try {
    unmount = await mod.mountLanding(root, ctx);
  } catch (e) {
    if (onUnmount) onUnmount();
    throw e;
  }
  return () => {
    try {
      if (typeof unmount === 'function') unmount();
    } finally {
      if (onUnmount) onUnmount();
    }
  };
}

/**
 * Lingua scelta come chip: Automatica più le lingue con il loro nome nativo (e il lang giusto).
 * onPick(chip) arriva prima del cambio, con il chip della lingua scelta.
 * → { el, refresh() }: refresh rinomina «Automatica» e segue una scelta fatta altrove, senza
 * ricostruire i chip (il fuoco resta dov'è).
 */
function languageChips({ onPick } = {}) {
  const options = ['auto', ...LANGS];
  const chips = chipsRow(options, langSetting(),
    (v) => (v === 'auto' ? t('set_language_auto') : LANG_NAMES[v]),
    (v) => {
      if (onPick) onPick(buttons[options.indexOf(v)]);
      setLang(v === 'auto' ? null : v);
    }, { ariaLabel: t('set_language') });
  const buttons = [...chips.el.querySelectorAll('.ff-chip')];
  // Il lettore di schermo pronuncia ogni nome nella sua lingua.
  buttons.forEach((chip, i) => {
    if (options[i] !== 'auto') chip.setAttribute('lang', options[i]);
  });
  return {
    el: chips.el,
    refresh() {
      chips.el.setAttribute('aria-label', t('set_language'));
      const autoText = buttons[0] && buttons[0].lastElementChild;
      if (autoText) autoText.textContent = t('set_language_auto');
      chips.set(langSetting());
    },
  };
}

/** Riporta il fuoco su un elemento con lo stesso id dopo un rimontaggio (cambio di lingua). */
function focusedId(root) {
  const el = document.activeElement;
  return el && el !== document.body && root.contains(el) && el.id ? el.id : null;
}

function restoreFocus(id) {
  const el = id ? document.getElementById(id) : null;
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    // non focalizzabile
  }
}

// ---------------------------------------------------------------------------------------------
// App (telefono, finestra stretta, installata, o dentro la cornice)

async function bootApp(root, { embedded }) {
  await langReady();
  document.documentElement.lang = textLang();
  setView('app');
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

  const openLandingOutside = () => window.parent.postMessage({ type: MSG_LANDING }, location.origin);

  // Nella cornice la presentazione la mostra la pagina che la ospita, a tutta larghezza.
  // Il modulo arriva prima che il router smonti la schermata corrente: niente pagina vuota nell'attesa.
  const routes = {
    ...ROUTES,
    [LANDING_PATH]: embedded
      ? { mount: () => { openLandingOutside(); return null; } }
      : () => landingModule().then((mod) => ({
        mount: (r, c) => mountLandingView(mod, r, c, { onUnmount: () => setView('app') }),
      })),
  };

  // Rotta iniziale: il primo avvio passa sempre dall'onboarding, tranne chi chiede la presentazione.
  const hash = location.hash.replace(/^#/, '');
  const showLanding = !embedded && shouldShowLanding({ width: window.innerWidth, standalone: isStandalone(), hash: location.hash });
  if (showLanding) {
    if (pathOf(location.hash) !== LANDING_PATH) window.history.replaceState(null, '', `#${LANDING_PATH}`);
  } else if (!settings.get().onboardingDone) {
    if (hash !== '/onboarding') window.history.replaceState(null, '', '#/onboarding');
  } else if (!hash || hash === '/') {
    window.history.replaceState(null, '', `#${DEFAULT_APP_PATH}`);
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

  // Dopo un cambio di lingua la schermata si rimonta e il router porta il fuoco sul titolo: chi usa
  // la tastiera torna sul controllo che aveva (per esempio il chip della lingua appena scelto).
  let refocusId = null;

  const router = createRouter(root, routes, ctx, {
    fallback: DEFAULT_APP_PATH,
    onChange: (route) => {
      document.documentElement.dataset.ffBooted = '1';
      if (refocusId) {
        restoreFocus(refocusId);
        refocusId = null;
      }
      applyThemeColor(route.name);
      if (route.name !== 'onboarding' && settings.get().onboardingDone) {
        deferred.splice(0).forEach((fn) => fn());
      }
      // La pagina che ospita la cornice tiene l'indirizzo allineato alla schermata.
      if (embedded && route.name !== 'landing') {
        window.parent.postMessage({ type: MSG_ROUTE, hash: location.hash }, location.origin);
      }
    },
  });
  ctx.router = router;

  if (embedded) {
    // «Presentazione» dalle impostazioni: niente voce in più nella storia della cornice.
    const go = router.go;
    router.go = (path, options) => (pathOf(path.startsWith('#') ? path : `#${path}`) === LANDING_PATH
      ? openLandingOutside()
      : go(path, options));
    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const data = event.data || {};
      if (data.type === MSG_GO && typeof data.hash === 'string' && pathOf(data.hash) !== pathOf(location.hash)) {
        router.go(pathOf(data.hash) || DEFAULT_APP_PATH);
      }
    });
  }

  onLangChange(() => {
    // La presentazione cambia lingua da sé, senza perdere lo stato (foto provata, posizione).
    const route = router.current();
    if (route && route.name === 'landing') return;
    applyTitle();
    // Il fuoco si legge a gesto finito (con le frecce passa al chip nuovo subito dopo la scelta) e
    // prima che il router smonti la schermata: le sue attese vengono dopo questo microtask.
    queueMicrotask(() => {
      refocusId = focusedId(root);
    });
    router.refresh();
  });
  watchLangStorage();

  registerServiceWorker(ctx, whenOutsideOnboarding);
  if (install.installed()) keepStorage();
}

// ---------------------------------------------------------------------------------------------
// Desktop: presentazione e palcoscenico

/** Stampe che fluttuano dietro il telefono: markup statico, decorativo, a un solo inchiostro. */
const PRINT_ART = (() => {
  const ink = '#16130F';
  const paper = '#FBF8F1';
  const dots = (id) => `<defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.3" fill="${ink}"/><circle cx="4.5" cy="4.5" r="1.3" fill="${ink}"/></pattern></defs>`;
  // Foglio con il bordo inferiore a dente di sega (denti 2:1), la sua ombra piena e il contenuto.
  const sheet = (w, hgt, inner, id) => {
    const teeth = Math.max(3, Math.round((w - 8) / 12));
    const step = (w - 8) / teeth;
    let d = `M4,4 H${w - 4} V${hgt - 10}`;
    for (let i = 0; i < teeth; i++) {
      const x = w - 4 - step * i;
      d += ` L${(x - step / 2).toFixed(1)},${hgt - 4} L${(x - step).toFixed(1)},${hgt - 10}`;
    }
    d += ' Z';
    return `<svg viewBox="0 0 ${w + 6} ${hgt + 6}" width="${w + 6}" height="${hgt + 6}" aria-hidden="true" focusable="false">${dots(id)}` +
      `<path d="${d}" transform="translate(5 5)" fill="${ink}"/>` +
      `<path d="${d}" fill="${paper}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>${inner}</svg>`;
  };
  const smile = sheet(108, 132,
    `<rect x="14" y="14" width="80" height="76" rx="3" fill="${paper}" stroke="${ink}" stroke-width="3"/>` +
    '<circle cx="54" cy="52" r="26" fill="url(#ffs-d1)"/><circle cx="45" cy="47" r="3.5" fill="#16130F"/>' +
    '<circle cx="63" cy="47" r="3.5" fill="#16130F"/><path d="M43,59 Q54,70 65,59" fill="none" stroke="#16130F" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M28,104 H80" stroke="#16130F" stroke-width="3" stroke-linecap="round"/>', 'ffs-d1');
  const hills = sheet(112, 128,
    `<rect x="14" y="14" width="84" height="70" rx="3" fill="${paper}" stroke="${ink}" stroke-width="3"/>` +
    '<circle cx="76" cy="34" r="9" fill="#16130F"/><path d="M16,82 L44,48 L62,70 L74,58 L96,82 Z" fill="url(#ffs-d2)" stroke="#16130F" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M30,100 H66" stroke="#16130F" stroke-width="3" stroke-linecap="round"/>', 'ffs-d2');
  const strip = sheet(62, 176,
    [16, 62, 108].map((y) => `<rect x="11" y="${y - 4}" width="40" height="40" rx="2" fill="url(#ffs-d3)" stroke="#16130F" stroke-width="3"/>` +
      `<circle cx="25" cy="${y + 12}" r="2.6" fill="${paper}"/><circle cx="37" cy="${y + 12}" r="2.6" fill="${paper}"/>` +
      `<path d="M24,${y + 21} Q31,${y + 27} 38,${y + 21}" fill="none" stroke="${paper}" stroke-width="3" stroke-linecap="round"/>`).join('') +
    '<path d="M18,158 H44" stroke="#16130F" stroke-width="3" stroke-linecap="round"/>', 'ffs-d3');
  const receipt = sheet(92, 150,
    '<path d="M22,22 H70" stroke="#16130F" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M16,38 H76" stroke="#16130F" stroke-width="2" stroke-dasharray="6 4"/>' +
    '<rect x="22" y="48" width="48" height="40" rx="2" fill="url(#ffs-d4)" stroke="#16130F" stroke-width="3"/>' +
    '<path d="M24,102 H68 M30,114 H62" stroke="#16130F" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M16,126 H76" stroke="#16130F" stroke-width="2" stroke-dasharray="6 4"/>', 'ffs-d4');
  return [smile, strip, hills, receipt, smile.replace(/ffs-d1/g, 'ffs-d5'), hills.replace(/ffs-d2/g, 'ffs-d6')];
})();

function stageBackground() {
  const bg = h('div', { class: 'ff-stage__bg', 'aria-hidden': 'true' });
  PRINT_ART.forEach((markup, i) => {
    const print = h('span', { class: `ff-stage__print ff-stage__print--${i + 1}` });
    // markup statico definito qui sopra, mai testo dell'utente
    print.innerHTML = markup;
    bg.appendChild(print);
  });
  return bg;
}

/**
 * Palcoscenico: l'app in una cornice di telefono, con accanto il pannello (presentazione, lingua,
 * indirizzo da aprire sul telefono, installazione). → { frame, go(path), repaint(), destroy() }
 */
function mountStage(root, ctx, path, { focus = false } = {}) {
  const cleanups = [];
  const frame = h('iframe', {
    class: 'ff-stage__screen',
    title: t('set_stage_frame_title'),
    allow: FRAME_ALLOW,
    src: `./?${EMBED_PARAM}=1#${path || DEFAULT_APP_PATH}`,
  });
  if (focus) {
    // Chi arriva dalla presentazione con la tastiera continua dentro l'app.
    frame.addEventListener('load', () => frame.focus(), { once: true });
  }

  const appUrl = location.origin + location.pathname;
  const urlEl = h('code', { class: 'ff-stage__url' }, appUrl.replace(/^https?:\/\//, ''));

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(appUrl);
      toast(t('set_stage_copied'));
    } catch {
      // Senza permesso per gli appunti: l'indirizzo resta selezionato, da copiare a mano.
      const range = document.createRange();
      range.selectNodeContents(urlEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast(t('set_stage_copy_failed'));
    }
  }

  // Il pannello si costruisce una volta; al cambio di lingua cambiano solo i testi (il fuoco resta).
  const texts = []; // [elemento, () => testo]
  const text = (tag, props, fn) => {
    const el = h(tag, props, fn());
    texts.push([el, fn]);
    return el;
  };
  const button = (make, fn, opts) => {
    const btn = make(fn(), opts);
    texts.push([btn, fn, true]);
    return btn;
  };
  const brand = h('h1', { class: 'ff-stage__brand', id: 'ff-stage-title' }, wordmark({ height: 30, label: t('app_name') }));

  // Una lingua scelta qui rimonta la schermata nella cornice, e il router dell'app porta il fuoco sul
  // suo titolo: senza questa guardia il chip appena scelto perderebbe il fuoco (e con le frecce non si
  // potrebbe continuare a scegliere). Si riprende solo il fuoco spostato dal router, mai un clic.
  let keep = null;
  let keepUntil = 0;
  const langs = languageChips({
    onPick: (chip) => {
      keep = chip;
      keepUntil = Date.now() + KEEP_FOCUS_MS;
    },
  });
  langs.el.addEventListener('focusout', () => {
    if (!keep) return;
    requestAnimationFrame(() => {
      if (!keep || Date.now() > keepUntil || !keep.isConnected || document.activeElement !== frame) return;
      let inner = null;
      try {
        inner = frame.contentDocument ? frame.contentDocument.activeElement : null;
      } catch {
        inner = null;
      }
      // il router mette il fuoco sul titolo (h1) o sulla colonna #app; altro vuol dire un gesto vero
      if (inner && inner.tagName !== 'H1' && inner.id !== 'app') return;
      keep.focus({ preventScroll: true });
    });
  });

  // Installazione di questo computer: il pulsante c'è solo quando il browser la offre.
  const installButton = button(ghostButton, () => t('set_install'), {
    icon: 'install',
    small: true,
    onClick: async () => {
      const outcome = await ctx.install.prompt();
      if (outcome === 'dismissed') toast(t('set_install_dismissed'));
    },
  });
  const paintInstall = () => {
    installButton.hidden = !ctx.install.available();
  };
  paintInstall();
  cleanups.push(ctx.install.subscribe(paintInstall));

  const panel = h('aside', { class: 'ff-stage__panel', 'aria-labelledby': 'ff-stage-title' },
    brand,
    text('p', { class: 'ff-stage__payoff' }, () => t('common_payoff')),
    button(ghostButton, () => t('set_stage_back'), { icon: 'back', onClick: () => { location.hash = `#${LANDING_PATH}`; } }),
    h('section', { class: 'ff-stage__section', 'aria-labelledby': 'ff-stage-lang' },
      text('h2', { class: 'ff-stage__label', id: 'ff-stage-lang' }, () => t('set_language')),
      langs.el),
    h('section', { class: 'ff-stage__section', 'aria-labelledby': 'ff-stage-phone' },
      text('h2', { class: 'ff-stage__label', id: 'ff-stage-phone' }, () => t('set_stage_phone_title')),
      text('p', { class: 'ff-stage__hint' }, () => t('set_stage_phone_hint')),
      urlEl,
      h('div', { class: 'ff-stage__actions' },
        button(ghostButton, () => t('set_stage_copy'), { icon: 'link', small: true, onClick: copyUrl }),
        typeof navigator.share === 'function'
          ? button(ghostButton, () => t('common_share'), {
            icon: 'share',
            small: true,
            onClick: () => navigator.share({ title: t('app_name'), url: appUrl }).catch(() => {}),
          })
          : null)),
    // Chiusura: cosa si può fare qui sul computer, e installarla se il browser lo permette.
    h('div', { class: 'ff-stage__section ff-stage__here' },
      text('p', { class: 'ff-stage__note' }, () => t('set_stage_note')),
      installButton));

  function paintPanel() {
    frame.title = t('set_stage_frame_title');
    brand.firstChild.setAttribute('aria-label', t('app_name'));
    for (const [el, fn, isButton] of texts) {
      if (isButton && typeof el.setText === 'function') el.setText(fn());
      else el.textContent = fn();
    }
    langs.refresh();
  }

  // Punti di riferimento per il lettore di schermo: il pannello è un aside, l'app è il contenuto.
  const phone = h('div', { class: 'ff-stage__phone' }, frame);
  const stage = h('div', { class: 'ff-stage' },
    stageBackground(),
    panel,
    h('main', { class: 'ff-stage__device' }, phone));
  root.appendChild(stage);

  // Finestre basse (1024×640, portatili con lo zoom): lo schermo resta alto almeno 640 px, come un
  // telefono vero, e il telefono intero si rimpicciolisce per starci. Dentro la cornice l'app vede
  // sempre 390 px di larghezza: la scala è una trasformazione, non cambia le misure CSS.
  const html = document.documentElement;
  const fit = () => {
    let scale = 1;
    if (matchMedia(STAGE_MEDIA).matches) {
      const style = getComputedStyle(stage);
      const room = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - PHONE_SHADOW_PX;
      const height = phone.offsetHeight; // misura senza trasformazioni
      if (room > 0 && height > room) scale = room / height;
    }
    html.style.setProperty('--ff-phone-scale', scale.toFixed(4));
  };
  fit();
  window.addEventListener('resize', fit);
  cleanups.push(() => {
    window.removeEventListener('resize', fit);
    html.style.removeProperty('--ff-phone-scale');
  });

  // L'indirizzo segue la schermata dell'app; «Presentazione» dall'app torna qui.
  const onMessage = (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === MSG_ROUTE && typeof data.hash === 'string' && pathOf(data.hash) && pathOf(data.hash) !== LANDING_PATH) {
      if (location.hash !== data.hash) window.history.replaceState(window.history.state, '', data.hash);
    } else if (data.type === MSG_LANDING) {
      location.hash = `#${LANDING_PATH}`;
    }
  };
  window.addEventListener('message', onMessage);
  cleanups.push(() => window.removeEventListener('message', onMessage));

  return {
    frame,
    go(next) {
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: MSG_GO, hash: `#${next}` }, location.origin);
    },
    repaint() {
      paintPanel();
    },
    destroy() {
      cleanups.forEach((fn) => {
        if (typeof fn === 'function') fn();
      });
    },
  };
}

async function bootDesktop(root) {
  await langReady();
  document.documentElement.lang = textLang();
  const install = createInstall();
  let printer = null;
  let current = null; // { kind: 'landing', unmount } | { kind: 'stage', api }
  let token = 0;

  // Il router della presentazione: le rotte dell'app aprono il palcoscenico.
  const router = {
    go(path, { replace = false } = {}) {
      const target = `#${pathOf(path.startsWith('#') ? path : `#${path}`) || LANDING_PATH}`;
      if (replace) {
        window.history.replaceState(window.history.state, '', target);
        render();
      } else if (location.hash !== target) {
        location.hash = target;
      }
    },
    back() {
      if (window.history.length > 1) window.history.back();
      else router.go(LANDING_PATH, { replace: true });
    },
    current() {
      const path = pathOf(location.hash) || LANDING_PATH;
      return { path, pattern: path, name: path.split('/')[1] || '', params: {} };
    },
    refresh() {
      render({ refresh: true });
    },
  };
  const ctx = {
    settings,
    history: historyStore,
    get printer() {
      // Solo se la presentazione lo chiede: sulla pagina del palcoscenico la stampa la fa l'app.
      if (!printer) printer = new PrinterManager(settings);
      return printer;
    },
    session: createSession(),
    router,
    t,
    install,
    version: VERSION,
  };

  function teardown() {
    const was = current;
    current = null;
    if (was) {
      try {
        if (was.kind === 'landing' && typeof was.unmount === 'function') was.unmount();
        if (was.kind === 'stage') was.api.destroy();
      } catch (e) {
        console.error('[app] errore smontando la vista', e);
      }
    }
    clear(root);
  }

  async function showLanding(keepScroll) {
    const my = ++token;
    const focusId = focusedId(root);
    try {
      // Il modulo arriva prima di smontare la vista corrente: niente pagina vuota nell'attesa.
      const mod = await landingModule();
      if (my !== token) return;
      teardown();
      document.body.dataset.route = 'landing';
      current = { kind: 'landing', unmount: null };
      const mine = current;
      // Un contenitore suo: se nel frattempo si passa ad altro, se ne va tutto insieme.
      const host = h('div', { class: 'ff-landing-host' });
      root.appendChild(host);
      const unmount = await mountLandingView(mod, host, ctx);
      if (current !== mine) {
        unmount();
        host.remove();
        return;
      }
      mine.unmount = unmount;
      window.scrollTo(0, keepScroll || 0);
      restoreFocus(focusId);
    } catch (e) {
      // Senza presentazione (offline prima della cache, modulo rotto) l'app resta raggiungibile.
      console.error('[app] presentazione non disponibile', e);
      if (my !== token) return;
      showStage(DEFAULT_APP_PATH, false);
    }
    document.documentElement.dataset.ffBooted = '1';
  }

  function showStage(path, focus) {
    ++token;
    teardown();
    setView('stage');
    document.body.dataset.route = 'stage';
    current = { kind: 'stage', api: mountStage(root, ctx, path, { focus }) };
    window.scrollTo(0, 0);
    document.documentElement.dataset.ffBooted = '1';
  }

  function render({ refresh = false } = {}) {
    const landing = shouldShowLanding({ width: window.innerWidth, standalone: isStandalone(), hash: location.hash });
    if (landing) {
      if (!refresh && current && current.kind === 'landing') return;
      showLanding(refresh ? window.scrollY : 0);
      return;
    }
    const path = pathOf(location.hash) || DEFAULT_APP_PATH;
    if (current && current.kind === 'stage') {
      if (refresh) current.api.repaint();
      else current.api.go(path);
      return;
    }
    showStage(path, !!current);
  }

  window.addEventListener('hashchange', () => render());
  // La presentazione cambia lingua da sé (onLangChange, senza perdere lo stato); il palcoscenico
  // aggiorna i testi del pannello, e l'app nella cornice segue con l'evento storage.
  onLangChange(() => {
    if (current && current.kind === 'stage') {
      applyTitle();
      current.api.repaint();
    }
  });
  watchLangStorage();
  render();

  // Offline anche per la presentazione: il service worker si registra già qui. Gli avvisi di
  // aggiornamento li dà l'app nella cornice, che sa quando una stampa è in corso.
  if (canUseServiceWorker()) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('[sw] registrazione non riuscita', e));
  }
}

/** Monta l'app nel contenitore #app di index.html. */
export async function boot() {
  const root = document.getElementById('app');
  try {
    const embedded = isEmbedded();
    // Schermo largo nel browser = la presentazione direbbe di sì alla pagina iniziale.
    const desktop = !embedded && shouldShowLanding({ width: window.innerWidth, standalone: isStandalone(), hash: '' });
    if (desktop) await bootDesktop(root);
    else await bootApp(root, { embedded });
  } catch (e) {
    bootError(root, e);
  }
}

// Nel browser parte da solo; importato in Node (test degli import) non fa nulla.
if (typeof document !== 'undefined' && document.getElementById('app')) boot();
