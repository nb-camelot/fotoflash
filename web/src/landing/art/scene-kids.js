// Scena 3 — fotocamera per bambini: il bambino inquadra il cane, «Bau!», flash (il cane resta a
// bocca aperta), la foto esce subito, vola sul frigo con una giravolta e una calamita a cuore la
// tiene ferma; festa per tutti, coda a elica.
import {
  C, SW, at, backdrop, floorLine, glare, slotWindow, say, person, printer, paperSheet, photoSlot,
  paperText, sparkle, halftone, heart, heartPath, flashBurst, phone, starPath,
} from './kit.js';
import { drawDog } from './photos.js';
import { timeline } from './timeline.js';

const SLOT = { x: 196, y: 280 };
const PIC = { w: 52, h: 66 };
const DOTS = { w: 48, h: 48 };
// sul frigo: angolo in basso al centro della foto
const SPOT = { x: 404, y: 204 };

/** Foto del cane con il nome sotto; angolo in basso al centro in 0,0. */
function picture() {
  const pw = 44;
  return `<g transform="translate(${-PIC.w / 2} ${-PIC.h})">` +
    paperSheet(PIC.w, PIC.h, { edges: 'bottom', tooth: 6.5, sw: 2.5 }) +
    photoSlot('dog', 4, 4, pw, DOTS.w, DOTS.h) +
    paperText('scene_kids_dog', PIC.w / 2, 4 + pw + 9, 7, 44) +
    `</g>`;
}

function dog() {
  const tail = `<g transform="translate(30 -22)"><g class="ffs-tail">` +
    `<path d="M0 0C16 -4 26 -20 22 -38" fill="none" stroke="${C.ink}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="M0 0C16 -4 26 -20 22 -38" fill="none" stroke="${C.paper}" stroke-width="5" stroke-linecap="round"/></g></g>`;
  const body =
    `<ellipse cx="4" cy="-24" rx="36" ry="28" fill="${C.ink}"/>` +
    `<ellipse cx="0" cy="-28" rx="36" ry="28" fill="${C.paper}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<ellipse cx="16" cy="-34" rx="11" ry="8" fill="${C.graphite}"/>` +
    `<rect x="-20" y="-24" width="13" height="25" rx="6" fill="${C.paper}" stroke="${C.ink}" stroke-width="3"/>` +
    `<rect x="7" y="-24" width="13" height="25" rx="6" fill="${C.paper}" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="M-20 -52Q0 -42 20 -52" fill="none" stroke="${C.coral}" stroke-width="7" stroke-linecap="round"/>` +
    `<circle cx="0" cy="-44" r="5" fill="${C.flash}" stroke="${C.ink}" stroke-width="2"/>`;
  const ear = (side) => `<g transform="translate(${side * 22} -42)"><g data-a="dog-ear${side < 0 ? 'L' : 'R'}">` +
    `<path d="M0 0C${-side * 4} 4 ${side * 18} 6 ${side * 16} 30C${side * 14} 38 ${side * 4} 36 ${side * 2} 26C${side * 1} 16 ${-side * 2} 8 0 0Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/></g></g>`;
  const face =
    `<g class="ffx-eyes">` +
    `<g class="ffx-e-dot"><circle cx="-10" cy="-30" r="3.6" fill="${C.ink}"/><circle cx="11" cy="-30" r="3.6" fill="${C.ink}"/></g>` +
    `<g class="ffx-e-wide"><circle cx="-10" cy="-31" r="6" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/><circle cx="11" cy="-31" r="6" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/><circle cx="-10" cy="-30" r="2.6" fill="${C.ink}"/><circle cx="11" cy="-30" r="2.6" fill="${C.ink}"/></g>` +
    `<path class="ffx-e-happy" d="M-15 -28Q-10 -35 -5 -28M6 -28Q11 -35 16 -28" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>` +
    `</g>` +
    `<ellipse cx="0" cy="-15" rx="14" ry="10" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<ellipse cx="0" cy="-20" rx="5.5" ry="4" fill="${C.ink}"/>` +
    `<path class="ffx-m-smile" d="M-7 -12Q0 -6 7 -12" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<g class="ffx-m-tongue"><path d="M-7 -12Q0 -6 7 -12" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/><path d="M-3 -9Q-3 2 2 2Q6 2 5 -9Z" fill="${C.coral}" stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round"/></g>` +
    `<ellipse class="ffx-m-o" cx="0" cy="-8" rx="4" ry="5" fill="${C.ink}"/>` +
    `<path class="ffx-m-open" d="M-8 -12Q0 2 8 -12Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>`;
  const head = ear(-1) + ear(1) +
    `<circle cx="3" cy="-23" r="27" fill="${C.ink}"/>` +
    `<circle cx="0" cy="-26" r="27" fill="${C.paper}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<ellipse cx="11" cy="-31" rx="10" ry="9" fill="${C.graphite}"/>` + face;
  return `<g transform="translate(286 322)"><g data-a="dog"><g class="ffx-who ffx-who-dog" data-mouth="smile" data-eyes="dot">` +
    `<g class="ffx-fx-hop" data-fx="happy">${tail}${body}` +
    `<g transform="translate(0 -50)"><g data-a="dog-head">${head}</g></g>` +
    `</g></g></g></g>`;
}

