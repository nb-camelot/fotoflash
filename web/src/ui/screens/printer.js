// «Stampante e carta»: stato con l'azione giusta al momento giusto, abbinamento Web Bluetooth,
// modello della stampante (driver), carta, intensità, modalità di invio, diagnostica, consigli e
// compatibilità del browser. I controlli seguono il driver: ESC/POS e Phomemo non parlano la stessa
// lingua e non hanno le stesse regolazioni (docs/DRIVERS.md).
import { h, clear, uniqueId } from '../dom.js';
import { icon } from '../icons.js';
import {
  topBar, sectionHeader, card, divider, flashButton, ghostButton, textButton, printerPill, chipsRow,
  slider, toggle, notice, listItem, toast, confirmDialog, progressBar, failureLabel,
} from '../components.js';
import { Ble } from '../../printer/ble.js';
import { drivers, driverById, guessDriver, unsupportedModel, driverForPaper } from '../../printer/drivers/index.js';

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
const MODE_DESC_KEYS = {
  auto: 'prn_mode_auto_desc',
  'response-100': 'prn_mode_response_100_desc',
  'response-20': 'prn_mode_response_20_desc',
  'noresponse-20': 'prn_mode_noresponse_20_desc',
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

// --- Driver -------------------------------------------------------------------------------------

/** Driver della M02 Pro: l'unico con la larghezza di riga a scelta (72 o 78 byte). */
const M02PRO_ID = 'phomemo-m02pro';

/** Quali stampanti copre ciascun driver e con che nome compaiono nell'elenco del browser. */
const DRIVER_DESC_KEYS = {
  'escpos-58': 'prn_driver_desc_escpos58',
  'escpos-80': 'prn_driver_desc_escpos80',
  'phomemo-m02': 'prn_driver_desc_m02',
  'phomemo-m02pro': 'prn_driver_desc_m02pro',
};

const DITHER_NAME_KEYS = {
  ATKINSON: 'prn_dither_atkinson',
  FLOYD_STEINBERG: 'prn_dither_floyd_steinberg',
  ORDERED_BAYER: 'prn_dither_bayer',
  THRESHOLD: 'prn_dither_threshold',
};

/** Intensità 0..4 → densità Phomemo (1F 11 02 dd), la tabella di docs/DRIVERS.md. */
const HEAT_TO_DENSITY = [4, 2, 4, 6, 8];
const DENSITY_MIN = 1;
const DENSITY_MAX = 15;
const DENSITY_DEFAULT = 4;
/** Velocità (1B 4E 0D ss, comando delle M110): sperimentale, non verificata sulle M02. */
const SPEED_MIN = 1;
const SPEED_MAX = 5;
const SPEED_START = 3;
const WIDTH_BYTES = [72, 78];
const WIDTH_DEFAULT = 72;

/**
 * Preset di invio BLE per i Phomemo. Sul web l'MTU non si conosce: 20 byte entrano sempre in una
 * scrittura, oltre dipende da telefono e stampante (docs/DRIVERS.md).
 */
const BLE_PRESETS = [
  { id: 'safe', chunk: 20, delay: 15, key: 'prn_preset_safe', descKey: 'prn_preset_safe_desc' },
  { id: 'fast', chunk: 60, delay: 20, key: 'prn_preset_fast', descKey: 'prn_preset_fast_desc' },
  { id: 'max', chunk: 128, delay: 20, key: 'prn_preset_max', descKey: 'prn_preset_max_desc' },
];

// ---------------------------------------------------------------------------------------------
// Aiuti condivisi con l'onboarding, le impostazioni e il foglio di stampa

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

/** Vero per i driver del protocollo Phomemo (M02, M02 Pro). */
export function isPhomemo(driver) {
  if (!driver) return false;
  if (typeof driver.family === 'string') return driver.family === 'phomemo';
  return typeof driver.id === 'string' && driver.id.startsWith('phomemo-');
}

/** Larghezze di riga (byte) fra cui si può scegliere: più d'una solo sulla M02 Pro. */
function widthOptionsOf(driver) {
  if (driver && Array.isArray(driver.widthOptions)) return driver.widthOptions;
  return driver && driver.id === M02PRO_ID ? WIDTH_BYTES : [];
}

/** Driver scelto nelle impostazioni (id sconosciuto o mancante → escpos-58, come driverById). */
export function currentDriver(settings) {
  return driverById(settings.get().printerDriver);
}

/**
 * Driver riconosciuto dal nome annunciato dalla stampante, o null (nome sconosciuto, o M02X).
 * Il nome non distingue una ESC/POS da 58 mm da una da 80 (come il manager dopo un abbinamento):
 * se [current] è già una ESC/POS, è lei quella riconosciuta.
 */
export function detectedDriver(name, current = null) {
  if (!name) return null;
  let guess = null;
  try {
    guess = guessDriver(name) || null;
  } catch {
    guess = null;
  }
  if (guess && current && !isPhomemo(guess) && !isPhomemo(current)) return current;
  return guess;
}

/**
 * Modello riconosciuto ma non supportato (la Phomemo M02X parla un protocollo diverso da M02 e
 * M02 Pro, e guessDriver le nega apposta un driver). → vero se la UI deve avvisare
 */
export function isUnsupportedModel(name) {
  try {
    return !!(name && unsupportedModel(name));
  } catch {
    return false;
  }
}

/** "576 punti · 300 dpi" */
export function driverSpec(t, driver) {
  return t('prn_driver_spec', driver.dots, driver.dpi);
}

/** Quali stampanti copre il driver e con che nome compaiono nel browser. */
export function driverDesc(t, driver) {
  const key = DRIVER_DESC_KEYS[driver.id];
  return key ? t(key) : '';
}

function ditherName(t, algorithm) {
  const key = DITHER_NAME_KEYS[algorithm];
  return key ? t(key) : String(algorithm || '');
}

function save(settings, patch) {
  try {
    const r = settings.update(patch);
    if (r && typeof r.catch === 'function') r.catch((e) => console.error('[printer] impostazione non salvata', e));
  } catch (e) {
    console.error('[printer] impostazione non salvata', e);
  }
}

/**
 * Propone il retino del driver (Floyd-Steinberg per la M02 Pro, Atkinson per le ESC/POS) senza
 * imporlo: il retino è anche una scelta di gusto, e l'utente può averlo cambiato apposta.
 */
function proposeDither(ctx, driver) {
  const { t, settings } = ctx;
  const want = driver.defaultDither;
  if (!want || settings.get().dither === want) return;
  toast(t('prn_dither_suggest', driver.displayName, ditherName(t, want)), {
    actionText: t('prn_dither_use'),
    onAction: () => {
      save(settings, { dither: want });
      toast(t('prn_dither_set', ditherName(t, want)));
    },
    duration: 9000,
  });
}

/** Calibrazione BLE ai predefiniti del driver (null = TransportHints del driver o strategia automatica). */
const BLE_TUNING_RESET = Object.freeze({ bleChunkSize: null, bleChunkDelayMs: null, bleWithoutResponse: null });

/**
 * Pezzi e pause BLE tarati su una famiglia di stampanti non valgono per l'altra: un preset
 * Phomemo da 128 byte senza conferma toglierebbe all'ESC/POS la strategia automatica del bridge.
 */
function bleTuningResetFor(prev, next) {
  return isPhomemo(prev) !== isPhomemo(next) ? BLE_TUNING_RESET : null;
}

/**
 * Scelta del driver fatta dall'utente. Passa da PrinterManager.setDriver, che la ricorda come
 * scelta a mano (il riconoscimento dal nome dopo un abbinamento non la scavalca), allinea la carta
 * (escpos-58 → MM58, escpos-80 → MM80, phomemo-m02 → MM58, phomemo-m02pro → M02PRO) e cambia il
 * retino se era il predefinito del driver di prima; se l'utente ne aveva scelto un altro, qui lo si
 * propone soltanto. Cambiando famiglia di stampanti i pezzi e le pause BLE tornano ai predefiniti
 * del driver: erano tarati sull'altra. → il driver scelto
 */
export function selectDriver(ctx, id) {
  const { t, settings, printer } = ctx;
  const next = driverById(id);
  const prev = currentDriver(settings);
  if (prev.id === next.id) return next;
  const ditherBefore = settings.get().dither;
  let applied = false;
  if (printer && typeof printer.setDriver === 'function') {
    try {
      printer.setDriver(next.id);
      applied = true;
    } catch (e) {
      console.error('[printer] driver non impostato dal manager', e);
    }
  }
  const patch = applied ? {} : { printerDriver: next.id, paper: next.paper };
  Object.assign(patch, bleTuningResetFor(prev, next));
  if (Object.keys(patch).length) save(settings, patch);
  const ditherNow = settings.get().dither;
  if (ditherNow !== ditherBefore && ditherNow === next.defaultDither) {
    // Il manager ha già passato il retino a quello del driver (era il predefinito del precedente):
    // l'anteprima cambia aspetto, quindi lo si dice invece di farlo di nascosto.
    toast(t('prn_dither_set', ditherName(t, ditherNow)));
  } else {
    proposeDither(ctx, next);
  }
  return next;
}

/**
 * Dopo un abbinamento riuscito, da chiamare con il nome della stampante di prima (before), quello
 * nuovo (after) e l'id del driver di prima (previousDriverId), letti PRIMA di pair().
 * Il driver l'ha già scelto PrinterManager dal nome (salvo una scelta a mano per quella stampante,
 * e senza separare la 58 dalla 80 mm): qui non lo si tocca, altrimenti un riconoscimento automatico
 * diventerebbe una scelta a mano. Con una stampante diversa la UI fa il resto: azzera la
 * calibrazione BLE se è cambiata la famiglia e propone il retino del nuovo driver. Un modello
 * riconosciuto ma non supportato (M02X) lo segnalano le viste stesse (avviso nella scheda della
 * stampante, esito nel foglio di stampa), con unsupportedPrinter(). Stessa stampante: niente.
 * → il driver riconosciuto dal nome (null se il nome non lo dice, o se è una M02X)
 */
export function adoptDetectedDriver(ctx, before, after, previousDriverId = null) {
  if (!after || after === before) return null;
  const { settings } = ctx;
  const current = currentDriver(settings);
  if (previousDriverId) {
    const prev = driverById(previousDriverId);
    const reset = bleTuningResetFor(prev, current);
    if (reset) save(settings, reset);
    if (prev.id !== current.id) proposeDither(ctx, current);
  }
  return detectedDriver(after, current);
}

/** Stampante riconosciuta ma con un protocollo che FotoFlash non parla (M02X): niente stampe né prove. */
export function unsupportedPrinter(state) {
  return !!(state && (state.unsupported || isUnsupportedModel(state.name)));
}

/**
 * Elenco dei driver a scelta singola: nome, punti e dpi, quali stampanti copre, e il segno
 * «riconosciuta» sul driver che corrisponde al nome della stampante. onPick(driver) dopo una scelta.
 * → { el, set(printerName) }
 */
export function driverPicker(ctx, { onPick } = {}) {
  const { t } = ctx;
  const group = uniqueId('ff-driver');
  const rows = drivers.map((driver) => {
    const input = h('input', { type: 'radio', name: group, value: driver.id });
    const badge = h('span', { class: 'ff-badge ff-badge--flash', hidden: true }, t('prn_driver_detected'));
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const chosen = selectDriver(ctx, driver.id);
      if (onPick) onPick(chosen);
    });
    const desc = driverDesc(t, driver);
    const el = h('label', { class: 'ff-radio' },
      input,
      h('span', { class: 'ff-radio__text' },
        h('span', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
          h('span', null, driver.displayName), badge),
        h('span', { class: 'ff-radio__desc', style: { fontFamily: 'var(--ff-font-mono)' } }, driverSpec(t, driver)),
        desc ? h('span', { class: 'ff-radio__desc' }, desc) : null));
    return { driver, input, badge, el };
  });
  const el = h('div', { role: 'radiogroup', 'aria-label': t('prn_section_driver') }, ...rows.map((r) => r.el));

  function set(name) {
    const current = currentDriver(ctx.settings);
    const guess = detectedDriver(name, current);
    rows.forEach((r) => {
      r.input.checked = r.driver.id === current.id;
      r.badge.hidden = !(guess && guess.id === r.driver.id);
    });
  }

  set(null);
  return { el, set };
}

