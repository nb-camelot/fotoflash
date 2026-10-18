// Impaginazione e metriche dei testi: porting di TemplateGeometryTest.kt (i rettangoli e le altezze
// esatte sono in core-parity.test.mjs; qui le invarianti, gli a capo e le emoji).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutTemplate, BRAND_TEXT } from '../src/core/template.js';
import { clusterEnd, fitText, isZeroWidth, lineHeightFor, textWidth } from '../src/core/textmetrics.js';
import { FontRole, PaperWidth, TemplateKind } from '../src/core/model.js';

const empty = {};
const full = {
  caption: 'Ciao mamma!',
  eventTitle: 'Festa di Leo',
  hashtag: 'festa2026',
  dateText: '17/10/2026 15:42',
  printNumber: 42,
};
const long = {
  caption: 'Il compleanno piu bello di sempre con tutti',
  eventTitle: 'Matrimonio di Anna e Marco a Villa Bellavista',
  hashtag: '#unhashtagdavverolunghissimoesenzaspazi2026',
  dateText: 'sabato 17 ottobre 2026 alle 15:42:10',
  printNumber: 123456,
};
const blank = { caption: '   ', eventTitle: '\n\t', hashtag: ' ', dateText: '  ', printNumber: null };
const allTexts = [empty, full, long, blank];
const papers = Object.keys(PaperWidth);

const right = (r) => r.left + r.width;
const bottom = (r) => r.top + r.height;
const overlaps = (a, b) => a.left < right(b) && b.left < right(a) && a.top < bottom(b) && b.top < bottom(a);
const inside = (r, l) => r.left >= 0 && r.top >= 0 && right(r) <= l.width && bottom(r) <= l.height && r.width > 0 && r.height > 0;

/** Invarianti comuni a ogni impaginazione. */
function assertValid(kind, layout, what) {
  const rects = [...layout.photos, ...layout.texts.map((t) => t.rect)];
  for (const r of rects) assert.ok(inside(r, layout), `${what}: ${JSON.stringify(r)} fuori dal foglio`);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.ok(!overlaps(rects[i], rects[j]), `${what}: ${JSON.stringify(rects[i])} si sovrappone a ${JSON.stringify(rects[j])}`);
    }
  }
  for (const d of layout.decorations) {
    if (d.type !== 'dashed') continue;
    assert.ok(d.y >= 0 && d.y + d.thickness <= layout.height, `${what}: riga fuori dal foglio`);
    assert.ok(d.from >= 0 && d.to <= layout.width && d.from < d.to, `${what}: riga fuori larghezza`);
    const band = { left: d.from, top: d.y, width: d.to - d.from, height: d.thickness };
    for (const r of rects) assert.ok(!overlaps(band, r), `${what}: riga tratteggiata su ${JSON.stringify(r)}`);
  }
  for (const t of layout.texts) {
    assert.ok(t.sizeDots > 0, `${what}: corpo ${t.sizeDots}`);
    assert.ok(t.rect.height >= t.sizeDots, `${what}: blocco basso per corpo ${t.sizeDots}`);
    assert.ok(textWidth(t.text, t.font, t.sizeDots) <= t.rect.width, `${what}: '${t.text}' non sta in ${t.rect.width}`);
  }
  // niente spazio morto in fondo (la Polaroid centra i testi nella fascia bassa)
  const lastBottom = Math.max(...rects.map(bottom));
  const tail = layout.height - lastBottom;
  const base = kind === 'POLAROID' ? 48 : 16;
  const maxTail = layout.width === 576 ? Math.trunc((base * 3) / 2) : base;
  assert.ok(tail >= 0 && tail <= maxTail, `${what}: ${tail} punti vuoti in fondo`);
}

test('ogni modello è valido su entrambe le carte (everyTemplateIsValidOnBothPapers)', () => {
  for (const kind of TemplateKind) {
    for (const paper of papers) {
      allTexts.forEach((texts, i) => {
        for (const count of [0, 1, 3, 4, 9]) {
          const layout = layoutTemplate(kind, paper, count, texts);
          assert.equal(layout.width, PaperWidth[paper].dots);
          assertValid(kind, layout, `${kind} ${paper} testi#${i} foto=${count}`);
        }
      });
    }
  }
});

