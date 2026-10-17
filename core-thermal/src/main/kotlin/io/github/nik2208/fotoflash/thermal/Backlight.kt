package io.github.nik2208.fotoflash.thermal

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Riconoscimento del controluce: soggetto scuro al centro, sfondo molto chiaro attorno.
 *
 * E il caso in cui l'esposizione automatica del telefono sacrifica il viso per salvare il cielo
 * e la carta termica, che ha solo bianco e nero retinato, trasforma il viso in una macchia.
 * [Tone] usa il punteggio per aumentare ombre e contrasto locale solo quando serve.
 */
object Backlight {

    /** Semiassi dell'ellisse centrale in frazione di meta larghezza e meta altezza: pi/4 * 0.8^2 ~ 50% dell'area. */
    internal const val CENTER_AXIS = 0.8

    /**
     * Raggio (in unita dell'ellisse centrale) da cui comincia il bordo: la corona tra 1 e 1.15,
     * dove passa la sagoma del soggetto, non conta ne per il centro ne per il bordo.
     */
    internal const val BORDER_RADIUS = 1.15

    /** Luminanza da cui un pixel del bordo conta come "quasi bianco" (cielo, finestra, neve). */
    internal const val NEAR_WHITE = 230

    /** Differenza bordo - centro sotto cui non c'e controluce. */
    internal const val GAP_START = 25.0

    /** Differenza bordo - centro da cui il controluce e pieno. */
    internal const val GAP_FULL = 110.0

    /** Media del bordo sotto cui lo sfondo non conta come chiaro. */
    internal const val BRIGHT_START = 150.0

    /** Media del bordo da cui lo sfondo e chiaro del tutto. */
    internal const val BRIGHT_FULL = 200.0

    /** Quota di pixel quasi bianchi nel bordo che, da sola, basta a dire "sfondo chiaro". */
    internal const val WHITE_SHARE_FULL = 0.35

    /**
     * Quanto la scena e in controluce: 0 = per niente, 1 = controluce forte.
     *
     * Zone:
     * - centro C: l'ellisse centrata con semiassi [CENTER_AXIS] x larghezza/2 e x altezza/2
     *   (meta dell'area, dove di solito sta il soggetto);
     * - bordo B: i pixel fuori dall'ellisse ingrandita di [BORDER_RADIUS] (angoli e fasce esterne,
     *   circa un terzo dell'area).
     *
     * Con c = media di C, b = media di B e w = quota dei pixel di B con luminanza >= [NEAR_WHITE]:
     * ```
     * gap    = clamp((b - c - 25) / (110 - 25), 0, 1)       // il bordo e molto piu chiaro del centro
     * bright = max(clamp((b - 150) / (200 - 150), 0, 1),   // il bordo e chiaro in media...
     *              clamp(w / 0.35, 0, 1))                  // ...o ha molto cielo bianco
     * score  = gap * bright
     * ```
     * Esempi: bordo 200+ e centro sotto 90 -> 1; scena uniforme, soggetto chiaro su sfondo scuro o
     * scena scura con bordo poco piu chiaro -> 0 o quasi. Il punteggio varia con continuita, cosi
     * l'anteprima dal vivo non sfarfalla quando la scena cambia di poco.
     *
     * Immagini troppo piccole per avere sia centro sia bordo (1x1) danno 0.
     */
    fun score(src: GrayImage): Float {
        val w = src.width
        val h = src.height
        val px = src.pixels
        val cx = w / 2.0
        val cy = h / 2.0
        val ax = CENTER_AXIS * w / 2.0
        val ay = CENTER_AXIS * h / 2.0
        val border2 = BORDER_RADIUS * BORDER_RADIUS

        var centerSum = 0L
        var centerCount = 0L
        var borderSum = 0L
        var borderCount = 0L
        var borderWhite = 0L

        for (y in 0 until h) {
            val row = y * w
            val dy = (y + 0.5 - cy) / ay
            val dy2 = dy * dy

            // centro: |x + 0.5 - cx| <= ax * sqrt(1 - dy^2), come intervallo intero di colonne
            if (dy2 <= 1.0) {
                val half = ax * sqrt(1.0 - dy2)
                val from = max(0, ceil(cx - half - 0.5).toInt())
                val to = min(w - 1, floor(cx + half - 0.5).toInt())
                for (x in from..to) {
                    centerSum += (px[row + x].toInt() and 0xFF)
                    centerCount++
                }
            }

            // bordo: le colonne fuori dall'ellisse ingrandita, [0, innerFrom) e (innerTo, w)
            var innerFrom = w
            var innerTo = w - 1
            if (dy2 < border2) {
                val half = ax * sqrt(border2 - dy2)
                innerFrom = max(0, ceil(cx - half - 0.5).toInt())
                innerTo = min(w - 1, floor(cx + half - 0.5).toInt())
            }
            if (innerFrom > innerTo) {
                // riga tutta fuori (o ellisse piu stretta di un pixel): e tutta bordo
                innerFrom = w
                innerTo = w - 1
            }
            for (x in 0 until innerFrom) {
                val v = px[row + x].toInt() and 0xFF
                borderSum += v
                borderCount++
                if (v >= NEAR_WHITE) borderWhite++
            }
            for (x in innerTo + 1 until w) {
                val v = px[row + x].toInt() and 0xFF
                borderSum += v
                borderCount++
                if (v >= NEAR_WHITE) borderWhite++
            }
        }
        if (centerCount == 0L || borderCount == 0L) return 0f

        val c = centerSum.toDouble() / centerCount
        val b = borderSum.toDouble() / borderCount
        val white = borderWhite.toDouble() / borderCount
        val gap = ramp(b - c, GAP_START, GAP_FULL)
        val bright = max(ramp(b, BRIGHT_START, BRIGHT_FULL), (white / WHITE_SHARE_FULL).coerceIn(0.0, 1.0))
        return (gap * bright).toFloat()
    }

    /** 0 sotto [from], 1 sopra [to], lineare in mezzo. */
    private fun ramp(v: Double, from: Double, to: Double): Double = ((v - from) / (to - from)).coerceIn(0.0, 1.0)
}
