// Icone SVG in linea, disegnate su una griglia 24 × 24 con tratto 2 e terminali arrotondati (come le
// Icons.Rounded dell'app). Solo stringhe statiche: gli elementi si creano dentro le funzioni.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Tracciati delle icone. "v.01" con terminale tondo disegna un puntino.
const PATHS = {
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  bolt: '<path d="M9.8 2.5h8l-3.6 6.6h5.2L8.6 21.5l2.3-8.6H5.2z"/>',
  'bolt-off': '<path d="M9.8 2.5h8l-3.6 6.6h5.2l-3 3.4M12.2 15.6l-3.6 5.9 2.3-8.6H5.2l2.4-5.6"/><path d="M3 3l18 18"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 2.5M9.5 2.5h5M12 2.5V6M18.5 6.5 20 5"/>',
  gallery: '<path d="M7 3.5h12A2 2 0 0 1 21 5.5v12"/><rect x="3" y="7" width="14" height="14" rx="2"/><path d="m3.5 18.5 3.8-3.8a1.5 1.5 0 0 1 2.1 0L13 18.3"/><path d="M12.5 11.5v.01"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8.5 9.5v.01"/><path d="m21 15.5-4.8-4.8a1.5 1.5 0 0 0-2.1 0L4.5 20"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  settings: '<path d="M10.14 5.05 10.42 2.53h3.16l.28 2.52a7.2 7.2 0 0 1 1.74.71l1.97-1.58 2.25 2.25-1.58 1.97a7.2 7.2 0 0 1 .71 1.74l2.52.28v3.16l-2.52.28a7.2 7.2 0 0 1-.71 1.74l1.58 1.97-2.25 2.25-1.97-1.58a7.2 7.2 0 0 1-1.74.71l-.28 2.52h-3.16l-.28-2.52a7.2 7.2 0 0 1-1.74-.71l-1.97 1.58-2.25-2.25 1.58-1.97a7.2 7.2 0 0 1-.71-1.74l-2.52-.28v-3.16l2.52-.28a7.2 7.2 0 0 1 .71-1.74L4.18 6.43l2.25-2.25L8.4 5.76a7.2 7.2 0 0 1 1.74-.71z"/><circle cx="12" cy="12" r="3"/>',
  print: '<path d="M7 9V3.5h10V9"/><path d="M6 17.5H4.5A1.5 1.5 0 0 1 3 16v-5.5A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 1-1.5 1.5H18"/><path d="M7 13.5h10v7.5l-1.7-1-1.6 1-1.7-1-1.7 1-1.6-1L7 21z"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  download: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>',
  upload: '<path d="M12 14.5v-11M7.5 8 12 3.5 16.5 8"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bluetooth: '<path d="m7 7 10 10-5 4.5v-19L17 7 7 17"/>',
  'bluetooth-off': '<path d="m12.5 12.5 4.5 4.5-5 4.5v-9M12 9.3V2.5L17 7l-2.6 2.4M7 17l5-5"/><path d="M3 3l18 18"/>',
  'bluetooth-search': '<path d="m4 7 10 10-5 4.5v-19L14 7 4 17"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5M20.5 7a7 7 0 0 1 0 10"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  switch: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7"/><path d="m6 7 1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  sparkles: '<path d="M10 4.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/><path d="M18.5 2.5c.3 1.6 1 2.2 2.5 2.5-1.5.3-2.2.9-2.5 2.5-.3-1.6-1-2.2-2.5-2.5 1.5-.3 2.2-.9 2.5-2.5z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8v.01"/>',
  warning: '<path d="M10.3 4.2 2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5V14M12 17.3v.01"/>',
  install: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M12 7v7.5M9 11.5l3 3 3-3M10.5 18.5h3"/>',
  chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  'chevron-down': '<path d="m5.5 9 6.5 6.5L18.5 9"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
  paper: '<path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  strip: '<rect x="7" y="2.5" width="10" height="19" rx="1.5"/><path d="M7 8.8h10M7 15.2h10"/>',
  cut: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.2 8 20 18M8.2 16 20 6"/>',
  heat: '<path d="M12 21.5c-3.6 0-6.5-2.5-6.5-6.3 0-3.4 2.4-5.4 3.5-8.7 1.8 1.1 2.7 2.9 2.7 4.6 1-.8 1.6-2 1.7-3.6 2.7 1.9 4.1 4.8 4.1 7.7 0 3.8-2.6 6.3-5.5 6.3z"/>',
  grain: '<g fill="currentColor" stroke="none"><circle cx="5" cy="5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="8.5" cy="9.5" r="1.6"/><circle cx="15.5" cy="9.5" r="1.6"/><circle cx="5" cy="14" r="1.6"/><circle cx="12" cy="14" r="1.6"/><circle cx="19" cy="14" r="1.6"/><circle cx="8.5" cy="18.5" r="1.6"/><circle cx="15.5" cy="18.5" r="1.6"/></g>',
  event: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
  ticket: '<path d="M3.5 9V6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5V9a3 3 0 0 0 0 6v2.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V15a3 3 0 0 0 0-6z"/><path d="M14.5 7.5v1.5M14.5 11.25v1.5M14.5 15v1.5"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z"/>',
  android: '<path d="M4.5 17a7.5 7.5 0 0 1 15 0z"/><path d="M8 10.5 6 7.5M16 10.5l2-3M9.5 14v.01M14.5 14v.01"/>',
  doc: '<path d="M6.5 3H14l4.5 4.5v12A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14 3v4.5h4.5M8.5 12h7M8.5 16h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  tune: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  edit: '<path d="m4 20 1-4.5L16 4.5a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19z"/><path d="m14 6.5 3.5 3.5"/>',
  more: '<path d="M12 5v.01M12 12v.01M12 19v.01"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  focus: '<path d="M4 8.5v-3A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3"/><circle cx="12" cy="12" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M10.5 18.5h3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
};

