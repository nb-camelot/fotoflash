// Sezione 7: stampanti compatibili. Le schede vengono dai driver veri (nome, punti, dpi, collegamenti),
// lo stato è onesto: le Phomemo sono scritte da protocolli documentati ma ancora da provare su carta.
// Sotto: dove si stampa (browser), iPhone e iPad (Bluefy, consigliato) e cosa non è ancora supportato.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { drivers } from '../../printer/drivers/index.js';
import { sectionHead, pill, art } from './kit.js';

/** Riga di un collegamento (Bluetooth LE o classico) con l'icona. */
function linkRow(text, iconName, kind) {
  return h('p', { class: ['ffl-printer__link', `ffl-printer__link--${kind}`] }, icon(iconName, { size: 16 }), h('span', null, text));
}

const INK = '#16130F';
const PAPER = '#FBF8F1';

/** Descrizioni dei driver, le stesse della schermata Stampante. */
const DESC = Object.freeze({
  'escpos-58': 'prn_driver_desc_escpos58',
  'escpos-80': 'prn_driver_desc_escpos80',
  'phomemo-m02': 'prn_driver_desc_m02',
  'phomemo-m02pro': 'prn_driver_desc_m02pro',
});

/** Colore della stampantina disegnata per ciascun driver. */
const BODY = Object.freeze({
  'escpos-58': '#FFCC00',
  'escpos-80': '#3D8BFF',
  'phomemo-m02': '#FF5B45',
  'phomemo-m02pro': '#22B89A',
});

/**
 * Famiglie già provate su carta. Le Phomemo hanno byte verificati in CI ma nessuna stampa vera
 * annotata in docs/DRIVERS.md: finché non c'è, si dice «da provare su carta».
 */
export const PAPER_TESTED_FAMILIES = Object.freeze(['escpos']);

/** Stato da mostrare per un driver: 'supported' | 'pending'. */
export function driverStatus(driver) {
  return PAPER_TESTED_FAMILIES.includes(driver && driver.family) ? 'supported' : 'pending';
}

/** Stampantina piatta: corpo colorato, contorno Ink, ombra piena, foglio con il dente di sega. */
function printerArt(driver) {
  const wide = driver.dots > 400;
  const color = BODY[driver.id] || '#FFCC00';
  const phomemo = driver.family === 'phomemo';
  const x = wide ? 30 : 44;
  const w = wide ? 140 : 112;
  const rx = phomemo ? 26 : 14;
  const pw = wide ? 92 : 64;
  const px = 100 - pw / 2;
  let zig = `M${px} 70V24`;
  const tooth = pw / 8;
  for (let i = 0; i < 8; i++) zig += `L${(px + tooth * i + tooth / 2).toFixed(1)} ${20}L${(px + tooth * (i + 1)).toFixed(1)} 24`;
  zig += 'V70Z';
  return `<path d="${zig}" fill="${PAPER}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M${px + 12} 36H${px + pw - 12}M${px + 12} 46H${px + pw - 22}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<rect x="${x}" y="58" width="${w}" height="62" rx="${rx}" fill="${INK}" transform="translate(6 6)"/>` +
    `<rect x="${x}" y="58" width="${w}" height="62" rx="${rx}" fill="${color}" stroke="${INK}" stroke-width="3.5"/>` +
    `<path d="M${px - 6} 62H${px + pw + 6}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="${x + w - 18}" cy="100" r="5" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M${x + 16} 100H${x + 34}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
}

export function printers(env) {
  const { t } = env;
  const titleId = 'ffl-printers-title';

  const cards = drivers.map((driver) => {
    const status = driverStatus(driver);
    const links = [];
    if (driver.links.includes('BLE')) links.push(linkRow(t('land_prn_link_ble'), 'bluetooth', 'ble'));
    if (driver.links.includes('CLASSIC')) links.push(linkRow(t('land_prn_link_spp'), 'android', 'spp'));
    return h('li', { class: ['ffl-printer', `ffl-printer--${status}`, 'ffl-reveal'] },
      h('div', { class: 'ffl-printer__art' }, art('0 0 200 130', printerArt(driver), 'ffl-printer__svg')),
      h('div', { class: 'ffl-printer__body' },
        status === 'supported'
          ? pill(t('land_prn_supported'), { tone: 'mint', icon: 'check' })
          : pill(t('land_prn_pending'), { tone: 'flash', icon: 'paper' }),
        // nome di prodotto: non si traduce (come displayName nei driver)
        h('h3', { class: 'ffl-printer__name' }, driver.displayName),
        h('p', { class: 'ffl-printer__spec' }, t('prn_driver_spec', driver.dots, driver.dpi)),
        h('p', { class: 'ffl-printer__desc' }, t(DESC[driver.id] || 'prn_driver_desc_escpos58')),
        status === 'pending' ? h('p', { class: 'ffl-printer__note' }, t('land_prn_pending_note')) : null,
        h('div', { class: 'ffl-printer__links' }, ...links)));
  });

  // iPhone e iPad: nessun browser comune ha Web Bluetooth (limite di Apple). La strada è un browser che
  // lo aggiunge, come Bluefy: è un consiglio, non ancora provato su carta, e senza indirizzi inventati
  // (si cerca per nome nell'App Store). Stessa sostanza di prn_compat_ios nella schermata Stampante.
  const ios = h('div', { class: 'ffl-support__box ffl-support__box--ios' },
    h('h3', { class: 'ffl-support__title' }, icon('phone', { size: 22 }), h('span', null, t('land_ios_title'))),
    pill(t('land_ios_badge'), { tone: 'flash', icon: 'sparkles' }),
    h('p', { class: 'ffl-support__text' }, t('land_ios_text')),
    h('p', { class: 'ffl-support__tip' }, t('land_ios_tip')),
    h('p', { class: 'ffl-support__search' }, icon('search', { size: 18 }), h('span', null, t('land_ios_search'))),
    h('p', { class: 'ffl-support__line ffl-support__line--no' }, icon('close', { size: 20 }), h('span', null, t('land_ios_home'))));

  const browsers = h('div', { class: 'ffl-support ffl-reveal' },
    h('div', { class: 'ffl-support__box ffl-support__box--yes' },
      h('h3', { class: 'ffl-support__title' }, icon('globe', { size: 22 }), h('span', null, t('land_browsers_title'))),
      h('p', { class: 'ffl-support__line ffl-support__line--yes' }, icon('check', { size: 20 }), h('span', null, t('land_browsers_yes'))),
      h('p', { class: 'ffl-support__line ffl-support__line--no' }, icon('close', { size: 20 }), h('span', null, t('land_browsers_no')))),
    ios,
    h('div', { class: 'ffl-support__box ffl-support__box--not' },
      h('h3', { class: 'ffl-support__title' }, icon('warning', { size: 22 }), h('span', null, t('land_not_yet_title'))),
      h('p', { class: 'ffl-support__text' }, t('land_not_yet_text'))));

  const el = h('section', { class: 'ffl-section ffl-section--paper ffl-printers', id: 'ffl-printers', 'aria-labelledby': titleId },
    h('div', { class: 'ffl-wrap' },
      sectionHead({ num: '05', eyebrow: t('land_printers_eyebrow'), title: t('land_printers_title'), lead: t('land_printers_lead'), id: titleId }),
      h('ul', { class: 'ffl-printers__list' }, ...cards),
      browsers));
  return { el };
}
