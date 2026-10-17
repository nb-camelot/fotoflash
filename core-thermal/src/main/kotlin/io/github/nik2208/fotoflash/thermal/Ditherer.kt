package io.github.nik2208.fotoflash.thermal

/**
 * Retinatura: da grigi a punti neri/bianchi. Un punto e nero quando il valore (con l'errore
 * accumulato, per gli algoritmi a diffusione) e minore della soglia.
 *
 * Gli errori vivono in poche righe di FloatArray riusate: nessuna allocazione per pixel, cosi lo
 * stesso codice regge anche l'anteprima termica dal vivo del mirino.
 */
object Ditherer {

    /** Matrice di Bayer 8x8 standard, valori 0..63. */
    private val BAYER_8 = intArrayOf(
        0, 32, 8, 40, 2, 34, 10, 42,
        48, 16, 56, 24, 50, 18, 58, 26,
        12, 44, 4, 36, 14, 46, 6, 38,
        60, 28, 52, 20, 62, 30, 54, 22,
        3, 35, 11, 43, 1, 33, 9, 41,
        51, 19, 59, 27, 49, 17, 57, 25,
        15, 47, 7, 39, 13, 45, 5, 37,
        63, 31, 55, 23, 61, 29, 53, 21,
    )

    /**
     * Retina [src] con [algorithm]. [threshold] (1..255, default 128) sposta il punto di
     * decisione: piu alto = stampa piu scura. [src] non viene modificata.
     */
    fun dither(src: GrayImage, algorithm: DitherAlgorithm, threshold: Int = 128): BitImage {
        val t = threshold.coerceIn(1, 255)
        return when (algorithm) {
            DitherAlgorithm.ATKINSON -> atkinsonDither(src, t)
            DitherAlgorithm.FLOYD_STEINBERG -> floydSteinbergDither(src, t)
            DitherAlgorithm.ORDERED_BAYER -> bayerDither(src, t)
            DitherAlgorithm.THRESHOLD -> thresholdDither(src, t)
        }
    }

    private fun thresholdDither(src: GrayImage, t: Int): BitImage {
        val w = src.width
        val out = BitImage(w, src.height)
        val px = src.pixels
        for (y in 0 until src.height) {
            val row = y * w
            for (x in 0 until w) {
                if ((px[row + x].toInt() and 0xFF) < t) out[x, y] = true
            }
        }
        return out
    }

    /**
     * Bayer 8x8: soglia della cella = (M + 0.5) / 64 * 255, spostata di (t - 128).
     * Con t = 128 un grigio 128 accende esattamente meta delle celle.
     */
    private fun bayerDither(src: GrayImage, t: Int): BitImage {
        val cells = FloatArray(64) { (BAYER_8[it] + 0.5f) * 255f / 64f + (t - 128) }
        val w = src.width
        val out = BitImage(w, src.height)
        val px = src.pixels
        for (y in 0 until src.height) {
            val row = y * w
            val cellRow = (y and 7) shl 3
            for (x in 0 until w) {
                val v = px[row + x].toInt() and 0xFF
                if (v < cells[cellRow + (x and 7)]) out[x, y] = true
            }
        }
        return out
    }

    /**
     * Atkinson: 1/8 dell'errore a 6 vicini (destra, destra+2, sotto-sinistra, sotto,
     * sotto-destra, due righe sotto). Diffonde solo 3/4 dell'errore: luci e ombre restano pulite,
     * che sulla carta termica vuol dire volti meno "sporchi".
     */
    private fun atkinsonDither(src: GrayImage, t: Int): BitImage {
        val w = src.width
        val h = src.height
        val out = BitImage(w, h)
        val px = src.pixels
        // indice nel buffer = x + 1: un bordo a sinistra, due a destra
        var r0 = FloatArray(w + 3)
        var r1 = FloatArray(w + 3)
        var r2 = FloatArray(w + 3)
        for (y in 0 until h) {
            val row = y * w
            for (x in 0 until w) {
                val old = (px[row + x].toInt() and 0xFF) + r0[x + 1]
                val black = old < t
                if (black) out[x, y] = true
                val e = (old - (if (black) 0f else 255f)) / 8f
                r0[x + 2] += e
                r0[x + 3] += e
                r1[x] += e
                r1[x + 1] += e
                r1[x + 2] += e
                r2[x + 1] += e
            }
            // le righe scorrono: quella appena finita torna in fondo, azzerata
            val done = r0
            r0 = r1
            r1 = r2
            r2 = done
            r2.fill(0f)
        }
        return out
    }

    /**
     * Floyd-Steinberg a serpentina: 7/16 avanti, 3/16 sotto-dietro, 5/16 sotto, 1/16 sotto-avanti.
     * Le righe dispari vanno da destra a sinistra, cosi l'errore non si trascina sempre nello
     * stesso verso e spariscono le "venature" diagonali.
     */
    private fun floydSteinbergDither(src: GrayImage, t: Int): BitImage {
        val w = src.width
        val h = src.height
        val out = BitImage(w, h)
        val px = src.pixels
        // indice nel buffer = x + 1: un bordo per lato
        var cur = FloatArray(w + 2)
        var next = FloatArray(w + 2)
        for (y in 0 until h) {
            val row = y * w
            if ((y and 1) == 0) {
                for (x in 0 until w) {
                    val old = (px[row + x].toInt() and 0xFF) + cur[x + 1]
                    val black = old < t
                    if (black) out[x, y] = true
                    val e = old - (if (black) 0f else 255f)
                    cur[x + 2] += e * (7f / 16f)
                    next[x] += e * (3f / 16f)
                    next[x + 1] += e * (5f / 16f)
                    next[x + 2] += e * (1f / 16f)
                }
            } else {
                for (x in w - 1 downTo 0) {
                    val old = (px[row + x].toInt() and 0xFF) + cur[x + 1]
                    val black = old < t
                    if (black) out[x, y] = true
                    val e = old - (if (black) 0f else 255f)
                    cur[x] += e * (7f / 16f)
                    next[x + 2] += e * (3f / 16f)
                    next[x + 1] += e * (5f / 16f)
                    next[x] += e * (1f / 16f)
                }
            }
            val done = cur
            cur = next
            next = done
            next.fill(0f)
        }
        return out
    }
}
