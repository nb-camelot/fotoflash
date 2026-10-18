// Sezione 5: «Prova il retino». La foto di esempio, o una foto dell'utente (resta nel browser),
// passa dal motore vero: GrayImage → applyTone → dither, a 384 punti come la carta da 58 mm.
// L'anteprima è la stampa: un pixel per punto, ingrandita senza filtri, Ink su Paper.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { chipsRow, slider } from '../../ui/components.js';
import { defaultTone } from '../../core/model.js';
import { applyTone } from '../../core/tone.js';
import { dither } from '../../core/dither.js';
import { grayFromSource, drawCover } from '../../render/bitmap.js';
import { loadImageFile } from '../../media/import.js';
import {
  DITHERS, ditherInfo, sectionHead, signed, plain, bitsToImageData, rasterPaint, fitThermalCanvas,
  stickerButton, art,
} from './kit.js';

/** Punti per riga della carta da 58 mm (PaperWidth.MM58) e righe di una foto 3:4. */
export const PREVIEW_DOTS = 384;
export const PREVIEW_ROWS = 512;
const PREVIEW_DPI = 203;
/** Lato lungo massimo di una foto caricata: basta e avanza per 384 punti, e la memoria ringrazia. */
const USER_MAX_SIDE = 1600;

/** Stato dell'interattivo, conservato tra un cambio di lingua e l'altro. */
export function tryState(state) {
  if (!state.try) {
    const tone = defaultTone();
    state.try = {
      algorithm: 'ATKINSON',
      brightness: tone.brightness,
      contrast: tone.contrast,
      shadows: tone.shadows,
      showOriginal: false,
      user: null, // ImageBitmap della foto dell'utente, o null per la foto di esempio
      gray: null, // GrayImage 384 × 512 della sorgente corrente
      image: null, // ImageData dell'ultima anteprima
    };
  }
  return state.try;
}

/** Regolazioni passate al motore: quelle di fabbrica più i tre slider. */
export function toneFor(st) {
  return { ...defaultTone(), brightness: st.brightness, contrast: st.contrast, shadows: st.shadows };
}

