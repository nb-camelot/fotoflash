// «Stampante e carta»: stato con l'azione giusta al momento giusto, abbinamento Web Bluetooth,
// carta, intensità, modalità di invio, diagnostica, consigli e compatibilità del browser.
import { h, clear, uniqueId } from '../dom.js';
import { icon } from '../icons.js';
import {
  topBar, sectionHeader, card, flashButton, ghostButton, textButton, printerPill, chipsRow, slider,
  toggle, notice, listItem, toast, confirmDialog, progressBar, failureLabel,
} from '../components.js';
import { Ble } from '../../printer/ble.js';

export const APK_URL = 'https://github.com/nb-camelot/fotoflash/releases/latest';

const BAND_STEPS = [8, 16, 24, 32, 48, 64, 96, 128, 192, 255];
const BAND_DEFAULT = 24;
const FEED_MAX = 10;
const HEAT_MAX = 4;
const WRITE_MODES = ['auto', 'response-100', 'response-20', 'noresponse-20'];
const MODE_KEYS = {
  auto: 'prn_mode_auto',
  'response-100': 'prn_mode_response_100',
  'response-20': 'prn_mode_response_20',
  'noresponse-20': 'prn_mode_noresponse_20',
};
const ERROR_KEYS = {
  unsupported: 'prn_err_unsupported',
  'cat-printer': 'prn_err_cat_printer',
  'no-channel': 'prn_err_no_channel',
  timeout: 'prn_err_timeout',
  location: 'prn_err_location',
  'not-found': 'prn_err_not_found',
  gesture: 'prn_err_gesture',
  network: 'prn_err_network',
};
const ERROR_TITLE_KEYS = {
  UNSUPPORTED: 'prn_error_title_unsupported',
  NO_PRINTER: 'prn_error_title_no_printer',
  BLUETOOTH_OFF: 'prn_error_title_bt_off',
  CONNECT_FAILED: 'prn_error_title_connect',
  WRITE_FAILED: 'prn_error_title_write',
  BUSY: 'prn_error_title_busy',
  RENDER_FAILED: 'prn_error_title_render',
  CAT_PRINTER: 'prn_error_title_cat',
  NO_CHANNEL: 'prn_error_title_no_channel',
};

// ---------------------------------------------------------------------------------------------
// Aiuti condivisi con l'onboarding

/** iOS (tutti i browser sono WebKit, niente Web Bluetooth) e Android (consiglio sulla Posizione). */
export function platformInfo() {
  const nav = globalThis.navigator || {};
  const ua = nav.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return { iOS, android: /Android/i.test(ua) };
}

/** Perché qui non si stampa: null se Web Bluetooth c'è, altrimenti 'insecure' | 'ios' | 'browser'. */
export function unsupportedReason() {
  if (Ble.supported()) return null;
  if (globalThis.isSecureContext === false) return 'insecure';
  return platformInfo().iOS ? 'ios' : 'browser';
}

/** Messaggio per un errore di Web Bluetooth ('' quando l'utente ha solo chiuso la scelta). */
export function bleErrorMessage(t, error, name) {
  let code = 'unknown';
  try {
    code = Ble.errorCode(error) || 'unknown';
  } catch {
    code = 'unknown';
  }
  if (code === 'cancelled') return '';
  if (code === 'write') return t('prn_err_write', name || t('prn_unknown_printer'));
  if (ERROR_KEYS[code]) return t(ERROR_KEYS[code]);
  const detail = (error && (error.message || error.name)) || String(error || '');
  return t('prn_err_unknown', detail);
}

/**
 * Abbina o ricollega la stampante. Va chiamata DIRETTAMENTE nel gestore del tocco: la scelta del
 * dispositivo del browser richiede un gesto. mode: 'pair' | 'all' (tutti i dispositivi) | 'reconnect'.
 */
export function pairPrinter(ctx, mode = 'pair') {
  try {
    if (mode === 'all') return Promise.resolve(ctx.printer.pair({ all: true }));
    if (mode === 'reconnect') {
      // Stessa pagina, o un browser che ricorda le stampanti: ricollegarsi basta (e dentro il tocco il
      // manager ripiega da sé sulla scelta). Altrimenti serve di nuovo la scelta, filtrata sul nome.
      const info = Ble.info();
      if (info.paired || (info.remembered && Ble.canRemember())) return Promise.resolve(ctx.printer.reconnect());
      return Promise.resolve(ctx.printer.pair({ sameName: true }));
    }
    return Promise.resolve(ctx.printer.pair());
  } catch (e) {
    return Promise.reject(e);
  }
}

