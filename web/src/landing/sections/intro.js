// Sezione 2: hero. A sinistra il payoff in Righteous grande, l'attacco e le due strade (browser o
// APK); a destra il disco Flash del banner con il retino e, sopra, l'animazione di hero.js (mountHero).
import { h } from '../../ui/dom.js';
import { icon, boltMark } from '../../ui/icons.js';
import { halftoneBurst } from '../../ui/components.js';
import { APK_URL, stickerButton, art, sparklePath } from './kit.js';

export function intro(env) {
  const { t } = env;
  const titleId = 'ffl-hero-title';

  const lines = ['land_hero_title_1', 'land_hero_title_2', 'land_hero_title_3'].map((key, i) =>
    h('span', { class: ['ffl-h1__line', `ffl-h1__line--${i + 1}`] }, h('span', { class: 'ffl-h1__word' }, t(key))));

  const ctas = h('div', { class: 'ffl-hero__ctas' },
    env.appLink(stickerButton({ text: t('land_hero_cta_web'), variant: 'flash', size: 'lg', icon: 'camera' })),
    stickerButton({
      text: t('land_hero_cta_apk'),
      variant: 'paper',
      size: 'lg',
      icon: 'android',
      href: APK_URL,
      external: true,
      newTabText: t('common_new_tab'),
    }));

  // Palcoscenico dell'animazione: lo riempie mountHero; finché non arriva resta il marchio.
  const stage = h('div', { class: 'ffl-hero__stage' });

  // Scintille e coriandoli fermi attorno al disco: decorazione, mai dietro al testo.
  const sparkles = art('0 0 100 100',
    `<path d="${sparklePath(14, 18, 9)}" fill="#FFCC00" stroke="#16130F" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="${sparklePath(88, 80, 6)}" fill="#16130F"/>` +
    `<path d="${sparklePath(90, 12, 4.5)}" fill="#16130F"/>`,
    'ffl-hero__sparkles');

  const scrollCue = h('button', {
    type: 'button',
    class: 'ffl-hero__cue',
    onClick: () => env.scrollToSection('ffl-ideas'),
  }, h('span', null, t('land_hero_scroll')), icon('chevron-down', { size: 20 }));
  // la freccia che invita a scorrere si muove solo finché si vede
  env.play(scrollCue);

  const artBox = h('div', { class: 'ffl-hero__art' },
    h('div', { class: 'ffl-hero__disc', 'aria-hidden': 'true' }),
    h('div', { class: 'ffl-hero__burst', 'aria-hidden': 'true' }, halftoneBurst(220, 11)),
    sparkles,
    stage);

  const el = h('section', { class: 'ffl-hero', id: 'ffl-hero', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-wrap ffl-hero__grid' },
      h('div', { class: 'ffl-hero__copy' },
        h('p', { class: 'ffl-hero__eyebrow' }, boltMark({ size: 20 }), h('span', null, t('land_hero_eyebrow'))),
        h('h1', { class: 'ffl-h1', id: titleId, tabIndex: -1 }, ...lines),
        h('p', { class: 'ffl-hero__lead' }, t('land_hero_lead')),
        ctas,
        h('p', { class: 'ffl-hero__note' }, icon('check', { size: 18 }), h('span', null, t('land_hero_note')))),
      artBox),
    h('div', { class: 'ffl-wrap ffl-hero__foot' }, scrollCue));

  return { el, stage, art: artBox };
}
