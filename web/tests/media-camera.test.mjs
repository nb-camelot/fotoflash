// Test della fotocamera e dell'anteprima termica con getUserMedia, tracce e canvas finti.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CameraController, CameraErrorCode, cameraErrorCode, capabilitiesFrom, snapExposure, viewToFramePoint,
  isMirroredTransform, videoConstraints,
} from '../src/camera/camera.js';
import {
  startThermalPreview, previewTone, frameCrop, previewSize, toneLikePrint, PREVIEW_WIDTH, MIN_FRAME_INTERVAL_MS,
  INK_RGBA, PAPER_RGBA,
} from '../src/camera/live.js';
import { GrayImage } from '../src/core/gray.js';
import { applyTone } from '../src/core/tone.js';
import { defaultTone } from '../src/core/model.js';

const saved = {
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  OffscreenCanvas: globalThis.OffscreenCanvas,
  ImageData: globalThis.ImageData,
};

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true });
}

afterEach(() => {
  if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
  else delete globalThis.navigator;
  globalThis.OffscreenCanvas = saved.OffscreenCanvas;
  globalThis.ImageData = saved.ImageData;
});

const named = (name) => Object.assign(new Error(name), { name });

// ---------------------------------------------------------------- funzioni pure

test('cameraErrorCode: errori di getUserMedia in codici per la UI', () => {
  assert.equal(cameraErrorCode(named('NotAllowedError')), 'denied');
  assert.equal(cameraErrorCode(named('SecurityError')), 'denied');
  assert.equal(cameraErrorCode(named('NotFoundError')), 'not-found');
  assert.equal(cameraErrorCode(named('OverconstrainedError')), 'not-found');
  assert.equal(cameraErrorCode(named('NotReadableError')), 'in-use');
  assert.equal(cameraErrorCode(named('AbortError')), 'in-use');
  assert.equal(cameraErrorCode(named('Strano')), 'unknown');
  assert.equal(cameraErrorCode({ code: 'insecure' }), 'insecure');
  assert.equal(cameraErrorCode(undefined), 'unknown');
  assert.ok(Object.values(CameraErrorCode).includes('denied'));
});

test('videoConstraints: facingMode ideale e 1920x1440', () => {
  assert.deepEqual(videoConstraints('user'), {
    audio: false,
    video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
  });
});

test('capabilitiesFrom: torcia, esposizione, punti di interesse', () => {
  assert.deepEqual(capabilitiesFrom({}, {}), { torch: false, exposure: null, pointsOfInterest: false });
  assert.deepEqual(
    capabilitiesFrom({ torch: true, exposureCompensation: { min: -2, max: 2, step: 1 / 3 } }, { pointsOfInterest: [] }),
    { torch: true, exposure: { min: -2, max: 2, step: 1 / 3 }, pointsOfInterest: true },
  );
  assert.equal(capabilitiesFrom({ exposureCompensation: { min: 0, max: 0, step: 1 } }).exposure, null);
  assert.equal(capabilitiesFrom({ exposureCompensation: { min: -2, max: 2, step: 0 } }).exposure, null);
  assert.equal(capabilitiesFrom({ torch: [false, true] }).torch, true);
});

test('snapExposure: range e passo della fotocamera', () => {
  const range = { min: -2, max: 2, step: 1 / 3 };
  assert.equal(snapExposure(0.5, range), 0.666667);
  assert.equal(snapExposure(5, range), 2);
  assert.equal(snapExposure(-5, range), -2);
  assert.equal(snapExposure(0, range), 0);
  assert.equal(snapExposure('x', range), 0);
});

