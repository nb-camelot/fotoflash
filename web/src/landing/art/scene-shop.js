// Scena 5 — evento o negozio: alla bancarella col tendone a righe ogni ospite in fila riceve il suo
// scontrino ricordo con il logo e il numero (RICORDO N. 0042, 0043, 0044); alla fine tutta la fila
// sorride con il suo foglietto in mano.
import {
  C, SW, n, at, backdrop, floorLine, glare, slotWindow, say, person, printer, paperSheet, photoSlot,
  paperText, sparkle, halftone, heart, flashBurst, phone, starPath,
} from './kit.js';
import { drawGuest } from './photos.js';
import { timeline } from './timeline.js';

const SLOT = { x: 160, y: 162 };
const REC = { w: 60, h: 120 };
const DOTS = { w: 44, h: 36 };
const MINI = { w: 30, h: 50 };
const FIRST = 42;

/** Logo della bancarella: stella in un cerchio. */
function logo(r, fill = C.flash) {
  return `<circle r="${r}" fill="${fill}" stroke="${C.ink}" stroke-width="${n(Math.max(2, r * 0.12))}"/>` +
    `<path d="${starPath(r * 0.62)}" fill="${C.ink}"/>`;
}

/** Scontrino grande: logo, foto, RICORDO N. 0042, grazie; angolo in basso al centro in 0,0. */
function receipt() {
  const pw = 46;
  const ph = (pw * DOTS.h) / DOTS.w;
  return `<g transform="translate(${-REC.w / 2} ${-REC.h})">` +
    paperSheet(REC.w, REC.h, { tooth: 6, sw: 2.5 }) +
    `<g transform="translate(${REC.w / 2} 17)"><circle r="9" fill="none" stroke="${C.ink}" stroke-width="2"/><path d="${starPath(6)}" fill="${C.ink}"/></g>` +
    photoSlot('guest', 7, 30, pw, DOTS.w, DOTS.h) +
    paperText('scene_shop_memory', REC.w / 2, n(30 + ph + 12), 6.5, 52, { num: FIRST }) +
    `<path d="M7 ${n(30 + ph + 18)}H53" stroke="${C.ink}" stroke-width="1.5" stroke-dasharray="3 2"/>` +
    paperText('scene_shop_thanks', REC.w / 2, n(30 + ph + 30), 6.5, 48, { weight: 400 }) +
    `</g>`;
}

/** Scontrino piccolo nella mano di un ospite (numero [num]); angolo in basso al centro in 0,0. */
function mini(num) {
  return `<g transform="translate(${-MINI.w / 2} ${-MINI.h})">` +
    paperSheet(MINI.w, MINI.h, { tooth: 5, sw: 2 }) +
    `<g transform="translate(15 11)"><circle r="6" fill="none" stroke="${C.ink}" stroke-width="1.6"/><path d="${starPath(4)}" fill="${C.ink}"/></g>` +
    `<path d="M6 22H24M6 27H24M6 32H18" stroke="${C.ink}" stroke-width="2" stroke-linecap="round"/>` +
    paperText('scene_shop_memory', 15, 42, 4, 24, { num }) +
    `</g>`;
}

function stall() {
  // tendone a righe con il bordo a festoni, pali, bancone con il logo
  let stripes = '';
  for (let i = 0; i < 8; i++) {
    stripes += `<rect x="${24 + i * 25}" y="40" width="25" height="46" fill="${i % 2 ? C.paper : C.coral}"/>`;
  }
  let scallops = '';
  for (let i = 0; i < 8; i++) {
    const x = 24 + i * 25;
    scallops += `<path d="M${x} 86a12.5 12.5 0 0 0 25 0Z" fill="${i % 2 ? C.paper : C.coral}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>`;
  }
  return `<path d="M34 96V212M214 96V212" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>` +
    `<rect x="${24 + 5}" y="${34 + 5}" width="200" height="54" rx="8" fill="${C.ink}"/>` +
    `<g>${stripes}</g>` +
    `<rect x="24" y="34" width="200" height="52" rx="8" fill="none" stroke="${C.ink}" stroke-width="${SW}"/>` +
    scallops +
    `<rect x="${22 + 6}" y="${206 + 6}" width="204" height="116" rx="10" fill="${C.ink}"/>` +
    `<rect x="22" y="206" width="204" height="116" rx="10" fill="${C.paper}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<path d="M22 222H226" stroke="${C.ink}" stroke-width="3"/>` +
    `<g transform="translate(124 270)">${logo(30)}</g>`;
}

function standPhone() {
  return `<path d="M70 206V186" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M56 206H84" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>` +
    flashBurst(84, 154, 26, '', 'snap more2 more3') +
    at(72, 160, '', `<g transform="rotate(8)">${phone(30, 52)}</g>`);
}

function hearts() {
  return [[262, 150, -6, 0], [330, 128, 8, 180], [404, 140, -4, 360]]
    .map(([x, y, fx, d]) => at(x, y, 'ffx-fx-float', heart(8), { attrs: 'data-fx="smile"', style: `--fx:${fx}px;animation-delay:${d}ms` }))
    .join('');
}