test('testi vuoti o di soli spazi non occupano spazio (emptyAndBlankTextsTakeNoSpace)', () => {
  for (const kind of TemplateKind) {
    for (const texts of [empty, blank]) {
      const layout = layoutTemplate(kind, 'MM58', 3, texts);
      const optional = layout.texts.filter((t) => t.role !== 'BRAND' && t.role !== 'FOOTER');
      assert.equal(optional.length, 0, kind);
    }
    assert.equal(layoutTemplate(kind, 'MM58', 3, empty).height, layoutTemplate(kind, 'MM58', 3, blank).height);
  }
});

test('i testi lunghi vanno a capo o si riducono restando dentro (longTextsWrapOrShrinkButStayInside)', () => {
  for (const kind of TemplateKind) {
    const layout = layoutTemplate(kind, 'MM58', 3, long);
    for (const role of ['CAPTION', 'EVENT_TITLE']) {
      const blocks = layout.texts.filter((t) => t.role === role);
      assert.ok(blocks.length <= 2, `${kind} ${role}: ${blocks.length} righe`);
      for (let i = 1; i < blocks.length; i++) {
        assert.equal(bottom(blocks[i - 1].rect), blocks[i].rect.top);
        assert.equal(blocks[i - 1].sizeDots, blocks[i].sizeDots);
      }
    }
    for (const role of ['HASHTAG', 'DATE', 'PRINT_NUMBER']) {
      assert.ok(layout.texts.filter((t) => t.role === role).length <= 1);
    }
  }
  const strip = layoutTemplate('STRIP', 'MM58', 3, long);
  const tag = strip.texts.find((t) => t.role === 'HASHTAG');
  assert.ok(tag.sizeDots < 22);
  assert.ok(tag.text.endsWith('…'));
});

test('la didascalia va a capo in due righe bilanciate (captionWrapsIntoTwoBalancedLines)', () => {
  const lines = layoutTemplate('POLAROID', 'MM58', 1, long).texts.filter((t) => t.role === 'CAPTION').map((t) => t.text);
  assert.equal(lines.length, 2);
  assert.equal(lines.join(' '), long.caption);
});

test('il titolo largo va a capo senza perdere parole (wideTitleWrapsWithoutLosingWords)', () => {
  const lines = layoutTemplate('STRIP', 'MM58', 3, long).texts.filter((t) => t.role === 'EVENT_TITLE').map((t) => t.text);
  assert.equal(lines.length, 2);
  assert.equal(lines.join(' '), long.eventTitle);
});

const cps = (...codePoints) => String.fromCodePoint(...codePoints);
const thumb = cps(0x1f44d);
const flag = cps(0x1f1ee, 0x1f1f9);
const family = cps(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);
const near = (a, b) => Math.abs(a - b) <= 1e-9;

function regionalCount(s) {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) n++;
  }
  return n;
}

test('i modificatori delle emoji non occupano spazio (emojiModifiersTakeNoSpace)', () => {
  for (const font of FontRole) {
    assert.ok(near(textWidth(cps(0x2764), font, 28), textWidth(cps(0x2764, 0xfe0f), font, 28)));
    assert.ok(near(textWidth(thumb, font, 28), textWidth(cps(0x1f44d, 0x1f3fd), font, 28)));
    assert.ok(near(textWidth(thumb, font, 22), textWidth(flag, font, 22)));
    assert.ok(near(2 * textWidth(thumb, font, 22), textWidth(flag + flag, font, 22)));
    assert.ok(near(textWidth('e', font, 20), textWidth(`e${cps(0x301)}`, font, 20)));
    assert.ok(near(4 * textWidth(thumb, font, 22), textWidth(family, font, 22)));
    assert.ok(textWidth(cps(0x31, 0xfe0f, 0x20e3), font, 22) >= textWidth(thumb, font, 22));
  }
  assert.equal(isZeroWidth(0x20e3), false);
  assert.equal(isZeroWidth(0x0301), true);
  assert.equal(isZeroWidth(0x20dd), true); // segno che racchiude (Me)
  assert.equal(isZeroWidth(0x41), false);
});

