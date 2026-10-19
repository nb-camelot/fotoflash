// Scena 1 — festa di compleanno, fotocabina: tre flash con tre pose, la stampantina sforna la
// striscia da tre scatti, i bambini se la passano (al volo, con una giravolta) e festeggiano.
import {
  C, SW, n, at, backdrop, floorLine, glare, slotWindow, say, tripodPhone, person, printer, paperSheet,
  photoSlot, sparkle, halftone, confetti, starPath,
} from './kit.js';
import { drawPartyFrame } from './photos.js';
import { timeline } from './timeline.js';

const SLOT = { x: 336, y: 268 };
const STRIP = { w: 46, h: 126 };
const DOTS = { w: 44, h: 34 };

/** Striscia da tre scatti, con l'angolo in basso al centro in 0,0 (perno per voli e giravolte). */
function strip() {
  const pw = 36;
  const ph = (pw * DOTS.h) / DOTS.w;
  let photos = '';
  for (let i = 0; i < 3; i++) photos += photoSlot(`party${i + 1}`, 5, 8 + i * (ph + 4.2), pw, DOTS.w, DOTS.h);
  const footY = 8 + 3 * (ph + 4.2) + 2;
  return `<g transform="translate(${-STRIP.w / 2} ${-STRIP.h})">` +
    paperSheet(STRIP.w, STRIP.h, { tooth: 6.6, sw: 2.5 }) + photos +
    `<path d="M6 ${n(footY)}H40" stroke="${C.ink}" stroke-width="1.6" stroke-dasharray="3 2"/>` +
    `<path d="${starPath(5)}" transform="translate(23 ${n(footY + 9)})" fill="${C.ink}"/>` +
    `</g>`;
}

function bunting() {
  const p0 = [24, 34];
  const p1 = [240, 92];
  const p2 = [456, 34];
  const colors = [C.coral, C.mint, C.sky, C.paper, C.coral, C.mint, C.sky, C.paper, C.coral];
  let flags = '';
  for (let i = 0; i < 9; i++) {
    const t = 0.08 + i * 0.105;
    const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    flags += `<path d="M${n(x - 12)} ${n(y - 1)}L${n(x + 12)} ${n(y - 1)}L${n(x)} ${n(y + 22)}Z" fill="${colors[i]}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`;
  }
  return `<g transform="translate(240 34)"><g class="ffs-sway"><g transform="translate(-240 -34)">` +
    `<path d="M${p0[0]} ${p0[1]}Q${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]}" fill="none" stroke="${C.ink}" stroke-width="2.5"/>${flags}</g></g></g>`;
}