function modeLabel(t, info) {
  const mode = (info && info.writeMode) || 'auto';
  if (mode === 'auto' && info && info.chunk === 20) return t('prn_mode_auto_small');
  return t(MODE_KEYS[mode] || 'prn_mode_auto');
}

/** Pezzi e pause predefiniti del driver (le TransportHints di docs/DRIVERS.md). */
function transportOf(driver) {
  const dt = (driver && driver.defaultTransport) || {};
  return {
    chunk: Number.isFinite(dt.chunkSize) ? dt.chunkSize : 20,
    delay: Number.isFinite(dt.chunkDelayMs) ? dt.chunkDelayMs : 15,
  };
}

/**
 * Preset attivo: 'auto' (predefiniti del driver), l'id di un preset, oppure null (valori a mano).
 * I preset scrivono tutti senza conferma: con bleWithoutResponse a false nessuno li descrive.
 */
function activePreset(s) {
  if (s.bleWithoutResponse === false) return null;
  if (s.bleChunkSize == null && s.bleChunkDelayMs == null) return 'auto';
  const match = BLE_PRESETS.find((p) => p.chunk === s.bleChunkSize && p.delay === s.bleChunkDelayMs);
  return match ? match.id : null;
}

/** "Sicura · 20 B ogni 15 ms": come sta inviando un driver Phomemo. */
function presetSummary(t, s, driver) {
  const auto = transportOf(driver);
  const chunk = s.bleChunkSize == null ? auto.chunk : s.bleChunkSize;
  const delay = s.bleChunkDelayMs == null ? auto.delay : s.bleChunkDelayMs;
  const id = activePreset(s);
  const preset = BLE_PRESETS.find((p) => p.id === id);
  const name = id === 'auto' ? t('prn_preset_auto') : preset ? t(preset.key) : t('prn_preset_manual');
  return t('prn_preset_summary', name, chunk, delay);
}

