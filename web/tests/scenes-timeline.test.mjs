// Orologio delle animazioni della presentazione (src/landing/art/timeline.js e stage.js): battute,
// giri, riga di stampa a gradini, ciclo con requestAnimationFrame finto, attori ed espressioni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeline, beatIndexAt, beatAt, beatClasses, restingIndex, revealRows, createLoop,
} from '../src/landing/art/timeline.js';
import { monoSize, fitScale, MIN_FIT_SCALE, movesAt, actorStyle, faceAt, resolveReduced, EASE, MONO_ADVANCE } from '../src/landing/art/stage.js';
import { heroFeed } from '../src/landing/hero.js';
import { HERO_GEOMETRY, HERO_PRINT, HERO_TIMELINE } from '../src/landing/art/hero-art.js';

const TL = timeline(6000, [['pose', 0], ['snap', 800], ['print', 1500], ['done', 4000], ['out', 5500]]);

test('timeline: controlla ordine, nomi e durata', () => {
  assert.throws(() => timeline(0, [['a', 0]]), RangeError);
  assert.throws(() => timeline(1000, []), RangeError);
  assert.throws(() => timeline(1000, [['a', 10]]), /parte da 0/);
  assert.throws(() => timeline(1000, [['a', 0], ['b', 500], ['c', 400]]), /fuori ordine/);
  assert.throws(() => timeline(1000, [['a', 0], ['b', 1000]]), /fuori ordine/);
  assert.throws(() => timeline(1000, [['a', 0], ['a', 10]]), /ripetuta/);
  assert.throws(() => timeline(1000, [['A b', 0]]), /nome/);
  assert.ok(Object.isFrozen(TL) && Object.isFrozen(TL.beats));
});

test('beatAt: battuta corrente, tempo nella battuta, giri', () => {
  assert.equal(beatIndexAt(TL.beats, 0), 0);
  assert.equal(beatIndexAt(TL.beats, 799), 0);
  assert.equal(beatIndexAt(TL.beats, 800), 1);
  assert.equal(beatIndexAt(TL.beats, 5999), 4);

  const a = beatAt(TL, 1600);
  assert.deepEqual([a.loop, a.index, a.id, a.local, a.span], [0, 2, 'print', 100, 2500]);
  assert.equal(a.progress, 1600 / 6000);

  const b = beatAt(TL, 6000 * 2 + 850);
  assert.deepEqual([b.loop, b.id, b.local, Math.round(b.t)], [2, 'snap', 50, 850]);

  const last = beatAt(TL, 5800);
  assert.equal(last.id, 'out');
  assert.equal(last.span, 500);

  for (const bad of [-5, NaN, undefined]) assert.equal(beatAt(TL, bad).index, 0);
});

test('classi cumulative e fotogramma di riposo', () => {
  assert.deepEqual(beatClasses(TL, 0), ['b-pose']);
  assert.deepEqual(beatClasses(TL, 2), ['b-pose', 'b-snap', 'b-print']);
  assert.deepEqual(beatClasses(TL, 99), beatClasses(TL, 4));
  assert.equal(restingIndex(TL), 3, "il riposo è l'ultima battuta prima dell'uscita");
  assert.equal(restingIndex(timeline(1000, [['a', 0], ['b', 500]])), 1);
});

test('revealRows: righe a gradini come il motore della carta', () => {
  const opts = { start: 1000, duration: 2000, rows: 240, band: 8 };
  assert.equal(revealRows(0, opts), 0);
  assert.equal(revealRows(1000, opts), 0);
  assert.equal(revealRows(3000, opts), 240);
  assert.equal(revealRows(9999, opts), 240);
  let prev = 0;
  for (let t = 1000; t <= 3000; t += 7) {
    const r = revealRows(t, opts);
    assert.ok(r >= prev, 'non torna mai indietro');
    assert.ok(r === 240 || r % 8 === 0, `a gradini di 8: ${r}`);
    prev = r;
  }
  assert.equal(revealRows(2000, opts), 120, 'a metà tempo, metà righe');
  assert.equal(revealRows(2000, { ...opts, band: 1 }), 120);
  assert.equal(revealRows(500, { duration: 0, rows: 10 }), 10, 'senza durata è subito tutto stampato');
});

test('heroFeed: la carta della hero esce solo durante la stampa e tutta alla fine', () => {
  const { paperH } = HERO_GEOMETRY;
  const beat = (id) => HERO_TIMELINE.beats.find(([b]) => b === id)[1];
  assert.equal(heroFeed(0), 0);
  assert.equal(heroFeed(beat('flash')), 0);
  assert.equal(heroFeed(HERO_PRINT.start + HERO_PRINT.duration / 2), Math.floor(paperH / 2 / HERO_PRINT.band) * HERO_PRINT.band);
  assert.equal(heroFeed(beat('done')), paperH);
  assert.equal(heroFeed(0, true), paperH, 'fotogramma fermo: stampa già uscita');
  assert.ok(HERO_PRINT.start >= beat('print') && HERO_PRINT.start + HERO_PRINT.duration <= beat('done'));
  assert.equal(HERO_TIMELINE.duration, 8000, 'loop di circa 8 s');
});

