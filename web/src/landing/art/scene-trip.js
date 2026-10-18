// Scena 4 — gita o viaggio: tre flash, tre polaroid termiche (montagne, spiaggia, faro) escono
// dalla stampantina e planano una dopo l'altra nel diario di viaggio; poi un timbro segna la pagina
// e un aeroplanino di carta attraversa la scena.
import {
  C, SW, n, at, backdrop, glare, slotWindow, say, printer, paperSheet, photoSlot, paperText, sparkle,
  halftone, flashBurst, phone, starPath,
} from './kit.js';
import { drawBeach, drawLighthouse, drawMountains } from './photos.js';
import { timeline } from './timeline.js';

const SLOT = { x: 404, y: 146 };
const POL = { w: 54, h: 64 };
const DOTS = { w: 48, h: 40 };
// dove atterrano le tre polaroid (angolo in basso al centro, rotazione)
const SPOTS = [
  { x: 120, y: 292, r: -8 },
  // a sinistra della puntina del percorso, che resta visibile
  { x: 182, y: 270, r: 7 },
  { x: 292, y: 300, r: -4 },
];
const STAMP = { x: 372, y: 262 };
const SLOTS = ['trip1', 'trip2', 'trip3'];

/** Polaroid termica: foto e fascia bianca; angolo in basso al centro in 0,0. */
function polaroid(slot) {
  const pw = 46;
  return `<g transform="translate(${-POL.w / 2} ${-POL.h})">` +
    paperSheet(POL.w, POL.h, { edges: 'bottom', tooth: 6.75, sw: 2.5 }) +
    photoSlot(slot, 4, 4, pw, DOTS.w, DOTS.h) +
    `<path d="M10 ${n(4 + (pw * DOTS.h) / DOTS.w + 9)}H32" stroke="${C.ink}" stroke-width="2" stroke-linecap="round"/>` +
    `</g>`;
}

function diary() {
  const path = 'M96 304C120 280 150 300 168 276S214 236 232 226';
  return `<rect x="${58 + 6}" y="${190 + 6}" width="364" height="140" rx="16" fill="${C.ink}"/>` +
    `<rect x="58" y="190" width="364" height="140" rx="16" fill="${C.coral}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<path d="M68 198H236Q240 198 240 202V322H72Q68 322 68 318Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M244 198H408Q412 198 412 202V318Q412 322 408 322H244Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M240 194V326" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="${path}" fill="none" stroke="${C.graphite}" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>` +
    `<g transform="translate(232 224)"><path d="M0 0C-7 -9 -10 -13 -10 -18A10 10 0 1 1 10 -18C10 -13 7 -9 0 0Z" fill="${C.coral}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="0" cy="-18" r="3.5" fill="${C.paper}"/></g>` +
    `<path d="M262 214q6 -5 12 0t12 0t12 0M262 228q6 -5 12 0t12 0M330 214q6 -5 12 0t12 0" fill="none" stroke="${C.graphite}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M236 326V352L241 346L246 352V326" fill="${C.flash}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>`;
}

function stamp() {
  // timbro: impugnatura con il pomello, base di gomma; perno in basso al centro
  return `<rect x="-26" y="-22" width="52" height="16" rx="4" fill="${C.ink}" transform="translate(3 3)"/>` +
    `<rect x="-26" y="-22" width="52" height="16" rx="4" fill="${C.graphite}" stroke="${C.ink}" stroke-width="3"/>` +
    `<rect x="-22" y="-6" width="44" height="6" rx="2" fill="${C.coral}" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<path d="M-6 -22V-44H6V-22Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>` +
    `<circle cx="0" cy="-54" r="13" fill="${C.coral}" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="M-6 -60q4 -5 9 -4" fill="none" stroke="${C.paper}" stroke-width="3" stroke-linecap="round"/>`;
}

function imprint() {
  return `<g transform="rotate(-10)"><rect x="-34" y="-17" width="68" height="34" rx="8" fill="none" stroke="${C.coral}" stroke-width="3"/>` +
    `<rect x="-29" y="-12" width="58" height="24" rx="5" fill="none" stroke="${C.coral}" stroke-width="1.5"/>` +
    paperText('scene_trip_stamp', 0, 4, 10, 50, { cls: 'ffs-stamp-text' }) + `</g>`;
}

function plane() {
  return `<path d="M0 0L34 -10L12 8Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M12 8L14 -2L34 -10" fill="${C.fog}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M-6 6H-26M-10 12H-22" stroke="${C.ink}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 4"/>`;
}

/** Mano con il telefono che spunta da destra, con il lampo. */
function handPhone() {
  return `<path d="M492 66L452 74" stroke="${C.ink}" stroke-width="22" stroke-linecap="round"/>` +
    `<path d="M492 66L452 74" stroke="${C.sky}" stroke-width="15" stroke-linecap="round"/>` +
    flashBurst(424, 60, 24, '', 'snap1 snap2 snap3') +
    at(436, 70, '', `<g transform="rotate(-20)">${phone(24, 42)}</g>`) +
    `<circle cx="448" cy="76" r="8" fill="${C.paper}" stroke="${C.ink}" stroke-width="3"/>`;
}

