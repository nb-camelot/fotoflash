// Attrezzi comuni delle sezioni della presentazione: costanti, funzioni pure (provate in Node) e
// piccoli costruttori di DOM. Il DOM si tocca solo dentro le funzioni.
import { h, s, uniqueId } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { toRgba } from '../../core/bitimage.js';

export const APK_URL = 'https://github.com/nb-camelot/fotoflash/releases/latest';
export const REPO_URL = 'https://github.com/nb-camelot/fotoflash';
export const ISSUES_URL = 'https://github.com/nb-camelot/fotoflash/issues';

/** Ink e Paper del brand: i punti della testina come inchiostro su carta (come print-sheet.js). */
export const INK_RGBA = Object.freeze([0x16, 0x13, 0x0f, 255]);
export const PAPER_RGBA = Object.freeze([0xfb, 0xf8, 0xf1, 255]);

/** I quattro retini del motore, con il nome dell'app e la riga di spiegazione della presentazione. */
export const DITHERS = Object.freeze([
  Object.freeze({ value: 'ATKINSON', name: 'ed_dither_atkinson', hint: 'land_try_hint_atkinson' }),
  Object.freeze({ value: 'FLOYD_STEINBERG', name: 'ed_dither_floyd', hint: 'land_try_hint_floyd' }),
  Object.freeze({ value: 'ORDERED_BAYER', name: 'ed_dither_bayer', hint: 'land_try_hint_bayer' }),
  Object.freeze({ value: 'THRESHOLD', name: 'ed_dither_threshold', hint: 'land_try_hint_threshold' }),
]);

/** I quattro modelli di stampa, con nome e descrizione dell'editor. */
export const TEMPLATES = Object.freeze([
  Object.freeze({ kind: 'POLAROID', name: 'ed_template_polaroid', desc: 'ed_template_polaroid_desc' }),
  Object.freeze({ kind: 'FULL', name: 'ed_template_full', desc: 'ed_template_full_desc' }),
  Object.freeze({ kind: 'STRIP', name: 'ed_template_strip', desc: 'ed_template_strip_desc' }),
  Object.freeze({ kind: 'RECEIPT', name: 'ed_template_receipt', desc: 'ed_template_receipt_desc' }),
]);

/** Voce del retino per valore (ATKINSON se sconosciuto). */
export function ditherInfo(value) {
  return DITHERS.find((d) => d.value === value) || DITHERS[0];
}

/** Rotta dell'app per «Apri l'app»: la fotocamera, oppure l'onboarding se il primo avvio non è finito. */
export function appRoute(settings) {
  try {
    const current = settings && typeof settings.get === 'function' ? settings.get() : null;
    return current && current.onboardingDone ? '/camera' : '/onboarding';
  } catch {
    return '/onboarding';
  }
}

/** Indirizzo da mandarsi sul telefono: la pagina senza hash (la rotta la sceglie il telefono). */
export function pageUrl(loc) {
  if (!loc) return '';
  const origin = loc.origin && loc.origin !== 'null' ? loc.origin : '';
  if (origin) return `${origin}${loc.pathname || '/'}`;
  return String(loc.href || '').split('#')[0];
}

/** Valori degli slider come nell'editor: segnati (-1..1 → −100..+100) o semplici (0..1 → 0..100). */
export function signed(v) {
  const n = Math.round(Number(v) * 100) || 0;
  return n > 0 ? `+${n}` : String(n);
}

export function plain(v) {
  return String(Math.round(Number(v) * 100) || 0);
}

/**
 * Pixel netti solo se ogni punto della testina copre almeno un pixel del dispositivo: rimpicciolendo,
 * il "vicino più prossimo" salta interi punti e la foto si riempie di righe; meglio la media.
 */
export function pixelatedFor(cssWidth, dpr, dots) {
  const w = Number(cssWidth) * (Number(dpr) || 1);
  return Number.isFinite(w) && dots > 0 && w >= dots - 0.5;
}