export const shop = {
  id: 'shop',
  color: C.flash,
  timeline: timeline(6600, [
    ['wave', 0],
    ['snap', 500],
    ['print', 900],
    ['give', 2250],
    ['land', 2800],
    ['more2', 3250],
    ['more3', 3800],
    ['smile', 4400],
    ['out', 6100],
  ]),
  photos: [{ slot: 'guest', draw: drawGuest(0), width: DOTS.w, height: DOTS.h }],
  faces: {
    wave: { g1: 'smile dot', g2: 'smile dot', g3: 'smile dot', printer: 'smile dot' },
    snap: { g1: 'open happy' },
    print: { g1: 'o wide', printer: 'smile shut' },
    give: { printer: 'open happy' },
    land: { g1: 'open happy', printer: 'smile happy' },
    more2: { g2: 'open happy' },
    more3: { g3: 'open happy' },
    smile: { g1: 'open happy', g2: 'open happy', g3: 'open happy' },
    out: { g1: 'smile dot', g2: 'smile dot', g3: 'smile dot', printer: 'smile dot' },
  },
  moves: {
    wave: {
      rIn: { y: REC.h + 4, dur: 0 },
      rec: { o: 0, odur: 0, dur: 0 },
      held1: { o: 0, odur: 0, dur: 0, r: -146, s: 0.6 },
      mini2: { s: 0, dur: 0, r: -146 },
      mini3: { s: 0, dur: 0, r: -146 },
      'g1-armR': { r: -120, dur: 0 },
    },
    snap: { 'g1-armR': { r: 0, dur: 300 } },
    print: {
      rIn: { y: 0, dur: 1300, ease: 'steps(13, end)' },
      'g1-head': { r: -10, ease: 'back' },
      'g2-head': { r: -8, ease: 'back' },
      'g3-head': { r: -6, ease: 'back' },
    },
    give: {
      rIn: { o: 0, odur: 0, dur: 0 },
      rec: { o: 1, odur: 0, x: 62, y: 70, r: -8, s: 0.6, dur: 520, ease: 'io' },
      'g1-armL': { r: 140, ease: 'back', dur: 420 },
    },
    land: {
      rec: { o: 0, odur: 0 },
      held1: { o: 1, odur: 0 },
      'g1-head': { r: 0 },
    },
    more2: { 'g2-armL': { r: 140, ease: 'back', dur: 380 }, mini2: { s: 1, dur: 380, ease: 'back', delay: 120 } },
    more3: { 'g3-armL': { r: 140, ease: 'back', dur: 380 }, mini3: { s: 1, dur: 380, ease: 'back', delay: 120 } },
    smile: {
      'g2-head': { r: 0 },
      'g3-head': { r: 0 },
      'g1-armR': { r: -140, ease: 'back', dur: 360 },
      'g2-armR': { r: -140, ease: 'back', dur: 360 },
      'g3-armR': { r: -140, ease: 'back', dur: 360 },
    },
    out: {
      held1: { o: 0, odur: 300 },
      mini2: { s: 0, dur: 300, ease: 'in' },
      mini3: { s: 0, dur: 300, ease: 'in' },
      'g1-armL': { r: 0, dur: 420 },
      'g2-armL': { r: 0, dur: 420 },
      'g3-armL': { r: 0, dur: 420 },
      'g1-armR': { r: -120, dur: 420 },
      'g2-armR': { r: 0, dur: 420 },
      'g3-armR': { r: 0, dur: 420 },
    },
  },
  markup() {
    const pr = printer({ w: 74, h: 40, body: C.sky, led: C.flash });
    const held1 = `<g data-a="held1">${receipt()}</g>`;
    return (
      backdrop(C.flash, 250, 186, 150) +
      halftone(372, 12, 100, 8) +
      sparkle(458, 132, 9, { fill: C.ink }) + sparkle(250, 50, 8, { fill: C.paper, outline: true, delay: 500 }) +
      floorLine(322, 16, 464) +
      stall() +
      standPhone() +
      `<g transform="translate(${SLOT.x} ${SLOT.y})">${pr.back}</g>` +
      slotWindow(SLOT.y, `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="rIn">${receipt()}</g></g>`) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g class="ffx-fx-buzz" data-fx="print"><g class="ffx-who ffx-who-printer" data-mouth="smile" data-eyes="dot">${pr.front}</g></g></g>` +
      person('g3', 420, 322, 1.08, { shirt: C.mint, hair: 'curly', hairColor: C.graphite, jump: 'smile', holdL: `<g data-a="mini3">${mini(FIRST + 2)}</g>` }) +
      person('g2', 340, 322, 1.0, { shirt: C.coral, hair: 'spike', jump: 'smile', holdL: `<g data-a="mini2">${mini(FIRST + 1)}</g>` }) +
      person('g1', 266, 322, 0.9, { shirt: C.sky, hair: 'bun', hairColor: C.coral, jump: 'smile', holdL: held1 }) +
      hearts() +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="rec">${receipt()}</g></g>` +
      glare('snap more2 more3') +
      say(84, 120, 'scene_sfx_click', 88, 36, 'down', 'snap') +
      say(296, 100, 'scene_sfx_hooray', 120, 42, 'down', 'smile', { keep: true })
    );
  },
};
