// Test di download e condivisione con navigator e document finti.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadBlob, shareFiles, canShareFiles, exportFileName, safeFileName, extensionFor, fileFromBlob,
} from '../src/media/export.js';

const original = {
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
};

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true });
}

afterEach(() => {
  for (const [name, desc] of Object.entries(original)) {
    if (desc) Object.defineProperty(globalThis, name, desc);
    else delete globalThis[name];
  }
});

/** Documento minimo: registra i link cliccati. */
function fakeDocument() {
  const clicks = [];
  const body = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      el.parent = this;
    },
  };
  const doc = {
    body,
    documentElement: body,
    createElement(tag) {
      assert.equal(tag, 'a');
      return {
        style: {},
        click() {
          clicks.push({ href: this.href, download: this.download, attached: body.children.includes(this) });
        },
        remove() {
          body.children = body.children.filter((c) => c !== this);
        },
      };
    },
  };
  return { doc, clicks, body };
}

test('exportFileName: data e ora locali, estensione facoltativa', () => {
  const d = new Date(2026, 9, 18, 15, 30, 12);
  assert.equal(exportFileName('fotoflash', 'png', d), 'fotoflash-20261018-153012.png');
  assert.equal(exportFileName('fotoflash-foto', '.jpg', d), 'fotoflash-foto-20261018-153012.jpg');
  assert.equal(exportFileName('fotoflash-foto', '', d), 'fotoflash-foto-20261018-153012');
  assert.match(exportFileName(), /^fotoflash-\d{8}-\d{6}\.png$/);
});

test('safeFileName ed extensionFor', () => {
  assert.equal(safeFileName('a/b\\c:d*e?.png'), 'a_b_c_d_e_.png');
  assert.equal(safeFileName('  ..  '), 'fotoflash');
  assert.equal(safeFileName(''), 'fotoflash');
  assert.equal(extensionFor('image/png'), 'png');
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('application/zip'), 'zip');
  assert.equal(extensionFor('image/png; charset=binary'), 'png');
  assert.equal(extensionFor('application/x-qualcosa'), 'bin');
  assert.equal(extensionFor(undefined), 'bin');
});

test('fileFromBlob: nome e tipo', () => {
  const f = fileFromBlob(new Blob(['x'], { type: 'image/png' }), 'stampa.png');
  assert.ok(f instanceof File);
  assert.equal(f.name, 'stampa.png');
  assert.equal(f.type, 'image/png');
  const same = new File(['y'], 'gia.jpg', { type: 'image/jpeg' });
  assert.equal(fileFromBlob(same), same);
  assert.equal(fileFromBlob(new Blob(['z'], { type: 'image/jpeg' })).name, 'fotoflash.jpg');
});

test('downloadBlob: link temporaneo con nome sicuro, cliccato e tolto', () => {
  const { doc, clicks, body } = fakeDocument();
  setGlobal('document', doc);
  downloadBlob(new Blob(['ciao'], { type: 'text/plain' }), 'saluti:1.txt');
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].download, 'saluti_1.txt');
  assert.ok(clicks[0].attached, 'il link è nella pagina al momento del clic');
  assert.match(clicks[0].href, /^blob:/);
  assert.equal(body.children.length, 0, 'il link non resta nella pagina');
});

test('downloadBlob senza documento è un errore chiaro', () => {
  setGlobal('document', undefined);
  assert.throws(() => downloadBlob(new Blob(['x']), 'x.txt'));
});

test('shareFiles: Web Share con file', async () => {
  const shared = [];
  setGlobal('navigator', {
    canShare: ({ files }) => files.every((f) => f instanceof File),
    share: async (data) => {
      shared.push(data);
    },
  });
  const file = new File(['png'], 'stampa.png', { type: 'image/png' });
  const outcome = await shareFiles([file], { title: 'FotoFlash', text: '' });
  assert.equal(outcome, 'shared');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].files[0], file);
  assert.equal(shared[0].title, 'FotoFlash');
  assert.equal('text' in shared[0], false, 'un testo vuoto non si passa');
});

test('shareFiles: foglio chiuso dall\'utente = annullato, niente download', async () => {
  const { doc, clicks } = fakeDocument();
  setGlobal('document', doc);
  setGlobal('navigator', {
    canShare: () => true,
    share: async () => {
      const e = new Error('chiuso');
      e.name = 'AbortError';
      throw e;
    },
  });
  assert.equal(await shareFiles([new File(['a'], 'a.png')], {}), 'cancelled');
  assert.equal(clicks.length, 0);
});

test('shareFiles: senza Web Share scarica uno per uno', async () => {
  const { doc, clicks } = fakeDocument();
  setGlobal('document', doc);
  setGlobal('navigator', {});
  assert.equal(canShareFiles([new File(['a'], 'a.png')]), false);
  const outcome = await shareFiles([new File(['a'], 'a.png'), new Blob(['b'], { type: 'image/jpeg' })], {});
  assert.equal(outcome, 'downloaded');
  assert.deepEqual(clicks.map((c) => c.download), ['a.png', 'fotoflash-2.jpg']);
});

test('shareFiles: gesto scaduto (NotAllowedError) ripiega sul download', async () => {
  const { doc, clicks } = fakeDocument();
  setGlobal('document', doc);
  setGlobal('navigator', {
    canShare: () => true,
    share: async () => {
      const e = new Error('serve un gesto');
      e.name = 'NotAllowedError';
      throw e;
    },
  });
  assert.equal(await shareFiles([new File(['a'], 'a.png')], { title: 't' }), 'downloaded');
  assert.equal(clicks.length, 1);
});

test('shareFiles: lista vuota', async () => {
  assert.equal(await shareFiles([], {}), 'none');
});
