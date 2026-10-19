// Sezione 6: i modelli di stampa. Polaroid, Pieno, Striscia e Scontrino resi davvero con renderPrint
// sulla foto di esempio, appesi a uno spago come stampe appena uscite. Il rendering parte solo quando
// la sezione si avvicina allo schermo, un modello alla volta; la stampa appare riga per riga.
import { h } from '../../ui/dom.js';
import { renderPrint } from '../../render/renderer.js';
import { releaseCanvas } from '../../render/bitmap.js';
import { defaultTone } from '../../core/model.js';
import { layoutTemplate } from '../../core/template.js';
import { lang } from '../../i18n/i18n.js';
import { halftoneBurst } from '../../ui/components.js';
import { TEMPLATES, sectionHead, bitsToImageData, rasterPaint, fitThermalCanvas, shortDateTime, sagAt, art } from './kit.js';

/** Inclinazione di ciascuna stampa sullo spago e colore della molletta. */
const HANG = Object.freeze([
  Object.freeze({ tilt: -4, peg: '#FF5B45', sway: 5.6 }),
  Object.freeze({ tilt: 2.5, peg: '#FFCC00', sway: 6.4 }),
  Object.freeze({ tilt: -1.5, peg: '#22B89A', sway: 7.1 }),
  Object.freeze({ tilt: 3.5, peg: '#3D8BFF', sway: 5.9 }),
]);

/** Numero dello scontrino d'esempio, come sul brand: «RICORDO N. 0042». */
const SAMPLE_NUMBER = 42;

/** Testi d'esempio sulla carta; il modello sceglie quali usare (come nell'app). */
export function sampleTexts(t, kind, date = new Date(), locale = lang()) {
  return {
    caption: t('land_models_caption'),
    eventTitle: t('land_models_event'),
    hashtag: t('land_models_hashtag'),
    dateText: shortDateTime(date, locale),
    printNumber: kind === 'RECEIPT' ? SAMPLE_NUMBER : null,
  };
}

/** Testi fissi della carta, gli stessi dell'app (print-sheet.js). */
export function printLabels(t) {
  return {
    footer: t('ed_footer_thanks'),
    printNumber: (n) => t('ed_print_number', String(n).padStart(4, '0')),
  };
}

/** Foto della Striscia (le altre ne hanno una). */
const STRIP_PHOTOS = 3;

/** Misure della stampa (punti) prima di renderla: la carta occupa subito il suo posto. */
export function printSize(kind, texts) {
  const layout = layoutTemplate(kind, 'MM58', kind === 'STRIP' ? STRIP_PHOTOS : 1, texts);
  return { width: layout.width, height: layout.height };
}

/** Tre scatti diversi per la Striscia: la foto, la stessa specchiata e un primo piano. */
function stripPhotos(sample) {
  const w = sample.width;
  const hgt = sample.height;
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const ctx = c.getContext('2d');
    draw(ctx);
    return c;
  };
  const mirrored = make((ctx) => {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sample, 0, 0);
  });
  const close = make((ctx) => {
    // primo piano sul viso: il ritratto occupa il centro alto della foto
    const sw = w * 0.62;
    const sh = hgt * 0.62;
    ctx.drawImage(sample, (w - sw) / 2, hgt * 0.14, sw, sh, 0, 0, w, hgt);
  });
  return [sample, close, mirrored];
}

/** Lato della lente (px CSS) e punti della testina che mostra: circa 3,4 px per punto. */
const LENS_SIZE = 150;
const LENS_DOTS = 44;

/**
 * Lente d'ingrandimento sulla stampa: dove passa il mouse si vedono i punti veri della testina.
 * Solo con un puntatore preciso; è decorativa (aria-hidden), la stampa ha già la sua etichetta.
 */
function attachLens(card, env) {
  if (typeof matchMedia !== 'function' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const side = Math.round(LENS_SIZE * dpr);
  const lensCanvas = h('canvas', { width: side, height: side });
  const lens = h('div', { class: 'ffl-lens', 'aria-hidden': 'true' }, lensCanvas);
  card.fig.appendChild(lens);
  let raf = 0;
  let last = null;
  const hide = () => lens.classList.remove('is-on');
  const draw = () => {
    raf = 0;
    if (!last || card.paper.classList.contains('is-waiting')) return hide();
    const rect = card.canvas.getBoundingClientRect();
    const fx = (last.x - rect.left) / rect.width;
    const fy = (last.y - rect.top) / rect.height;
    if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return hide();
    const ctx = lensCanvas.getContext('2d');
    if (!ctx) return hide();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#FBF8F1';
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(card.canvas, fx * card.canvas.width - LENS_DOTS / 2, fy * card.canvas.height - LENS_DOTS / 2,
      LENS_DOTS, LENS_DOTS, 0, 0, side, side);
    const box = card.fig.getBoundingClientRect();
    lens.style.transform = `translate(${Math.round(last.x - box.left - LENS_SIZE / 2)}px, ${Math.round(last.y - box.top - LENS_SIZE / 2)}px)`;
    lens.classList.add('is-on');
  };
  card.paper.addEventListener('pointermove', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    last = { x: event.clientX, y: event.clientY };
    if (!raf) raf = requestAnimationFrame(draw);
  });
  card.paper.addEventListener('pointerleave', () => {
    last = null;
    hide();
  });
  env.cleanup(() => {
    if (raf) cancelAnimationFrame(raf);
  });
}

