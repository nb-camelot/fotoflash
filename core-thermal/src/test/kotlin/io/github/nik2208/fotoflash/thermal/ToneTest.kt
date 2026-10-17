package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ToneTest {

    /** Nessuna regolazione: la curva deve essere l'identita. */
    private val neutral = ToneAdjustments(brightness = 0f, contrast = 0f, gamma = 1f, autoLevels = false, sharpen = 0f)

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
        val adj = ToneAdjustments(brightness = Float.NaN, contrast = Float.NaN, gamma = Float.NaN, autoLevels = false, sharpen = Float.NaN)
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
        val out = Tone.apply(GrayImage(8, 8, ByteArray(64) { 128.toByte() }), ToneAdjustments())
        val v = out[3, 3]
        assertTrue("grigio medio con i default -> $v", v in 140..152)
    }

    @Test
    fun defaultsKeepGradientMonotonic() {
        val out = Tone.apply(GrayImage.gradient(256, 4), ToneAdjustments())
        assertEquals(0, out[0, 0])
        assertEquals(255, out[255, 0])
        for (y in 0 until 4) for (x in 1 until 256) assertTrue(out[x, y] >= out[x - 1, y])
    }
}
