// Ogni modulo di web/src deve stare nella precache del service worker: altrimenti, offline, il grafo
// dei moduli si rompe e la PWA non parte (è successo con i driver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('tutti i moduli di src/ sono nella precache di sw.js', () => {
  const sw = readFileSync(join(web, 'sw.js'), 'utf8');
  const modules = walk(join(web, 'src')).filter((p) => p.endsWith('.js'))
    .map((p) => './' + relative(web, p).split(sep).join('/'));
  const missing = modules.filter((m) => !sw.includes(`'${m}'`));
  assert.deepEqual(missing, [], `moduli assenti dalla precache di sw.js: ${missing.join(', ')}`);
});
