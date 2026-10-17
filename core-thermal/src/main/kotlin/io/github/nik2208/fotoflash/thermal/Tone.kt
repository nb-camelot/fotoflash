package io.github.nik2208.fotoflash.thermal

import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Regolazioni tonali prima della retinatura. La carta termica ha poca gamma dinamica e tende a
 * impastare gli scuri: per questo i default aprono le ombre, schiariscono i medi toni e
 * rinforzano i bordi.
 *
 * Ordine:
 * 1. controluce: se `autoBacklight`, k = [Backlight.score] dell'immagine originale e
 *    ombre = min(1, shadows + 0.55 k), contrasto locale = min(1, localContrast + 0.5 k);
 * 2. contrasto locale [Clahe] con forza = contrasto locale (saltato se 0);
 * 3. ombre: [shadowLift], che solleva solo i toni scuri;
 * 4. auto-livelli (1%-99%, sull'istogramma gia schiarito) -> luminosita -> contrasto -> gamma;
 * 5. nitidezza (maschera di contrasto).
 *
 * I passi 3 e 4 sono fusi in una sola LUT. Con shadows = 0, localContrast = 0 e autoBacklight
 * spento il risultato e identico, bit per bit, a quello delle versioni senza i passi 1-3.
 */
object Tone {

    /** Escursione minima per lo stiramento: oltre x4 di guadagno si amplifica solo rumore. */
    internal const val MIN_LEVELS_RANGE = 64.0

    /** Luminosita +-1 = +-100 livelli. */
    internal const val BRIGHTNESS_LEVELS = 100.0

    /** Nitidezza 1 = maschera di contrasto con quantita 1.5. */
    internal const val SHARPEN_GAIN = 1.5f

    /** Ombre aggiunte da un controluce pieno (k = 1). */
    internal const val BACKLIGHT_SHADOWS_BOOST = 0.55f

    /** Contrasto locale aggiunto da un controluce pieno (k = 1). */
    internal const val BACKLIGHT_LOCAL_BOOST = 0.5f

    /** Ombre = 1 solleva il punto piu schiarito (un quarto della scala, 64) di 0.30 * 255 ~ 76 livelli. */
    internal const val SHADOWS_MAX_LIFT = 0.30

    /** Guadagno della curva delle ombre: t (1 - t)^3 vale al massimo 27/256, in t = 1/4. */
    internal const val SHADOWS_GAIN = SHADOWS_MAX_LIFT * 256.0 / 27.0

    /**
     * Applica [adj] a [src] e restituisce una nuova immagine; [src] non viene modificata.
     * I valori fuori range (o NaN) di [adj] vengono riportati nel range o ai neutri.
     */
    fun apply(src: GrayImage, adj: ToneAdjustments): GrayImage {
        // 1) controluce: si misura sull'originale, prima che le regolazioni cambino la scena
        val backlight = if (adj.autoBacklight) Backlight.score(src) else 0f
        val shadowsBase = sanitize(adj.shadows, 0f, 1f, 0f)
        val localBase = sanitize(adj.localContrast, 0f, 1f, 0f)
        val shadows = max(shadowsBase, shadowsBase + BACKLIGHT_SHADOWS_BOOST * backlight).coerceAtMost(1f)
        val local = max(localBase, localBase + BACKLIGHT_LOCAL_BOOST * backlight).coerceAtMost(1f)

        // 2) contrasto locale
        val base = if (local > 0f) Clahe.apply(src, local) else src

        // 3-4) ombre, livelli, luminosita, contrasto e gamma in una LUT
        val lut = curve(base, adj, shadows)
        val n = base.pixels.size
        val mapped = ByteArray(n)
        val px = base.pixels
        for (i in 0 until n) mapped[i] = lut[px[i].toInt() and 0xFF].toByte()

        // 5) nitidezza
        val amount = sanitize(adj.sharpen, 0f, 1f, 0f) * SHARPEN_GAIN
        if (amount <= 0f) return GrayImage(src.width, src.height, mapped)
        return GrayImage(src.width, src.height, unsharp(mapped, src.width, src.height, amount))
    }

    /**
     * Curva delle ombre, su livelli 0..255 (risultato non arrotondato):
     * ```
     * t' = t + amount * G * t * (1 - t)^3      con t = v / 255, G = SHADOWS_GAIN ~ 2.84
     * ```
     * - il nero resta nero (t = 0) e il bianco resta bianco (t = 1);
     * - il massimo dello schiarimento cade a un quarto della scala (v = 64, i visi in ombra) e
     *   vale [SHADOWS_MAX_LIFT] * amount; a v = 192 ne resta circa un nono (+8 livelli con amount = 1);
     * - la pendenza nel nero e finita (1 + amount * G, al massimo ~3.8): il rumore dei neri
     *   profondi non esplode come con una radice;
     * - e monotona per amount * G <= 4, quindi per ogni amount in 0..1.
     * Con [amount] <= 0 restituisce [v] esatto.
     */
    internal fun shadowLift(v: Double, amount: Float): Double {
        if (amount <= 0f) return v
        val t = v / 255.0
        val u = 1.0 - t
        return 255.0 * (t + amount * SHADOWS_GAIN * t * u * u * u)
    }

    /**
     * Curva tonale (ombre, auto-livelli, luminosita, contrasto, gamma) come LUT di 256 valori 0..255.
     * Dipende dall'immagine solo per gli auto-livelli, calcolati sull'istogramma dopo le ombre.
     */
    internal fun curve(src: GrayImage, adj: ToneAdjustments, shadows: Float = 0f): IntArray {
        val brightness = sanitize(adj.brightness, -1f, 1f, 0f).toDouble()
        val contrast = sanitize(adj.contrast, -1f, 1f, 0f).toDouble()
        val gamma = sanitize(adj.gamma, 0.4f, 2.5f, 1f).toDouble()
        // contrasto: -1 dimezza l'escursione, +1 la moltiplica per 2.5, 0 la lascia com'e
        val factor = if (contrast >= 0.0) 1.0 + 1.5 * contrast else 1.0 + 0.5 * contrast
        val invGamma = 1.0 / gamma
        val lift = if (shadows.isNaN()) 0f else shadows.coerceIn(0f, 1f)
        val lifted = DoubleArray(256) { shadowLift(it.toDouble(), lift) }

        var lo = 0.0
        var hi = 255.0
        if (adj.autoLevels) {
            val hist = src.histogram()
            // istogramma dell'immagine come sarebbe dopo le ombre: i livelli si misurano li
            val histLifted = if (lift > 0f) IntArray(256).also { h ->
                for (v in 0..255) h[lifted[v].roundToInt().coerceIn(0, 255)] += hist[v]
            } else hist
            val range = levels(histLifted, src.pixels.size)
            lo = range[0]
            hi = range[1]
        }
        val span = hi - lo

        val lut = IntArray(256)
        for (v in 0..255) {
            var x = lifted[v]
            if (adj.autoLevels) x = clamp((x - lo) * 255.0 / span)
            x = clamp(x + brightness * BRIGHTNESS_LEVELS)
            x = clamp((x - 128.0) * factor + 128.0)
            x = clamp(255.0 * (x / 255.0).pow(invGamma))
            lut[v] = x.roundToInt()
        }
        return lut
    }

    /**
     * Livelli di nero e di bianco: percentili 1% e 99% dell'istogramma.
     * Se l'escursione e troppo stretta (immagine piatta) la si allarga attorno al centro fino a
     * [MIN_LEVELS_RANGE]: cosi un grigio uniforme resta grigio invece di esplodere in rumore.
     * Restituisce sempre hi > lo.
     */
    internal fun levels(hist: IntArray, total: Int): DoubleArray {
        val cut = maxOf(1, total / 100)
        var lo = 0
        var acc = 0
        while (lo < 255) {
            acc += hist[lo]
            if (acc >= cut) break
            lo++
        }
        var hi = 255
        acc = 0
        while (hi > 0) {
            acc += hist[hi]
            if (acc >= cut) break
            hi--
        }
        var l = minOf(lo, hi).toDouble()
        var h = maxOf(lo, hi).toDouble()
        if (h - l < MIN_LEVELS_RANGE) {
            val mid = (l + h) / 2.0
            l = mid - MIN_LEVELS_RANGE / 2.0
            h = mid + MIN_LEVELS_RANGE / 2.0
            if (l < 0.0) {
                l = 0.0
                h = MIN_LEVELS_RANGE
            }
            if (h > 255.0) {
                h = 255.0
                l = 255.0 - MIN_LEVELS_RANGE
            }
        }
        return doubleArrayOf(l, h)
    }

    /**
     * Maschera di contrasto: v + amount * (v - sfocato), con sfocatura binomiale 3x3
     * (1 2 1 / 2 4 2 / 1 2 1, /16) e bordi replicati. Le zone uniformi restano identiche.
     */
    private fun unsharp(px: ByteArray, w: Int, h: Int, amount: Float): ByteArray {
        // passata orizzontale: somme pesate 1-2-1, valori 0..1020
        val hsum = IntArray(w * h)
        for (y in 0 until h) {
            val row = y * w
            for (x in 0 until w) {
                val xl = if (x > 0) x - 1 else 0
                val xr = if (x < w - 1) x + 1 else w - 1
                val l = px[row + xl].toInt() and 0xFF
                val c = px[row + x].toInt() and 0xFF
                val r = px[row + xr].toInt() and 0xFF
                hsum[row + x] = l + 2 * c + r
            }
        }
        val out = ByteArray(w * h)
        for (y in 0 until h) {
            val up = (if (y > 0) y - 1 else 0) * w
            val row = y * w
            val down = (if (y < h - 1) y + 1 else h - 1) * w
            for (x in 0 until w) {
                val blur = (hsum[up + x] + 2 * hsum[row + x] + hsum[down + x] + 8) / 16
                val c = px[row + x].toInt() and 0xFF
                val v = c + amount * (c - blur)
                out[row + x] = clamp(v.toDouble()).roundToInt().toByte()
            }
        }
        return out
    }

    private fun clamp(v: Double): Double = if (v < 0.0) 0.0 else if (v > 255.0) 255.0 else v

    /** coerceIn lascia passare NaN, che poi farebbe esplodere roundToInt: qui diventa il neutro. */
    private fun sanitize(v: Float, min: Float, max: Float, neutral: Float): Float =
        if (v.isNaN()) neutral else v.coerceIn(min, max)
}
