// Fotocamera del browser (getUserMedia), come il CameraController di CameraX nell'app:
// avvio e cambio fotocamera, torcia, compensazione dell'esposizione, tocca per esporre, scatto.
// Lo scatto è dritto, specchiato per la frontale e ritagliato su ciò che mostra il mirino,
// come toUprightPhoto() ritaglia il JPEG sul cropRect del viewport.

import { coverCrop, createCanvas, drawCover, releaseCanvas, sourceSize } from '../render/bitmap.js';
import { MAX_PHOTO_SIDE, fitWithin } from '../media/import.js';

/** Risoluzione ideale: 4:3 come il sensore, abbastanza per una foto da 2048 px di lato. */
const IDEAL_WIDTH = 1920;
const IDEAL_HEIGHT = 1440;

/** takePhoto su alcuni Android impiega più di un secondo o non risponde: oltre si usa il video. */
const TAKE_PHOTO_TIMEOUT_MS = 4000;
const PHOTO_CAPS_TIMEOUT_MS = 1500;
const VIDEO_READY_TIMEOUT_MS = 4000;

/** Codici in err.code, per i messaggi della UI. */
export const CameraErrorCode = Object.freeze({
  /** il browser non ha getUserMedia */
  UNSUPPORTED: 'unsupported',
  /** pagina non sicura (http fuori da localhost): il browser nasconde la fotocamera */
  INSECURE: 'insecure',
  /** permesso negato dall'utente o dal sistema */
  DENIED: 'denied',
  /** nessuna fotocamera adatta */
  NOT_FOUND: 'not-found',
  /** fotocamera occupata da un'altra app o scheda */
  IN_USE: 'in-use',
  /** scatto chiesto senza fotocamera accesa */
  NOT_STARTED: 'not-started',
  /** lo scatto non ha prodotto un'immagine */
  CAPTURE_FAILED: 'capture-failed',
  UNKNOWN: 'unknown',
});

/** Codice leggibile dalla UI per un errore di getUserMedia (o già nostro). */
export function cameraErrorCode(err) {
  if (typeof err?.code === 'string' && Object.values(CameraErrorCode).includes(err.code)) return err.code;
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return CameraErrorCode.DENIED;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return CameraErrorCode.NOT_FOUND;
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return CameraErrorCode.IN_USE;
    default:
      return CameraErrorCode.UNKNOWN;
  }
}

function cameraError(code, cause) {
  const e = new Error(`fotocamera: ${code}`);
  e.name = 'CameraError';
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

/** Vincoli di getUserMedia: facingMode sempre "ideal", mai "exact" (fallisce con una sola fotocamera). */
export function videoConstraints(facing = 'environment') {
  return {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: IDEAL_WIDTH },
      height: { ideal: IDEAL_HEIGHT },
    },
  };
}

/**
 * Capacità della traccia nel formato della UI.
 * → { torch, exposure: { min, max, step } | null, pointsOfInterest }
 */
export function capabilitiesFrom(caps = {}, settings = {}) {
  const torch = caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true));
  const ec = caps.exposureCompensation;
  const exposure = ec && Number.isFinite(ec.min) && Number.isFinite(ec.max) && ec.max > ec.min && ec.step > 0
    ? { min: ec.min, max: ec.max, step: ec.step }
    : null;
  const pointsOfInterest = 'pointsOfInterest' in settings || 'pointsOfInterest' in caps;
  return { torch, exposure, pointsOfInterest };
}

/** EV portato nel range e sul passo della fotocamera (di solito 1/3 o 1/6 di stop). */
export function snapExposure(ev, range) {
  const v = Number(ev) || 0;
  const steps = Math.round((v - range.min) / range.step);
  const snapped = range.min + steps * range.step;
  const clamped = Math.min(range.max, Math.max(range.min, snapped));
  return Math.round(clamped * 1e6) / 1e6;
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));

/**
 * Da un punto del mirino (0..1 sull'elemento video, come lo vede l'utente) al punto del
 * fotogramma: toglie lo specchio CSS e il ritaglio di object-fit (cover o contain).
 */
export function viewToFramePoint(nx, ny, { viewWidth, viewHeight, frameWidth, frameHeight, fit = 'cover', mirrored = false } = {}) {
  let x = clamp01(nx);
  const y = clamp01(ny);
  if (mirrored) x = 1 - x;
  if (!(viewWidth > 0 && viewHeight > 0 && frameWidth > 0 && frameHeight > 0) || fit === 'fill') return { x, y };
  const scale = fit === 'cover'
    ? Math.max(viewWidth / frameWidth, viewHeight / frameHeight)
    : Math.min(viewWidth / frameWidth, viewHeight / frameHeight);
  const shownW = frameWidth * scale;
  const shownH = frameHeight * scale;
  return {
    x: clamp01((x * viewWidth - (viewWidth - shownW) / 2) / shownW),
    y: clamp01((y * viewHeight - (viewHeight - shownH) / 2) / shownH),
  };
}

