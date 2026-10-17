package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DithererTest {

    private fun flat(w: Int, h: Int, v: Int): GrayImage = GrayImage(w, h, ByteArray(w * h) { v.toByte() })

    private fun blackRatio(img: BitImage): Double = img.countBlack().toDouble() / (img.width * img.height)

    /** Copertura di neri nelle colonne [x0, x1). */
    private fun blackRatio(img: BitImage, x0: Int, x1: Int): Double {
        var n = 0
        for (y in 0 until img.height) for (x in x0 until x1) if (img[x, y]) n++
        return n.toDouble() / ((x1 - x0) * img.height)
    }

    @Test
    fun whiteStaysWhiteForEveryAlgorithm() {
        for (alg in DitherAlgorithm.entries) {
            val out = Ditherer.dither(flat(64, 32, 255), alg)
            assertEquals("bianco con $alg", 0, out.countBlack())
        }
    }

    @Test
    fun blackStaysBlackForEveryAlgorithm() {
        for (alg in DitherAlgorithm.entries) {
            val out = Ditherer.dither(flat(64, 32, 0), alg)
            assertEquals("nero con $alg", 64 * 32, out.countBlack())
        }
    }

    @Test
    fun floydSteinbergMidGrayIsAboutHalf() {
        val r = blackRatio(Ditherer.dither(flat(64, 64, 128), DitherAlgorithm.FLOYD_STEINBERG))
        assertTrue("FS su grigio medio: $r", r in 0.40..0.60)
    }

    @Test
    fun atkinsonMidGrayIsAboutHalf() {
        val r = blackRatio(Ditherer.dither(flat(64, 64, 128), DitherAlgorithm.ATKINSON))
        assertTrue("Atkinson su grigio medio: $r", r in 0.40..0.60)
    }

    @Test
    fun atkinsonKeepsHighlightsCleanerThanFloydSteinberg() {
        // Atkinson diffonde solo 3/4 dell'errore: sui chiari mette meno punti
        val light = flat(128, 128, 200)
        val atkinson = blackRatio(Ditherer.dither(light, DitherAlgorithm.ATKINSON))
        val fs = blackRatio(Ditherer.dither(light, DitherAlgorithm.FLOYD_STEINBERG))
        assertTrue("Atkinson $atkinson, FS $fs", atkinson < fs)
        // FS conserva la media: 55/255 circa di neri
        assertTrue("FS su 200: $fs", fs in 0.18..0.25)
    }

    @Test
    fun bayerMidGrayIsExactlyHalf() {
        val out = Ditherer.dither(flat(64, 64, 128), DitherAlgorithm.ORDERED_BAYER)
        assertEquals(64 * 64 / 2, out.countBlack())
    }

    @Test
    fun bayerPatternRepeatsEveryEightDots() {
        val out = Ditherer.dither(flat(32, 32, 100), DitherAlgorithm.ORDERED_BAYER)
        for (y in 0 until 24) for (x in 0 until 24) {
            assertEquals(out[x, y], out[x + 8, y])
            assertEquals(out[x, y], out[x, y + 8])
        }
    }

    @Test
    fun thresholdIsStrictlyBelow() {
        assertEquals(0, Ditherer.dither(flat(16, 4, 128), DitherAlgorithm.THRESHOLD).countBlack())
        assertEquals(64, Ditherer.dither(flat(16, 4, 127), DitherAlgorithm.THRESHOLD).countBlack())
        // soglia spostata: 128 diventa nero con soglia 129
        assertEquals(64, Ditherer.dither(flat(16, 4, 128), DitherAlgorithm.THRESHOLD, threshold = 129).countBlack())
    }

    @Test
    fun higherThresholdPrintsDarkerWithOrderedDither() {
        val src = flat(64, 64, 128)
        val normal = Ditherer.dither(src, DitherAlgorithm.ORDERED_BAYER).countBlack()
        val darker = Ditherer.dither(src, DitherAlgorithm.ORDERED_BAYER, threshold = 160).countBlack()
        assertTrue("$darker > $normal", darker > normal)
    }

    @Test
    fun gradientDarkensFromLeftToRightForEveryAlgorithm() {
        val src = GrayImage.gradient(256, 64)
        for (alg in DitherAlgorithm.entries) {
            val out = Ditherer.dither(src, alg)
            val quarters = DoubleArray(4) { blackRatio(out, it * 64, it * 64 + 64) }
            assertTrue("$alg quarto scuro ${quarters[0]}", quarters[0] > 0.75)
            assertTrue("$alg quarto chiaro ${quarters[3]}", quarters[3] < 0.25)
            for (i in 1 until 4) assertTrue("$alg non monotono: ${quarters.joinToString()}", quarters[i] <= quarters[i - 1])
        }
    }

    @Test
    fun keepsSizeAndDoesNotTouchInput() {
        val src = GrayImage.gradient(37, 13)
        val before = src.pixels.copyOf()
        for (alg in DitherAlgorithm.entries) {
            val out = Ditherer.dither(src, alg)
            assertEquals(37, out.width)
            assertEquals(13, out.height)
            assertEquals(5, out.bytesPerRow)
        }
        assertArrayEquals(before, src.pixels)
    }

    @Test
    fun paddingBitsStayWhite() {
        // 10 punti per riga = 2 byte: i 6 bit di riempimento non vanno mai accesi
        val out = Ditherer.dither(flat(10, 4, 0), DitherAlgorithm.FLOYD_STEINBERG)
        for (y in 0 until 4) {
            assertEquals(0xFF, out.data[y * 2].toInt() and 0xFF)
            assertEquals(0xC0, out.data[y * 2 + 1].toInt() and 0xFF)
        }
    }
}
