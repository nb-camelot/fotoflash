// Disegni delle animazioni (src/landing/art/): coerenza tra markup e coreografie delle scene
// (attori, effetti, espressioni, foto, scritte tradotte) e foto retinate come tracciati SVG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES } from '../src/landing/scenes.js';
import { heroMarkup, HERO_FACES, HERO_TIMELINE } from '../src/landing/art/hero-art.js';
import { runsPath, photoDots, toThermal, miniTone } from '../src/landing/art/thermal.js';
import { paperPath, seeded, confetti } from '../src/landing/art/kit.js';
import { GrayImage } from '../src/core/gray.js';
import { dither } from '../src/core/dither.js';
import { countBlack } from '../src/core/bitimage.js';
import strings from '../src/i18n/strings/scene.js';

const attrs = (markup, name) => [...markup.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]);
const count = (markup, re) => (markup.match(re) || []).length;

function checkBalanced(where, markup) {
  for (const tag of ['g', 'svg', 'text']) {
    const open = count(markup, new RegExp(`<${tag}[\\s>]`, 'g'));
    const close = count(markup, new RegExp(`</${tag}>`, 'g'));
    assert.equal(open, close, `${where}: <${tag}> aperti ${open}, chiusi ${close}`);
  }
  assert.doesNotMatch(markup, /\sid="/, `${where}: niente id (due copie della pagina li duplicherebbero)`);
  assert.doesNotMatch(markup, /NaN|undefined/, `${where}: numeri non validi nel markup`);
}

/** Markup del gruppo del personaggio [who] (dal suo <g> al </g> che lo chiude). */
function characterMarkup(markup, who) {
  const at = markup.indexOf(`ffx-who-${who}"`);
  if (at < 0) return '';
  const start = markup.lastIndexOf('<g', at);
  let depth = 0;
  const re = /<g[\s>]|<\/g>/g;
  re.lastIndex = start;
  for (let m; (m = re.exec(markup)); ) {
    depth += m[0] === '</g>' ? -1 : 1;
    if (depth === 0) return markup.slice(start, m.index + 4);
  }
  return markup.slice(start);
}

/** Ogni espressione chiesta esiste davvero per quel personaggio: altrimenti resterebbe senza occhi. */
function checkFaces(where, markup, faces) {
  const wanted = new Map();
  for (const step of Object.values(faces)) {
    for (const [who, face] of Object.entries(step)) {
      if (!wanted.has(who)) wanted.set(who, new Set(['smile dot']));
      wanted.get(who).add(face);
    }
  }
  for (const [who, set] of wanted) {
    const part = characterMarkup(markup, who);
    assert.ok(part, `${where}: personaggio ${who} assente`);
    for (const face of set) {
      const [mouth, eyes] = face.split(' ');
      assert.ok(part.includes(`ffx-m-${mouth}`), `${where}: ${who} non ha la bocca ${mouth}`);
      assert.ok(part.includes(`ffx-e-${eyes}`), `${where}: ${who} non ha gli occhi ${eyes}`);
    }
  }
}

function checkKeys(where, markup) {
  for (const key of attrs(markup, 'data-k')) {
    assert.ok(key in strings.en && key in strings.it, `${where}: data-k="${key}" manca in strings/scene.js`);
  }
}

for (const scene of SCENES) {
  test(`scena ${scene.id}: markup e coreografia coerenti`, () => {
    const markup = scene.markup();
    checkBalanced(scene.id, markup);
    checkKeys(scene.id, markup);
    const beats = new Set(scene.timeline.beats.map(([id]) => id));

    const actors = attrs(markup, 'data-a');
    assert.equal(new Set(actors).size, actors.length, `${scene.id}: attori ripetuti`);
    for (const [beat, step] of Object.entries(scene.moves)) {
      assert.ok(beats.has(beat), `${scene.id}: moves.${beat} non è una battuta`);
      for (const actor of Object.keys(step)) assert.ok(actors.includes(actor), `${scene.id}: attore ${actor} assente dal markup`);
    }

    for (const list of attrs(markup, 'data-fx')) {
      for (const beat of list.split(/\s+/)) assert.ok(beats.has(beat), `${scene.id}: data-fx="${beat}" non è una battuta`);
    }

    const who = new Set([...markup.matchAll(/ffx-who-([a-z0-9]+)/g)].map((m) => m[1]));
    for (const [beat, step] of Object.entries(scene.faces)) {
      assert.ok(beats.has(beat), `${scene.id}: faces.${beat} non è una battuta`);
      for (const [name, face] of Object.entries(step)) {
        assert.ok(who.has(name), `${scene.id}: personaggio ${name} assente`);
        assert.match(face, /^(smile|open|tongue|o) (dot|happy|wide|wink|shut)$/, `${scene.id}: espressione ${face}`);
      }
    }
    checkFaces(scene.id, markup, scene.faces);

    const slots = new Set(attrs(markup, 'data-photo'));
    assert.deepEqual([...slots].sort(), scene.photos.map((p) => p.slot).sort(), `${scene.id}: foto e posti nel markup`);
    for (const p of scene.photos) {
      assert.equal(typeof p.draw, 'function');
      assert.ok(p.width >= 24 && p.width <= 64 && p.height >= 24 && p.height <= 64, `${scene.id}: ${p.slot} piccola foto`);
    }

    // c'è un flash, una stampa che esce e una reazione
    assert.match(markup, /ffx-fx-burst/, `${scene.id}: manca il flash`);
    assert.match(markup, /<svg x="0" y="0"[^>]*overflow="hidden"/, `${scene.id}: manca la fessura della stampante`);
    assert.ok(markup.includes('ffx-who-printer'), `${scene.id}: manca la stampantina`);
  });
}

test('hero: markup, scritte ed espressioni', () => {
  const markup = heroMarkup();
  checkBalanced('hero', markup);
  checkKeys('hero', markup);
  for (const cls of ['ffh-feed', 'ffh-lift', 'ffh-photo', 'ffh-heat', 'ffh-glare', 'ffh-burst', 'ffh-confetti']) {
    assert.ok(markup.includes(cls), `hero: manca ${cls}`);
  }
  const beats = new Set(HERO_TIMELINE.beats.map(([id]) => id));
  for (const beat of Object.keys(HERO_FACES)) assert.ok(beats.has(beat), `hero: faces.${beat}`);
  checkFaces('hero', markup, HERO_FACES);
});

test('runsPath: ogni punto nero della stampa è nel tracciato, una volta sola', () => {
  const bits = dither(GrayImage.gradient(48, 40), 'ATKINSON');
  const d = runsPath(bits);
  const covered = new Set();
  let total = 0;
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const [x, y, len, back] = m.slice(1).map(Number);
    assert.equal(len, back);
    assert.ok(x + len <= bits.width && y < bits.height);
    for (let i = 0; i < len; i++) {
      const k = `${x + i},${y}`;
      assert.ok(!covered.has(k), 'tratti sovrapposti');
      assert.ok(bits.get(x + i, y), 'tratto su un punto bianco');
      covered.add(k);
    }
    total += len;
  }
  assert.equal(total, countBlack(bits));
  assert.ok(total > 0 && total < 48 * 40);
  assert.equal(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, ''), '', 'solo tratti ben formati');
});

