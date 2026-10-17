package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class GrayImageTest {

    @Test
    fun defaultIsAllWhite() {
        val img = GrayImage(5, 3)
        assertEquals(15, img.pixels.size)
        for (y in 0 until 3) for (x in 0 until 5) assertEquals(255, img[x, y])
    }

    @Test
    fun bytesAreReadUnsigned() {
        val img = GrayImage(2, 1)
        img[0, 0] = 200
        img[1, 0] = 128
        assertEquals(200, img[0, 0])
        assertEquals(128, img[1, 0])
        // in memoria e un byte con segno, ma l'API restituisce sempre 0..255
        assertEquals(200.toByte(), img.pixels[0])
    }

    @Test
    fun setClampsOutOfRange() {
        val img = GrayImage(2, 1)
        img[0, 0] = -40
        img[1, 0] = 999
        assertEquals(0, img[0, 0])
        assertEquals(255, img[1, 0])
    }

    @Test
    fun copyIsIndependent() {
        val img = GrayImage(3, 3)
        img[1, 1] = 10
        val copy = img.copy()
        assertNotSame(img.pixels, copy.pixels)
        copy[1, 1] = 90
        assertEquals(10, img[1, 1])
        assertEquals(90, copy[1, 1])
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsWrongPixelCount() {
        GrayImage(2, 2, ByteArray(3))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsEmptySize() {
        GrayImage(0, 4, ByteArray(0))
    }

    @Test
    fun fromArgbUsesRec601Luma() {
        val argb = intArrayOf(
            0xFFFF0000.toInt(), // rosso
            0xFF00FF00.toInt(), // verde
            0xFF0000FF.toInt(), // blu
            0xFFFFFFFF.toInt(), // bianco
            0xFF000000.toInt(), // nero
            0xFF808080.toInt(), // grigio medio
        )
        val img = GrayImage.fromArgb(6, 1, argb)
        assertEquals(76, img[0, 0])
        assertEquals(150, img[1, 0])
        assertEquals(29, img[2, 0])
        assertEquals(255, img[3, 0])
        assertEquals(0, img[4, 0])
        assertEquals(128, img[5, 0])
    }

    @Test
    fun fromArgbCompositesAlphaOnWhite() {
        val argb = intArrayOf(
            0x00000000, // nero trasparente: e carta
            0x80000000.toInt(), // nero a meta: grigio medio
            0x00FF0000, // rosso trasparente
        )
        val img = GrayImage.fromArgb(3, 1, argb)
        assertEquals(255, img[0, 0])
        assertEquals(127, img[1, 0])
        assertEquals(255, img[2, 0])
    }

    @Test
    fun gradientGoesFromBlackToWhite() {
        val img = GrayImage.gradient(256, 2)
        assertEquals(0, img[0, 0])
        assertEquals(255, img[255, 1])
        assertEquals(128, img[128, 0])
        for (x in 1 until 256) assertTrue(img[x, 0] >= img[x - 1, 0])
        assertEquals(0, GrayImage.gradient(1, 1)[0, 0])
    }

    @Test
    fun histogramAndMean() {
        val img = GrayImage(4, 1, byteArrayOf(0, 0, 255.toByte(), 255.toByte()))
        val hist = img.histogram()
        assertEquals(2, hist[0])
        assertEquals(2, hist[255])
        assertEquals(127.5, img.mean(), 1e-9)
        assertArrayEquals(IntArray(256).also { it[255] = 6 }, GrayImage(3, 2).histogram())
    }
}
