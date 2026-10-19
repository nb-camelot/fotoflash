// Pezzi delle illustrazioni animate, come markup SVG statico (niente testo dell'utente: le scritte
// arrivano dopo, con textContent, dagli elementi data-k). Stile del brand: tinte piene, contorni Ink
// tondi da 3-4, ombre piene spostate, retino, scintille, coriandoli.
//
// Convenzione per le animazioni CSS: il gruppo esterno posiziona (attributo transform), quello
// interno con la classe si anima (proprietà CSS transform, origine 0 0 = il suo punto di perno).
// Così una rotazione gira attorno alla spalla, alla coda o alla base, senza calcoli nel CSS.

export const C = Object.freeze({
  ink: '#16130F',
  paper: '#FBF8F1',
  flash: '#FFCC00',
  flashDeep: '#E0A800',
  coral: '#FF5B45',
  mint: '#22B89A',
  sky: '#3D8BFF',
  graphite: '#4A4640',
  fog: '#EDE8DE',
  night: '#0E0C0A',
});

/** Spessore dei contorni. */
export const SW = 3.5;

/** Numero corto per il markup. */
export function n(v) {
  return String(Math.round(v * 10) / 10);
}

/** Generatore pseudo-casuale con seme (mulberry32): coriandoli uguali a ogni giro e in ogni test. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gruppo posizionato con dentro un gruppo animabile ([cls]). [attrs]: attributi in più del gruppo
 * interno, per esempio data-a (attore) o data-fx (effetto).
 */
export function at(x, y, cls, inner, { style = '', extra = '', attrs = '' } = {}) {
  const s = style ? ` style="${style}"` : '';
  const a = attrs ? ` ${attrs}` : '';
  return `<g transform="translate(${n(x)} ${n(y)})"${extra}><g class="${cls}"${s}${a}>${inner}</g></g>`;
}

/** Disco di colore dietro la scena (come nelle tavole dell'onboarding). */
export function backdrop(color, cx = 240, cy = 184, r = 150) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
}

/** Linea del pavimento. */
export function floorLine(y = 322, x0 = 30, x1 = 450) {
  return `<path d="M${x0} ${y}H${x1}" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>`;
}

/** Bagliore del flash su tutta la scena, acceso nelle battute [fx]. */
export function glare(fx, w = 480, h = 360) {
  return `<rect class="ffx-fx-glare" data-fx="${fx}" width="${w}" height="${h}" fill="${C.paper}"/>`;
}

/** Finestra che nasconde la carta ancora dentro la stampante: tutto ciò che sta sopra la fessura. */
export function slotWindow(slotY, inner, w = 480) {
  return `<svg x="0" y="0" width="${w}" height="${n(slotY)}" overflow="hidden">${inner}</svg>`;
}

/** Fumetto che compare nelle battute [fx] (keep: resta nel fotogramma fermo). */
export function say(x, y, key, w, h, tail, fx, { keep = false } = {}) {
  return at(x, y, 'ffx-fx-say', bubble(key, w, h, tail), { attrs: `data-fx="${fx}"${keep ? ' data-keep=""' : ''}` });
}

/** Telefono sul treppiede, con il lampo dietro che scatta nelle battute [fx]. */
export function tripodPhone(x, y, fx, { h = 60, legs = 322, screen = C.sky, inner = '' } = {}) {
  const w = Math.round(h * 0.58);
  return `<path d="M${x} ${n(y + h / 2)}L${n(x - 24)} ${legs}M${x} ${n(y + h / 2)}L${n(x + 24)} ${legs}M${x} ${n(y + h / 2)}V${legs}" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>` +
    `<rect x="${n(x - 9)}" y="${n(y + h / 2 - 4)}" width="18" height="9" rx="3" fill="${C.graphite}" stroke="${C.ink}" stroke-width="2.5"/>` +
    flashBurst(x, y - 4, h * 0.62, '', fx) +
    at(x, y, '', phone(w, h, { screen }) + inner);
}

/** Stellina a quattro punte con i lati concavi, centrata in 0,0. */
export function starPath(r) {
  const k = r * 0.2;
  return `M0 ${n(-r)}Q${n(k)} ${n(-k)} ${n(r)} 0Q${n(k)} ${n(k)} 0 ${n(r)}Q${n(-k)} ${n(k)} ${n(-r)} 0Q${n(-k)} ${n(-k)} 0 ${n(-r)}Z`;
}

