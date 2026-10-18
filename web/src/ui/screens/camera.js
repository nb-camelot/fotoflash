// Il mirino (porting di CameraScreen.kt + CameraViewModel.kt): schermata principale, sempre scura.
// Scatto singolo o striscia da fotocabina, timer, torcia, anteprima termica dal vivo, tocca per
// esporre con ±EV, stampa istantanea, import dalla galleria e foto di esempio.

import { h as hRaw, clear } from '../dom.js';
import { icon } from '../icons.js';
import { flashButton, ghostButton, shutterButton, slider, printerPill, toast } from '../components.js';
import { CameraController } from '../../camera/camera.js';
import { startThermalPreview } from '../../camera/live.js';
import { loadImageFile } from '../../media/import.js';
import { downloadBlob, exportFileName } from '../../media/export.js';
import { createSamplePhoto } from '../sample-photo.js';
import { prepare, printAndRecord, awaitPrinterIdle, jpegBlobs, closePhotos } from '../print-sheet.js';

/** Valori del timer, nell'ordine del pulsante. */
const TIMER_STEPS = [0, 3, 10];
const MIN_STRIP_SHOTS = 2;
const MAX_STRIP_SHOTS = 4;
const STRIP_COUNTDOWN_SECONDS = 3;
const STRIP_REVEAL_MS = 600;
/** Oltre questo numero di stampe in coda l'otturatore aspetta: i bambini premono a raffica. */
const MAX_QUEUED_PRINTS = 3;
const PRINTED_BADGE_MS = 2600;
/** Tentativi di una stampa istantanea che trova la stampante occupata da un altro lavoro. */
const BUSY_ATTEMPTS = 3;
const BUSY_RETRY_DELAY_MS = 1500;
const PRINTER_IDLE_WAIT_MS = 60000;
/** Il pannello dell'esposizione si chiude da solo dopo questo tempo senza tocchi. */
const EXPOSURE_PANEL_IDLE_MS = 4000;
/** Un tocco che si sposta più di così è un trascinamento, non un "tocca per esporre". */
const TAP_SLOP_PX = 12;
const MAX_PHOTO_SIDE = 2048;
const THUMB_WIDTH = 120;

/** Testo breve per un esito di stampa fallito, per codice del PrinterManager. */
const FAILURE_TEXT = {
  UNSUPPORTED: 'cam_print_failed_unsupported',
  NO_PRINTER: 'cam_print_failed_no_printer',
  BLUETOOTH_OFF: 'cam_print_failed_bluetooth_off',
  CONNECT_FAILED: 'cam_print_failed_connect',
  WRITE_FAILED: 'cam_print_failed_write',
  BUSY: 'cam_print_failed_busy',
  RENDER_FAILED: 'cam_print_failed_render',
  CAT_PRINTER: 'cam_print_failed_cat_printer',
  NO_CHANNEL: 'cam_print_failed_no_channel',
};

/** Errori della fotocamera (camera.js) → testi e possibilità di riprovare. */
const CAMERA_ERRORS = {
  denied: { key: 'denied', retry: true },
  'not-found': { key: 'none', retry: true },
  'in-use': { key: 'busy', retry: true },
  unsupported: { key: 'unsupported', retry: false },
  insecure: { key: 'unsupported', retry: false },
};

/** Sequenza annullata (tocco sull'otturatore durante il conto alla rovescia o pagina nascosta). */
class Cancelled extends Error {
  constructor() {
    super('sequenza annullata');
    this.name = 'Cancelled';
  }
}

/**
 * Coda delle stampe istantanee dell'app, non del singolo mirino (come printLock nell'app Android):
 * uscendo e tornando nel mirino le stampe già in coda restano in ordine e contano per il limite.
 */
const instant = { chain: Promise.resolve(), pending: 0, listeners: new Set() };

