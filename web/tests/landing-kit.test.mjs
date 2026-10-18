// Parti pure della presentazione (src/landing/sections/*): rotta di «Apri l'app», indirizzo da
// mandarsi sul telefono, formati degli slider, scelta tra pixel netti e media, testi delle stampe
// d'esempio, stato onesto delle stampanti, installazione. Niente DOM: girano in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appRoute, pageUrl, signed, plain, pixelatedFor, sagAt, ditherInfo, shortDateTime, DITHERS, TEMPLATES,
  APK_URL, REPO_URL,
} from '../src/landing/sections/kit.js';
import { tryState, toneFor, PREVIEW_DOTS, PREVIEW_ROWS } from '../src/landing/sections/try.js';
import { sampleTexts, printLabels, printSize } from '../src/landing/sections/models.js';
import { driverStatus, PAPER_TESTED_FAMILIES } from '../src/landing/sections/printers.js';
import { installState } from '../src/landing/sections/get.js';
import { NAV_ITEMS } from '../src/landing/sections/topbar.js';
import { DitherAlgorithm, TemplateKind, defaultTone, PaperWidth } from '../src/core/model.js';
import { drivers } from '../src/printer/drivers/index.js';
import { format } from '../src/i18n/i18n.js';
import ed from '../src/i18n/strings/ed.js';
import land from '../src/i18n/strings/land.js';

const fakeT = (table) => (key, ...args) => {
  const text = table[key];
  if (text === undefined) throw new Error(`chiave mancante: ${key}`);
  return args.length ? format(text, args) : text;
};

test('«Apri l\'app» va alla fotocamera, o all\'onboarding se il primo avvio non è finito', () => {
  assert.equal(appRoute({ get: () => ({ onboardingDone: true }) }), '/camera');
  assert.equal(appRoute({ get: () => ({ onboardingDone: false }) }), '/onboarding');
  assert.equal(appRoute({ get: () => ({}) }), '/onboarding');
  assert.equal(appRoute(null), '/onboarding');
  assert.equal(appRoute({ get: () => { throw new Error('storage'); } }), '/onboarding');
});

test('l\'indirizzo da mandarsi sul telefono è la pagina senza hash', () => {
  assert.equal(pageUrl({ origin: 'https://nb-camelot.github.io', pathname: '/fotoflash/', href: 'https://nb-camelot.github.io/fotoflash/#/landing' }),
    'https://nb-camelot.github.io/fotoflash/');
  assert.equal(pageUrl({ origin: 'http://127.0.0.1:5173', pathname: '/', href: 'http://127.0.0.1:5173/' }), 'http://127.0.0.1:5173/');
  // file:// ha origin "null": si usa href senza l'hash
  assert.equal(pageUrl({ origin: 'null', pathname: '/C:/web/index.html', href: 'file:///C:/web/index.html#/' }), 'file:///C:/web/index.html');
  assert.equal(pageUrl(undefined), '');
});

test('gli slider mostrano i valori come l\'editor', () => {
  assert.equal(signed(0), '0');
  assert.equal(signed(0.15), '+15');
  assert.equal(signed(-0.5), '-50');
  assert.equal(signed(1), '+100');
  assert.equal(plain(0.25), '25');
  assert.equal(plain(0), '0');
  assert.equal(plain(NaN), '0');
});

test('pixel netti solo se ogni punto copre almeno un pixel del dispositivo', () => {
  assert.equal(pixelatedFor(440, 1, 384), true);
  assert.equal(pixelatedFor(260, 1, 384), false);
  assert.equal(pixelatedFor(260, 1.5, 384), true);
  assert.equal(pixelatedFor(306, 1.25, 384), false);
  assert.equal(pixelatedFor(308, 1.25, 384), true);
  assert.equal(pixelatedFor(0, 2, 384), false);
  assert.equal(pixelatedFor(200, undefined, 100), true);
});

test('lo spago si abbassa al centro e resta alto ai capi', () => {
  assert.equal(sagAt(0, 34), 0);
  assert.equal(sagAt(1, 34), 0);
  assert.equal(sagAt(0.5, 34), 34);
  assert.ok(sagAt(0.125, 34) < sagAt(0.375, 34));
  assert.equal(sagAt(0.375, 34), sagAt(0.625, 34));
  assert.equal(sagAt(-1, 34), 0);
});

test('retini e modelli sono quelli del motore, con i nomi dell\'app in en e it', () => {
  assert.deepEqual(DITHERS.map((d) => d.value), [...DitherAlgorithm]);
  assert.deepEqual(TEMPLATES.map((m) => m.kind), [...TemplateKind]);
  for (const l of ['en', 'it']) {
    for (const d of DITHERS) {
      assert.ok(ed[l][d.name], `${l}: ${d.name}`);
      assert.ok(land[l][d.hint], `${l}: ${d.hint}`);
    }
    for (const m of TEMPLATES) {
      assert.ok(ed[l][m.name], `${l}: ${m.name}`);
      assert.ok(ed[l][m.desc], `${l}: ${m.desc}`);
    }
  }
  assert.equal(ditherInfo('FLOYD_STEINBERG').name, 'ed_dither_floyd');
  assert.equal(ditherInfo('boh').value, 'ATKINSON');
});