/** Scintilla che brilla (classe ffx-tw), Ink oppure Flash con contorno Ink. */
export function sparkle(x, y, r, { fill = 'currentColor', outline = false, delay = 0 } = {}) {
  const stroke = outline ? ` stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"` : '';
  return at(x, y, 'ffx-tw', `<path d="${starPath(r)}" fill="${fill}"${stroke}/>`, { style: `animation-delay:${delay}ms` });
}

/** Cuore centrato in 0,0. */
export function heartPath(s) {
  return `M0 ${n(s * 0.9)}C${n(-s * 1.7)} ${n(-s * 0.2)} ${n(-s * 0.7)} ${n(-s * 1.35)} 0 ${n(-s * 0.4)}C${n(s * 0.7)} ${n(-s * 1.35)} ${n(s * 1.7)} ${n(-s * 0.2)} 0 ${n(s * 0.9)}Z`;
}

export function heart(s, fill = C.coral) {
  return `<path d="${heartPath(s)}" fill="${fill}" stroke="${C.ink}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

/** Puntino colorato con contorno. */
export function dot(x, y, r, fill) {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="${C.ink}" stroke-width="3"/>`;
}

/**
 * Retino del brand (HalftoneBurst): puntini su griglia sfalsata che rimpiccioliscono verso il
 * bordo, in un quadrato di lato [size] con l'angolo in ([x], [y]). Colore del testo.
 */
export function halftone(x, y, size, spacing = 9, cls = 'ffx-ht') {
  const maxDot = spacing * 0.42;
  const c = size / 2;
  let d = '';
  const count = Math.floor(size / spacing) + 1;
  for (let row = 0; row <= count; row++) {
    const shift = row % 2 === 0 ? 0 : spacing / 2;
    const yy = row * spacing;
    for (let col = -1; col <= count; col++) {
      const xx = col * spacing + shift;
      const dist = Math.hypot(xx - c, yy - c) / c;
      if (dist >= 1) continue;
      const r = maxDot * (1 - dist);
      if (r < 0.6) continue;
      d += `M${n(xx - r)} ${n(yy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0z`;
    }
  }
  return `<path class="${cls}" transform="translate(${n(x)} ${n(y)})" d="${d}" fill="currentColor"/>`;
}

/** Sole del flash: stella a [points] punte, carta con contorno Ink, centrata in 0,0. */
export function burstPath(r, points = 10, inner = 0.55) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    d += `${i === 0 ? 'M' : 'L'}${n(Math.cos(a) * rr)} ${n(Math.sin(a) * rr)}`;
  }
  return `${d}Z`;
}

/**
 * Lampo del flash in ([x], [y]): sole che si espande e raggi. [cls] è la classe che il CSS
 * accende nelle battute giuste (keyframe ffx-burst).
 */
export function flashBurst(x, y, r, cls = '', fx = '') {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
    rays += `M${n(Math.cos(a) * r * 1.15)} ${n(Math.sin(a) * r * 1.15)}L${n(Math.cos(a) * r * 1.7)} ${n(Math.sin(a) * r * 1.7)}`;
  }
  const classes = ['ffx-burst', fx ? 'ffx-fx-burst' : '', cls].filter(Boolean).join(' ');
  return at(x, y, classes,
    `<path d="${burstPath(r)}" fill="${C.paper}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>` +
    `<circle r="${n(r * 0.32)}" fill="${C.flash}" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<path d="${rays}" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>`,
    { attrs: fx ? `data-fx="${fx}"` : '' });
}

/** Lampo del marchio (7 vertici), alto circa [h], centrato in 0,0. */
export function boltPath(h) {
  const k = h / 23;
  const pts = [[-0.5, -11.5], [6.5, -11.5], [2.5, -4], [8, -4], [-4, 11.5], [-1.5, 1], [-7.5, 1]];
  return `M${pts.map(([x, y]) => `${n(x * k)} ${n(y * k)}`).join('L')}Z`;
}

/**
 * Coriandoli che esplodono da ([x], [y]): ogni pezzo ha la sua traiettoria nelle variabili CSS
 * (--dx, --dy, --r, --fall); partono con la classe is-fx (data-fx = battute) o con una regola su [cls].
 */
