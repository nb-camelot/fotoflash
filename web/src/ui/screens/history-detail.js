// Dettaglio di una stampa dello storico (porting di HistoryDetailScreen.kt): anteprima, dati in
// stile scontrino, Ristampa (dalla PNG a 1 bit, senza ricomporre e senza consumare numeri),
// Condividi, Salva stampa, Salva foto (originali) ed Elimina con conferma.

import { h as hRaw, clear } from '../dom.js';
import { icon } from '../icons.js';
import { topBar, flashButton, ghostButton, paperSheet, thermalImage, emptyState, confirmDialog, toast } from '../components.js';
import { bitImageFromRgba } from '../../core/bitimage.js';
import { PaperWidth } from '../../core/model.js';
import { releaseCanvas } from '../../render/bitmap.js';
import { shareFiles, downloadBlob, exportFileName } from '../../media/export.js';
import { lang } from '../../i18n/i18n.js';
import { openPrintSheet, paperCanvas, pngBlob, downloadOriginals } from '../print-sheet.js';

const TEMPLATE_LABELS = {
  POLAROID: 'hist_template_polaroid',
  FULL: 'hist_template_full',
  STRIP: 'hist_template_strip',
  RECEIPT: 'hist_template_receipt',
};

/** Larghezza massima dell'anteprima (CSS px), la stessa dell'editor. */
const PREVIEW_MAX_CSS = 640;

/** h() senza figli vuoti: le parti facoltative si passano come null. */
function h(tag, props, ...children) {
  return hRaw(tag, props, ...children.flat().filter((c) => c != null && c !== false));
}

