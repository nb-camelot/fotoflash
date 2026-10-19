// Animazione della hero: telefono che fa flash, stampantina che stampa la foto di esempio vera
// (motore + retino Atkinson) riga per riga, a gradini come il motore della carta, e coriandoli.
// Loop di 8 s; si ferma fuori schermo o con la scheda nascosta; con le animazioni ridotte è un
// fotogramma fermo con la stampa già uscita. Contratto (docs/LANDING.md):
//   mountHero(container, { t, reducedMotion }) → { destroy() }
import { defaultTone } from '../core/model.js';
import { drawSamplePhoto } from '../ui/sample-photo.js';
import { HERO_FACES, HERO_GEOMETRY, HERO_PRINT, HERO_TIMELINE, HERO_VIEW, heroMarkup } from './art/hero-art.js';
import { bindStage, ensureStyles, fillTexts, resolveReduced, watchVisibility } from './art/stage.js';
import { bitsToDataUrl, photoDots, thermalPhoto } from './art/thermal.js';
import { revealRows } from './art/timeline.js';
import { pauseButton } from './art/controls.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Avanzamento della carta (unità del viewBox) al tempo [t] del giro: ferma prima della stampa,
 * a gradini durante, tutta fuori dopo. [resting]: fotogramma fermo, carta fuori.
 */
export function heroFeed(t, resting = false) {
  const { paperH } = HERO_GEOMETRY;
  if (resting) return paperH;
  return revealRows(t, { start: HERO_PRINT.start, duration: HERO_PRINT.duration, rows: paperH, band: HERO_PRINT.band });
}

export function mountHero(container, { t, reducedMotion } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const reduced = resolveReduced(reducedMotion);
  const doc = container.ownerDocument || globalThis.document;
  let destroyed = false;
  let visible = true;
  let userPaused = false;
  const cleanups = [];

  const root = doc.createElement('div');
  root.className = 'ffx ffh';
  root.style.visibility = 'hidden';
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ffh-svg');
  svg.setAttribute('viewBox', `0 0 ${HERO_VIEW.width} ${HERO_VIEW.height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', tr('scene_hero_alt'));
  svg.setAttribute('focusable', 'false');
  // markup statico dell'illustrazione: nessun testo dell'utente (le scritte entrano dopo con textContent)
  svg.innerHTML = heroMarkup();
  root.appendChild(svg);

  const feedEl = svg.querySelector('.ffh-feed');
  const photoEl = svg.querySelector('.ffh-photo');
  let lastFeed = -1;
  function setFeed(units) {
    if (units === lastFeed) return;
    lastFeed = units;
    feedEl.style.transform = `translateY(${HERO_GEOMETRY.paperH - units}px)`;
  }
  setFeed(0);

  const stage = bindStage(root, HERO_TIMELINE, {
    faces: HERO_FACES,
    onFrame(info) {
      setFeed(heroFeed(info.t, Boolean(info.resting)));
    },
  });

  const pause = pauseButton(doc, tr, (paused) => {
    userPaused = paused;
    update();
  });
  if (!reduced) root.appendChild(pause.el);

  function update() {
    if (destroyed) return;
    if (reduced) stage.rest();
    else if (visible && !userPaused) stage.play();
    else stage.pause();
  }

  container.appendChild(root);
  fillTexts(root, tr);

  // La foto vera: misura dello spazio sullo schermo → punti (≈ 180) → motore → PNG a blocchi.
  const photoTimer = setTimeout(() => {
    if (destroyed) return;
    // larghezza di layout, non quella trasformata: l'ingresso della landing può scalare il riquadro
    const width = root.offsetWidth || root.getBoundingClientRect().width;
    const cssPhoto = width * (HERO_GEOMETRY.photo.w / HERO_VIEW.width);
    const dotsW = photoDots(cssPhoto);
    const dotsH = Math.round((dotsW * HERO_GEOMETRY.photo.h) / HERO_GEOMETRY.photo.w);
    const bits = thermalPhoto('hero-sample', drawSamplePhoto, { width: dotsW, height: dotsH, tone: defaultTone() });
    if (!bits || destroyed) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const scale = Math.max(2, Math.min(4, Math.ceil((cssPhoto * dpr) / dotsW)));
    try {
      photoEl.setAttribute('href', bitsToDataUrl(bits, scale));
    } catch (e) {
      console.warn('[landing] foto della hero non disponibile', e);
    }
  }, 0);
  cleanups.push(() => clearTimeout(photoTimer));

  ensureStyles().then(() => {
    if (destroyed) return;
    root.style.visibility = '';
    // i caratteri arrivano dopo: il fumetto e le scritte si rimisurano
    const fonts = doc.fonts;
    if (fonts && fonts.ready) fonts.ready.then(() => (destroyed ? null : fillTexts(root, tr))).catch(() => {});
  });

  if (reduced) {
    update();
  } else {
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
      stage.destroy();
      pause.destroy();
      root.remove();
    },
  };
}
