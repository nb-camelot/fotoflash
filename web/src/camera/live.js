// Anteprima termica dal vivo, come ThermalPreviewAnalyzer.kt: il mirino mostra in tempo reale
// come uscirebbe la foto dalla stampante, retinata a 1 bit, con i colori della carta (Ink su
// Paper): sembra uno scontrino appena stampato, non un filtro bianco e nero.

import { GrayImage } from '../core/gray.js';
import { toRgba } from '../core/bitimage.js';
import { applyTone } from '../core/tone.js';
import { dither } from '../core/dither.js';
import { defaultTone } from '../core/model.js';
import { coverCrop, createCanvas, readableContext, releaseCanvas, sourceSize, asClamped } from '../render/bitmap.js';
import { isMirroredTransform } from './camera.js';

/** Larghezza dell'anteprima in punti: abbastanza per leggere il retino, poco per la CPU. */
export const PREVIEW_WIDTH = 240;

/** Pausa minima tra la fine di un fotogramma e l'inizio del successivo: ~10 al secondo. */
export const MIN_FRAME_INTERVAL_MS = 100;

/** Senza fotogrammi (video in pausa, fotocamera che cambia, scheda nascosta) si controlla piano. */
const IDLE_POLL_MS = 250;

/** Sotto questi pixel di differenza la parte stampata è di fatto tutta l'inquadratura. */
const MIN_CROP_MARGIN = 4;

/** Ink e Paper del brand, RGBA. */
export const INK_RGBA = Object.freeze([0x16, 0x13, 0x0f, 255]);
export const PAPER_RGBA = Object.freeze([0xfb, 0xf8, 0xf1, 255]);

/**
 * Regolazioni "leggere": quelle dell'utente con metà nitidezza, perché l'anteprima è ingrandita
 * 4-5 volte e gli aloni della maschera di contrasto si vedrebbero più che sulla carta.
 */
export function previewTone(tone) {
  const t = { ...defaultTone(), ...(tone ?? {}) };
  return { ...t, sharpen: t.sharpen * 0.5 };
}

/**
 * Parte del fotogramma [frameW] x [frameH] che si vede in un riquadro di rapporto [boxAspect]
 * con object-fit: cover; senza riquadro, tutto il fotogramma. → { sx, sy, sw, sh }
 */
export function frameCrop(frameW, frameH, boxAspect) {
  if (!(boxAspect > 0)) return { sx: 0, sy: 0, sw: frameW, sh: frameH };
  return coverCrop(frameW, frameH, boxAspect, 1);
}

/** Misure dell'anteprima: larghezza al massimo [maxWidth], stesse proporzioni del ritaglio. */
export function previewSize(cropW, cropH, maxWidth = PREVIEW_WIDTH) {
  const width = Math.max(1, Math.min(Math.round(maxWidth), Math.round(cropW)));
  const height = Math.max(1, Math.round((width * cropH) / cropW));
  return { width, height };
}

function copyArea(src, left, top, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const from = (top + y) * src.width + left;
    out.set(src.pixels.subarray(from, from + w), y * w);
  }
  return new GrayImage(w, h, out);
}

function pasteArea(dst, src, left, top) {
  for (let y = 0; y < src.height; y++) {
    dst.pixels.set(src.pixels.subarray(y * src.width, (y + 1) * src.width), (top + y) * dst.width + left);
  }
}

/**
 * Tono come in stampa. La stampa regola la sola foto ritagliata dal modello, e controluce,
 * contrasto locale e auto-livelli dipendono da cosa c'è nell'immagine: la parte centrale con
 * rapporto [printAspect] si regola per conto suo e si incolla sopra il resto, regolato
 * sull'inquadratura intera. [printAspect] assente o ≤ 0 = una sola passata.
 */
export function toneLikePrint(gray, tone, printAspect) {
  const whole = applyTone(gray, tone);
  if (!(printAspect > 0)) return whole;
  let cropWidth = gray.width;
  let cropHeight = Math.round(gray.width / printAspect);
  if (cropHeight > gray.height) {
    cropHeight = gray.height;
    cropWidth = Math.round(gray.height * printAspect);
  }
  cropWidth = Math.min(gray.width, Math.max(1, cropWidth));
  cropHeight = Math.min(gray.height, Math.max(1, cropHeight));
  if (gray.width - cropWidth <= MIN_CROP_MARGIN && gray.height - cropHeight <= MIN_CROP_MARGIN) return whole;
  const left = Math.floor((gray.width - cropWidth) / 2);
  const top = Math.floor((gray.height - cropHeight) / 2);
  const printed = applyTone(copyArea(gray, left, top, cropWidth, cropHeight), tone);
  pasteArea(whole, printed, left, top);
  return whole;
}

const read = (v) => (typeof v === 'function' ? v() : v);

/** true se il video ha fotogrammi vivi da leggere. */
function hasLiveFrames(video) {
  if (!video || video.paused || video.ended || video.readyState < 2) return false;
  if (!(video.videoWidth > 0 && video.videoHeight > 0)) return false;
  const stream = video.srcObject;
  if (stream && typeof stream.getVideoTracks === 'function') {
    return stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled !== false);
  }
  return !!(stream || video.currentSrc);
}

/** Rapporto del riquadro mostrato a schermo: quello della tela, o del video sotto. */
function boxAspect(canvasEl, videoEl) {
  for (const el of [canvasEl, videoEl]) {
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    if (w > 0 && h > 0) return w / h;
  }
  return 0;
}

