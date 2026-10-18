// Impostazioni: come SettingsScreen dell'app (stampante, immagine, evento, scatto) più la sezione App
// della versione web (installazione, lingua, versione, APK, GitHub, licenze dei font, cancella dati).
import { h, clear } from '../dom.js';
import { icon, wordmark } from '../icons.js';
import {
  topBar, sectionHeader, card, divider, chipsRow, slider, toggle, textField, listItem, printerPill,
  ghostButton, textButton, toast, confirmDialog, sheet,
} from '../components.js';
import { langSetting, setLang } from '../../i18n/i18n.js';
import { VERSION } from '../../version.js';
import { defaultTone, DitherAlgorithm, TemplateKind } from '../../core/model.js';
import { APK_URL, rememberedOnly } from './printer.js';

const GITHUB_URL = 'https://github.com/nb-camelot/fotoflash';
const OFL_URL = 'https://openfontlicense.org';
const MAX_EVENT_TITLE = 32;
const MAX_HASHTAG = 32;
const TEXT_DEBOUNCE_MS = 500;
const TIMER_OPTIONS = [0, 3, 10];
const STRIP_OPTIONS = [3, 4];
const STORAGE_PREFIX = 'fotoflash.';

const DITHER_KEYS = {
  ATKINSON: ['set_dither_atkinson', 'set_dither_desc_atkinson'],
  FLOYD_STEINBERG: ['set_dither_floyd', 'set_dither_desc_floyd'],
  ORDERED_BAYER: ['set_dither_bayer', 'set_dither_desc_bayer'],
  THRESHOLD: ['set_dither_threshold', 'set_dither_desc_threshold'],
};
const TEMPLATE_KEYS = {
  POLAROID: 'set_template_polaroid',
  FULL: 'set_template_full',
  STRIP: 'set_template_strip',
  RECEIPT: 'set_template_receipt',
};

// Formati numerici come nell'app: sono cifre e segni, non testi da tradurre.
const formatSigned = (v) => {
  const p = Math.round(v * 100);
  return p > 0 ? `+${p}` : String(p);
};
const formatPercent = (v) => `${Math.round(v * 100)}%`;
const formatDecimal = (v) => Number(v).toFixed(2);