export function confetti(x, y, count, { seed = 7, spread = 150, up = 110, fall = 90, cls = '', fx = '' } = {}) {
  const rnd = seeded(seed);
  const colors = [C.coral, C.mint, C.sky, C.flash];
  let out = '';
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.3;
    const dist = 0.45 + rnd() * 0.55;
    const dx = Math.cos(angle) * spread * dist;
    const dy = Math.sin(angle) * up * dist - 10;
    const r = Math.round((rnd() - 0.5) * 720);
    const delay = Math.round(rnd() * 120);
    const color = colors[i % colors.length];
    const shape = i % 3 === 0
      ? `<circle r="3.6" fill="${color}" stroke="${C.ink}" stroke-width="1.6"/>`
      : `<rect x="-3" y="-5.5" width="6" height="11" rx="1.5" fill="${color}" stroke="${C.ink}" stroke-width="1.6"/>`;
    const style = `--dx:${n(dx)}px;--dy:${n(dy)}px;--r:${r}deg;--fall:${n(fall * (0.6 + rnd() * 0.6))}px;animation-delay:${delay}ms`;
    out += `<g class="ffx-cf" style="${style}">${shape}</g>`;
  }
  return at(x, y, `ffx-confetti ${cls}`.trim(), out, { attrs: fx ? `data-fx="${fx}"` : '' });
}

/**
 * Fumetto con una scritta (data-k: chiave della traduzione), centrato in 0,0; la coda punta verso
 * [tail]: 'left' | 'right' | 'down'. Il testo lo mette e lo adatta il JS.
 */
export function bubble(key, w, h, tail = 'down', fill = C.paper) {
  const r = h / 2;
  const x0 = -w / 2;
  const y0 = -h / 2;
  let tailPath;
  if (tail === 'left') tailPath = `M${n(x0 + 10)} ${n(y0 + h - 6)}L${n(x0 - 10)} ${n(y0 + h + 8)}L${n(x0 + 22)} ${n(y0 + h - 2)}`;
  else if (tail === 'right') tailPath = `M${n(-x0 - 10)} ${n(y0 + h - 6)}L${n(-x0 + 10)} ${n(y0 + h + 8)}L${n(-x0 - 22)} ${n(y0 + h - 2)}`;
  else tailPath = `M-8 ${n(y0 + h - 2)}L0 ${n(y0 + h + 12)}L8 ${n(y0 + h - 2)}`;
  return `<path d="${tailPath}Z" fill="${fill}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>` +
    `<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${fill}" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="${tailPath}" fill="${fill}" stroke="none"/>` +
    `<text class="ffx-sfx" data-k="${key}" data-fit="${n(w - 18)}" x="0" y="${n(h * 0.17)}" text-anchor="middle" font-size="${n(h * 0.5)}"></text>`;
}

/**
 * Stampantina simpatica vista di fronte. Origine (0,0) al centro della fessura; il corpo va da
 * -[w]/2 a [w]/2 e scende di [h]. Le parti: back (dietro la carta) e front (davanti).
 * Classi: ffx-pr (corpo, trema mentre stampa), ffx-pr-led, ffx-e-* e ffx-m-* (la faccia).
 */