/**
 * Avvia l'anteprima termica: ~10 fotogrammi al secondo dal video, ridotti a 240 punti di
 * larghezza e ritagliati come il riquadro a schermo, regolati (getTone, metà nitidezza),
 * retinati (getDither) e disegnati su [canvasEl] a pixel netti.
 * options: { getTone, getDither, mirror (boolean o funzione), getPrintAspect?, width?, ink?, paper? }
 * La tela va messa sopra il video, nello stesso riquadro (object-fit: cover): il fotogramma si
 * ritaglia sul suo rapporto. Lo specchio si fa nei pixel; se la tela è già specchiata via CSS no.
 * Se il video si ferma (pausa, fotocamera spenta o in cambio) la tela si svuota e il ciclo
 * aspetta senza lavorare; finisce da solo quando video o tela escono dalla pagina.
 * → stop(): ferma il ciclo, toglie gli ascoltatori e svuota la tela.
 */
export function startThermalPreview(videoEl, canvasEl, {
  getTone,
  getDither,
  mirror = false,
  getPrintAspect,
  width = PREVIEW_WIDTH,
  ink = INK_RGBA,
  paper = PAPER_RGBA,
} = {}) {
  let stopped = false;
  let timer = 0;
  let showing = false;
  // si considera "staccata" solo una coppia che è stata in pagina: la UI può montarla dopo
  let seenConnected = false;
  let work = null;
  let workCtx = null;
  const outCtx = canvasEl.getContext('2d');
  canvasEl.style.imageRendering = 'pixelated';

  const clearOutput = () => {
    if (!showing) return;
    showing = false;
    outCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  };

  const schedule = (ms) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  };

  function cssMirrored() {
    const view = canvasEl.ownerDocument?.defaultView ?? globalThis;
    if (typeof view?.getComputedStyle !== 'function') return false;
    try {
      const style = view.getComputedStyle(canvasEl);
      return isMirroredTransform(style.transform, style.scale);
    } catch {
      return false;
    }
  }

  function detached() {
    const connected = !!(videoEl?.isConnected && canvasEl?.isConnected);
    if (connected) seenConnected = true;
    return seenConnected && !connected;
  }

  function renderFrame() {
    const { width: vw, height: vh } = sourceSize(videoEl);
    const crop = frameCrop(vw, vh, boxAspect(canvasEl, videoEl));
    const size = previewSize(crop.sw, crop.sh, width);
    if (!work) {
      work = createCanvas(size.width, size.height);
      workCtx = readableContext(work);
    } else if (work.width !== size.width || work.height !== size.height) {
      // ridimensionare svuota la tela ed è lento: solo quando le misure cambiano davvero
      work.width = size.width;
      work.height = size.height;
    }
    workCtx.setTransform(1, 0, 0, 1, 0, 0);
    workCtx.imageSmoothingEnabled = true;
    workCtx.imageSmoothingQuality = 'medium';
    // specchio per la frontale, come il mirino; se la tela è già specchiata via CSS non si raddoppia
    if (read(mirror) && !cssMirrored()) workCtx.setTransform(-1, 0, 0, 1, size.width, 0);
    workCtx.drawImage(videoEl, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);

    const { data } = workCtx.getImageData(0, 0, size.width, size.height);
    const gray = GrayImage.fromRgba(size.width, size.height, data);
    const toned = toneLikePrint(gray, previewTone(read(getTone)), Number(read(getPrintAspect)) || 0);
    const bits = dither(toned, read(getDither) || 'ATKINSON');
    const rgba = asClamped(toRgba(bits, Array.from(ink), Array.from(paper)));

    if (canvasEl.width !== bits.width || canvasEl.height !== bits.height) {
      canvasEl.width = bits.width;
      canvasEl.height = bits.height;
    }
    outCtx.putImageData(new ImageData(rgba, bits.width, bits.height), 0, 0);
    showing = true;
  }

  function tick() {
    timer = 0;
    if (stopped) return;
    if (detached()) {
      stop();
      return;
    }
    const hidden = globalThis.document?.hidden === true;
    if (hidden || !hasLiveFrames(videoEl)) {
      // niente fotogrammi: niente immagine ferma sopra un mirino che cambia
      clearOutput();
      schedule(IDLE_POLL_MS);
      return;
    }
    try {
      renderFrame();
    } catch {
      // un fotogramma perso non si vede; il successivo ci riprova
    }
    // l'intervallo parte dalla fine del fotogramma: su un telefono lento l'anteprima rallenta
    schedule(MIN_FRAME_INTERVAL_MS);
  }

  // un fotogramma nuovo dopo una pausa o un cambio di fotocamera si mostra subito
  const wake = () => {
    if (!stopped && !showing) schedule(0);
  };
  const sleep = () => clearOutput();
  const wakeEvents = ['playing', 'loadeddata', 'resize'];
  const sleepEvents = ['emptied', 'pause', 'ended'];
  wakeEvents.forEach((ev) => videoEl.addEventListener(ev, wake));
  sleepEvents.forEach((ev) => videoEl.addEventListener(ev, sleep));

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    wakeEvents.forEach((ev) => videoEl.removeEventListener(ev, wake));
    sleepEvents.forEach((ev) => videoEl.removeEventListener(ev, sleep));
    showing = true;
    clearOutput();
    if (work) releaseCanvas(work);
    work = null;
    workCtx = null;
  }

  schedule(0);
  return stop;
}
