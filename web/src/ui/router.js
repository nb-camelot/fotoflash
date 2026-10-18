// Router a hash (#/camera, #/history/<id>...): smonta la schermata precedente, monta la nuova,
// sa tornare indietro senza uscire dall'app. Le rotte possono caricare il modulo solo quando serve.
import { h, clear, reducedMotion } from './dom.js';
import { topBar, flashButton } from './components.js';
import { t } from '../i18n/i18n.js';

function normalize(path) {
  let p = String(path || '').trim();
  if (p.startsWith('#')) p = p.slice(1);
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function segments(path) {
  return path.split('/').filter(Boolean);
}

/**
 * routes: { '/camera': loader, '/history/:id': loader, ... } dove loader è un modulo con mount(),
 * oppure una funzione che lo restituisce (anche come Promise, es. () => import('./screens/x.js')).
 * mount(root, ctx, params) restituisce la funzione che smonta la schermata.
 * opzioni: fallback (rotta per percorsi sconosciuti e per back() senza storia), onChange(route).
 */
export function createRouter(root, routes, ctx, { fallback = '/camera', onChange } = {}) {
  const table = Object.entries(routes).map(([pattern, target]) => ({
    pattern,
    parts: segments(normalize(pattern)),
    target,
  }));
  let unmount = null;
  let token = 0;
  let route = null;
  let depth = 0;
  let mountedOnce = false;

  function match(path) {
    let segs;
    try {
      segs = segments(path).map(decodeURIComponent);
    } catch {
      return null;
    }
    for (const r of table) {
      if (r.parts.length !== segs.length) continue;
      const params = {};
      const ok = r.parts.every((part, i) => {
        if (part.startsWith(':')) {
          params[part.slice(1)] = segs[i];
          return true;
        }
        return part === segs[i];
      });
      if (ok) return { r, params };
    }
    return null;
  }

  // Profondità nella storia dell'app, salvata nello stato della voce: back() sa se c'è dove tornare.
  function trackDepth() {
    const st = history.state;
    if (st && typeof st.ffDepth === 'number') {
      depth = st.ffDepth;
    } else {
      depth = mountedOnce ? depth + 1 : 0;
      try {
        history.replaceState({ ...(st || {}), ffDepth: depth }, '');
      } catch {
        // stato non scrivibile: back() ripiegherà sulla rotta di riserva
      }
    }
  }

  async function load(target) {
    const mod = typeof target === 'function' ? await target() : target;
    if (!mod || typeof mod.mount !== 'function') throw new Error('mount() mancante');
    return mod;
  }

  function teardown() {
    if (!unmount) return;
    const fn = unmount;
    unmount = null;
    try {
      fn();
    } catch (e) {
      console.error('[router] errore smontando la schermata', e);
    }
  }

  function showError(error, retry) {
    clear(root);
    const detail = error && (error.message || String(error));
    root.appendChild(h('div', { class: 'ff-screen' },
      topBar({ title: '', onBack: () => api.back() }),
      h('div', { class: 'ff-screen-error', role: 'alert' },
        h('h1', { class: 'ff-empty__title', tabIndex: -1 }, t('app_screen_error_title')),
        h('p', { class: 'ff-muted' }, t('app_screen_error_body')),
        detail ? h('code', null, t('app_screen_error_detail', detail)) : null,
        flashButton(t('common_retry'), { icon: 'refresh', onClick: retry }))));
  }

  function settle(path, r, params, first, keepScroll = null) {
    route = { path, pattern: r.pattern, name: r.parts[0] || '', params };
    document.body.dataset.route = route.name;
    if (!first) {
      window.scrollTo(0, keepScroll === null ? 0 : keepScroll);
      // Il fuoco va al titolo della nuova schermata: il lettore di schermo annuncia dove si è.
      // Un titolo vuoto (barra senza titolo) non annuncerebbe nulla: si prende il primo con testo.
      const target = [...root.querySelectorAll('h1')].find((el) => el.textContent.trim()) || root;
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      try {
        target.focus({ preventScroll: true });
      } catch {
        // non focalizzabile
      }
      if (!reducedMotion() && typeof root.animate === 'function') {
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      }
    }
    if (onChange) {
      try {
        onChange(route);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function render(keepScroll = null) {
    const path = normalize(location.hash);
    const found = match(path);
    if (!found) {
      const safe = normalize(fallback);
      if (safe !== path && match(safe)) {
        api.go(safe, { replace: true });
      } else {
        teardown();
        showError(new Error(path), () => api.go(safe, { replace: true }));
      }
      return;
    }
    const my = ++token;
    trackDepth();
    const first = !mountedOnce;
    mountedOnce = true;
    let mod;
    try {
      mod = await load(found.r.target);
    } catch (e) {
      if (my !== token) return;
      console.error('[router] schermata non caricata', e);
      teardown();
      showError(e, () => render());
      settle(path, found.r, found.params, first, keepScroll);
      return;
    }
    if (my !== token) return;
    teardown();
    clear(root);
    try {
      let result = mod.mount(root, ctx, found.params);
      if (result && typeof result.then === 'function') result = await result;
      if (my !== token) {
        if (typeof result === 'function') result();
        return;
      }
      unmount = typeof result === 'function' ? result : null;
    } catch (e) {
      console.error('[router] errore montando la schermata', e);
      showError(e, () => render());
    }
    settle(path, found.r, found.params, first, keepScroll);
  }

  const api = {
    /** Va a un percorso ('/settings' o '#/settings'); replace sostituisce la voce corrente. */
    go(path, { replace = false } = {}) {
      const target = normalize(path);
      const now = normalize(location.hash);
      if (replace) {
        try {
          history.replaceState({ ...(history.state || {}), ffDepth: depth }, '', `#${target}`);
        } catch {
          location.replace(`#${target}`);
          return;
        }
        render();
      } else if (target !== now) {
        location.hash = target;
      }
    },
    /** Torna alla schermata precedente dell'app, o alla rotta di riserva se non ce n'è. */
    back() {
      if (depth > 0) history.back();
      else api.go(fallback, { replace: true });
    },
    /** Rotta attuale: { path, pattern, name, params }. */
    current() {
      return route;
    },
    /** Rimonta la schermata attuale (per esempio dopo il cambio di lingua). */
    refresh() {
      render(window.scrollY);
    },
    /** Smette di ascoltare la barra degli indirizzi e smonta la schermata. */
    destroy() {
      window.removeEventListener('hashchange', onHashChange);
      token++;
      teardown();
    },
  };

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const onHashChange = () => render();
  window.addEventListener('hashchange', onHashChange);
  // Il primo montaggio parte dopo che il chiamante ha ricevuto il router (ctx.router).
  queueMicrotask(() => render());
  return api;
}
