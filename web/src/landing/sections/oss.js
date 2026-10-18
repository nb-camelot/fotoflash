// Sezione 9: open source. Codice su GitHub, licenza MIT e lo sviluppo agentico con /oc, raccontato
// da un piccolo terminale le cui righe compaiono una dopo l'altra (solo opacity e transform).
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { REPO_URL, sectionHead, stickerButton, pill } from './kit.js';

/** Righe del terminale dopo il comando: chiave del testo e segno. */
const STEPS = Object.freeze([
  Object.freeze({ key: 'land_oss_term_plan', mark: '✓' }),
  Object.freeze({ key: 'land_oss_term_build', mark: '✓' }),
  Object.freeze({ key: 'land_oss_term_review', mark: '✓' }),
  Object.freeze({ key: 'land_oss_term_merge', mark: '★' }),
]);

export function oss(env) {
  const { t } = env;
  const titleId = 'ffl-oss-title';

  const term = h('figure', { class: 'ffl-term ffl-reveal' },
    h('div', { class: 'ffl-term__bar', 'aria-hidden': 'true' },
      h('span', { class: 'ffl-term__dot ffl-term__dot--coral' }),
      h('span', { class: 'ffl-term__dot ffl-term__dot--flash' }),
      h('span', { class: 'ffl-term__dot ffl-term__dot--mint' })),
    h('ol', { class: 'ffl-term__lines' },
      h('li', { class: 'ffl-term__line ffl-term__line--cmd', style: { '--i': 0 } },
        h('span', { class: 'ffl-term__prompt', 'aria-hidden': 'true' }, '>'),
        h('span', null, t('land_oss_term_cmd')),
        h('span', { class: 'ffl-term__cursor', 'aria-hidden': 'true' })),
      ...STEPS.map((step, i) => h('li', { class: 'ffl-term__line', style: { '--i': i + 1 } },
        h('span', { class: 'ffl-term__mark', 'aria-hidden': 'true' }, step.mark),
        h('span', null, t(step.key))))),
    h('figcaption', { class: 'ff-sr-only' }, t('land_oss_term_label')));
  env.play(term);

  const el = h('section', { class: 'ffl-section ffl-section--paper ffl-oss', id: 'ffl-oss', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-wrap ffl-oss__grid' },
      h('div', { class: 'ffl-oss__copy' },
        sectionHead({ num: '07', eyebrow: t('land_oss_eyebrow'), title: t('land_oss_title'), lead: t('land_oss_text'), id: titleId }),
        h('div', { class: 'ffl-oss__agent ffl-reveal' },
          h('h3', { class: 'ffl-oss__h3' }, icon('sparkles', { size: 24 }), h('span', null, t('land_oss_agent_title'))),
          h('p', null, t('land_oss_agent_text'))),
        h('div', { class: 'ffl-oss__actions ffl-reveal' },
          stickerButton({ text: t('land_oss_github'), icon: 'code', variant: 'ink', href: REPO_URL, external: true, newTabText: t('common_new_tab') }),
          pill(t('land_oss_license'), { tone: 'paper', icon: 'heart' }))),
      term));
  return { el };
}