test('viewToFramePoint: object-fit cover, contain e specchio', () => {
  const geo = { viewWidth: 300, viewHeight: 400, frameWidth: 640, frameHeight: 480, fit: 'cover' };
  assert.deepEqual(viewToFramePoint(0.5, 0.5, geo), { x: 0.5, y: 0.5 });
  const p = viewToFramePoint(0, 0, geo);
  assert.ok(Math.abs(p.x - 0.21875) < 1e-9 && p.y === 0);
  const m = viewToFramePoint(0, 0, { ...geo, mirrored: true });
  assert.ok(Math.abs(m.x - 0.78125) < 1e-9);
  // contain: le bande nere finiscono sul bordo del fotogramma
  const c = viewToFramePoint(0.5, 0, { ...geo, fit: 'contain' });
  assert.deepEqual(c, { x: 0.5, y: 0 });
  assert.deepEqual(viewToFramePoint(0.2, 0.7, { fit: 'fill' }), { x: 0.2, y: 0.7 });
  assert.deepEqual(viewToFramePoint(NaN, 2, geo), { x: 0.5, y: 1 });
});

test('isMirroredTransform: matrice e proprietà scale', () => {
  assert.equal(isMirroredTransform('matrix(-1, 0, 0, 1, 0, 0)'), true);
  assert.equal(isMirroredTransform('matrix(1, 0, 0, 1, 0, 0)'), false);
  assert.equal(isMirroredTransform('none', 'none'), false);
  assert.equal(isMirroredTransform('none', '-1 1'), true);
  assert.equal(isMirroredTransform('matrix3d(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'), true);
});

// ---------------------------------------------------------------- controller con getUserMedia finto

function fakeTrack({ facingMode = 'environment', caps = {}, settings = {} } = {}) {
  const applied = [];
  return {
    kind: 'video',
    readyState: 'live',
    enabled: true,
    applied,
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = 'ended';
    },
    getSettings: () => ({ facingMode, width: 1920, height: 1440, ...settings }),
    getCapabilities: () => caps,
    async applyConstraints(c) {
      applied.push(c);
    },
  };
}

function fakeStream(track) {
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

function fakeVideo() {
  const listeners = {};
  return {
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    clientWidth: 0,
    clientHeight: 0,
    paused: false,
    ended: false,
    srcObject: null,
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    async play() {},
    pause() {
      this.paused = true;
    },
    addEventListener(ev, fn) {
      (listeners[ev] ??= new Set()).add(fn);
    },
    removeEventListener(ev, fn) {
      listeners[ev]?.delete(fn);
    },
    listenerCount: () => Object.values(listeners).reduce((n, s) => n + s.size, 0),
  };
}

test('start: senza mediaDevices il codice è unsupported', async () => {
  setGlobal('navigator', {});
  const cam = new CameraController(fakeVideo());
  await assert.rejects(() => cam.start(), (e) => e.name === 'CameraError' && e.code === 'unsupported');
});

test('start: permesso negato e fotocamera occupata hanno codici distinti', async () => {
  for (const [name, code] of [['NotAllowedError', 'denied'], ['NotReadableError', 'in-use'], ['NotFoundError', 'not-found']]) {
    setGlobal('navigator', { mediaDevices: { getUserMedia: async () => { throw named(name); } } });
    const cam = new CameraController(fakeVideo());
    await assert.rejects(() => cam.start(), (e) => e.code === code && e.cause?.name === name);
  }
});

test('start: collega il flusso al video e legge la fotocamera aperta', async () => {
  const track = fakeTrack({ facingMode: 'user', caps: { torch: true, exposureCompensation: { min: -2, max: 2, step: 0.5 } }, settings: { pointsOfInterest: [] } });
  const requests = [];
  setGlobal('navigator', { mediaDevices: { getUserMedia: async (c) => { requests.push(c); return fakeStream(track); } } });
  const video = fakeVideo();
  const cam = new CameraController(video);
  const info = await cam.start({ facing: 'user' });
  assert.deepEqual(info, { facing: 'user', width: 640, height: 480 });
  assert.equal(requests[0].video.facingMode.ideal, 'user');
  assert.equal(video.srcObject.getVideoTracks()[0], track);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(cam.facing, 'user');
  assert.equal(cam.active, true);
  assert.deepEqual(cam.capabilities, { torch: true, exposure: { min: -2, max: 2, step: 0.5 }, pointsOfInterest: true });

  // torcia ed esposizione restano insieme: applyConstraints sostituisce tutti i vincoli
  assert.equal(await cam.setTorch(true), true);
  assert.equal(await cam.setExposure(0.7), true);
  const last = track.applied.at(-1);
  assert.deepEqual(last.advanced, [{ torch: true }, { exposureCompensation: 0.5 }]);
  assert.equal(last.width.ideal, 1920);

  // tocca per esporre: punto mappato, un insieme per proprietà
  assert.equal(await cam.focusAt(0.25, 0.75), true);
  const poi = track.applied.at(-1).advanced;
  assert.deepEqual(poi.slice(0, 2), [{ torch: true }, { exposureCompensation: 0.5 }]);
  assert.deepEqual(poi[2], { pointsOfInterest: [{ x: 0.25, y: 0.75 }] });

  cam.stop();
  assert.equal(track.stopped, true);
  assert.equal(video.srcObject, null);
  assert.equal(cam.active, false);
  await assert.rejects(() => cam.capture(), (e) => e.code === 'not-started');
  assert.equal(await cam.setTorch(false), false);
});

test('switchFacing: chiude la fotocamera aperta e chiede l\'altra', async () => {
  const tracks = [fakeTrack({ facingMode: 'environment' }), fakeTrack({ facingMode: 'user' })];
  const asked = [];
  setGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async (c) => {
        asked.push(c.video.facingMode.ideal);
        return fakeStream(tracks[asked.length - 1]);
      },
    },
  });
  const cam = new CameraController(fakeVideo());
  await cam.start();
  await cam.switchFacing();
  assert.deepEqual(asked, ['environment', 'user']);
  assert.equal(tracks[0].stopped, true);
  assert.equal(cam.facing, 'user');
});

