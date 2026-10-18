// Stampa dalla UI: il "coordinatore" (come PrintCoordinator.kt: richiesta, rendering, stampa,
// numerazione e storico) e il foglio che racconta lo stato reale della stampa.
// Lo usano editor, fotocamera (stampa istantanea) e dettaglio dello storico.

import { h as hRaw, clear, uniqueId } from './dom.js';
import { icon } from './icons.js';
import { sheet, flashButton, ghostButton, toast } from './components.js';
import { renderPrint } from '../render/renderer.js';
import { bitImageToCanvas, canvasToBlob, releaseCanvas } from '../render/bitmap.js';
import { toRgba } from '../core/bitimage.js';
import { Ble } from '../printer/ble.js';
import { downloadBlob, exportFileName } from '../media/export.js';
import { makeZip } from '../media/zip.js';
import { lang } from '../i18n/i18n.js';

/** Ink e Paper del brand: l'anteprima mostra i punti della stampa come inchiostro su carta. */
const INK = [0x16, 0x13, 0x0f, 255];
const PAPER = [0xfb, 0xf8, 0xf1, 255];

/** Qualità dei JPEG degli originali, come HistoryRepository su Android. */
const JPEG_QUALITY = 0.92;

/** h() senza figli vuoti: le viste costruiscono parti facoltative con null. */
function h(tag, props, ...children) {
  return hRaw(tag, props, ...children.flat().filter((c) => c != null && c !== false));
}

// ------------------------------------------------------------------ richiesta e rendering

