package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ToneTest {

    /** Nessuna regolazione: la curva deve essere l'identita. */
    private val neutral = ToneAdjustments(
        brightness = 0f, contrast = 0f, gamma = 1f, autoLevels = false, sharpen = 0f,
        shadows = 0f, localContrast = 0f, autoBacklight = false,
    )

    /** I default di prima delle ombre e del contrasto locale: i nuovi passi spenti. */
    private val legacy = ToneAdjustments(shadows = 0f, localContrast = 0f, autoBacklight = false)

    private fun row(vararg values: Int): GrayImage =
        GrayImage(values.size, 1, ByteArray(values.size) { values[it].toByte() })

    private fun values(img: GrayImage): IntArray = IntArray(img.pixels.size) { img.pixels[it].toInt() and 0xFF }

    private fun applied(adj: ToneAdjustments, vararg input: Int): IntArray = values(Tone.apply(row(*input), adj))

    @Test
    fun neutralIsIdentityAndReturnsNewImage() {
        val src = GrayImage.gradient(256, 2)
        val out = Tone.apply(src, neutral)
        assertNotSame(src, out)
        assertNotSame(src.pixels, out.pixels)
        assertArrayEquals(src.pixels, out.pixels)
    }

    @Test
    fun doesNotModifyInput() {
        val src = GrayImage.gradient(64, 16)
        val before = src.pixels.copyOf()
        Tone.apply(src, ToneAdjustments(brightness = 0.7f, contrast = 0.9f, gamma = 2f, autoLevels = true, sharpen = 1f))
        assertArrayEquals(before, src.pixels)
    }

    @Test
    fun brightnessShiftsByHundredLevelsAndClamps() {
        assertArrayEquals(intArrayOf(50, 150, 250), applied(neutral.copy(brightness = 0.5f), 0, 100, 200))
        assertArrayEquals(intArrayOf(0, 0, 155), applied(neutral.copy(brightness = -1f), 50, 100, 255))
        // fuori range: vale come +1
        assertArrayEquals(intArrayOf(100, 200), applied(neutral.copy(brightness = 5f), 0, 100))
    }

    @Test
    fun contrastScalesAroundMidGray() {
        // +1 -> fattore 2.5
        assertArrayEquals(intArrayOf(58, 128, 198), applied(neutral.copy(contrast = 1f), 100, 128, 156))
        // -1 -> fattore 0.5
        assertArrayEquals(intArrayOf(64, 78, 128, 178, 192), applied(neutral.copy(contrast = -1f), 0, 28, 128, 228, 255))
    }

    @Test
    fun gammaAboveOneBrightensMidtonesAndKeepsEnds() {
        assertArrayEquals(intArrayOf(0, 128, 181, 255), applied(neutral.copy(gamma = 2f), 0, 64, 128, 255))
        assertArrayEquals(intArrayOf(0, 64, 255), applied(neutral.copy(gamma = 0.5f), 0, 128, 255))
    }

    @Test
    fun nanAdjustmentsFallBackToNeutral() {
        val adj = ToneAdjustments(
            brightness = Float.NaN, contrast = Float.NaN, gamma = Float.NaN, autoLevels = false, sharpen = Float.NaN,
            shadows = Float.NaN, localContrast = Float.NaN, autoBacklight = false,
        )
        assertArrayEquals(intArrayOf(0, 128, 255), applied(adj, 0, 128, 255))
    }

    @Test
    fun autoLevelsStretchesNarrowHistogram() {
        // valori 60..200: dopo lo stiramento 1%-99% devono toccare gli estremi
        val w = 141
        val src = GrayImage(w, 4)
        for (y in 0 until 4) for (x in 0 until w) src[x, y] = 60 + x
        val out = values(Tone.apply(src, neutral.copy(autoLevels = true)))
        assertEquals(0, out.minOrNull())
        assertEquals(255, out.maxOrNull())
    }

    @Test
    fun autoLevelsKeepsFlatImageFlat() {
        // protezione: un grigio uniforme non deve esplodere in bianco o nero
        val out = values(Tone.apply(GrayImage(16, 16, ByteArray(256) { 128.toByte() }), neutral.copy(autoLevels = true)))
        for (v in out) assertEquals(128, v)
        val dark = values(Tone.apply(GrayImage(16, 16, ByteArray(256) { 10.toByte() }), neutral.copy(autoLevels = true)))
        for (v in dark) assertTrue("grigio scuro piatto -> $v", v in 0..64)
    }

    @Test
    fun levelsAreAlwaysAValidRange() {
        val hist = IntArray(256)
        hist[250] = 100
        val range = Tone.levels(hist, 100)
        assertTrue(range[1] > range[0])
        assertEquals(255.0, range[1], 1e-9)
        assertEquals(255.0 - Tone.MIN_LEVELS_RANGE, range[0], 1e-9)
    }

    @Test
    fun sharpenBoostsEdgesAndLeavesFlatAreas() {
        // bordo verticale tra 100 e 150
        val src = GrayImage(8, 3)
        for (y in 0 until 3) for (x in 0 until 8) src[x, y] = if (x < 4) 100 else 150
        val out = Tone.apply(src, neutral.copy(sharpen = 1f))
        val middle = IntArray(8) { out[it, 1] }
        assertArrayEquals(intArrayOf(100, 100, 100, 81, 168, 150, 150, 150), middle)
        val soft = Tone.apply(src, neutral.copy(sharpen = 0.5f))
        assertArrayEquals(intArrayOf(100, 100, 100, 90, 159, 150, 150, 150), IntArray(8) { soft[it, 1] })
    }

    @Test
    fun defaultsBrightenMidtonesForThermalPaper() {
        // replica JS della pipeline: 147 con i default (146 con i nuovi passi spenti)
        val out = Tone.apply(GrayImage(8, 8, ByteArray(64) { 128.toByte() }), ToneAdjustments())
        val v = out[3, 3]
        assertEquals("grigio medio con i default", 147, v)
        val before = Tone.apply(GrayImage(8, 8, ByteArray(64) { 128.toByte() }), legacy)
        assertEquals("grigio medio senza i nuovi passi", 146, before[3, 3])
    }

    @Test
    fun defaultsKeepGradientEndsAndOrder() {
        val out = Tone.apply(GrayImage.gradient(256, 4), ToneAdjustments())
        assertEquals(0, out[0, 0])
        assertEquals(255, out[255, 0])
        // il contrasto locale lascia increspature di 1-2 livelli (replica JS: -2 al massimo),
        // invisibili dopo la retinatura; a blocchi di 16 colonne la scala sale sempre
        for (y in 0 until 4) for (x in 1 until 256) {
            assertTrue("($x, $y): ${out[x - 1, y]} -> ${out[x, y]}", out[x, y] >= out[x - 1, y] - 3)
        }
        var previous = -1
        for (block in 0 until 16) {
            var sum = 0
            for (x in block * 16 until block * 16 + 16) sum += out[x, 0]
            assertTrue("blocco $block", sum > previous)
            previous = sum
        }
    }

    @Test
    fun withoutLocalContrastGradientStaysMonotonic() {
        // ombre, controluce e curva globale sono monotone: le increspature vengono solo da CLAHE
        val out = Tone.apply(GrayImage.gradient(256, 4), ToneAdjustments(localContrast = 0f))
        assertEquals(0, out[0, 0])
        assertEquals(255, out[255, 0])
        for (y in 0 until 4) for (x in 1 until 256) assertTrue(out[x, y] >= out[x - 1, y])
    }

    @Test
    fun newStepsOffKeepPreviousResult() {
        // valori della pipeline precedente (auto-livelli, contrasto 0.15, gamma 1.25, nitidezza 0.5),
        // calcolati con la replica JS: chi ha spento ombre e contrasto locale non vede differenze
        val w = 12
        val h = 4
        val src = GrayImage(w, h)
        for (y in 0 until h) for (x in 0 until w) src[x, y] = (x * 37 + y * 91 + (x * y) % 7 * 11) % 256
        val expected = intArrayOf(
            0, 3, 63, 124, 192, 243, 255, 0, 9, 68, 128, 206,
            102, 186, 255, 255, 0, 50, 138, 88, 189, 255, 255, 0,
            255, 255, 0, 108, 70, 186, 255, 255, 255, 0, 111, 83,
            0, 90, 212, 181, 255, 255, 0, 0, 94, 216, 186, 255,
        )
        assertArrayEquals(expected, values(Tone.apply(src, legacy)))
    }

    @Test
    fun shadowsLiftOnlyDarkTones() {
        // nero e bianco fermi, scuri sollevati molto, medi alti poco (replica JS)
        assertArrayEquals(
            intArrayOf(0, 53, 93, 140, 173, 200, 255),
            applied(neutral.copy(shadows = 1f), 0, 16, 32, 64, 128, 192, 255),
        )
        assertArrayEquals(
            intArrayOf(0, 25, 47, 83, 139, 194, 255),
            applied(neutral.copy(shadows = 0.25f), 0, 16, 32, 64, 128, 192, 255),
        )
    }

    @Test
    fun shadowCurveIsMonotonicAndKeepsEnds() {
        for (step in 0..20) {
            val amount = step / 20f
            assertEquals(0.0, Tone.shadowLift(0.0, amount), 1e-9)
            assertEquals(255.0, Tone.shadowLift(255.0, amount), 1e-9)
            var previous = -1.0
            for (i in 0..1020) {
                // passi di un quarto di livello: la LUT non deve mai scendere
                val v = Tone.shadowLift(i / 4.0, amount)
                assertTrue("ombre $amount, livello ${i / 4.0}: $v < $previous", v > previous)
                previous = v
            }
        }
        // il massimo e a un quarto della scala; a 192 resta poco
        val dark = Tone.shadowLift(64.0, 1f) - 64.0
        val light = Tone.shadowLift(192.0, 1f) - 192.0
        assertEquals(255.0 * Tone.SHADOWS_MAX_LIFT, dark, 0.5)
        assertTrue("a 192: +$light", light < dark / 8)
    }

    /** Soggetto ovale scuro e testurizzato al centro, sfondo quasi bianco: il controluce tipico. */
    private fun backlitScene(w: Int, h: Int, subject: Int, background: Int): GrayImage {
        val img = GrayImage(w, h)
        for (y in 0 until h) for (x in 0 until w) {
            val dx = (x + 0.5 - w / 2.0) / (0.3 * w)
            val dy = (y + 0.5 - h / 2.0) / (0.35 * h)
            img[x, y] = if (dx * dx + dy * dy <= 1.0) subject + (x * 7 + y * 13) % 30 else background + (x * 5 + y * 3) % 25
        }
        return img
    }

    private fun mean(img: GrayImage, x0: Int, x1: Int, y0: Int, y1: Int): Double {
        var sum = 0L
        for (y in y0 until y1) for (x in x0 until x1) sum += img[x, y]
        return sum.toDouble() / ((x1 - x0) * (y1 - y0))
    }

    @Test
    fun autoBacklightOpensTheSubject() {
        val src = backlitScene(120, 160, subject = 40, background = 225)
        val on = Tone.apply(src, ToneAdjustments())
        val off = Tone.apply(src, ToneAdjustments(autoBacklight = false))
        // replica JS: viso 54 in origine, 38 senza controluce automatico, 90 con
        val faceOn = mean(on, 45, 75, 50, 110)
        val faceOff = mean(off, 45, 75, 50, 110)
        assertTrue("viso: $faceOff senza, $faceOn con", faceOn > faceOff + 30)
        assertTrue("viso leggibile: $faceOn", faceOn > mean(src, 45, 75, 50, 110))
        // lo sfondo resta chiaro
        assertTrue("sfondo: ${mean(on, 0, 10, 0, 160)}", mean(on, 0, 10, 0, 160) > 200)
    }

    @Test
    fun autoBacklightChangesNothingWithoutBacklight() {
        // soggetto chiaro su sfondo scuro: punteggio 0, stesso risultato con e senza
        val src = GrayImage(120, 160)
        for (y in 0 until 160) for (x in 0 until 120) {
            val dx = (x + 0.5 - 60.0) / 36.0
            val dy = (y + 0.5 - 80.0) / 56.0
            src[x, y] = if (dx * dx + dy * dy <= 1.0) 200 + (x * 7 + y * 13) % 40 else 20 + (x * 5 + y * 3) % 30
        }
        assertArrayEquals(
            Tone.apply(src, ToneAdjustments(autoBacklight = false)).pixels,
            Tone.apply(src, ToneAdjustments()).pixels,
        )
    }

    @Test
    fun tinyImagesWork() {
        val sizes = listOf(1 to 1, 1 to 7, 7 to 1, 2 to 2, 1 to 300, 300 to 1, 3 to 17)
        val strong = ToneAdjustments(shadows = 1f, localContrast = 1f, sharpen = 1f)
        for ((w, h) in sizes) {
            val src = GrayImage(w, h, ByteArray(w * h) { (it * 53 % 256).toByte() })
            for (adj in listOf(ToneAdjustments(), strong, neutral)) {
                val out = Tone.apply(src, adj)
                assertEquals(w, out.width)
                assertEquals(h, out.height)
            }
        }
    }
}
