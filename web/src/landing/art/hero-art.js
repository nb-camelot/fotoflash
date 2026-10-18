// Illustrazione della hero (viewBox 600 x 580): il telefono inquadra e fa flash, la stampantina
// riceve la foto e la stampa; il foglio esce dalla fessura a gradini con la foto vera retinata,
// poi si stacca tra i coriandoli. Qui solo il markup e le misure; il movimento è in hero.js e in
// scenes.css.
import { BRAND_TEXT } from '../../core/template.js';
import {
  C, SW, n, at, sparkle, halftone, dot, flashBurst, boltPath, confetti, printer, paperSheet, paperText,
} from './kit.js';
import { timeline } from './timeline.js';

export const HERO_VIEW = Object.freeze({ width: 600, height: 580 });

/** Fessura della stampante, foglio e foto (unità del viewBox). */
export const HERO_GEOMETRY = Object.freeze({
  slotY: 408,
  centerX: 424,
  paperW: 248,
  paperH: 372,
  photo: Object.freeze({ x: 14, y: 46, w: 220, h: 275 }),
});

/** La storia della hero: 8 secondi in loop. */
export const HERO_TIMELINE = timeline(8000, [
  ['aim', 0],
  ['flash', 700],
  ['send', 1300],
  ['print', 1800],
  ['done', 5300],
  ['out', 7300],
]);

/** Inizio e durata della stampa, per l'avanzamento a gradini della carta. */
export const HERO_PRINT = Object.freeze({ start: 1800, duration: 3400, band: 4 });

/** Espressioni della stampantina battuta per battuta ('bocca occhi'). */
export const HERO_FACES = Object.freeze({
  aim: { printer: 'smile dot' },
  send: { printer: 'o wide' },
  print: { printer: 'smile shut' },
  done: { printer: 'open happy' },
  out: { printer: 'smile dot' },
});

function phoneMarkup() {
  // Telefono centrato in 0,0 (168 x 330), inclinato di -8°; nello schermo la scena inquadrata.
  const screen =
    `<rect width="148" height="270" fill="${C.sky}"/>` +
    `<path d="M34 75Q30 120 52 160M62 54Q66 110 58 160" fill="none" stroke="${C.ink}" stroke-width="2"/>` +
    `<circle cx="34" cy="58" r="17" fill="${C.coral}" stroke="${C.ink}" stroke-width="3"/>` +
    `<circle cx="62" cy="40" r="14" fill="${C.flash}" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="M10 270C10 214 38 200 74 200S138 214 138 270Z" fill="${C.coral}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<circle cx="74" cy="148" r="42" fill="${C.paper}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<path d="M32 140C30 112 50 104 74 104S118 112 116 140C104 126 90 122 76 124C60 126 44 132 32 140Z" fill="${C.ink}"/>` +
    `<g class="ffh-vf-eyes"><circle cx="60" cy="150" r="4.6" fill="${C.ink}"/><circle cx="88" cy="150" r="4.6" fill="${C.ink}"/></g>` +
    `<ellipse cx="50" cy="164" rx="7" ry="4.4" fill="${C.coral}"/><ellipse cx="98" cy="164" rx="7" ry="4.4" fill="${C.coral}"/>` +
    `<path d="M60 166Q74 186 88 166Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M12 34V12H34M114 12H136V34M136 236V258H114M34 258H12V236" fill="none" stroke="${C.paper}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect class="ffh-screen-glare" width="148" height="270" fill="${C.paper}"/>`;
  return `<g transform="translate(150 292) rotate(-8)"><g class="ffh-phone">` +
    `<rect x="-76" y="-157" width="168" height="330" rx="30" fill="${C.flashDeep}"/>` +
    `<rect x="-84" y="-165" width="168" height="330" rx="30" fill="${C.ink}"/>` +
    `<svg x="-74" y="-153" width="148" height="270" overflow="hidden">${screen}</svg>` +
    `<circle cx="0" cy="-159" r="2.6" fill="${C.graphite}"/>` +
    `<circle cx="0" cy="141" r="14" fill="${C.flash}" stroke="${C.paper}" stroke-width="3.5"/>` +
    `<rect x="-58" y="132" width="18" height="18" rx="4" fill="${C.graphite}" stroke="${C.paper}" stroke-width="2.5"/>` +
    at(-49, 141, 'ffh-thumb', `<rect x="-9" y="-9" width="18" height="18" rx="4" fill="${C.paper}" stroke="${C.paper}" stroke-width="2.5"/><circle cx="-2" cy="-1" r="4.5" fill="${C.ink}"/><path d="M-9 9H9V4Q0 -2 -9 4Z" fill="${C.ink}"/>`) +
    `<circle cx="48" cy="141" r="8" fill="none" stroke="${C.paper}" stroke-width="3"/>` +
    `</g></g>`;
}

