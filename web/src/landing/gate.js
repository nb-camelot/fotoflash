// Chi vede la presentazione e chi va dritto all'app. Funzione pura (niente DOM): la chiama app.js
// con le misure lette dal browser e la provano i test in Node.

/** Indirizzo che apre sempre la presentazione, anche sul telefono e nell'app installata. */
export const LANDING_HASH = '#/landing';

/** Da questa larghezza (px CSS) la colonna da telefono sembrerebbe tagliata: si mostra la presentazione. */
export const WIDE_MIN_WIDTH = 960;

// Hash che vogliono dire "nessuna schermata scelta": solo lì la presentazione prende il posto dell'app.
const HOME_HASHES = new Set(['', '#', '#/']);

/**
 * true se va mostrata la presentazione:
 * - hash '#/landing', sempre (è una richiesta esplicita, anche da Impostazioni);
 * - oppure browser non installato, schermo largo almeno WIDE_MIN_WIDTH e nessuna rotta nell'hash.
 * Un deep link (#/camera, #/history/…) va sempre all'app: chi lo apre vuole quella schermata.
 */
export function shouldShowLanding({ width, standalone, hash } = {}) {
  const h = typeof hash === 'string' ? hash.trim() : '';
  if (h === LANDING_HASH) return true;
  if (standalone) return false;
  const w = Number(width);
  if (!Number.isFinite(w) || w < WIDE_MIN_WIDTH) return false;
  return HOME_HASHES.has(h);
}
