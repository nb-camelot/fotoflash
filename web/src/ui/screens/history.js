// Storico delle stampe (porting di HistoryScreen.kt): griglia delle miniature in bianco e nero,
// più recenti in alto, e "Esporta tutte le foto" in un unico ZIP con l'avanzamento.

import { h as hRaw, clear, uniqueId } from '../dom.js';
import { icon } from '../icons.js';
import { topBar, iconButton, paperSheet, emptyState, confirmDialog, toast } from '../components.js';
import { makeZip } from '../../media/zip.js';
import { downloadBlob, exportFileName } from '../../media/export.js';
import { lang } from '../../i18n/i18n.js';
import { mount as mountDetail } from './history-detail.js';

/** Finestra delle miniature (larghezza/altezza): le strisce lunghe si vedono solo in cima. */
const THUMB_RATIO = 3 / 4;

/** h() senza figli vuoti: le parti facoltative si passano come null. */
function h(tag, props, ...children) {
  return hRaw(tag, props, ...children.flat().filter((c) => c != null && c !== false));
}

export function mount(root, ctx, params) {
  // #/history/<id>: se la rotta del dettaglio porta qui, si passa la mano a history-detail.js.
  if (params && params.id) return mountDetail(root, ctx, params);
  ensureStyle();
  const { t, history, router } = ctx;
  let disposed = false;
  let loaded = false;
  let entries = [];
  /** URL delle miniature per id: si revocano allo smontaggio. */
  const urls = new Map();
  let observer = null;
  let exportJob = null;
  let exportState = null;
  let progressView = null; // { el, title, count, fill, bar } durante l'esportazione

  const exportBtn = iconButton('download', { label: t('hist_export_all'), onClick: onExportClick });
  const exportSlot = h('span', { class: 'ffhist-export' }, exportBtn);
  exportSlot.hidden = true;
  // Regione live sempre in pagina: un riquadro appena inserito non verrebbe annunciato.
  const banner = h('div', { class: 'ffhist-banner-slot', attrs: { 'aria-live': 'polite' } });
  const body = h('div', { class: 'ffhist-body' });
  const screen = h('div', { class: 'ffhist' },
    topBar({ title: t('hist_title'), onBack: () => router.back(), actions: [exportSlot] }),
    banner,
    body);
  root.append(screen);

  const unsubscribe = history.subscribe((list) => {
    if (disposed) return;
    // Un avviso senza l'elenco: lo si rilegge invece di svuotare la griglia.
    if (!Array.isArray(list)) {
      load();
      return;
    }
    entries = sortEntries(list);
    loaded = true;
    renderGrid();
  });

  renderGrid();
  load();

  async function load() {
    try {
      const list = await history.list();
      if (disposed) return;
      entries = sortEntries(list);
    } catch (e) {
      console.warn('[history] lettura dello storico fallita', e);
      entries = [];
    }
    loaded = true;
    renderGrid();
  }

  // ---------------------------------------------------------------- griglia

  function renderGrid() {
    if (disposed) return;
    const photos = entries.reduce((n, e) => n + (Number(e.photoCount) || 0), 0);
    exportSlot.hidden = !(loaded && photos > 0);
    setExportEnabled(!exportJob);

    if (observer) observer.disconnect();
    observer = null;
    clear(body);

    if (!loaded) {
      body.append(h('div', { class: 'ffhist-loading', attrs: { role: 'status' } },
        h('span', { class: 'ffhist-spinner' }), h('span', {}, t('hist_loading'))));
      return;
    }
    if (entries.length === 0) {
      body.append(h('div', { class: 'ffhist-empty' }, emptyState({
        icon: 'gallery',
        title: t('hist_empty_title'),
        message: t('hist_empty_message'),
        actionText: t('hist_empty_action'),
        onAction: () => router.go('#/camera'),
      })));
      return;
    }

    // Le miniature si caricano quando stanno per entrare nello schermo: la griglia scorre subito.
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((items) => {
        for (const item of items) {
          if (!item.isIntersecting) continue;
          observer.unobserve(item.target);
          loadThumb(item.target);
        }
      }, { rootMargin: '300px 0px' });
    }
    const grid = h('ul', { class: 'ffhist-grid', attrs: { 'aria-label': t('hist_grid_label') } });
    for (const entry of entries) grid.append(h('li', { class: 'ffhist-item' }, card(entry)));
    body.append(grid);

    // Voci eliminate (anche da un'altra scheda): i loro URL non servono più.
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, url] of urls) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        urls.delete(id);
      }
    }
  }

  function card(entry) {
    const date = formatDate(entry.createdAt);
    const img = h('img', { class: 'ffhist-img', attrs: { alt: t('hist_thumb_cd', date), decoding: 'async' } });
    img.dataset.id = entry.id;
    const frame = h('div', { class: 'ffhist-frame' }, h('div', { class: 'ffhist-ph' }, icon('image', { size: 32 })), img);
    img.addEventListener('load', () => {
      frame.classList.add('ffhist-frame--ready');
      // Sfumatura in fondo: la stampa continua oltre la miniatura.
      if (img.naturalHeight > img.naturalWidth / THUMB_RATIO + 1) frame.classList.add('ffhist-frame--long');
    });
    img.addEventListener('error', () => frame.classList.add('ffhist-frame--broken'));
    const meta = h('div', { class: 'ffhist-meta' },
      h('span', { class: 'ffhist-date' }, date),
      entry.printNumber != null ? h('span', { class: 'ffhist-num' }, t('hist_print_number', pad4(entry.printNumber))) : null);
    const link = h('a', {
      class: 'ffhist-card',
      attrs: { href: `#/history/${encodeURIComponent(entry.id)}` },
      onClick: (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        router.go(`#/history/${entry.id}`);
      },
    },
    paperSheet(frame, meta),
    // Etichetta per le stampe solo salvate: si capisce a colpo d'occhio cosa manca da stampare.
    entry.printed ? null : h('span', { class: 'ffhist-badge' }, t('hist_not_printed')));
    if (urls.has(entry.id)) img.src = urls.get(entry.id);
    else if (observer) observer.observe(img);
    else loadThumb(img);
    return link;
  }

  async function loadThumb(img) {
    const id = img.dataset.id;
    if (urls.has(id)) {
      img.src = urls.get(id);
      return;
    }
    try {
      const blob = await history.printBlob(id);
      if (disposed) return;
      if (!blob) {
        img.dispatchEvent(new Event('error'));
        return;
      }
      if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
      img.src = urls.get(id);
    } catch (e) {
      console.warn('[history] miniatura non caricata', e);
    }
  }

  // ---------------------------------------------------------------- esportazione

  function setExportEnabled(enabled) {
    const target = exportBtn.matches && exportBtn.matches('button') ? exportBtn : exportBtn.querySelector && exportBtn.querySelector('button');
    if (target) target.disabled = !enabled;
  }

  async function onExportClick() {
    if (exportJob) return;
    const total = entries.reduce((n, e) => n + (Number(e.photoCount) || 0), 0);
    if (total === 0) {
      toast(t('hist_export_none'));
      return;
    }
    const ok = await confirmDialog({
      title: t('hist_export_title'),
      message: t('hist_export_message'),
      confirmText: t('hist_export_confirm'),
      cancelText: t('hist_cancel'),
    });
    if (ok && !disposed) runExport();
  }

  /** Raccoglie gli originali di tutte le voci, li mette in uno ZIP "store" e lo scarica. */
  async function runExport() {
    if (exportJob) return;
    const job = { cancelled: false };
    exportJob = job;
    setExportEnabled(false);
    const list = entries.filter((e) => (Number(e.photoCount) || 0) > 0);
    let skipped = 0;
    try {
      setExport({ phase: 'collect', done: 0, total: list.length });
      const files = [];
      for (let i = 0; i < list.length; i++) {
        if (job.cancelled) break;
        const entry = list[i];
        const blobs = await history.originals(entry.id);
        if (blobs.length === 0) skipped++;
        const date = new Date(entry.createdAt);
        const base = exportFileName('fotoflash', '', date);
        blobs.forEach((data, k) => {
          files.push({ name: blobs.length > 1 ? `${base}-${k + 1}.jpg` : `${base}.jpg`, data, date });
        });
        setExport({ phase: 'collect', done: i + 1, total: list.length });
      }
      if (job.cancelled) {
        setExport({ end: 'cancelled' });
        return;
      }
      if (files.length === 0) {
        setExport({ end: 'none' });
        return;
      }
      setExport({ phase: 'zip', done: 0, total: files.length });
      const zip = await makeZip(files, {
        onProgress: (done, total) => {
          if (!job.cancelled) setExport({ phase: 'zip', done, total });
        },
      });
      if (job.cancelled) {
        setExport({ end: 'cancelled' });
        return;
      }
      const name = `fotoflash-foto-${isoDay(new Date())}.zip`;
      downloadBlob(zip, name);
      setExport({ end: 'done', count: files.length, skipped, name });
    } catch (e) {
      console.error('[history] esportazione fallita', e);
      setExport({ end: 'failed' });
    } finally {
      if (exportJob === job) exportJob = null;
      if (!disposed) setExportEnabled(true);
    }
  }

  function setExport(state) {
    exportState = state;
    if (disposed) {
      // Uscendo dallo storico l'esportazione va avanti: l'esito arriva in un avviso.
      if (state && state.end === 'done') toast(doneText(state));
      else if (state && state.end === 'failed') toast(t('hist_export_failed_message'));
      return;
    }
    renderBanner();
  }

  function doneText(state) {
    return t(state.count === 1 ? 'hist_export_done_one' : 'hist_export_done_other', state.count, state.name);
  }

  /**
   * Riquadro sopra la griglia: avanzamento con "Annulla", poi il risultato finché non lo si chiude.
   * Durante l'avanzamento si aggiornano solo testi e barra: ricostruendo il riquadro a ogni foto
   * il tocco su "Annulla" cadrebbe su un pulsante già sostituito e il fuoco andrebbe perso.
   */
  function renderBanner() {
    const state = exportState;
    if (state && !state.end) {
      if (!progressView) {
        clear(banner);
        progressView = buildProgressView();
        banner.append(progressView.el);
      }
      const fraction = state.total > 0 ? Math.min(1, state.done / state.total) : 0;
      const pct = String(Math.round(fraction * 100));
      const title = t(state.phase === 'zip' ? 'hist_export_zipping' : 'hist_export_running');
      if (progressView.title.textContent !== title) progressView.title.textContent = title;
      progressView.count.textContent = t('hist_export_progress', state.done, state.total);
      progressView.fill.style.width = `${pct}%`;
      progressView.bar.setAttribute('aria-valuenow', pct);
      progressView.bar.setAttribute('aria-valuetext', progressView.count.textContent);
      return;
    }
    progressView = null;
    clear(banner);
    if (!state) return;
    const clean = state.end === 'done' && !state.skipped;
    let title;
    let message;
    if (state.end === 'done') {
      title = t('hist_export_done_title');
      message = doneText(state);
    } else if (state.end === 'cancelled') {
      title = t('hist_export_cancelled_title');
      message = null;
    } else if (state.end === 'none') {
      title = t('hist_export_failed_title');
      message = t('hist_export_none');
    } else {
      title = t('hist_export_failed_title');
      message = t('hist_export_failed_message');
    }
    const skippedText = state.skipped
      ? t(state.skipped === 1 ? 'hist_export_skipped_one' : 'hist_export_skipped_other', state.skipped)
      : null;
    banner.append(h('div', { class: `ffhist-banner${clean ? ' ffhist-banner--ok' : ''}` },
      h('div', { class: 'ffhist-banner-row' },
        h('span', { class: 'ffhist-banner-icon' }, icon(clean ? 'check' : 'warning', { size: 22 })),
        h('div', { class: 'ffhist-banner-text' },
          h('strong', {}, title),
          message ? h('span', {}, message) : null,
          skippedText ? h('span', { class: 'ffhist-small' }, skippedText) : null),
        iconButton('close', {
          label: t('hist_export_dismiss'),
          onClick: () => {
            exportState = null;
            renderBanner();
          },
        }))));
  }

  function buildProgressView() {
    const titleId = uniqueId('ffhist-export');
    const title = h('strong', { id: titleId });
    const count = h('span', { class: 'ffhist-mono', attrs: { 'aria-hidden': 'true' } });
    const fill = h('span', { class: 'ffhist-bar-fill' });
    const bar = h('div', {
      class: 'ffhist-bar',
      attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-labelledby': titleId },
    }, fill);
    // Il conteggio è per gli occhi (la barra lo dice già): la regione live annuncia le fasi, non ogni foto.
    const el = h('div', { class: 'ffhist-banner' },
      h('div', { class: 'ffhist-banner-row' },
        h('span', { class: 'ffhist-banner-icon' }, icon('gallery', { size: 22 })),
        h('div', { class: 'ffhist-banner-text' }, title, count),
        h('button', {
          class: 'ffhist-textbtn',
          attrs: { type: 'button' },
          onClick: () => {
            if (exportJob) exportJob.cancelled = true;
          },
        }, t('hist_export_cancel'))),
      bar);
    return { el, title, count, fill, bar };
  }

  return function unmount() {
    disposed = true;
    if (typeof unsubscribe === 'function') unsubscribe();
    if (observer) observer.disconnect();
    observer = null;
    // Le immagini già mostrate restano nella cache del browser: gli URL si possono revocare.
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    screen.remove();
  };
}