export function trySection(env) {
  const { t } = env;
  const st = tryState(env.state);
  const titleId = 'ffl-try-title';
  let destroyed = false;
  let active = false;
  let pending = 0;
  let stopRaster = () => {};

  // ---------------------------------------------------------------- carta e anteprima

  const thermal = h('canvas', { class: 'ffl-try__thermal', width: PREVIEW_DOTS, height: PREVIEW_ROWS, role: 'img' });
  const original = h('canvas', {
    class: 'ffl-try__original',
    width: PREVIEW_DOTS,
    height: PREVIEW_ROWS,
    role: 'img',
    'aria-label': t('land_try_original_label'),
  });
  const busyNote = h('p', { class: 'ffl-try__busy' }, h('span', { class: 'ffl-try__head', 'aria-hidden': 'true' }), t('land_try_loading'));
  const dropNote = h('p', { class: 'ffl-try__drop', 'aria-hidden': 'true' }, icon('upload', { size: 32 }), t('land_try_drop'));
  const frame = h('div', { class: 'ffl-try__frame' }, thermal, original, busyNote, dropNote);
  const meta = h('figcaption', { class: 'ffl-try__meta' });
  const sheet = h('figure', { class: 'ffl-try__sheet' }, h('div', { class: 'ffl-paper-sheet' }, frame, meta));

  // freccia a mano libera dalla nota verso la carta (in alto a sinistra)
  const arrow = art('0 0 100 80',
    '<path d="M96 62C66 66 34 52 14 16" fill="none" stroke="#16130F" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M8 34L13 14L32 22" fill="none" stroke="#16130F" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    'ffl-try__arrow');
  const note = h('p', { class: 'ffl-try__note' }, h('span', null, t('land_try_note')), arrow);

  // ---------------------------------------------------------------- comandi

  const algoLabelId = 'ffl-try-algo';
  const chips = chipsRow(
    DITHERS.map((d) => ({ value: d.value, label: t(d.name) })),
    st.algorithm,
    null,
    (value) => {
      st.algorithm = value;
      updateTexts();
      compute(true);
      announce(t('land_try_ready', t(ditherInfo(value).name)));
    },
    { ariaLabel: t('land_try_algo') },
  );
  chips.el.removeAttribute('aria-label');
  chips.el.setAttribute('aria-labelledby', algoLabelId);
  const hint = h('p', { class: 'ffl-try__hint' });

  const sliders = [
    slider({
      label: t('ed_adjust_brightness'), min: -1, max: 1, step: 0.01, value: st.brightness, format: signed,
      onInput: (v) => { st.brightness = v; schedule(); },
    }),
    slider({
      label: t('ed_adjust_contrast'), min: -1, max: 1, step: 0.01, value: st.contrast, format: signed,
      onInput: (v) => { st.contrast = v; schedule(); },
    }),
    slider({
      label: t('ed_adjust_shadows'), min: 0, max: 1, step: 0.01, value: st.shadows, format: plain,
      onInput: (v) => { st.shadows = v; schedule(); },
    }),
  ];

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'ff-sr-only',
    tabIndex: -1,
    'aria-hidden': 'true',
    onChange: () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) useFile(file);
    },
  });
  const uploadBtn = stickerButton({ text: t('land_try_upload'), icon: 'image', variant: 'flash', onClick: () => fileInput.click() });
  const sampleBtn = stickerButton({ text: t('land_try_sample'), icon: 'refresh', variant: 'paper', size: 'sm', onClick: useSample });
  const originalBtn = stickerButton({ text: t('land_try_show_original'), icon: 'eye', variant: 'paper', size: 'sm', onClick: toggleOriginal });
  originalBtn.setAttribute('aria-pressed', 'false');
  const status = h('p', { class: 'ffl-try__status', role: 'status', 'aria-live': 'polite' });

  const panel = h('div', { class: 'ffl-try__panel ffl-reveal' },
    h('p', { class: 'ffl-label', id: algoLabelId }, t('land_try_algo')),
    chips.el,
    hint,
    h('div', { class: 'ffl-try__sliders' }, ...sliders.map((sl) => sl.el)),
    h('div', { class: 'ffl-try__actions' }, uploadBtn, sampleBtn, originalBtn),
    h('p', { class: 'ffl-try__private' }, icon('check', { size: 18 }), h('span', null, t('land_try_private'))),
    status,
    fileInput);

  const el = h('section', { class: 'ffl-section ffl-section--flash ffl-try', id: 'ffl-try', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-wrap' },
      sectionHead({ num: '03', eyebrow: t('land_try_eyebrow'), title: t('land_try_title'), lead: t('land_try_lead'), id: titleId }),
      h('div', { class: 'ffl-try__grid' },
        h('div', { class: 'ffl-try__paperside ffl-reveal' }, sheet, note),
        panel)));

  // ---------------------------------------------------------------- logica

  function updateTexts() {
    const name = t(ditherInfo(st.algorithm).name);
    meta.textContent = t('land_try_meta', PREVIEW_DOTS, PREVIEW_DPI, name);
    hint.textContent = t(ditherInfo(st.algorithm).hint);
    thermal.setAttribute('aria-label', t('land_try_preview', name));
    sampleBtn.hidden = !st.user;
    originalBtn.setAttribute('aria-pressed', st.showOriginal ? 'true' : 'false');
    frame.classList.toggle('is-original', st.showOriginal);
    // la foto nascosta non si fa leggere
    thermal.setAttribute('aria-hidden', st.showOriginal ? 'true' : 'false');
    original.setAttribute('aria-hidden', st.showOriginal ? 'false' : 'true');
  }

  function announce(text) {
    status.textContent = text;
  }

  function setBusy(on) {
    frame.classList.toggle('is-busy', !!on);
  }

  function paint(animate) {
    stopRaster();
    if (!st.image) return;
    stopRaster = rasterPaint(thermal, st.image, { animate: animate && !env.reduced, duration: 650 });
    fitThermalCanvas(thermal);
  }

  /** Il motore vero, sulla GrayImage già ritagliata a 384 × 512. */
  function compute(animate) {
    if (!st.gray || destroyed) return;
    try {
      const bits = dither(applyTone(st.gray, toneFor(st)), st.algorithm);
      st.image = bitsToImageData(bits);
      paint(animate);
    } catch (e) {
      console.error('[landing] anteprima del retino non riuscita', e);
      announce(t('land_try_error'));
    }
  }

  // Gli slider muovono decine di valori al secondo: un solo calcolo per fotogramma.
  function schedule() {
    if (!active || pending) return;
    if (typeof requestAnimationFrame !== 'function') {
      compute(false);
      return;
    }
    pending = requestAnimationFrame(() => {
      pending = 0;
      compute(false);
    });
  }

  function drawOriginal(source) {
    const ctx = original.getContext('2d');
    if (!ctx || !source) return;
    ctx.fillStyle = '#FBF8F1';
    ctx.fillRect(0, 0, original.width, original.height);
    drawCover(ctx, source, { left: 0, top: 0, width: original.width, height: original.height });
  }

  async function currentSource() {
    return st.user || env.samplePhoto();
  }

  async function activate() {
    if (destroyed) return;
    active = true;
    if (st.gray && st.image) {
      // dopo un cambio di lingua: stessa anteprima, subito, senza rifare i conti
      paint(false);
      currentSource().then((src) => !destroyed && drawOriginal(src)).catch(() => {});
      return;
    }
    setBusy(true);
    try {
      const source = await currentSource();
      if (destroyed) return;
      st.gray = grayFromSource(source, PREVIEW_DOTS, PREVIEW_ROWS);
      drawOriginal(source);
      compute(true);
    } catch (e) {
      console.error('[landing] foto di esempio non disponibile', e);
      announce(t('land_try_error'));
    } finally {
      setBusy(false);
    }
  }

  async function useFile(file) {
    setBusy(true);
    try {
      const bitmap = await loadImageFile(file, USER_MAX_SIDE);
      if (destroyed) {
        closeSource(bitmap);
        return;
      }
      closeSource(st.user);
      st.user = bitmap;
      st.gray = grayFromSource(bitmap, PREVIEW_DOTS, PREVIEW_ROWS);
      active = true;
      drawOriginal(bitmap);
      updateTexts();
      compute(true);
      announce(t('land_try_ready', t(ditherInfo(st.algorithm).name)));
    } catch (e) {
      console.warn('[landing] foto non caricata', e);
      announce(t('land_try_error'));
    } finally {
      setBusy(false);
    }
  }

  function useSample() {
    closeSource(st.user);
    st.user = null;
    st.gray = null;
    st.image = null;
    updateTexts();
    activate();
    uploadBtn.focus();
  }

  function toggleOriginal() {
    st.showOriginal = !st.showOriginal;
    updateTexts();
  }

  // Trascinare una foto sulla sezione: comodo su desktop, resta tutto nel browser.
  let dragDepth = 0;
  const hasFiles = (event) => !!event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
  el.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    frame.classList.add('is-drop');
  });
  el.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) frame.classList.remove('is-drop');
  });
  el.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    frame.classList.remove('is-drop');
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) useFile(file);
  });

  // Pixel netti o media secondo la misura a schermo.
  if (typeof ResizeObserver === 'function') {
    // solo la carta è punto per punto: l'originale a colori resta sfumato
    const ro = new ResizeObserver(() => fitThermalCanvas(thermal));
    ro.observe(frame);
    env.cleanup(() => ro.disconnect());
  }

  updateTexts();
  env.near(el, activate, '400px');
  env.cleanup(() => {
    destroyed = true;
    stopRaster();
    if (pending) cancelAnimationFrame(pending);
  });

  return { el };
}

function closeSource(source) {
  if (source && typeof source.close === 'function') {
    try {
      source.close();
    } catch {
      // già chiusa
    }
  }
}

/** Libera la foto dell'utente (all'uscita dalla presentazione). */
export function releaseTryState(state) {
  if (!state || !state.try) return;
  closeSource(state.try.user);
  state.try.user = null;
  state.try.gray = null;
  state.try.image = null;
}
