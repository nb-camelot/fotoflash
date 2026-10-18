// Font del brand per la carta: Righteous (titoli, marchio) e Space Mono 400/700 (dati, didascalie).
// Il canvas usa un web font solo quando è già caricato: altrimenti ripiega in silenzio sul
// carattere di sistema. Per questo il renderer aspetta ensureFonts() prima di disegnare.

/** Famiglie CSS: gli stessi nomi che usa il foglio di stile dell'app. */
export const FONT_FAMILY = Object.freeze({ display: 'Righteous', mono: 'Space Mono' });

/** I file stanno in fonts/ alla radice del sito (copiati da app/src/main/res/font/). */
const FACES = [
  { family: FONT_FAMILY.display, weight: '400', file: 'righteous_regular.ttf' },
  { family: FONT_FAMILY.mono, weight: '400', file: 'space_mono_regular.ttf' },
  { family: FONT_FAMILY.mono, weight: '700', file: 'space_mono_bold.ttf' },
];

/** Oltre questo tempo si stampa con il carattere di sistema, come fa l'app se il font manca. */
const LOAD_TIMEOUT_MS = 8000;

/**
 * Metriche verticali dei TTF del brand (tabelle hhea/OS2 e glifo "H"), in em.
 * spacing = (ascender − descender + lineGap) / unitsPerEm = Paint.fontSpacing di Android;
 * capHeight = altezza della "H". Servono quando il canvas non sa misurarle.
 */
export const FONT_METRICS = Object.freeze({
  DISPLAY: Object.freeze({ ascent: 2017 / 2048, descent: 526 / 2048, spacing: 2543 / 2048, capHeight: 1434 / 2048 }),
  MONO: Object.freeze({ ascent: 1.12, descent: 0.361, spacing: 1.481, capHeight: 0.7 }),
  MONO_BOLD: Object.freeze({ ascent: 1.12, descent: 0.361, spacing: 1.481, capHeight: 0.7 }),
});

/**
 * Stringa CSS `font` per il canvas, dal ruolo del core (FontRole) e dal corpo in punti.
 * La famiglia con lo spazio va tra virgolette; i ripieghi sono quelli dell'app (bold, monospace).
 */
export function fontFor(role, sizePx) {
  const size = `${+Number(sizePx).toFixed(3)}px`;
  switch (role) {
    case 'MONO_BOLD':
      return `700 ${size} "${FONT_FAMILY.mono}", monospace`;
    case 'MONO':
      return `400 ${size} "${FONT_FAMILY.mono}", monospace`;
    case 'DISPLAY':
    default:
      return `400 ${size} "${FONT_FAMILY.display}", sans-serif`;
  }
}

/** URL di un file di font, relativo a questo modulo: funziona sotto /fotoflash/ e in locale. */
export function fontUrl(file) {
  return new URL(`../../fonts/${file}`, import.meta.url).href;
}

function fontSet() {
  return globalThis.document?.fonts ?? globalThis.fonts ?? null;
}

const unquote = (s) => String(s ?? '').replace(/^["']|["']$/g, '').trim().toLowerCase();

function normWeight(w) {
  const s = String(w ?? '400').trim().toLowerCase();
  if (s === 'normal') return '400';
  if (s === 'bold') return '700';
  return s;
}

/** Faccia già registrata (dal CSS dell'app o da una chiamata precedente) per famiglia e peso. */
function findFace(set, family, weight) {
  try {
    for (const face of set) {
      if (unquote(face.family) === family.toLowerCase() && normWeight(face.weight) === weight && face.status !== 'error') {
        return face;
      }
    }
  } catch {
    // FontFaceSet non iterabile in qualche browser vecchio: si crea la faccia
  }
  return null;
}

async function loadFace(set, spec) {
  let face = findFace(set, spec.family, spec.weight);
  if (!face) {
    face = new FontFace(spec.family, `url("${fontUrl(spec.file)}") format("truetype")`, {
      weight: spec.weight,
      style: 'normal',
      display: 'swap',
    });
    set.add(face);
  }
  if (face.status !== 'loaded') await face.load();
  return face.status === 'loaded';
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let pending = null;
let ready = false;

/** true se i tre font del brand sono caricati (dopo un ensureFonts riuscito). */
export function fontsReady() {
  return ready;
}

/**
 * Carica Righteous e Space Mono 400/700 da ./fonts/*.ttf (FontFace + document.fonts) e li
 * aspetta. → Promise<boolean>: true se sono tutti pronti. Senza FontFace (Node, browser
 * vecchi) o in caso di errore restituisce false: la stampa esce col carattere di sistema.
 * Un fallimento non resta in memoria: la chiamata successiva riprova.
 */
export async function ensureFonts() {
  if (ready) return true;
  const set = fontSet();
  if (!set || typeof FontFace === 'undefined') return false;
  if (!pending) {
    pending = withTimeout(
      Promise.all(FACES.map((spec) => loadFace(set, spec).catch(() => false))).then((all) => all.every(Boolean)),
      LOAD_TIMEOUT_MS,
    ).then((ok) => {
      ready = ok;
      pending = null;
      return ok;
    });
  }
  return pending;
}