test('start: una start più recente rende muta la precedente', async () => {
  const tracks = [fakeTrack(), fakeTrack({ facingMode: 'user' })];
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  setGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        const i = n++;
        if (i === 0) await gate;
        return fakeStream(tracks[i]);
      },
    },
  });
  const cam = new CameraController(fakeVideo());
  const first = cam.start();
  const second = cam.start({ facing: 'user' });
  await second;
  release();
  await first;
  assert.equal(tracks[0].stopped, true, 'il flusso arrivato tardi si chiude');
  assert.equal(cam.facing, 'user');
  assert.equal(cam.active, true);
});

/** Scatto con ImageCapture finto: tele finte e createImageBitmap che registra le chiamate. */
async function withFakeCapture(fn, { drawFails = false } = {}) {
  const prev = {
    ImageCapture: Object.getOwnPropertyDescriptor(globalThis, 'ImageCapture'),
    createImageBitmap: Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'),
  };
  const log = { decoded: [], closed: 0, canvases: [] };
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      log.canvases.push(this);
    }

    getContext() {
      return {
        save() {}, restore() {}, translate() {}, scale() {},
        drawImage() {
          if (drawFails) throw new Error('disegno fallito');
        },
      };
    }
  };
  setGlobal('ImageCapture', class {
    async takePhoto() {
      return new Blob([new Uint8Array(16)], { type: 'image/jpeg' });
    }
  });
  setGlobal('createImageBitmap', async (src, opts) => {
    if (src instanceof Blob) {
      // browser che non conosce imageOrientation: TypeError con le opzioni
      if (opts) throw new TypeError('imageOrientation non supportato');
      log.decoded.push(src);
      return { width: 1920, height: 1440, close: () => { log.closed++; } };
    }
    return { width: src.width, height: src.height, close() {} };
  });
  try {
    const track = fakeTrack();
    setGlobal('navigator', { mediaDevices: { getUserMedia: async () => fakeStream(track) } });
    const cam = new CameraController(fakeVideo());
    await cam.start();
    await fn(cam, log);
    cam.stop();
  } finally {
    for (const [name, desc] of Object.entries(prev)) {
      if (desc) Object.defineProperty(globalThis, name, desc);
      else delete globalThis[name];
    }
  }
}

