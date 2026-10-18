// Sezione 1: barra in alto, fissa e discreta. Marchio, ancore alle sezioni (senza toccare l'hash,
// che appartiene al router dell'app), selettore della lingua e «Apri l'app».
import { h } from '../../ui/dom.js';
import { wordmark, boltMark } from '../../ui/icons.js';
import { stickerButton } from './kit.js';

/** Ancore della barra: id della sezione e testo. */
export const NAV_ITEMS = Object.freeze([
  Object.freeze({ id: 'ffl-ideas', key: 'land_nav_ideas' }),
  Object.freeze({ id: 'ffl-how', key: 'land_nav_how' }),
  Object.freeze({ id: 'ffl-try', key: 'land_nav_try' }),
  Object.freeze({ id: 'ffl-printers', key: 'land_nav_printers' }),
  Object.freeze({ id: 'ffl-get', key: 'land_nav_get' }),
]);

export function topbar(env) {
  const { t } = env;

  const brand = h('button', {
    type: 'button',
    class: 'ffl-brand',
    'aria-label': t('land_home'),
    onClick: () => env.scrollToTop(),
  },
  h('span', { class: 'ffl-brand__full' }, wordmark({ height: 28, label: 'FotoFlash' })),
  h('span', { class: 'ffl-brand__mini' }, boltMark({ size: 30 })));
  // l'etichetta del pulsante basta: il wordmark dentro non deve farsi leggere una seconda volta
  brand.querySelectorAll('[role="img"]').forEach((el) => el.setAttribute('aria-hidden', 'true'));

  const links = NAV_ITEMS.map((item) => h('a', {
    class: 'ffl-nav__link',
    href: `#${item.id}`,
    dataset: { target: item.id },
    onClick: (event) => {
      event.preventDefault();
      env.scrollToSection(item.id);
    },
  }, t(item.key)));

  const nav = h('nav', { class: 'ffl-nav', 'aria-label': t('land_nav_label') },
    h('ul', { class: 'ffl-nav__list' }, ...links.map((a) => h('li', null, a))));

  const open = env.appLink(stickerButton({ text: t('land_open_app'), variant: 'flash', size: 'sm', icon: 'camera' }));

  const bar = h('header', { class: 'ffl-top' },
    h('div', { class: 'ffl-wrap ffl-top__in' },
      brand,
      nav,
      h('div', { class: 'ffl-top__end' }, env.langSelect('top'), open)));

  // La barra prende bordo e ombra appena la pagina scorre (un sensore in cima, niente scroll listener).
  const sentinel = h('div', { class: 'ffl-top__sentinel', 'aria-hidden': 'true' });
  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(([entry]) => {
      bar.classList.toggle('is-scrolled', !entry.isIntersecting);
    });
    io.observe(sentinel);
    env.cleanup(() => io.disconnect());
  }

  // Evidenzia nella barra la sezione che si sta leggendo.
  env.onSectionChange((id) => {
    for (const a of links) {
      if (a.dataset.target === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  });

  return { el: [sentinel, bar] };
}
