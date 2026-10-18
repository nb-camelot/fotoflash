// Editor e stampa (porting di EditorScreen.kt + EditorViewModel.kt): anteprima WYSIWYG sul foglio
// di carta, modelli, didascalia, regolazioni, retino e copie. "Stampa" è sempre visibile: dallo
// scatto alla carta bastano due tocchi.

import { h as hRaw, clear } from '../dom.js';
import { icon } from '../icons.js';
import {
  topBar, flashButton, ghostButton, iconButton, paperSheet, thermalImage, chipsRow, slider, toggle,
  sectionHeader, printerPill, emptyState, toast,
} from '../components.js';
import { TemplateKind, DitherAlgorithm } from '../../core/model.js';
import { layoutTemplate } from '../../core/template.js';
import { backlightScore } from '../../core/backlight.js';
import { grayFromSource, releaseCanvas } from '../../render/bitmap.js';
import { shareFiles, downloadBlob, exportFileName } from '../../media/export.js';
import { createSamplePhoto } from '../sample-photo.js';
import {
  buildRequest, composeRequest, sameJob, printAndRecord, saveOnly, recordsSettled, openPrintSheet, paperCanvas,
  pngBlob, jpegBlobs, downloadOriginals, closePhotos,
} from '../print-sheet.js';

const MAX_CAPTION = 40;
const MIN_COPIES = 1;
const MAX_COPIES = 5;
/** Sopra questo punteggio la foto si considera in controluce (badge e suggerimento). */
const BACKLIGHT_THRESHOLD = 0.4;
/** Lato lungo, in pixel, del campione su cui si misura il controluce. */
const BACKLIGHT_SAMPLE_SIDE = 160;
const RENDER_DEBOUNCE_MS = 150;
/** Testina a 203 dpi: 8 punti per millimetro. */
const DOTS_PER_MM = 8;
/** Margine del "tavolo" ai lati del foglio quando c'è posto, e larghezza massima del foglio. */
const PREVIEW_BREATH = 16;
const PREVIEW_MAX_CSS = 640;

const TABS = ['template', 'text', 'adjust'];
const TAB_LABELS = { template: 'ed_tab_template', text: 'ed_tab_text', adjust: 'ed_tab_adjust' };
const DITHER_LABELS = {
  ATKINSON: 'ed_dither_atkinson',
  FLOYD_STEINBERG: 'ed_dither_floyd',
  ORDERED_BAYER: 'ed_dither_bayer',
  THRESHOLD: 'ed_dither_threshold',
};

let uid = 0;

/**
 * Modifiche in corso per ogni sessione di foto. Andando alla schermata Stampante e tornando
 * l'editor si rimonta, e modello, didascalia e regolazioni non devono perdersi (su Android il
 * ViewModel resta nello stack). La chiave è l'array delle foto della sessione: una sessione nuova
 * (session.set o clear creano un array nuovo) riparte dalle impostazioni.
 */
const drafts = new WeakMap();

/** h() senza figli vuoti: le parti facoltative si passano come null. */
function h(tag, props, ...children) {
  return hRaw(tag, props, ...children.flat().filter((c) => c != null && c !== false));
}