/** true se una trasformazione CSS calcolata ribalta l'asse x (scaleX(-1), scale: -1 1). */
export function isMirroredTransform(transform, scale) {
  const m = /^matrix(3d)?\(([^)]+)\)$/.exec(String(transform ?? '').trim());
  if (m) {
    const a = Number(m[2].split(',')[0]);
    if (a < 0) return true;
  }
  const first = Number(String(scale ?? '').trim().split(/\s+/)[0]);
  return Number.isFinite(first) && first < 0;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(cameraError(CameraErrorCode.CAPTURE_FAILED)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // traccia già chiusa
    }
  }
}

function safeCall(fn, fallback) {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

/** Aspetta che il video abbia un fotogramma; false allo scadere (i fotogrammi possono arrivare dopo). */
function waitForVideo(video, timeoutMs) {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const events = ['loadeddata', 'loadedmetadata', 'resize', 'playing'];
    const done = (ok) => {
      clearTimeout(timer);
      events.forEach((ev) => video.removeEventListener(ev, check));
      resolve(ok);
    };
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    events.forEach((ev) => video.addEventListener(ev, check));
  });
}

async function toImageBitmap(canvas) {
  if (typeof createImageBitmap !== 'function') return canvas;
  try {
    return await createImageBitmap(canvas);
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * JPEG dello scatto con l'orientamento EXIF applicato. I browser che non conoscono l'opzione
 * lanciano TypeError: senza opzioni l'EXIF lo applicano già di default (come in media/import.js).
 */
async function decodePhoto(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    if (e?.name === 'TypeError' || e instanceof TypeError) return createImageBitmap(blob);
    throw e;
  }
}

/**
 * Foto dritta da una sorgente (scatto o fotogramma del video): ritaglio centrale sul rapporto
 * [aspect] (null = tutta), lato lungo al massimo [maxSide], specchio per la frontale.
 */
async function uprightPhoto(source, { aspect, mirror, maxSide }) {
  const { width, height } = sourceSize(source);
  if (!(width > 0 && height > 0)) throw cameraError(CameraErrorCode.CAPTURE_FAILED);
  const crop = aspect > 0 ? coverCrop(width, height, aspect, 1) : { sw: width, sh: height };
  const target = fitWithin(crop.sw, crop.sh, maxSide);
  const canvas = createCanvas(target.width, target.height);
  try {
    const ctx = canvas.getContext('2d');
    // lo specchio va sulla foto già dritta: ribalta destra e sinistra come il mirino della frontale
    if (mirror) {
      ctx.translate(target.width, 0);
      ctx.scale(-1, 1);
    }
    drawCover(ctx, source, { left: 0, top: 0, width: target.width, height: target.height });
  } catch (e) {
    // la tela da 2048 px non aspetta il garbage collector
    releaseCanvas(canvas);
    throw e;
  }
  return toImageBitmap(canvas);
}

export class CameraController {
  constructor(videoEl) {
    this._video = videoEl;
    this._stream = null;
    this._track = null;
    this._imageCapture = null;
    this._facing = 'environment';
    this._token = 0;
    // torcia ed esposizione si riapplicano insieme: applyConstraints sostituisce tutti i vincoli
    this._sticky = {};
  }

  /** L'elemento <video> del mirino. */
  get video() {
    return this._video;
  }

  /** true se la fotocamera è accesa e la traccia è viva. */
  get active() {
    return this._track?.readyState === 'live';
  }

  /** 'environment' (posteriore) o 'user' (frontale): quella davvero aperta, se il browser lo dice. */
  get facing() {
    return this._facing;
  }

  /** { torch, exposure: { min, max, step } | null, pointsOfInterest }, letto ogni volta dalla traccia. */
  get capabilities() {
    const track = this._liveTrack();
    if (!track) return { torch: false, exposure: null, pointsOfInterest: false };
    const caps = safeCall(() => track.getCapabilities?.(), {});
    const settings = safeCall(() => track.getSettings?.(), {});
    return capabilitiesFrom(caps, settings);
  }

  /** Quante fotocamere vede il browser (per mostrare o no il pulsante di cambio). */
  static async cameraCount() {
    const md = globalThis.navigator?.mediaDevices;
    if (!md?.enumerateDevices) return 0;
    try {
      const devices = await md.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput').length;
    } catch {
      return 0;
    }
  }

  /**
   * Accende la fotocamera [facing] e la collega al video. → { facing, width, height }
   * Errori con err.code (CameraErrorCode). Una start() più recente rende muta questa.
   */
  async start({ facing = 'environment' } = {}) {
    const token = ++this._token;
    const md = globalThis.navigator?.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') {
      throw cameraError(globalThis.isSecureContext === false ? CameraErrorCode.INSECURE : CameraErrorCode.UNSUPPORTED);
    }
    // si chiude prima la fotocamera aperta: molti telefoni non ne tengono due insieme
    this._release();

    let stream;
    try {
      stream = await md.getUserMedia(videoConstraints(facing));
    } catch (e) {
      if (e?.name !== 'OverconstrainedError') throw cameraError(cameraErrorCode(e), e);
      try {
        stream = await md.getUserMedia({ audio: false, video: true });
      } catch (e2) {
        throw cameraError(cameraErrorCode(e2), e2);
      }
    }
    if (token !== this._token) {
      stopStream(stream);
      return { facing: this._facing, width: 0, height: 0 };
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopStream(stream);
      throw cameraError(CameraErrorCode.NOT_FOUND);
    }
    this._stream = stream;
    this._track = track;
    this._sticky = {};
    const settings = safeCall(() => track.getSettings?.(), {});
    this._facing = settings.facingMode === 'user' || settings.facingMode === 'environment' ? settings.facingMode : facing;
    this._imageCapture = typeof ImageCapture === 'function' ? safeCall(() => new ImageCapture(track), null) : null;

    const video = this._video;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.autoplay = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (e) {
      // AbortError: un'altra start() ha cambiato sorgente; gli altri casi li segnala la traccia
      if (token !== this._token) return { facing: this._facing, width: 0, height: 0 };
      if (e?.name === 'NotAllowedError') throw cameraError(CameraErrorCode.DENIED, e);
    }
    await waitForVideo(video, VIDEO_READY_TIMEOUT_MS);
    return { facing: this._facing, width: video.videoWidth, height: video.videoHeight };
  }

  /** Spegne la fotocamera e stacca il video. */
  stop() {
    this._token++;
    this._release();
    if (this._video) {
      try {
        this._video.pause();
      } catch {
        // video già fermo
      }
      this._video.srcObject = null;
    }
  }

  /** Passa dalla posteriore alla frontale e viceversa (esposizione e torcia ripartono da zero). */
  async switchFacing() {
    return this.start({ facing: this._facing === 'user' ? 'environment' : 'user' });
  }

  /** Torcia accesa/spenta. → true se la fotocamera l'ha accettata. */
  async setTorch(on) {
    const track = this._liveTrack();
    if (!track || !this.capabilities.torch) return false;
    this._sticky.torch = !!on;
    if (!(await this._apply(track))) return false;
    const s = safeCall(() => track.getSettings?.(), {});
    return 'torch' in s ? s.torch === !!on : true;
  }

  /** Compensazione dell'esposizione in EV (portata sul passo della fotocamera). → true se applicata. */
  async setExposure(ev) {
    const track = this._liveTrack();
    const range = this.capabilities.exposure;
    if (!track || !range) return false;
    this._sticky.exposureCompensation = snapExposure(ev, range);
    return this._apply(track);
  }

  /**
   * Tocca per esporre: messa a fuoco ed esposizione misurate nel punto (0..1) dell'elemento video
   * come lo vede l'utente; specchio CSS e ritaglio di object-fit si tolgono qui.
   * → false se la fotocamera non sa misurare in un punto (molte frontali, i PC).
   */
  async focusAt(nx, ny) {
    const track = this._liveTrack();
    if (!track || !this.capabilities.pointsOfInterest) return false;
    const caps = safeCall(() => track.getCapabilities?.(), {});
    const point = this._framePoint(nx, ny);
    // un insieme per proprietà: un insieme con una proprietà non supportata verrebbe scartato intero
    const sets = [{ pointsOfInterest: [point] }];
    const focusModes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
    if (focusModes.includes('single-shot')) sets.push({ focusMode: 'single-shot' });
    else if (focusModes.includes('continuous')) sets.push({ focusMode: 'continuous' });
    const exposureModes = Array.isArray(caps.exposureMode) ? caps.exposureMode : [];
    if (exposureModes.includes('continuous')) sets.push({ exposureMode: 'continuous' });
    return this._apply(track, sets);
  }

  /**
   * Scatta: ImageCapture.takePhoto se c'è (qualità piena), altrimenti il fotogramma del video.
   * → ImageBitmap dritto, ritagliato come il mirino, lato lungo ≤ [maxSide], specchiato se frontale.
   * flash facoltativo ('auto' | 'on' | 'off'): usato solo con takePhoto e se la fotocamera lo supporta.
   */
  async capture({ maxSide = MAX_PHOTO_SIDE, flash } = {}) {
    const track = this._liveTrack();
    if (!track) throw cameraError(CameraErrorCode.NOT_STARTED);
    const video = this._video;
    const { width: vw, height: vh } = sourceSize(video);
    const aspect = this._viewAspect() ?? (vw > 0 && vh > 0 ? vw / vh : null);
    const mirror = this._facing === 'user';

    const photo = await this._takePhoto(flash, vw, vh);
    try {
      if (photo) return await uprightPhoto(photo, { aspect, mirror, maxSide });
      if (!(await waitForVideo(video, VIDEO_READY_TIMEOUT_MS))) throw cameraError(CameraErrorCode.CAPTURE_FAILED);
      return await uprightPhoto(video, { aspect, mirror, maxSide });
    } catch (e) {
      if (e?.name === 'CameraError') throw e;
      throw cameraError(CameraErrorCode.CAPTURE_FAILED, e);
    } finally {
      photo?.close?.();
    }
  }

  // ------------------------------------------------------------ interni

  _liveTrack() {
    return this._track && this._track.readyState === 'live' ? this._track : null;
  }

  _release() {
    stopStream(this._stream);
    this._stream = null;
    this._track = null;
    this._imageCapture = null;
    this._sticky = {};
  }

  /** applyConstraints sostituisce tutto: si ripetono risoluzione, torcia ed esposizione correnti. */
  async _apply(track, extraSets = []) {
    const advanced = [];
    if (this._sticky.torch !== undefined) advanced.push({ torch: this._sticky.torch });
    if (this._sticky.exposureCompensation !== undefined) {
      advanced.push({ exposureCompensation: this._sticky.exposureCompensation });
    }
    advanced.push(...extraSets);
    try {
      await track.applyConstraints({ width: { ideal: IDEAL_WIDTH }, height: { ideal: IDEAL_HEIGHT }, advanced });
      return true;
    } catch {
      return false;
    }
  }

  _style() {
    const v = this._video;
    const view = v?.ownerDocument?.defaultView ?? globalThis;
    return typeof view?.getComputedStyle === 'function' ? safeCall(() => view.getComputedStyle(v), null) : null;
  }

  /** Rapporto della parte di fotogramma che il mirino mostra (object-fit: cover); null = tutto. */
  _viewAspect() {
    const v = this._video;
    const w = v?.clientWidth ?? 0;
    const h = v?.clientHeight ?? 0;
    if (!(w > 0 && h > 0)) return null;
    return this._style()?.objectFit === 'cover' ? w / h : null;
  }

  _framePoint(nx, ny) {
    const v = this._video;
    const style = this._style();
    const { width, height } = sourceSize(v);
    return viewToFramePoint(nx, ny, {
      viewWidth: v?.clientWidth ?? 0,
      viewHeight: v?.clientHeight ?? 0,
      frameWidth: width,
      frameHeight: height,
      fit: style?.objectFit || 'contain',
      mirrored: style ? isMirroredTransform(style.transform, style.scale) : false,
    });
  }

  /**
   * Scatto a piena qualità; null se non disponibile, lento o girato diversamente dal video
   * (alcuni Android restituiscono la foto in orizzontale col telefono in verticale).
   */
  async _takePhoto(flash, vw, vh) {
    const ic = this._imageCapture;
    if (!ic || typeof ic.takePhoto !== 'function' || typeof createImageBitmap !== 'function') return null;
    let settings;
    if (flash) {
      try {
        const pc = await withTimeout(ic.getPhotoCapabilities(), PHOTO_CAPS_TIMEOUT_MS);
        const wanted = flash === 'on' ? 'flash' : flash;
        if (Array.isArray(pc?.fillLightMode) && pc.fillLightMode.includes(wanted)) settings = { fillLightMode: wanted };
      } catch {
        // senza capacità del flash si scatta senza impostazioni
      }
    }
    let bitmap = null;
    try {
      const blob = await withTimeout(settings ? ic.takePhoto(settings) : ic.takePhoto(), TAKE_PHOTO_TIMEOUT_MS);
      if (!blob || !blob.size) return null;
      bitmap = await decodePhoto(blob);
    } catch {
      return null;
    }
    const portraitVideo = vh > vw;
    const portraitPhoto = bitmap.height > bitmap.width;
    if (vw > 0 && vh > 0 && vw !== vh && bitmap.width !== bitmap.height && portraitVideo !== portraitPhoto) {
      bitmap.close();
      return null;
    }
    return bitmap;
  }
}