/** Data e ora brevi nella lingua dell'app (es. "17/10/26, 14:32"). */
export function formatNow(date = new Date()) {
  try {
    return new Intl.DateTimeFormat(lang(), { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/**
 * Richiesta di stampa con i default delle impostazioni; i campi passati li sostituiscono.
 * Il numero c'è solo nello Scontrino e vale printCounter + 1: si consuma solo a stampa riuscita.
 */
export function buildRequest(settings, { photos, template, caption = '', tone, dither } = {}) {
  const s = settings.get();
  const kind = template || s.template || 'POLAROID';
  return {
    photos: [...(photos || [])],
    template: kind,
    paper: s.paper || 'MM58',
    dither: dither || s.dither || 'ATKINSON',
    tone: { ...(tone || s.tone) },
    texts: {
      caption: String(caption || '').trim(),
      eventTitle: String(s.eventTitle || '').trim(),
      hashtag: String(s.hashtag || '').trim(),
      dateText: s.showDate ? formatNow() : null,
      printNumber: s.showPrintNumber && kind === 'RECEIPT' ? (Number(s.printCounter) || 0) + 1 : null,
    },
  };
}

/** Testi localizzati che il renderer mette sulla carta (piede e numero dello Scontrino). */
export function printLabels(t) {
  return {
    footer: t('ed_footer_thanks'),
    printNumber: (n) => t('ed_print_number', String(n).padStart(4, '0')),
  };
}

/**
 * Compone una richiesta già pronta: → { bitImage, canvas: null }. Il canvas del renderer si
 * libera subito: le anteprime usano paperCanvas e gli slider ne produrrebbero uno a ogni ritocco.
 */
export async function composeRequest(ctx, request) {
  const rendered = await renderPrint({ ...request, labels: printLabels(ctx.t) });
  releaseCanvas(rendered.canvas);
  return { bitImage: rendered.bitImage, canvas: null };
}

/** Compone la stampa: { request, rendered: { bitImage } }. */
export async function prepare(ctx, options) {
  const request = buildRequest(ctx.settings, options);
  const rendered = await composeRequest(ctx, request);
  return { request, rendered };
}

/**
 * Stesso lavoro di stampa a meno del valore della data (cambia ogni minuto): "Riprova" riusa il
 * rendering già fatto, così sulla carta va la data dell'anteprima e lo storico non si duplica.
 */
export function sameJob(a, b) {
  if (!a || !b) return false;
  if (a.template !== b.template || a.paper !== b.paper || a.dither !== b.dither) return false;
  if (a.photos.length !== b.photos.length || a.photos.some((p, i) => p !== b.photos[i])) return false;
  if (JSON.stringify(a.tone) !== JSON.stringify(b.tone)) return false;
  const ta = a.texts;
  const tb = b.texts;
  return ta.caption === tb.caption && ta.eventTitle === tb.eventTitle && ta.hashtag === tb.hashtag &&
    (ta.dateText == null) === (tb.dateText == null) && ta.printNumber === tb.printNumber;
}

// ------------------------------------------------------------------ stampa e storico

/**
 * Riferimento debole al rendering, come la WeakReference di PrintCoordinator.kt: questi ricordi
 * vivono quanto la pagina e servono solo finché qualcuno (l'editor) tiene la stampa.
 */
function weakRef(value) {
  if (typeof WeakRef === 'function') return new WeakRef(value);
  return { deref: () => value };
}

/** Ultima stampa registrata nello storico: ritentarla aggiorna la voce invece di duplicarla. */
let lastRecorded = null; // { ref: WeakRef<rendered>, id, printed }
/** L'ultimo rendering che ha già consumato un numero: ristamparlo non ne consuma un altro. */
let lastNumbered = null; // WeakRef<rendered>
/** Le registrazioni passano una alla volta (stampa istantanea e editor possono incrociarsi). */
let recordChain = Promise.resolve();

/**
 * Stampa e registra nello storico in ogni caso (anche una stampa fallita resta ristampabile).
 * Il contatore avanza solo se la stampa è riuscita e portava un numero non ancora consumato.
 * Come PrintCoordinator.printAndRecord, l'esito arriva a voce registrata: chi chiama può poi
 * liberare le foto. → { ok: true, bytes, ms } | { ok: false, failure, message }
 */
export async function printAndRecord(ctx, prepared, { copies = 1, onProgress } = {}) {
  const { request, rendered } = prepared;
  const alreadyNumbered = !!lastNumbered && lastNumbered.deref() === rendered;
  let outcome;
  try {
    outcome = await ctx.printer.print(rendered.bitImage, { copies: Math.max(1, copies | 0), onProgress });
  } catch (e) {
    outcome = { ok: false, failure: 'WRITE_FAILED', message: errorText(e) };
  }
  if (!outcome || typeof outcome !== 'object') outcome = { ok: false, failure: null, message: '' };
  const printed = outcome.ok === true;
  if (printed && request.texts.printNumber != null && !alreadyNumbered) {
    try {
      await ctx.settings.nextPrintNumber();
      lastNumbered = weakRef(rendered);
    } catch (e) {
      // La carta è uscita: un errore delle impostazioni non la trasforma in un fallimento.
      console.warn('[fotoflash] contatore stampe non aggiornato', e);
    }
  }
  try {
    await record(ctx, prepared, printed);
  } catch (e) {
    // Idem per lo storico: conta l'esito della stampa.
    console.warn('[fotoflash] stampa non registrata nello storico', e);
  }
  return outcome;
}

/** Solo storico (es. "Salva" dall'editor): la voce resta da stampare. → id della voce */
export function saveOnly(ctx, prepared) {
  return record(ctx, prepared, false);
}

/** Si risolve quando le registrazioni nello storico chieste finora sono finite (anche male). */
export function recordsSettled() {
  return recordChain;
}

function record(ctx, prepared, printed) {
  const run = recordChain.then(() => recordNow(ctx, prepared, printed));
  recordChain = run.catch(() => {});
  return run;
}

async function recordNow(ctx, { request, rendered }, printed) {
  const last = lastRecorded;
  if (last && last.ref.deref() === rendered && last.id != null) {
    let exists = false;
    try {
      exists = !!(await ctx.history.get(last.id));
    } catch {
      exists = false;
    }
    if (exists) {
      if (printed && !last.printed) {
        await ctx.history.markPrinted(last.id);
        last.printed = true;
      }
      return last.id;
    }
  }
  const printPng = await pngBlob(rendered.bitImage, 1);
  const originals = await jpegBlobs(request.photos);
  const entry = await ctx.history.add({
    printPng,
    originals,
    template: request.template,
    caption: request.texts.caption,
    printNumber: request.texts.printNumber,
    printed,
  });
  const id = entry && typeof entry === 'object' ? entry.id : entry;
  lastRecorded = { ref: weakRef(rendered), id, printed };
  return id;
}

/** Aspetta (al massimo [timeoutMs]) che la stampante non stia collegandosi o stampando. */
export function awaitPrinterIdle(printer, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    unsubscribe = printer.subscribe((state) => {
      if (state && state.kind !== 'printing' && state.kind !== 'connecting') {
        // subscribe chiama subito: si esce al giro dopo, quando unsubscribe è assegnata.
        Promise.resolve().then(finish);
      }
    });
  });
}

// ------------------------------------------------------------------ immagini ed esportazione

/** Canvas inchiostro su carta, 1 px = 1 punto: l'anteprima WYSIWYG. */
export function paperCanvas(bitImage) {
  const canvas = document.createElement('canvas');
  canvas.width = bitImage.width;
  canvas.height = bitImage.height;
  const g = canvas.getContext('2d');
  const rgba = toRgba(bitImage, INK, PAPER);
  g.putImageData(new ImageData(rgba, bitImage.width, bitImage.height), 0, 0);
  return canvas;
}

/** PNG in bianco e nero della stampa; [scale] intera, ingrandita senza filtri. */
export async function pngBlob(bitImage, scale = 1) {
  const canvas = bitImageToCanvas(bitImage, scale);
  try {
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    releaseCanvas(canvas);
  }
}

/** Libera subito la memoria delle foto scartate (ImageBitmap.close); i canvas restano al GC. */
export function closePhotos(photos) {
  for (const photo of photos || []) {
    try {
      if (photo && typeof photo.close === 'function') photo.close();
    } catch {
      // già chiusa
    }
  }
}

/** JPEG (qualità 0.92) delle foto originali, nell'ordine. */
export async function jpegBlobs(photos) {
  const blobs = [];
  for (const photo of photos || []) {
    const canvas = document.createElement('canvas');
    canvas.width = photo.width;
    canvas.height = photo.height;
    canvas.getContext('2d').drawImage(photo, 0, 0);
    blobs.push(await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY));
    // Libera subito la memoria del canvas: le foto sono grandi.
    canvas.width = 0;
    canvas.height = 0;
  }
  return blobs;
}

/**
 * Scarica le foto originali: una sola come JPEG, più d'una in un unico ZIP (il browser
 * chiederebbe il permesso per ogni download in più). [date] dà il nome ai file.
 * → numero di foto scaricate
 */
export async function downloadOriginals(blobs, date = new Date()) {
  const list = (blobs || []).filter(Boolean);
  if (list.length === 0) return 0;
  if (list.length === 1) {
    downloadBlob(list[0], exportFileName('fotoflash-foto', 'jpg', date));
    return 1;
  }
  const base = exportFileName('fotoflash-foto', '', date);
  const zip = await makeZip(list.map((data, i) => ({ name: `${base}-${i + 1}.jpg`, data, date })));
  downloadBlob(zip, `${base}.zip`);
  return list.length;
}

export function errorText(e) {
  if (!e) return '';
  return String(e.message || e.name || e);
}

// ------------------------------------------------------------------ esiti

/**
 * Per ogni errore: chiave dei testi (ed_fail_<key>_title/_hint) e le azioni che lo risolvono
 * davvero, la prima è la principale. 'pair' abbina nel gesto, 'printer' apre la schermata.
 */
const FAILURES = {
  UNSUPPORTED: { key: 'unsupported', primary: 'close', secondary: 'printer' },
  NO_PRINTER: { key: 'no_printer', primary: 'pair', secondary: 'printer' },
  BLUETOOTH_OFF: { key: 'bluetooth_off', primary: 'retry', secondary: 'printer' },
  CONNECT_FAILED: { key: 'connect', primary: 'retry', secondary: 'printer' },
  WRITE_FAILED: { key: 'write', primary: 'retry', secondary: 'printer' },
  BUSY: { key: 'busy', primary: 'retry', secondary: 'printer' },
  // La stampante non c'entra: solo riprovare.
  RENDER_FAILED: { key: 'render', primary: 'retry', secondary: null },
  CAT_PRINTER: { key: 'cat_printer', primary: 'printer', secondary: 'close' },
  NO_CHANNEL: { key: 'no_channel', primary: 'retry', secondary: 'printer' },
};
const GENERIC_FAILURE = { key: 'generic', primary: 'retry', secondary: 'printer' };

export function failureInfo(failure) {
  return FAILURES[failure] || GENERIC_FAILURE;
}

// ------------------------------------------------------------------ foglio di stampa

/**
 * Apre il foglio di stampa e avvia il lavoro. Va chiamata DENTRO il gestore di un tocco: se la
 * stampante non è abbinata, pair() parte subito, nel gesto, come vuole Web Bluetooth.
 *
 * options:
 * - run({ onProgress }) → Promise<esito>: il lavoro (comporre, stampare, registrare);
 * - copies: copie richieste, per il testo dell'esito;
 * - onReprint({ onProgress }) → Promise<esito>: facoltativa, "Ristampa" dopo un successo;
 * - onNewPhoto(): facoltativa, "Nuova foto" dopo un successo (altrimenti "Chiudi");
 * - onDone(esito): facoltativa, chiamata a ogni esito.
 * → { close() }
 */
export function openPrintSheet(ctx, { run, copies = 1, onReprint = null, onNewPhoto = null, onDone = null } = {}) {
  const { t, printer } = ctx;
  ensureStyle();

  let closed = false;
  let phase = 'idle';
  let printerState = printer.state || { kind: 'not-paired' };
  let jobProgress = null;
  let memo = { printing: false, last: 0 };
  let running = null; // elementi della vista "in corso", aggiornati senza ricostruirla

  const body = h('div', { class: 'ffps', attrs: { 'aria-live': 'polite' } });
  const handle = sheet({
    title: t('ed_sheet_title'),
    content: body,
    onClose: () => {
      closed = true;
      cleanup();
    },
  });

  let unsubscribe = printer.subscribe((state) => {
    printerState = state || printerState;
    if (phase === 'running') updateRunning();
  });

  function cleanup() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
  }

  function close() {
    if (closed) return;
    closed = true;
    cleanup();
    handle.close();
  }

  function needsPair() {
    const s = printer.state || printerState;
    return !!s && (s.kind === 'not-paired' || (s.kind === 'error' && s.failure === 'NO_PRINTER'));
  }

  function isUnsupported() {
    const s = printer.state || printerState;
    return !!s && s.kind === 'unsupported';
  }

  /**
   * Avvio di un lavoro dal gesto: niente await prima di pair(). Con una stampante ricordata il
   * primo chooser mostra solo lei (come PrinterManager); "Abbina stampante" li mostra tutti.
   */
  function attempt(job) {
    if (isUnsupported()) {
      showResult({ ok: false, failure: 'UNSUPPORTED', message: '' }, job);
      return;
    }
    if (needsPair()) {
      const s = printer.state || printerState;
      pairThen(job, s && s.remembered && s.name ? { sameName: true } : undefined);
      return;
    }
    runJob(job);
  }

  function pairThen(job, opts) {
    showPairing();
    let pending;
    try {
      pending = printer.pair(opts);
    } catch (e) {
      showPair(job, e);
      return;
    }
    Promise.resolve(pending).then(
      () => {
        if (closed) return;
        if (isUnsupported()) {
          showResult({ ok: false, failure: 'UNSUPPORTED', message: '' }, job);
        } else if (needsPair()) {
          showPair(job, null);
        } else {
          runJob(job);
        }
      },
      (e) => {
        if (!closed) showPair(job, e);
      },
    );
  }

  async function runJob(job) {
    phase = 'running';
    jobProgress = null;
    memo = { printing: false, last: 0 };
    showRunning();
    let outcome;
    try {
      outcome = await job({
        onProgress: (p) => {
          jobProgress = clamp01(p);
          if (phase === 'running') updateRunning();
        },
      });
    } catch (e) {
      outcome = { ok: false, failure: null, message: errorText(e) };
    }
    if (!outcome || typeof outcome !== 'object') outcome = { ok: false, failure: null, message: '' };
    if (onDone) {
      try {
        onDone(outcome);
      } catch (e) {
        console.warn('[fotoflash] onDone', e);
      }
    }
    if (closed) {
      // Il foglio è stato chiuso durante l'invio: l'esito arriva comunque, in un avviso.
      notifyClosed(outcome);
      return;
    }
    showResult(outcome, job);
  }

  // ---------------------------------------------------------------- viste

  function setView(...children) {
    clear(body);
    for (const child of children) if (child) body.append(child);
  }

  function showPairing() {
    phase = 'pairing';
    setView(
      illustration({ paper: 0.06, led: 'idle' }),
      h('h3', { class: 'ffps-title' }, t('ed_sheet_pair_title')),
      h('p', { class: 'ffps-hint' }, t('ed_sheet_pairing')),
      h('div', { class: 'ffps-bar ffps-bar--indeterminate', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'ffps-bar-fill' })),
    );
  }

  /** Abbinamento non riuscito: chooser chiuso senza scegliere (niente errore) o errore vero. */
  function showPair(job, error) {
    phase = 'pair';
    const failed = !!error && safeCode(error) !== 'cancelled';
    const state = printer.state || printerState;
    const detail = failed
      ? errorText(error)
      : (state && state.kind === 'error' && state.message ? String(state.message) : '');
    setView(
      illustration({ paper: 0.06, led: 'idle' }),
      h('h3', { class: 'ffps-title' }, t('ed_sheet_pair_title')),
      h('p', { class: 'ffps-hint' }, t('ed_sheet_pair_hint')),
      h('p', { class: 'ffps-note' }, t(failed ? 'ed_sheet_pair_failed' : 'ed_sheet_pair_cancelled')),
      detail ? h('p', { class: 'ffps-detail' }, t('ed_sheet_detail', detail)) : null,
      actions([
        flashButton(t('ed_sheet_pair_action'), { icon: 'bluetooth', onClick: () => pairThen(job) }),
        ghostButton(t('ed_sheet_printer'), { icon: 'print', onClick: openPrinter }),
      ]),
    );
  }

  function showRunning() {
    const titleId = uniqueId('ffps-title');
    const title = h('h3', { class: 'ffps-title', id: titleId });
    const fill = h('span', { class: 'ffps-bar-fill' });
    // La barra prende il nome dal titolo, che dice cosa sta succedendo (collegamento, stampa…).
    const bar = h('div', {
      class: 'ffps-bar',
      attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-labelledby': titleId },
    }, fill);
    // La percentuale la legge già la barra (aria-valuenow): qui non deve riempire la regione live.
    const percent = h('p', { class: 'ffps-percent', attrs: { 'aria-hidden': 'true' } });
    const art = illustration({ paper: 0.06, led: 'busy' });
    running = { title, bar, fill, percent, art };
    setView(art, title, bar, percent, h('p', { class: 'ffps-hint' }, t('ed_sheet_keep_close')));
    updateRunning();
  }

  function updateRunning() {
    if (!running) return;
    const s = printerState || {};
    const printing = s.kind === 'printing';
    if (printing) {
      memo.printing = true;
      memo.last = clamp01(jobProgress ?? s.progress ?? memo.last);
    } else if (jobProgress != null && jobProgress > 0) {
      memo.printing = true;
      memo.last = jobProgress;
    }
    // Byte tutti inviati, la stampante torna pronta: restano solo contatore e storico.
    const finishing = memo.printing && s.kind === 'ready';
    let title;
    if (s.kind === 'connecting') title = s.name ? t('ed_sheet_connecting', s.name) : t('ed_sheet_connecting_generic');
    else if (finishing) title = t('ed_sheet_finishing');
    else if (memo.printing) title = t('ed_sheet_printing');
    else title = t('ed_sheet_preparing');
    running.title.textContent = title;

    const sending = memo.printing;
    const progress = finishing ? 1 : memo.last;
    running.bar.classList.toggle('ffps-bar--indeterminate', !sending);
    if (sending) {
      const pct = Math.round(progress * 100);
      running.fill.style.width = `${pct}%`;
      running.bar.setAttribute('aria-valuenow', String(pct));
      running.percent.textContent = t('ed_sheet_percent', pct);
    } else {
      running.fill.style.width = '';
      running.bar.removeAttribute('aria-valuenow');
      running.percent.textContent = '';
    }
    setPaper(running.art, sending ? 0.12 + 0.88 * progress : 0.06);
  }

  function showResult(outcome, job) {
    running = null;
    if (outcome.ok) {
      phase = 'done';
      vibrate(40);
      const main = onNewPhoto
        ? flashButton(t('ed_sheet_new_photo'), { icon: 'camera', onClick: () => { close(); onNewPhoto(); } })
        : flashButton(t('ed_sheet_close'), { icon: 'check', onClick: close });
      const again = onReprint
        ? ghostButton(t('ed_sheet_reprint'), { icon: 'print', onClick: () => attempt(onReprint) })
        : null;
      const art = illustration({ paper: 0.7, led: 'ok', badge: 'ok' });
      setView(
        art,
        h('h3', { class: 'ffps-title ffps-title--big' }, t('ed_sheet_done')),
        h('p', { class: 'ffps-hint' }, t('ed_sheet_done_hint')),
        copies > 1 ? h('p', { class: 'ffps-copies' }, t('ed_copies_other', copies)) : null,
        actions([main, again]),
      );
      // Il foglio finisce di uscire anche se l'ultima percentuale vista era sotto il 100%.
      requestAnimationFrame(() => setPaper(art, 1));
      return;
    }
    phase = 'failed';
    vibrate([30, 60, 30]);
    const info = failureInfo(outcome.failure);
    const handlers = {
      retry: () => attempt(job),
      pair: () => pairThen(job),
      printer: openPrinter,
      close,
    };
    const labels = {
      retry: ['ed_sheet_retry', 'print'],
      pair: ['ed_sheet_pair_action', 'bluetooth'],
      printer: ['ed_sheet_printer', 'settings'],
      close: ['ed_sheet_close', 'close'],
    };
    const make = (action, primary) => {
      if (!action) return null;
      const [key, ic] = labels[action];
      const opts = { icon: ic, onClick: handlers[action] };
      return primary ? flashButton(t(key), opts) : ghostButton(t(key), opts);
    };
    const message = String(outcome.message || '').trim();
    setView(
      // Composizione fallita: la stampantina resta serena, il problema non è suo.
      illustration({ paper: 0.18, led: outcome.failure === 'RENDER_FAILED' ? 'busy' : 'error', badge: 'error' }),
      h('h3', { class: 'ffps-title' }, t(`ed_fail_${info.key}_title`)),
      h('p', { class: 'ffps-hint' }, t(`ed_fail_${info.key}_hint`)),
      // Il dettaglio tecnico resta visibile, in piccolo: serve a chi aiuta a capire il problema.
      message ? h('p', { class: 'ffps-detail' }, t('ed_sheet_detail', message)) : null,
      actions([make(info.primary, true), make(info.secondary, false)]),
    );
  }

  function notifyClosed(outcome) {
    if (outcome.ok) {
      toast(`${t('ed_sheet_done')} ${t('ed_sheet_done_hint')}`);
      return;
    }
    const info = failureInfo(outcome.failure);
    const fixable = outcome.failure !== 'RENDER_FAILED' && outcome.failure !== 'BUSY';
    toast(t(`ed_fail_${info.key}_title`), fixable
      ? { actionText: t('ed_sheet_printer'), onAction: () => ctx.router.go('#/printer') }
      : {});
  }

  function openPrinter() {
    close();
    ctx.router.go('#/printer');
  }

  attempt(run);
  return { close };
}

