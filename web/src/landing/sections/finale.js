// Chiusura: un'ultima fascia Coral con la domanda e il pulsante verso l'app, e il piè di pagina
// (sezione 10) con crediti dei font, collegamenti, lingua e versione.
import { h } from '../../ui/dom.js';
import { wordmark, brandMark } from '../../ui/icons.js';
import { halftoneBurst } from '../../ui/components.js';
import { APK_URL, REPO_URL, stickerButton, art, sparklePath } from './kit.js';

const STROKE = 'stroke="#16130F" stroke-width="3" stroke-linejoin="round"';
/** Pezzi di coriandoli: forma, posizione (% della fascia), misura, rotazione e ritmo. */
const CONFETTI = Object.freeze([
  { box: '0 0 40 22', markup: `<rect x="2" y="2" width="36" height="18" rx="4" fill="#FFCC00" ${STROKE}/>`, x: 6, y: 18, s: 44, r: -18, d: 5.2, delay: 0 },
  { box: '0 0 24 24', markup: `<circle cx="12" cy="12" r="9.5" fill="#22B89A" ${STROKE}/>`, x: 15, y: 62, s: 26, r: 0, d: 6.4, delay: -2 },
  { box: '0 0 40 40', markup: `<path d="${sparklePath(20, 20, 17)}" fill="#16130F"/>`, x: 8, y: 78, s: 30, r: 10, d: 7, delay: -1 },
  { box: '0 0 40 22', markup: `<rect x="2" y="2" width="36" height="18" rx="4" fill="#3D8BFF" ${STROKE}/>`, x: 88, y: 22, s: 40, r: 24, d: 5.8, delay: -3 },
  { box: '0 0 40 40', markup: `<path d="${sparklePath(20, 20, 17)}" fill="#FFCC00" ${STROKE}/>`, x: 84, y: 60, s: 46, r: -8, d: 6.8, delay: -.5 },
  { box: '0 0 24 24', markup: `<circle cx="12" cy="12" r="9.5" fill="#FBF8F1" ${STROKE}/>`, x: 93, y: 82, s: 22, r: 0, d: 5.5, delay: -4 },
]);

export function finale(env) {
  const { t } = env;
  const titleId = 'ffl-final-title';
  // coriandoli: pezzetti nei colori del brand ai lati, che fluttuano piano (fermi se non visibili)
  const confetti = h('div', { class: 'ffl-final__confetti', 'aria-hidden': 'true' },
    ...CONFETTI.map((c) => {
      const piece = art(c.box, c.markup, 'ffl-confetto');
      piece.setAttribute('style', `left:${c.x}%;top:${c.y}%;--s:${c.s}px;--r:${c.r}deg;--d:${c.d}s;--delay:${c.delay}s`);
      return piece;
    }));
  env.play(confetti);

  const el = h('section', { class: 'ffl-section ffl-section--coral ffl-final', id: 'ffl-final', 'aria-labelledby': titleId },
    confetti,
    h('div', { class: 'ffl-wrap ffl-final__in ffl-reveal' },
      h('div', { class: 'ffl-final__mark', 'aria-hidden': 'true' }, brandMark({ size: 120, shadow: '#16130F' })),
      h('h2', { class: 'ffl-h2 ffl-final__title', id: titleId, tabIndex: -1 }, t('land_final_title')),
      h('p', { class: 'ffl-final__text' }, t('land_final_text')),
      h('div', { class: 'ffl-final__ctas' },
        env.appLink(stickerButton({ text: t('land_hero_cta_web'), variant: 'flash', size: 'lg', icon: 'camera' })),
        stickerButton({
          text: t('land_hero_cta_apk'),
          variant: 'paper',
          size: 'lg',
          icon: 'android',
          href: APK_URL,
          external: true,
          newTabText: t('common_new_tab'),
        }))));
  return { el };
}

export function footer(env) {
  const { t, ctx } = env;
  const version = (ctx && ctx.version) || env.version || '';
  const link = (href, text, external = true) => h('li', null,
    h('a', { class: 'ffl-foot__link', href, target: external ? '_blank' : undefined, rel: external ? 'noopener noreferrer' : undefined },
      text, external ? h('span', { class: 'ff-sr-only' }, ` ${t('common_new_tab')}`) : null));

  const mark = wordmark({ height: 34, label: 'FotoFlash' });
  const el = h('footer', { class: 'ffl-foot' },
    h('div', { class: 'ffl-foot__burst', 'aria-hidden': 'true' }, halftoneBurst(200, 10)),
    h('div', { class: 'ffl-wrap ffl-foot__grid' },
      h('div', { class: 'ffl-foot__brand' },
        mark,
        h('p', { class: 'ffl-foot__payoff' }, `${t('land_hero_title_1')} ${t('land_hero_title_2')} ${t('land_hero_title_3')}`),
        h('p', { class: 'ffl-foot__tagline' }, t('land_footer_tagline'))),
      h('nav', { class: 'ffl-foot__nav', 'aria-label': t('land_footer_links') },
        h('p', { class: 'ffl-foot__label' }, t('land_footer_links')),
        h('ul', { class: 'ffl-foot__links' },
          link(REPO_URL, 'GitHub'),
          link(APK_URL, t('land_footer_releases')),
          link('brand/index.html', t('land_footer_brand')))),
      h('div', { class: 'ffl-foot__side' },
        h('p', { class: 'ffl-foot__label' }, t('land_lang_label')),
        env.langSelect('foot'),
        h('button', { type: 'button', class: 'ffl-foot__top', onClick: () => env.scrollToTop() }, t('land_back_top')))),
    h('div', { class: 'ffl-wrap' },
      h('div', { class: 'ffl-foot__legal' },
        h('p', null, t('land_footer_fonts')),
        version ? h('p', { class: 'ffl-foot__version' }, t('land_footer_version', version)) : null)));
  return { el };
}