export function printer({ w = 120, h = 64, body = C.mint, lid = C.paper, slot = 0.8, led = C.flash } = {}) {
  const x0 = -w / 2;
  const sw = w * slot;
  const lidH = Math.max(8, Math.round(h * 0.11));
  const back = `<path d="M${n(x0 + 8)} ${-lidH}H${n(-x0 - 8)}L${n(-x0 - 2)} 0H${n(x0 + 2)}Z" fill="${lid}" stroke="${C.ink}" stroke-width="${SW}" stroke-linejoin="round"/>` +
    `<rect x="${n(-sw / 2)}" y="${n(-lidH / 2 - 3)}" width="${n(sw)}" height="6" rx="3" fill="${C.ink}"/>`;
  // la faccia cresce con la stampante: occhi, guance e bocca in proporzione all'altezza
  const k = h / 64;
  const ey = h * 0.44;
  const ex = Math.min(w * 0.16, h * 0.34);
  const er = 3.8 * k;
  const sw2 = Math.max(2.4, 2.6 * Math.sqrt(k));
  const face =
    `<g class="ffx-eyes"><g class="ffx-e-dot"><circle cx="${n(-ex)}" cy="${n(ey)}" r="${n(er)}" fill="${C.ink}"/><circle cx="${n(ex)}" cy="${n(ey)}" r="${n(er)}" fill="${C.ink}"/>` +
    `<circle cx="${n(-ex + er * 0.35)}" cy="${n(ey - er * 0.35)}" r="${n(er * 0.32)}" fill="${C.paper}"/><circle cx="${n(ex + er * 0.35)}" cy="${n(ey - er * 0.35)}" r="${n(er * 0.32)}" fill="${C.paper}"/></g>` +
    `<path class="ffx-e-happy" d="M${n(-ex - er * 1.3)} ${n(ey + er * 0.5)}Q${n(-ex)} ${n(ey - er * 1.6)} ${n(-ex + er * 1.3)} ${n(ey + er * 0.5)}M${n(ex - er * 1.3)} ${n(ey + er * 0.5)}Q${n(ex)} ${n(ey - er * 1.6)} ${n(ex + er * 1.3)} ${n(ey + er * 0.5)}" fill="none" stroke="${C.ink}" stroke-width="${n(sw2)}" stroke-linecap="round"/>` +
    `<path class="ffx-e-shut" d="M${n(-ex - er * 1.2)} ${n(ey - er * 0.8)}L${n(-ex + er)} ${n(ey)}L${n(-ex - er * 1.2)} ${n(ey + er * 0.8)}M${n(ex + er * 1.2)} ${n(ey - er * 0.8)}L${n(ex - er)} ${n(ey)}L${n(ex + er * 1.2)} ${n(ey + er * 0.8)}" fill="none" stroke="${C.ink}" stroke-width="${n(sw2)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<g class="ffx-e-wide"><circle cx="${n(-ex)}" cy="${n(ey)}" r="${n(er * 1.5)}" fill="${C.paper}" stroke="${C.ink}" stroke-width="${n(sw2 * 0.8)}"/><circle cx="${n(ex)}" cy="${n(ey)}" r="${n(er * 1.5)}" fill="${C.paper}" stroke="${C.ink}" stroke-width="${n(sw2 * 0.8)}"/><circle cx="${n(-ex)}" cy="${n(ey)}" r="${n(er * 0.7)}" fill="${C.ink}"/><circle cx="${n(ex)}" cy="${n(ey)}" r="${n(er * 0.7)}" fill="${C.ink}"/></g></g>` +
    `<ellipse cx="${n(-ex - er * 2.2)}" cy="${n(ey + er * 2.3)}" rx="${n(er * 1.5)}" ry="${n(er * 0.95)}" fill="${C.coral}"/><ellipse cx="${n(ex + er * 2.2)}" cy="${n(ey + er * 2.3)}" rx="${n(er * 1.5)}" ry="${n(er * 0.95)}" fill="${C.coral}"/>` +
    `<path class="ffx-m-smile" d="M${n(-er * 1.9)} ${n(ey + er * 2)}Q0 ${n(ey + er * 3.9)} ${n(er * 1.9)} ${n(ey + er * 2)}" fill="none" stroke="${C.ink}" stroke-width="${n(sw2)}" stroke-linecap="round"/>` +
    `<path class="ffx-m-open" d="M${n(-er * 2.1)} ${n(ey + er * 1.8)}Q0 ${n(ey + er * 5.4)} ${n(er * 2.1)} ${n(ey + er * 1.8)}Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>` +
    `<ellipse class="ffx-m-o" cx="0" cy="${n(ey + er * 2.6)}" rx="${n(er * 0.8)}" ry="${n(er)}" fill="${C.ink}"/>`;
  const r = Math.min(h * 0.32, 44);
  const feet = `<rect x="${n(x0 + w * 0.16)}" y="${n(h - 6)}" width="${n(w * 0.14)}" height="14" rx="6" fill="${C.ink}"/>` +
    `<rect x="${n(-x0 - w * 0.3)}" y="${n(h - 6)}" width="${n(w * 0.14)}" height="14" rx="6" fill="${C.ink}"/>`;
  const front = feet +
    `<rect x="${n(x0 + 5)}" y="5" width="${n(w)}" height="${n(h - 1)}" rx="${n(r)}" fill="${C.ink}"/>` +
    `<rect x="${n(x0)}" y="0" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${body}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    face +
    `<circle class="ffx-pr-led" cx="${n(-x0 - r * 0.62)}" cy="${n(r * 0.62)}" r="${n(Math.max(3.5, 3.2 * k))}" fill="${led}" stroke="${C.ink}" stroke-width="2.5"/>`;
  return { back, front };
}

/**
 * Carta termica a dente di sega, larga [w] e alta [h], con l'angolo in alto a sinistra in (0,0).
 * Denti 2:1 su [edges] ('top', 'bottom' o entrambi), ombra piena a destra e in basso.
 */
export function paperPath(w, h, { edges = 'both', tooth = 8 } = {}) {
  const teeth = Math.max(2, Math.round(w / tooth));
  const tw = w / teeth;
  const depth = tw / 2;
  let d = 'M0 0';
  if (edges === 'top' || edges === 'both') {
    d = `M0 ${n(depth)}`;
    for (let i = 0; i < teeth; i++) d += `L${n(tw * i + tw / 2)} 0L${n(tw * (i + 1))} ${n(depth)}`;
  } else {
    d += `H${n(w)}`;
  }
  if (edges === 'bottom' || edges === 'both') {
    d += `L${n(w)} ${n(h - depth)}`;
    for (let i = teeth - 1; i >= 0; i--) d += `L${n(tw * i + tw / 2)} ${n(h)}L${n(tw * i)} ${n(h - depth)}`;
  } else {
    d += `L${n(w)} ${n(h)}H0`;
  }
  return `${d}Z`;
}

export function paperSheet(w, h, opts = {}) {
  const d = paperPath(w, h, opts);
  const shadow = opts.shadow === false ? '' : `<path d="${d}" transform="translate(3 3)" fill="${opts.shadowColor || C.ink}" opacity="${opts.shadowOpacity ?? 1}"/>`;
  return `${shadow}<path d="${d}" fill="${C.paper}" stroke="${C.ink}" stroke-width="${opts.sw ?? 2.5}" stroke-linejoin="round"/>`;
}

/**
 * Foto retinata dentro una stampa: posto per il tracciato dei punti ([slot] = nome della foto,
 * il JS ci mette il path), scalato da [dots] punti a [w] unità di larghezza.
 */
export function photoSlot(slot, x, y, w, dotsW, dotsH) {
  const k = w / dotsW;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(dotsH * k)}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.5"/>` +
    `<path data-photo="${slot}" transform="translate(${n(x)} ${n(y)}) scale(${Math.round(k * 1000) / 1000})" fill="${C.ink}" d=""/>`;
}

