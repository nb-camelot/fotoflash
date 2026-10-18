// Costruzione del DOM senza framework. I testi entrano sempre come nodi di testo: niente innerHTML
// con contenuti che arrivano dall'utente o dallo storico.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Proprietà da assegnare direttamente all'elemento (non come attributo).
const PROPS = new Set([
  'id', 'type', 'value', 'checked', 'disabled', 'hidden', 'tabIndex', 'title', 'name', 'href', 'target',
  'rel', 'src', 'alt', 'placeholder', 'min', 'max', 'step', 'htmlFor', 'readOnly', 'required',
  'maxLength', 'autocomplete', 'inputMode', 'enterKeyHint', 'spellcheck', 'draggable', 'textContent',
  'width', 'height', 'download', 'accept', 'multiple', 'selected', 'open',
]);

function setClass(el, value) {
  if (!value) return;
  if (typeof value === 'string') {
    el.setAttribute('class', value);
  } else if (Array.isArray(value)) {
    el.setAttribute('class', value.filter(Boolean).join(' '));
  } else {
    el.setAttribute('class', Object.keys(value).filter((k) => value[k]).join(' '));
  }
}

function setStyle(el, value) {
  if (!value) return;
  if (typeof value === 'string') {
    el.style.cssText = value;
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('--') || k.includes('-')) el.style.setProperty(k, String(v));
    else el.style[k] = v;
  }
}

function setAttr(el, name, value) {
  if (value === null || value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

/** Aggiunge figli: stringhe e numeri diventano testo, null/false si saltano, gli array si appiattiscono. */
export function append(el, ...children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(el, ...child);
    else if (typeof child === 'string' || typeof child === 'number') el.appendChild(document.createTextNode(String(child)));
    else el.appendChild(child);
  }
  return el;
}

function build(el, props, children) {
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      if (key === 'class' || key === 'className') setClass(el, value);
      else if (key === 'style') setStyle(el, value);
      else if (key === 'attrs') for (const [n, v] of Object.entries(value || {})) setAttr(el, n, v);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'ref') continue;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role') setAttr(el, key, value);
      else if (PROPS.has(key) && !(el instanceof SVGElement)) el[key] = value;
      else setAttr(el, key, value);
    }
  }
  append(el, ...children);
  if (props && typeof props.ref === 'function') props.ref(el);
  return el;
}

/**
 * Crea un elemento HTML. props: class (stringa, array o oggetto), style (stringa o oggetto),
 * on* (eventi, es. onClick), attrs (attributi), dataset, ref(el), più le proprietà comuni.
 * Il tag 'svg' nasce già nello spazio dei nomi SVG; per i suoi figli si usa s().
 */
export function h(tag, props, ...children) {
  if (tag === 'svg') return s(tag, props, ...children);
  return build(document.createElement(tag), props, children);
}

/** Come h(), ma per gli elementi SVG. */
export function s(tag, props, ...children) {
  return build(document.createElementNS(SVG_NS, tag), props, children);
}

/** Svuota un elemento. */
export function clear(el) {
  if (!el) return el;
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Ascolta un evento e restituisce la funzione per smettere. */
export function listen(target, type, fn, options) {
  target.addEventListener(type, fn, options);
  return () => target.removeEventListener(type, fn, options);
}

/** Vero se l'utente ha chiesto di ridurre le animazioni. */
export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Identificativo unico per collegare etichette e controlli (aria-labelledby, for...). */
let uid = 0;
export function uniqueId(prefix = 'ff') {
  uid += 1;
  return `${prefix}-${uid}`;
}
