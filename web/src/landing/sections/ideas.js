// Sezione 3: le idee. Intestazione e palcoscenico del carosello dei casi d'uso, che riempie
// scenes.js (mountScenes) quando la sezione si avvicina allo schermo.
import { h } from '../../ui/dom.js';
import { sectionHead } from './kit.js';

export function ideas(env) {
  const { t } = env;
  const titleId = 'ffl-ideas-title';
  const stage = h('div', { class: 'ffl-ideas__stage ffl-reveal' });
  const el = h('section', { class: 'ffl-section ffl-section--fog ffl-ideas', id: 'ffl-ideas', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-wrap' },
      sectionHead({
        num: '01',
        eyebrow: t('land_ideas_eyebrow'),
        title: t('land_ideas_title'),
        lead: t('land_ideas_lead'),
        id: titleId,
        align: 'center',
      }),
      stage));
  return { el, stage };
}
