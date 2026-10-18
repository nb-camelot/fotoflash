// Sezione 4: come funziona. Tre passi (Scatta → Scegli il modello → Stampa), ciascuno con una
// micro-animazione in loop: SVG statici animati in CSS (solo transform e opacity), fermi fuori schermo.
import { h } from '../../ui/dom.js';
import { sectionHead, art, svgId, sparklePath } from './kit.js';

const INK = '#16130F';
const PAPER = '#FBF8F1';
const FLASH = '#FFCC00';

// Lampo del marchio (ic_brand_bolt), griglia 24.
const BOLT = 'M9.5 1.5h9l-4 7.5H20L8 22.5l2.5-9.5h-6z';

/** Retino dei "fotogrammi": puntini sfalsati, come la stampa a un solo inchiostro. */
function dotsPattern(id, step = 5, r = 1.05) {
  const half = step / 2;
  return `<pattern id="${id}" width="${step}" height="${step}" patternUnits="userSpaceOnUse">` +
    `<circle cx="${half / 2}" cy="${half / 2}" r="${r}" fill="${INK}"/><circle cx="${half * 1.5}" cy="${half * 1.5}" r="${r}" fill="${INK}"/></pattern>`;
}

/** Una "foto" retinata: fondo a puntini, montagne e sole Ink, cornice netta. */
function photo(x, y, w, hgt, patternId) {
  const base = y + hgt;
  const m1 = `M${x} ${base}L${x + w * 0.32} ${y + hgt * 0.45}L${x + w * 0.55} ${y + hgt * 0.72}L${x + w * 0.72} ${y + hgt * 0.55}L${x + w} ${y + hgt * 0.86}V${base}Z`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" fill="url(#${patternId})"/>` +
    `<path d="${m1}" fill="${INK}"/>` +
    `<circle cx="${x + w * 0.74}" cy="${y + hgt * 0.27}" r="${Math.min(w, hgt) * 0.12}" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" fill="none" stroke="${INK}" stroke-width="2.5"/>`;
}

function snapArt() {
  return `<circle cx="120" cy="92" r="72" fill="${FLASH}"/>` +
    `<g transform="rotate(-9 120 95)">` +
    `<rect x="86" y="34" width="68" height="118" rx="14" fill="${INK}" transform="translate(7 7)"/>` +
    `<rect x="86" y="34" width="68" height="118" rx="14" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>` +
    `<rect x="95" y="46" width="50" height="74" rx="6" fill="${INK}"/>` +
    // il soggetto nel mirino: una faccina gialla che sorride
    `<circle cx="120" cy="80" r="15" fill="${FLASH}"/>` +
    `<circle cx="114.5" cy="77" r="2.2" fill="${INK}"/><circle cx="125.5" cy="77" r="2.2" fill="${INK}"/>` +
    `<path d="M113 85q7 7 14 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M101 120q19 -24 38 0z" fill="${PAPER}"/>` +
    `<rect class="ffl-a-screenflash" x="95" y="46" width="50" height="74" rx="6" fill="${PAPER}"/>` +
    `<circle class="ffl-a-shutter" cx="120" cy="136" r="8.5" fill="${FLASH}" stroke="${INK}" stroke-width="3.5"/>` +
    `</g>` +
    `<g class="ffl-a-pop">` +
    `<path d="${sparklePath(176, 42, 24)}" fill="${FLASH}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M176 6v8M206 42h-8M201 16l-6 6M151 16l5 6" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` +
    `</g>` +
    `<path class="ffl-a-twinkle" d="${sparklePath(58, 40, 9)}" fill="${INK}"/>`;
}

function templateArt(pid) {
  const polaroid = `<g class="ffl-a-card ffl-a-card--1">` +
    `<rect x="80" y="26" width="80" height="100" rx="3" fill="${INK}" transform="translate(6 6)"/>` +
    `<rect x="80" y="26" width="80" height="100" rx="3" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>` +
    photo(89, 35, 62, 62, pid) +
    `<path d="M97 112H143" stroke="${INK}" stroke-width="4" stroke-linecap="round"/></g>`;
  const strip = `<g class="ffl-a-card ffl-a-card--2">` +
    `<rect x="96" y="16" width="48" height="122" rx="3" fill="${INK}" transform="translate(6 6)"/>` +
    `<rect x="96" y="16" width="48" height="122" rx="3" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>` +
    photo(103, 24, 34, 28, pid) + photo(103, 58, 34, 28, pid) + photo(103, 92, 34, 28, pid) +
    `<path d="M108 129H132" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/></g>`;
  // scontrino con il bordo inferiore a dente di sega (8 denti 2:1)
  let zig = 'M86 22H154V132';
  for (let x = 154; x > 86; x -= 8.5) zig += `L${(x - 4.25).toFixed(2)} 136.25L${(x - 8.5).toFixed(2)} 132`;
  zig += 'Z';
  const receipt = `<g class="ffl-a-card ffl-a-card--3">` +
    `<path d="${zig}" fill="${INK}" transform="translate(6 6)"/>` +
    `<path d="${zig}" fill="${PAPER}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M100 34H140" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
    photo(96, 44, 48, 42, pid) +
    `<path d="M95 98H145" stroke="${INK}" stroke-width="2.5" stroke-dasharray="5 3.5"/>` +
    `<path d="M104 110H136M110 121H130" stroke="${INK}" stroke-width="3" stroke-linecap="round"/></g>`;
  const chips = [72, 108, 144].map((x, i) =>
    `<rect x="${x}" y="150" width="28" height="14" rx="7" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>` +
    `<rect class="ffl-a-chip ffl-a-chip--${i + 1}" x="${x}" y="150" width="28" height="14" rx="7" fill="${FLASH}" stroke="${INK}" stroke-width="2.5"/>`).join('');
  return `<defs>${dotsPattern(pid)}</defs>` +
    `<circle cx="120" cy="88" r="72" fill="#3D8BFF"/>` +
    polaroid + strip + receipt + chips;
}

function printArt(pid, cid) {
  // la carta esce dalla fessura in alto: è ritagliata sopra la fessura e sale (transform)
  let zig = 'M92 104V30';
  for (let x = 92; x < 148; x += 8) zig += `L${x + 4} 26L${x + 8} 30`;
  zig += 'V104Z';
  return `<defs>${dotsPattern(pid)}<clipPath id="${cid}"><rect x="0" y="0" width="240" height="97"/></clipPath></defs>` +
    `<circle cx="120" cy="90" r="72" fill="#22B89A"/>` +
    `<g clip-path="url(#${cid})"><g class="ffl-a-paper">` +
    `<path d="${zig}" fill="${PAPER}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
    photo(100, 38, 40, 40, pid) +
    `<path d="M104 88H136" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `</g></g>` +
    `<rect x="60" y="94" width="120" height="62" rx="16" fill="${INK}" transform="translate(7 7)"/>` +
    `<rect x="60" y="94" width="120" height="62" rx="16" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>` +
    `<path d="M84 97H156" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="${BOLT}" transform="translate(109 110) scale(1.05)" fill="${FLASH}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<circle cx="80" cy="128" r="6" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>` +
    `<circle class="ffl-a-led" cx="160" cy="128" r="5.5" fill="#22B89A" stroke="${INK}" stroke-width="3"/>` +
    `<path class="ffl-a-whoosh" d="M74 52h-12M70 66h-18M168 52h12M172 66h18" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
}

export function how(env) {
  const { t } = env;
  const titleId = 'ffl-how-title';
  const steps = [
    { n: 1, title: 'land_how_1_title', text: 'land_how_1_text', art: snapArt(), accent: 'flash' },
    { n: 2, title: 'land_how_2_title', text: 'land_how_2_text', art: templateArt(svgId('dots')), accent: 'sky' },
    { n: 3, title: 'land_how_3_title', text: 'land_how_3_text', art: printArt(svgId('dots'), svgId('slot')), accent: 'mint' },
  ];

  const list = h('ol', { class: 'ffl-steps' }, ...steps.map((step) => {
    const pic = h('div', { class: 'ffl-step__art' }, art('0 0 240 180', step.art, 'ffl-step__svg'));
    env.play(pic);
    return h('li', { class: ['ffl-step', `ffl-step--${step.accent}`, 'ffl-reveal'] },
      pic,
      h('span', { class: 'ffl-step__num', 'aria-hidden': 'true' }, String(step.n)),
      h('h3', { class: 'ffl-step__title' }, t(step.title)),
      h('p', { class: 'ffl-step__text' }, t(step.text)));
  }));

  const el = h('section', { class: 'ffl-section ffl-section--paper ffl-how', id: 'ffl-how', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-wrap' },
      sectionHead({ num: '02', eyebrow: t('land_how_eyebrow'), title: t('land_how_title'), lead: t('land_how_lead'), id: titleId }),
      list));
  return { el };
}
