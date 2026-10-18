// Componenti dell'interfaccia con lo stile del brand (porting di ui/components dell'app Android).
// Accessibili da tastiera e lettore di schermo, aree di tocco di almeno 48 px.
import { h, s, clear, uniqueId, reducedMotion } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n/i18n.js';

// ---------------------------------------------------------------------------------------------
// Barra in alto

function actionElement(action) {
  if (!action) return null;
  if (typeof Node !== 'undefined' && action instanceof Node) return action;
  return iconButton(action.icon, action);
}

/** Barra in alto: titolo centrato in Righteous, freccia indietro se c'è onBack, azioni a destra. */
export function topBar({ title = '', onBack = null, actions = [] } = {}) {
  const start = h('div', { class: 'ff-topbar__start' },
    onBack ? iconButton('back', { label: t('common_back'), onClick: onBack }) : null);
  const heading = h('h1', { class: 'ff-topbar__title', tabIndex: -1 }, title);
  const end = h('div', { class: 'ff-topbar__end' }, actions.map(actionElement));
  const el = h('header', { class: 'ff-topbar' }, start, heading, end);
  el.setTitle = (text) => {
    heading.textContent = text;
  };
  return el;
}

// ---------------------------------------------------------------------------------------------
// Pulsanti

/** Mette o toglie lo stato "in corso" su un pulsante creato qui: resta visibile ma non risponde. */
export function setButtonBusy(btn, busy) {
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  const note = btn.querySelector('.ff-btn__busy');
  if (note) note.hidden = !busy;
}

/** Pulsante generico: variant 'flash' | 'ghost' | 'text' | 'danger'. */
export function button(variant, text, opts = {}) {
  const { icon: iconName, onClick, busy = false, disabled = false, block = false, small = false, label, type = 'button' } = opts;
  const labelEl = h('span', { class: 'ff-btn__label' }, text);
  const btn = h('button', {
    type,
    class: ['ff-btn', `ff-btn--${variant}`, block && 'ff-btn--block', small && 'ff-btn--small'],
  },
  h('span', { class: 'ff-spinner ff-btn__spinner', 'aria-hidden': 'true' }),
  iconName ? icon(iconName) : null,
  labelEl,
  h('span', { class: 'ff-sr-only ff-btn__busy', hidden: true }, t('common_loading')));
  if (label) btn.setAttribute('aria-label', label);
  btn.disabled = !!disabled;
  setButtonBusy(btn, busy);
  btn.addEventListener('click', (event) => {
    // Durante un'attesa il tocco non deve ripartire (doppia stampa, doppio salvataggio).
    if (btn.getAttribute('aria-busy') === 'true') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (onClick) onClick(event);
  });
  btn.setBusy = (on) => setButtonBusy(btn, on);
  btn.setText = (value) => {
    labelEl.textContent = value;
  };
  return btn;
}

/** Pulsante primario giallo con il gradino 3D. Una sola azione principale per schermata. */
export function flashButton(text, opts = {}) {
  return button('flash', text, opts);
}

/** Pulsante secondario a contorno. */
export function ghostButton(text, opts = {}) {
  return button('ghost', text, opts);
}

/** Pulsante testuale per azioni leggere. */
export function textButton(text, opts = {}) {
  return button('text', text, opts);
}

/** Pulsante tondo con sola icona; label è il nome letto dal lettore di schermo. */
export function iconButton(name, opts = {}) {
  const { label, onClick, active = false, disabled = false } = opts;
  const btn = h('button', {
    type: 'button',
    class: ['ff-iconbtn', active && 'is-active'],
    'aria-label': label,
    title: label,
  }, icon(name));
  // aria-pressed solo per i veri interruttori (chi passa active)
  if (Object.prototype.hasOwnProperty.call(opts, 'active')) btn.setAttribute('aria-pressed', String(!!active));
  btn.disabled = !!disabled;
  if (onClick) btn.addEventListener('click', onClick);
  btn.setActive = (on) => {
    btn.classList.toggle('is-active', !!on);
    if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', String(!!on));
  };
  btn.setIcon = (next) => {
    btn.replaceChild(icon(next), btn.firstChild);
  };
  btn.setLabel = (text) => {
    btn.setAttribute('aria-label', text);
    btn.title = text;
  };
  return btn;
}

