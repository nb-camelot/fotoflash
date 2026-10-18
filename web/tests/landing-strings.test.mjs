// Testi della presentazione (strings/land.js): stesse chiavi e stessi segnaposto in en e it,
// nessuna chiave dimenticata e nessuna usata senza esistere. I controlli generali (prefisso,
// chiavi passate a t()) li fa già imports.test.mjs; qui quelli propri della landing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import land from '../src/i18n/strings/land.js';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANDING = path.join(WEB, 'src', 'landing');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}

const placeholders = (text) => (String(text).match(/%(?:\d+\$)?[-0+ ]*\d*(?:\.\d+)?[sdf%]/g) || []).sort();

test('land.js: en e it con le stesse chiavi, tutte land_, nessun testo vuoto', () => {
  const en = Object.keys(land.en);
  const it = Object.keys(land.it);
  assert.deepEqual([...it].sort(), [...en].sort());
  for (const key of en) {
    assert.match(key, /^land_[a-z0-9]+(?:_[a-z0-9]+)*$/, key);
    for (const l of ['en', 'it']) {
      assert.equal(typeof land[l][key], 'string', `${l}.${key}`);
      assert.ok(land[l][key].trim().length > 0, `${l}.${key} vuoto`);
    }
  }
});

test('land.js: stessi segnaposto in en e it', () => {
  for (const key of Object.keys(land.en)) {
    assert.deepEqual(placeholders(land.it[key]), placeholders(land.en[key]), key);
  }
});

test('ogni chiave land_ è usata dalla presentazione (niente lavoro inutile per i traduttori)', () => {
  const src = walk(LANDING).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const unused = Object.keys(land.en).filter((k) => !src.includes(`'${k}'`));
  assert.deepEqual(unused, []);
});

test('le chiavi land_ citate nel codice esistono', () => {
  const missing = [];
  for (const file of walk(LANDING)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/'(land_[a-z0-9_]+)'/g)) {
      if (!(m[1] in land.en)) missing.push(`${path.relative(WEB, file)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('iPhone e iPad: Bluefy come consiglio, da cercare per nome, senza indirizzi inventati', () => {
  const IOS = ['land_ios_title', 'land_ios_badge', 'land_ios_text', 'land_ios_tip', 'land_ios_search', 'land_ios_home'];
  for (const l of ['en', 'it']) {
    const t = land[l];
    // il limite è di tutti i browser comuni su iOS, Chrome compreso
    assert.match(t.land_ios_text, /Safari/, `${l}.land_ios_text`);
    assert.match(t.land_ios_text, /Chrome/, `${l}.land_ios_text`);
    assert.match(t.land_ios_tip, /Bluefy/, `${l}.land_ios_tip`);
    assert.match(t.land_ios_search, /Bluefy/, `${l}.land_ios_search`);
    assert.match(t.land_ios_search, /App Store/, `${l}.land_ios_search`);
    // l'app aggiunta alla Home da Safari non stampa: lo dicono sia il riquadro sia la nota d'installazione
    assert.match(t.land_ios_home, /Safari/, `${l}.land_ios_home`);
    assert.match(t.land_get_pwa_manual, /Bluefy/, `${l}.land_get_pwa_manual`);
    assert.match(t.land_get_phone_ios, /Bluefy/, `${l}.land_get_phone_ios`);
    // consiglio, non garanzia: non è ancora stato provato
    assert.match(t.land_ios_badge, l === 'it' ? /Consigliato/ : /Recommended/, `${l}.land_ios_badge`);
    // Chrome su iPhone non stampa: il riquadro dei browser non lo deve suggerire
    assert.doesNotMatch(t.land_browsers_no, /iPhone|iPad/, `${l}.land_browsers_no`);
    const all = IOS.concat('land_get_pwa_manual', 'land_get_phone_ios').map((k) => t[k]).join(' ');
    assert.doesNotMatch(all, /https?:|www\.|apple\.com|\/id\d+/i, `${l}: niente URL dell'App Store`);
  }
});

test('i bottoni restano corti', () => {
  // i testi dei pulsanti stanno su una riga anche nelle colonne strette
  const buttons = ['land_open_app', 'land_get_pwa_button', 'land_get_copy', 'land_get_share', 'land_try_upload'];
  for (const l of ['en', 'it']) {
    for (const key of buttons) assert.ok(land[l][key].length <= 26, `${l}.${key}: «${land[l][key]}»`);
  }
});