test('createLoop: battute in ordine, giro che ricomincia, pausa che ferma il tempo', () => {
  let now = 0;
  const frames = [];
  const raf = (fn) => {
    frames.push(fn);
    return frames.length;
  };
  const caf = () => {
    frames.length = 0;
  };
  const step = (ms) => {
    now += ms;
    const queued = frames.splice(0);
    for (const fn of queued) fn();
  };
  const beats = [];
  const loop = createLoop(TL, {
    raf,
    caf,
    now: () => now,
    onBeat: (info, { wrapped }) => beats.push(`${info.id}${wrapped ? '!' : ''}`),
  });
  loop.play();
  assert.deepEqual(beats, ['pose']);
  for (let i = 0; i < 20; i++) step(50); // 1000 ms
  assert.deepEqual(beats, ['pose', 'snap']);
  loop.pause();
  now += 60000; // scheda ferma un minuto: il tempo non scorre
  assert.equal(frames.length, 0);
  loop.play();
  for (let i = 0; i < 110; i++) step(50); // +5500 ms → 6500: secondo giro
  assert.deepEqual(beats, ['pose', 'snap', 'print', 'done', 'out', 'pose!']);
  assert.equal(Math.round(loop.elapsed), 6500);

  // un fotogramma lunghissimo conta al più maxStep
  const before = loop.elapsed;
  step(5000);
  assert.equal(loop.elapsed - before, 100);

  loop.seek(4100);
  assert.equal(beats.at(-1), 'done');
  loop.restart();
  assert.equal(beats.at(-1), 'pose');
  loop.destroy();
  assert.equal(loop.playing, false);
});

test('movesAt: movimento cumulativo, tempi solo della battuta che li dichiara', () => {
  const moves = {
    pose: { strip: { y: 120, o: 0, dur: 0 } },
    print: { strip: { y: 0, dur: 1300, ease: 'steps(13, end)' } },
    done: { strip: { x: -60, r: -10, s: 0.75, o: 1, odur: 0 } },
  };
  assert.deepEqual(movesAt(TL, moves, 0), { strip: { y: 120, o: 0, dur: 0 } });
  assert.deepEqual(movesAt(TL, moves, 2), { strip: { y: 0, o: 0, dur: 1300, ease: 'steps(13, end)' } });
  assert.deepEqual(movesAt(TL, moves, 3), { strip: { y: 0, o: 1, x: -60, r: -10, s: 0.75, odur: 0 } });
  assert.deepEqual(movesAt(TL, null, 3), {});
});

test('actorStyle: transform, opacità e transizione', () => {
  assert.deepEqual(actorStyle(), {
    transform: 'translate(0px, 0px) rotate(0deg) scale(1)',
    opacity: '1',
    transition: `transform 450ms ${EASE.out} 0ms, opacity 300ms ease 0ms`,
  });
  const s = actorStyle({ x: 10, y: -4, r: 90, sx: 1.1, sy: 0.9, o: 0, dur: 600, ease: 'back', delay: 100, odur: 0, odelay: 700 });
  assert.equal(s.transform, 'translate(10px, -4px) rotate(90deg) scale(1.1, 0.9)');
  assert.equal(s.opacity, '0');
  assert.equal(s.transition, `transform 600ms ${EASE.back} 100ms, opacity 0ms ease 700ms`);
  assert.match(actorStyle({ ease: 'steps(4, end)' }).transition, /steps\(4, end\)/);
});

test('faceAt: l\'ultima espressione dichiarata vale per le battute dopo', () => {
  const faces = { pose: { a: 'smile dot', b: 'smile dot' }, snap: { a: 'open happy' }, out: { a: 'smile dot' } };
  assert.deepEqual(faceAt(TL, faces, 0), { a: 'smile dot', b: 'smile dot' });
  assert.deepEqual(faceAt(TL, faces, 3), { a: 'open happy', b: 'smile dot' });
  assert.deepEqual(faceAt(TL, faces, 4), { a: 'smile dot', b: 'smile dot' });
});

test('monoSize: il testo monospaziato si stringe solo se non ci sta', () => {
  assert.equal(monoSize('ABC', 10, 100), 10);
  const size = monoSize('RICORDO N. 0042', 8, 52);
  assert.ok(size < 8);
  assert.ok(Math.abs(size * MONO_ADVANCE * 15 - 52) < 1e-9);
  assert.equal(monoSize('', 9, 10), 9);
});

test('resolveReduced: booleano, funzione o preferenza del sistema (in Node: no)', () => {
  assert.equal(resolveReduced(true), true);
  assert.equal(resolveReduced(false), false);
  assert.equal(resolveReduced(() => 1), true);
  assert.equal(resolveReduced(undefined), false);
});

test('fitScale: i fumetti rimpiccioliscono il corpo prima di deformare le lettere', () => {
  assert.deepEqual(fitScale(80, 100), { scale: 1, squeeze: false });
  assert.deepEqual(fitScale(100, 100), { scale: 1, squeeze: false });
  const a = fitScale(120, 100);
  assert.equal(a.squeeze, false);
  assert.ok(Math.abs(a.scale - 100 / 120) < 1e-9);
  // troppo lungo: corpo al minimo, poi lettere strette
  assert.deepEqual(fitScale(200, 100), { scale: MIN_FIT_SCALE, squeeze: true });
  assert.deepEqual(fitScale(50, 0), { scale: 1, squeeze: false });
});
