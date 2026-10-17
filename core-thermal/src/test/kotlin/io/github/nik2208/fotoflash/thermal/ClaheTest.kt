package io.github.nik2208.fotoflash.thermal

import kotlin.math.abs
import kotlin.math.sqrt
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ClaheTest {

    private fun image(w: Int, h: Int, value: (Int, Int) -> Int): GrayImage {
        val img = GrayImage(w, h)
        for (y in 0 until h) for (x in 0 until w) img[x, y] = value(x, y)
        return img
    }

    /** Trama deterministica che copre [span] livelli diversi: con due soli livelli il taglio la appiattirebbe. */
    private fun texture(x: Int, y: Int, span: Int): Int = (x * 7 + y * 13) % span

    /** Meta sinistra scura (20..59), meta destra chiara (190..229), stessa trama. */
    private fun twoZones(w: Int, h: Int): GrayImage =
        image(w, h) { x, y -> (if (x < w / 2) 20 else 190) + texture(x, y, 40) }

    /** Deviazione standard media dei blocchi 8x8 dentro [x0, x1) x [y0, y1): contrasto locale. */
    private fun localStd(img: GrayImage, x0: Int, x1: Int, y0: Int, y1: Int): Double {
        var total = 0.0
        var blocks = 0
        for (by in y0 until y1 step 8) for (bx in x0 until x1 step 8) {
            var sum = 0.0
            var sum2 = 0.0
            for (y in by until by + 8) for (x in bx until bx + 8) {
                val v = img[x, y].toDouble()
                sum += v
                sum2 += v * v
            }
            val mean = sum / 64
            total += sqrt(sum2 / 64 - mean * mean)
            blocks++
        }
        return total / blocks
    }

    private fun mean(img: GrayImage, x0: Int, x1: Int, y0: Int, y1: Int): Double {
        var sum = 0L
        for (y in y0 until y1) for (x in x0 until x1) sum += img[x, y]
        return sum.toDouble() / ((x1 - x0) * (y1 - y0))
    }

    /** Salto massimo tra pixel vicini, in orizzontale e in verticale. */
    private fun maxJump(img: GrayImage): Int {
        var jump = 0
        for (y in 0 until img.height) for (x in 0 until img.width) {
            if (x > 0) jump = maxOf(jump, abs(img[x, y] - img[x - 1, y]))
            if (y > 0) jump = maxOf(jump, abs(img[x, y] - img[x, y - 1]))
        }
        return jump
    }

    @Test
    fun zeroStrengthIsIdentityAndReturnsNewImage() {
        val src = image(64, 48) { x, y -> (x * 31 + y * 17) % 256 }
        for (strength in listOf(0f, -1f, Float.NaN)) {
            val out = Clahe.apply(src, strength)
            assertNotSame(src, out)
            assertNotSame(src.pixels, out.pixels)
            assertArrayEquals("forza $strength", src.pixels, out.pixels)
        }
    }

    @Test
    fun doesNotModifyInput() {
        val src = twoZones(96, 64)
        val before = src.pixels.copyOf()
        Clahe.apply(src, 1f)
        assertArrayEquals(before, src.pixels)
    }

    @Test
    fun darkHalfGainsLocalContrast() {
        // il caso del controluce: trama poco leggibile nella meta scura, accanto a una zona chiara
        val src = twoZones(128, 128)
        val before = localStd(src, 8, 56, 8, 120)
        val full = Clahe.apply(src, 1f)
        val mild = Clahe.apply(src, 0.35f)
        val afterFull = localStd(full, 8, 56, 8, 120)
        val afterMild = localStd(mild, 8, 56, 8, 120)
        assertTrue("forza 1: $before -> $afterFull", afterFull > before * 2.5)
        assertTrue("forza 0.35: $before -> $afterMild", afterMild > before * 1.5)
        assertTrue("forza 0.35 meno di forza 1", afterMild < afterFull)
        // e la meta scura si apre anche in media
        assertTrue(mean(full, 8, 56, 8, 120) > mean(src, 8, 56, 8, 120) + 20)
    }

    @Test
    fun noSeamsBetweenTilesOnGradients() {
        // Con la LUT della sola tessera, senza interpolazione, al confine tra due tessere il salto
        // arriva a 80 livelli (72 nell'anteprima, 40 in diagonale); l'interpolazione bilineare lo evita.
        val w = 384
        val h = 384
        val gradients = mapOf(
            "orizzontale" to GrayImage.gradient(w, h),
            "verticale" to image(w, h) { _, y -> y * 255 / (h - 1) },
            "diagonale" to image(w, h) { x, y -> (x + y) * 255 / (w + h - 2) },
            "anteprima 240x320" to GrayImage.gradient(240, 320),
        )
        for ((name, src) in gradients) {
            val jump = maxJump(Clahe.apply(src, 1f))
            assertTrue("gradiente $name: salto di $jump livelli", jump <= 8)
        }
    }

    @Test
    fun strengthBlendsLinearlyWithOriginal() {
        val src = twoZones(96, 96)
        val full = Clahe.apply(src, 1f)
        val half = Clahe.apply(src, 0.5f)
        for (i in src.pixels.indices) {
            val s = src.pixels[i].toInt() and 0xFF
            val f = full.pixels[i].toInt() and 0xFF
            val m = half.pixels[i].toInt() and 0xFF
            assertTrue("pixel $i: $s, $m, $f", abs(m - (s + f) / 2.0) <= 1.0)
        }
    }

    @Test
    fun flatImagesStayFlat() {
        // un istogramma a un solo livello viene tagliato: niente rumore inventato, al massimo +-1
        for (v in listOf(0, 1, 128, 254, 255)) {
            val out = Clahe.apply(GrayImage(40, 40, ByteArray(1600) { v.toByte() }), 1f)
            val first = out[0, 0]
            assertTrue("grigio $v -> $first", abs(first - v) <= 1)
            for (p in out.pixels) assertEquals("grigio $v uniforme", first, p.toInt() and 0xFF)
        }
    }

    @Test
    fun tinyAndThinImagesWork() {
        val sizes = listOf(1 to 1, 1 to 7, 7 to 1, 2 to 2, 1 to 300, 300 to 1, 15 to 15, 17 to 16, 3 to 1000)
        for ((w, h) in sizes) {
            val src = GrayImage(w, h, ByteArray(w * h) { (it * 53 % 256).toByte() })
            val out = Clahe.apply(src, 1f)
            assertEquals(w, out.width)
            assertEquals(h, out.height)
        }
    }

    @Test
    fun oddParametersAreSanitized() {
        val src = twoZones(64, 64)
        for (tiles in listOf(0, -3, 1, 1000)) Clahe.apply(src, 1f, tiles = tiles)
        for (clip in listOf(0f, -2f, Float.NaN, 1f, 1000f, Float.POSITIVE_INFINITY)) Clahe.apply(src, 1f, clipLimit = clip)
        // forza oltre 1 vale come 1
        assertArrayEquals(Clahe.apply(src, 1f).pixels, Clahe.apply(src, 7f).pixels)
    }

    @Test(timeout = 10_000)
    fun longStripIsFast() {
        // una foto della Striscia su carta da 58 mm: deve restare nell'ordine dei decimi di secondo
        val src = image(384, 2000) { x, y -> x * 255 / 383 / 2 + texture(x, y, 23) * 4 }
        repeat(3) { Clahe.apply(src, 1f) }
        assertEquals(384, Tone.apply(src, ToneAdjustments()).width)
    }
}
