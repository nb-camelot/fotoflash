// Riconoscimento del controluce: porting di Backlight.kt.
// Soggetto scuro al centro, sfondo molto chiaro attorno: è il caso in cui l'esposizione automatica
// sacrifica il viso per salvare il cielo, e la carta termica trasforma il viso in una macchia.

/** Semiassi dell'ellisse centrale in frazione di metà larghezza e metà altezza. */
export const CENTER_AXIS = 0.8;
/** Raggio (in unità dell'ellisse centrale) da cui comincia il bordo. */
export const BORDER_RADIUS = 1.15;
/** Luminanza da cui un pixel del bordo conta come "quasi bianco". */
export const NEAR_WHITE = 230;
export const GAP_START = 25.0;
export const GAP_FULL = 110.0;
export const BRIGHT_START = 150.0;
export const BRIGHT_FULL = 200.0;
export const WHITE_SHARE_FULL = 0.35;

// 0 sotto [from], 1 sopra [to], lineare in mezzo
function ramp(v, from, to) {
  const r = (v - from) / (to - from);
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/**
 * Quanto la scena è in controluce: 0 = per niente, 1 = controluce forte (un Float in Kotlin).
 * Centro = ellisse con semiassi 0.8 x metà lato; bordo = fuori dall'ellisse ingrandita di 1.15.
 * gap = rampa(b - c, 25..110), bright = max(rampa(b, 150..200), w / 0.35), score = gap * bright.
 * Immagini troppo piccole per avere sia centro sia bordo danno 0.
 */
export function backlightScore(src) {
  const w = src.width;
  const h = src.height;
  const px = src.pixels;
  const cx = w / 2.0;
  const cy = h / 2.0;
  const ax = (CENTER_AXIS * w) / 2.0;
  const ay = (CENTER_AXIS * h) / 2.0;
  const border2 = BORDER_RADIUS * BORDER_RADIUS;

  let centerSum = 0;
  let centerCount = 0;
  let borderSum = 0;
  let borderCount = 0;
  let borderWhite = 0;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const dy = (y + 0.5 - cy) / ay;
    const dy2 = dy * dy;

    // centro: |x + 0.5 - cx| <= ax * sqrt(1 - dy^2), come intervallo intero di colonne
    if (dy2 <= 1.0) {
      const half = ax * Math.sqrt(1.0 - dy2);
      const from = Math.max(0, Math.trunc(Math.ceil(cx - half - 0.5)));
      const to = Math.min(w - 1, Math.trunc(Math.floor(cx + half - 0.5)));
      for (let x = from; x <= to; x++) {
        centerSum += px[row + x];
        centerCount++;
      }
    }

    // bordo: le colonne fuori dall'ellisse ingrandita, [0, innerFrom) e (innerTo, w)
    let innerFrom = w;
    let innerTo = w - 1;
    if (dy2 < border2) {
      const half = ax * Math.sqrt(border2 - dy2);
      innerFrom = Math.max(0, Math.trunc(Math.ceil(cx - half - 0.5)));
      innerTo = Math.min(w - 1, Math.trunc(Math.floor(cx + half - 0.5)));
    }
    if (innerFrom > innerTo) {
      // riga tutta fuori (o ellisse più stretta di un pixel): è tutta bordo
      innerFrom = w;
      innerTo = w - 1;
    }
    for (let x = 0; x < innerFrom; x++) {
      const v = px[row + x];
      borderSum += v;
      borderCount++;
      if (v >= NEAR_WHITE) borderWhite++;
    }
    for (let x = innerTo + 1; x < w; x++) {
      const v = px[row + x];
      borderSum += v;
      borderCount++;
      if (v >= NEAR_WHITE) borderWhite++;
    }
  }
  if (centerCount === 0 || borderCount === 0) return 0;

  const c = centerSum / centerCount;
  const b = borderSum / borderCount;
  const white = borderWhite / borderCount;
  const gap = ramp(b - c, GAP_START, GAP_FULL);
  const share = white / WHITE_SHARE_FULL;
  const bright = Math.max(ramp(b, BRIGHT_START, BRIGHT_FULL), share < 0 ? 0 : share > 1 ? 1 : share);
  // il punteggio è un Float in Kotlin: chi lo usa lavora in float32
  return Math.fround(gap * bright);
}

/** Namespace come l'object Kotlin. */
export const Backlight = Object.freeze({ score: backlightScore });