/** Stampante ricordata da una visita precedente ma non ancora ricollegata in questa pagina. */
export function rememberedOnly(state) {
  return !!(state && state.kind === 'not-paired' && state.remembered && state.name);
}

/**
 * Esito leggibile di print/printTestPage: stringa vuota se è andato bene. pair() restituisce lo stato e
 * reconnect() un booleano: i loro fallimenti finiscono nello stato del manager, che la UI già mostra.
 */
export function outcomeMessage(t, result) {
  if (result && typeof result === 'object' && result.ok === false) return result.message || failureLabel(result.failure);
  return '';
}

/** Nome breve di un UUID Bluetooth standard (0000xxxx-0000-1000-8000-00805f9b34fb → XXXX). */
export function shortUuid(uuid) {
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(uuid || '');
  return m ? m[1].toUpperCase() : (uuid || '');
}

function modeLabel(t, info) {
  const mode = (info && info.writeMode) || 'auto';
  if (mode === 'auto' && info && info.chunk === 20) return t('prn_mode_auto_small');
  return t(MODE_KEYS[mode] || 'prn_mode_auto');
}

// ---------------------------------------------------------------------------------------------
// Schermata

export function mount(root, ctx) {
  const { t, settings, printer, router } = ctx;
  const cleanups = [];
  const reason = unsupportedReason();
  const supported = reason === null;
  const { iOS, android } = platformInfo();
  let info = safeInfo();
  let state = printer.state || { kind: supported ? 'not-paired' : 'unsupported' };
  let busyAction = false;
  let lastStatusKey = '';

  function safeInfo() {
    try {
      return Ble.info();
    } catch {
      return { status: 'idle', paired: false, connected: false, remembered: false, writeMode: 'auto' };
    }
  }

  function printerName() {
    return state.name || info.name || t('prn_unknown_printer');
  }

  function hasDevice() {
    return !!(info.paired || info.remembered || state.name);
  }

  // --- Azioni ---------------------------------------------------------------------------------

  function runPair(mode, btn) {
    // Prima la chiamata (gesto utente), poi tutto il resto.
    const pending = pairPrinter(ctx, mode);
    busyAction = true;
    if (btn && btn.setBusy) btn.setBusy(true);
    // L'esito compare nella scheda di stato; il toast serve quando il tocco è venuto da più in basso.
    const fromCard = !!(btn && statusCard.contains(btn));
    pending.then((result) => {
      info = safeInfo();
      if (mode !== 'reconnect' && result && info.name && state.kind !== 'error') toast(t('prn_paired', info.name));
    }).catch((e) => {
      const msg = bleErrorMessage(t, e, printerName());
      if (msg && !fromCard) toast(msg, { duration: 7000 });
    }).finally(() => {
      busyAction = false;
      if (btn && btn.isConnected && btn.setBusy) btn.setBusy(false);
      refresh(true);
    });
  }

  async function runTestPage(btn) {
    btn.setBusy(true);
    try {
      const result = await printer.printTestPage();
      const msg = outcomeMessage(t, result);
      toast(msg || t('prn_test_sent'), msg ? { duration: 7000 } : undefined);
    } catch (e) {
      const msg = bleErrorMessage(t, e, printerName());
      if (msg) toast(msg, { duration: 7000 });
    } finally {
      if (btn.isConnected) btn.setBusy(false);
    }
  }

  async function forget() {
    const ok = await confirmDialog({
      title: t('prn_forget_title', printerName()),
      message: t('prn_forget_body'),
      confirmText: t('prn_forget_confirm'),
      cancelText: t('prn_cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await printer.forget();
    } catch (e) {
      console.warn('[printer] forget', e);
    }
    clearDiag();
    refresh(true);
  }

  // --- Scheda di stato ------------------------------------------------------------------------

  const pill = printerPill(state, null, { large: true });
  const statusIcon = h('div', { class: 'ff-status__icon', 'aria-hidden': 'true' });
  const statusTitleId = uniqueId('status');
  const statusTitle = h('h2', { class: 'ff-status__title', id: statusTitleId, tabIndex: -1 });
  const statusBody = h('p', { class: 'ff-status__body' });
  const statusProgress = progressBar(0);
  const statusActions = h('div', { class: 'ff-status__actions' });
  const statusCard = h('section', { class: 'ff-status', 'aria-labelledby': statusTitleId },
    h('div', { class: 'ff-status__head' }, statusIcon, h('div', { class: 'ff-grow' }, statusTitle, statusBody)),
    pill.el,
    statusProgress.el,
    statusActions);

  function statusModel() {
    const pct = Math.round(Math.min(1, Math.max(0, Number(state.progress) || 0)) * 100);
    switch (state.kind) {
      case 'unsupported': {
        const body = reason === 'insecure' ? 'prn_compat_insecure_body' : reason === 'ios' ? 'prn_compat_ios' : 'prn_compat_browser';
        return { icon: 'bluetooth-off', title: t('prn_status_unsupported_title'), body: t(body) };
      }
      case 'disconnected':
        return { icon: 'bluetooth', title: t('prn_status_disconnected_title'), body: t('prn_status_disconnected_body') };
      case 'not-paired':
        if (rememberedOnly(state)) {
          return { icon: 'bluetooth', title: t('prn_status_disconnected_title'), body: t('prn_status_disconnected_body') };
        }
        return { icon: 'bluetooth', title: t('prn_status_none_title'), body: t('prn_status_none_body') };
      case 'connecting':
        return { icon: 'bluetooth-search', title: t('prn_status_connecting_title'), body: t('prn_status_connecting_body') };
      case 'ready':
        return { icon: 'check', title: t('prn_status_ready_title'), body: t('prn_status_ready_body') };
      case 'printing':
        return { icon: 'print', title: t('prn_status_printing_title', pct), body: t('prn_status_printing_body'), progress: state.progress };
      case 'error':
        return {
          icon: 'warning',
          title: t(ERROR_TITLE_KEYS[state.failure] || 'prn_error_title_connect'),
          body: state.message || failureLabel(state.failure),
        };
      default:
        return { icon: 'bluetooth', title: t('prn_status_none_title'), body: t('prn_status_none_body') };
    }
  }

  function statusButtons() {
    const out = [];
    const kind = state.kind;
    const apkLink = () => h('a', { class: 'ff-btn ff-btn--ghost', href: APK_URL, target: '_blank', rel: 'noopener noreferrer' },
      icon('android'), h('span', { class: 'ff-btn__label' }, t('prn_action_apk')),
      h('span', { class: 'ff-sr-only' }, ` ${t('common_new_tab')}`));
    if (kind === 'unsupported' || (kind === 'error' && state.failure === 'UNSUPPORTED')) {
      if (!iOS) out.push(apkLink());
      return out;
    }
    if (kind === 'ready') {
      const test = flashButton(t('prn_action_test'), { icon: 'paper', onClick: () => runTestPage(test) });
      out.push(test, ghostButton(t('prn_action_disconnect'), { onClick: () => printer.disconnect() }));
    } else if (kind === 'disconnected' || rememberedOnly(state) || (kind === 'error' && hasDevice() && state.failure !== 'CAT_PRINTER')) {
      const again = flashButton(kind === 'error' ? t('prn_action_retry') : t('prn_action_reconnect'), {
        icon: 'refresh',
        onClick: () => runPair('reconnect', again),
      });
      const other = ghostButton(t('prn_action_pair_other'), { onClick: () => runPair('pair', other) });
      out.push(again, other);
    } else if (kind === 'not-paired' || kind === 'error') {
      const pair = flashButton(t('prn_action_pair'), { icon: 'bluetooth', onClick: () => runPair('pair', pair) });
      const all = textButton(t('prn_action_pair_all'), { onClick: () => runPair('all', all) });
      out.push(pair, all);
    }
    return out;
  }

  function renderStatus(force) {
    const model = statusModel();
    pill.set(state);
    statusCard.dataset.kind = state.kind;
    statusTitle.textContent = model.title;
    statusBody.textContent = model.body;
    statusProgress.el.hidden = state.kind !== 'printing';
    if (state.kind === 'printing') statusProgress.set(Number(state.progress) || 0);
    // Pulsanti ricostruiti solo quando cambia davvero lo stato, non a ogni punto percentuale.
    const key = `${state.kind}|${state.failure || ''}|${hasDevice()}|${rememberedOnly(state)}`;
    if (!force && key === lastStatusKey) return;
    lastStatusKey = key;
    clear(statusIcon);
    statusIcon.appendChild(icon(model.icon, { size: 28 }));
    const hadFocus = statusActions.contains(document.activeElement);
    clear(statusActions);
    statusButtons().forEach((b) => statusActions.appendChild(b));
    statusActions.hidden = !statusActions.firstChild;
    // Se il pulsante toccato è sparito, il fuoco resta sulla scheda invece di perdersi.
    if (hadFocus) statusTitle.focus({ preventScroll: true });
  }

  // --- Dettagli della stampante ---------------------------------------------------------------

  const kvName = h('span', { class: 'ff-kv__value' });
  const kvChannel = h('span', { class: 'ff-kv__value' });
  const kvMode = h('span', { class: 'ff-kv__value' });
  const otherBtn = listItem({ icon: 'bluetooth-search', title: t('prn_action_pair_other'), onClick: () => runPair('pair', null) });
  const allBtn = listItem({ icon: 'search', title: t('prn_action_pair_all'), onClick: () => runPair('all', null) });
  const disconnectBtn = listItem({ icon: 'bluetooth-off', title: t('prn_action_disconnect'), onClick: () => printer.disconnect() });
  const forgetBtn = listItem({ icon: 'trash', title: t('prn_action_forget'), danger: true, onClick: forget });
  const detailsSection = h('div', null,
    sectionHeader(t('prn_section_printer')),
    card(
      h('div', { class: 'ff-kv' }, h('span', { class: 'ff-kv__key' }, t('prn_detail_name')), kvName),
      h('div', { class: 'ff-kv' }, h('span', { class: 'ff-kv__key' }, t('prn_detail_channel')), kvChannel),
      h('div', { class: 'ff-kv' }, h('span', { class: 'ff-kv__key' }, t('prn_detail_mode')), kvMode)),
    h('div', { class: 'ff-card', style: { marginTop: '12px' } }, otherBtn, allBtn, disconnectBtn, forgetBtn));

  function renderDetails() {
    detailsSection.hidden = !supported || !hasDevice();
    kvName.textContent = info.name || state.name || t('common_printer_unnamed');
    kvChannel.textContent = info.characteristic
      ? `${info.profile || ''} · ${shortUuid(info.characteristic)}`.replace(/^ · /, '')
      : t('prn_detail_none');
    kvMode.textContent = modeLabel(t, info);
    disconnectBtn.hidden = !info.connected;
    forgetBtn.hidden = !(info.paired || info.remembered);
    const working = state.kind === 'connecting' || state.kind === 'printing' || busyAction;
    [otherBtn, allBtn].forEach((b) => {
      b.disabled = working;
    });
  }

  // --- Carta ------------------------------------------------------------------------------------

  const s0 = settings.get();
  const paperHint = h('span', { class: 'ff-block__desc' });
  const paperChips = chipsRow(['MM58', 'MM80'], s0.paper || 'MM58',
    (v) => t(v === 'MM80' ? 'prn_paper_80' : 'prn_paper_58'),
    (v) => {
      settings.update({ paper: v });
      paintPaperHint(v);
    }, { ariaLabel: t('prn_paper_width') });
  function paintPaperHint(paper) {
    paperHint.textContent = t('prn_paper_width_hint', paper === 'MM80' ? 576 : 384);
  }
  paintPaperHint(s0.paper);
  const feed = slider({
    label: t('prn_feed_lines'),
    min: 0,
    max: FEED_MAX,
    step: 1,
    value: clampInt(s0.feedLines, 0, FEED_MAX, 4),
    format: (v) => t('prn_feed_lines_value', v),
    desc: t('prn_feed_lines_hint'),
    onChange: (v) => settings.update({ feedLines: v }),
  });
  const cut = toggle({
    label: t('prn_cut'),
    desc: t('prn_cut_hint'),
    icon: 'cut',
    checked: !!s0.cutPaper,
    onChange: (on) => settings.update({ cutPaper: on }),
  });
  const paperSection = h('div', null,
    sectionHeader(t('prn_section_paper')),
    card(
      h('div', { class: 'ff-block' },
        h('span', { class: 'ff-block__label' }, t('prn_paper_width')),
        paperHint,
        paperChips.el),
      h('hr', { class: 'ff-divider' }),
      feed.el,
      cut.el));

  // --- Intensità ------------------------------------------------------------------------------

  const heat = slider({
    label: t('prn_heat_title'),
    min: 0,
    max: HEAT_MAX,
    step: 1,
    value: clampInt(s0.heatLevel, 0, HEAT_MAX, 0),
    format: (v) => t(`prn_heat_level_${v}`),
    desc: t('prn_heat_hint'),
    onChange: (v) => settings.update({ heatLevel: v }),
  });
  const heatTest = ghostButton(t('prn_action_test'), { icon: 'paper', block: true, onClick: () => runTestPage(heatTest) });
  const heatSection = h('div', null,
    sectionHeader(t('prn_section_heat')),
    card(heat.el, h('div', { class: 'ff-block' }, heatTest)));

  // --- Invio ----------------------------------------------------------------------------------

  const modeName = 'ff-write-mode';
  const modeInputs = WRITE_MODES.map((mode) => {
    const input = h('input', { type: 'radio', name: modeName, value: mode });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      Ble.setWriteMode(mode);
      info = safeInfo();
      renderDetails();
    });
    return { mode, input };
  });
  const modeGroup = h('div', { role: 'radiogroup', 'aria-label': t('prn_mode_title') },
    ...modeInputs.map(({ mode, input }) => h('label', { class: 'ff-radio' },
      input,
      h('span', { class: 'ff-radio__text' },
        h('span', null, t(MODE_KEYS[mode])),
        h('span', { class: 'ff-radio__desc' }, t(`${MODE_KEYS[mode]}_desc`))))));
  function paintMode() {
    const current = info.writeMode || 'auto';
    modeInputs.forEach(({ mode, input }) => {
      input.checked = mode === current;
    });
  }
  const bandIndex = (value) => {
    const i = BAND_STEPS.indexOf(Number(value));
    if (i >= 0) return i;
    // valore fuori scala: il gradino più vicino
    let best = 0;
    BAND_STEPS.forEach((v, k) => {
      if (Math.abs(v - value) < Math.abs(BAND_STEPS[best] - value)) best = k;
    });
    return best;
  };
  const band = slider({
    label: t('prn_band_height'),
    min: 0,
    max: BAND_STEPS.length - 1,
    step: 1,
    value: bandIndex(s0.bandHeight || BAND_DEFAULT),
    format: (i) => t('prn_band_height_value', BAND_STEPS[i]),
    desc: `${t('prn_band_height_hint')} ${t('prn_recommended', BAND_DEFAULT)}`,
    onChange: (i) => settings.update({ bandHeight: BAND_STEPS[i] }),
  });
  const resetTransfer = textButton(t('prn_reset'), {
    icon: 'refresh',
    onClick: () => {
      Ble.setWriteMode('auto');
      settings.update({ bandHeight: BAND_DEFAULT });
      band.set(bandIndex(BAND_DEFAULT));
      info = safeInfo();
      paintMode();
      renderDetails();
      toast(t('prn_reset_done'));
    },
  });
  const transferSection = h('div', null,
    sectionHeader(t('prn_section_transfer')),
    card(
      h('div', { class: 'ff-block' }, h('span', { class: 'ff-block__label' }, t('prn_mode_title'))),
      modeGroup,
      h('p', { class: 'ff-block ff-small ff-muted' }, t('prn_mode_hint')),
      h('hr', { class: 'ff-divider' }),
      band.el,
      h('div', { class: 'ff-block' }, resetTransfer)));

  // --- Diagnostica ----------------------------------------------------------------------------

  const diagOut = h('div', { 'aria-live': 'polite' });
  const diagNeed = h('p', { class: 'ff-small ff-muted' }, t('prn_diag_need_printer'));
  const diagBtn = ghostButton(t('prn_diag_run'), { icon: 'search', block: true, onClick: runDiag });
  let diagList = null;
  const diagSection = h('div', null,
    sectionHeader(t('prn_section_diag')),
    card(
      h('div', { class: 'ff-block ff-stack' }, h('p', { class: 'ff-small ff-muted' }, t('prn_diag_hint')), diagNeed, diagBtn),
      diagOut));

  function clearDiag() {
    diagList = null;
    clear(diagOut);
  }

  async function runDiag() {
    diagBtn.setBusy(true);
    clear(diagOut);
    diagOut.appendChild(h('p', { class: 'ff-block ff-small ff-muted' }, t('prn_diag_running')));
    try {
      diagList = await Ble.describe();
      info = safeInfo();
      renderDiag();
      renderDetails();
    } catch (e) {
      clear(diagOut);
      const msg = bleErrorMessage(t, e, printerName()) || (e && e.message) || '';
      diagOut.appendChild(h('div', { class: 'ff-block' }, notice({ kind: 'error', text: t('prn_diag_failed', msg) })));
    } finally {
      if (diagBtn.isConnected) diagBtn.setBusy(false);
    }
  }

  function renderDiag() {
    clear(diagOut);
    if (!diagList) return;
    if (!diagList.length) {
      diagOut.appendChild(h('div', { class: 'ff-block' }, notice({ kind: 'warn', text: t('prn_diag_empty') })));
      return;
    }
    for (const svc of diagList) {
      const chars = svc.characteristics || [];
      const box = h('div', { class: 'ff-diag-svc' },
        h('div', { class: 'ff-diag-svc__uuid' }, t('prn_diag_service', shortUuid(svc.service))));
      if (!chars.length) box.appendChild(h('p', { class: 'ff-small ff-muted' }, t('prn_diag_no_chars')));
      for (const c of chars) {
        const props = [];
        if (c.write) props.push(t('prn_diag_prop_write'));
        if (c.writeWithoutResponse) props.push(t('prn_diag_prop_write_nr'));
        if (c.notify) props.push(t('prn_diag_prop_notify'));
        if (c.read) props.push(t('prn_diag_prop_read'));
        const inUse = info.characteristic && info.characteristic === c.uuid;
        const writable = c.write || c.writeWithoutResponse;
        let trailing = null;
        if (inUse) {
          trailing = h('span', { class: 'ff-badge ff-badge--flash' }, t('prn_diag_in_use'));
        } else if (writable) {
          const use = ghostButton(t('prn_diag_use'), {
            small: true,
            label: t('prn_diag_use_cd', shortUuid(c.uuid)),
            onClick: async () => {
              use.setBusy(true);
              try {
                info = await Ble.useCharacteristic(svc.service, c.uuid) || safeInfo();
                toast(t('prn_diag_used', shortUuid(c.uuid)));
              } catch (e) {
                const msg = bleErrorMessage(t, e, printerName());
                if (msg) toast(msg, { duration: 7000 });
                info = safeInfo();
              }
              renderDiag();
              renderDetails();
            },
          });
          trailing = use;
        }
        box.appendChild(h('div', { class: 'ff-diag-char' },
          h('div', { class: 'ff-diag-char__info' },
            h('span', { class: 'ff-diag-char__uuid' }, shortUuid(c.uuid)),
            h('span', { class: 'ff-diag-char__props' }, ...props.map((p) => h('span', { class: 'ff-badge' }, p)))),
          trailing));
      }
      diagOut.appendChild(box);
    }
  }

  function renderDiagGate() {
    const paired = !!info.paired;
    diagNeed.hidden = paired;
    const working = state.kind === 'connecting' || state.kind === 'printing';
    diagBtn.disabled = !paired || working;
  }

  // --- Consigli -------------------------------------------------------------------------------

  const tips = [
    ['prn_tip_blank_title', 'prn_tip_blank_body'],
    ['prn_tip_pale_title', 'prn_tip_pale_body'],
    ['prn_tip_broken_title', 'prn_tip_broken_body'],
    ['prn_tip_busy_title', 'prn_tip_busy_body'],
    ['prn_tip_missing_title', 'prn_tip_missing_body'],
  ];
  if (!iOS) tips.splice(4, 0, ['prn_tip_location_title', 'prn_tip_location_body']);
  // Su Android il consiglio della Posizione è il più utile quando l'elenco resta vuoto.
  if (android) tips.unshift(tips.splice(tips.findIndex(([k]) => k === 'prn_tip_location_title'), 1)[0]);
  const helpSection = h('div', null,
    sectionHeader(t('prn_section_help')),
    card(...tips.map(([title, body], i) => h('details', { class: 'ff-tip' },
      h('summary', null,
        h('span', { class: 'ff-tip__num', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', null, t(title)),
        icon('chevron-down', { size: 20 })),
      h('p', { class: 'ff-tip__body' }, t(body))))));

  // --- Compatibilità --------------------------------------------------------------------------

  const radioValue = h('span', { class: 'ff-compat__value' }, '…');
  const radioDot = h('span', { class: 'ff-compat__dot', 'aria-hidden': 'true' });
  const canRemember = supported && safeCall(() => Ble.canRemember(), false);
  const apiValue = supported ? t('prn_compat_yes') : reason === 'insecure' ? t('prn_compat_insecure') : t('prn_compat_no');
  const compatRows = [
    h('div', { class: 'ff-compat' },
      h('span', { class: ['ff-compat__dot', supported ? 'is-ok' : 'is-no'], 'aria-hidden': 'true' }),
      h('span', null, t('prn_compat_api')),
      h('span', { class: 'ff-compat__value' }, apiValue)),
  ];
  if (supported) {
    compatRows.push(
      h('div', { class: 'ff-compat' }, radioDot, h('span', null, t('prn_compat_radio')), radioValue),
      h('div', { class: 'ff-compat' },
        h('span', { class: ['ff-compat__dot', canRemember ? 'is-ok' : null], 'aria-hidden': 'true' }),
        h('span', null, t('prn_compat_remember')),
        h('span', { class: 'ff-compat__value' }, canRemember ? t('prn_compat_yes') : t('prn_compat_no'))));
  }
  const compatSection = h('div', null,
    sectionHeader(t('prn_section_compat')),
    card(...compatRows),
    supported && !canRemember ? h('p', { class: 'ff-small ff-muted', style: { margin: '10px 4px 0' } }, t('prn_compat_remember_hint')) : null,
    // Senza Web Bluetooth il link all'app è già nella scheda di stato; su iOS l'APK non serve.
    supported && !iOS ? h('div', { class: 'ff-card', style: { marginTop: '12px' } },
      listItem({ icon: 'android', title: t('prn_action_apk'), desc: t('prn_compat_apk'), href: APK_URL, external: true })) : null);

  if (supported) {
    Promise.resolve(safeCall(() => Ble.available(), null)).then((value) => {
      radioValue.textContent = value === true ? t('prn_compat_yes') : value === false ? t('prn_compat_radio_off') : t('prn_compat_unknown');
      radioDot.classList.toggle('is-ok', value === true);
      radioDot.classList.toggle('is-no', value === false);
    }).catch(() => {
      radioValue.textContent = t('prn_compat_unknown');
    });
  }

  // --- Montaggio ------------------------------------------------------------------------------

  const content = h('div', { class: 'ff-content' },
    statusCard,
    supported ? null : compatSection,
    detailsSection,
    paperSection,
    supported ? heatSection : null,
    supported ? transferSection : null,
    supported ? diagSection : null,
    supported ? helpSection : null,
    supported ? compatSection : null);

  root.appendChild(h('div', { class: 'ff-screen' },
    topBar({ title: t('prn_title'), onBack: () => router.back() }),
    content));

  function refresh(force) {
    info = safeInfo();
    renderStatus(force);
    renderDetails();
    renderDiagGate();
    const working = state.kind === 'printing' || state.kind === 'connecting';
    heatTest.disabled = working || !hasDevice();
  }

  paintMode();
  refresh(true);

  cleanups.push(printer.subscribe((next) => {
    state = next || state;
    refresh(false);
  }));
  if (supported) {
    cleanups.push(safeCall(() => Ble.on(() => {
      info = safeInfo();
      paintMode();
      renderDetails();
      renderDiagGate();
    }), null));
  }
  const unSettings = settings.subscribe((next) => {
    const v = next || settings.get();
    paperChips.set(v.paper || 'MM58');
    paintPaperHint(v.paper);
    feed.set(clampInt(v.feedLines, 0, FEED_MAX, 4));
    cut.set(!!v.cutPaper);
    heat.set(clampInt(v.heatLevel, 0, HEAT_MAX, 0));
    band.set(bandIndex(v.bandHeight || BAND_DEFAULT));
  });
  cleanups.push(unSettings);

  return () => {
    cleanups.forEach((fn) => {
      if (typeof fn === 'function') fn();
    });
  };
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeCall(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