test('toThermal: grigi → retino Atkinson, anche con le regolazioni delle miniature', () => {
  const gray = GrayImage.gradient(48, 40);
  const plain = toThermal(gray, { tone: null });
  assert.deepEqual([plain.width, plain.height], [48, 40]);
  assert.equal(countBlack(plain), countBlack(dither(gray, 'ATKINSON')));
  const toned = toThermal(gray, { tone: miniTone() });
  assert.ok(countBlack(toned) > 0);
  assert.equal(miniTone().localContrast, 0);
  assert.equal(miniTone().autoBacklight, false);
});

test('photoDots: circa 180 punti sulla hero, mai troppo pochi', () => {
  assert.equal(photoDots(undefined), 180);
  assert.equal(photoDots(0), 180);
  assert.equal(photoDots(400), 180);
  assert.equal(photoDots(200), 160);
  assert.equal(photoDots(60), 96);
  for (const w of [130, 177, 205, 221]) assert.equal(photoDots(w) % 4, 0);
});

test('kit: carta a dente di sega con denti interi, coriandoli uguali a ogni giro', () => {
  const d = paperPath(46, 126, { tooth: 6.6 });
  assert.match(d, /^M0 /);
  assert.ok(d.endsWith('Z'));
  const r1 = seeded(3);
  const r2 = seeded(3);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
  assert.equal(confetti(0, 0, 12, { seed: 5 }), confetti(0, 0, 12, { seed: 5 }));
  assert.equal(count(confetti(0, 0, 12), /class="ffx-cf"/g), 12);
});