export function mount(root, ctx) {
  ensureStyle();
  const { t, settings, session, router, printer } = ctx;
  const screen = h('div', { class: 'ffed' });
  root.append(screen);

  const cleanups = [];
  let disposed = false;
  let sheetHandle = null;
  let saveDraft = null;

  const pill = printerPill(printer.state, () => router.go('#/printer'));
  cleanups.push(printer.subscribe((state) => pill.set(state)));

  const goBack = () => router.back();
  let photos = Array.from((session && session.photos) || []);

  if (photos.length === 0) showEmpty();
  else showEditor();

  // ---------------------------------------------------------------- sessione vuota

  function showEmpty() {
    clear(screen);
    let busy = false;
    const sample = ghostButton(t('ed_empty_sample'), { icon: 'sparkles', onClick: onSample });
    screen.append(
      topBar({ title: t('ed_title'), onBack: goBack }),
      h('div', { class: 'ffed-empty' },
        emptyState({
          icon: 'camera',
          title: t('ed_empty_title'),
          message: t('ed_empty_message'),
          actionText: t('ed_empty_action'),
          onAction: () => router.go('#/camera'),
        }),
        h('div', { class: 'ffed-empty-more' }, sample)),
    );

    async function onSample() {
      if (busy) return;
      busy = true;
      setDisabled(sample, true);
      try {
        const photo = await createSamplePhoto();
        if (disposed) return;
        session.set([photo], 'gallery', null);
        photos = [photo];
        showEditor();
      } catch (e) {
        console.error('[editor] foto di esempio non creata', e);
        toast(t('ed_sample_failed'));
        busy = false;
        setDisabled(sample, false);
      }
    }
  }

  // ---------------------------------------------------------------- editor

  function showEditor() {
    clear(screen);
    const start = settings.get();
    const suggested = session && session.suggestedTemplate;
    const draftKey = session && Array.isArray(session.photos) ? session.photos : null;
    const draft = (draftKey && drafts.get(draftKey)) || null;
    let template = draft ? draft.template : TemplateKind.includes(suggested) ? suggested : start.template;
    let caption = draft ? draft.caption : '';
    let tone = { ...(draft ? draft.tone : start.tone) };
    let dither = draft ? draft.dither : start.dither;
    let copies = draft ? draft.copies : clamp(Math.round(Number(start.copies) || 1), MIN_COPIES, MAX_COPIES);
    const defaultTone = { ...start.tone };
    const defaultDither = start.dither;
    saveDraft = () => {
      if (draftKey) drafts.set(draftKey, { template, caption, tone: { ...tone }, dither, copies });
    };

    /** Richiesta e risultato dell'ultimo rendering riuscito: salva e condividi partono da qui. */
    let current = null;
    /** Ultima stampa inviata: "Riprova" la riusa se nulla è cambiato (niente doppioni nello storico). */
    let lastSent = null;
    let renderToken = 0;
    let renderTimer = null;
    let renderPromise = Promise.resolve();
    let renderFailed = false;
    let backlightKey = null;
    let backlightScoreValue = 0;
    let exporting = false;
    let printBusy = false;
    let openTab = 'template';
    let previewCanvas = null;
    let sheetEl = null;
    /** Salvataggi e condivisioni in corso: le foto si liberano solo dopo che li hanno letti. */
    const inflight = new Set();

    // --- anteprima -------------------------------------------------------------------------

    const stage = h('div', { class: 'ffed-stage' });
    const renderLine = h('div', { class: 'ffed-renderline', attrs: { role: 'progressbar', 'aria-label': t('ed_rendering') } });
    renderLine.hidden = true;
    const badge = h('div', { class: 'ffed-badge', attrs: { role: 'status', 'aria-label': t('ed_backlight_detected_cd') } },
      icon('sun', { size: 16 }),
      h('span', { attrs: { 'aria-hidden': 'true' } }, t('ed_backlight_detected')));
    badge.hidden = true;
    // La pillola della stampante sta sopra l'anteprima, in alto a destra: nella barra coprirebbe il titolo.
    const stageWrap = h('div', { class: 'ffed-stagewrap' }, stage, renderLine, badge, h('div', { class: 'ffed-pill' }, pill.el));

    // --- schede ----------------------------------------------------------------------------

    const base = `ffed-${++uid}`;
    const tabButtons = {};
    const tabPanels = {};
    const tabList = h('div', { class: 'ffed-tabs', attrs: { role: 'tablist', 'aria-label': t('ed_tabs_label') } });
    for (const tab of TABS) {
      const btn = h('button', {
        class: 'ffed-tab',
        attrs: { type: 'button', role: 'tab', id: `${base}-tab-${tab}`, 'aria-controls': `${base}-panel-${tab}` },
        onClick: () => selectTab(tab),
        onKeydown: (e) => onTabKey(e, tab),
      }, h('span', {}, t(TAB_LABELS[tab])));
      tabButtons[tab] = btn;
      tabList.append(btn);
    }

    // Modello
    const templateDesc = h('p', { class: 'ffed-help' }, t(`ed_template_${template.toLowerCase()}_desc`));
    const templateChips = chipsRow([...TemplateKind], template, (k) => t(`ed_template_${k.toLowerCase()}`), (k) => {
      if (k === template) return;
      template = k;
      templateDesc.textContent = t(`ed_template_${k.toLowerCase()}_desc`);
      scheduleRender(true);
    }, { ariaLabel: t('ed_tab_template') });
    tabPanels.template = panel('template', templateChips.el, templateDesc);

    // Testo
    const captionId = `${base}-caption`;
    // Il contatore descrive il campo (si legge entrando), senza annunciare ogni tasto.
    const counter = h('span', { class: 'ffed-counter', attrs: { id: `${base}-counter` } }, t('ed_caption_counter', caption.length, MAX_CAPTION));
    const captionInput = h('input', {
      class: 'ffed-caption',
      attrs: {
        id: captionId,
        type: 'text',
        maxlength: String(MAX_CAPTION),
        placeholder: t('ed_caption_placeholder'),
        autocomplete: 'off',
        enterkeyhint: 'done',
        spellcheck: 'true',
        'aria-describedby': `${base}-counter`,
      },
      onInput: () => {
        // Una riga sola: a capo e tabulazioni diventano spazi, poi il limite della spec.
        const clean = captionInput.value.replace(/[\r\n\t]/g, ' ').slice(0, MAX_CAPTION);
        if (clean !== captionInput.value) captionInput.value = clean;
        setCaption(clean);
      },
      onKeydown: (e) => {
        if (e.key === 'Enter') captionInput.blur();
      },
    });
    const clearCaption = iconButton('close', {
      label: t('ed_caption_clear'),
      onClick: () => {
        captionInput.value = '';
        setCaption('');
        captionInput.focus();
      },
    });
    const clearWrap = h('div', { class: 'ffed-caption-clear' }, clearCaption);
    captionInput.value = caption;
    clearWrap.hidden = caption.length === 0;
    tabPanels.text = panel('text',
      h('label', { class: 'ffed-label', attrs: { for: captionId } }, t('ed_caption_label')),
      h('div', { class: 'ffed-caption-row' }, captionInput, clearWrap),
      h('div', { class: 'ffed-counter-row' }, counter),
      h('p', { class: 'ffed-help' }, t('ed_caption_hint')));

    // Regola
    const signed = (v) => {
      const n = Math.round(Number(v) * 100);
      return n > 0 ? `+${n}` : String(n);
    };
    const plain = (v) => String(Math.round(Number(v) * 100));
    const sliders = {
      brightness: toneSlider('brightness', 'ed_adjust_brightness', -1, 1, signed),
      contrast: toneSlider('contrast', 'ed_adjust_contrast', -1, 1, signed),
      // Ombre e contrasto locale accanto ai toni: sono i controlli del controluce.
      shadows: toneSlider('shadows', 'ed_adjust_shadows', 0, 1, plain),
      localContrast: toneSlider('localContrast', 'ed_adjust_local_contrast', 0, 1, plain),
      sharpen: toneSlider('sharpen', 'ed_adjust_sharpen', 0, 1, plain),
    };
    const backlightSlot = h('div', { class: 'ffed-toggle-slot' });
    let backlightToggle = null;
    let backlightHintKey = null;
    const autoLevels = toggle({
      label: t('ed_adjust_autolevels'),
      desc: t('ed_adjust_autolevels_hint'),
      checked: !!tone.autoLevels,
      onChange: (v) => updateTone({ autoLevels: !!v }, true),
    });
    const ditherChips = chipsRow([...DitherAlgorithm], dither, (d) => t(DITHER_LABELS[d] || 'ed_dither_atkinson'), (d) => {
      if (d === dither) return;
      dither = d;
      updateResetButton();
      scheduleRender(true);
    }, { ariaLabel: t('ed_adjust_dither') });
    const resetButton = ghostButton(t('ed_adjust_reset'), { onClick: resetAdjustments, disabled: true, small: true });
    const resetSlot = h('div', { class: 'ffed-reset' }, resetButton);
    tabPanels.adjust = panel('adjust',
      sliders.brightness.el, sliders.contrast.el, sliders.shadows.el, sliders.localContrast.el, sliders.sharpen.el,
      backlightSlot, autoLevels.el,
      sectionHeader(t('ed_adjust_dither')), ditherChips.el,
      resetSlot);
    refreshBacklightUi();

    // --- azioni ----------------------------------------------------------------------------

    const saveBtn = ghostButton(t('ed_save'), { icon: 'download', onClick: onSave, small: true });
    const shareBtn = ghostButton(t('ed_share'), { icon: 'share', onClick: onShare, small: true });
    // Le foto originali a colori: azione secondaria, nella barra in alto (la riga sotto ha già due pulsanti).
    const photosBtn = iconButton('gallery', { label: t('ed_save_photos'), onClick: onSavePhotos });
    const copiesCount = h('span', { class: 'ffed-copies-count' });
    const minusBtn = iconButton('minus', { label: t('ed_copies_less'), onClick: () => setCopies(copies - 1) });
    const plusBtn = iconButton('plus', { label: t('ed_copies_more'), onClick: () => setCopies(copies + 1) });
    const stepper = h('div', { class: 'ffed-stepper', attrs: { role: 'group', 'aria-label': t('ed_copies_label') } }, minusBtn, copiesCount, plusBtn);
    const printBtn = flashButton(t('ed_print'), { icon: 'print', onClick: onPrint });
    const printSlot = h('div', { class: 'ffed-print' }, printBtn);
    const actionsBar = h('div', { class: 'ffed-actions' },
      h('div', { class: 'ffed-actions-row' }, saveBtn, shareBtn),
      h('div', { class: 'ffed-actions-row ffed-actions-row--main' }, stepper, printSlot));

    const panelBox = h('div', { class: 'ffed-panel' },
      tabList,
      h('div', { class: 'ffed-tabcontent' }, tabPanels.template, tabPanels.text, tabPanels.adjust),
      actionsBar);

    screen.append(
      topBar({ title: t('ed_title'), onBack: goBack, actions: [photosBtn] }),
      h('div', { class: 'ffed-main' }, stageWrap, panelBox),
    );

    selectTab('template', false);
    setCopies(copies);
    updateResetButton();
    refreshExportButtons();
    showPlaceholder();

    // Titolo, hashtag, data, numerazione e carta vengono dalle impostazioni: se cambiano
    // (anche il contatore dopo una stampa riuscita) l'anteprima si rifà da sola.
    let settingsKey = keyOf(settings.get());
    cleanups.push(settings.subscribe((next) => {
      const k = keyOf(next && typeof next === 'object' ? next : settings.get());
      if (k === settingsKey) return;
      settingsKey = k;
      scheduleRender(false);
    }));

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => fitPreview());
      ro.observe(stage);
      cleanups.push(() => ro.disconnect());
    }
    cleanups.push(() => clearTimeout(renderTimer));

    scheduleRender(true);

    // ------------------------------------------------------------ costruttori

    function panel(tab, ...children) {
      const el = h('div', {
        class: 'ffed-tabpanel',
        attrs: { role: 'tabpanel', id: `${base}-panel-${tab}`, 'aria-labelledby': `${base}-tab-${tab}` },
      }, ...children);
      el.hidden = true;
      return el;
    }

    function toneSlider(field, labelKey, min, max, format) {
      return slider({
        label: t(labelKey),
        min,
        max,
        step: 0.01,
        value: Number(tone[field]) || 0,
        format,
        onInput: (v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return;
          updateTone({ [field]: clamp(n, min, max) }, false);
        },
      });
    }

    // ------------------------------------------------------------ schede

    function selectTab(tab, toggleIfOpen = true) {
      // Un secondo tocco sulla scheda aperta la chiude: più spazio all'anteprima.
      if (toggleIfOpen && openTab === tab) openTab = null;
      else openTab = tab;
      for (const name of TABS) {
        const selected = name === openTab;
        tabButtons[name].setAttribute('aria-selected', String(selected));
        tabButtons[name].tabIndex = selected || (openTab == null && name === 'template') ? 0 : -1;
        tabPanels[name].hidden = !selected;
      }
      panelBox.classList.toggle('ffed-panel--collapsed', openTab == null);
    }

    function onTabKey(e, tab) {
      const i = TABS.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
      else if (e.key === 'ArrowLeft') next = TABS[(i + TABS.length - 1) % TABS.length];
      else if (e.key === 'Home') next = TABS[0];
      else if (e.key === 'End') next = TABS[TABS.length - 1];
      if (!next) return;
      e.preventDefault();
      selectTab(next, false);
      tabButtons[next].focus();
    }

    // ------------------------------------------------------------ modifiche

    function setCaption(text) {
      counter.textContent = t('ed_caption_counter', text.length, MAX_CAPTION);
      clearWrap.hidden = text.length === 0;
      if (text === caption) return;
      caption = text;
      scheduleRender(false);
    }

    function updateTone(patch, immediate) {
      const next = { ...tone, ...patch };
      if (JSON.stringify(next) === JSON.stringify(tone)) return;
      tone = next;
      if ('autoBacklight' in patch) refreshBacklightUi();
      updateResetButton();
      scheduleRender(immediate);
    }

    function resetAdjustments() {
      tone = { ...defaultTone };
      dither = defaultDither;
      for (const [field, s] of Object.entries(sliders)) s.set(Number(tone[field]) || 0);
      autoLevels.set(!!tone.autoLevels);
      if (backlightToggle) backlightToggle.set(!!tone.autoBacklight);
      ditherChips.set(dither);
      refreshBacklightUi();
      updateResetButton();
      scheduleRender(true);
    }

    function updateResetButton() {
      const changed = JSON.stringify(tone) !== JSON.stringify(defaultTone) || dither !== defaultDither;
      setDisabled(resetButton, !changed);
    }

    function setCopies(n) {
      copies = clamp(n, MIN_COPIES, MAX_COPIES);
      copiesCount.textContent = t('ed_copies_short', copies);
      copiesCount.setAttribute('aria-label', t(copies === 1 ? 'ed_copies_one' : 'ed_copies_other', copies));
      setDisabled(minusBtn, copies <= MIN_COPIES);
      setDisabled(plusBtn, copies >= MAX_COPIES);
    }

    // ------------------------------------------------------------ rendering

    /** Ogni modifica annulla la precedente: gli slider mandano decine di valori al secondo. */
    function scheduleRender(immediate) {
      clearTimeout(renderTimer);
      renderTimer = null;
      setRendering(true);
      if (immediate) runRender();
      else renderTimer = setTimeout(runRender, RENDER_DEBOUNCE_MS);
    }

    function runRender() {
      renderTimer = null;
      const token = ++renderToken;
      const options = { photos, template, caption, tone: { ...tone }, dither };
      renderPromise = (async () => {
        try {
          const request = buildRequest(settings, options);
          updateBacklight(request);
          const rendered = await composeRequest(ctx, request);
          if (disposed || token !== renderToken) return;
          current = { request, rendered };
          renderFailed = false;
          showPreview(rendered.bitImage);
        } catch (e) {
          if (disposed || token !== renderToken) return;
          console.error('[editor] rendering dell\'anteprima fallito', e);
          // WYSIWYG: dopo un errore il risultato vecchio non vale più, Salva e Condividi si spengono.
          current = null;
          renderFailed = true;
          showPlaceholder();
        } finally {
          if (!disposed && token === renderToken) {
            setRendering(false);
            refreshExportButtons();
          }
        }
      })();
      return renderPromise;
    }

    /** Se c'è un rendering in arrivo si aspetta quello, non l'anteprima di un attimo fa. */
    async function settledRender() {
      if (renderTimer != null) {
        clearTimeout(renderTimer);
        runRender();
      }
      await renderPromise;
    }

    function setRendering(on) {
      renderLine.hidden = !on;
    }

    function showPreview(bitImage) {
      // L'anteprima di prima esce dalla pagina subito sotto: la sua memoria si libera ora.
      if (previewCanvas) releaseCanvas(previewCanvas);
      previewCanvas = paperCanvas(bitImage);
      sheetEl = paperSheet(thermalImage(previewCanvas, { label: t('ed_preview_cd') }));
      sheetEl.classList.add('ffed-sheet');
      const mm = Math.round(bitImage.height / DOTS_PER_MM);
      clear(stage);
      stage.append(sheetEl, h('p', { class: 'ffed-paperlen' }, t('ed_preview_paper', mm)));
      fitPreview();
      refreshBacklightUi();
    }

    function showPlaceholder() {
      previewCanvas = null;
      const inner = renderFailed
        ? h('p', { class: 'ffed-placeholder-text' }, t('ed_render_failed'))
        : h('span', { class: 'ffed-spinner', attrs: { role: 'progressbar', 'aria-label': t('ed_rendering') } });
      sheetEl = paperSheet(h('div', { class: 'ffed-placeholder' }, inner));
      sheetEl.classList.add('ffed-sheet', 'ffed-sheet--placeholder');
      clear(stage);
      stage.append(sheetEl);
      refreshBacklightUi();
    }

    /**
     * Scala INTERA in pixel del dispositivo (ogni punto della testina = N x N pixel): con una
     * scala frazionaria il retino si deformerebbe o perderebbe colonne che la carta ha.
     */
    function fitPreview() {
      if (!previewCanvas || !sheetEl || !sheetEl.isConnected) return;
      const dots = previewCanvas.width;
      const stageStyle = getComputedStyle(stage);
      const room = stage.clientWidth - px(stageStyle.paddingLeft) - px(stageStyle.paddingRight);
      if (!(room > 0) || !(dots > 0)) return;
      const ss = getComputedStyle(sheetEl);
      const chrome = px(ss.paddingLeft) + px(ss.paddingRight) + px(ss.borderLeftWidth) + px(ss.borderRightWidth);
      const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
      const roomy = room - 2 * PREVIEW_BREATH - chrome;
      const tight = room - chrome;
      let k = Math.floor((roomy * dpr) / dots);
      if (k < 1) k = Math.floor((tight * dpr) / dots);
      while (k > 1 && (dots * k) / dpr > PREVIEW_MAX_CSS) k--;
      const cssWidth = k >= 1 ? (dots * k) / dpr : Math.max(1, tight);
      previewCanvas.style.width = `${cssWidth}px`;
      previewCanvas.style.height = 'auto';
      previewCanvas.style.maxWidth = '100%';
      sheetEl.style.width = `${ss.boxSizing === 'border-box' ? cssWidth + chrome : cssWidth}px`;
      sheetEl.style.maxWidth = '100%';
    }

    // ------------------------------------------------------------ controluce

    /**
     * Il punteggio si ricalcola solo quando cambiano i ritagli (modello, carta, numero di foto):
     * Tone lo misura sulla foto prima di correggerla, quindi le regolazioni non lo toccano.
     */
    function updateBacklight(request) {
      const key = `${request.template}|${request.paper}|${request.photos.length}`;
      if (key === backlightKey) return;
      backlightKey = key;
      // In un giro a parte: costa pochi millisecondi ma non deve ritardare l'anteprima.
      setTimeout(() => {
        if (disposed || backlightKey !== key) return;
        const score = measureBacklight(request);
        if (score == null || backlightKey !== key) return;
        backlightScoreValue = score;
        refreshBacklightUi();
      }, 0);
    }

    function refreshBacklightUi() {
      const likely = backlightScoreValue > BACKLIGHT_THRESHOLD;
      const detected = !!tone.autoBacklight && likely;
      badge.hidden = !(detected && previewCanvas);
      // Il suggerimento cambia con la foto: spiega cosa è successo, o cosa si guadagna ad accenderlo.
      const hintKey = detected
        ? 'ed_adjust_autobacklight_detected'
        : likely ? 'ed_adjust_autobacklight_suggest' : 'ed_adjust_autobacklight_hint';
      if (hintKey === backlightHintKey && backlightToggle) return;
      backlightHintKey = hintKey;
      const next = toggle({
        label: t('ed_adjust_autobacklight'),
        desc: t(hintKey),
        checked: !!tone.autoBacklight,
        onChange: (v) => updateTone({ autoBacklight: !!v }, true),
      });
      const hadFocus = backlightToggle && backlightToggle.el.contains(document.activeElement);
      if (backlightToggle) backlightToggle.el.replaceWith(next.el);
      else backlightSlot.append(next.el);
      backlightToggle = next;
      if (hadFocus) {
        const focusable = next.el.matches('input, button') ? next.el : next.el.querySelector('input, button');
        if (focusable) focusable.focus();
      }
    }

    // ------------------------------------------------------------ azioni

    function refreshExportButtons() {
      const off = exporting || !current;
      setDisabled(saveBtn, off);
      setDisabled(shareBtn, off);
      setDisabled(photosBtn, exporting || photos.length === 0);
    }

    function setExporting(on) {
      exporting = on;
      refreshExportButtons();
    }

    function setPrintBusy(on) {
      if (printBusy === on) return;
      printBusy = on;
      // "In corso": il pulsante resta visibile ma non risponde (niente doppia stampa).
      printBtn.setBusy(on);
    }

    /**
     * Stampa con i parametri correnti, dal gesto (serve a pair()). La richiesta si ricostruisce
     * sempre (il numero dev'essere quello del momento); se coincide con l'anteprima o con l'ultimo
     * invio si riusa quel rendering: sulla carta va la data dell'anteprima e "Riprova" non duplica.
     */
    function onPrint() {
      if (photos.length === 0) return;
      const options = { photos, template, caption, tone: { ...tone }, dither };
      const copiesNow = copies;
      const run = async ({ onProgress }) => {
        setPrintBusy(true);
        try {
          let prepared;
          try {
            const request = buildRequest(settings, options);
            prepared = [lastSent, current].find((c) => c && sameJob(c.request, request)) ||
              { request, rendered: await composeRequest(ctx, request) };
          } catch (e) {
            console.error('[editor] composizione della stampa fallita', e);
            return { ok: false, failure: 'RENDER_FAILED', message: String((e && e.message) || e || '') };
          }
          lastSent = prepared;
          return await printAndRecord(ctx, prepared, { copies: copiesNow, onProgress });
        } finally {
          if (!disposed) setPrintBusy(false);
        }
      };
      // "Ristampa" dal foglio: la stessa carta appena uscita, senza consumare un altro numero.
      const reprint = async ({ onProgress }) => {
        const sent = lastSent;
        if (!sent) return run({ onProgress });
        setPrintBusy(true);
        try {
          return await printAndRecord(ctx, sent, { copies: copiesNow, onProgress });
        } finally {
          if (!disposed) setPrintBusy(false);
        }
      };
      sheetHandle = openPrintSheet(ctx, {
        run,
        copies: copiesNow,
        onReprint: reprint,
        onNewPhoto: () => {
          const done = photos;
          session.clear();
          router.go('#/camera');
          // Foto scartate: si liberano appena storico e salvataggi in corso le hanno lette.
          Promise.allSettled([recordsSettled(), ...inflight]).then(() => closePhotos(done));
        },
      });
    }

    /** Un'azione che legge le foto o la stampa: resta tra quelle in corso finché non finisce. */
    function track(promise) {
      inflight.add(promise);
      promise.catch(() => {}).then(() => inflight.delete(promise));
      return promise;
    }

    function onSave() {
      return track(saveNow());
    }

    function onShare() {
      return track(shareNow());
    }

    function onSavePhotos() {
      return track(savePhotosNow());
    }

    /** PNG della stampa (x2, vicino più prossimo) scaricato + voce nello storico. */
    async function saveNow() {
      if (exporting) return;
      setExporting(true);
      try {
        await settledRender();
        const ready = current;
        if (!ready) {
          toast(t('ed_save_failed'));
          return;
        }
        const blob = await pngBlob(ready.rendered.bitImage, 2);
        downloadBlob(blob, exportFileName('fotoflash', 'png'));
        toast(t('ed_saved'));
        try {
          await saveOnly(ctx, ready);
        } catch (e) {
          // Il PNG è scaricato: lo storico mancato non deve far sembrare fallito il salvataggio.
          console.warn('[editor] salvataggio nello storico fallito', e);
        }
      } catch (e) {
        console.warn('[editor] salvataggio fallito', e);
        toast(t('ed_save_failed'));
      } finally {
        if (!disposed) setExporting(false);
      }
    }

    async function shareNow() {
      if (exporting) return;
      setExporting(true);
      try {
        await settledRender();
        const ready = current;
        if (!ready) {
          toast(t('ed_share_failed'));
          return;
        }
        const blob = await pngBlob(ready.rendered.bitImage, 2);
        const file = new File([blob], exportFileName('fotoflash', 'png'), { type: 'image/png' });
        const result = await shareFiles([file], { title: t('ed_share_title') });
        // Senza condivisione (o gesto scaduto) il file è stato scaricato: lo si dice.
        if (result === 'downloaded') toast(t('ed_share_downloaded'));
      } catch (e) {
        console.warn('[editor] condivisione fallita', e);
        toast(t('ed_share_failed'));
      } finally {
        if (!disposed) setExporting(false);
      }
    }

    /** Le foto originali a colori: una come JPEG, più d'una in uno ZIP. */
    async function savePhotosNow() {
      if (exporting || photos.length === 0) return;
      setExporting(true);
      try {
        const n = await downloadOriginals(await jpegBlobs(photos));
        toast(t(n === 1 ? 'ed_photos_saved_one' : 'ed_photos_saved_other', n));
      } catch (e) {
        console.warn('[editor] foto non salvate', e);
        toast(t('ed_photos_failed'));
      } finally {
        if (!disposed) setExporting(false);
      }
    }

    function measureBacklight(request) {
      try {
        const layout = layoutTemplate(request.template, request.paper, request.photos.length, request.texts);
        let best = 0;
        (layout.photos || []).forEach((rect, i) => {
          if (!(rect.width > 0 && rect.height > 0)) return;
          const photo = request.photos[i % request.photos.length];
          const k = Math.min(1, BACKLIGHT_SAMPLE_SIDE / Math.max(rect.width, rect.height));
          const gray = grayFromSource(photo, Math.max(1, Math.round(rect.width * k)), Math.max(1, Math.round(rect.height * k)));
          const score = backlightScore(gray);
          if (Number.isFinite(score)) best = Math.max(best, clamp(score, 0, 1));
        });
        return best;
      } catch (e) {
        console.warn('[editor] misura del controluce fallita', e);
        return null;
      }
    }
  }

  return function unmount() {
    disposed = true;
    if (saveDraft) saveDraft();
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.warn('[editor] pulizia', e);
      }
    }
    // Il lavoro di stampa continua: chiudendo il foglio l'esito arriva in un avviso.
    if (sheetHandle) sheetHandle.close();
    screen.remove();
  };
}