test('capture: takePhoto a piena qualità, decodifica senza opzioni dove imageOrientation manca', async () => {
  await withFakeCapture(async (cam, log) => {
    const photo = await cam.capture({ maxSide: 1024 });
    assert.equal(log.decoded.length, 1, 'lo scatto è stato decodificato con il ripiego');
    // 1920x1440 ritagliato 4:3 come il video, lato lungo 1024
    assert.deepEqual([photo.width, photo.height], [1024, 768]);
    assert.equal(log.closed, 1, 'la foto intermedia si chiude');
    assert.ok(log.canvases.every((c) => c.width === 0), 'tele liberate');
  });
});

test('capture: se il disegno fallisce il codice è capture-failed e la tela si libera', async () => {
  await withFakeCapture(async (cam, log) => {
    await assert.rejects(() => cam.capture(), (e) => e.code === 'capture-failed');
    assert.ok(log.canvases.length > 0);
    assert.ok(log.canvases.every((c) => c.width === 0), 'nessuna tela resta allocata');
    assert.equal(log.closed, 1, 'la foto intermedia si chiude anche in errore');
  }, { drawFails: true });
});

// ---------------------------------------------------------------- anteprima termica

test('previewTone: metà nitidezza, il resto come le impostazioni', () => {
  const t = previewTone({ sharpen: 0.8, shadows: 0.4 });
  assert.equal(t.sharpen, 0.4);
  assert.equal(t.shadows, 0.4);
  assert.equal(t.contrast, defaultTone().contrast);
  assert.equal(previewTone(undefined).sharpen, defaultTone().sharpen / 2);
});

test('frameCrop e previewSize: ritaglio come il riquadro, 240 punti di larghezza', () => {
  assert.deepEqual(frameCrop(640, 480, 0), { sx: 0, sy: 0, sw: 640, sh: 480 });
  assert.deepEqual(frameCrop(640, 480, 0.75), { sx: 140, sy: 0, sw: 360, sh: 480 });
  assert.deepEqual(previewSize(360, 480), { width: 240, height: 320 });
  assert.deepEqual(previewSize(100, 50), { width: 100, height: 50 }, 'mai ingrandita');
  assert.equal(PREVIEW_WIDTH, 240);
  assert.equal(MIN_FRAME_INTERVAL_MS, 100);
});

test('toneLikePrint: la parte stampata si regola per conto suo', () => {
  const gray = GrayImage.gradient(240, 320);
  const tone = previewTone(defaultTone());
  assert.deepEqual(toneLikePrint(gray, tone, 0).pixels, applyTone(gray, tone).pixels);
  // rapporto quasi uguale all'inquadratura: una sola passata
  assert.deepEqual(toneLikePrint(gray, tone, 240 / 318).pixels, applyTone(gray, tone).pixels);
  // quadrato al centro: dentro come la sola parte ritagliata, fuori come l'inquadratura intera
  const out = toneLikePrint(gray, tone, 1);
  const whole = applyTone(gray, tone);
  const top = 40;
  const crop = new GrayImage(240, 240, gray.pixels.slice(top * 240, (top + 240) * 240));
  const printed = applyTone(crop, tone);
  assert.deepEqual(out.pixels.subarray(top * 240, (top + 240) * 240), printed.pixels);
  assert.deepEqual(out.pixels.subarray(0, top * 240), whole.pixels.subarray(0, top * 240));
});

class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class FakeCanvas {
  constructor(width = 300, height = 150) {
    this.width = width;
    this.height = height;
    this.style = {};
    this.puts = [];
    this.clears = 0;
  }