test('collegamenti esterni: repository e ultima release', () => {
  assert.equal(APK_URL, 'https://github.com/nb-camelot/fotoflash/releases/latest');
  assert.equal(REPO_URL, 'https://github.com/nb-camelot/fotoflash');
});

test('la barra punta a sezioni con id "ffl-…", senza toccare le rotte dell\'app', () => {
  assert.deepEqual(NAV_ITEMS.map((i) => i.id), ['ffl-ideas', 'ffl-how', 'ffl-try', 'ffl-printers', 'ffl-get']);
  for (const item of NAV_ITEMS) {
    assert.ok(!item.id.startsWith('/'), item.id);
    assert.ok(land.en[item.key] && land.it[item.key], item.key);
  }
});

test('«Prova il retino» parte dalle regolazioni di fabbrica, a 384 punti come la carta da 58 mm', () => {
  const state = {};
  const st = tryState(state);
  assert.equal(state.try, st);
  assert.equal(tryState(state), st, 'lo stato sopravvive ai cambi di lingua');
  assert.equal(st.algorithm, 'ATKINSON');
  const tone = defaultTone();
  assert.equal(st.brightness, tone.brightness);
  assert.equal(st.contrast, tone.contrast);
  assert.equal(st.shadows, tone.shadows);
  assert.equal(PREVIEW_DOTS, PaperWidth.MM58.dots);
  assert.equal(PREVIEW_ROWS / PREVIEW_DOTS, 4 / 3);
  st.brightness = 0.3;
  st.shadows = 0.9;
  assert.deepEqual(toneFor(st), { ...defaultTone(), brightness: 0.3, contrast: tone.contrast, shadows: 0.9 });
});

test('stampe d\'esempio: testi tradotti, numero solo sullo Scontrino, piede e numero come nell\'app', () => {
  const date = new Date(Date.UTC(2026, 9, 18, 12, 0));
  for (const l of ['en', 'it']) {
    const t = fakeT({ ...ed[l], ...land[l] });
    const receipt = sampleTexts(t, 'RECEIPT', date, l);
    assert.equal(receipt.caption, land[l].land_models_caption);
    assert.equal(receipt.eventTitle, land[l].land_models_event);
    assert.equal(receipt.hashtag, land[l].land_models_hashtag);
    assert.equal(receipt.printNumber, 42);
    assert.ok(receipt.dateText && /\d/.test(receipt.dateText));
    assert.equal(sampleTexts(t, 'POLAROID', date, l).printNumber, null);
    const labels = printLabels(t);
    assert.equal(labels.footer, ed[l].ed_footer_thanks);
    assert.equal(labels.printNumber(42), format(ed[l].ed_print_number, ['0042']));
  }
  const tIt = fakeT({ ...ed.it, ...land.it });
  assert.equal(printLabels(tIt).printNumber(42), 'RICORDO N. 0042');
});

test('le stampe d\'esempio occupano subito il loro posto, a 384 punti', () => {
  const t = fakeT({ ...ed.en, ...land.en });
  const sizes = Object.fromEntries(TEMPLATES.map((m) => [m.kind, printSize(m.kind, sampleTexts(t, m.kind, new Date(0), 'en'))]));
  for (const size of Object.values(sizes)) assert.equal(size.width, 384);
  // valori di TemplateGeometryTest (docs/WEB.md, § Parità) con i testi pieni
  assert.equal(sizes.POLAROID.height, 464);
  assert.equal(sizes.FULL.height, 592);
  assert.equal(sizes.STRIP.height, 1002);
  assert.equal(sizes.RECEIPT.height, 702);
});

test('stampanti: ESC/POS supportate, Phomemo «da provare su carta»', () => {
  assert.deepEqual([...PAPER_TESTED_FAMILIES], ['escpos']);
  const status = Object.fromEntries(drivers.map((d) => [d.id, driverStatus(d)]));
  assert.deepEqual(status, {
    'escpos-58': 'supported',
    'escpos-80': 'supported',
    'phomemo-m02': 'pending',
    'phomemo-m02pro': 'pending',
  });
  assert.equal(driverStatus(null), 'pending');
});

test('installazione: già installata, invito disponibile o istruzioni a mano', () => {
  assert.equal(installState({ installed: () => true, available: () => true }), 'installed');
  assert.equal(installState({ installed: () => false, available: () => true }), 'available');
  assert.equal(installState({ installed: () => false, available: () => false }), 'manual');
  assert.equal(installState(undefined), 'manual');
  assert.equal(installState({ installed: () => { throw new Error('x'); } }), 'manual');
});

test('data breve nella lingua chiesta, con ripiego', () => {
  const date = new Date(Date.UTC(2026, 9, 18, 12, 0));
  assert.match(shortDateTime(date, 'it'), /18/);
  assert.ok(shortDateTime(date, 'xx-invalid-'));
});