// Lampo del marchio (ic_brand_bolt): giallo con contorno Ink, si legge su Paper e su Night.
const BOLT_MARK = '<path d="M9.5 1.5h9l-4 7.5H20L8 22.5l2.5-9.5h-6z" fill="#FFCC00" stroke="#16130F" stroke-width="1.5" stroke-linejoin="round"/>';

// Scritta «FotoFlash» in tracciati (da docs/brand/wordmark.svg, Righteous con crenatura): si vede
// uguale anche prima che i font siano caricati.
const WORDMARK_TEXT = 'M66.07 38.45h-5.79v-28.9h20.24v5.78h-14.45v5.79h8.66v5.78h-8.66v11.55zm35.17-10.98q0 2.42-0.87 4.5q-0.87 2.09-2.36 3.61q-1.49 1.52-3.49 2.4q-2.01 0.88-4.31 0.88q-2.27 0-4.28-0.88q-2.01-0.88-3.51-2.4q-1.5-1.52-2.37-3.61q-0.86-2.08-0.86-4.5q0-2.46 0.86-4.56q0.87-2.09 2.37-3.62q1.5-1.52 3.51-2.38q2.01-0.87 4.28-0.87q2.3 0 4.31 0.81q2 0.82 3.49 2.32q1.49 1.5 2.36 3.61q0.87 2.11 0.87 4.69zm-5.54 0q0-1.33-0.44-2.41q-0.43-1.08-1.18-1.86q-0.74-0.77-1.74-1.19q-1-0.41-2.13-0.41q-1.13 0-2.12 0.41q-1 0.42-1.74 1.19q-0.73 0.78-1.16 1.86q-0.42 1.08-0.42 2.41q0 1.25 0.42 2.31q0.43 1.07 1.16 1.86q0.74 0.79 1.74 1.24q0.99 0.45 2.12 0.45q1.13 0 2.13-0.42q1-0.42 1.74-1.19q0.75-0.77 1.18-1.85q0.44-1.09 0.44-2.4zm19.24 10.98q-1.99 0-3.74-0.75q-1.76-0.76-3.08-2.08q-1.32-1.32-2.07-3.07q-0.76-1.76-0.76-3.75v-6.41h-2.68v-5.48h2.68v-8.63h5.48v8.63h8.35v5.48h-8.35v6.41q0 0.86 0.32 1.62q0.33 0.76 0.89 1.32q0.57 0.56 1.33 0.9q0.77 0.33 1.63 0.33h4.18v5.48h-4.18zm28.12-10.98q0 2.42-0.86 4.5q-0.87 2.09-2.36 3.61q-1.49 1.52-3.5 2.4q-2.01 0.88-4.3 0.88q-2.28 0-4.29-0.88q-2-0.88-3.5-2.4q-1.51-1.52-2.37-3.61q-0.87-2.08-0.87-4.5q0-2.46 0.87-4.56q0.86-2.09 2.37-3.62q1.5-1.52 3.5-2.38q2.01-0.87 4.29-0.87q2.29 0 4.3 0.81q2.01 0.82 3.5 2.32q1.49 1.5 2.36 3.61q0.86 2.11 0.86 4.69zm-5.54 0q0-1.33-0.43-2.41q-0.44-1.08-1.18-1.86q-0.75-0.77-1.75-1.19q-0.99-0.41-2.12-0.41q-1.13 0-2.13 0.41q-1 0.42-1.73 1.19q-0.74 0.78-1.16 1.86q-0.43 1.08-0.43 2.41q0 1.25 0.43 2.31q0.42 1.07 1.16 1.86q0.73 0.79 1.73 1.24q1 0.45 2.13 0.45q1.13 0 2.12-0.42q1-0.42 1.75-1.19q0.74-0.77 1.18-1.85q0.43-1.09 0.43-2.4zm14.96 10.98h-5.79v-28.9h20.24v5.78h-14.45v5.79h8.66v5.78h-8.66v11.55zm22.37 0h-5.54v-30.17h5.54v30.17zm25.09 0h-1.33l-2.13-2.96q-0.79 0.7-1.67 1.32q-0.87 0.61-1.84 1.07q-0.97 0.45-1.99 0.71q-1.01 0.27-2.06 0.27q-2.28 0-4.29-0.77q-2-0.77-3.5-2.23q-1.5-1.46-2.37-3.58q-0.87-2.11-0.87-4.81q0-2.52 0.87-4.63q0.87-2.11 2.37-3.62q1.5-1.51 3.5-2.35q2.01-0.83 4.29-0.83q1.05 0 2.07 0.26q1.03 0.26 2 0.73q0.97 0.46 1.84 1.08q0.88 0.63 1.65 1.35l2.13-2.55h1.33v21.54zm-5.54-10.98q0-1.13-0.43-2.19q-0.44-1.06-1.18-1.87q-0.75-0.82-1.75-1.31q-0.99-0.5-2.12-0.5q-1.13 0-2.13 0.38q-1 0.39-1.73 1.13q-0.74 0.75-1.16 1.85q-0.42 1.1-0.42 2.51q0 1.41 0.42 2.51q0.42 1.09 1.16 1.84q0.73 0.75 1.73 1.13q1 0.38 2.13 0.38q1.13 0 2.12-0.49q1-0.5 1.75-1.31q0.74-0.82 1.18-1.88q0.43-1.05 0.43-2.18zm21.59 10.98h-12.58v-5.48h12.58q0.56 0 0.97-0.4q0.4-0.41 0.4-0.97q0-0.59-0.4-0.77q-0.41-0.18-0.97-0.18h-5.73q-1.43 0-2.68-0.54q-1.25-0.55-2.17-1.48q-0.93-0.94-1.47-2.19q-0.53-1.25-0.53-2.68q0-1.43 0.53-2.68q0.54-1.25 1.47-2.18q0.92-0.93 2.17-1.46q1.25-0.53 2.68-0.53h11.15v5.48h-11.15q-0.56 0-0.96 0.4q-0.41 0.4-0.41 0.97q0 0.58 0.41 1q0.4 0.41 0.96 0.41h5.73q1.41 0 2.66 0.47q1.25 0.48 2.18 1.32q0.92 0.85 1.47 2.04q0.54 1.19 0.54 2.6q0 1.43-0.54 2.67q-0.55 1.24-1.47 2.18q-0.93 0.93-2.18 1.47q-1.25 0.53-2.66 0.53zm15.28 0h-5.51v-30.17h5.51v9.53q0.98-0.74 2.03-1.06q1.05-0.31 2.14-0.31q1.99 0 3.75 0.76q1.75 0.75 3.05 2.07q1.3 1.32 2.06 3.09q0.75 1.76 0.75 3.76v12.33h-5.54v-12.33h0.04q0-0.85-0.32-1.61q-0.32-0.75-0.89-1.32q-0.56-0.56-1.31-0.88q-0.74-0.33-1.59-0.33q-0.87 0-1.63 0.33q-0.77 0.32-1.33 0.88q-0.57 0.57-0.89 1.32q-0.32 0.76-0.32 1.61v12.33z';

