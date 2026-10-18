// Scena 2 — matrimonio, guestbook: un amico scatta agli sposi, dalla stampantina sul tavolo esce
// lo scontrino ricordo con l'hashtag degli sposi, vola nel libro degli ospiti e ci resta attaccato
// con un pezzo di nastro; cuori.
import {
  C, SW, n, at, backdrop, floorLine, glare, slotWindow, say, person, printer, paperSheet, photoSlot,
  paperText, sparkle, halftone, heart, flashBurst, phone,
} from './kit.js';
import { drawCouple } from './photos.js';
import { timeline } from './timeline.js';

const SLOT = { x: 290, y: 206 };
const REC = { w: 52, h: 104 };
const DOTS = { w: 48, h: 40 };
// dove finisce lo scontrino: sulla pagina destra del libro (angolo in basso al centro)
const TARGET = { x: 428, y: 244, r: 4, s: 0.78 };

/** Scontrino ricordo con foto, hashtag e cuore; angolo in basso al centro in 0,0. */
function receipt() {
  const pw = 42;
  const ph = (pw * DOTS.h) / DOTS.w;
  return `<g transform="translate(${-REC.w / 2} ${-REC.h})">` +
    paperSheet(REC.w, REC.h, { tooth: 6.5, sw: 2.5 }) +
    photoSlot('couple', 5, 9, pw, DOTS.w, DOTS.h) +
    paperText('scene_wedding_tag', REC.w / 2, n(9 + ph + 12), 7.5, 44) +
    `<path d="${'M26 77.5C18 72 18 66 22 65C24 64.5 25.5 65.5 26 67C26.5 65.5 28 64.5 30 65C34 66 34 72 26 77.5Z'}" fill="${C.ink}"/>` +
    `<path d="M7 86H45" stroke="${C.ink}" stroke-width="1.5" stroke-dasharray="3 2"/>` +
    `</g>`;
}

function guestbook() {
  // libro aperto su un leggio, con firme scarabocchiate e un cuore
  const scribbles = [
    'M342 186q6 -6 12 0t12 0t12 0',
    'M342 200q5 -5 10 0t10 0t10 0t10 0',
    'M342 214q6 -6 12 0t12 0',
    'M342 228q5 -5 10 0t10 0t10 0t10 0',
  ].join('');
  // gambe del leggio fino al pavimento, dentro la scheda (la destra prima usciva dal bordo)
  return `<path d="M338 254L328 320M462 254L470 320" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>` +
    `<rect x="${330 + 4}" y="${166 + 4}" width="140" height="92" rx="10" fill="${C.ink}"/>` +
    `<rect x="330" y="166" width="140" height="92" rx="10" fill="${C.sky}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<path d="M336 172H398V252H340Q336 252 336 248Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M402 172H464V248Q464 252 460 252H402Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M400 168V256" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="${scribbles}" fill="none" stroke="${C.graphite}" stroke-width="2" stroke-linecap="round"/>` +
    `<g transform="translate(372 240) scale(.55)">${heart(10)}</g>` +
    `<path d="M392 256V282L397 276L402 282V256" fill="${C.coral}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>`;
}

function table() {
  return `<path d="M258 268V318M300 268V318" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>` +
    `<rect x="238" y="${SLOT.y + 50}" width="104" height="14" rx="5" fill="${C.ink}" transform="translate(3 3)"/>` +
    `<rect x="238" y="${SLOT.y + 50}" width="104" height="14" rx="5" fill="${C.paper}" stroke="${C.ink}" stroke-width="3"/>`;
}

function friendPhone() {
  // il braccio di un amico entra dall'alto a destra con il telefono
  return `<path d="M500 18L446 58" stroke="${C.ink}" stroke-width="24" stroke-linecap="round"/>` +
    `<path d="M500 18L446 58" stroke="${C.mint}" stroke-width="17" stroke-linecap="round"/>` +
    flashBurst(404, 84, 30, '', 'snap') +
    at(428, 74, '', `<g transform="rotate(-28)">${phone(32, 56)}</g>`) +
    `<circle cx="442" cy="62" r="9" fill="${C.paper}" stroke="${C.ink}" stroke-width="3"/>`;
}

function hearts(fx) {
  const spots = [[104, 150, -10, 0], [146, 132, 6, 220], [182, 156, 14, 420]];
  return spots.map(([x, y, fxv, delay]) =>
    at(x, y, 'ffx-fx-float', heart(8), { attrs: `data-fx="${fx}"`, style: `--fx:${fxv}px;animation-delay:${delay}ms` })).join('');
}