/** Spinner circolare (decorativo). */
export function spinner() {
  return h('span', { class: 'ff-spinner', 'aria-hidden': 'true' });
}

// ---------------------------------------------------------------------------------------------
// Otturatore

/** Otturatore: anello bianco e disco giallo; con countdown mostra il numero, con busy lo spinner. */
export function shutterButton({ onClick, busy = false, countdown = null, disabled = false } = {}) {
  const state = { busy, countdown, disabled };
  const disc = h('span', { class: 'ff-shutter__disc', 'aria-hidden': 'true' });
  const live = h('span', { class: 'ff-sr-only', 'aria-live': 'polite' });
  const el = h('button', { type: 'button', class: 'ff-shutter', 'aria-label': t('common_shutter') }, disc, live);
  let shownCount = null;

  function render() {
    el.disabled = !!state.disabled;
    el.setAttribute('aria-busy', state.busy ? 'true' : 'false');
    if (state.busy) {
      clear(disc);
      disc.appendChild(spinner());
      shownCount = null;
      live.textContent = t('common_shutter_busy');
    } else if (state.countdown !== null && state.countdown !== undefined) {
      // Un elemento nuovo a ogni secondo fa ripartire l'animazione di ingresso.
      if (shownCount !== state.countdown) {
        clear(disc);
        disc.appendChild(h('span', { class: 'ff-shutter__count' }, String(state.countdown)));
        live.textContent = t('common_shutter_countdown', state.countdown);
        shownCount = state.countdown;
      }
    } else {
      clear(disc);
      shownCount = null;
      live.textContent = '';
    }
  }

  el.addEventListener('click', (event) => {
    if (state.busy || state.disabled) return;
    if (onClick) onClick(event);
  });
  render();
  return {
    el,
    set(next = {}) {
      Object.assign(state, next);
      render();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Carta e immagine termica

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Foglio di carta termica con i bordi strappati a dente di sega (12 × 6 px). Resta Paper con testo
 * Ink anche nel tema scuro: è carta. Il primo argomento può essere { top, bottom, class }.
 */
export function paperSheet(...children) {
  let opts = {};
  if (isPlainObject(children[0])) opts = children.shift();
  const { top = true, bottom = true, class: extra } = opts;
  return h('div', {
    class: ['ff-paper', !top && 'ff-paper--flat-top', !bottom && 'ff-paper--flat-bottom', extra],
  }, ...children);
}

/** Immagine a 1 bit ingrandita senza filtri, a tutta larghezza: è esattamente quello che stampa. */
export function thermalImage(canvas, { label } = {}) {
  canvas.style.imageRendering = 'pixelated';
  return h('div', { class: 'ff-thermal', role: label ? 'img' : null, 'aria-label': label || null }, canvas);
}

// ---------------------------------------------------------------------------------------------
// Scelte

function chipOption(option, label) {
  if (isPlainObject(option) && 'value' in option) {
    const text = option.label !== undefined ? option.label : typeof label === 'function' ? label(option.value) : String(option.value);
    return { value: option.value, text, icon: option.icon || null, disabled: !!option.disabled };
  }
  return { value: option, text: typeof label === 'function' ? label(option) : String(option), icon: null, disabled: false };
}

/**
 * Riga di chip a scelta singola (radio). options: valori o { value, label, icon }; label: funzione
 * valore → testo (oppure una stringa, usata come nome del gruppo). Il chip scelto è giallo con la spunta.
 */
export function chipsRow(options, selected, label, onSelect, { ariaLabel } = {}) {
  const items = options.map((o) => chipOption(o, label));
  const el = h('div', {
    class: 'ff-chips',
    role: 'radiogroup',
    'aria-label': ariaLabel || (typeof label === 'string' ? label : null),
  });
  let current = selected;
  const buttons = items.map((item, index) => {
    const btn = h('button', {
      type: 'button',
      class: 'ff-chip',
      role: 'radio',
      disabled: item.disabled,
      onClick: () => choose(index, true),
      onKeydown: (event) => onKey(event, index),
    },
    icon('check', { size: 18, className: 'ff-chip__check' }),
    item.icon ? icon(item.icon, { size: 18 }) : null,
    h('span', null, item.text));
    el.appendChild(btn);
    return btn;
  });

  function render(scroll) {
    let selectedIndex = items.findIndex((item) => Object.is(item.value, current));
    buttons.forEach((btn, i) => {
      const on = i === selectedIndex;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.tabIndex = on || (selectedIndex < 0 && i === 0) ? 0 : -1;
    });
    if (selectedIndex < 0) selectedIndex = 0;
    if (scroll) requestAnimationFrame(() => reveal(buttons[selectedIndex], scroll === 'smooth'));
  }

  // Porta in vista il chip scelto scorrendo solo la riga, non la pagina.
  function reveal(btn, smooth) {
    if (!btn || !el.isConnected) return;
    const row = el.getBoundingClientRect();
    const box = btn.getBoundingClientRect();
    if (box.left >= row.left && box.right <= row.right) return;
    const delta = box.left + box.width / 2 - (row.left + row.width / 2);
    el.scrollBy({ left: delta, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }

  function choose(index, notify) {
    const item = items[index];
    if (!item || item.disabled) return;
    const changed = !Object.is(item.value, current);
    current = item.value;
    render('smooth');
    if (notify && changed && onSelect) onSelect(item.value);
  }

  function onKey(event, index) {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next = null;
    if (event.key in keys) {
      next = index;
      for (let step = 0; step < items.length; step++) {
        next = (next + keys[event.key] + items.length) % items.length;
        if (!items[next].disabled) break;
      }
    } else if (event.key === 'Home') {
      next = items.findIndex((i) => !i.disabled);
    } else if (event.key === 'End') {
      next = items.length - 1 - [...items].reverse().findIndex((i) => !i.disabled);
    }
    if (next === null || next < 0) return;
    event.preventDefault();
    choose(next, true);
    buttons[next].focus();
  }

  render('auto');
  return {
    el,
    set(value) {
      current = value;
      render('smooth');
    },
  };
}

/** Slider con etichetta e valore in Space Mono. onInput a ogni movimento, onChange al rilascio. */
export function slider({ label, min = 0, max = 1, step = 0.01, value = 0, format, onInput, onChange, desc } = {}) {
  const id = uniqueId('slider');
  const descId = desc ? uniqueId('slider-desc') : null;
  const fmt = typeof format === 'function' ? format : (v) => String(v);
  const valueEl = h('span', { class: 'ff-slider__value', 'aria-hidden': 'true' });
  const input = h('input', {
    type: 'range',
    class: 'ff-range',
    id,
    min: String(min),
    max: String(max),
    step: String(step),
    'aria-describedby': descId,
  });

  function paint(v) {
    const span = Number(max) - Number(min);
    const pct = span > 0 ? ((v - Number(min)) / span) * 100 : 0;
    input.style.setProperty('--p', `${Math.min(100, Math.max(0, pct))}%`);
    const text = fmt(v);
    valueEl.textContent = text;
    input.setAttribute('aria-valuetext', text);
  }

  input.value = String(value);
  paint(Number(input.value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    if (onInput) onInput(v);
  });
  input.addEventListener('change', () => {
    if (onChange) onChange(Number(input.value));
  });

  const el = h('div', { class: 'ff-slider' },
    h('div', { class: 'ff-slider__head' },
      h('label', { class: 'ff-slider__label', htmlFor: id }, label),
      valueEl),
    desc ? h('p', { class: 'ff-slider__desc', id: descId }, desc) : null,
    input);
  return {
    el,
    input,
    set(v) {
      input.value = String(v);
      paint(Number(input.value));
    },
  };
}

/** Interruttore su tutta la riga (etichetta, descrizione e switch accessibile). */
export function toggle({ label, desc, checked = false, onChange, icon: iconName, disabled = false } = {}) {
  const id = uniqueId('toggle');
  const labelId = uniqueId('toggle-label');
  const descId = desc ? uniqueId('toggle-desc') : null;
  // Nome dalla sola etichetta: la descrizione arriva una volta, come descrizione.
  const input = h('input', {
    type: 'checkbox',
    role: 'switch',
    class: 'ff-switch',
    id,
    'aria-labelledby': labelId,
    'aria-describedby': descId,
  });
  input.checked = !!checked;
  input.disabled = !!disabled;
  input.addEventListener('change', () => {
    if (onChange) onChange(input.checked);
  });
  const el = h('label', { class: 'ff-toggle', htmlFor: id },
    iconName ? icon(iconName) : null,
    h('span', { class: 'ff-toggle__text' },
      h('span', { class: 'ff-toggle__label', id: labelId }, label),
      desc ? h('span', { class: 'ff-toggle__desc', id: descId }, desc) : null),
    input);
  return {
    el,
    input,
    set(v) {
      input.checked = !!v;
    },
  };
}

/** Intestazione di sezione "da scontrino": Space Mono maiuscolo e riga tratteggiata. */
export function sectionHeader(text) {
  return h('h2', { class: 'ff-section-title' }, text);
}

// ---------------------------------------------------------------------------------------------
// Stato della stampante

const FAILURE_LABELS = {
  UNSUPPORTED: 'common_printer_err_unsupported',
  NO_PRINTER: 'common_printer_err_no_printer',
  BLUETOOTH_OFF: 'common_printer_err_bluetooth_off',
  CONNECT_FAILED: 'common_printer_err_connect',
  WRITE_FAILED: 'common_printer_err_write',
  BUSY: 'common_printer_err_busy',
  RENDER_FAILED: 'common_printer_err_render',
  CAT_PRINTER: 'common_printer_err_cat',
  NO_CHANNEL: 'common_printer_err_no_channel',
};

/** Etichetta breve di un esito di stampa ('BLUETOOTH_OFF' → "Bluetooth spento"). */
export function failureLabel(failure) {
  return t(FAILURE_LABELS[failure] || 'common_printer_err_connect');
}

/** Come mostrare uno stato del PrinterManager: tipo per i colori, testo, frase per il lettore. */
export function printerLook(state) {
  const st = state || { kind: 'not-paired' };
  const name = st.name || null;
  const shown = name || t('common_printer_unnamed');
  switch (st.kind) {
    case 'unsupported':
      return {
        kind: 'unsupported', text: t('common_printer_unsupported'), hollow: true,
        spoken: t('common_printer_cd', t('common_printer_state_unsupported')),
      };
    case 'disconnected':
      return {
        kind: 'disconnected', text: name || t('common_printer_disconnected'),
        spoken: t('common_printer_cd_device', shown, t('common_printer_state_idle')),
      };
    case 'connecting': {
      const text = t('common_printer_connecting');
      return { kind: 'connecting', text, pulse: true, ring: true, spoken: t('common_printer_cd_device', shown, text) };
    }
    case 'ready':
      return { kind: 'ready', text: shown, spoken: t('common_printer_cd_device', shown, t('common_printer_state_ready')) };
    case 'printing': {
      const pct = Math.round(Math.min(1, Math.max(0, Number(st.progress) || 0)) * 100);
      const text = t('common_printer_printing', pct);
      return { kind: 'printing', text, pulse: true, ring: true, spoken: t('common_printer_cd_device', shown, text) };
    }
    case 'error': {
      if (st.failure === 'RENDER_FAILED') {
        // La stampa non si è composta: la stampante non c'entra e la pillola continua a descrivere lei.
        return name ? printerLook({ kind: 'disconnected', name }) : printerLook({ kind: 'not-paired' });
      }
      const text = failureLabel(st.failure);
      const detail = st.message ? t('common_printer_failure_detail', text, st.message) : text;
      return {
        kind: 'error', text,
        hollow: st.failure === 'NO_PRINTER' || st.failure === 'UNSUPPORTED',
        spoken: name ? t('common_printer_cd_device', name, detail) : t('common_printer_cd', detail),
      };
    }
    default: {
      // Ricordata da una visita precedente: si mostra il nome, come una stampante scollegata.
      if (st.kind === 'not-paired' && st.remembered && name) return printerLook({ kind: 'disconnected', name });
      const text = t('common_printer_not_configured');
      return { kind: 'not-paired', text, hollow: true, spoken: t('common_printer_cd', text) };
    }
  }
}

/**
 * Pillola di stato della stampante: pallino colorato (Mint pronta, Flash al lavoro, Coral errore)
 * e testo breve. Con onClick è un pulsante (di solito apre #/printer). opts.large per la versione grande.
 */
export function printerPill(state, onClick, { large = false } = {}) {
  const dot = h('span', { class: 'ff-pill__dot', 'aria-hidden': 'true' });
  const text = h('span', { class: 'ff-pill__text', 'aria-hidden': 'true' });
  const el = onClick
    ? h('button', { type: 'button', class: 'ff-pill', onClick, title: t('common_printer_open') }, dot, text)
    : h('span', { class: 'ff-pill ff-pill--static', role: 'status' }, dot, text);
  if (large) el.classList.add('ff-pill--large');

  function set(next) {
    const look = printerLook(next);
    el.dataset.kind = look.kind;
    el.classList.toggle('ff-pill--hollow', !!look.hollow);
    el.classList.toggle('ff-pill--pulse', !!look.pulse);
    el.classList.toggle('ff-pill--ring', !!look.ring);
    text.textContent = look.text;
    el.setAttribute('aria-label', look.spoken);
  }

  set(state);
  return { el, set };
}

// ---------------------------------------------------------------------------------------------
// Stati vuoti, avvisi, schede

/** Retino del brand: puntini su griglia sfalsata che rimpiccioliscono verso il bordo (HalftoneBurst). */
export function halftoneBurst(size = 168, spacing = 9) {
  const maxDot = spacing * 0.42;
  const c = size / 2;
  const f = (v) => Math.round(v * 100) / 100;
  let d = '';
  const rows = Math.floor(size / spacing) + 1;
  const cols = Math.floor(size / spacing) + 1;
  for (let row = 0; row <= rows; row++) {
    const shift = row % 2 === 0 ? 0 : spacing / 2;
    const y = row * spacing;
    for (let col = -1; col <= cols; col++) {
      const x = col * spacing + shift;
      const dist = Math.hypot(x - c, y - c) / c;
      if (dist >= 1) continue;
      const r = maxDot * (1 - dist);
      if (r < 0.6) continue;
      d += `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0z`;
    }
  }
  return s('svg', { class: 'ff-halftone', viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d, fill: 'currentColor' }));
}

/** Stato vuoto: disco giallo con l'icona e il retino attorno, titolo, spiegazione e azione facoltativa. */
export function emptyState({ icon: iconName = 'sparkles', title, message, actionText, onAction } = {}) {
  return h('div', { class: 'ff-empty' },
    h('div', { class: 'ff-empty__art', 'aria-hidden': 'true' },
      halftoneBurst(),
      h('div', { class: 'ff-empty__disc' }, icon(iconName))),
    title ? h('h2', { class: 'ff-empty__title' }, title) : null,
    message ? h('p', { class: 'ff-empty__message' }, message) : null,
    actionText && onAction ? flashButton(actionText, { onClick: onAction }) : null);
}

const NOTICE_ICONS = { info: 'info', warn: 'warning', error: 'warning', ok: 'check' };

/** Avviso in riga: kind 'info' | 'warn' | 'error' | 'ok'. */
export function notice({ kind = 'info', icon: iconName, text, children = [] } = {}) {
  return h('div', { class: ['ff-notice', `ff-notice--${kind}`], role: kind === 'error' ? 'alert' : null },
    icon(iconName || NOTICE_ICONS[kind] || 'info'),
    h('div', { class: 'ff-grow' }, text ? h('p', null, text) : null, ...children));
}

/** Scheda con il fondo tenue del tema. */
export function card(...children) {
  return h('div', { class: 'ff-card' }, ...children);
}

/** Filetto tra le righe di una scheda. */
export function divider() {
  return h('hr', { class: 'ff-divider' });
}

/**
 * Riga di elenco: icona, titolo, descrizione, valore o freccia. Con href è un link (esterno in una
 * nuova scheda), con onClick un pulsante, altrimenti solo testo.
 */
export function listItem({ icon: iconName, title, desc, value, chevron = false, href, external = false, onClick, danger = false, leading } = {}) {
  const body = h('span', { class: 'ff-item__body' },
    h('span', { class: 'ff-item__title' }, title),
    desc ? h('span', { class: 'ff-item__desc' }, desc) : null,
    external ? h('span', { class: 'ff-sr-only' }, ` ${t('common_new_tab')}`) : null);
  const parts = [
    leading || (iconName ? icon(iconName) : null),
    body,
    value !== undefined && value !== null ? h('span', { class: 'ff-item__value' }, value) : null,
    external ? icon('external', { size: 20, className: 'ff-item__icon' }) : null,
    chevron ? icon('chevron', { size: 20, className: 'ff-item__icon' }) : null,
  ];
  const cls = ['ff-item', danger && 'ff-item--danger'];
  if (href) {
    return h('a', { class: cls, href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null, onClick }, ...parts);
  }
  if (onClick) return h('button', { type: 'button', class: cls, onClick }, ...parts);
  return h('div', { class: cls }, ...parts);
}

/** Barra di avanzamento 0..1 (null = attesa senza percentuale). */
export function progressBar(value = null, { label } = {}) {
  const el = h('div', { class: 'ff-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': label || null });
  function set(v) {
    const indeterminate = v === null || v === undefined || !Number.isFinite(Number(v));
    el.classList.toggle('ff-progress--indeterminate', indeterminate);
    if (indeterminate) {
      el.removeAttribute('aria-valuenow');
    } else {
      const pct = Math.round(Math.min(1, Math.max(0, Number(v))) * 100);
      el.style.setProperty('--p', `${pct}%`);
      el.setAttribute('aria-valuenow', String(pct));
    }
  }
  set(value);
  return { el, set };
}

/**
 * Campo di testo su una riga con contatore. onInput a ogni tasto, onCommit quando si lascia il campo
 * o si preme Invio (come il salvataggio "a fuoco perso" dell'app).
 */
export function textField({ label, value = '', placeholder = '', maxLength = 0, hint, onInput, onCommit, inputMode, autocapitalize = 'sentences', enterKeyHint = 'done' } = {}) {
  const id = uniqueId('field');
  const hintId = hint ? uniqueId('field-hint') : null;
  const input = h('input', {
    type: 'text',
    class: 'ff-input',
    id,
    placeholder,
    autocomplete: 'off',
    spellcheck: false,
    enterKeyHint,
    inputMode,
    autocapitalize,
    'aria-describedby': hintId,
  });
  if (maxLength > 0) input.maxLength = maxLength;
  input.value = value;
  const count = maxLength > 0 ? h('span', { class: 'ff-field__count', 'aria-hidden': 'true' }) : null;
  const paint = () => {
    if (count) count.textContent = `${input.value.length}/${maxLength}`;
  };
  let committed = value;
  const commit = () => {
    if (input.value === committed) return;
    committed = input.value;
    if (onCommit) onCommit(input.value);
  };
  input.addEventListener('input', () => {
    paint();
    if (onInput) onInput(input.value);
  });
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      commit();
      input.blur();
    }
  });
  paint();
  const el = h('div', { class: 'ff-field' },
    h('label', { class: 'ff-field__label', htmlFor: id }, label),
    input,
    hint || count ? h('div', { class: 'ff-field__foot' }, h('span', { id: hintId }, hint || ''), count) : null);
  return {
    el,
    input,
    set(v) {
      input.value = v;
      committed = v;
      paint();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Toast

const toastHosts = new WeakMap();
const pendingToasts = new WeakMap();
const TOAST_LIMIT = 3;

function topDialog() {
  if (typeof document === 'undefined') return null;
  // Un dialogo che si sta chiudendo non ospita più messaggi: sparirebbero con lui.
  const open = document.querySelectorAll('dialog[open]:not([data-closing])');
  return open.length ? open[open.length - 1] : null;
}

// Il contenitore vive nel dialogo modale aperto, se c'è: fuori sarebbe inerte e non cliccabile.
function toastHost() {
  const parent = topDialog() || document.body;
  let host = toastHosts.get(parent);
  let fresh = false;
  if (!host || !host.isConnected) {
    host = h('div', { class: 'ff-toasts', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    parent.appendChild(host);
    toastHosts.set(parent, host);
    fresh = true;
  }
  return { host, fresh };
}

/**
 * Messaggio breve in basso (in alto nel mirino). Con actionText/onAction mostra un'azione;
 * duration 0 o Infinity lo tiene finché non si chiude. Restituisce { close() }.
 */
export function toast(message, { actionText, onAction, duration = 4000 } = {}) {
  const persistent = !(duration > 0) || !Number.isFinite(duration);
  let timer = null;
  let closed = false;
  const el = h('div', { class: 'ff-toast', role: 'status' }, h('span', { class: 'ff-toast__text' }, message));

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    const done = () => el.remove();
    if (reducedMotion()) done();
    else {
      el.addEventListener('animationend', done, { once: true });
      setTimeout(done, 260);
    }
  }

  function arm() {
    clearTimeout(timer);
    if (!persistent) timer = setTimeout(close, duration);
  }

  if (actionText && onAction) {
    el.appendChild(h('button', {
      type: 'button',
      class: 'ff-toast__action',
      onClick: () => {
        close();
        onAction();
      },
    }, actionText));
  }
  if (persistent) el.appendChild(iconButton('close', { label: t('common_dismiss'), onClick: close }));

  // Mentre ci si passa sopra o si usa la tastiera il messaggio non sparisce.
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', arm);

  const { host, fresh } = toastHost();
  const insert = () => {
    if (closed) return;
    const shown = [...host.children].filter((c) => !c.classList.contains('is-leaving'));
    if (shown.length >= TOAST_LIMIT) shown[0].remove();
    host.appendChild(el);
    arm();
  };
  // In una regione live appena creata l'annuncio si perde: si aggiunge un attimo dopo,
  // e i messaggi arrivati nel frattempo aspettano in fila per restare nell'ordine giusto.
  if (fresh) {
    const queue = [insert];
    pendingToasts.set(host, queue);
    // setTimeout e non requestAnimationFrame: con la scheda in secondo piano il messaggio non si perde.
    setTimeout(() => {
      pendingToasts.delete(host);
      queue.forEach((fn) => fn());
    }, 50);
  } else if (pendingToasts.has(host)) {
    pendingToasts.get(host).push(insert);
  } else {
    insert();
  }
  return { close, el };
}

// ---------------------------------------------------------------------------------------------
// Foglio dal basso e dialoghi (dialog modale nativo: focus intrappolato, Esc e Indietro di Android)

function restoreFocus(target) {
  if (target && typeof target.focus === 'function' && target.isConnected) {
    try {
      target.focus({ preventScroll: true });
    } catch {
      // elemento non più focalizzabile
    }
  }
}

function clickedBackdrop(dialog, event) {
  if (event.target !== dialog) return false;
  const r = dialog.getBoundingClientRect();
  return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
}

/**
 * Foglio che sale dal basso, con maniglia trascinabile, titolo e chiusura. Esc, tocco fuori,
 * trascinamento in basso e Indietro di Android lo chiudono. Restituisce { close(), setContent(el) }.
 */
export function sheet({ title = '', content = null, onClose } = {}) {
  const titleId = uniqueId('sheet-title');
  const body = h('div', { class: 'ff-sheet__body' });
  const handle = h('div', { class: 'ff-sheet__handle', title: t('common_sheet_handle'), 'aria-hidden': 'true' });
  const dlg = h('dialog', { class: 'ff-sheet', 'aria-labelledby': titleId },
    handle,
    h('div', { class: 'ff-sheet__head' },
      h('h2', { class: 'ff-sheet__title', id: titleId }, title),
      iconButton('close', { label: t('common_close'), onClick: () => close() })),
    body);
  const opener = document.activeElement;
  let finished = false;
  let closing = false;

  function setContent(node) {
    clear(body);
    if (node !== null && node !== undefined) {
      if (Array.isArray(node)) node.forEach((n) => n && body.appendChild(n));
      else body.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    window.removeEventListener('hashchange', onRoute);
    dlg.removeEventListener('transitionend', onSlideEnd);
    if (dlg.open) dlg.close();
    dlg.remove();
    restoreFocus(opener);
    if (onClose) onClose();
  }

  function close() {
    if (closing || finished) return;
    closing = true;
    dlg.dataset.closing = '';
    dlg.classList.remove('is-open', 'is-dragging');
    dlg.style.removeProperty('--ff-drag');
    if (reducedMotion()) {
      finish();
      return;
    }
    dlg.addEventListener('transitionend', onSlideEnd);
    setTimeout(finish, 340);
  }

  // Solo la discesa del foglio: le transizioni dei figli (es. il pulsante Chiudi) risalgono fin qui.
  function onSlideEnd(event) {
    if (event.target === dlg && event.propertyName === 'transform') finish();
  }

  // Cambiando schermata il foglio non ha più senso: si chiude subito.
  function onRoute() {
    closing = true;
    dlg.dataset.closing = '';
    finish();
  }

  dlg.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  // Se il browser chiude da sé (Indietro senza animazione), si fa comunque pulizia.
  dlg.addEventListener('close', finish);
  dlg.addEventListener('click', (event) => {
    if (clickedBackdrop(dlg, event)) close();
  });

  // Trascina in basso per chiudere, dalla maniglia o dal titolo.
  let startY = null;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;
  const head = dlg.querySelector('.ff-sheet__head');
  for (const zone of [handle, head]) {
    zone.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      startY = event.clientY;
      lastY = startY;
      lastT = event.timeStamp;
      speed = 0;
      zone.setPointerCapture(event.pointerId);
      dlg.classList.add('is-dragging');
    });
    zone.addEventListener('pointermove', (event) => {
      if (startY === null) return;
      const dy = Math.max(0, event.clientY - startY);
      const dt = Math.max(1, event.timeStamp - lastT);
      speed = (event.clientY - lastY) / dt;
      lastY = event.clientY;
      lastT = event.timeStamp;
      dlg.style.setProperty('--ff-drag', `${dy}px`);
    });
    const end = (event) => {
      if (startY === null) return;
      const dy = Math.max(0, event.clientY - startY);
      startY = null;
      dlg.classList.remove('is-dragging');
      if (dy > Math.min(140, dlg.offsetHeight * 0.3) || speed > 0.6) close();
      else dlg.style.removeProperty('--ff-drag');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  setContent(content);
  document.body.appendChild(dlg);
  dlg.showModal();
  window.addEventListener('hashchange', onRoute);
  requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add('is-open')));
  return { close, setContent, el: dlg, body };
}

/**
 * Dialogo di conferma accessibile (alertdialog). Il fuoco parte da Annulla; Esc, Indietro o un
 * tocco fuori valgono come annullamento. danger: conferma Coral per le azioni distruttive.
 */
export function confirmDialog({ title, message, confirmText, cancelText, danger = false } = {}) {
  return new Promise((resolve) => {
    const titleId = uniqueId('dlg-title');
    const msgId = message ? uniqueId('dlg-msg') : null;
    const opener = document.activeElement;
    let result = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('hashchange', onRoute);
      if (dlg.open) dlg.close();
      dlg.remove();
      restoreFocus(opener);
      resolve(result);
    };
    const answer = (value) => {
      result = value;
      finish();
    };
    const onRoute = () => answer(false);
    const cancelBtn = ghostButton(cancelText || t('common_cancel'), { onClick: () => answer(false) });
    const confirmBtn = button(danger ? 'danger' : 'flash', confirmText || t('common_ok'), { onClick: () => answer(true) });
    const dlg = h('dialog', { class: 'ff-dialog', role: 'alertdialog', 'aria-labelledby': titleId, 'aria-describedby': msgId },
      h('h2', { class: 'ff-dialog__title', id: titleId }, title || ''),
      message ? h('p', { class: 'ff-dialog__message', id: msgId }, message) : null,
      h('div', { class: 'ff-dialog__actions' }, cancelBtn, confirmBtn));
    dlg.addEventListener('cancel', (event) => {
      event.preventDefault();
      answer(false);
    });
    dlg.addEventListener('close', finish);
    dlg.addEventListener('click', (event) => {
      if (clickedBackdrop(dlg, event)) answer(false);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    cancelBtn.focus();
    window.addEventListener('hashchange', onRoute);
  });
}