function densityOf(s) {
  if (s.phomemoDensity != null) return clampInt(s.phomemoDensity, DENSITY_MIN, DENSITY_MAX, DENSITY_DEFAULT);
  return HEAT_TO_DENSITY[clampInt(s.heatLevel, 0, HEAT_MAX, 0)];
}

function widthBytesOf(s) {
  return WIDTH_BYTES.includes(Number(s.phomemoWidthBytes)) ? Number(s.phomemoWidthBytes) : WIDTH_DEFAULT;
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

  /** Nome annunciato dalla stampante abbinata o ricordata (null se non ce n'è una). */
  function knownName() {
    return state.name || info.name || null;
  }

  function hasDevice() {
    return !!(info.paired || info.remembered || state.name);
  }

  // --- Azioni ---------------------------------------------------------------------------------

  function runPair(mode, btn) {
    // Nome e driver di prima si leggono senza attese: la chiamata deve restare dentro il gesto.
    const beforeName = knownName();
    const beforeDriver = currentDriver(settings).id;
    // Prima la chiamata (gesto utente), poi tutto il resto.
    const pending = pairPrinter(ctx, mode);
    busyAction = true;
    if (btn && btn.setBusy) btn.setBusy(true);
    // Con la scelta del browser aperta le altre voci di abbinamento restano ferme.
    renderDetails();
    // L'esito compare nella scheda di stato; il toast serve quando il tocco è venuto da più in basso.
    const fromCard = !!(btn && statusCard.contains(btn));
    pending.then((result) => {
      info = safeInfo();
      if (mode === 'reconnect' || !result || !info.name || state.kind === 'error') return;
      // Dopo l'abbinamento il manager sceglie il driver dal nome (M02 Pro, BlueTooth Printer…):
      // se il nome l'ha confermato lo si dice, altrimenti la sezione Modello propone quello giusto.
      const driver = currentDriver(settings);
      const guess = detectedDriver(info.name, driver);
      toast(guess && guess.id === driver.id ? t('prn_paired_model', info.name, driver.displayName) : t('prn_paired', info.name));
      adoptDetectedDriver(ctx, beforeName, info.name, beforeDriver);
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
    // Una M02X non parla né ESC/POS né il protocollo delle M02: la prova uscirebbe come spazzatura.
    if (unsupportedPrinter(state)) {
      toast(t('prn_m02x_title'), { duration: 7000 });
      return;
    }
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
  // Modello riconosciuto ma con un protocollo che FotoFlash non parla (M02X): meglio dirlo subito.
  const modelNote = notice({ kind: 'warn', icon: 'warning', children: [
    h('p', { style: { fontWeight: '700' } }, t('prn_m02x_title')),
    h('p', { style: { marginTop: '4px' } }, t('prn_m02x_body')),
  ] });
  modelNote.hidden = true;
  const statusCard = h('section', { class: 'ff-status', 'aria-labelledby': statusTitleId },
    h('div', { class: 'ff-status__head' }, statusIcon, h('div', { class: 'ff-grow' }, statusTitle, statusBody)),
    pill.el,
    modelNote,
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
        // Collegata ma di un modello che FotoFlash non parla (M02X): «pronta» sarebbe una promessa falsa.
        if (unsupportedPrinter(state)) return { icon: 'warning', title: t('prn_m02x_title'), body: t('prn_m02x_body') };
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
    if (unsupportedPrinter(state) && kind !== 'connecting' && kind !== 'printing') {
      // Modello non supportato (M02X): l'azione utile è abbinare un'altra stampante, non provare
      // né ricollegare questa.
      const other = flashButton(t('prn_action_pair_other'), { icon: 'bluetooth', onClick: () => runPair('pair', other) });
      out.push(other);
      if (kind === 'ready') {
        out.push(ghostButton(t('prn_action_disconnect'), { onClick: () => printer.disconnect() }));
      } else {
        const all = textButton(t('prn_action_pair_all'), { onClick: () => runPair('all', all) });
        out.push(all);
      }
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
    const unsupportedModelNow = supported && (unsupportedPrinter(state) || isUnsupportedModel(knownName()));
    // Da pronta lo dice già il titolo della scheda; negli altri stati (scollegata, errore) l'avviso.
    modelNote.hidden = !unsupportedModelNow || state.kind === 'ready';
    statusProgress.el.hidden = state.kind !== 'printing';
    if (state.kind === 'printing') statusProgress.set(Number(state.progress) || 0);
    // Pulsanti ricostruiti solo quando cambia davvero lo stato, non a ogni punto percentuale.
    const key = `${state.kind}|${state.failure || ''}|${hasDevice()}|${rememberedOnly(state)}|${unsupportedModelNow}`;
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
  const kvDriver = h('span', { class: 'ff-kv__value' });
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
      h('div', { class: 'ff-kv' }, h('span', { class: 'ff-kv__key' }, t('prn_detail_driver')), kvDriver),
      h('div', { class: 'ff-kv' }, h('span', { class: 'ff-kv__key' }, t('prn_detail_channel')), kvChannel),
      h('div', { class: 'ff-kv' }, h('span', { class: 'ff-kv__key' }, t('prn_detail_mode')), kvMode)),
    h('div', { class: 'ff-card', style: { marginTop: '12px' } }, otherBtn, allBtn, disconnectBtn, forgetBtn));

  function renderDetails() {
    const s = settings.get();
    const driver = driverById(s.printerDriver);
    detailsSection.hidden = !supported || !hasDevice();
    kvName.textContent = info.name || state.name || t('common_printer_unnamed');
    kvDriver.textContent = driver.displayName;
    kvChannel.textContent = info.characteristic
      ? `${info.profile || ''} · ${shortUuid(info.characteristic)}`.replace(/^ · /, '')
      : t('prn_detail_none');
    kvMode.textContent = isPhomemo(driver) ? presetSummary(t, s, driver) : modeLabel(t, info);
    disconnectBtn.hidden = !info.connected;
    forgetBtn.hidden = !(info.paired || info.remembered);
    const working = state.kind === 'connecting' || state.kind === 'printing' || busyAction;
    [otherBtn, allBtn].forEach((b) => {
      b.disabled = working;
    });
  }

  // --- Modello della stampante (driver) ---------------------------------------------------------

  const s0 = settings.get();
  let suggested = null;
  const driverPick = driverPicker(ctx);
  const suggestText = h('p', null);
  const suggestBtn = ghostButton(t('prn_driver_use_generic'), {
    small: true,
    onClick: () => {
      if (suggested) selectDriver(ctx, suggested.id);
    },
  });
  const suggestBox = notice({ kind: 'info', icon: 'sparkles', children: [
    suggestText,
    h('div', { style: { marginTop: '10px' } }, suggestBtn),
  ] });
  const suggestBlock = h('div', { class: 'ff-block' }, suggestBox);
  suggestBlock.hidden = true;
  const driverSection = h('div', null,
    sectionHeader(t('prn_section_driver')),
    card(
      h('p', { class: 'ff-block ff-small ff-muted' }, t('prn_driver_hint')),
      suggestBlock,
      driverPick.el));

  /** Il nome della stampante dice un altro modello: lo si propone, senza cambiarlo di nascosto. */
  function paintSuggestion() {
    const name = knownName();
    const current = currentDriver(settings);
    const guess = detectedDriver(name, current);
    suggested = guess && guess.id !== current.id ? guess : null;
    suggestBlock.hidden = !suggested;
    if (!suggested) return;
    suggestText.textContent = t('prn_driver_suggest', name, suggested.displayName);
    suggestBtn.setText(t('prn_driver_use', suggested.displayName));
  }

  // --- Carta ------------------------------------------------------------------------------------

  const paperHint = h('span', { class: 'ff-block__desc' });
  const paperChips = chipsRow(['MM58', 'MM80'], currentDriver(settings).paper === 'MM80' ? 'MM80' : 'MM58',
    (v) => t(v === 'MM80' ? 'prn_paper_80' : 'prn_paper_58'),
    // Le chip 58/80 mm sono un altro modo di scegliere fra escpos-58 ed escpos-80.
    (v) => selectDriver(ctx, driverForPaper(v, currentDriver(settings).id).id),
    { ariaLabel: t('prn_paper_width') });
  const escposPaperBlock = h('div', { class: 'ff-block' },
    h('span', { class: 'ff-block__label' }, t('prn_paper_width')),
    paperHint,
    paperChips.el);
  const fixedPaperHint = h('span', { class: 'ff-block__desc' });
  const phomemoPaperBlock = h('div', { class: 'ff-block' },
    h('span', { class: 'ff-block__label' }, t('prn_paper_width')),
    fixedPaperHint);
  const widthChips = chipsRow(WIDTH_BYTES, widthBytesOf(s0),
    (v) => t(v === 78 ? 'prn_width_78' : 'prn_width_72'),
    (v) => save(settings, { phomemoWidthBytes: v }), { ariaLabel: t('prn_width_title') });
  const widthBlock = h('div', { class: 'ff-block' },
    h('span', { class: 'ff-block__label' }, t('prn_width_title')),
    h('span', { class: 'ff-block__desc' }, t('prn_width_hint')),
    widthChips.el);
  const feed = slider({
    label: t('prn_feed_lines'),
    min: 0,
    max: FEED_MAX,
    step: 1,
    value: clampInt(s0.feedLines, 0, FEED_MAX, 4),
    format: (v) => t('prn_feed_lines_value', v),
    desc: t('prn_feed_lines_hint'),
    onChange: (v) => save(settings, { feedLines: v }),
  });
  const cut = toggle({
    label: t('prn_cut'),
    desc: t('prn_cut_hint'),
    icon: 'cut',
    checked: !!s0.cutPaper,
    onChange: (on) => save(settings, { cutPaper: on }),
  });
  const paperSection = h('div', null,
    sectionHeader(t('prn_section_paper')),
    card(
      escposPaperBlock,
      phomemoPaperBlock,
      widthBlock,
      divider(),
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
    onChange: (v) => save(settings, { heatLevel: v }),
  });
  const density = slider({
    label: t('prn_density_title'),
    min: DENSITY_MIN,
    max: DENSITY_MAX,
    step: 1,
    value: densityOf(s0),
    format: (v) => t('prn_density_value', v, DENSITY_MAX),
    desc: `${t('prn_density_hint')} ${t('prn_recommended', DENSITY_DEFAULT)}`,
    onChange: (v) => save(settings, { phomemoDensity: v }),
  });
  const speedOn = toggle({
    label: t('prn_speed_title'),
    desc: t('prn_speed_hint'),
    icon: 'tune',
    checked: s0.printerSpeed != null,
    onChange: (on) => save(settings, { printerSpeed: on ? SPEED_START : null }),
  });
  const speed = slider({
    label: t('prn_speed_level'),
    min: SPEED_MIN,
    max: SPEED_MAX,
    step: 1,
    value: clampInt(s0.printerSpeed, SPEED_MIN, SPEED_MAX, SPEED_START),
    format: (v) => t('prn_speed_value', v, SPEED_MAX),
    desc: t('prn_speed_level_hint'),
    onChange: (v) => save(settings, { printerSpeed: v }),
  });
  const heatTest = ghostButton(t('prn_action_test'), { icon: 'paper', block: true, onClick: () => runTestPage(heatTest) });
  const heatSection = h('div', null,
    sectionHeader(t('prn_section_heat')),
    card(heat.el, density.el, speedOn.el, speed.el, h('div', { class: 'ff-block' }, heatTest)));

  // --- Invio: ESC/POS (strategia del bridge) --------------------------------------------------

  const modeName = uniqueId('ff-write-mode');
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
        h('span', { class: 'ff-radio__desc' }, t(MODE_DESC_KEYS[mode]))))));
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
    onChange: (i) => save(settings, { bandHeight: BAND_STEPS[i] }),
  });
  const resetTransfer = textButton(t('prn_reset'), {
    icon: 'refresh',
    onClick: () => {
      Ble.setWriteMode('auto');
      save(settings, { bandHeight: BAND_DEFAULT });
      band.set(bandIndex(BAND_DEFAULT));
      info = safeInfo();
      paintMode();
      renderDetails();
      toast(t('prn_reset_done'));
    },
  });
  const escposTransfer = h('div', null,
    h('div', { class: 'ff-block' }, h('span', { class: 'ff-block__label' }, t('prn_mode_title'))),
    modeGroup,
    h('p', { class: 'ff-block ff-small ff-muted' }, t('prn_mode_hint')),
    divider(),
    band.el,
    h('div', { class: 'ff-block' }, resetTransfer));

  // --- Invio: Phomemo (preset di pezzi e pause, senza conferma) -------------------------------

  const presetName = uniqueId('ff-preset');
  const autoDesc = h('span', { class: 'ff-radio__desc' });
  const presetRows = [
    { id: 'auto', title: t('prn_preset_auto'), descEl: autoDesc },
    ...BLE_PRESETS.map((p) => ({
      id: p.id,
      title: t(p.key),
      descEl: h('span', { class: 'ff-radio__desc' }, `${t('prn_preset_spec', p.chunk, p.delay)}. ${t(p.descKey)}`),
      preset: p,
    })),
  ].map((row) => {
    const input = h('input', { type: 'radio', name: presetName, value: row.id });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      if (row.preset) {
        save(settings, { bleChunkSize: row.preset.chunk, bleChunkDelayMs: row.preset.delay, bleWithoutResponse: true });
      } else {
        save(settings, { bleChunkSize: null, bleChunkDelayMs: null, bleWithoutResponse: null });
      }
    });
    const el = h('label', { class: 'ff-radio' },
      input,
      h('span', { class: 'ff-radio__text' }, h('span', null, row.title), row.descEl));
    return { id: row.id, input, el };
  });
  const presetGroup = h('div', { role: 'radiogroup', 'aria-label': t('prn_preset_title') }, ...presetRows.map((r) => r.el));
  const presetManual = h('p', { class: 'ff-block ff-small' });
  const presetTest = ghostButton(t('prn_action_test'), { icon: 'paper', block: true, onClick: () => runTestPage(presetTest) });
  const resetPreset = textButton(t('prn_reset'), {
    icon: 'refresh',
    onClick: () => {
      save(settings, { bleChunkSize: null, bleChunkDelayMs: null, bleWithoutResponse: null });
      toast(t('prn_reset_done'));
    },
  });
  const phomemoTransfer = h('div', null,
    h('div', { class: 'ff-block' }, h('span', { class: 'ff-block__label' }, t('prn_preset_title'))),
    presetGroup,
    presetManual,
    h('p', { class: 'ff-block ff-small ff-muted' }, t('prn_preset_why')),
    divider(),
    h('div', { class: 'ff-block ff-stack' },
      h('p', { class: 'ff-small ff-muted' }, t('prn_preset_test_hint')),
      presetTest,
      h('div', null, resetPreset)));

  function paintPresets(s, driver) {
    const auto = transportOf(driver);
    autoDesc.textContent = `${t('prn_preset_spec', auto.chunk, auto.delay)}. ${t('prn_preset_auto_desc')}`;
    const active = activePreset(s);
    presetRows.forEach((r) => {
      r.input.checked = r.id === active;
    });
    // Valori che nessun preset descrive (scritti da una versione futura o a mano): si dicono.
    presetManual.hidden = active !== null;
    if (active === null) {
      presetManual.textContent = t('prn_preset_current', s.bleChunkSize == null ? auto.chunk : s.bleChunkSize,
        s.bleChunkDelayMs == null ? auto.delay : s.bleChunkDelayMs);
    }
  }

  const transferSection = h('div', null,
    sectionHeader(t('prn_section_transfer')),
    card(escposTransfer, phomemoTransfer));

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
    ['prn_tip_garbled_title', 'prn_tip_garbled_body'],
    ['prn_tip_pale_title', 'prn_tip_pale_body'],
    ['prn_tip_broken_title', 'prn_tip_broken_body'],
    ['prn_tip_busy_title', 'prn_tip_busy_body'],
    ['prn_tip_missing_title', 'prn_tip_missing_body'],
  ];
  if (!iOS) tips.splice(5, 0, ['prn_tip_location_title', 'prn_tip_location_body']);
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
    // Il modello decide anche la larghezza della stampa: serve pure dove non si stampa (esportazioni).
    driverSection,
    paperSection,
    supported ? heatSection : null,
    supported ? transferSection : null,
    supported ? diagSection : null,
    supported ? helpSection : null,
    supported ? compatSection : null);

  root.appendChild(h('div', { class: 'ff-screen' },
    topBar({ title: t('prn_title'), onBack: () => router.back() }),
    content));

  /** Tutto ciò che dipende dal driver e dalle impostazioni: i controlli dell'altra famiglia spariscono. */
  function paintSettings(next) {
    const s = next || settings.get();
    const driver = driverById(s.printerDriver);
    const phomemo = isPhomemo(driver);
    driverPick.set(knownName());
    paintSuggestion();
    // Carta: 58/80 mm solo per le ESC/POS; i Phomemo hanno la larghezza del modello.
    escposPaperBlock.hidden = phomemo;
    phomemoPaperBlock.hidden = !phomemo;
    widthBlock.hidden = widthOptionsOf(driver).length < 2;
    cut.el.hidden = phomemo;
    if (!phomemo) paperChips.set(driver.paper === 'MM80' ? 'MM80' : 'MM58');
    paperHint.textContent = t('prn_paper_width_hint', driver.dots);
    // Con 78 byte per riga la M02 Pro stampa 624 punti: il testo segue la larghezza scelta sotto.
    const rasterDots = typeof driver.rasterShape === 'function'
      ? driver.rasterShape({ widthBytes: widthBytesOf(s) }).dots
      : driver.dots;
    fixedPaperHint.textContent = t('prn_paper_fixed', rasterDots, driver.dpi);
    widthChips.set(widthBytesOf(s));
    feed.set(clampInt(s.feedLines, 0, FEED_MAX, 4));
    cut.set(!!s.cutPaper);
    // Intensità: ESC 7 per le ESC/POS, densità 1..15 (più la velocità sperimentale) per i Phomemo.
    heat.el.hidden = phomemo;
    density.el.hidden = !phomemo;
    speedOn.el.hidden = !phomemo;
    speed.el.hidden = !phomemo || s.printerSpeed == null;
    heat.set(clampInt(s.heatLevel, 0, HEAT_MAX, 0));
    density.set(densityOf(s));
    speedOn.set(s.printerSpeed != null);
    speed.set(clampInt(s.printerSpeed, SPEED_MIN, SPEED_MAX, SPEED_START));
    // Invio: modalità del bridge per le ESC/POS, preset di pezzi e pause per i Phomemo.
    escposTransfer.hidden = phomemo;
    phomemoTransfer.hidden = !phomemo;
    band.set(bandIndex(s.bandHeight || BAND_DEFAULT));
    paintPresets(s, driver);
    renderDetails();
  }

  function refresh(force) {
    info = safeInfo();
    renderStatus(force);
    renderDetails();
    renderDiagGate();
    driverPick.set(knownName());
    paintSuggestion();
    const working = state.kind === 'printing' || state.kind === 'connecting';
    heatTest.disabled = working || !hasDevice() || unsupportedPrinter(state);
    presetTest.disabled = heatTest.disabled;
  }

  paintMode();
  paintSettings();
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
  cleanups.push(settings.subscribe((next) => paintSettings(next)));

  return () => {
    cleanups.forEach((fn) => {
      if (typeof fn === 'function') fn();
    });
  };
}

function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
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