function safeCode(error) {
  try {
    return Ble.errorCode(error);
  } catch {
    return 'unknown';
  }
}

function actions(buttons) {
  const list = buttons.filter(Boolean);
  if (list.length === 0) return null;
  const box = h('div', { class: 'ffps-actions' });
  for (const b of list) box.append(b);
  return box;
}

/** Una stampantina stilizzata da cui esce il foglio retinato. */
function illustration({ paper = 0, led = 'idle', badge = null }) {
  const sheetEl = h('div', { class: 'ffps-paper' }, h('div', { class: 'ffps-paper-photo' }), h('div', { class: 'ffps-paper-line' }), h('div', { class: 'ffps-paper-line ffps-paper-line--short' }));
  const box = h('div', { class: `ffps-art ffps-art--${led}`, attrs: { 'aria-hidden': 'true' } },
    badge === 'ok' ? h('div', { class: 'ffps-burst' }) : null,
    sheetEl,
    h('div', { class: 'ffps-body' }, h('span', { class: 'ffps-slot' }), h('span', { class: 'ffps-led' })),
    badge ? h('div', { class: `ffps-badge ffps-badge--${badge}` }, icon(badge === 'ok' ? 'check' : 'close', { size: 28 })) : null,
  );
  setPaper(box, paper);
  return box;
}