/** Data e ora brevi nella lingua indicata (sulla carta delle stampe d'esempio). */
export function shortDateTime(date, locale) {
  try {
    return new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** Posizione sullo spago dei 4 modelli (0..1 da sinistra): la curva dà a ciascuno il suo abbassamento. */
export function sagAt(x, depth) {
  const t = Math.min(1, Math.max(0, Number(x) || 0));
  return 4 * depth * t * (1 - t);
}

// ------------------------------------------------------------------ immagini a 1 bit

/** ImageData Ink su Paper di una BitImage (1 punto = 1 pixel). */
export function bitsToImageData(bits) {
  return new ImageData(toRgba(bits, INK_RGBA, PAPER_RGBA), bits.width, bits.height);
}

/**
 * Disegna l'immagine sul canvas riga per riga, come esce dalla testina (requestAnimationFrame).
 * Senza animazione la disegna subito. Restituisce la funzione che ferma l'effetto (l'immagine
 * resta a metà: chi la ferma ridisegna).
 */
export function rasterPaint(canvas, image, { animate = false, duration = 700, onDone } = {}) {
  if (canvas.width !== image.width) canvas.width = image.width;
  if (canvas.height !== image.height) canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  if (!animate || typeof requestAnimationFrame !== 'function') {
    ctx.putImageData(image, 0, 0);
    if (onDone) onDone();
    return () => {};
  }
  const w = image.width;
  const hgt = image.height;
  ctx.fillStyle = '#FBF8F1';
  ctx.fillRect(0, 0, w, hgt);
  let start = null;
  let row = 0;
  let raf = 0;
  let stopped = false;
  const step = (now) => {
    if (stopped) return;
    if (start === null) start = now;
    const p = Math.min(1, (now - start) / duration);
    // un poco più lenta all'inizio, come la carta che prende velocità
    const eased = p * p * (3 - 2 * p);
    const target = p >= 1 ? hgt : Math.ceil(eased * hgt);
    if (target > row) {
      ctx.putImageData(image, 0, 0, 0, row, w, target - row);
      row = target;
    }
    if (p < 1) raf = requestAnimationFrame(step);
    else if (onDone) onDone();
  };
  raf = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/** Sceglie pixelated o media secondo la misura a schermo; da richiamare al ridimensionamento. */
export function fitThermalCanvas(canvas) {
  if (!canvas || !canvas.isConnected) return;
  const width = canvas.getBoundingClientRect().width;
  if (!width) return;
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  canvas.style.imageRendering = pixelatedFor(width, dpr, canvas.width) ? 'pixelated' : 'auto';
}

// ------------------------------------------------------------------ DOM

/** Intestazione di sezione: numero e occhiello in Space Mono, titolo Righteous, attacco. */
export function sectionHead({ num, eyebrow, title, lead, id, align = 'start' }) {
  return h('header', { class: ['ffl-head', `ffl-head--${align}`, 'ffl-reveal'] },
    h('p', { class: 'ffl-eyebrow' },
      num ? h('span', { class: 'ffl-eyebrow__num', 'aria-hidden': 'true' }, num) : null,
      h('span', null, eyebrow)),
    h('h2', { class: 'ffl-h2', id, tabIndex: -1 }, title),
    lead ? h('p', { class: 'ffl-lead' }, lead) : null);
}

/**
 * Pulsante o collegamento "adesivo": faccia piena, contorno Ink e ombra dura che resta ferma
 * mentre la faccia si solleva. variant: 'flash' | 'paper' | 'ink' | 'coral'.
 */
export function stickerButton({ text, icon: iconName, variant = 'paper', href, external = false, onClick, size = 'md', label, newTabText, attrs }) {
  const children = [
    iconName ? icon(iconName, { size: size === 'lg' ? 24 : 20 }) : null,
    h('span', { class: 'ffl-btn__label' }, text),
    external && newTabText ? h('span', { class: 'ff-sr-only' }, ` ${newTabText}`) : null,
  ];
  const cls = ['ffl-btn', `ffl-btn--${variant}`, `ffl-btn--${size}`];
  const el = href
    ? h('a', { class: cls, href, target: external ? '_blank' : undefined, rel: external ? 'noopener noreferrer' : undefined, attrs }, ...children)
    : h('button', { class: cls, type: 'button', attrs }, ...children);
  if (label) el.setAttribute('aria-label', label);
  if (onClick) el.addEventListener('click', onClick);
  el.setText = (value) => {
    el.querySelector('.ffl-btn__label').textContent = value;
  };
  return el;
}

/** Etichetta a pillola in Space Mono (stati, collegamenti, note). tone: 'paper' | 'mint' | 'flash' | 'ink' | 'sky'. */
export function pill(text, { tone = 'paper', icon: iconName } = {}) {
  return h('span', { class: ['ffl-pill', `ffl-pill--${tone}`] }, iconName ? icon(iconName, { size: 16 }) : null, h('span', null, text));
}

/** Svg decorativo da markup statico di questo modulo (mai testo dell'utente). */
export function art(viewBox, markup, className) {
  const el = s('svg', { viewBox, class: className, 'aria-hidden': 'true', focusable: 'false' });
  el.innerHTML = markup;
  return el;
}

/** Id unici per pattern e clipPath degli SVG ripetuti nella pagina. */
export function svgId(prefix) {
  return uniqueId(`ffl-${prefix}`);
}

/** Scintilla a quattro punte con i lati concavi (motivo del brand), centrata in (x, y). */
export function sparklePath(x, y, r) {
  const k = r * 0.28;
  const f = (n) => Math.round(n * 10) / 10;
  return `M${f(x)} ${f(y - r)}Q${f(x + k)} ${f(y - k)} ${f(x + r)} ${f(y)}Q${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + r)}Q${f(x - k)} ${f(y + k)} ${f(x - r)} ${f(y)}Q${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - r)}Z`;
}