function instantChanged() {
  for (const fn of [...instant.listeners]) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

/** Codice dell'errore della fotocamera (camera.js mette sempre err.code sugli errori di start). */
function cameraFailureCode(e) {
  return e && typeof e.code === 'string' ? e.code : 'unknown';
}

/** h() senza figli vuoti: le parti facoltative si passano come null. */
function h(tag, props, ...children) {
  return hRaw(tag, props, ...children.flat().filter((c) => c != null && c !== false));
}

export function mount(root, ctx) {
  ensureStyle();
  const { t, settings, session, router, printer } = ctx;
  const cleanups = [];
  let disposed = false;

  // --- stato --------------------------------------------------------------------------------
  let mode = 'photo';
  let ready = false;
  let cameraError = null;
  let startToken = 0;
  let capturing = false;
  let importing = false;
  let countdown = null;
  let strip = null; // { total, thumbs: canvas[] }
  let sequence = null;
  let showPrinted = false;
  let statusKey = null;
  let printedTimer = null;
  let printerProgress = null;
  let torchOn = false;
  let exposureEv = 0;
  let exposurePanelOpen = false;
  let exposureTimer = null;
  let caps = { torch: false, exposure: null, pointsOfInterest: false };
  let canSwitch = false;
  let videoAspect = 3 / 4;
  let liveStop = null;
  let audio = null;
  let wakeLock = null;
  let lastSettings = settings.get();

  // --- struttura ----------------------------------------------------------------------------
  const video = h('video', { class: 'ffcam-video', attrs: { playsinline: '', muted: '', autoplay: '', 'aria-hidden': 'true' } });
  video.muted = true;
  video.playsInline = true;
  const camera = new CameraController(video);
  const thermal = h('canvas', { class: 'ffcam-thermal', attrs: { 'aria-hidden': 'true' } });
  thermal.hidden = true;

  const guideFrame = h('div', { class: 'ffcam-guide-frame' },
    h('i', { class: 'ffcam-corner ffcam-corner--tl' }), h('i', { class: 'ffcam-corner ffcam-corner--tr' }),
    h('i', { class: 'ffcam-corner ffcam-corner--bl' }), h('i', { class: 'ffcam-corner ffcam-corner--br' }));
  const guide = h('div', { class: 'ffcam-guide', attrs: { 'aria-hidden': 'true' } }, guideFrame);
  const ring = h('div', { class: 'ffcam-ring', attrs: { 'aria-hidden': 'true' } });
  const statusPill = h('div', { class: 'ffcam-status', attrs: { role: 'status' } });
  const stripBox = h('div', { class: 'ffcam-strip', attrs: { 'aria-hidden': 'true' } });
  // Il conto alla rovescia lo annuncia già l'otturatore (regione live): qui solo per gli occhi.
  const countBox = h('div', { class: 'ffcam-count', attrs: { 'aria-hidden': 'true' } });
  const hint = h('div', { class: 'ffcam-hint' });
  const expoBox = h('div', { class: 'ffcam-expo' });
  const starting = h('div', { class: 'ffcam-starting' }, t('cam_starting'));

  const viewfinder = h('div', {
    class: 'ffcam-vf',
    attrs: { role: 'group', 'aria-label': t('cam_viewfinder_label') },
    onPointerdown: onVfPointerDown,
    onPointerup: onVfPointerUp,
    onPointercancel: () => { tapStart = null; },
  }, video, thermal, guide, ring, statusPill, stripBox, countBox, expoBox, hint, starting);
  const stage = h('div', { class: 'ffcam-stage' }, viewfinder);
  const errorBox = h('div', { class: 'ffcam-error' });
  errorBox.hidden = true;

  const pill = printerPill(printer.state, () => router.go('#/printer'));
  const torchBtn = camButton('bolt', () => toggleTorch());
  const timerBtn = camButton('timer', () => cycleTimer(), { badge: true });
  const expoBtn = camButton('sun', () => toggleExposurePanel());
  const thermalBtn = camButton('grain', () => settings.update((s) => ({ livePreview: !s.livePreview })));
  const errHistoryBtn = camButton('history', () => router.go('#/history'), { label: t('cam_cd_history') });
  const errSettingsBtn = camButton('settings', () => router.go('#/settings'), { label: t('cam_cd_settings') });
  const tools = h('div', { class: 'ffcam-tools' }, torchBtn.el, timerBtn.el, expoBtn.el, thermalBtn.el);
  const errTools = h('div', { class: 'ffcam-tools' }, errHistoryBtn.el, errSettingsBtn.el);
  const top = h('div', { class: 'ffcam-top' }, h('div', { class: 'ffcam-pill' }, pill.el), tools, errTools);

  const modeButtons = {
    photo: modeTab('photo', t('cam_mode_photo')),
    strip: modeTab('strip', t('cam_mode_strip')),
  };
  const historyBtn = camButton('history', () => router.go('#/history'), { label: t('cam_cd_history') });
  const settingsBtn = camButton('settings', () => router.go('#/settings'), { label: t('cam_cd_settings') });
  // Due pulsanti a interruttore (aria-pressed): non sono schede, non c'è un pannello da mostrare.
  const modes = h('div', { class: 'ffcam-modes' },
    historyBtn.el,
    h('div', { class: 'ffcam-tabs', attrs: { role: 'group', 'aria-label': t('cam_modes_label') } }, modeButtons.photo, modeButtons.strip),
    settingsBtn.el);

  const fileInput = h('input', {
    class: 'ffcam-file',
    attrs: { type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true' },
    onChange: onFilesPicked,
  });
  const galleryBtn = h('button', { class: 'ffcam-gallery', attrs: { type: 'button' }, onClick: openGallery }, icon('gallery', { size: 26 }));
  const shutter = shutterButton({ onClick: onShutter, busy: false, countdown: null });
  const shutterWrap = h('div', { class: 'ffcam-shutter' }, shutter.el);
  const switchBtn = camButton('switch', () => switchCamera(), { label: t('cam_cd_switch_camera'), large: true });
  const bottom = h('div', { class: 'ffcam-bottom' }, galleryBtn, shutterWrap, switchBtn.el);

  const flashEl = h('div', { class: 'ffcam-flash', attrs: { 'aria-hidden': 'true' } });
  // Il mirino è sempre scuro (ff-theme-dark dà ai componenti i colori del tema scuro).
  const screen = h('div', { class: 'ffcam ff-theme-dark' }, top, stage, errorBox, modes, bottom, fileInput, flashEl);
  root.append(screen);

  // --- collegamenti -------------------------------------------------------------------------
  cleanups.push(printer.subscribe((state) => {
    pill.set(state);
    printerProgress = state && state.kind === 'printing' ? Number(state.progress) || 0 : null;
    renderStatus();
  }));
  cleanups.push(settings.subscribe((next) => {
    const s = next && typeof next === 'object' ? next : settings.get();
    const before = lastSettings;
    lastSettings = s;
    if (s.livePreview !== before.livePreview) restartLive();
    if (s.template !== before.template) renderGuide();
    renderControls();
  }));
  const onInstantQueue = () => {
    renderStatus();
    renderControls();
  };
  instant.listeners.add(onInstantQueue);
  cleanups.push(() => instant.listeners.delete(onInstantQueue));

  const onVisibility = () => {
    if (document.hidden) {
      // Una sequenza a metà non ha senso, e la fotocamera si spegne (anche la torcia).
      cancelSequence();
      stopCamera();
      releaseWakeLock();
    } else {
      startCamera();
      acquireWakeLock();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const onVideoSize = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      videoAspect = video.videoWidth / video.videoHeight;
      layoutViewfinder();
    }
  };
  video.addEventListener('loadedmetadata', onVideoSize);
  video.addEventListener('resize', onVideoSize);

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => layoutViewfinder());
    ro.observe(stage);
    cleanups.push(() => ro.disconnect());
  }

  renderControls();
  renderStatus();
  layoutViewfinder();
  acquireWakeLock();
  startCamera();

  // ================================================================== fotocamera

  async function startCamera() {
    if (disposed || document.hidden) return;
    const token = ++startToken;
    ready = false;
    cameraError = null;
    starting.hidden = false;
    renderControls();
    try {
      await camera.start({ facing: camera.facing });
      if (disposed || token !== startToken) return;
      ready = true;
      caps = camera.capabilities;
      torchOn = false;
      // La compensazione scelta vive con il mirino: si rimette dopo ogni riaccensione.
      if (exposureEv !== 0 && caps.exposure) camera.setExposure(exposureEv).catch(() => {});
      else exposureEv = 0;
      onVideoSize();
      applyMirror();
      restartLive();
      const count = await countCameras();
      if (disposed || token !== startToken) return;
      canSwitch = count >= 2;
    } catch (e) {
      if (disposed || token !== startToken) return;
      console.warn('[camera] avvio fallito', e);
      cameraError = cameraFailureCode(e);
      ready = false;
      renderError();
    } finally {
      if (!disposed && token === startToken) {
        starting.hidden = true;
        renderControls();
      }
    }
  }

  function stopCamera() {
    startToken++;
    ready = false;
    torchOn = false;
    closeExposurePanel();
    stopLive();
    camera.stop();
    renderControls();
  }

  async function switchCamera() {
    if (!canSwitch || !ready || sequence || capturing || importing) return;
    // Un'altra fotocamera vede un'altra scena: compensazione e pannello ripartono da zero.
    exposureEv = 0;
    closeExposurePanel();
    const token = ++startToken;
    ready = false;
    renderControls();
    try {
      await camera.switchFacing();
      if (disposed || token !== startToken) return;
      ready = true;
      caps = camera.capabilities;
      torchOn = false;
      onVideoSize();
      applyMirror();
      restartLive();
    } catch (e) {
      if (disposed || token !== startToken) return;
      console.warn('[camera] cambio fotocamera fallito', e);
      cameraError = cameraFailureCode(e);
      renderError();
    } finally {
      if (!disposed && token === startToken) renderControls();
    }
  }

  /** La frontale si guarda allo specchio, come ogni app fotografica (lo scatto è già specchiato). */
  function applyMirror() {
    viewfinder.classList.toggle('ffcam-vf--mirror', camera.facing === 'user');
  }

  async function toggleTorch() {
    if (!ready || !caps.torch) return;
    const next = !torchOn;
    const ok = await camera.setTorch(next);
    if (ok && !disposed) {
      torchOn = next;
      renderControls();
    }
  }

  function cycleTimer() {
    if (sequence) return;
    settings.update((s) => {
      const i = TIMER_STEPS.indexOf(s.timerSeconds);
      return { timerSeconds: i < 0 ? TIMER_STEPS[0] : TIMER_STEPS[(i + 1) % TIMER_STEPS.length] };
    });
  }

  // --- anteprima termica -----------------------------------------------------------------

  function restartLive() {
    stopLive();
    const on = !!settings.get().livePreview && ready;
    thermal.hidden = !on;
    if (!on) return;
    try {
      liveStop = startThermalPreview(video, thermal, {
        getTone: () => settings.get().tone,
        getDither: () => settings.get().dither,
        mirror: () => camera.facing === 'user',
        getPrintAspect: () => guideAspect() || 0,
      });
    } catch (e) {
      console.warn('[camera] anteprima termica non avviata', e);
      thermal.hidden = true;
    }
  }

  function stopLive() {
    if (liveStop) {
      try {
        liveStop();
      } catch (e) {
        console.warn('[camera] arresto anteprima termica', e);
      }
    }
    liveStop = null;
  }

  // --- mirino e guida ----------------------------------------------------------------------

  /** Il mirino ha le proporzioni del video: mostra tutta la foto, la guida segna la parte stampata. */
  function layoutViewfinder() {
    // Spazio utile del palco, senza il padding: altrimenti max-width taglierebbe il mirino e lo
    // scatto (ritagliato come il mirino) non sarebbe più 3:4.
    const style = getComputedStyle(stage);
    const w = stage.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const hgt = stage.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
    if (!(w > 0 && hgt > 0)) return;
    const ar = videoAspect > 0 ? videoAspect : 3 / 4;
    let vw = w;
    let vh = w / ar;
    if (vh > hgt) {
      vh = hgt;
      vw = hgt * ar;
    }
    viewfinder.style.width = `${Math.floor(vw)}px`;
    viewfinder.style.height = `${Math.floor(vh)}px`;
    renderGuide();
  }

  /** Rapporto (larghezza/altezza) della parte che finisce sulla carta; null = tutta l'inquadratura. */
  function guideAspect() {
    if (mode === 'strip') return 4 / 3;
    const template = settings.get().template;
    if (template === 'POLAROID' || template === 'RECEIPT') return 1;
    if (template === 'STRIP') return 4 / 3;
    return 3 / 4;
  }

  /** Oscura ciò che la stampa taglierà e segna gli angoli della parte che finisce sulla carta. */
  function renderGuide() {
    const w = viewfinder.clientWidth;
    const hgt = viewfinder.clientHeight;
    const aspect = guideAspect();
    if (!(w > 0 && hgt > 0) || !aspect) {
      guide.hidden = true;
      return;
    }
    let gw = w;
    let gh = w / aspect;
    if (gh > hgt) {
      gh = hgt;
      gw = hgt * aspect;
    }
    // Tutta l'inquadratura (a meno di un pixel): niente guida, come il modello Pieno su Android.
    guide.hidden = w - gw < 2 && hgt - gh < 2;
    guideFrame.style.width = `${gw}px`;
    guideFrame.style.height = `${gh}px`;
    guideFrame.style.left = `${(w - gw) / 2}px`;
    guideFrame.style.top = `${(hgt - gh) / 2}px`;
  }

  // --- tocca per esporre -----------------------------------------------------------------

  let tapStart = null;

  function onVfPointerDown(e) {
    // I tocchi sui controlli sopra il mirino non contano.
    if (e.target.closest('button, input, .ffcam-expo')) {
      tapStart = null;
      return;
    }
    tapStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onVfPointerUp(e) {
    const start = tapStart;
    tapStart = null;
    if (!start || start.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return;
    if (!ready || capturing) return;
    const rect = viewfinder.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    showRing(x, y);
    const vr = video.getBoundingClientRect();
    if (vr.width > 0 && vr.height > 0) {
      camera.focusAt((e.clientX - vr.left) / vr.width, (e.clientY - vr.top) / vr.height).catch(() => {});
    }
    if (caps.exposure) openExposurePanel();
  }

  function showRing(x, y) {
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.classList.remove('ffcam-ring--on');
    // Riflusso forzato: l'animazione riparte a ogni tocco.
    void ring.offsetWidth;
    ring.classList.add('ffcam-ring--on');
  }

  // --- compensazione dell'esposizione ---------------------------------------------------

  function toggleExposurePanel() {
    if (exposurePanelOpen) closeExposurePanel();
    else openExposurePanel();
  }

  function openExposurePanel() {
    const range = caps.exposure;
    if (!range || !ready) return;
    exposurePanelOpen = true;
    clear(expoBox);
    // Il valore lo mostra lo slider stesso (format): niente doppioni nel pannello.
    const s = slider({
      label: t('cam_exposure_slider'),
      min: range.min,
      max: range.max,
      step: range.step,
      value: clampEv(exposureEv, range),
      format: (v) => evText(Number(v)),
      onInput: (v) => {
        const ev = clampEv(Number(v), range);
        if (!Number.isFinite(ev)) return;
        exposureEv = ev;
        camera.setExposure(ev).catch(() => {});
        armExposureTimer();
        renderControls();
      },
    });
    const auto = h('button', {
      class: 'ffcam-expo-auto',
      attrs: { type: 'button', 'aria-label': t('cam_cd_exposure_auto') },
      onClick: () => {
        exposureEv = 0;
        s.set(0);
        camera.setExposure(0).catch(() => {});
        armExposureTimer();
        renderControls();
      },
    }, t('cam_exposure_auto'));
    expoBox.append(h('span', { class: 'ffcam-expo-icon' }, icon('sun', { size: 18 })), h('div', { class: 'ffcam-expo-slider' }, s.el), auto);
    expoBox.classList.add('ffcam-expo--on');
    armExposureTimer();
    renderControls();
  }

  function closeExposurePanel() {
    exposurePanelOpen = false;
    clearTimeout(exposureTimer);
    exposureTimer = null;
    expoBox.classList.remove('ffcam-expo--on');
    clear(expoBox);
    renderControls();
  }

  function armExposureTimer() {
    clearTimeout(exposureTimer);
    exposureTimer = setTimeout(() => {
      // Mentre il dito o il fuoco sono sul pannello non si chiude.
      if (expoBox.matches(':hover, :focus-within')) armExposureTimer();
      else closeExposurePanel();
    }, EXPOSURE_PANEL_IDLE_MS);
  }

  function evText(ev) {
    const v = Math.round((Number(ev) || 0) * 10) / 10;
    if (v === 0) return t('cam_exposure_zero');
    return t('cam_exposure_value', `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}`);
  }

  // ================================================================== scatto

  function onShutter() {
    ensureAudio();
    if (countdown != null) {
      // Un tocco durante il conto alla rovescia (anche tra gli scatti della striscia) annulla.
      cancelSequence();
      return;
    }
    if (!ready || capturing || importing || sequence) return;
    const s = settings.get();
    if (s.instantPrint && mode === 'photo' && instant.pending >= MAX_QUEUED_PRINTS) {
      toast(t('cam_queue_full'));
      return;
    }
    const seq = makeSequence();
    sequence = seq;
    closeExposurePanel();
    renderControls();
    const run = mode === 'strip' ? takeStrip(seq, s) : takeSingle(seq, s);
    run.catch((e) => {
      if (!(e instanceof Cancelled)) console.error('[camera] sequenza interrotta', e);
    }).finally(() => {
      if (sequence === seq) sequence = null;
      if (!disposed) renderControls();
    });
  }

  function cancelSequence() {
    if (sequence) sequence.cancel();
    sequence = null;
    setCountdown(null);
  }

  async function takeSingle(seq, s) {
    if (s.timerSeconds > 0) await runCountdown(seq, s.timerSeconds, s.shutterSound);
    const photo = await shoot(seq, s.shutterSound);
    if (!photo) return;
    // Il download legge la foto subito (drawImage sincrono): poi la stampa può liberarla.
    if (s.autoDownloadCaptures) autoDownload(photo, new Date());
    if (s.instantPrint) enqueueInstantPrint([photo]);
    else if (!openEditor([photo], 'camera', null)) closePhotos([photo]);
  }

  async function takeStrip(seq, s) {
    const total = clamp(Math.round(Number(s.stripShots) || 3), MIN_STRIP_SHOTS, MAX_STRIP_SHOTS);
    const photos = [];
    const startedAt = new Date();
    const current = { total, thumbs: [] };
    let handedOver = false;
    strip = current;
    renderStrip();
    try {
      for (let i = 0; i < total; i++) {
        // Il primo conto usa il timer se è più lungo: il tempo di mettersi in posa.
        const seconds = i === 0 ? Math.max(STRIP_COUNTDOWN_SECONDS, s.timerSeconds) : STRIP_COUNTDOWN_SECONDS;
        await runCountdown(seq, seconds, s.shutterSound);
        // Uno scatto fallito non butta via la posa di tutti: si riprova una volta con un nuovo
        // 3-2-1; se fallisce ancora, le foto già fatte bastano per una striscia più corta.
        let photo = await shoot(seq, s.shutterSound);
        if (!photo) {
          await runCountdown(seq, STRIP_COUNTDOWN_SECONDS, s.shutterSound);
          photo = await shoot(seq, s.shutterSound);
        }
        if (!photo) {
          if (photos.length >= MIN_STRIP_SHOTS) {
            await seq.sleep(STRIP_REVEAL_MS);
            handedOver = openEditor(photos, 'camera', 'STRIP');
          }
          return;
        }
        photos.push(photo);
        if (s.autoDownloadCaptures) autoDownload(photo, startedAt, photos.length);
        current.thumbs.push(thumbnail(photo));
        renderStrip();
      }
      // Un attimo per vedere la striscia completa prima di passare all'editor.
      await seq.sleep(STRIP_REVEAL_MS);
      handedOver = openEditor(photos, 'camera', 'STRIP');
    } finally {
      // Striscia annullata o incompleta: le foto non vanno da nessuna parte, si liberano subito.
      if (!handedOver) closePhotos(photos);
      if (strip === current) strip = null;
      if (!disposed) renderStrip();
      for (const thumb of current.thumbs) {
        thumb.width = 0;
        thumb.height = 0;
      }
    }
  }

  async function runCountdown(seq, seconds, sound) {
    try {
      for (let remaining = seconds; remaining >= 1; remaining--) {
        if (seq.cancelled) throw new Cancelled();
        setCountdown(remaining);
        // Bip e vibrazione solo negli ultimi 3 secondi: con 10 s sarebbero un tormento.
        if (remaining <= 3) {
          if (sound) beep(remaining === 1);
          vibrate(12);
        }
        await seq.sleep(1000);
      }
    } finally {
      setCountdown(null);
    }
  }

  /** Uno scatto: lampo, suono, foto. null = fallito (l'utente è già avvisato). */
  async function shoot(seq, sound) {
    if (seq.cancelled) throw new Cancelled();
    setCapturing(true);
    try {
      flash();
      if (sound) playShutter();
      const photo = await camera.capture({ maxSide: MAX_PHOTO_SIDE });
      // Vibrazione a foto presa: durante l'esposizione la foto verrebbe mossa.
      vibrate(28);
      if (seq.cancelled) {
        closePhotos([photo]);
        throw new Cancelled();
      }
      return photo;
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      console.warn('[camera] scatto fallito', e);
      if (!disposed) toast(t('cam_error_capture'));
      return null;
    } finally {
      setCapturing(false);
    }
  }

  /** Passa le foto all'editor. → false se il mirino non c'è più (le foto restano al chiamante). */
  function openEditor(photos, source, template) {
    if (disposed) return false;
    session.set(photos, source, template);
    router.go('#/editor');
    return true;
  }

  /** "Salva gli scatti": sul web è un download del JPEG originale. */
  async function autoDownload(photo, date, shot = 0) {
    try {
      const [blob] = await jpegBlobs([photo]);
      const name = shot > 0
        ? `${exportFileName('fotoflash', '', date)}-${shot}.jpg`
        : exportFileName('fotoflash', 'jpg', date);
      downloadBlob(blob, name);
    } catch (e) {
      console.warn('[camera] download dello scatto fallito', e);
      toast(t('cam_download_failed'));
    }
  }

  // --- stampa istantanea -------------------------------------------------------------------

  /**
   * Le stampe istantanee escono una alla volta, nell'ordine degli scatti; il lavoro continua anche
   * se si esce dal mirino, e l'esito arriva comunque in un avviso.
   */
  function enqueueInstantPrint(photos) {
    instant.pending++;
    instantChanged();
    const job = instant.chain.then(() => printInstantly(photos));
    instant.chain = job.catch(() => {});
    job.then(
      (outcome) => reportOutcome(outcome),
      (e) => {
        console.error('[camera] stampa istantanea fallita', e);
        reportOutcome({ ok: false, failure: null, message: '' });
      },
    ).finally(() => {
      instant.pending = Math.max(0, instant.pending - 1);
      instantChanged();
    });
  }

  /**
   * Prima di comporre si aspetta che la stampante sia libera (il numero dello Scontrino si calcola
   * dopo che l'altra stampa ha preso il suo); se risponde "occupata" si riprova con lo stesso
   * rendering, così lo storico aggiorna la voce già creata invece di duplicarla. Alla fine (voce
   * già registrata) le foto si liberano: non le usa più nessuno.
   */
  async function printInstantly(photos) {
    try {
      await awaitPrinterIdle(printer, PRINTER_IDLE_WAIT_MS);
      let prepared;
      try {
        prepared = await prepare(ctx, { photos });
      } catch (e) {
        console.error('[camera] composizione della stampa istantanea fallita', e);
        return { ok: false, failure: 'RENDER_FAILED', message: '' };
      }
      const copies = settings.get().copies;
      for (let attempt = 1; ; attempt++) {
        const outcome = await printAndRecord(ctx, prepared, { copies });
        const busy = outcome && !outcome.ok && outcome.failure === 'BUSY';
        if (!busy || attempt >= BUSY_ATTEMPTS) return outcome;
        await wait(BUSY_RETRY_DELAY_MS);
        await awaitPrinterIdle(printer, PRINTER_IDLE_WAIT_MS);
      }
    } finally {
      closePhotos(photos);
    }
  }

  function reportOutcome(outcome) {
    if (outcome && outcome.ok) {
      vibrate(40);
      toast(t('cam_print_done'));
      if (disposed) return;
      showPrinted = true;
      clearTimeout(printedTimer);
      printedTimer = setTimeout(() => {
        showPrinted = false;
        if (!disposed) renderStatus();
      }, PRINTED_BADGE_MS);
      renderStatus();
      return;
    }
    const failure = outcome && outcome.failure;
    const text = t(FAILURE_TEXT[failure] || 'cam_print_failed_generic');
    // Composizione fallita o stampante occupata: la schermata della stampante non risolve nulla.
    const printerAction = failure !== 'RENDER_FAILED' && failure !== 'BUSY';
    toast(text, printerAction
      ? { actionText: t('cam_action_printer'), onAction: () => router.go('#/printer'), duration: 6000 }
      : { duration: 5000 });
  }

  // --- galleria e foto di esempio ------------------------------------------------------------

  function openGallery() {
    if (importing || sequence) return;
    // In modalità striscia si scelgono più foto: diventano i fotogrammi della striscia.
    fileInput.multiple = mode === 'strip';
    fileInput.value = '';
    fileInput.click();
  }

  async function onFilesPicked() {
    const files = Array.from(fileInput.files || []).slice(0, MAX_STRIP_SHOTS);
    fileInput.value = '';
    if (files.length === 0 || importing) return;
    importing = true;
    renderControls();
    try {
      const photos = await loadPhotos(files);
      if (!openEditor(photos, 'gallery', photos.length >= 2 ? 'STRIP' : null)) closePhotos(photos);
    } catch (e) {
      console.warn('[camera] import dalla galleria fallito', e);
      if (!disposed) toast(t('cam_error_import'));
    } finally {
      importing = false;
      if (!disposed) renderControls();
    }
  }

  async function useSample() {
    if (importing) return;
    importing = true;
    renderControls();
    try {
      const photo = await createSamplePhoto();
      if (!openEditor([photo], 'gallery', null)) closePhotos([photo]);
    } catch (e) {
      console.warn('[camera] foto di esempio non creata', e);
      if (!disposed) toast(t('cam_error_sample'));
    } finally {
      importing = false;
      if (!disposed) renderControls();
    }
  }

  // ================================================================== resa

  function setCapturing(on) {
    capturing = on;
    if (!disposed) renderControls();
  }

  function setCountdown(value) {
    countdown = value;
    if (disposed) return;
    clear(countBox);
    if (value != null) {
      countBox.append(...[
        h('div', { class: 'ffcam-count-num' }, String(value)),
        strip ? h('div', { class: 'ffcam-count-strip' }, t('cam_strip_progress', Math.min(strip.thumbs.length + 1, strip.total), strip.total)) : null,
        h('div', { class: 'ffcam-count-cancel' }, t('cam_tap_to_cancel')),
      ].filter(Boolean));
    }
    countBox.classList.toggle('ffcam-count--on', value != null);
    renderControls();
  }

  function renderControls() {
    if (disposed) return;
    const s = settings.get();
    const running = !!sequence;
    const busy = capturing || importing;
    const hasError = !!cameraError;
    screen.classList.toggle('ffcam--error', hasError);
    errorBox.hidden = !hasError;
    tools.hidden = hasError;
    errTools.hidden = !hasError;

    torchBtn.set({ hidden: !(ready && caps.torch), active: torchOn, label: t('cam_cd_torch', t(torchOn ? 'cam_torch_on' : 'cam_torch_off')) });
    const timer = Number(s.timerSeconds) || 0;
    timerBtn.set({
      active: timer > 0,
      disabled: running,
      badge: timer > 0 ? String(timer) : '',
      label: t('cam_cd_timer', timer > 0 ? t('cam_timer_seconds', timer) : t('cam_timer_off')),
    });
    expoBtn.set({
      hidden: !(ready && caps.exposure),
      active: exposurePanelOpen || exposureEv !== 0,
      label: t('cam_cd_exposure', evText(exposureEv)),
    });
    thermalBtn.set({
      active: !!s.livePreview,
      label: t('cam_cd_thermal', t(s.livePreview ? 'cam_state_on' : 'cam_state_off')),
    });
    switchBtn.set({ hidden: !canSwitch, disabled: !ready || running || busy });

    for (const name of ['photo', 'strip']) {
      const b = modeButtons[name];
      b.setAttribute('aria-pressed', String(mode === name));
      b.disabled = running || busy;
    }
    galleryBtn.disabled = running || busy;
    galleryBtn.setAttribute('aria-label', t(mode === 'strip' ? 'cam_cd_gallery_strip' : 'cam_cd_gallery'));
    galleryBtn.classList.toggle('ffcam-gallery--busy', importing);

    // Spento finché la fotocamera non è pronta; durante il conto alla rovescia resta toccabile (annulla).
    shutter.set({ busy, countdown, disabled: !ready && countdown == null });
    const queueFull = s.instantPrint && mode === 'photo' && instant.pending >= MAX_QUEUED_PRINTS;
    // Coda piena: l'otturatore resta toccabile (spiega di aspettare), solo attenuato.
    shutterWrap.classList.toggle('ffcam-shutter--dim', queueFull && countdown == null);

    const showHint = mode === 'strip' && !running && ready;
    hint.hidden = !showHint;
    if (showHint) {
      const shots = clamp(Math.round(Number(s.stripShots) || 3), MIN_STRIP_SHOTS, MAX_STRIP_SHOTS);
      hint.textContent = t('cam_strip_hint', shots);
    }
    renderStatus();
  }

  function renderStatus() {
    if (disposed) return;
    const s = settings.get();
    const pending = instant.pending;
    let kind = null;
    if (showPrinted) kind = 'printed';
    else if (pending > 0) kind = 'printing';
    else if (s.instantPrint && mode === 'photo' && !cameraError) kind = 'instant';
    const pct = kind === 'printing' && printerProgress != null ? Math.round(clamp(printerProgress, 0, 1) * 100) : null;
    // La pillola è una regione live: si ridisegna solo se cambia, altrimenti il lettore di
    // schermo ripeterebbe "stampa istantanea" a ogni secondo del conto alla rovescia.
    const key = `${kind}|${pct}|${kind === 'printing' ? pending : 0}`;
    if (key === statusKey) return;
    statusKey = key;
    clear(statusPill);
    statusPill.className = `ffcam-status${kind ? ` ffcam-status--${kind}` : ''}`;
    if (kind === 'printed') {
      statusPill.append(icon('check', { size: 16 }), h('span', {}, t('cam_printed')));
    } else if (kind === 'printing') {
      statusPill.append(...[
        h('span', { class: 'ffcam-spin' }),
        h('span', {}, pct != null ? t('cam_printing_percent', pct) : t('cam_printing')),
        pending > 1 ? h('span', { class: 'ffcam-queue' }, t('cam_printing_queue', pending - 1)) : null,
      ].filter(Boolean));
    } else if (kind === 'instant') {
      statusPill.append(icon('bolt', { size: 16 }), h('span', {}, t('cam_instant_print')));
    }
  }

  /** Striscia di carta che si riempie scatto dopo scatto, in bianco e nero come sarà stampata. */
  function renderStrip() {
    clear(stripBox);
    stripBox.classList.toggle('ffcam-strip--on', !!strip);
    if (!strip) return;
    for (let i = 0; i < strip.total; i++) {
      const thumb = strip.thumbs[i];
      const next = i === strip.thumbs.length;
      const cell = h('div', { class: `ffcam-strip-cell${next ? ' ffcam-strip-cell--next' : ''}` },
        thumb || h('span', {}, String(i + 1)));
      stripBox.append(cell);
    }
  }

  function renderError() {
    clear(errorBox);
    if (!cameraError) {
      renderControls();
      return;
    }
    stopLive();
    const info = CAMERA_ERRORS[cameraError] || { key: 'generic', retry: true };
    const sample = ghostButton(t('cam_err_sample'), { icon: 'sparkles', onClick: useSample });
    const gallery = info.retry
      ? ghostButton(t('cam_err_gallery'), { icon: 'gallery', onClick: openGallery })
      : flashButton(t('cam_err_gallery'), { icon: 'gallery', onClick: openGallery });
    const retry = info.retry
      ? flashButton(t('cam_err_retry'), { icon: 'camera', onClick: () => startCamera() })
      : null;
    errorBox.append(h('div', { class: 'ffcam-error-inner' },
      h('div', { class: 'ffcam-error-disc' }, icon('camera', { size: 52 })),
      h('h2', { class: 'ffcam-error-title' }, t(`cam_err_${info.key}_title`)),
      h('p', { class: 'ffcam-error-text' }, t(`cam_err_${info.key}_message`)),
      h('div', { class: 'ffcam-error-actions' }, retry, gallery, sample)));
    renderControls();
  }

  function modeTab(name, label) {
    return h('button', {
      class: 'ffcam-tab',
      attrs: { type: 'button', 'aria-pressed': String(name === mode) },
      onClick: () => {
        if (sequence || capturing || importing || mode === name) return;
        mode = name;
        renderGuide();
        renderControls();
      },
    }, h('span', { class: 'ffcam-tab-label' }, label), h('span', { class: 'ffcam-tab-dot' }));
  }

  /** Pulsante tondo su vetro scuro per i comandi del mirino; "active" lo accende di giallo. */
  function camButton(name, onClick, { label = '', badge = false, large = false } = {}) {
    const badgeEl = badge ? h('span', { class: 'ffcam-btn-badge' }) : null;
    const el = h('button', {
      class: `ffcam-btn${large ? ' ffcam-btn--large' : ''}`,
      attrs: { type: 'button', 'aria-label': label },
      onClick,
    }, icon(name, { size: large ? 28 : 24 }), badgeEl);
    return {
      el,
      set({ hidden, active, disabled, label: text, badge: badgeText } = {}) {
        if (hidden !== undefined) el.hidden = !!hidden;
        if (active !== undefined) {
          el.classList.toggle('ffcam-btn--active', !!active);
          el.setAttribute('aria-pressed', String(!!active));
        }
        if (disabled !== undefined) el.disabled = !!disabled;
        if (text !== undefined) el.setAttribute('aria-label', text);
        if (badgeEl && badgeText !== undefined) badgeEl.textContent = badgeText;
      },
    };
  }

  // ================================================================== feedback

  function flash() {
    flashEl.classList.remove('ffcam-flash--on');
    void flashEl.offsetWidth;
    flashEl.classList.add('ffcam-flash--on');
  }

  /** AudioContext creato al primo tocco dell'otturatore: i browser lo vogliono in un gesto. */
  function ensureAudio() {
    if (!settings.get().shutterSound) return null;
    try {
      if (!audio) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return null;
        audio = new AC();
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch {
      audio = null;
    }
    return audio;
  }

  /** "Clic" breve: rumore filtrato con un inviluppo secco, due colpi come lo specchio di una reflex. */
  function playShutter() {
    const ac = audio;
    if (!ac) return;
    try {
      const now = ac.currentTime;
      for (const [at, level] of [[0, 0.55], [0.07, 0.35]]) {
        const length = Math.floor(ac.sampleRate * 0.05);
        const buffer = ac.createBuffer(1, length, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
        const src = ac.createBufferSource();
        src.buffer = buffer;
        const filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2200;
        filter.Q.value = 0.7;
        const gain = ac.createGain();
        gain.gain.value = level;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ac.destination);
        src.start(now + at);
      }
    } catch {
      // Audio non disponibile: lo scatto vale lo stesso.
    }
  }

  /** Bip del conto alla rovescia; l'ultimo più acuto. */
  function beep(last) {
    const ac = audio;
    if (!ac) return;
    try {
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = last ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (last ? 0.22 : 0.12));
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      // niente bip
    }
  }

  /** Alle feste il telefono resta sul treppiede: lo schermo non deve spegnersi nel mirino. */
  async function acquireWakeLock() {
    try {
      if (wakeLock || !navigator.wakeLock || document.hidden) return;
      const lock = await navigator.wakeLock.request('screen');
      if (disposed) {
        lock.release().catch(() => {});
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } catch {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) lock.release().catch(() => {});
  }

  // ================================================================== smontaggio

  return function unmount() {
    disposed = true;
    cancelSequence();
    stopLive();
    startToken++;
    camera.stop();
    releaseWakeLock();
    clearTimeout(exposureTimer);
    clearTimeout(printedTimer);
    video.removeEventListener('loadedmetadata', onVideoSize);
    video.removeEventListener('resize', onVideoSize);
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.warn('[camera] pulizia', e);
      }
    }
    if (audio) audio.close().catch(() => {});
    audio = null;
    screen.remove();
  };
}

// ------------------------------------------------------------------ utilità

/** Sequenza annullabile: sleep() rifiuta subito con Cancelled quando si annulla. */
function makeSequence() {
  const waits = new Set();
  const seq = {
    cancelled: false,
    cancel() {
      seq.cancelled = true;
      for (const w of waits) {
        clearTimeout(w.timer);
        w.reject(new Cancelled());
      }
      waits.clear();
    },
    sleep(ms) {
      return new Promise((resolve, reject) => {
        if (seq.cancelled) {
          reject(new Cancelled());
          return;
        }
        const w = { reject, timer: 0 };
        w.timer = setTimeout(() => {
          waits.delete(w);
          resolve();
        }, ms);
        waits.add(w);
      });
    },
  };
  return seq;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Quante fotocamere vede il browser: decide se mostrare il pulsante di cambio. */
async function countCameras() {
  try {
    if (typeof CameraController.cameraCount === 'function') return await CameraController.cameraCount();
    const md = globalThis.navigator && globalThis.navigator.mediaDevices;
    if (!md || typeof md.enumerateDevices !== 'function') return 0;
    const devices = await md.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length;
  } catch {
    return 0;
  }
}

/**
 * Foto scelte dalla galleria, nell'ordine. Se una non si apre si liberano quelle già caricate:
 * meglio un avviso chiaro che una striscia con un buco.
 */
async function loadPhotos(files) {
  const photos = [];
  try {
    for (const file of files) photos.push(await loadImageFile(file, MAX_PHOTO_SIDE));
  } catch (e) {
    closePhotos(photos);
    throw e;
  }
  return photos;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function clampEv(ev, range) {
  const v = Number(ev);
  if (!Number.isFinite(v)) return 0;
  return clamp(v, range.min, range.max);
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // vibrazione non disponibile
  }
}

/** Miniatura in scala di grigi per la striscia nel mirino. */
function thumbnail(photo) {
  const w = THUMB_WIDTH;
  const hgt = Math.max(1, Math.round((w * photo.height) / Math.max(1, photo.width)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const g = canvas.getContext('2d');
  g.filter = 'grayscale(1)';
  g.drawImage(photo, 0, 0, w, hgt);
  return canvas;
}

function ensureStyle() {
  if (document.getElementById('ff-camera-style')) return;
  const style = document.createElement('style');
  style.id = 'ff-camera-style';
  style.textContent = CAMERA_CSS;
  document.head.append(style);
}

const CAMERA_CSS = `
.ffcam { position: relative; height: 100dvh; display: flex; flex-direction: column; background: var(--ff-night, #0E0C0A); color: var(--ff-paper, #FBF8F1);
  color-scheme: dark; overflow: hidden; touch-action: manipulation; -webkit-user-select: none; user-select: none;
  padding: var(--ff-safe-top, 0px) 0 var(--ff-safe-bottom, 0px); }
.ffcam [hidden] { display: none !important; }
.ffcam-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 64px; padding: 8px 12px; }
.ffcam-pill { min-width: 0; flex: 0 1 auto; overflow: hidden; }
.ffcam-tools { display: flex; gap: 6px; flex: none; }
.ffcam-btn { position: relative; width: 48px; height: 48px; flex: none; border: 0; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255, 255, 255, .1); color: #FBF8F1; cursor: pointer; transition: color .2s, background .2s, transform .1s; padding: 0; }
.ffcam-btn--large { width: 56px; height: 56px; }
.ffcam-btn:active { transform: scale(.94); }
.ffcam-btn--active { color: #FFCC00; }
.ffcam-btn:disabled { color: rgba(251, 248, 241, .32); cursor: default; }
.ffcam-btn:focus-visible, .ffcam-tab:focus-visible, .ffcam-gallery:focus-visible, .ffcam-expo-auto:focus-visible { outline: 3px solid #FFCC00; outline-offset: 2px; }
.ffcam-btn-badge { position: absolute; right: 2px; bottom: 2px; min-width: 18px; padding: 0 3px; border-radius: 9px; background: #FFCC00; color: #16130F;
  font: 700 11px/18px 'Space Mono', ui-monospace, monospace; }
.ffcam-btn-badge:empty { display: none; }
.ffcam-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 0 10px; }
.ffcam-vf { position: relative; overflow: hidden; border-radius: 28px; background: #000; width: 300px; height: 400px; max-width: 100%; max-height: 100%; }
.ffcam-video, .ffcam-thermal { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.ffcam-vf--mirror .ffcam-video { transform: scaleX(-1); }
.ffcam-thermal { image-rendering: pixelated; animation: ffcam-fade .22s ease-out; }
@keyframes ffcam-fade { from { opacity: 0; } to { opacity: 1; } }
.ffcam-guide { position: absolute; inset: 0; pointer-events: none; }
.ffcam-guide-frame { position: absolute; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .42); }
.ffcam-corner { position: absolute; width: 22px; height: 22px; border: 0 solid rgba(255, 255, 255, .85); }
.ffcam-corner--tl { left: 10px; top: 10px; border-left-width: 2.5px; border-top-width: 2.5px; border-top-left-radius: 4px; }
.ffcam-corner--tr { right: 10px; top: 10px; border-right-width: 2.5px; border-top-width: 2.5px; border-top-right-radius: 4px; }
.ffcam-corner--bl { left: 10px; bottom: 10px; border-left-width: 2.5px; border-bottom-width: 2.5px; border-bottom-left-radius: 4px; }
.ffcam-corner--br { right: 10px; bottom: 10px; border-right-width: 2.5px; border-bottom-width: 2.5px; border-bottom-right-radius: 4px; }
.ffcam-ring { position: absolute; width: 68px; height: 68px; margin: -34px 0 0 -34px; border: 2px solid #FFCC00; border-radius: 50%; opacity: 0; pointer-events: none; }
.ffcam-ring::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #FFCC00; }
.ffcam-ring--on { animation: ffcam-ring 1.1s ease-out forwards; }
@keyframes ffcam-ring { 0% { opacity: 1; transform: scale(1.5); } 35% { opacity: 1; transform: scale(1); } 75% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1); } }
.ffcam-status { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: none; align-items: center; gap: 6px; padding: 7px 12px;
  border-radius: 999px; font: 700 12px/16px 'Space Mono', ui-monospace, monospace; letter-spacing: .1em; white-space: nowrap; pointer-events: none; }
.ffcam-status--instant { display: inline-flex; background: #FFCC00; color: #16130F; }
.ffcam-status--printing { display: inline-flex; background: rgba(0, 0, 0, .62); color: #fff; }
.ffcam-status--printed { display: inline-flex; background: #22B89A; color: #16130F; }
.ffcam-queue { color: #FFCC00; }
.ffcam-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #FFCC00; border-right-color: transparent; animation: ffcam-spin .9s linear infinite; }
@keyframes ffcam-spin { to { transform: rotate(360deg); } }
.ffcam-strip { position: absolute; right: 12px; top: 50%; width: 70px; padding: 5px; display: flex; flex-direction: column; gap: 5px; background: #FBF8F1;
  border-radius: 4px; box-shadow: 0 6px 18px rgba(0, 0, 0, .45); transform: translate(140%, -50%); opacity: 0; transition: transform .3s ease, opacity .3s ease; pointer-events: none; }
.ffcam-strip--on { transform: translate(0, -50%); opacity: 1; }
.ffcam-strip-cell { aspect-ratio: 4 / 3; background: #EDE8DE; display: grid; place-items: center; overflow: hidden;
  font: 700 12px 'Space Mono', ui-monospace, monospace; color: rgba(74, 70, 64, .6); }
.ffcam-strip-cell--next { background: #FFCC00; color: #16130F; }
.ffcam-strip-cell canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
.ffcam-count { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; padding: 0 24px;
  pointer-events: none; text-align: center; }
.ffcam-count--on { display: flex; }
.ffcam-count-num { font-family: 'Righteous', system-ui, sans-serif; font-size: min(156px, 32vh); line-height: 1; color: #FFCC00;
  text-shadow: 0 6px 28px rgba(0, 0, 0, .55); animation: ffcam-pop .45s cubic-bezier(.34, 1.56, .64, 1); }
@keyframes ffcam-pop { from { transform: scale(.55); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.ffcam-count-strip { margin-top: 6px; font: 700 15px 'Space Mono', ui-monospace, monospace; letter-spacing: .1em; color: #FFCC00; text-shadow: 0 2px 8px rgba(0, 0, 0, .7); }
.ffcam-count-cancel { margin-top: 8px; font: 700 12px 'Space Mono', ui-monospace, monospace; letter-spacing: .1em; color: #fff; text-shadow: 0 2px 8px rgba(0, 0, 0, .7); }
.ffcam-hint { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); padding: 7px 12px; border-radius: 999px; background: rgba(0, 0, 0, .55);
  color: #fff; font: 700 12px/16px 'Space Mono', ui-monospace, monospace; letter-spacing: .1em; white-space: nowrap; pointer-events: none; }
.ffcam-expo { position: absolute; left: 12px; right: 12px; bottom: 12px; display: none; align-items: center; gap: 8px; padding: 6px 8px 6px 12px;
  border-radius: 18px; background: #FBF8F1; color: #16130F; box-shadow: 0 6px 18px rgba(0, 0, 0, .4); }
.ffcam-expo--on { display: flex; animation: ffcam-fade .16s ease-out; }
.ffcam-expo-icon { display: grid; place-items: center; flex: none; }
.ffcam-expo-slider { flex: 1; min-width: 0; }
.ffcam-expo-auto { flex: none; min-height: 40px; padding: 0 12px; border: 2px solid #16130F; border-radius: 999px; background: transparent; color: #16130F;
  font: 700 12px 'Space Mono', ui-monospace, monospace; letter-spacing: .08em; cursor: pointer; }
.ffcam-starting { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255, 255, 255, .7);
  font: 700 12px 'Space Mono', ui-monospace, monospace; letter-spacing: .1em; pointer-events: none; }
.ffcam-modes { display: flex; align-items: center; padding: 8px 16px; gap: 8px; }
.ffcam-tabs { flex: 1; display: flex; justify-content: center; gap: 6px; }
.ffcam-tab { display: flex; flex-direction: column; align-items: center; gap: 5px; min-height: 48px; padding: 8px 14px; border: 0; border-radius: 14px;
  background: transparent; color: rgba(255, 255, 255, .66); font: 700 13px 'Space Mono', ui-monospace, monospace; letter-spacing: .12em; cursor: pointer; }
.ffcam-tab[aria-pressed="true"] { color: #FFCC00; }
.ffcam-tab:disabled { color: rgba(255, 255, 255, .3); cursor: default; }
.ffcam-tab[aria-pressed="true"]:disabled { color: rgba(255, 204, 0, .6); }
.ffcam-tab-dot { width: 5px; height: 5px; border-radius: 50%; background: #FFCC00; transform: scale(0); transition: transform .2s; }
.ffcam-tab[aria-pressed="true"] .ffcam-tab-dot { transform: scale(1); }
.ffcam-bottom { display: flex; align-items: center; justify-content: space-between; padding: 4px 28px 18px; }
.ffcam-gallery { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; background: rgba(255, 255, 255, .1);
  border: 1.5px solid rgba(255, 255, 255, .55); color: #fff; cursor: pointer; padding: 0; }
.ffcam-gallery:disabled { border-color: rgba(255, 255, 255, .2); color: rgba(255, 255, 255, .32); cursor: default; }
.ffcam-gallery--busy > svg { animation: ffcam-spin 1s linear infinite; opacity: .6; }
.ffcam-shutter { transition: opacity .2s; }
.ffcam-shutter--dim { opacity: .4; }
.ffcam-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ffcam-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 5; }
.ffcam-flash--on { animation: ffcam-flash .32s ease-out; }
@keyframes ffcam-flash { from { opacity: .88; } to { opacity: 0; } }
.ffcam-error { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 24px 28px; }
.ffcam-error-inner { width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.ffcam-error-disc { width: 112px; height: 112px; border-radius: 50%; background: #FFCC00; color: #16130F; display: grid; place-items: center; }
.ffcam-error-title { margin: 24px 0 0; font-family: 'Righteous', system-ui, sans-serif; font-weight: 400; font-size: 26px; line-height: 1.2; color: #fff; }
.ffcam-error-text { margin: 12px 0 0; line-height: 1.5; color: rgba(255, 255, 255, .74); }
.ffcam-error-actions { margin-top: 32px; width: 100%; display: flex; flex-direction: column; gap: 12px; }
.ffcam-error-actions > * { width: 100%; }
.ffcam--error .ffcam-stage, .ffcam--error .ffcam-modes, .ffcam--error .ffcam-bottom { display: none; }
@media (prefers-reduced-motion: reduce) {
  .ffcam-flash--on { animation-duration: .01s; }
  .ffcam-count-num, .ffcam-ring--on, .ffcam-thermal, .ffcam-expo--on { animation: none; }
  .ffcam-ring--on { opacity: 1; }
  .ffcam-spin, .ffcam-gallery--busy > svg { animation: none; }
}
`;
