// Carosello delle idee: cinque scene animate dei casi d'uso (festa, matrimonio, bambini, viaggio,
// negozio). Ogni scena è una storia in loop di 6-7 s a battute (flash → stampa → reazione) con le
// foto vere retinate dal motore; finito un giro si passa alla successiva. Puntini, frecce e tastiera;
// il passaggio automatico si ferma al passaggio del mouse o con il fuoco dentro, il pulsante di pausa
// ferma tutto; fuori schermo o con la scheda nascosta non si muove niente; con le animazioni ridotte
// ogni scena è il suo fotogramma finale e si cambia solo a mano. Contratto (docs/LANDING.md):
//   mountScenes(container, { t, reducedMotion }) → { destroy() }
import { party } from './art/scene-party.js';
import { wedding } from './art/scene-wedding.js';
import { kids } from './art/scene-kids.js';
import { trip } from './art/scene-trip.js';
import { shop } from './art/scene-shop.js';
import { bindStage, ensureStyles, fillTexts, fitMeasured, resolveReduced, watchVisibility } from './art/stage.js';
import { thermalPath } from './art/thermal.js';
import { controlButton, pauseButton } from './art/controls.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Le scene, nell'ordine di docs/LANDING.md. */
export const SCENES = Object.freeze([party, wedding, kids, trip, shop]);

/** Indice dentro 0..count-1, anche partendo da valori negativi. */
export function wrapIndex(i, count) {
  if (!(count > 0)) return 0;
  return ((Math.trunc(i) % count) + count) % count;
}

/** Tasto → nuova scena (frecce, Home, Fine), oppure null se il tasto non riguarda il carosello. */
export function keyToIndex(key, index, count) {
  switch (key) {
    case 'ArrowRight':
      return wrapIndex(index + 1, count);
    case 'ArrowLeft':
      return wrapIndex(index - 1, count);
    case 'Home':
      return 0;
    case 'End':
      return wrapIndex(count - 1, count);
    default:
      return null;
  }
}

/**
 * Si passa da soli alla scena dopo? Solo alla fine di un giro, con il carosello visibile, senza
 * mouse sopra né fuoco dentro, non in pausa e con le animazioni attive.
 */
export function shouldAdvance({ loopEnd, hovered, focused, paused, reduced, visible }) {
  return Boolean(loopEnd && visible && !hovered && !focused && !paused && !reduced);
}

/**
 * Stato del carosello come funzione pura: { index, count, hovered, focused, paused } e un evento
 * { type: 'next' | 'prev' | 'go' | 'loopEnd' | 'hover' | 'focus' | 'toggle', index, on, reduced,
 * visible }. → nuovo stato più { changed, announce } (announce: cambio voluto dall'utente, da dire
 * al lettore di schermo).
 */
export function carouselStep(state, event) {
  const s = { ...state, changed: false, announce: false };
  const go = (i, announce) => {
    const next = wrapIndex(i, s.count);
    s.changed = next !== state.index;
    s.announce = announce && s.changed;
    s.index = next;
  };
  switch (event.type) {
    case 'next':
      go(state.index + 1, true);
      break;
    case 'prev':
      go(state.index - 1, true);
      break;
    case 'go':
      go(event.index, true);
      break;
    case 'loopEnd':
      if (shouldAdvance({ loopEnd: true, ...state, reduced: event.reduced, visible: event.visible !== false })) go(state.index + 1, false);
      break;
    case 'hover':
      s.hovered = Boolean(event.on);
      break;
    case 'focus':
      s.focused = Boolean(event.on);
      break;
    case 'toggle':
      s.paused = !state.paused;
      break;
    default:
      break;
  }
  return s;
}