function fridge() {
  return `<rect x="${352 + 6}" y="${58 + 6}" width="104" height="264" rx="18" fill="${C.ink}"/>` +
    `<rect x="352" y="58" width="104" height="264" rx="18" fill="${C.paper}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<path d="M352 132H456" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="M364 82V112M364 150V196" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/>` +
    // un disegno del bambino, già appeso
    // (sotto il posto della foto nuova, così la foto non copre la sua calamita)
    `<g transform="translate(420 262) rotate(6)"><rect x="-20" y="-24" width="40" height="48" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<circle cx="-6" cy="-10" r="6" fill="${C.flash}" stroke="${C.ink}" stroke-width="2"/><path d="M-14 14L-4 2L4 10L10 4L16 14Z" fill="${C.mint}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/></g>` +
    `<circle cx="420" cy="240" r="6" fill="${C.sky}" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<path d="${starPath(9)}" transform="translate(436 92)" fill="${C.flash}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`;
}

/** Telefono nella mano del bambino, con il lampo; la mano è in 0,0 (il braccio è ruotato di -75°). */
const kidPhone = `<g transform="rotate(75)">` + flashBurst(16, -14, 22, '', 'snap') +
  `<g transform="translate(4 -8) rotate(90)">${phone(22, 38, { screen: C.sky })}</g></g>`;

export const kids = {
  id: 'kids',
  color: C.sky,
  timeline: timeline(6300, [
    ['aim', 0],
    ['woof', 550],
    ['snap', 1200],
    ['print', 1650],
    ['fly', 2850],
    ['land', 3250],
    ['magnet', 3650],
    ['happy', 4200],
    ['out', 5850],
  ]),
  photos: [{ slot: 'dog', draw: drawDog, width: DOTS.w, height: DOTS.h }],
  faces: {
    aim: { k: 'smile dot', dog: 'tongue dot', printer: 'smile dot' },
    woof: { dog: 'open happy' },
    snap: { dog: 'o wide', k: 'open happy' },
    print: { k: 'o wide', dog: 'smile dot', printer: 'smile shut' },
    fly: { printer: 'open happy', k: 'open wide' },
    magnet: { dog: 'o wide' },
    happy: { k: 'open happy', dog: 'tongue happy', printer: 'smile happy' },
    out: { k: 'smile dot', dog: 'tongue dot', printer: 'smile dot' },
  },
  moves: {
    aim: {
      pIn: { y: PIC.h + 4, dur: 0 },
      pic: { o: 0, odur: 0, dur: 0 },
      magnet: { y: -70, o: 0, odur: 0, dur: 0 },
      'k-armR': { r: -75, dur: 0 },
      'k-armL': { r: -55, dur: 0 },
    },
    woof: { 'dog-head': { r: -10, ease: 'back', dur: 300 } },
    snap: {
      'dog-head': { r: 0, dur: 200 },
      'dog-earL': { r: 55, ease: 'back', dur: 220 },
      'dog-earR': { r: -55, ease: 'back', dur: 220 },
    },
    print: {
      pIn: { y: 0, dur: 1100, ease: 'steps(11, end)' },
      'dog-earL': { r: 0 },
      'dog-earR': { r: 0 },
      'dog-head': { r: -14, ease: 'back' },
      'k-head': { r: 12, ease: 'back' },
      // abbassa il telefono lungo il fianco: a -35 finiva sopra la stampantina
      'k-armR': { r: -15 },
      'k-armL': { r: -20 },
    },
    fly: {
      pIn: { o: 0, odur: 0, dur: 0 },
      pic: { o: 1, odur: 0, x: 120, y: -170, r: 170, dur: 400, ease: 'out' },
      'dog-head': { r: 10, ease: 'back' },
      'k-head': { r: -6 },
    },
    land: { pic: { x: SPOT.x - SLOT.x, y: SPOT.y - SLOT.y, r: 356, dur: 380, ease: 'in' } },
    magnet: { magnet: { y: 0, o: 1, odur: 90, dur: 360, ease: 'back' } },
    happy: {
      'k-armL': { r: 125, ease: 'back', dur: 320 },
      'k-armR': { r: -120, ease: 'back', dur: 320 },
      'k-head': { r: 0 },
      'dog-head': { r: 0 },
    },
    out: {
      pic: { o: 0, odur: 300 },
      magnet: { o: 0, odur: 300 },
      'k-armR': { r: -75, dur: 420 },
      'k-armL': { r: -55, dur: 420 },
    },
  },
  markup() {
    const pr = printer({ w: 60, h: 34, body: C.coral });
    return (
      backdrop(C.sky) +
      halftone(10, 30, 120, 8) +
      sparkle(330, 40, 10, { fill: C.ink }) + sparkle(200, 76, 8, { fill: C.flash, outline: true, delay: 500 }) +
      floorLine() +
      fridge() +
      `<g transform="translate(${SLOT.x} ${SLOT.y})">${pr.back}</g>` +
      slotWindow(SLOT.y, `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="pIn">${picture()}</g></g>`) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g class="ffx-fx-buzz" data-fx="print"><g class="ffx-who ffx-who-printer" data-mouth="smile" data-eyes="dot">${pr.front}</g></g></g>` +
      dog() +
      person('k', 104, 322, 0.92, { shirt: C.flash, hair: 'curly', jump: 'happy', holdR: kidPhone }) +
      at(358, 168, 'ffx-fx-float', `<path d="${heartPath(9)}" fill="${C.coral}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>`, { attrs: 'data-fx="happy"', style: '--fx:-8px' }) +
      at(244, 198, 'ffx-fx-float', heart(7), { attrs: 'data-fx="happy"', style: '--fx:10px;animation-delay:200ms' }) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="pic"><g class="ffx-fx-wobble" data-fx="magnet">${picture()}</g></g></g>` +
      at(SPOT.x, SPOT.y - PIC.h + 2, '', `<g data-a="magnet"><path d="${heartPath(10)}" fill="${C.coral}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/></g>`) +
      glare('snap') +
      say(300, 174, 'scene_sfx_woof', 80, 38, 'down', 'woof happy', { keep: true })
    );
  },
};