function balloons() {
  const inner =
    `<path d="M-22 -94Q-14 -50 0 0M16 -116Q8 -60 0 0" fill="none" stroke="${C.ink}" stroke-width="2"/>` +
    `<ellipse cx="-22" cy="-118" rx="21" ry="25" fill="${C.coral}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<path d="M-25 -93h6l-3 5z" fill="${C.coral}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>` +
    `<ellipse cx="16" cy="-138" rx="18" ry="22" fill="${C.sky}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    `<path d="M13 -116h6l-3 5z" fill="${C.sky}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M-30 -126q4 -8 10 -9M9 -146q3 -7 9 -8" fill="none" stroke="${C.paper}" stroke-width="3" stroke-linecap="round"/>`;
  return at(70, 250, 'ffs-sway ffs-sway--slow', inner);
}

export const party = {
  id: 'party',
  color: C.flash,
  timeline: timeline(7000, [
    ['pose', 0],
    ['snap1', 600],
    ['snap2', 1250],
    ['snap3', 1900],
    ['print', 2550],
    ['catch', 4000],
    ['toss', 4700],
    ['pass', 5050],
    ['cheer', 5450],
    ['out', 6550],
  ]),
  photos: [0, 1, 2].map((i) => ({ slot: `party${i + 1}`, draw: drawPartyFrame(i), width: DOTS.w, height: DOTS.h })),
  faces: {
    pose: { a: 'smile dot', b: 'smile dot', printer: 'smile dot' },
    snap1: { a: 'open dot', b: 'smile happy' },
    snap2: { a: 'tongue wink', b: 'o wide' },
    snap3: { a: 'open happy', b: 'open happy' },
    print: { a: 'o wide', b: 'o wide', printer: 'smile shut' },
    catch: { b: 'open happy', printer: 'open happy' },
    toss: { a: 'open wide', b: 'open happy' },
    pass: { a: 'open happy', b: 'smile happy', printer: 'smile happy' },
    out: { a: 'smile dot', b: 'smile dot', printer: 'smile dot' },
  },
  moves: {
    pose: {
      stripIn: { y: STRIP.h + 4, dur: 0 },
      strip: { o: 0, odur: 0, dur: 0 },
      heldA: { o: 0, odur: 0, dur: 0, r: 148, s: 0.75 },
    },
    snap1: { 'a-armL': { r: 50, ease: 'back', dur: 280 }, 'b-armR': { r: -50, ease: 'back', dur: 280 } },
    snap2: {
      'a-head': { r: -14, ease: 'back', dur: 280 },
      'b-head': { r: 12, ease: 'back', dur: 280 },
      'a-armL': { r: 150, ease: 'back', dur: 280 },
      'b-armR': { r: -100, ease: 'back', dur: 280 },
    },
    snap3: {
      'a-head': { r: 0, dur: 250 },
      'b-head': { r: 0, dur: 250 },
      'a-armR': { r: -150, ease: 'back', dur: 300 },
      'b-armL': { r: 150, ease: 'back', dur: 300 },
      'b-armR': { r: -150, ease: 'back', dur: 300 },
    },
    print: {
      'a-armL': { r: 0 },
      'a-armR': { r: 0 },
      'b-armL': { r: 0 },
      'b-armR': { r: 0 },
      'a-head': { r: 10, ease: 'back' },
      'b-head': { r: 12, ease: 'back' },
      stripIn: { y: 0, dur: 1300, ease: 'steps(13, end)' },
    },
    catch: {
      stripIn: { o: 0, odur: 0, dur: 0 },
      strip: { o: 1, odur: 0, x: -66, y: -40, r: -10, s: 0.75, dur: 620, ease: 'back' },
      'b-armR': { r: -140, ease: 'back', dur: 420 },
      'b-head': { r: -4 },
    },
    toss: {
      strip: { x: -110, y: -100, r: 170, s: 0.75, dur: 340, ease: 'out' },
      'b-armR': { r: -70, dur: 300 },
      'a-head': { r: 6 },
    },
    pass: {
      strip: { x: -149, y: -37, r: 368, s: 0.75, dur: 360, ease: 'in', o: 0, odur: 0, odelay: 360 },
      heldA: { o: 1, odur: 0, odelay: 340 },
      'a-armR': { r: -140, ease: 'back', dur: 380 },
      'a-head': { r: -6 },
      'b-armR': { r: 0 },
    },
    cheer: {
      'a-armL': { r: 145, ease: 'back', dur: 320 },
      'b-armL': { r: 145, ease: 'back', dur: 320 },
      'b-armR': { r: -145, ease: 'back', dur: 320 },
      'a-head': { r: 0 },
      'b-head': { r: 0 },
    },
    out: {
      'a-armL': { r: 0, dur: 420 },
      'a-armR': { r: 0, dur: 420 },
      'b-armL': { r: 0, dur: 420 },
      'b-armR': { r: 0, dur: 420 },
      heldA: { o: 0, odur: 260 },
    },
  },
  markup() {
    const pr = printer({ w: 78, h: 48, body: C.coral });
    const held = `<g data-a="heldA">${strip()}</g>`;
    return (
      backdrop(C.flash) +
      halftone(8, 196, 128, 8) +
      sparkle(452, 126, 10, { fill: C.ink }) + sparkle(318, 100, 7, { fill: C.ink, delay: 700 }) +
      floorLine() +
      bunting() +
      balloons() +
      tripodPhone(420, 206, 'snap1 snap2 snap3', {
        inner: `<circle cx="-5" cy="2" r="4.5" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.5"/><circle cx="5" cy="3" r="4.5" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.5"/>`,
      }) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})">${pr.back}</g>` +
      slotWindow(SLOT.y, `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="stripIn">${strip()}</g></g>`) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g class="ffx-fx-buzz" data-fx="print"><g class="ffx-who ffx-who-printer" data-mouth="smile" data-eyes="dot">${pr.front}</g></g></g>` +
      // b prima di a: la striscia che a solleva verso l'amico resta davanti alla sua testa
      person('b', 234, 322, 1, { shirt: C.sky, hair: 'spike', hat: C.mint, jump: 'cheer' }) +
      person('a', 150, 322, 0.95, { shirt: C.mint, hair: 'pigtails', hat: C.coral, jump: 'cheer', holdR: `<g transform="translate(0 -2)">${held}</g>` }) +
      `<g transform="translate(${SLOT.x} ${SLOT.y})"><g data-a="strip">${strip()}</g></g>` +
      confetti(196, 190, 22, { seed: 3, spread: 190, up: 120, fall: 120, fx: 'cheer' }) +
      glare('snap1 snap2 snap3') +
      say(380, 128, 'scene_sfx_click', 92, 38, 'right', 'snap1') +
      say(336, 146, 'scene_sfx_hooray', 120, 42, 'left', 'cheer', { keep: true })
    );
  },
};
