// Sezione 8: installa o scarica. App web installabile (ctx.install), APK dell'ultima release e
// «aprila sul telefono» con l'indirizzo, Copia e Condividi.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { APK_URL, sectionHead, stickerButton, pageUrl } from './kit.js';

function card({ tone, iconName, title, text, hint, body, extra }) {
  return h('li', { class: ['ffl-get__card', `ffl-get__card--${tone}`, 'ffl-reveal'] },
    h('span', { class: 'ffl-get__icon', 'aria-hidden': 'true' }, icon(iconName, { size: 28 })),
    h('h3', { class: 'ffl-get__title' }, title),
    h('p', { class: 'ffl-get__text' }, text),
    hint || null,
    h('div', { class: 'ffl-get__body' }, ...body),
    extra || null);
}

/** Stato dell'installazione: 'installed' | 'available' | 'manual'. */
export function installState(install) {
  try {
    if (install && typeof install.installed === 'function' && install.installed()) return 'installed';
    if (install && typeof install.available === 'function' && install.available()) return 'available';
  } catch {
    // ctx.install incompleto: si spiegano i passi a mano
  }
  return 'manual';
}

export function get(env) {
  const { t, ctx } = env;
  const titleId = 'ffl-get-title';
  const install = ctx && ctx.install;
  let justInstalled = false;

  // ---------------------------------------------------------------- app web
  const installBtn = stickerButton({
    text: t('land_get_pwa_button'),
    icon: 'install',
    variant: 'flash',
    onClick: async () => {
      if (!install || typeof install.prompt !== 'function') return;
      installBtn.disabled = true;
      try {
        const outcome = await install.prompt();
        if (outcome === 'accepted') justInstalled = true;
      } catch (e) {
        console.warn('[landing] installazione non riuscita', e);
      } finally {
        installBtn.disabled = false;
        renderInstall();
      }
    },
  });
  const installNote = h('p', { class: 'ffl-get__note', role: 'status' });
  function renderInstall() {
    const state = justInstalled ? 'installed' : installState(install);
    installBtn.hidden = state !== 'available';
    installNote.textContent = justInstalled
      ? t('land_get_pwa_done')
      : state === 'installed' ? t('land_get_pwa_installed') : state === 'manual' ? t('land_get_pwa_manual') : '';
    installNote.hidden = !installNote.textContent;
    installNote.classList.toggle('is-ok', state === 'installed');
  }
  if (install && typeof install.subscribe === 'function') {
    const off = install.subscribe(renderInstall);
    if (typeof off === 'function') env.cleanup(off);
  }
  renderInstall();

  // ---------------------------------------------------------------- telefono
  const url = pageUrl(globalThis.location);
  const urlField = h('input', {
    class: 'ffl-get__url',
    type: 'text',
    readOnly: true,
    value: url,
    spellcheck: false,
    'aria-label': t('land_get_phone_title'),
    onFocus: () => urlField.select(),
  });
  // L'esito di Copia compare come un'etichetta sul bordo della scheda: non sposta i pulsanti, che
  // restano allineati a quelli delle altre due schede. Vuota non occupa spazio ma resta nel DOM,
  // così il lettore di schermo la annuncia quando si riempie.
  const shareStatus = h('p', { class: 'ffl-get__status', role: 'status', 'aria-live': 'polite' });
  let statusTimer = 0;
  const say = (text, ok = true) => {
    shareStatus.textContent = text;
    shareStatus.classList.toggle('is-error', !ok);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      shareStatus.textContent = '';
    }, 4000);
  };
  env.cleanup(() => clearTimeout(statusTimer));

  const copyBtn = stickerButton({
    text: t('land_get_copy'),
    icon: 'link',
    variant: 'paper',
    size: 'sm',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        say(t('land_get_copied'));
      } catch {
        urlField.focus();
        urlField.select();
        say(t('land_get_copy_failed'), false);
      }
    },
  });
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const shareBtn = canShare ? stickerButton({
    text: t('land_get_share'),
    icon: 'share',
    variant: 'ink',
    size: 'sm',
    onClick: async () => {
      try {
        await navigator.share({ title: 'FotoFlash', text: t('land_get_share_text'), url });
      } catch (e) {
        // annullata dall'utente: nessun messaggio
        if (e && e.name !== 'AbortError') console.warn('[landing] condivisione non riuscita', e);
      }
    },
  }) : null;

  const list = h('ul', { class: 'ffl-get__list' },
    card({
      tone: 'flash',
      iconName: 'install',
      title: t('land_get_pwa_title'),
      text: t('land_get_pwa_text'),
      body: [installBtn, installNote],
    }),
    card({
      tone: 'mint',
      iconName: 'android',
      title: t('land_get_apk_title'),
      text: t('land_get_apk_text'),
      body: [stickerButton({
        text: t('land_get_apk_button'),
        icon: 'download',
        variant: 'paper',
        href: APK_URL,
        external: true,
        newTabText: t('common_new_tab'),
      })],
    }),
    card({
      tone: 'coral',
      iconName: 'phone',
      title: t('land_get_phone_title'),
      text: t('land_get_phone_text'),
      // chi apre il link su iPhone deve sapere subito che per stampare serve Bluefy (vedi Stampanti)
      hint: h('p', { class: 'ffl-get__hint' }, icon('phone', { size: 16 }), h('span', null, t('land_get_phone_ios'))),
      body: [
        h('div', { class: 'ffl-get__ticket' }, icon('link', { size: 18 }), urlField),
        h('div', { class: 'ffl-get__row' }, copyBtn, shareBtn),
      ],
      extra: shareStatus,
    }));

  const el = h('section', { class: 'ffl-section ffl-section--sky ffl-get', id: 'ffl-get', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-wrap' },
      sectionHead({ num: '06', eyebrow: t('land_get_eyebrow'), title: t('land_get_title'), lead: t('land_get_lead'), id: titleId }),
      list));
  return { el };
}
