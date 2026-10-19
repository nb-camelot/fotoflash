// Regole della presentazione (docs/LANDING.md, § Comportamento): chi la vede e chi va dritto all'app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowLanding, LANDING_HASH, WIDE_MIN_WIDTH } from '../src/landing/gate.js';

test('#/landing apre sempre la presentazione, anche sul telefono e nell\'app installata', () => {
  assert.equal(LANDING_HASH, '#/landing');
  assert.equal(shouldShowLanding({ width: 390, standalone: false, hash: '#/landing' }), true);
  assert.equal(shouldShowLanding({ width: 390, standalone: true, hash: '#/landing' }), true);
  assert.equal(shouldShowLanding({ width: 1440, standalone: true, hash: '#/landing' }), true);
  assert.equal(shouldShowLanding({ width: 0, standalone: false, hash: '#/landing' }), true);
});

test('schermo largo nel browser, senza rotta: presentazione', () => {
  for (const hash of ['', '#', '#/']) {
    assert.equal(shouldShowLanding({ width: 1440, standalone: false, hash }), true, `hash ${JSON.stringify(hash)}`);
    assert.equal(shouldShowLanding({ width: 1920, standalone: false, hash }), true, `hash ${JSON.stringify(hash)}`);
  }
});

test('la soglia è 960 px, inclusa', () => {
  assert.equal(WIDE_MIN_WIDTH, 960);
  assert.equal(shouldShowLanding({ width: 959, standalone: false, hash: '' }), false);
  assert.equal(shouldShowLanding({ width: 959.5, standalone: false, hash: '' }), false);
  assert.equal(shouldShowLanding({ width: 960, standalone: false, hash: '' }), true);
  assert.equal(shouldShowLanding({ width: 961, standalone: false, hash: '#/' }), true);
});

test('telefono e app installata vanno dritti all\'app', () => {
  assert.equal(shouldShowLanding({ width: 390, standalone: false, hash: '' }), false);
  assert.equal(shouldShowLanding({ width: 768, standalone: false, hash: '#/' }), false);
  assert.equal(shouldShowLanding({ width: 1440, standalone: true, hash: '' }), false);
  assert.equal(shouldShowLanding({ width: 1920, standalone: true, hash: '#/' }), false);
});

test('un deep link va sempre all\'app, anche su schermo largo', () => {
  for (const hash of ['#/camera', '#/onboarding', '#/settings', '#/history/42', '#/landing/extra', '#ideas', '#/printer']) {
    assert.equal(shouldShowLanding({ width: 1440, standalone: false, hash }), false, hash);
  }
});

test('valori mancanti o strani non fanno partire la presentazione per sbaglio', () => {
  assert.equal(shouldShowLanding(), false);
  assert.equal(shouldShowLanding({}), false);
  assert.equal(shouldShowLanding({ width: NaN, standalone: false, hash: '' }), false);
  assert.equal(shouldShowLanding({ width: '1440', standalone: false, hash: '' }), true);
  assert.equal(shouldShowLanding({ width: 1440, standalone: false, hash: undefined }), true);
  assert.equal(shouldShowLanding({ width: 1440, standalone: false, hash: null }), true);
  assert.equal(shouldShowLanding({ width: Infinity, standalone: false, hash: '' }), false);
});
