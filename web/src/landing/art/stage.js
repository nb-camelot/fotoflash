// Il "palcoscenico" comune di hero e scene: collega l'orologio delle battute (timeline.js) a un
// elemento del DOM. A ogni battuta mette sull'elemento le classi cumulative b-<battuta>, sposta gli
// attori (data-a) con transizioni su transform e opacity, riaccende gli effetti (data-fx), aggiorna
// le espressioni dei personaggi e, quando il giro ricomincia, riporta tutto all'inizio senza
// transizioni. Qui anche testi tradotti, foglio di stile e visibilità sullo schermo.
import { reducedMotion as prefersReduced } from '../../ui/dom.js';
import { beatClasses, createLoop, restingIndex } from './timeline.js';

/** Larghezza media di un carattere di Space Mono, in em (avanzamento 612/1000). */
export const MONO_ADVANCE = 0.612;

/** Corpo di un testo monospaziato perché [text] stia in [fit] unità; mai più grande di [size]. */
export function monoSize(text, size, fit) {
  const chars = [...String(text)].length;
  if (!chars || !(fit > 0)) return size;
  return Math.min(size, fit / (chars * MONO_ADVANCE));
}

/** Preferenza per le animazioni ridotte: booleano, funzione, oppure quella del sistema. */
export function resolveReduced(opt) {
  if (typeof opt === 'boolean') return opt;
  if (typeof opt === 'function') {
    try {
      return Boolean(opt());
    } catch {
      return prefersReduced();
    }
  }
  return prefersReduced();
}

/**
 * Collega scenes.css una volta sola, se la pagina non l'ha già (accanto agli altri fogli, con un
 * indirizzo relativo a questo modulo: il sito vive sotto /fotoflash/). → Promise risolta quando
 * gli stili sono attivi (o subito, se c'erano già).
 */
export function ensureStyles() {
  const doc = globalThis.document;
  if (!doc) return Promise.resolve();
  const probe = () => {
    const root = doc.documentElement;
    return globalThis.getComputedStyle(root).getPropertyValue('--ffx-css').trim() === '1';
  };
  if (probe()) return Promise.resolve();
  let link = doc.querySelector('link[data-ffx-css], link[href$="scenes.css"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../../styles/scenes.css', import.meta.url).href;
    link.setAttribute('data-ffx-css', '');
    doc.head.appendChild(link);
  }
  return new Promise((resolve) => {
    const done = () => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    // un foglio già caricato non manda più "load": si controlla ancora dopo un attimo
    setTimeout(() => (probe() ? done() : null), 50);
    setTimeout(done, 3000);
  });
}

/**
 * Mette i testi tradotti negli elementi con data-k (e data-n per il numero), poi li adatta alla
 * larghezza data-fit: i monospaziati con il conto dei caratteri, gli altri misurando.
 */
export function fillTexts(root, t) {
  for (const el of root.querySelectorAll('[data-k]')) {
    const key = el.getAttribute('data-k');
    const num = el.getAttribute('data-n');
    const text = num === null ? t(key) : t(key, Number(num));
    el.textContent = text;
    const fit = Number(el.getAttribute('data-fit'));
    if (!(fit > 0)) continue;
    if (el.classList.contains('ffx-mono')) {
      const size = Number(el.getAttribute('font-size'));
      el.setAttribute('font-size', String(Math.round(monoSize(text, size, fit) * 100) / 100));
    }
  }
  fitMeasured(root);
}

/** Corpo minimo, rispetto a quello pieno, prima di stringere le lettere. */
export const MIN_FIT_SCALE = 0.72;

/**
 * Come far stare un testo largo [width] in [fit]: prima si rimpicciolisce il corpo (scale), fino a
 * [min]; solo oltre si stringono anche le lettere (squeeze), che deformate si notano subito.
 */
export function fitScale(width, fit, min = MIN_FIT_SCALE) {
  if (!(width > fit) || !(fit > 0)) return { scale: 1, squeeze: false };
  const scale = fit / width;
  return scale >= min ? { scale, squeeze: false } : { scale: min, squeeze: true };
}

/**
 * Testi non monospaziati (le scritte dei fumetti, centrate in verticale sullo 0): se la misura vera
 * supera data-fit si rimpicciolisce il corpo, con la linea di base in proporzione perché il testo
 * resti al centro, e solo come ultima risorsa si stringono le lettere. Corpo e linea di base di
 * partenza restano in data-fs e data-y: a ogni nuova misura (caratteri arrivati) si riparte da lì.
 */