export function models(env) {
  const { t } = env;
  const titleId = 'ffl-models-title';
  let destroyed = false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const stops = [];

  const cards = TEMPLATES.map((tpl, i) => {
    const hang = HANG[i];
    const size = printSize(tpl.kind, sampleTexts(t, tpl.kind));
    const canvas = h('canvas', {
      class: 'ffl-print__canvas',
      width: size.width,
      height: size.height,
      role: 'img',
      'aria-label': t('land_models_print', t(tpl.name)),
    });
    const wait = h('p', { class: 'ffl-print__wait' }, t('land_models_printing'));
    const paper = h('div', { class: 'ffl-print__paper is-waiting' }, canvas, wait);
    const swing = h('div', { class: 'ffl-print__swing' },
      h('span', { class: 'ffl-print__peg', 'aria-hidden': 'true' }),
      paper);
    const fig = h('figure', {
      class: ['ffl-print', `ffl-print--${tpl.kind.toLowerCase()}`, 'ffl-reveal'],
      style: {
        '--ffl-tilt': `${hang.tilt}deg`,
        '--ffl-peg': hang.peg,
        '--ffl-sway': `${hang.sway}s`,
        '--ffl-sag': `${sagAt((i + 0.5) / TEMPLATES.length, 34).toFixed(1)}px`,
      },
    },
    swing,
    h('figcaption', { class: 'ffl-print__caption' },
      h('strong', { class: 'ffl-print__name' }, t(tpl.name)),
      h('span', { class: 'ffl-print__desc' }, t(tpl.desc))));
    env.play(swing);
    const card = { tpl, canvas, paper, fig };
    attachLens(card, env);
    return card;
  });

  // Lo spago: una curva che si allunga con la pagina (lo spessore resta fisso).
  const line = art('0 0 1000 60',
    '<path d="M-10 6Q500 74 1010 6" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round"/>',
    'ffl-line');
  line.setAttribute('preserveAspectRatio', 'none');

  const el = h('section', { class: 'ffl-section ffl-section--night ffl-models', id: 'ffl-models', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-models__burst', 'aria-hidden': 'true' }, halftoneBurst(260, 12)),
    h('div', { class: 'ffl-wrap' },
      sectionHead({ num: '04', eyebrow: t('land_models_eyebrow'), title: t('land_models_title'), lead: t('land_models_lead'), id: titleId }),
      h('div', { class: 'ffl-models__rail' }, line,
        h('div', { class: 'ffl-models__prints' }, ...cards.map((c) => c.fig)))));

  async function renderAll() {
    const locale = lang();
    const cache = env.state.prints || (env.state.prints = {});
    const own = cache[locale] || (cache[locale] = {});
    let photos = null;
    for (const card of cards) {
      if (destroyed) return;
      const kind = card.tpl.kind;
      let image = own[kind];
      const fresh = !image;
      if (!image) {
        try {
          if (!photos) {
            const sample = await env.samplePhoto();
            if (destroyed) return;
            photos = stripPhotos(sample);
          }
          const rendered = await renderPrint({
            photos: kind === 'STRIP' ? photos.slice(0, STRIP_PHOTOS) : [photos[0]],
            template: kind,
            paper: 'MM58',
            dither: 'ATKINSON',
            tone: defaultTone(),
            texts: sampleTexts(t, kind, new Date(), locale),
            labels: printLabels(t),
            signal: controller ? controller.signal : undefined,
          });
          releaseCanvas(rendered.canvas);
          image = bitsToImageData(rendered.bitImage);
          own[kind] = image;
        } catch (e) {
          if (e && (e.name === 'AbortError' || e.code === 'aborted')) return;
          console.error(`[landing] modello ${kind} non reso`, e);
          card.paper.classList.add('is-failed');
          continue;
        }
      }
      if (destroyed) return;
      const show = (painted, animate) => {
        if (destroyed) return;
        card.paper.classList.remove('is-waiting');
        stops.push(rasterPaint(card.canvas, painted, { animate, duration: 1100 }));
        fitThermalCanvas(card.canvas);
      };
      // La stampa appena resa esce riga per riga quando la si vede; quella già in cache compare e basta.
      if (fresh && !env.reduced) env.near(card.paper, () => show(image, true), '0px 0px -12% 0px');
      else show(image, false);
      // un attimo di respiro tra un modello e l'altro: la pagina resta reattiva
      if (fresh) await new Promise((resolve) => setTimeout(resolve, 60));
    }
    if (photos) photos.slice(1).forEach(releaseCanvas);
  }

  env.near(el, () => {
    renderAll().catch((e) => console.error('[landing] modelli non resi', e));
  }, '200px');

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => cards.forEach((c) => fitThermalCanvas(c.canvas)));
    cards.forEach((c) => ro.observe(c.paper));
    env.cleanup(() => ro.disconnect());
  }

  env.cleanup(() => {
    destroyed = true;
    if (controller) controller.abort();
    stops.forEach((stop) => stop());
  });

  return { el };
}