// ------------------------------------------------------------------ utilità

function sortEntries(list) {
  return Array.from(list || []).sort((a, b) => (b.seq ?? b.createdAt ?? 0) - (a.seq ?? a.createdAt ?? 0));
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

function formatDate(ms) {
  try {
    return new Intl.DateTimeFormat(lang(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

/** "2026-10-18": la data nel nome dello ZIP. */
function isoDay(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function ensureStyle() {
  if (document.getElementById('ff-history-style')) return;
  const style = document.createElement('style');
  style.id = 'ff-history-style';
  style.textContent = HISTORY_CSS;
  document.head.append(style);
}

const HISTORY_CSS = `
.ffhist { display: flex; flex-direction: column; min-height: 100dvh; }
.ffhist-export[hidden] { display: none; }
.ffhist-body { flex: 1; display: flex; flex-direction: column; }
.ffhist-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; opacity: .8; }
.ffhist-spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid currentColor; border-right-color: transparent; animation: ffhist-spin .9s linear infinite; }
@keyframes ffhist-spin { to { transform: rotate(360deg); } }
.ffhist-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.ffhist-grid { list-style: none; margin: 0; padding: 12px 16px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 20px 16px; }
.ffhist-item { min-width: 0; }
.ffhist-card { position: relative; display: block; padding: 2px; border-radius: 8px; color: inherit; text-decoration: none; }
.ffhist-card:focus-visible { outline: 3px solid #3D8BFF; outline-offset: 2px; }
.ffhist-card:active { transform: scale(.98); }
.ffhist-frame { position: relative; width: 100%; aspect-ratio: 3 / 4; overflow: hidden; background: #EDE8DE; }
.ffhist-ph { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(74, 70, 64, .35); }
.ffhist-img { position: relative; display: block; width: 100%; height: auto; image-rendering: pixelated; mix-blend-mode: multiply; opacity: 0; transition: opacity .2s; }
.ffhist-frame--ready { background: transparent; }
.ffhist-frame--ready .ffhist-ph { display: none; }
.ffhist-frame--ready .ffhist-img { opacity: 1; }
.ffhist-frame--long::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 36px; background: linear-gradient(rgba(251, 248, 241, 0), #FBF8F1); }
.ffhist-frame--broken .ffhist-img { display: none; }
.ffhist-meta { display: flex; align-items: center; gap: 6px; padding-top: 8px; font-family: 'Space Mono', ui-monospace, monospace; font-size: 11px; color: #4A4640; }
.ffhist-date { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ffhist-num { font-weight: 700; color: #16130F; white-space: nowrap; }
.ffhist-badge { position: absolute; top: 8px; right: 8px; padding: 3px 8px; border-radius: 999px; background: #FF5B45; color: #16130F;
  font: 700 10px/1.3 'Space Mono', ui-monospace, monospace; white-space: nowrap; }
/* Vuoto resta in pagina ad altezza zero (non display: none): è la regione live dell'esportazione. */
.ffhist-banner-slot:not(:empty) { padding: 8px 16px 0; }
.ffhist-banner { border-radius: 16px; padding: 12px 8px 12px 16px; background: rgba(127, 120, 110, .12); }
.ffhist-banner-row { display: flex; align-items: center; gap: 12px; }
.ffhist-banner-icon { display: grid; place-items: center; flex: none; opacity: .8; }
.ffhist-banner--ok .ffhist-banner-icon { color: #22B89A; opacity: 1; }
.ffhist-banner-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; line-height: 1.4; }
.ffhist-mono { font-family: 'Space Mono', ui-monospace, monospace; font-size: 12px; opacity: .75; }
.ffhist-small { font-size: 13px; opacity: .75; }
.ffhist-textbtn { min-height: 44px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
.ffhist-textbtn:focus-visible { outline: 3px solid #3D8BFF; }
.ffhist-bar { position: relative; height: 6px; margin: 10px 8px 0 0; border-radius: 3px; overflow: hidden; background: rgba(127, 120, 110, .25); }
.ffhist-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; background: #FFCC00; border-radius: 3px; transition: width .2s; }
@media (prefers-reduced-motion: reduce) {
  .ffhist-spinner { animation: none; }
  .ffhist-img, .ffhist-bar-fill { transition: none; }
}
`;