// Marchio: foglietto inclinato con finestra foto, lampo e didascalia (docs/brand/logo.svg).
const MARK_BODY = 'M34,33 A4,4 0 0 1 38,29 L68,29 A4,4 0 0 1 72,33 L72,73.2 L68.2,77 L64.4,73.2 L60.6,77 L56.8,73.2 L53,77 L49.2,73.2 L45.4,77 L41.6,73.2 L37.8,77 L34,73.2 Z';
const MARK = `<g transform="rotate(-8 54 54)">
<path d="${MARK_BODY}" transform="translate(3 3)" fill="var(--ff-mark-shadow, #FFCC00)"/>
<path d="${MARK_BODY}" fill="#FBF8F1" stroke="#16130F" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M41,33.5 L65,33.5 A2.5,2.5 0 0 1 67.5,36 L67.5,60 A2.5,2.5 0 0 1 65,62.5 L41,62.5 A2.5,2.5 0 0 1 38.5,60 L38.5,36 A2.5,2.5 0 0 1 41,33.5 Z" fill="#16130F"/>
<path d="M49.98,36.45 L59.88,36.45 L55.48,44.7 L61.53,44.7 L48.33,59.55 L51.08,49.1 L44.48,49.1 Z" fill="#FFCC00"/>
<path d="M45,68 L61,68" fill="none" stroke="#16130F" stroke-width="2.6" stroke-linecap="round"/>
</g>`;

