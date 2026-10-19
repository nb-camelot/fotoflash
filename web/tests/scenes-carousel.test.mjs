// Carosello delle idee (src/landing/scenes.js): avanzamento, tastiera, pausa al passaggio del
// mouse o con il fuoco dentro, annunci per il lettore di schermo. Solo funzioni pure, senza DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, wrapIndex, keyToIndex, shouldAdvance, carouselStep, counterText, dotProgress } from '../src/landing/scenes.js';
import { timeline } from '../src/landing/art/timeline.js';

const START = { index: 0, count: 5, hovered: false, focused: false, paused: false };

test('le cinque scene nell\'ordine di docs/LANDING.md', () => {
  assert.deepEqual(SCENES.map((s) => s.id), ['party', 'wedding', 'kids', 'trip', 'shop']);
  for (const s of SCENES) {
    assert.ok(s.timeline.duration >= 5000 && s.timeline.duration <= 7000, `${s.id}: storia di 5-7 s (${s.timeline.duration})`);
    assert.ok(s.timeline.beats.length >= 4, `${s.id}: almeno 3 battute più l'uscita`);
    assert.equal(s.timeline.beats.at(-1)[0], 'out', `${s.id}: il giro finisce con l'uscita`);
  }
});

test('wrapIndex e keyToIndex', () => {
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(-6, 5), 4);
  assert.equal(wrapIndex(3, 0), 0);
  assert.equal(keyToIndex('ArrowRight', 4, 5), 0);
  assert.equal(keyToIndex('ArrowLeft', 0, 5), 4);
  assert.equal(keyToIndex('Home', 3, 5), 0);
  assert.equal(keyToIndex('End', 1, 5), 4);
  assert.equal(keyToIndex('Enter', 1, 5), null);
  assert.equal(keyToIndex('a', 1, 5), null);
});

test('shouldAdvance: solo a fine giro, visibile, senza mouse, fuoco, pausa o animazioni ridotte', () => {
  const ok = { loopEnd: true, visible: true, hovered: false, focused: false, paused: false, reduced: false };
  assert.equal(shouldAdvance(ok), true);
  for (const key of ['hovered', 'focused', 'paused', 'reduced']) assert.equal(shouldAdvance({ ...ok, [key]: true }), false, key);
  assert.equal(shouldAdvance({ ...ok, loopEnd: false }), false);
  assert.equal(shouldAdvance({ ...ok, visible: false }), false);
});

test('carouselStep: frecce, puntini e giro automatico', () => {
  let s = carouselStep(START, { type: 'next' });
  assert.deepEqual([s.index, s.changed, s.announce], [1, true, true]);
  s = carouselStep({ ...START, index: 0 }, { type: 'prev' });
  assert.equal(s.index, 4);
  s = carouselStep(START, { type: 'go', index: 3 });
  assert.deepEqual([s.index, s.announce], [3, true]);
  s = carouselStep({ ...START, index: 3 }, { type: 'go', index: 3 });
  assert.deepEqual([s.changed, s.announce], [false, false], 'stessa scena: niente da annunciare');

  // fine del giro: si passa alla successiva senza annunci (sarebbe rumore per il lettore di schermo)
  s = carouselStep(START, { type: 'loopEnd', reduced: false, visible: true });
  assert.deepEqual([s.index, s.changed, s.announce], [1, true, false]);
  s = carouselStep({ ...START, index: 4 }, { type: 'loopEnd', reduced: false, visible: true });
  assert.equal(s.index, 0, 'dopo l\'ultima si ricomincia');
});

test('carouselStep: mouse sopra, fuoco dentro, pausa e animazioni ridotte fermano il giro automatico', () => {
  let s = carouselStep(START, { type: 'hover', on: true });
  assert.equal(s.hovered, true);
  assert.equal(carouselStep(s, { type: 'loopEnd', reduced: false, visible: true }).index, 0);
  s = carouselStep(s, { type: 'hover', on: false });
  assert.equal(carouselStep(s, { type: 'loopEnd', reduced: false, visible: true }).index, 1);

  s = carouselStep(START, { type: 'focus', on: true });
  assert.equal(carouselStep(s, { type: 'loopEnd', reduced: false, visible: true }).index, 0);
  // con il fuoco dentro i comandi espliciti funzionano lo stesso
  assert.equal(carouselStep(s, { type: 'next' }).index, 1);

  s = carouselStep(START, { type: 'toggle' });
  assert.equal(s.paused, true);
  assert.equal(carouselStep(s, { type: 'loopEnd', reduced: false, visible: true }).index, 0);
  assert.equal(carouselStep(s, { type: 'toggle' }).paused, false);

  assert.equal(carouselStep(START, { type: 'loopEnd', reduced: true, visible: true }).index, 0);
  assert.equal(carouselStep(START, { type: 'loopEnd', reduced: false, visible: false }).index, 0);
});

test('counterText: solo numeri, due cifre', () => {
  assert.equal(counterText(0, 5), '01 / 05');
  assert.equal(counterText(4, 5), '05 / 05');
});

test('dotProgress: il puntino si riempie fino al passaggio alla scena dopo (inizio dell\'uscita)', () => {
  for (const s of SCENES) {
    const out = s.timeline.beats.at(-1)[1];
    assert.equal(dotProgress(s.timeline, 0), 0, s.id);
    assert.equal(dotProgress(s.timeline, out), 1, `${s.id}: pieno quando parte l'uscita`);
    assert.equal(dotProgress(s.timeline, s.timeline.duration - 1), 1, `${s.id}: resta pieno durante l'uscita`);
    assert.ok(Math.abs(dotProgress(s.timeline, out / 2) - 0.5) < 1e-9, s.id);
  }
  // senza uscita si riempie su tutto il giro
  const tl = timeline(4000, [['a', 0], ['b', 2000]]);
  assert.equal(dotProgress(tl, 2000), 0.5);
  assert.equal(dotProgress(tl, 4000), 1);
});