function boltMarkup() {
  const rays = 'M-30 -30L-40 -40M0 -38V-52M30 -30L40 -40M38 4H52M-38 4H-52';
  return flashBurst(262, 104, 40, 'ffh-burst') +
    at(262, 104, 'ffh-bolt',
      `<path d="${boltPath(64)}" transform="translate(3 3)" fill="${C.ink}"/>` +
      `<path d="${boltPath(64)}" fill="${C.flash}" stroke="${C.ink}" stroke-width="${SW}" stroke-linejoin="round"/>` +
      `<path class="ffh-rays" d="${rays}" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>`);
}

function sendDots() {
  let out = '';
  for (let i = 0; i < 3; i++) {
    out += at(238, 300, 'ffh-send', `<circle r="${6 - i}" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/>`,
      { style: `--dx:78px;--dy:104px;animation-delay:${i * 130}ms` });
  }
  return out;
}

function paperMarkup() {
  const { paperW: w, paperH: h, photo } = HERO_GEOMETRY;
  const dash = `M${photo.x} ${n(photo.y + photo.h + 14)}H${n(photo.x + photo.w)}`;
  return `<g transform="translate(${n(-w / 2)} ${n(-h)})">` +
    paperSheet(w, h, { sw: 3 }) +
    `<text class="ffx-display" x="${n(w / 2)}" y="33" font-size="22" text-anchor="middle" fill="${C.ink}">${BRAND_TEXT}</text>` +
    `<image class="ffh-photo" x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" preserveAspectRatio="none" href=""/>` +
    `<path d="${dash}" stroke="${C.ink}" stroke-width="2" stroke-dasharray="6 4"/>` +
    paperText('scene_hero_caption', w / 2, photo.y + photo.h + 37, 14, photo.w) +
    `</g>`;
}

/** Markup completo della hero (dentro un <svg viewBox="0 0 600 580">). */
export function heroMarkup() {
  const { slotY, centerX, paperW } = HERO_GEOMETRY;
  const pr = printer({ w: 292, h: 146, slot: 0.9 });
  return (
    `<g class="ffx-deco">${halftone(14, 366, 176, 9)}${halftone(458, 6, 128, 8)}</g>` +
    `<circle cx="330" cy="300" r="236" fill="${C.flash}"/>` +
    `<circle class="ffh-glare" cx="330" cy="300" r="236" fill="${C.paper}"/>` +
    dot(70, 196, 7, C.sky) + dot(576, 384, 7, C.coral) + dot(204, 552, 6, C.mint) +
    `<g class="ffx-deco">${sparkle(92, 104, 16)}${sparkle(306, 34, 10, { delay: 500 })}${sparkle(38, 286, 9, { delay: 900 })}</g>` +
    sparkle(568, 262, 13, { fill: C.flash, outline: true, delay: 300 }) +
    phoneMarkup() +
    boltMarkup() +
    sendDots() +
    confetti(centerX, 200, 28, { seed: 11, spread: 270, up: 200, fall: 210, cls: 'ffh-confetti' }) +
    `<g transform="translate(${centerX} ${slotY})">${pr.back}</g>` +
    `<svg x="0" y="0" width="600" height="${slotY}" overflow="hidden">` +
    `<g transform="translate(${centerX} ${slotY})"><g class="ffh-feed"><g class="ffh-lift">${paperMarkup()}</g></g></g>` +
    `</svg>` +
    `<rect class="ffh-heat" x="${n(centerX - paperW / 2)}" y="${slotY - 9}" width="${paperW}" height="9" fill="${C.flash}"/>` +
    `<g transform="translate(${centerX} ${slotY})"><g class="ffh-printer"><g class="ffx-who ffx-who-printer" data-mouth="smile" data-eyes="dot">${pr.front}</g></g></g>` +
    `<g class="ffh-yay">${sparkle(560, 118, 15, { fill: C.flash, outline: true })}${sparkle(286, 168, 12, { fill: C.paper, outline: true, delay: 200 })}${sparkle(578, 200, 9, { fill: C.coral, outline: true, delay: 400 })}</g>`
  );
}