/** Testo "di stampa" in Space Mono (data-k chiave, data-n numero facoltativo), adattato alla larghezza [fit]. */
export function paperText(key, x, y, size, fit, { anchor = 'middle', weight = 700, num = null, cls = '' } = {}) {
  const nAttr = num === null ? '' : ` data-n="${num}"`;
  return `<text class="ffx-mono ${cls}" data-k="${key}"${nAttr} data-fit="${n(fit)}" x="${n(x)}" y="${n(y)}" font-size="${n(size)}" font-weight="${weight}" text-anchor="${anchor}"></text>`;
}

const LIMB_W = 12;

function limb(dx, dy, color, hand = C.paper) {
  const d = `M0 0L${n(dx)} ${n(dy)}`;
  return `<path d="${d}" stroke="${C.ink}" stroke-width="${LIMB_W}" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="${color}" stroke-width="${LIMB_W - 6}" stroke-linecap="round"/>` +
    `<circle cx="${n(dx)}" cy="${n(dy + 2)}" r="6.5" fill="${hand}" stroke="${C.ink}" stroke-width="3"/>`;
}

const HAIR = {
  bowl: (c) => `<path d="M-27.5 -24C-28 -44 -14 -55 0 -55S28 -44 27.5 -24C20 -34 6 -38 -6 -35C-14 -33 -22 -29 -27.5 -24Z" fill="${c}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>`,
  bun: (c) => `<circle cx="0" cy="-58" r="10" fill="${c}" stroke="${C.ink}" stroke-width="3"/>` + HAIR.bowl(c),
  pigtails: (c) => `<circle cx="-29" cy="-30" r="9" fill="${c}" stroke="${C.ink}" stroke-width="3"/><circle cx="29" cy="-30" r="9" fill="${c}" stroke="${C.ink}" stroke-width="3"/>` + HAIR.bowl(c),
  curly: (c) => [[-22, -38], [-12, -48], [0, -52], [12, -48], [22, -38], [27, -26], [-27, -26]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9.5" fill="${c}" stroke="${C.ink}" stroke-width="3"/>`).join('') +
    `<path d="M-24 -32C-16 -44 16 -44 24 -32" fill="${c}"/>`,
  spike: (c) => `<path d="M-26 -30L-22 -46L-13 -40L-8 -55L0 -44L8 -56L13 -41L22 -47L26 -30C14 -37 -14 -37 -26 -30Z" fill="${c}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>`,
  side: (c) => `<path d="M-27 -22C-29 -45 -12 -55 4 -54C20 -53 30 -42 27 -26C18 -40 -2 -44 -27 -22Z" fill="${c}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>`,
  none: () => '',
};

/** Cappellino da festa a righe con il pompon. */
function partyHat(color) {
  return `<g transform="translate(6 -50) rotate(14)"><path d="M-13 0L13 0L1 -36Z" fill="${color}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M-8 -12L9 -12M-4 -24L5 -24" stroke="${C.paper}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<circle cx="1" cy="-38" r="5" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/></g>`;
}

/** Faccia: occhi e bocca in tutte le varianti; il JS sceglie con data-eyes e data-mouth. */
function faceParts() {
  return `<g class="ffx-eyes">` +
    `<g class="ffx-e-dot"><circle cx="-9.5" cy="-26" r="3.4" fill="${C.ink}"/><circle cx="9.5" cy="-26" r="3.4" fill="${C.ink}"/></g>` +
    `<path class="ffx-e-happy" d="M-14 -24Q-9.5 -31 -5 -24M5 -24Q9.5 -31 14 -24" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<g class="ffx-e-wide"><circle cx="-9.5" cy="-27" r="5.4" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/><circle cx="9.5" cy="-27" r="5.4" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.5"/><circle cx="-9" cy="-26.5" r="2.4" fill="${C.ink}"/><circle cx="10" cy="-26.5" r="2.4" fill="${C.ink}"/></g>` +
    `<path class="ffx-e-wink" d="M-14 -24Q-9.5 -31 -5 -24" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle class="ffx-e-wink" cx="9.5" cy="-26" r="3.4" fill="${C.ink}"/>` +
    `</g>` +
    `<ellipse cx="-16" cy="-16.5" rx="5" ry="3.2" fill="${C.coral}"/><ellipse cx="16" cy="-16.5" rx="5" ry="3.2" fill="${C.coral}"/>` +
    `<path class="ffx-m-smile" d="M-7.5 -15Q0 -8 7.5 -15" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<path class="ffx-m-open" d="M-9 -16Q0 -1 9 -16Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<g class="ffx-m-tongue"><path d="M-8 -15Q0 -8 8 -15" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><path d="M-1 -11.5Q3 -3 7 -10.5Z" fill="${C.coral}" stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round"/></g>` +
    `<ellipse class="ffx-m-o" cx="0" cy="-12" rx="3.6" ry="4.4" fill="${C.ink}"/>`;
}

/**
 * Personaggio stilizzato con i piedi in ([x], [y]) e scala [s]. [who] lo identifica per il CSS
 * (classe ffx-who-<who>, data-mouth/data-eyes per l'espressione). Opzioni: shirt (colore),
 * hair (forma), hairColor, hat (colore del cappellino da festa), dress (vestito lungo),
 * tie (farfallino), holdL/holdR (markup tenuto nella mano sinistra/destra, mano in 0,0).
 */
export function person(who, x, y, s, opts = {}) {
  const {
    shirt = C.sky, hair = 'bowl', hairColor = C.ink, hat = null, dress = false, tie = null,
    holdL = '', holdR = '', legs = C.ink, armL = [-7, 32], armR = [7, 32], jump = '', veil = false,
  } = opts;
  const body = dress
    ? `<path d="M-22 -76Q0 -84 22 -76L36 0H-36Z" transform="translate(4 4)" fill="${C.ink}"/>` +
      `<path d="M-22 -76Q0 -84 22 -76L36 0H-36Z" fill="${shirt}" stroke="${C.ink}" stroke-width="${SW}" stroke-linejoin="round"/>`
    : `<rect x="-17" y="-30" width="13" height="30" rx="6" fill="${legs}" stroke="${C.ink}" stroke-width="3"/>` +
      `<rect x="4" y="-30" width="13" height="30" rx="6" fill="${legs}" stroke="${C.ink}" stroke-width="3"/>` +
      `<rect x="-21" y="-74" width="50" height="50" rx="19" fill="${C.ink}"/>` +
      `<rect x="-25" y="-78" width="50" height="52" rx="19" fill="${shirt}" stroke="${C.ink}" stroke-width="${SW}"/>`;
  const bow = tie
    ? `<path d="M0 -76L-10 -82V-70ZM0 -76L10 -82V-70Z" fill="${tie}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="0" cy="-76" r="3" fill="${tie}" stroke="${C.ink}" stroke-width="2"/>`
    : '';
  // velo da sposa: dietro alla testa, scende sulle spalle
  const veilShape = veil
    ? `<path d="M-30 -40C-46 -10 -44 30 -34 62H34C44 30 46 -10 30 -40C18 -58 -18 -58 -30 -40Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>`
    : '';
  const head =
    `<circle cx="3" cy="-23" r="27" fill="${C.ink}"/>` +
    `<circle cx="0" cy="-26" r="27" fill="${C.paper}" stroke="${C.ink}" stroke-width="${SW}"/>` +
    (HAIR[hair] || HAIR.bowl)(hairColor) + faceParts() + (hat ? partyHat(hat) : '') +
    (veil ? `<path d="M-14 -50Q0 -60 14 -50" fill="none" stroke="${C.flash}" stroke-width="5" stroke-linecap="round"/><circle cx="-14" cy="-50" r="4" fill="${C.coral}" stroke="${C.ink}" stroke-width="2"/><circle cx="14" cy="-50" r="4" fill="${C.mint}" stroke="${C.ink}" stroke-width="2"/>` : '');
  const jumpAttr = jump ? ` data-fx="${jump}"` : '';
  return `<g transform="translate(${n(x)} ${n(y)})"><g data-a="${who}"><g transform="scale(${s})"><g class="ffx-who ffx-who-${who}" data-mouth="smile" data-eyes="dot">` +
    `<g class="ffx-jump ffx-fx-hop"${jumpAttr}>${veil ? `<g transform="translate(0 -78)">${veilShape}</g>` : ''}${body}${bow}` +
    `<g transform="translate(-22 -66)"><g class="ffx-arm ffx-arm-l" data-a="${who}-armL">${limb(armL[0], armL[1], shirt)}<g transform="translate(${armL[0]} ${armL[1] + 2})">${holdL}</g></g></g>` +
    `<g transform="translate(22 -66)"><g class="ffx-arm ffx-arm-r" data-a="${who}-armR">${limb(armR[0], armR[1], shirt)}<g transform="translate(${armR[0]} ${armR[1] + 2})">${holdR}</g></g></g>` +
    `<g transform="translate(0 -78)"><g class="ffx-head" data-a="${who}-head">${head}</g></g>` +
    `</g></g></g></g></g>`;
}

/** Telefono visto di lato, con l'obiettivo e il led del flash; origine al centro. */
export function phone(w = 30, h = 54, { screen = C.sky } = {}) {
  return `<rect x="${n(-w / 2 + 3)}" y="${n(-h / 2 + 3)}" width="${n(w)}" height="${n(h)}" rx="7" fill="${C.ink}"/>` +
    `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="7" fill="${C.ink}" stroke="${C.ink}" stroke-width="3"/>` +
    `<rect x="${n(-w / 2 + 4)}" y="${n(-h / 2 + 5)}" width="${n(w - 8)}" height="${n(h - 14)}" rx="3" fill="${screen}"/>` +
    `<circle cx="0" cy="${n(h / 2 - 4.5)}" r="2.6" fill="${C.flash}"/>`;
}