test('i cuori emoji non riducono la didascalia (captionWithEmojiHeartsKeepsTheNominalSize)', () => {
  const hearts = cps(0x2764, 0xfe0f).repeat(3);
  const layout = layoutTemplate('POLAROID', 'MM58', 1, { caption: `Auguri nonna ${hearts}` });
  const caption = layout.texts.filter((t) => t.role === 'CAPTION');
  assert.equal(caption.length, 1);
  assert.equal(caption[0].sizeDots, 28);
});

test('le bandiere non si spezzano mai (flagsAreNeverSplitAcrossLinesOrByTheEllipsis)', () => {
  const tag = `#${flag.repeat(20)}`;
  for (const maxLines of [1, 3]) {
    for (let avail = 40; avail <= 344; avail += 7) {
      const fit = fitText(tag, 'MONO', 22, 14, avail, maxLines);
      assert.ok(fit.lines.length <= maxLines);
      for (const line of fit.lines) {
        assert.equal(regionalCount(line) % 2, 0, `riga '${line}' (larghezza ${avail}, ${maxLines} righe)`);
      }
    }
  }
});

test('le emoji unite da ZWJ non si spezzano mai (joinedEmojiAreNeverSplit)', () => {
  const text = family.repeat(10);
  for (const maxLines of [1, 2]) {
    for (let avail = 40; avail <= 344; avail += 9) {
      const fit = fitText(text, 'MONO', 22, 14, avail, maxLines);
      for (const line of fit.lines) {
        const body = line.endsWith('…') ? line.slice(0, -1) : line;
        assert.equal(body.length % family.length, 0, `riga '${line}' (larghezza ${avail})`);
        assert.equal(body, family.repeat(body.length / family.length));
      }
    }
  }
});

test('metriche dei font del brand (textMetricsMatchTheBrandFonts)', () => {
  assert.ok(Math.abs(10 * 0.612 * 20 - textWidth('0123456789', 'MONO', 20)) <= 1e-9);
  assert.ok(near(textWidth('abc', 'MONO', 28), textWidth('abc', 'MONO_BOLD', 28)));
  assert.ok(textWidth('M', 'DISPLAY', 40) > textWidth('i', 'DISPLAY', 40));
  assert.ok(textWidth(BRAND_TEXT, 'DISPLAY', 48) < 300.0);
  assert.throws(() => textWidth('a', 'SERIF', 20), RangeError);
});

test('cluster: bandiere, ZWJ e keycap restano interi', () => {
  assert.equal(clusterEnd(flag + flag, 0), 4);
  assert.equal(clusterEnd(family, 0), family.length);
  assert.equal(clusterEnd(cps(0x31, 0xfe0f, 0x20e3, 0x41), 0), 3);
  assert.equal(clusterEnd('ab', 0), 1);
  assert.equal(lineHeightFor(28), 35);
  assert.equal(lineHeightFor(20), 25);
  assert.equal(lineHeightFor(22), 28);
});

test('carta e modello sconosciuti sono errori; la carta si può passare anche come oggetto', () => {
  assert.throws(() => layoutTemplate('POSTER', 'MM58', 1, empty), RangeError);
  assert.throws(() => layoutTemplate('FULL', 'MM100', 1, empty), RangeError);
  assert.deepEqual(layoutTemplate('STRIP', PaperWidth.MM80, 3, full), layoutTemplate('STRIP', 'MM80', 3, full));
  // un testo non stringa (numero) si normalizza come stringa
  assert.equal(layoutTemplate('FULL', 'MM58', 1, { caption: 2026 }).texts[0].text, '2026');
});