  getContext() {
    const canvas = this;
    return {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      setTransform() {},
      drawImage() {},
      getImageData: (x, y, w, h) => new FakeImageData(new Uint8ClampedArray(w * h * 4).fill(90), w, h),
      putImageData(img) {
        canvas.puts.push(img);
      },
      clearRect() {
        canvas.clears++;
      },
    };
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Aspetta una condizione senza dipendere dalla velocità della macchina (CI lente comprese). */
async function until(cond, timeoutMs = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condizione non raggiunta in tempo');
    await wait(5);
  }
}

test('startThermalPreview: fotogrammi Ink/Paper a 240 punti, ritmo ~10 fps, si ferma e pulisce', async () => {
  globalThis.OffscreenCanvas = FakeCanvas;
  globalThis.ImageData = FakeImageData;
  const video = fakeVideo();
  video.srcObject = fakeStream(fakeTrack());
  video.isConnected = true;
  const canvas = new FakeCanvas();
  canvas.clientWidth = 300;
  canvas.clientHeight = 400;
  canvas.isConnected = true;
  const times = [];
  const putImageData = canvas.getContext;
  canvas.getContext = function () {
    const ctx = putImageData.call(this);
    const put = ctx.putImageData;
    ctx.putImageData = (img) => {
      times.push(performance.now());
      put(img);
    };
    return ctx;
  };

  let tones = 0;
  const stop = startThermalPreview(video, canvas, {
    getTone: () => { tones++; return defaultTone(); },
    getDither: () => 'ATKINSON',
    mirror: () => true,
  });
  await until(() => canvas.puts.length >= 2);
  assert.equal(canvas.style.imageRendering, 'pixelated');
  assert.equal(canvas.width, 240);
  assert.equal(canvas.height, 320);
  assert.ok(tones >= 2);
  // solo i due colori della carta
  const data = canvas.puts[0].data;
  for (let i = 0; i < data.length; i += 4) {
    const px = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    assert.ok(px.join() === INK_RGBA.join() || px.join() === PAPER_RGBA.join(), `colore ${px}`);
  }
  // la pausa minima parte dalla fine del fotogramma precedente: mai più di ~10 al secondo
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= MIN_FRAME_INTERVAL_MS - 10);

  // video in pausa: tela vuota e nessun fotogramma nuovo
  video.paused = true;
  await until(() => canvas.clears >= 1);
  const puts = canvas.puts.length;
  await wait(MIN_FRAME_INTERVAL_MS * 3);
  assert.equal(canvas.puts.length, puts);

  // il video riparte: l'anteprima riprende da sola
  video.paused = false;
  await until(() => canvas.puts.length > puts);

  stop();
  assert.equal(video.listenerCount(), 0, 'ascoltatori tolti');
  stop();
});

test('startThermalPreview: finisce da sola quando la tela esce dalla pagina', async () => {
  globalThis.OffscreenCanvas = FakeCanvas;
  globalThis.ImageData = FakeImageData;
  const video = fakeVideo();
  video.srcObject = fakeStream(fakeTrack());
  video.isConnected = true;
  const canvas = new FakeCanvas();
  canvas.isConnected = true;
  startThermalPreview(video, canvas, { getTone: () => defaultTone(), getDither: () => 'THRESHOLD' });
  await until(() => canvas.puts.length >= 1);
  canvas.isConnected = false;
  await until(() => video.listenerCount() === 0);
  assert.equal(video.listenerCount(), 0, 'il ciclo si è fermato da solo');
});

test('startThermalPreview: aspetta che la tela entri nella pagina prima di considerarla staccata', async () => {
  globalThis.OffscreenCanvas = FakeCanvas;
  globalThis.ImageData = FakeImageData;
  const video = fakeVideo();
  video.srcObject = fakeStream(fakeTrack());
  video.isConnected = true;
  const canvas = new FakeCanvas();
  canvas.isConnected = false;
  const stop = startThermalPreview(video, canvas, { getTone: () => defaultTone(), getDither: () => 'THRESHOLD' });
  await wait(MIN_FRAME_INTERVAL_MS);
  assert.ok(video.listenerCount() > 0, 'non si ferma prima di essere montata');
  canvas.isConnected = true;
  await until(() => canvas.puts.length >= 1);
  stop();
  assert.equal(video.listenerCount(), 0);
});