export function mount(root, ctx) {
  const { t, settings, printer, router, install, history } = ctx;
  const cleanups = [];
  const s0 = settings.get();
  const tone0 = { ...defaultTone(), ...(s0.tone || {}) };
  // Chi aggiorna i controlli quando le impostazioni cambiano altrove.
  const sync = [];

  const update = (patch) => {
    try {
      const r = settings.update(patch);
      if (r && typeof r.catch === 'function') r.catch((e) => console.error('[settings] non salvata', e));
    } catch (e) {
      console.error('[settings] non salvata', e);
    }
  };
  const updateTone = (key, value) => {
    const current = { ...defaultTone(), ...(settings.get().tone || {}) };
    update({ tone: { ...current, [key]: value } });
  };

  // --- Stampante ------------------------------------------------------------------------------

  const pill = printerPill(printer.state, null);
  const printerTitle = h('span', { class: 'ff-item__title' });
  const printerDesc = h('span', { class: 'ff-item__desc' });
  const printerRow = h('button', {
    type: 'button',
    class: 'ff-item',
    'aria-label': null,
    onClick: () => router.go('/printer'),
  },
  h('span', { class: 'ff-disc', 'aria-hidden': 'true' }, icon('print')),
  h('span', { class: 'ff-item__body' },
    printerTitle,
    printerDesc,
    h('span', { style: { marginTop: '8px' } }, pill.el)),
  icon('chevron', { size: 20, className: 'ff-item__icon' }),
  h('span', { class: 'ff-sr-only' }, t('set_printer_open_cd')));

  function paintPrinter(state = printer.state) {
    const st = state || {};
    // Anche la stampante ricordata da una visita precedente conta: la pillola la mostra per nome.
    const paired = !!st.name && st.kind !== 'unsupported' && (st.kind !== 'not-paired' || rememberedOnly(st));
    printerTitle.textContent = paired ? st.name : t('set_printer_none');
    const mm = settings.get().paper === 'MM80' ? 80 : 58;
    printerDesc.textContent = paired ? t('set_printer_paper', mm) : t('set_printer_hint_none');
    pill.set(st);
  }
  cleanups.push(printer.subscribe((state) => paintPrinter(state)));
  sync.push(() => paintPrinter());

  // --- Immagine ---------------------------------------------------------------------------------

  const ditherDesc = h('span', { class: 'ff-block__desc' });
  const paintDither = (algo) => {
    ditherDesc.textContent = t((DITHER_KEYS[algo] || DITHER_KEYS.ATKINSON)[1]);
  };
  const ditherOptions = Array.isArray(DitherAlgorithm) && DitherAlgorithm.length ? DitherAlgorithm : Object.keys(DITHER_KEYS);
  const dither = chipsRow(ditherOptions, s0.dither || 'ATKINSON',
    (v) => t((DITHER_KEYS[v] || [v])[0]),
    (v) => {
      paintDither(v);
      update({ dither: v });
    }, { ariaLabel: t('set_dither_label') });
  paintDither(s0.dither || 'ATKINSON');
  sync.push((v) => {
    dither.set(v.dither || 'ATKINSON');
    paintDither(v.dither || 'ATKINSON');
  });

  const toneSlider = (key, label, min, max, format, desc) => {
    const control = slider({
      label: t(label),
      desc: desc ? t(desc) : undefined,
      min,
      max,
      step: 0.05,
      value: tone0[key],
      format,
      onChange: (v) => updateTone(key, v),
    });
    sync.push((v) => control.set(({ ...defaultTone(), ...(v.tone || {}) })[key]));
    return control.el;
  };
  const toneToggle = (key, label, desc, iconName) => {
    const control = toggle({
      label: t(label),
      desc: t(desc),
      icon: iconName,
      checked: !!tone0[key],
      onChange: (on) => updateTone(key, on),
    });
    sync.push((v) => control.set(!!({ ...defaultTone(), ...(v.tone || {}) })[key]));
    return control.el;
  };

  const imageReset = textButton(t('set_image_reset'), {
    icon: 'refresh',
    onClick: () => {
      update({ dither: 'ATKINSON', tone: defaultTone() });
      runSync();
      toast(t('set_image_reset_done'));
    },
  });

  const imageCard = card(
    h('div', { class: 'ff-block' },
      h('span', { class: 'ff-block__label' }, t('set_dither_label')),
      ditherDesc,
      dither.el),
    divider(),
    toneSlider('brightness', 'set_brightness', -1, 1, formatSigned),
    toneSlider('contrast', 'set_contrast', -1, 1, formatSigned),
    toneSlider('shadows', 'set_shadows', 0, 1, formatPercent, 'set_shadows_desc'),
    toneSlider('localContrast', 'set_local_contrast', 0, 1, formatPercent, 'set_local_contrast_desc'),
    toneSlider('sharpen', 'set_sharpen', 0, 1, formatPercent),
    toneSlider('gamma', 'set_gamma', 0.4, 2.5, formatDecimal),
    divider(),
    toneToggle('autoLevels', 'set_auto_levels', 'set_auto_levels_desc', 'sparkles'),
    toneToggle('autoBacklight', 'set_auto_backlight', 'set_auto_backlight_desc', 'sun'),
    divider(),
    h('div', { class: 'ff-block ff-row', style: { flexWrap: 'nowrap' } },
      h('p', { class: 'ff-small ff-muted ff-grow' }, t('set_image_help')),
      imageReset));

  // --- Evento -----------------------------------------------------------------------------------

  const pendingText = new Map();
  const commitText = (key, value) => {
    clearTimeout(pendingText.get(key));
    pendingText.delete(key);
    const clean = value.trim();
    if ((settings.get()[key] || '') !== clean) update({ [key]: clean });
  };
  const debounceText = (key, value) => {
    clearTimeout(pendingText.get(key));
    pendingText.set(key, setTimeout(() => commitText(key, value), TEXT_DEBOUNCE_MS));
  };
  const titleField = textField({
    label: t('set_event_title'),
    value: s0.eventTitle || '',
    placeholder: t('set_event_title_placeholder'),
    maxLength: MAX_EVENT_TITLE,
    enterKeyHint: 'next',
    onInput: (v) => debounceText('eventTitle', v),
    onCommit: (v) => commitText('eventTitle', v),
  });
  const hashtagField = textField({
    label: t('set_hashtag'),
    value: s0.hashtag || '',
    placeholder: t('set_hashtag_placeholder'),
    maxLength: MAX_HASHTAG,
    hint: t('set_event_help'),
    autocapitalize: 'none',
    onInput: (v) => debounceText('hashtag', v),
    onCommit: (v) => commitText('hashtag', v),
  });
  sync.push((v) => {
    // Mai sotto le dita di chi sta scrivendo.
    if (document.activeElement !== titleField.input && !pendingText.has('eventTitle')) titleField.set(v.eventTitle || '');
    if (document.activeElement !== hashtagField.input && !pendingText.has('hashtag')) hashtagField.set(v.hashtag || '');
  });

  const boolToggle = (key, label, desc, iconName) => {
    const control = toggle({
      label: t(label),
      desc: desc ? t(desc) : undefined,
      icon: iconName,
      checked: !!s0[key],
      onChange: (on) => update({ [key]: on }),
    });
    sync.push((v) => control.set(!!v[key]));
    return control.el;
  };

  const counterValue = h('span', { class: 'ff-item__desc ff-mono' });
  const counterReset = ghostButton(t('set_counter_reset'), {
    small: true,
    onClick: async () => {
      const ok = await confirmDialog({
        title: t('set_counter_reset_title'),
        message: t('set_counter_reset_message'),
        confirmText: t('set_counter_reset'),
        cancelText: t('set_cancel'),
        danger: true,
      });
      if (!ok) return;
      update({ printCounter: 0 });
      paintCounter(0);
      toast(t('set_counter_reset_done'));
    },
  });
  function paintCounter(n) {
    const count = Math.max(0, Number(n) || 0);
    counterValue.textContent = count > 0 ? t('set_counter_value', count) : t('set_counter_zero');
    counterReset.disabled = count <= 0;
  }
  paintCounter(s0.printCounter);
  sync.push((v) => paintCounter(v.printCounter));

  const templateOptions = Array.isArray(TemplateKind) && TemplateKind.length ? TemplateKind : Object.keys(TEMPLATE_KEYS);
  const template = chipsRow(templateOptions, s0.template || 'POLAROID',
    (v) => t(TEMPLATE_KEYS[v] || v),
    (v) => update({ template: v }), { ariaLabel: t('set_default_template') });
  sync.push((v) => template.set(v.template || 'POLAROID'));

  const eventCard = card(
    titleField.el,
    hashtagField.el,
    divider(),
    boolToggle('showDate', 'set_show_date', null, 'event'),
    boolToggle('showPrintNumber', 'set_show_number', 'set_show_number_desc', 'ticket'),
    h('div', { class: 'ff-item' },
      h('span', { class: 'ff-item__icon', 'aria-hidden': 'true' }),
      h('span', { class: 'ff-item__body' }, h('span', { class: 'ff-item__title' }, t('set_counter')), counterValue),
      counterReset),
    divider(),
    h('div', { class: 'ff-block' },
      h('span', { class: 'ff-block__label' }, t('set_default_template')),
      template.el));

  // --- Scatto -----------------------------------------------------------------------------------

  const timer = chipsRow(TIMER_OPTIONS, Number(s0.timerSeconds) || 0,
    (v) => (v === 0 ? t('set_timer_off') : t('set_timer_seconds', v)),
    (v) => update({ timerSeconds: v }), { ariaLabel: t('set_timer') });
  sync.push((v) => timer.set(Number(v.timerSeconds) || 0));
  const strip = chipsRow(STRIP_OPTIONS, Number(s0.stripShots) || 3,
    (v) => t('set_strip_shots_value', v),
    (v) => update({ stripShots: v }), { ariaLabel: t('set_strip_shots') });
  sync.push((v) => strip.set(Number(v.stripShots) || 3));

  const captureCard = card(
    boolToggle('instantPrint', 'set_instant_print', 'set_instant_print_desc', 'bolt'),
    divider(),
    h('div', { class: 'ff-block' }, h('span', { class: 'ff-block__label' }, t('set_timer')), timer.el),
    h('div', { class: 'ff-block' }, h('span', { class: 'ff-block__label' }, t('set_strip_shots')), strip.el),
    divider(),
    boolToggle('shutterSound', 'set_shutter_sound', null, 'sound'),
    boolToggle('livePreview', 'set_live_preview', 'set_live_preview_desc', 'grain'),
    boolToggle('autoDownloadCaptures', 'set_auto_download', 'set_auto_download_desc', 'download'));

  // --- App --------------------------------------------------------------------------------------

  const installSlot = h('div');
  function paintInstall() {
    clear(installSlot);
    if (install && install.installed && install.installed()) {
      installSlot.appendChild(listItem({ icon: 'check', title: t('set_installed'), desc: t('set_installed_desc') }));
      installSlot.appendChild(divider());
    } else if (install && install.available && install.available()) {
      installSlot.appendChild(listItem({
        icon: 'install',
        title: t('set_install'),
        desc: t('set_install_desc'),
        chevron: true,
        onClick: async () => {
          const outcome = await install.prompt();
          if (outcome === 'dismissed') toast(t('set_install_dismissed'));
          paintInstall();
        },
      }));
      installSlot.appendChild(divider());
    }
  }
  paintInstall();
  if (install && typeof install.subscribe === 'function') cleanups.push(install.subscribe(paintInstall));

  const language = chipsRow(['auto', 'en', 'it'], langSetting(),
    (v) => t(`set_language_${v}`),
    (v) => setLang(v === 'auto' ? null : v), { ariaLabel: t('set_language') });

  const appCard = card(
    installSlot,
    h('div', { class: 'ff-block' },
      h('span', { class: 'ff-block__label' }, t('set_language')),
      language.el),
    divider(),
    listItem({ icon: 'info', title: t('set_version'), value: VERSION }),
    divider(),
    listItem({ icon: 'android', title: t('set_apk'), desc: t('set_apk_desc'), href: APK_URL, external: true }),
    listItem({ icon: 'code', title: t('set_github'), desc: t('set_github_desc'), href: GITHUB_URL, external: true }),
    listItem({ icon: 'doc', title: t('set_licenses'), desc: t('set_licenses_desc'), chevron: true, onClick: showLicenses }),
    divider(),
    listItem({ icon: 'trash', title: t('set_clear'), desc: t('set_clear_desc'), danger: true, onClick: clearData }));

  function showLicenses() {
    const block = (name, text) => h('div', { class: 'ff-license' },
      h('span', { class: 'ff-license__name' }, name),
      h('span', { class: 'ff-license__text' }, text));
    sheet({
      title: t('set_licenses_title'),
      content: h('div', null,
        block(t('set_font_righteous'), t('set_license_righteous')),
        block(t('set_font_space_mono'), t('set_license_space_mono')),
        h('p', { style: { margin: '4px 0 12px' } }, t('set_licenses_ofl')),
        h('div', { class: 'ff-card' },
          listItem({ icon: 'doc', title: t('set_licenses_read'), href: OFL_URL, external: true }))),
    });
  }

  async function clearData() {
    const ok = await confirmDialog({
      title: t('set_clear_title'),
      message: t('set_clear_message'),
      confirmText: t('set_clear_confirm'),
      cancelText: t('set_cancel'),
      danger: true,
    });
    if (!ok) return;
    const problems = [];
    try {
      // clear() svuota voci e file in una transazione (anche quelli rimasti orfani).
      if (typeof history.clear === 'function') {
        await history.clear();
      } else {
        const entries = await history.list();
        for (const entry of entries || []) await history.remove(entry.id);
      }
    } catch (e) {
      problems.push(e);
    }
    try {
      await printer.forget();
    } catch (e) {
      problems.push(e);
    }
    try {
      await settings.reset();
    } catch (e) {
      problems.push(e);
    }
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch (e) {
      problems.push(e);
    }
    if (ctx.session && typeof ctx.session.clear === 'function') ctx.session.clear();
    if (problems.length) {
      console.error('[settings] cancellazione incompleta', problems);
      toast(t('set_clear_failed', problems[0].message || String(problems[0])), { duration: 8000 });
      return;
    }
    // Si riparte da zero: senza hash l'avvio porta all'onboarding.
    location.replace(location.pathname + location.search);
  }

  // --- Montaggio --------------------------------------------------------------------------------

  const footer = h('div', { class: 'ff-brand-footer' },
    wordmark({ height: 24, label: t('app_name') }),
    h('p', { class: 'ff-brand-footer__tagline' }, t('set_tagline')));

  root.appendChild(h('div', { class: 'ff-screen' },
    topBar({ title: t('set_title'), onBack: () => router.back() }),
    h('div', { class: 'ff-content' },
      sectionHeader(t('set_section_printer')),
      card(printerRow),
      sectionHeader(t('set_section_image')),
      imageCard,
      sectionHeader(t('set_section_event')),
      eventCard,
      sectionHeader(t('set_section_capture')),
      captureCard,
      sectionHeader(t('set_section_app')),
      appCard,
      footer)));

  function runSync(next) {
    const v = next || settings.get();
    sync.forEach((fn) => fn(v));
  }
  paintPrinter();
  cleanups.push(settings.subscribe((next) => runSync(next)));

  return () => {
    // I testi ancora in attesa del salvataggio si salvano uscendo, come nell'app.
    commitText('eventTitle', titleField.input.value);
    commitText('hashtag', hashtagField.input.value);
    cleanups.forEach((fn) => {
      if (typeof fn === 'function') fn();
    });
  };
}