function flightMoves(i) {
  const spot = SPOTS[i];
  const name = `pol${i + 1}`;
  return {
    [`in${i + 1}`]: { [`${name}In`]: { y: 0, dur: 380, ease: 'steps(6, end)' } },
    [`fly${i + 1}`]: {
      [`${name}In`]: { o: 0, odur: 0, dur: 0 },
      [name]: { o: 1, odur: 0, x: spot.x - SLOT.x, y: spot.y - SLOT.y, r: spot.r + (i === 1 ? 360 : 0), s: 1, dur: 620, ease: 'io' },
    },
  };
}

const flights = [0, 1, 2].map(flightMoves);

export const trip = {
  id: 'trip',
  color: C.mint,
  timeline: timeline(6400, [
    ['snap1', 0],
    ['in1', 250],
    ['fly1', 700],
    ['snap2', 1350],
    ['in2', 1550],
    ['fly2', 2000],
    ['snap3', 2650],
    ['in3', 2850],
    ['fly3', 3300],
    ['stamp', 3950],
    ['press', 4300],
    ['lift', 4550],
    ['plane', 4800],
    ['out', 5900],
  ]),
  photos: [
    { slot: 'trip1', draw: drawMountains, width: DOTS.w, height: DOTS.h },
    { slot: 'trip2', draw: drawBeach, width: DOTS.w, height: DOTS.h },
    { slot: 'trip3', draw: drawLighthouse, width: DOTS.w, height: DOTS.h },
  ],
  faces: {
    snap1: { printer: 'smile dot' },
    in1: { printer: 'smile shut' },
    fly1: { printer: 'open happy' },
    in2: { printer: 'smile shut' },
    fly2: { printer: 'open happy' },
    in3: { printer: 'smile shut' },
    fly3: { printer: 'open happy' },
    press: { printer: 'o wide' },
    plane: { printer: 'smile happy' },
    out: { printer: 'smile dot' },
  },
  moves: {
    snap1: {
      pol1In: { y: POL.h + 4, dur: 0, o: 1, odur: 0 },
      pol2In: { y: POL.h + 4, dur: 0, o: 1, odur: 0 },
      pol3In: { y: POL.h + 4, dur: 0, o: 1, odur: 0 },
      pol1: { o: 0, odur: 0, dur: 0 },
      pol2: { o: 0, odur: 0, dur: 0 },
      pol3: { o: 0, odur: 0, dur: 0 },
      stamp: { y: -330, o: 0, dur: 0, odur: 0 },
      imprint: { s: 1.4, o: 0, dur: 0, odur: 0 },
    },
    ...flights[0],
    ...flights[1],
    ...flights[2],
    stamp: { stamp: { y: 0, o: 1, odur: 60, dur: 340, ease: 'in' } },
    press: {
      stamp: { y: 3, sy: 0.88, sx: 1.06, dur: 120, ease: 'out' },
      imprint: { s: 1, o: 1, odur: 60, dur: 220, ease: 'back' },
    },
    lift: { stamp: { y: -330, sx: 1, sy: 1, o: 0, odur: 120, odelay: 300, dur: 420, ease: 'in' } },
    out: {
      pol1: { o: 0, odur: 320 },
      pol2: { o: 0, odur: 320 },
      pol3: { o: 0, odur: 320 },
      imprint: { o: 0, odur: 320 },
    },
  },
  markup() {
    const pr = printer({ w: 66, h: 40, body: C.flash, led: C.mint });
    const inside = SLOTS.map((slot, i) => `<g data-a="pol${i + 1}In">${polaroid(slot)}</g>`).join('');
    const free = SLOTS.map((slot, i) => `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="pol${i + 1}">${polaroid(slot)}</g></g>`).join('');
    return (
      backdrop(C.mint, 236, 176, 146) +
      halftone(14, 22, 116, 8) +
      sparkle(160, 60, 11, { fill: C.ink }) + sparkle(310, 34, 8, { fill: C.flash, outline: true, delay: 400 }) +
      sparkle(40, 170, 8, { fill: C.ink, delay: 800 }) +
      diary() +
      `<g transform="translate(${SLOT.x} ${SLOT.y})">${pr.back}</g>` +
      slotWindow(SLOT.y, `<g transform="translate(${SLOT.x} ${SLOT.y})">${inside}</g>`) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g class="ffx-fx-buzz" data-fx="in1 in2 in3"><g class="ffx-who ffx-who-printer" data-mouth="smile" data-eyes="dot">${pr.front}</g></g></g>` +
      at(STAMP.x, STAMP.y, '', `<g data-a="imprint">${imprint()}</g>`) +
      free +
      at(STAMP.x, STAMP.y, '', `<g data-a="stamp">${stamp()}</g>`) +
      at(-40, 128, 'ffx-fx-plane', plane(), { attrs: 'data-fx="plane"' }) +
      handPhone() +
      glare('snap1 snap2 snap3') +
      say(328, 104, 'scene_sfx_whirr', 96, 38, 'right', 'in1') +
      `<g class="ffx-deco-star" transform="translate(452 214)"><path d="${starPath(7)}" fill="${C.ink}"/></g>`
    );
  },
};