export function mount(root, ctx, params) {
  ensureStyle();
  const { t, history, settings, router, printer } = ctx;
  const id = entryIdFrom(params);
  let disposed = false;
  let entry = null;
  let bitImage = null;
  let previewState = 'loading'; // 'loading' | 'ready' | 'failed'
  let deleting = false;
  let sheetHandle = null;
  /** Anteprima della stampa: si disegna una volta sola, i ridisegni del dettaglio la riusano. */
  let previewCanvas = null;
  const busy = new Set();

  // Barra creata una volta: il router ci mette il fuoco, cambiarle solo il titolo non lo perde.
  const bar = topBar({ title: t('hist_detail_title'), onBack: () => router.back() });
  const body = h('div', { class: 'ffhd-body' });
  const screen = h('div', { class: 'ffhd' }, bar, body);
  root.append(screen);
  renderTop();
  renderLoading();

  let resizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => fitPreview());
    resizeObserver.observe(body);
  }

  const unsubscribe = history.subscribe((list) => {
    if (disposed || deleting) return;
    // Un avviso senza l'elenco: si rilegge la voce invece di darla per eliminata.
    if (!Array.isArray(list)) {
      refreshEntry();
      return;
    }
    const found = list.find((e) => e.id === id) || null;
    if (!found) {
      // Eliminata altrove (un'altra scheda): niente pulsanti su una voce che non c'è più.
      if (entry) {
        entry = null;
        renderNotFound();
      }
      return;
    }
    const statusChanged = !entry || entry.printed !== found.printed;
    entry = found;
    if (statusChanged && previewState !== 'loading') renderDetail();
  });

  load();

  async function refreshEntry() {
    let found = null;
    try {
      found = await history.get(id);
    } catch (e) {
      console.warn('[history] voce non riletta', e);
      return;
    }
    if (disposed || deleting) return;
    if (!found) {
      if (entry) {
        entry = null;
        renderNotFound();
      }
      return;
    }
    const statusChanged = !entry || entry.printed !== found.printed;
    entry = found;
    if (statusChanged && previewState !== 'loading') renderDetail();
  }

  async function load() {
    try {
      entry = id ? await history.get(id) : null;
    } catch (e) {
      console.warn('[history] voce non letta', e);
      entry = null;
    }
    if (disposed) return;
    if (!entry) {
      renderNotFound();
      return;
    }
    renderTop();
    renderDetail();
    try {
      const blob = await history.printBlob(id);
      if (!blob) throw new Error('stampa mancante');
      bitImage = await decodePrint(blob);
      previewState = 'ready';
    } catch (e) {
      console.warn('[history] stampa illeggibile', e);
      bitImage = null;
      previewState = 'failed';
    }
    if (!disposed && entry) renderDetail();
  }

  // ---------------------------------------------------------------- viste

  function renderTop() {
    const title = entry ? t(TEMPLATE_LABELS[entry.template] || 'hist_detail_title') : t('hist_detail_title');
    if (typeof bar.setTitle === 'function') bar.setTitle(title);
  }

  function renderLoading() {
    clear(body);
    body.append(h('div', { class: 'ffhd-center', attrs: { role: 'status' } }, h('span', { class: 'ffhd-spinner' })));
  }

  function renderNotFound() {
    renderTop();
    clear(body);
    body.append(h('div', { class: 'ffhd-center' }, emptyState({
      icon: 'image',
      title: t('hist_not_found_title'),
      message: t('hist_not_found_message'),
      actionText: t('hist_back'),
      onAction: () => router.go('#/history'),
    })));
  }

  function renderDetail() {
    if (!entry) return;
    // Il dettaglio si ridisegna a ogni azione: il fuoco torna sul pulsante equivalente.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const focusedAction = active && body.contains(active) && active.dataset ? active.dataset.action || null : null;
    clear(body);
    const count = Number(entry.photoCount) || 0;

    let preview;
    if (previewState === 'ready' && bitImage) {
      if (!previewCanvas) previewCanvas = paperCanvas(bitImage);
      preview = thermalImage(previewCanvas, { label: t('hist_preview_cd') });
    } else if (previewState === 'failed') {
      preview = h('div', { class: 'ffhd-ph ffhd-ph--failed' }, icon('warning', { size: 40 }), h('p', {}, t('hist_msg_load_failed')));
    } else {
      preview = h('div', { class: 'ffhd-ph' }, h('span', { class: 'ffhd-spinner' }));
    }
    const sheetEl = paperSheet(preview);
    sheetEl.classList.add('ffhd-sheet');

    // Dati della stampa in stile scontrino: etichetta a sinistra, valore a destra, righe tratteggiate.
    const rows = [
      [t('hist_label_date'), formatDate(entry.createdAt)],
      [t('hist_label_template'), t(TEMPLATE_LABELS[entry.template] || 'hist_template_polaroid')],
      // Dice cosa salva "Salva foto": gli originali a colori, non l'immagine della stampa.
      count > 0 ? [t('hist_label_photos'), t(count === 1 ? 'hist_photos_value_one' : 'hist_photos_value_other', count)] : null,
      entry.caption && entry.caption.trim() ? [t('hist_label_caption'), entry.caption] : null,
      entry.printNumber != null ? [t('hist_label_number'), t('hist_print_number', String(entry.printNumber).padStart(4, '0'))] : null,
      [t('hist_label_status'), t(entry.printed ? 'hist_status_printed' : 'hist_status_saved'), !entry.printed],
    ].filter(Boolean);
    const info = h('dl', { class: 'ffhd-info' }, rows.map(([label, value, warn]) => h('div', { class: 'ffhd-row' },
      h('dt', {}, label),
      h('dd', { class: warn ? 'ffhd-warn' : null }, value))));

    const loadingPrint = previewState !== 'ready';
    // Un'azione in corso è "busy" (visibile, non risponde) e non disabled: così tiene il fuoco.
    const reprint = flashButton(t('hist_action_reprint'), {
      icon: 'print',
      onClick: onReprint,
      busy: busy.has('print'),
      disabled: deleting || loadingPrint,
    });
    // "Salva foto" (gli originali a colori) sta da solo e prima di "Salva stampa" (il bianco e
    // nero da scontrino): sono due cose diverse e non si devono confondere.
    const savePhotos = count > 0
      ? ghostButton(t('hist_action_save_photos'), { icon: 'gallery', onClick: onSavePhotos, busy: busy.has('photos'), disabled: deleting })
      : null;
    const savePrint = ghostButton(t('hist_action_save'), { icon: 'download', onClick: onSavePrint, busy: busy.has('save'), disabled: deleting || loadingPrint });
    const share = ghostButton(t('hist_action_share'), { icon: 'share', onClick: onShare, busy: busy.has('share'), disabled: deleting || loadingPrint });
    const del = h('button', {
      class: 'ffhd-delete',
      attrs: { type: 'button' },
      onClick: onDelete,
      // Mentre si scaricano le foto, eliminarle le farebbe sparire a metà.
      disabled: deleting || busy.has('print') || busy.has('photos'),
    }, icon('trash', { size: 18 }), h('span', {}, t('hist_action_delete')));
    const actionsByName = { print: reprint, photos: savePhotos, save: savePrint, share, delete: del };
    for (const [name, el] of Object.entries(actionsByName)) if (el) el.dataset.action = name;

    body.append(
      h('div', { class: 'ffhd-content' },
        sheetEl,
        info,
        h('div', { class: 'ffhd-actions' },
          reprint,
          savePhotos,
          h('div', { class: 'ffhd-pair' }, savePrint, share),
          del)),
    );
    fitPreview();
    const again = focusedAction && actionsByName[focusedAction];
    if (again && !again.disabled) {
      try {
        again.focus({ preventScroll: true });
      } catch {
        // non focalizzabile
      }
    }
  }

  /**
   * Scala INTERA in pixel del dispositivo, come l'anteprima dell'editor: ogni punto della testina
   * diventa N x N pixel e il retino non si deforma. Su schermi a bassa densità ripiega sul 100%.
   */
  function fitPreview() {
    const canvas = previewCanvas;
    const sheetEl = canvas && canvas.isConnected ? canvas.closest('.ffhd-sheet') : null;
    const content = sheetEl && sheetEl.parentElement;
    if (!content) return;
    const cs = getComputedStyle(content);
    const ss = getComputedStyle(sheetEl);
    const chrome = px(ss.paddingLeft) + px(ss.paddingRight) + px(ss.borderLeftWidth) + px(ss.borderRightWidth);
    const room = content.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight) - chrome;
    const dots = canvas.width;
    if (!(room > 0) || !(dots > 0)) return;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    let k = Math.floor((room * dpr) / dots);
    // Stesso limite dell'editor: oltre, il foglio diventerebbe un poster.
    while (k > 1 && (dots * k) / dpr > PREVIEW_MAX_CSS) k--;
    if (k < 1) {
      canvas.style.width = '';
      sheetEl.style.width = '';
      sheetEl.style.maxWidth = '';
      return;
    }
    const cssWidth = (dots * k) / dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.maxWidth = '100%';
    sheetEl.style.width = `${ss.boxSizing === 'border-box' ? cssWidth + chrome : cssWidth}px`;
    // La larghezza esatta vince sul tetto del CSS (380 px), che vale solo per il ripiego al 100%.
    sheetEl.style.maxWidth = '100%';
  }

  // ---------------------------------------------------------------- azioni

  function begin(action) {
    if (deleting || busy.has(action)) return false;
    busy.add(action);
    renderDetail();
    return true;
  }

  function end(action) {
    busy.delete(action);
    if (!disposed && entry) renderDetail();
  }

  /** Ristampa dal gesto: la stessa carta, senza ricomporre e senza consumare un altro numero. */
  function onReprint() {
    if (!entry || !bitImage || busy.has('print') || deleting) return;
    // Una stampa più larga della carta impostata uscirebbe a righe spezzate: si dice cosa fare.
    const paper = PaperWidth[settings.get().paper] || PaperWidth.MM58;
    if (bitImage.width > paper.dots) {
      const match = Object.values(PaperWidth).find((p) => p.dots === bitImage.width);
      toast(match ? t('hist_msg_paper_mismatch', match.mm) : t('hist_msg_paper_mismatch_generic'), {
        actionText: t('hist_fix_printer'),
        onAction: () => router.go('#/printer'),
        duration: 6000,
      });
      return;
    }
    const image = bitImage;
    const entryId = entry.id;
    const run = async ({ onProgress }) => {
      busy.add('print');
      if (!disposed) renderDetail();
      try {
        let outcome;
        try {
          outcome = await printer.print(image, { copies: 1, onProgress });
        } catch (e) {
          outcome = { ok: false, failure: 'WRITE_FAILED', message: String((e && e.message) || e || '') };
        }
        if (outcome && outcome.ok) {
          try {
            await history.markPrinted(entryId);
          } catch (e) {
            console.warn('[history] stato "stampata" non salvato', e);
          }
        }
        return outcome;
      } finally {
        end('print');
      }
    };
    sheetHandle = openPrintSheet(ctx, { run, copies: 1, onReprint: run });
  }

  async function onSavePrint() {
    if (!bitImage || !begin('save')) return;
    try {
      const blob = await pngBlob(bitImage, 2);
      downloadBlob(blob, exportFileName('fotoflash', 'png', new Date(entry.createdAt)));
      toast(t('hist_msg_saved'));
    } catch (e) {
      console.warn('[history] stampa non salvata', e);
      toast(t('hist_msg_save_failed'));
    } finally {
      end('save');
    }
  }

  async function onShare() {
    if (!bitImage || !begin('share')) return;
    try {
      const blob = await pngBlob(bitImage, 2);
      const file = new File([blob], exportFileName('fotoflash', 'png', new Date(entry.createdAt)), { type: 'image/png' });
      const result = await shareFiles([file], { title: t('hist_share_title') });
      // Senza condivisione (o gesto scaduto) il file è stato scaricato: lo si dice.
      if (result === 'downloaded') toast(t('hist_msg_share_downloaded'));
    } catch (e) {
      console.warn('[history] condivisione fallita', e);
      toast(t('hist_msg_share_failed'));
    } finally {
      end('share');
    }
  }

  async function onSavePhotos() {
    if (!entry || !begin('photos')) return;
    try {
      const blobs = await history.originals(entry.id);
      if (blobs.length === 0) {
        toast(t('hist_msg_no_photos'));
        return;
      }
      const n = await downloadOriginals(blobs, new Date(entry.createdAt));
      toast(t(n === 1 ? 'hist_msg_photos_saved_one' : 'hist_msg_photos_saved_other', n));
    } catch (e) {
      console.warn('[history] foto non salvate', e);
      toast(t('hist_msg_photos_failed'));
    } finally {
      end('photos');
    }
  }

  async function onDelete() {
    if (!entry || deleting || busy.has('print') || busy.has('photos')) return;
    const ok = await confirmDialog({
      title: t('hist_delete_title'),
      message: t('hist_delete_message'),
      confirmText: t('hist_delete_confirm'),
      cancelText: t('hist_cancel'),
      danger: true,
    });
    if (!ok || disposed || !entry) return;
    deleting = true;
    renderDetail();
    try {
      await history.remove(entry.id);
      if (!disposed) router.back();
    } catch (e) {
      console.warn('[history] eliminazione fallita', e);
      deleting = false;
      if (!disposed) {
        renderDetail();
        toast(t('hist_msg_delete_failed'));
      }
    }
  }

  return function unmount() {
    disposed = true;
    if (typeof unsubscribe === 'function') unsubscribe();
    if (resizeObserver) resizeObserver.disconnect();
    // Il lavoro di stampa continua: chiudendo il foglio l'esito arriva in un avviso.
    if (sheetHandle) sheetHandle.close();
    screen.remove();
    if (previewCanvas) releaseCanvas(previewCanvas);
    previewCanvas = null;
  };
}