// ------------------------------------------------------------------ utilità

function keyOf(s) {
  return JSON.stringify([s.eventTitle, s.hashtag, s.showDate, s.showPrintNumber, s.printCounter, s.paper]);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function px(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Abilita/disabilita un controllo dei componenti (il pulsante è l'elemento o il suo primo figlio). */
function setDisabled(el, disabled) {
  if (!el) return;
  const target = el.matches && el.matches('button, input') ? el : el.querySelector && el.querySelector('button, input');
  if (target) target.disabled = !!disabled;
}

function ensureStyle() {
  if (document.getElementById('ff-editor-style')) return;
  const style = document.createElement('style');
  style.id = 'ff-editor-style';
  style.textContent = EDITOR_CSS;
  document.head.append(style);
}

// Colonna dell'app (#app, 480 px): un'unica colonna anche sul computer, come sul telefono.
const EDITOR_CSS = `
.ffed { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }
.ffed-main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ffed-stagewrap { position: relative; flex: 1; min-height: 160px; }
.ffed-stage { position: absolute; inset: 0; overflow: auto; padding: 64px 8px 24px; display: flex; flex-direction: column; align-items: center;
  background: var(--ff-surface, rgba(22, 19, 15, .045)); overscroll-behavior: contain; }
.ffed-sheet { flex: none; max-width: 100%; }
.ffed-sheet--placeholder { width: min(86%, 360px); }
.ffed-placeholder { width: 100%; aspect-ratio: .78; display: grid; place-items: center; padding: 16px; text-align: center; color: var(--ff-graphite, #4A4640); }
.ffed-placeholder-text { margin: 0; line-height: 1.45; }
.ffed-spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid var(--ff-ink, #16130F); border-right-color: transparent; animation: ffed-spin .9s linear infinite; }
@keyframes ffed-spin { to { transform: rotate(360deg); } }
.ffed-paperlen { margin: 12px 0 0; font-family: var(--ff-font-mono, monospace); font-size: 12px; color: var(--ff-muted, inherit); }
.ffed-renderline { position: absolute; left: 0; right: 0; top: 0; height: 3px; overflow: hidden; pointer-events: none; }
.ffed-renderline::after { content: ''; position: absolute; top: 0; bottom: 0; width: 30%; background: var(--ff-on-bg, currentColor); opacity: 0;
  animation: ffed-line 1.1s ease-in-out .15s infinite; }
@keyframes ffed-line { 0% { left: -30%; opacity: .8; } 100% { left: 100%; opacity: .8; } }
.ffed-pill { position: absolute; right: 12px; top: 12px; z-index: 2; max-width: calc(100% - 24px); }
.ffed-badge { position: absolute; left: 12px; top: 12px; z-index: 2; max-width: calc(100% - 24px); display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px 5px 8px;
  border-radius: 999px; background: var(--ff-flash, #FFCC00); color: var(--ff-ink, #16130F); box-shadow: 2px 2px 0 var(--ff-ink, #16130F);
  font-family: var(--ff-font-mono, monospace); font-size: 12px; font-weight: 700; animation: ffed-pop .22s ease-out; }
@keyframes ffed-pop { from { transform: scale(.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.ffed-panel { flex: none; display: flex; flex-direction: column; border-radius: 28px 28px 0 0; padding-top: 12px; margin-top: -16px;
  position: relative; z-index: 1; background: var(--ff-bg, #FBF8F1); box-shadow: 0 -6px 18px rgba(0, 0, 0, .12); }
.ffed-tabs { display: flex; gap: 4px; margin: 0 16px; padding: 4px; border-radius: 999px; background: var(--ff-surface, rgba(22, 19, 15, .045)); }
.ffed-tab { flex: 1; min-width: 0; min-height: 44px; border: 0; border-radius: 999px; background: transparent; color: inherit;
  font-family: var(--ff-font-mono, monospace); font-size: 13px; font-weight: 700; cursor: pointer; padding: 0 8px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background .2s, color .2s; }
.ffed-tab[aria-selected="true"] { background: var(--ff-inverse-bg, #16130F); color: var(--ff-on-inverse, #FBF8F1); }
.ffed-tabcontent { overflow: auto; max-height: min(260px, 36dvh); overscroll-behavior: contain; }
.ffed-panel--collapsed .ffed-tabcontent { display: none; }
.ffed-tabpanel { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.ffed-help { margin: 2px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--ff-muted, inherit); }
.ffed-label { font-weight: 600; font-size: 14px; }
.ffed-caption-row { display: flex; align-items: center; gap: 4px; }
.ffed-caption { flex: 1; min-width: 0; min-height: 48px; padding: 0 14px; border-radius: 14px; border: 2px solid var(--ff-outline, currentColor);
  background: transparent; color: inherit; font-family: var(--ff-font-mono, monospace); font-weight: 700; font-size: 16px; }
.ffed-caption:focus { border-color: var(--ff-on-bg, currentColor); }
.ffed-counter-row { display: flex; justify-content: flex-end; }
.ffed-counter { font-family: var(--ff-font-mono, monospace); font-size: 12px; color: var(--ff-muted, inherit); }
.ffed-reset { display: flex; justify-content: flex-end; margin-top: 4px; }
.ffed-actions { padding: 8px 16px calc(10px + var(--ff-safe-bottom, 0px)); display: flex; flex-direction: column; gap: 8px;
  border-top: 1px solid var(--ff-divider, rgba(22, 19, 15, .1)); }
.ffed-actions-row { display: flex; gap: 8px; align-items: center; }
.ffed-actions-row > * { flex: 1 1 0; min-width: 0; }
.ffed-actions-row--main > .ffed-stepper { flex: none; }
.ffed-print > * { width: 100%; }
.ffed-stepper { display: inline-flex; align-items: center; gap: 2px; min-height: 56px; padding: 0 2px; border: 2px solid var(--ff-on-bg, currentColor); border-radius: 999px; }
.ffed-copies-count { min-width: 2.6ch; text-align: center; font-family: var(--ff-font-mono, monospace); font-weight: 700; font-size: 18px; }
.ffed-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; gap: 12px; }
.ffed-empty-more { width: 100%; max-width: 360px; display: flex; flex-direction: column; }
/* Sui telefoni stretti badge e pillola non stanno sulla stessa riga: il badge scende in basso. */
@media (max-width: 440px) {
  .ffed-badge { top: auto; bottom: 28px; }
}
@media (max-width: 359px) {
  .ffed-actions-row:not(.ffed-actions-row--main) .ff-icon { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ffed-spinner, .ffed-renderline::after, .ffed-badge { animation: none; }
  .ffed-renderline::after { opacity: .6; left: 0; width: 100%; }
  .ffed-tab { transition: none; }
}
`;