const warned = new Set();

function svg(viewBox, markup, attrs) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  // markup statico definito qui sopra, mai testo dell'utente
  el.innerHTML = markup;
  return el;
}

/** Nomi disponibili (utile ai test e a chi costruisce menu). */
export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

/** Icona SVG in linea, decorativa (aria-hidden): l'etichetta la mette il controllo che la contiene. */
export function icon(name, { size = 24, className = '' } = {}) {
  let markup = PATHS[name];
  if (!markup) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[icons] icona sconosciuta: ${name}`);
    }
    markup = PATHS.info;
  }
  return svg('0 0 24 24', markup, {
    width: size,
    height: size,
    class: `ff-icon ${className}`.trim(),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

/** Lampo del marchio, giallo con contorno Ink (non segue il colore del testo). */
export function boltMark({ size = 24 } = {}) {
  return svg('0 0 24 24', BOLT_MARK, { width: size, height: size, class: 'ff-bolt-mark' });
}

/**
 * Wordmark: lampo + «FotoFlash». height è l'altezza del lampo (come BrandWordmark.kt); la scritta
 * prende il colore del testo, così è Ink sul chiaro e Paper sullo scuro.
 */
export function wordmark({ height = 28, label = 'FotoFlash' } = {}) {
  // Nel viewBox il lampo è alto 48: la scala lega l'altezza del lampo a quella dell'SVG.
  const el = svg('0 0 249 48', `<path d="M9.5 1.5h9l-4 7.5H20L8 22.5l2.5-9.5h-6z" fill="#FFCC00" stroke="#16130F" stroke-width="1.5" stroke-linejoin="round" transform="scale(2)"/><path d="${WORDMARK_TEXT}" fill="currentColor"/>`, {
    height,
    width: Math.round((height * 249) / 48),
    class: 'ff-wordmark',
  });
  el.removeAttribute('aria-hidden');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  return el;
}

/** Marchio (foglietto con il lampo). shadow: colore dell'ombra piena, Flash su fondo libero. */
export function brandMark({ size = 64, shadow = '#FFCC00' } = {}) {
  const el = svg('22 22 64 64', MARK, { width: size, height: size, class: 'ff-mark' });
  el.style.setProperty('--ff-mark-shadow', shadow);
  return el;
}
