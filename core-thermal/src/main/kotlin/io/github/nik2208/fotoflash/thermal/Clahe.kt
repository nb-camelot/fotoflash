package io.github.nik2208.fotoflash.thermal

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Contrasto locale adattivo: CLAHE (Contrast Limited Adaptive Histogram Equalization).
 *
 * Sulla carta termica un viso in ombra accanto a un cielo chiaro diventa una macchia: una curva
 * globale non puo aprirlo senza bruciare il resto. CLAHE equalizza ogni zona con il suo
 * istogramma, cosi il dettaglio nelle ombre si allarga dove serve e il cielo resta com'e.
 *
 * Passi:
 * 1. griglia: `tiles` tessere sul lato corto e, sul lato lungo, quante ne servono per averle
 *    quadrate; mai piu piccole di [MIN_TILE_SIDE] pixel per lato (sotto, l'istogramma locale e
 *    solo rumore). Le tessere coprono tutta l'immagine e differiscono al massimo di 1 px;
 * 2. istogramma per tessera, tagliato a `clipLimit * area / 256` conteggi per livello; l'eccesso
 *    e ridistribuito in parti uguali su tutti i 256 livelli. Il taglio limita la pendenza della
 *    curva locale (al massimo circa clipLimit + 1): cieli lisci e rumore non esplodono;
 * 3. LUT per tessera dalla CDF "a meta gradino", `(cdf(v-1) + h(v)/2) * 256/area - 0.5`: con un
 *    istogramma piatto la LUT e esattamente l'identita, e una tessera uniforme cambia di 1-2 livelli;
 * 4. per ogni pixel, interpolazione bilineare tra le LUT delle 4 tessere i cui centri lo
 *    circondano (ai bordi dell'immagine 2 o 1): nessun blocco o scalino tra le tessere;
 * 5. miscela con l'originale: `out = src + strength * (clahe - src)`.
 *
 * Costo: un passaggio per gli istogrammi e uno per l'uscita; indici e pesi delle tessere sono
 * calcolati una volta per colonna e per riga, nessuna allocazione per pixel.
 */
object Clahe {

    /** Lato minimo di una tessera: 16x16 = 256 pixel, un conteggio medio per livello. */
    internal const val MIN_TILE_SIDE = 16

    /** Limite di taglio usato se il chiamante passa NaN. */
    internal const val DEFAULT_CLIP_LIMIT = 2.5f

    /**
     * Applica CLAHE a [src] e restituisce una nuova immagine; [src] non viene modificata.
     *
     * @param strength 0..1, miscela con l'originale: 0 restituisce una copia identica.
     * @param tiles tessere sul lato corto (almeno 1; meno se il lato e troppo corto per tessere da
     *   [MIN_TILE_SIDE] pixel: un'anteprima 240x320 ne ha 8x11, una foto 384x2000 8x42).
     * @param clipLimit pendenza massima della curva locale rispetto a un istogramma piatto
     *   (almeno 1: con 1 la curva e quasi l'identita).
     */
    fun apply(src: GrayImage, strength: Float, tiles: Int = 8, clipLimit: Float = DEFAULT_CLIP_LIMIT): GrayImage {
        val s = if (strength.isNaN()) 0.0 else strength.coerceIn(0f, 1f).toDouble()
        if (s <= 0.0) return src.copy()
        val clip = (if (clipLimit.isNaN()) DEFAULT_CLIP_LIMIT else clipLimit.coerceAtLeast(1f)).toDouble()

        val w = src.width
        val h = src.height
        val shortSide = min(w, h)
        val longSide = max(w, h)
        val nShort = tiles.coerceIn(1, max(1, shortSide / MIN_TILE_SIDE))
        val side = shortSide.toDouble() / nShort
        val nLong = (longSide / side).roundToInt().coerceIn(1, max(1, longSide / MIN_TILE_SIDE))
        val nx = if (w <= h) nShort else nLong
        val ny = if (w <= h) nLong else nShort

        val xStarts = starts(w, nx)
        val yStarts = starts(h, ny)
        val tileX = tileOf(w, xStarts)
        val tileY = tileOf(h, yStarts)

        // 1) istogrammi: 256 contatori per tessera, in un unico array
        val px = src.pixels
        val hist = IntArray(nx * ny * LEVELS)
        for (y in 0 until h) {
            val row = y * w
            val tileRow = tileY[y] * nx
            for (x in 0 until w) {
                hist[((tileRow + tileX[x]) shl 8) + (px[row + x].toInt() and 0xFF)]++
            }
        }

        // 2-3) taglio, ridistribuzione e LUT per tessera
        val luts = DoubleArray(nx * ny * LEVELS)
        for (ty in 0 until ny) {
            for (tx in 0 until nx) {
                val area = (xStarts[tx + 1] - xStarts[tx]) * (yStarts[ty + 1] - yStarts[ty])
                buildLut(hist, luts, (ty * nx + tx) shl 8, area.toDouble(), clip)
            }
        }

        // 4) indici e pesi dell'interpolazione, per colonna e per riga
        val x0 = IntArray(w)
        val x1 = IntArray(w)
        val wx = DoubleArray(w)
        interpolation(xStarts, nx, x0, x1, wx)
        val y0 = IntArray(h)
        val y1 = IntArray(h)
        val wy = DoubleArray(h)
        interpolation(yStarts, ny, y0, y1, wy)

        // 5) interpolazione bilineare e miscela con l'originale
        val out = ByteArray(w * h)
        for (y in 0 until h) {
            val row = y * w
            val top = y0[y] * nx
            val bottom = y1[y] * nx
            val fy = wy[y]
            for (x in 0 until w) {
                val v = px[row + x].toInt() and 0xFF
                val a = luts[((top + x0[x]) shl 8) + v]
                val b = luts[((top + x1[x]) shl 8) + v]
                val c = luts[((bottom + x0[x]) shl 8) + v]
                val d = luts[((bottom + x1[x]) shl 8) + v]
                val fx = wx[x]
                val upper = a + fx * (b - a)
                val lower = c + fx * (d - c)
                val equalized = upper + fy * (lower - upper)
                val mixed = v + s * (equalized - v)
                out[row + x] = (mixed + 0.5).toInt().coerceIn(0, 255).toByte()
            }
        }
        return GrayImage(w, h, out)
    }

    private const val LEVELS = 256

    /** Inizio di ogni tessera lungo un asse di [length] pixel diviso in [count] parti, piu la fine. */
    private fun starts(length: Int, count: Int): IntArray =
        IntArray(count + 1) { ((it.toLong() * length) / count).toInt() }

    /** Tessera di appartenenza di ogni pixel lungo l'asse. */
    private fun tileOf(length: Int, starts: IntArray): IntArray {
        val out = IntArray(length)
        for (t in 0 until starts.size - 1) {
            for (i in starts[t] until starts[t + 1]) out[i] = t
        }
        return out
    }

    /**
     * Per ogni pixel lungo l'asse: le due tessere i cui centri lo circondano ([i0], [i1]) e il peso
     * della seconda ([weight]). Prima del primo centro e dopo l'ultimo vale una sola tessera.
     */
    private fun interpolation(starts: IntArray, count: Int, i0: IntArray, i1: IntArray, weight: DoubleArray) {
        val centers = DoubleArray(count) { (starts[it] + starts[it + 1]) / 2.0 }
        var k = 0
        for (i in i0.indices) {
            val p = i + 0.5
            while (k + 1 < count && centers[k + 1] <= p) k++
            if (k == count - 1 || p <= centers[k]) {
                i0[i] = k
                i1[i] = k
                weight[i] = 0.0
            } else {
                i0[i] = k
                i1[i] = k + 1
                weight[i] = (p - centers[k]) / (centers[k + 1] - centers[k])
            }
        }
    }

    /** LUT di una tessera: istogramma tagliato, eccesso ridistribuito, CDF a meta gradino. */
    private fun buildLut(hist: IntArray, luts: DoubleArray, base: Int, area: Double, clipLimit: Double) {
        val clip = clipLimit * area / LEVELS
        var excess = 0.0
        for (v in 0 until LEVELS) {
            val count = hist[base + v].toDouble()
            if (count > clip) excess += count - clip
        }
        val spread = excess / LEVELS
        val scale = LEVELS / area
        var cumulative = 0.0
        for (v in 0 until LEVELS) {
            val count = min(hist[base + v].toDouble(), clip) + spread
            val mapped = (cumulative + count / 2.0) * scale - 0.5
            luts[base + v] = if (mapped < 0.0) 0.0 else if (mapped > 255.0) 255.0 else mapped
            cumulative += count
        }
    }
}
