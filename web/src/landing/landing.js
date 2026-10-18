// Presentazione di FotoFlash per chi arriva da uno schermo largo (docs/LANDING.md): monta le sezioni,
// l'hero e le scene animate (hero.js, scenes.js), il selettore della lingua e le strade verso l'app.
// Tutto il DOM nasce dentro mountLanding: importato in Node il modulo non tocca nulla.
import { h, clear, reducedMotion, uniqueId } from '../ui/dom.js';
import { icon, brandMark } from '../ui/icons.js';
import { t as i18nT, lang, setLang, LANGS, LANG_NAMES, onLangChange } from '../i18n/i18n.js';
import { VERSION } from '../version.js';
import { createSamplePhoto } from '../ui/sample-photo.js';
import { appRoute } from './sections/kit.js';
import { topbar } from './sections/topbar.js';
import { intro } from './sections/intro.js';
import { ideas } from './sections/ideas.js';
import { how } from './sections/how.js';
import { trySection, releaseTryState } from './sections/try.js';
import { models } from './sections/models.js';
import { printers } from './sections/printers.js';
import { get } from './sections/get.js';
import { oss } from './sections/oss.js';
import { finale, footer } from './sections/finale.js';

/** Fogli di stile della presentazione e delle scene, relativi a questo modulo (il sito vive sotto /fotoflash/). */
const STYLESHEETS = ['../../styles/landing.css', '../../styles/scenes.css'];
/** Oltre questo tempo si mostra la pagina anche se un foglio di stile non è arrivato. */
const STYLE_TIMEOUT_MS = 2500;
/** Lato lungo della foto di esempio: per 384 punti basta e avanza. */
const SAMPLE_SIZE = { width: 768, height: 1024 };

/** Collega i fogli di stile se mancano e aspetta che arrivino (con un limite di tempo). */
function ensureStyles() {
  const doc = document;
  const waits = STYLESHEETS.map((rel) => {
    const href = new URL(rel, import.meta.url).href;
    let link = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).find((l) => l.href === href);
    if (link && link.sheet) return Promise.resolve();
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      doc.head.appendChild(link);
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, STYLE_TIMEOUT_MS);
      link.addEventListener('load', done, { once: true });
      link.addEventListener('error', done, { once: true });
    });
  });
  return Promise.all(waits);
}

/** Modulo caricato a parte: se manca o si rompe, la presentazione resta in piedi senza. */
function optionalModule(load) {
  return load().catch((e) => {
    console.warn('[landing] modulo non disponibile', e);
    return null;
  });
}

/** IntersectionObserver condiviso: funzioni da chiamare una volta, quando l'elemento si avvicina. */
function createNear() {
  const handlers = new Map();
  const observers = new Map();
  const supported = typeof IntersectionObserver === 'function';
  function observer(margin) {
    if (!observers.has(margin)) {
      observers.set(margin, new IntersectionObserver((entries, io) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          const list = handlers.get(entry.target) || [];
          handlers.delete(entry.target);
          for (const fn of list) {
            try {
              fn();
            } catch (e) {
              console.error(e);
            }
          }
        }
      }, { rootMargin: margin }));
    }
    return observers.get(margin);
  }
  return {
    near(el, fn, margin = '300px') {
      if (!supported) {
        setTimeout(fn, 0);
        return;
      }
      if (!handlers.has(el)) handlers.set(el, []);
      handlers.get(el).push(fn);
      observer(margin).observe(el);
    },
    disconnect() {
      observers.forEach((io) => io.disconnect());
      observers.clear();
      handlers.clear();
    },
  };
}

/**
 * Animazioni in loop: girano solo se l'elemento è visibile e la scheda è in primo piano
 * (classe is-playing, che in CSS fa da animation-play-state).
 */