const bouquet = `<g transform="translate(2 -4)"><path d="M0 0L-4 14M0 0L4 14" stroke="${C.ink}" stroke-width="2.5"/>` +
  `<circle cx="-6" cy="-4" r="6" fill="${C.coral}" stroke="${C.ink}" stroke-width="2"/><circle cx="6" cy="-5" r="6" fill="${C.flash}" stroke="${C.ink}" stroke-width="2"/>` +
  `<circle cx="0" cy="-11" r="6" fill="${C.mint}" stroke="${C.ink}" stroke-width="2"/></g>`;

export const wedding = {
  id: 'wedding',
  color: C.coral,
  timeline: timeline(6400, [
    ['pose', 0],
    ['snap', 700],
    ['print', 1150],
    ['tear', 2450],
    ['fly', 2750],
    ['tape', 3450],
    ['love', 3900],
    ['out', 5900],
  ]),
  photos: [{ slot: 'couple', draw: drawCouple, width: DOTS.w, height: DOTS.h }],
  faces: {
    pose: { w: 'smile dot', g: 'smile dot', printer: 'smile dot' },
    snap: { w: 'open happy', g: 'smile happy' },
    print: { w: 'o wide', g: 'o wide', printer: 'smile shut' },
    tear: { printer: 'open happy' },
    fly: { w: 'smile dot', g: 'smile dot' },
    love: { w: 'open happy', g: 'open happy', printer: 'smile happy' },
    out: { w: 'smile dot', g: 'smile dot', printer: 'smile dot' },
  },
  moves: {
    pose: {
      rIn: { y: REC.h + 4, dur: 0 },
      rec: { o: 0, odur: 0, dur: 0 },
      tape: { s: 0, o: 0, dur: 0, odur: 0 },
      'w-armL': { r: 30, dur: 0 },
    },
    snap: { 'w-head': { r: 10, ease: 'back', dur: 300 }, 'g-head': { r: -10, ease: 'back', dur: 300 } },
    print: {
      rIn: { y: 0, dur: 1250, ease: 'steps(12, end)' },
      'w-head': { r: 12, ease: 'back' },
      'g-head': { r: 8, ease: 'back' },
    },
    tear: {
      rIn: { o: 0, odur: 0, dur: 0 },
      rec: { o: 1, odur: 0, y: -14, r: -6, dur: 260, ease: 'back' },
    },
    fly: {
      rec: { x: TARGET.x - SLOT.x, y: TARGET.y - SLOT.y, r: TARGET.r, s: TARGET.s, dur: 650, ease: 'io' },
      'w-head': { r: 4 },
      'g-head': { r: 4 },
    },
    tape: { tape: { s: 1, o: 1, odur: 80, dur: 320, ease: 'back' } },
    love: {
      'w-head': { r: 12, ease: 'back' },
      'g-head': { r: -12, ease: 'back' },
      'w-armL': { r: 150, ease: 'back', dur: 380 },
      'g-armR': { r: -150, ease: 'back', dur: 380 },
    },
    out: {
      rec: { o: 0, odur: 300 },
      tape: { o: 0, odur: 300 },
      'w-head': { r: 0 },
      'g-head': { r: 0 },
      'w-armL': { r: 30 },
      'g-armR': { r: 0 },
    },
  },
  markup() {
    const pr = printer({ w: 70, h: 42, body: C.flash, led: C.mint });
    return (
      backdrop(C.coral) +
      halftone(16, 16, 112, 8) +
      sparkle(40, 200, 9, { fill: C.ink }) + sparkle(250, 40, 8, { fill: C.ink, delay: 600 }) +
      sparkle(300, 120, 9, { fill: C.flash, outline: true, delay: 300 }) +
      floorLine(322, 30, 466) +
      table() +
      guestbook() +
      `<g transform="translate(${SLOT.x} ${SLOT.y})">${pr.back}</g>` +
      slotWindow(SLOT.y, `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="rIn">${receipt()}</g></g>`) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g class="ffx-fx-buzz" data-fx="print"><g class="ffx-who ffx-who-printer" data-mouth="smile" data-eyes="dot">${pr.front}</g></g></g>` +
      person('g', 178, 322, 1.06, { shirt: C.graphite, hair: 'side', tie: C.flash, jump: 'love' }) +
      person('w', 104, 322, 1, { shirt: C.paper, dress: true, hair: 'bun', hairColor: C.coral, veil: true, holdL: bouquet, jump: 'love' }) +
      hearts('pose love') +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="rec">${receipt()}</g></g>` +
      at(TARGET.x, TARGET.y - REC.h * TARGET.s + 4, '',
        `<g data-a="tape"><rect x="-18" y="-7" width="36" height="14" rx="2" transform="rotate(-8)" fill="${C.flash}" stroke="${C.ink}" stroke-width="2.5"/></g>`) +
      friendPhone() +
      glare('snap') +
      say(330, 50, 'scene_sfx_click', 92, 38, 'right', 'snap') +
      say(190, 88, 'scene_sfx_aww', 124, 42, 'down', 'love', { keep: true })
    );
  },
};