function px(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// ------------------------------------------------------------------ utilità

/** Id dalla rotta #/history/<id>: params.id, una stringa o, in mancanza, l'hash stesso. */
function entryIdFrom(params) {
  let raw = null;
  if (typeof params === 'string') raw = params;
  else if (params && typeof params === 'object') raw = params.id ?? (Array.isArray(params) ? params[0] : null);
  if (!raw && typeof location !== 'undefined') {
    const m = /^#\/history\/([^/?#]+)/.exec(location.hash || '');
    if (m) raw = m[1];
  }
  if (!raw) return null;
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

/** PNG della stampa (1 px = 1 punto) → BitImage, senza perdite: è quello che va alla testina. */
async function decodePrint(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    const { data } = g.getImageData(0, 0, bitmap.width, bitmap.height);
    const image = bitImageFromRgba(bitmap.width, bitmap.height, data);
    canvas.width = 0;
    canvas.height = 0;
    return image;
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

function formatDate(ms) {
  try {
    return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function ensureStyle() {
  if (document.getElementById('ff-history-detail-style')) return;
  const style = document.createElement('style');
  style.id = 'ff-history-detail-style';
  style.textContent = DETAIL_CSS;
  document.head.append(style);
}

const DETAIL_CSS = `
.ffhd { display: flex; flex-direction: column; min-height: 100dvh; }
.ffhd-body { flex: 1; display: flex; flex-direction: column; }
.ffhd-center { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.ffhd-spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid #4A4640; border-right-color: transparent; animation: ffhd-spin .9s linear infinite; }
@keyframes ffhd-spin { to { transform: rotate(360deg); } }
.ffhd-content { width: 100%; max-width: 480px; margin: 0 auto; padding: 16px 20px 32px; display: flex; flex-direction: column; align-items: center; }
.ffhd-sheet { width: 100%; max-width: 380px; }
.ffhd-sheet canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; image-rendering: crisp-edges; }
.ffhd-ph { aspect-ratio: .8; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px;
  background: #EDE8DE; color: #4A4640; text-align: center; }
.ffhd-ph p { margin: 0; }
.ffhd-info { width: 100%; margin: 24px 0 0; padding: 0; }
.ffhd-row { display: flex; align-items: flex-start; gap: 16px; padding: 10px 0; border-bottom: 1px dashed rgba(127, 120, 110, .55); }
.ffhd-row:last-child { border-bottom: 0; }
.ffhd-row dt { flex: none; padding-top: 2px; font-family: 'Space Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }
.ffhd-row dd { flex: 1; min-width: 0; margin: 0; text-align: end; font-family: 'Space Mono', ui-monospace, monospace; font-weight: 700; font-size: 14px; overflow-wrap: anywhere; }
.ffhd-warn { color: var(--ff-error-text, #C4321E); }
.ffhd-actions { width: 100%; margin-top: 28px; display: flex; flex-direction: column; gap: 12px; }
.ffhd-actions > * { width: 100%; }
.ffhd-pair { display: flex; flex-direction: column; gap: 12px; }
.ffhd-pair > * { width: 100%; }
@media (min-width: 440px) { .ffhd-pair { flex-direction: row; } .ffhd-pair > * { flex: 1; min-width: 0; } }
.ffhd-delete { align-self: center; width: auto !important; display: inline-flex; align-items: center; gap: 6px; min-height: 48px; padding: 0 16px;
  border: 0; border-radius: 999px; background: transparent; color: var(--ff-error-text, #C4321E); font: inherit; font-weight: 700; cursor: pointer; }
.ffhd-delete:disabled { opacity: .4; cursor: default; }
.ffhd-delete:focus-visible { outline: 3px solid #3D8BFF; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .ffhd-spinner { animation: none; } }
`;