export function fitMeasured(root) {
  for (const el of root.querySelectorAll('[data-k][data-fit]:not(.ffx-mono)')) {
    const fit = Number(el.getAttribute('data-fit'));
    if (!el.hasAttribute('data-fs')) el.setAttribute('data-fs', el.getAttribute('font-size') || '16');
    if (!el.hasAttribute('data-y')) el.setAttribute('data-y', el.getAttribute('y') || '0');
    const size = Number(el.getAttribute('data-fs')) || 16;
    const y = Number(el.getAttribute('data-y')) || 0;
    el.setAttribute('font-size', String(size));
    el.setAttribute('y', String(y));
    el.removeAttribute('textLength');
    el.removeAttribute('lengthAdjust');
    let width = 0;
    try {
      width = el.getComputedTextLength();
    } catch {
      width = 0;
    }
    if (!(width > 0)) width = [...el.textContent].length * 0.62 * size;
    const { scale, squeeze } = fitScale(width, fit);
    if (scale < 1) {
      el.setAttribute('font-size', String(Math.round(size * scale * 100) / 100));
      el.setAttribute('y', String(Math.round(y * scale * 100) / 100));
    }
    if (squeeze) {
      el.setAttribute('textLength', String(fit));
      el.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  }
}

/**
 * Osserva se [el] è sullo schermo e se la scheda è visibile: cb(true|false) a ogni cambio.
 * → funzione per smettere.
 */
export function watchVisibility(el, cb) {
  const doc = globalThis.document;
  let inView = true;
  let shown = !doc || doc.visibilityState !== 'hidden';
  let last = null;
  const emit = () => {
    const v = inView && shown;
    if (v !== last) {
      last = v;
      cb(v);
    }
  };
  let io = null;
  if (typeof globalThis.IntersectionObserver === 'function') {
    io = new globalThis.IntersectionObserver((entries) => {
      for (const e of entries) inView = e.isIntersecting && e.intersectionRatio > 0.05;
      emit();
    }, { threshold: [0, 0.06, 0.25] });
    io.observe(el);
  }
  const onVis = () => {
    shown = doc.visibilityState !== 'hidden';
    emit();
  };
  if (doc) doc.addEventListener('visibilitychange', onVis);
  emit();
  return () => {
    if (io) io.disconnect();
    if (doc) doc.removeEventListener('visibilitychange', onVis);
  };
}

/** Espressione in vigore alla battuta [index]: l'ultima definita a quella battuta o prima. */
export function faceAt(tl, faces, index) {
  const out = {};
  if (!faces) return out;
  for (let i = 0; i <= index && i < tl.beats.length; i++) {
    const step = faces[tl.beats[i][0]];
    if (step) Object.assign(out, step);
  }
  return out;
}

/** Curve di andatura con un nome; qualunque altra stringa passa così com'è (es. 'steps(12, end)'). */
export const EASE = Object.freeze({
  out: 'cubic-bezier(.2, .8, .2, 1)',
  back: 'cubic-bezier(.34, 1.56, .64, 1)',
  io: 'cubic-bezier(.65, 0, .35, 1)',
  in: 'cubic-bezier(.5, 0, .75, 0)',
  linear: 'linear',
});

const MOTION = ['x', 'y', 'r', 's', 'sx', 'sy', 'o'];
// dur, ease, delay, odur, odelay: tempi della sola battuta che li dichiara

/**
 * Posizione di ogni attore alla battuta [index]. [moves] = { battuta: { attore: props } } con
 * props di movimento x, y (unità SVG), r (gradi), s / sx / sy (scala), o (opacità), cumulative
 * da una battuta all'altra, e di tempo dur, ease, delay (ms), che valgono solo per la battuta
 * che le dichiara. → { attore: { ...movimento, dur, ease, delay } }
 */
export function movesAt(tl, moves, index) {
  const out = {};
  if (!moves) return out;
  for (let i = 0; i <= index && i < tl.beats.length; i++) {
    const step = moves[tl.beats[i][0]];
    if (!step) continue;
    for (const [actor, props] of Object.entries(step)) {
      const prev = out[actor] || {};
      const next = {};
      for (const k of MOTION) if (prev[k] !== undefined) next[k] = prev[k];
      Object.assign(next, props);
      out[actor] = next;
    }
  }
  return out;
}

/** Stile in linea di un attore: transform, opacity e la transizione con cui ci arriva. */
export function actorStyle(p = {}) {
  const x = p.x || 0;
  const y = p.y || 0;
  const r = p.r || 0;
  const sx = p.sx ?? p.s ?? 1;
  const sy = p.sy ?? p.s ?? 1;
  const scale = sx === sy ? `scale(${sx})` : `scale(${sx}, ${sy})`;
  const dur = Math.max(0, p.dur ?? 450);
  const delay = Math.max(0, p.delay ?? 0);
  const ease = EASE[p.ease || 'out'] || p.ease;
  // l'opacità ha tempi suoi: uno scambio fra due copie dello stesso foglio dev'essere istantaneo
  const odur = Math.max(0, p.odur ?? Math.min(dur, 300));
  const odelay = Math.max(0, p.odelay ?? delay);
  return {
    transform: `translate(${x}px, ${y}px) rotate(${r}deg) ${scale}`,
    opacity: String(p.o ?? 1),
    transition: `transform ${dur}ms ${ease} ${delay}ms, opacity ${odur}ms ease ${odelay}ms`,
  };
}

function forceStyle(el) {
  // Lettura sincrona: lo stile senza transizioni viene calcolato prima di toglierle.
  void el.getBoundingClientRect();
}

/**
 * Collega la sequenza [tl] all'elemento [root]. Opzioni: faces ({ battuta: { chi: 'bocca occhi' } }),
 * moves (vedi movesAt; gli attori sono gli elementi con data-a), onFrame(info) per gli effetti a
 * ogni fotogramma (la carta della hero), onBeat(info, { wrapped }). Gli elementi con
 * data-fx="battuta …" ripartono (classe is-fx) all'inizio di quelle battute: lampi, salti, fumetti.
 * → { play(), pause(), rest() (fotogramma finale fermo), restart(), destroy(), loop }
 */
export function bindStage(root, tl, { faces = null, moves = null, onFrame = null, onBeat = null } = {}) {
  let applied = [];
  const people = new Map();
  for (const el of root.querySelectorAll('.ffx-who')) {
    const who = [...el.classList].find((c) => c.startsWith('ffx-who-'));
    if (who) people.set(who.slice(8), el);
  }
  const actors = [...root.querySelectorAll('[data-a]')];
  const effects = [...root.querySelectorAll('[data-fx]')].map((el) => ({ el, beats: el.getAttribute('data-fx').split(/\s+/) }));
  const lastStyle = new WeakMap();

  function setFaces(index) {
    const now = faceAt(tl, faces, index);
    for (const [who, el] of people) {
      const [mouth = 'smile', eyes = 'dot'] = String(now[who] || 'smile dot').split(' ');
      if (el.getAttribute('data-mouth') !== mouth) el.setAttribute('data-mouth', mouth);
      if (el.getAttribute('data-eyes') !== eyes) el.setAttribute('data-eyes', eyes);
    }
  }

  function setActors(index) {
    if (!moves) return;
    const now = movesAt(tl, moves, index);
    for (const el of actors) {
      const st = actorStyle(now[el.getAttribute('data-a')]);
      const key = `${st.transform}|${st.opacity}`;
      if (lastStyle.get(el) === key) continue;
      lastStyle.set(el, key);
      el.style.transition = st.transition;
      el.style.transform = st.transform;
      el.style.opacity = st.opacity;
    }
  }

  function fire(id) {
    let touched = false;
    for (const fx of effects) {
      if (!fx.beats.includes(id)) continue;
      if (!touched) {
        for (const other of effects) if (other.beats.includes(id)) other.el.classList.remove('is-fx');
        forceStyle(root);
        touched = true;
      }
      fx.el.classList.add('is-fx');
    }
  }

  function apply(index, reset, fx = true) {
    const next = beatClasses(tl, index);
    if (reset) {
      root.classList.add('is-reset');
      for (const e of effects) e.el.classList.remove('is-fx');
    }
    for (const c of applied) if (!next.includes(c)) root.classList.remove(c);
    for (const c of next) root.classList.add(c);
    applied = next;
    root.setAttribute('data-beat', tl.beats[index][0]);
    setFaces(index);
    setActors(index);
    if (reset) {
      forceStyle(root);
      root.classList.remove('is-reset');
    }
    if (fx) fire(tl.beats[index][0]);
  }

  const loop = createLoop(tl, {
    onBeat(info, { wrapped }) {
      apply(info.index, wrapped || info.index === 0);
      if (onBeat) onBeat(info, { wrapped });
    },
    onFrame,
  });

  return {
    loop,
    play() {
      root.classList.remove('is-static', 'is-paused');
      root.classList.add('is-playing');
      loop.play();
    },
    pause() {
      loop.pause();
      root.classList.remove('is-playing');
      root.classList.add('is-paused');
    },
    /** Fotogramma finale fermo (animazioni ridotte): tutte le battute tranne l'uscita. */
    rest() {
      loop.pause();
      root.classList.remove('is-playing', 'is-paused');
      root.classList.add('is-static');
      const index = restingIndex(tl);
      apply(index, true, false);
      if (onFrame) onFrame({ loop: 0, t: tl.beats[index][1], index, id: tl.beats[index][0], local: 0, span: 0, progress: 1, resting: true });
    },
    restart() {
      loop.restart();
    },
    destroy() {
      loop.destroy();
    },
  };
}