/** "01 / 05": solo numeri, uguale in ogni lingua. */
export function counterText(index, count) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(index + 1)} / ${pad(count)}`;
}

/** Battuta dopo la quale si passa alla scena successiva: l'uscita, se c'è. */
function isLoopEnd(scene, info, wrapped) {
  const last = scene.timeline.beats[scene.timeline.beats.length - 1][0];
  return last === 'out' ? info.id === 'out' : wrapped;
}

/**
 * Riempimento del puntino attivo (0..1) al tempo [t] del giro: arriva pieno quando si passa alla
 * scena dopo, cioè all'inizio dell'uscita (se c'è), non alla fine del giro.
 */
export function dotProgress(tl, t) {
  const last = tl.beats[tl.beats.length - 1];
  const end = last[0] === 'out' && last[1] > 0 ? last[1] : tl.duration;
  return Math.max(0, Math.min(1, t / end));
}

export function mountScenes(container, { t, reducedMotion } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const reduced = resolveReduced(reducedMotion);
  const doc = container.ownerDocument || globalThis.document;
  const count = SCENES.length;
  const cleanups = [];
  let destroyed = false;
  let visible = true;
  let state = { index: 0, count, hovered: false, focused: false, paused: false };

  const el = (tag, cls, attrs = {}) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  const root = el('div', 'ffs', {
    role: 'region',
    'aria-roledescription': tr('scene_role_carousel'),
    'aria-label': tr('scene_carousel'),
  });
  root.style.visibility = 'hidden';
  if (reduced) root.classList.add('is-reduced');
  const viewport = el('div', 'ffs__viewport');
  const live = el('p', 'ff-sr-only ffs__live', { 'aria-live': 'polite', 'aria-atomic': 'true' });

  // --- Le slide -----------------------------------------------------------------------------
  const slides = SCENES.map((scene, i) => {
    const title = tr(`scene_${scene.id}_title`);
    const slide = el('div', 'ffs__slide', {
      role: 'group',
      'aria-roledescription': tr('scene_role_slide'),
      'aria-label': tr('scene_slide_of', i + 1, count),
      id: `ffs-slide-${scene.id}`,
    });
    const card = el('div', `ffs__card ffx ffs-${scene.id}`);
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 480 360');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', tr(`scene_${scene.id}_alt`));
    svg.setAttribute('focusable', 'false');
    // markup statico della scena; le scritte entrano dopo con textContent (fillTexts)
    svg.innerHTML = scene.markup();
    card.appendChild(svg);
    const copy = el('div', 'ffs__copy');
    const num = el('p', 'ffs__num');
    num.textContent = counterText(i, count);
    const h3 = el('h3', 'ffs__title');
    h3.textContent = title;
    const p = el('p', 'ffs__text');
    p.textContent = tr(`scene_${scene.id}_text`);
    copy.append(num, h3, p);
    slide.append(card, copy);
    viewport.appendChild(slide);
    return { scene, slide, card, title, stage: null, photos: false };
  });

  // --- Controlli ----------------------------------------------------------------------------
  const controls = el('div', 'ffs__controls');
  const pause = pauseButton(doc, tr, () => dispatch({ type: 'toggle' }), 'ffs__pause');
  const prev = controlButton(doc, 'prev', tr('scene_prev'), () => dispatch({ type: 'prev' }), 'ffs__prev');
  const next = controlButton(doc, 'next', tr('scene_next'), () => dispatch({ type: 'next' }), 'ffs__next');
  const dots = el('div', 'ffs__dots', { role: 'group', 'aria-label': tr('scene_dots') });
  const dotButtons = slides.map((s, i) => {
    const b = el('button', 'ffs__dot', {
      type: 'button',
      'aria-label': tr('scene_goto', i + 1, s.title),
      'aria-controls': s.slide.id,
    });
    const pill = el('span', 'ffs__pill');
    const fill = el('span', 'ffs__fill');
    pill.appendChild(fill);
    b.appendChild(pill);
    b.addEventListener('click', () => dispatch({ type: 'go', index: i }));
    dots.appendChild(b);
    return { b, fill };
  });
  if (!reduced) controls.appendChild(pause.el);
  controls.append(prev, dots, next);
  root.append(viewport, controls, live);
  container.appendChild(root);

  // --- Scene: foto, testi, palcoscenico -------------------------------------------------------
  function preparePhotos(i) {
    const s = slides[i];
    if (!s || s.photos) return;
    s.photos = true;
    for (const ph of s.scene.photos || []) {
      const d = thermalPath(ph.slot, ph.draw, { width: ph.width, height: ph.height });
      if (!d) continue;
      for (const path of s.card.querySelectorAll(`[data-photo="${ph.slot}"]`)) path.setAttribute('d', d);
    }
  }

  slides.forEach((s, i) => {
    fillTexts(s.card, tr);
    s.stage = bindStage(s.card, s.scene.timeline, {
      faces: s.scene.faces,
      moves: s.scene.moves,
      onFrame(info) {
        if (i !== state.index) return;
        dotButtons[i].fill.style.transform = `scaleX(${dotProgress(s.scene.timeline, info.t).toFixed(4)})`;
      },
      onBeat(info, { wrapped }) {
        if (i !== state.index || !isLoopEnd(s.scene, info, wrapped)) return;
        dispatch({ type: 'loopEnd' });
      },
    });
  });

  function render(announce) {
    slides.forEach((s, i) => {
      const active = i === state.index;
      s.slide.classList.toggle('is-active', active);
      s.slide.classList.toggle('is-before', i < state.index);
      if (active) {
        s.slide.removeAttribute('aria-hidden');
        s.slide.inert = false;
      } else {
        s.slide.setAttribute('aria-hidden', 'true');
        s.slide.inert = true;
      }
      const b = dotButtons[i].b;
      if (active) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
      b.tabIndex = active ? 0 : -1;
      if (!active) dotButtons[i].fill.style.transform = 'scaleX(0)';
    });
    root.classList.toggle('is-held', state.hovered || state.focused);
    if (announce) live.textContent = tr('scene_live', state.index + 1, count, slides[state.index].title);
  }

  let playingIndex = -1;
  let prepareTimer = 0;
  cleanups.push(() => clearTimeout(prepareTimer));
  function update() {
    if (destroyed) return;
    const active = slides[state.index];
    if (playingIndex !== state.index) {
      if (playingIndex >= 0) slides[playingIndex].stage.pause();
      preparePhotos(state.index);
      if (!reduced) active.stage.restart();
      playingIndex = state.index;
      // la prossima scena si prepara mentre questa suona
      const upcoming = wrapIndex(state.index + 1, count);
      clearTimeout(prepareTimer);
      prepareTimer = setTimeout(() => (destroyed ? null : preparePhotos(upcoming)), 600);
    }
    if (reduced) active.stage.rest();
    else if (visible && !state.paused) active.stage.play();
    else active.stage.pause();
  }

  function dispatch(event) {
    if (destroyed) return;
    const out = carouselStep(state, { ...event, reduced, visible });
    const { changed, announce } = out;
    delete out.changed;
    delete out.announce;
    state = out;
    if (event.type === 'toggle') pause.set(state.paused);
    render(announce);
    if (changed || event.type === 'toggle') update();
  }

  // --- Eventi -------------------------------------------------------------------------------
  listen(root, 'mouseenter', () => dispatch({ type: 'hover', on: true }));
  listen(root, 'mouseleave', () => dispatch({ type: 'hover', on: false }));
  listen(root, 'focusin', () => dispatch({ type: 'focus', on: true }));
  listen(root, 'focusout', (e) => {
    if (!root.contains(e.relatedTarget)) dispatch({ type: 'focus', on: false });
  });
  listen(root, 'keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = keyToIndex(e.key, state.index, count);
    if (target === null) return;
    e.preventDefault();
    const onDot = dots.contains(doc.activeElement);
    dispatch({ type: 'go', index: target });
    if (onDot) dotButtons[state.index].b.focus();
  });

  render(false);
  update();

  ensureStyles().then(() => {
    if (destroyed) return;
    root.style.visibility = '';
    const fonts = doc.fonts;
    const refit = () => (destroyed ? null : slides.forEach((s) => fitMeasured(s.card)));
    refit();
    if (fonts && fonts.ready) fonts.ready.then(refit).catch(() => {});
  });

  if (!reduced) {
    cleanups.push(watchVisibility(root, (v) => {
      visible = v;
      update();
    }));
  }

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const fn of cleanups.splice(0)) fn();
      for (const s of slides) s.stage.destroy();
      pause.destroy();
      root.remove();
    },
  };
}