function setPaper(art, fraction) {
  const paper = art && art.querySelector('.ffps-paper');
  if (paper) paper.style.height = `${Math.round(clamp01(fraction) * 100)}%`;
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // Vibrazione non disponibile: niente di grave.
  }
}

function ensureStyle() {
  if (document.getElementById('ff-print-sheet-style')) return;
  const style = document.createElement('style');
  style.id = 'ff-print-sheet-style';
  style.textContent = SHEET_CSS;
  document.head.append(style);
}

const SHEET_CSS = `
.ffps { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 4px 4px 8px; }
.ffps-title { margin: 8px 0 0; font-family: 'Righteous', system-ui, sans-serif; font-weight: 400; font-size: 24px; line-height: 1.2; }
.ffps-title--big { font-size: 30px; }
.ffps-hint { margin: 0; opacity: .78; max-width: 34em; line-height: 1.45; }
.ffps-note { margin: 4px 0 0; font-weight: 600; max-width: 34em; }
.ffps-detail { margin: 4px 0 0; font-family: 'Space Mono', ui-monospace, monospace; font-size: 12px; opacity: .7; max-width: 34em; overflow-wrap: anywhere; }
.ffps-copies { margin: 0; font-family: 'Space Mono', ui-monospace, monospace; font-weight: 700; }
.ffps-percent { margin: 0; min-height: 1.4em; font-family: 'Space Mono', ui-monospace, monospace; font-size: 18px; font-weight: 700; }
.ffps-actions { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 420px; margin-top: 16px; }
.ffps-actions > * { width: 100%; }
.ffps-bar { position: relative; width: 100%; max-width: 420px; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(127,127,127,.25); margin-top: 8px; }
.ffps-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: currentColor; border-radius: 3px; transition: width .25s ease; }
.ffps-bar--indeterminate .ffps-bar-fill { width: 35%; animation: ffps-slide 1.2s ease-in-out infinite; transition: none; }
@keyframes ffps-slide { 0% { left: -35%; } 100% { left: 100%; } }
.ffps-art { position: relative; width: 220px; height: 156px; margin: 4px auto 0; }
.ffps-body { position: absolute; left: 35px; top: 4px; width: 150px; height: 46px; border-radius: 16px; background: currentColor; z-index: 2; }
.ffps-slot { position: absolute; left: 11px; right: 11px; bottom: 12px; height: 4px; border-radius: 2px; background: rgba(127,127,127,.55); }
.ffps-led { position: absolute; right: 14px; top: 12px; width: 8px; height: 8px; border-radius: 50%; background: #FFCC00; }
.ffps-art--ok .ffps-led { background: #22B89A; }
.ffps-art--error .ffps-led { background: #FF5B45; }
.ffps-art--busy .ffps-led { animation: ffps-blink 1s steps(2, start) infinite; }
@keyframes ffps-blink { to { visibility: hidden; } }
.ffps-paper { position: absolute; left: 58px; top: 44px; width: 104px; max-height: 108px; height: 0; overflow: hidden; background: #FBF8F1; color: #16130F;
  box-shadow: inset 0 0 0 1px rgba(22,19,15,.22); transition: height .45s ease; z-index: 1;
  -webkit-mask: linear-gradient(#000 0 0) top / 100% calc(100% - 4px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 8px 4px repeat-x;
          mask: linear-gradient(#000 0 0) top / 100% calc(100% - 4px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 8px 4px repeat-x; }
.ffps-paper-photo { margin: 12px 12px 0; height: 46px; background-image: radial-gradient(circle, #16130F 38%, transparent 42%); background-size: 4px 4px; }
.ffps-paper-line { margin: 10px auto 0; width: 60%; height: 3px; border-radius: 2px; background: #16130F; }
.ffps-paper-line--short { margin-top: 5px; width: 40%; }
.ffps-badge { position: absolute; right: 30px; bottom: 8px; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; color: #16130F; z-index: 3;
  animation: ffps-pop .5s cubic-bezier(.34,1.56,.64,1) both; }
.ffps-badge--ok { background: #22B89A; }
.ffps-badge--error { background: #FF5B45; }
@keyframes ffps-pop { from { transform: scale(0); } to { transform: scale(1); } }
.ffps-burst { position: absolute; inset: 0; z-index: 0; opacity: .9;
  background-image: radial-gradient(circle, #FFCC00 30%, transparent 34%); background-size: 12px 12px;
  -webkit-mask: radial-gradient(circle at 50% 55%, #000 0 30%, transparent 70%); mask: radial-gradient(circle at 50% 55%, #000 0 30%, transparent 70%); }
@media (prefers-reduced-motion: reduce) {
  .ffps-paper, .ffps-bar-fill { transition: none; }
  .ffps-bar--indeterminate .ffps-bar-fill, .ffps-art--busy .ffps-led, .ffps-badge { animation: none; }
}
`;