function createPlayer() {
  const tracked = new Set();
  const visible = new Set();
  const supported = typeof IntersectionObserver === 'function';
  const apply = (el) => {
    const on = !document.hidden && (!supported || visible.has(el));
    el.classList.toggle('is-playing', on);
  };
  const io = supported ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
      apply(entry.target);
    }
  }) : null;
  const onVisibility = () => tracked.forEach(apply);
  document.addEventListener('visibilitychange', onVisibility);
  return {
    play(el) {
      el.classList.add('ffl-anim');
      tracked.add(el);
      if (io) io.observe(el);
      else apply(el);
    },
    reset() {
      if (io) tracked.forEach((el) => io.unobserve(el));
      tracked.clear();
      visible.clear();
    },
    destroy() {
      if (io) io.disconnect();
      tracked.clear();
      visible.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

/**
 * Monta la presentazione in [root]. ctx è il contesto dell'app (t, settings, install, router, version…):
 * router può mancare, se la presentazione è montata al posto dell'app. → funzione che smonta.
 */
export async function mountLanding(root, ctx = {}) {
  const t = typeof ctx.t === 'function' ? ctx.t : i18nT;
  const doc = document;
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = reducedMotion();
  let destroyed = false;

  // I moduli animati partono subito, in parallelo con i fogli di stile.
  const heroModule = optionalModule(() => import('./hero.js'));
  const scenesModule = optionalModule(() => import('./scenes.js'));
  await ensureStyles();

  // Stato che sopravvive ai cambi di lingua: interattivo del retino, stampe rese, foto di esempio.
  const state = { media: { sample: null } };
  const samplePhoto = () => {
    if (!state.media.sample) {
      state.media.sample = createSamplePhoto(SAMPLE_SIZE).catch((e) => {
        state.media.sample = null;
        throw e;
      });
    }
    return state.media.sample;
  };

  const shell = h('div', { class: 'ffl ff-theme-light' });
  const player = createPlayer();
  const previousTitle = doc.title;
  let view = null;
  let revealed = false;

  clear(root);
  root.classList.add('ffl-host');
  doc.documentElement.classList.add('ffl-on');
  root.appendChild(shell);

  /** Selettore della lingua: select nativo con il nome di ogni lingua nella lingua stessa (LANG_NAMES). */
  function langSelect(place) {
    const id = uniqueId('ffl-lang');
    const current = lang();
    const select = h('select', {
      id,
      class: 'ffl-lang__select',
      dataset: { fflFocus: `lang-${place}` },
      onChange: () => setLang(select.value),
    }, ...LANGS.map((code) => h('option', { value: code, lang: code, selected: code === current }, (LANG_NAMES && LANG_NAMES[code]) || String(code).toUpperCase())));
    return h('div', { class: 'ffl-lang' },
      h('label', { class: 'ff-sr-only', htmlFor: id }, t('land_lang_label')),
      icon('globe', { size: 18, className: 'ffl-lang__globe' }),
      select,
      // sui telefoni il select è stretto: si vede il codice, il nome intero resta nell'elenco
      h('span', { class: 'ffl-lang__code', 'aria-hidden': 'true' }, String(current).toUpperCase()),
      icon('chevron-down', { size: 16, className: 'ffl-lang__chevron' }));
  }

  /** Collega un pulsante o link all'app: router se c'è, altrimenti l'hash (lo segue app.js). */
  function appLink(el) {
    const route = appRoute(ctx.settings);
    if (el.tagName === 'A') {
      el.setAttribute('href', `#${route}`);
    }
    el.addEventListener('click', (event) => {
      const target = appRoute(ctx.settings);
      if (ctx.router && typeof ctx.router.go === 'function') {
        event.preventDefault();
        ctx.router.go(target);
      } else if (el.tagName !== 'A') {
        location.hash = `#${target}`;
      } else {
        el.setAttribute('href', `#${target}`);
      }
    });
    return el;
  }

  const sectionListeners = new Set();
  let spy = null;

  function scrollToSection(id) {
    const target = doc.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    const heading = target.querySelector('h2, h1');
    if (heading) {
      try {
        heading.focus({ preventScroll: true });
      } catch {
        // non focalizzabile
      }
    }
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    const h1 = shell.querySelector('h1');
    if (h1) {
      try {
        h1.focus({ preventScroll: true });
      } catch {
        // non focalizzabile
      }
    }
  }

  /** Costruisce tutta la pagina nella lingua corrente. */
  function build() {
    const cleanups = [];
    const handles = [];
    // osservatori "una volta sola" di questa costruzione: si buttano con lei
    const near = createNear();
    cleanups.push(() => near.disconnect());
    const env = {
      t,
      ctx,
      state,
      reduced,
      version: VERSION,
      samplePhoto,
      near: near.near,
      play: player.play,
      cleanup: (fn) => cleanups.push(fn),
      langSelect,
      appLink,
      scrollToSection,
      scrollToTop,
      onSectionChange: (fn) => sectionListeners.add(fn),
    };

    const top = topbar(env);
    const hero = intro(env);
    const idea = ideas(env);
    const parts = [how(env), trySection(env), models(env), printers(env), get(env), oss(env), finale(env)];
    const foot = footer(env);

    const skip = h('a', {
      class: 'ffl-skip',
      href: '#ffl-main',
      onClick: (event) => {
        event.preventDefault();
        main.focus();
        main.scrollIntoView({ block: 'start' });
      },
    }, t('land_skip'));
    const main = h('main', { class: 'ffl-main', id: 'ffl-main', tabIndex: -1 }, hero.el, idea.el, ...parts.map((p) => p.el));
    const el = h('div', { class: 'ffl-page' }, skip, top.el, main, foot.el);

    // Hero animato: subito, è la prima cosa che si vede. Finché non arriva (o se manca) resta il marchio.
    const heroFallback = h('div', { class: 'ffl-hero__fallback', 'aria-hidden': 'true' }, brandMark({ size: 260, shadow: '#16130F' }));
    hero.stage.appendChild(heroFallback);
    heroModule.then((mod) => {
      if (!mod || typeof mod.mountHero !== 'function' || !view || view.el !== el) return;
      try {
        const handle = mod.mountHero(hero.stage, { t, reducedMotion: reduced });
        heroFallback.remove();
        // l'animazione ha già il suo disco, il retino e le scintille: i nostri restano per il ripiego
        hero.art.classList.add('has-hero');
        handles.push(handle);
      } catch (e) {
        console.error('[landing] hero non montato', e);
      }
    });

    // Scene dei casi d'uso: quando la sezione si avvicina, fuori dal percorso critico.
    near.near(idea.stage, () => {
      scenesModule.then((mod) => {
        if (!mod || typeof mod.mountScenes !== 'function' || !view || view.el !== el) return;
        try {
          handles.push(mod.mountScenes(idea.stage, { t, reducedMotion: reduced }));
          idea.stage.classList.add('is-mounted');
        } catch (e) {
          console.error('[landing] scene non montate', e);
        }
      });
    }, '600px');

    // Comparsa delle sezioni allo scorrimento (solo con le animazioni attive e solo la prima volta).
    const reveals = Array.from(el.querySelectorAll('.ffl-reveal'));
    let revealIo = null;
    // l'ingresso dell'hero solo all'apertura, non a ogni cambio di lingua
    shell.classList.toggle('ffl--intro', !revealed && !reduced);
    if (!revealed && !reduced && typeof IntersectionObserver === 'function') {
      shell.classList.add('ffl--motion');
      revealIo = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          revealIo.unobserve(entry.target);
        }
      }, { rootMargin: '0px 0px -8% 0px' });
      reveals.forEach((r) => revealIo.observe(r));
    } else {
      reveals.forEach((r) => r.classList.add('is-in'));
    }
    revealed = true;

    // Sezione corrente per la barra.
    const sections = Array.from(main.querySelectorAll(':scope > section[id]'));
    if (typeof IntersectionObserver === 'function') {
      spy = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          sectionListeners.forEach((fn) => fn(entry.target.id));
        }
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach((s) => spy.observe(s));
    }

    return {
      el,
      destroy() {
        if (revealIo) revealIo.disconnect();
        if (spy) spy.disconnect();
        spy = null;
        sectionListeners.clear();
        for (const handle of handles.splice(0)) {
          try {
            if (handle && typeof handle.destroy === 'function') handle.destroy();
          } catch (e) {
            console.error(e);
          }
        }
        for (const fn of cleanups.splice(0)) {
          try {
            fn();
          } catch (e) {
            console.error(e);
          }
        }
        player.reset();
      },
    };
  }

  function render() {
    // Si ritorna sulla stessa sezione, alla stessa altezza: le lingue cambiano la lunghezza dei testi.
    let anchorId = null;
    let anchorTop = 0;
    if (view) {
      const current = Array.from(shell.querySelectorAll('.ffl-main > section[id]'))
        .find((s) => s.getBoundingClientRect().bottom > 80);
      if (current) {
        anchorId = current.id;
        anchorTop = current.getBoundingClientRect().top;
      }
    }
    const focusKey = doc.activeElement && doc.activeElement.dataset ? doc.activeElement.dataset.fflFocus : null;
    if (view) view.destroy();
    view = null;
    clear(shell);
    shell.setAttribute('lang', lang());
    doc.title = t('land_doc_title');
    // hero e scene arrivano in modo asincrono e controllano view.el: l'assegnazione è già fatta
    view = build();
    shell.appendChild(view.el);
    if (anchorId) {
      const again = doc.getElementById(anchorId);
      if (again) window.scrollBy(0, again.getBoundingClientRect().top - anchorTop);
    }
    if (focusKey) {
      const target = shell.querySelector(`[data-ffl-focus="${focusKey}"]`);
      if (target) target.focus({ preventScroll: true });
    }
  }

  render();
  doc.documentElement.lang = lang();
  // Il controllo di avvio di index.html aspetta questo segno per non dire "ci sta mettendo troppo".
  doc.documentElement.dataset.ffBooted = '1';

  const offLang = onLangChange(() => {
    if (destroyed) return;
    doc.documentElement.lang = lang();
    render();
  });

  // Se l'utente cambia la preferenza sulle animazioni, la pagina si ricostruisce con il nuovo stile.
  const onMotion = () => {
    reduced = reducedMotion();
    if (!destroyed) render();
  };
  if (motionQuery && typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onMotion);

  return function unmount() {
    if (destroyed) return;
    destroyed = true;
    offLang();
    if (motionQuery && typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', onMotion);
    if (view) view.destroy();
    view = null;
    player.destroy();
    releaseTryState(state);
    if (state.media.sample) {
      state.media.sample.then((bitmap) => bitmap && typeof bitmap.close === 'function' && bitmap.close()).catch(() => {});
    }
    clear(shell);
    shell.remove();
    root.classList.remove('ffl-host');
    doc.documentElement.classList.remove('ffl-on');
    doc.title = previousTitle;
    state.media.sample = null;
  };
}

/** Stessa firma delle schermate (mount(root, ctx) → unmount): così il router può montarla come rotta. */
export const mount = mountLanding;
