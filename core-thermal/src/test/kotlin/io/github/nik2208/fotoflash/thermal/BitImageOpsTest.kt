package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class BitImageOpsTest {

    private fun solid(w: Int, h: Int): BitImage = BitImage(w, h).also { it.fillRect(Rect(0, 0, w, h), black = true) }

    @Test
    fun blitInsideCopiesBlackDots() {
        val dst = BitImage(16, 16)
        dst.blit(solid(4, 4), 2, 3)
        assertEquals(16, dst.countBlack())
        assertTrue(dst[2, 3])
        assertTrue(dst[5, 6])
        assertFalse(dst[6, 3])
        assertFalse(dst[2, 7])
        assertFalse(dst[1, 3])
    }

    @Test
    fun blitClipsOnEverySide() {
        val src = solid(4, 4)
        val topLeft = BitImage(8, 8).also { it.blit(src, -2, -2) }
        assertEquals(4, topLeft.countBlack())
        assertTrue(topLeft[0, 0])
        assertTrue(topLeft[1, 1])
        assertFalse(topLeft[2, 2])

        val bottomRight = BitImage(8, 8).also { it.blit(src, 6, 6) }
        assertEquals(4, bottomRight.countBlack())
        assertTrue(bottomRight[7, 7])
        assertTrue(bottomRight[6, 6])
        assertFalse(bottomRight[5, 5])

        // sorgente piu grande della destinazione in ogni direzione
        val inside = BitImage(5, 3).also { it.blit(solid(20, 20), -7, -9) }
        assertEquals(15, inside.countBlack())
    }

    @Test
    fun blitFullyOutsideDoesNothing() {
        val dst = BitImage(8, 8)
        val src = solid(4, 4)
        dst.blit(src, 100, 0)
        dst.blit(src, 0, 100)
        dst.blit(src, -4, 0)
        dst.blit(src, 0, -4)
        dst.blit(src, 8, 8)
        assertEquals(0, dst.countBlack())
    }

    @Test
    fun blitIsAnOrAndWhiteNeverErases() {
        val dst = BitImage(8, 1)
        dst[0, 0] = true
        dst[5, 0] = true
        val src = BitImage(8, 1)
        src[1, 0] = true
        dst.blit(src, 0, 0)
        assertTrue(dst[0, 0])
        assertTrue(dst[1, 0])
        assertTrue(dst[5, 0])
        assertEquals(3, dst.countBlack())
    }

    @Test
    fun blitWithUnalignedOffsetKeepsEveryDot() {
        // scacchiera 13x5 incollata a x = 3, y = 1: verifica pixel per pixel, anche a cavallo dei byte
        val src = BitImage(13, 5)
        for (y in 0 until 5) for (x in 0 until 13) src[x, y] = (x + y) % 2 == 0
        val dst = BitImage(24, 8)
        dst.blit(src, 3, 1)
        for (y in 0 until 8) for (x in 0 until 24) {
            val sx = x - 3
            val sy = y - 1
            val expected = sx in 0 until 13 && sy in 0 until 5 && (sx + sy) % 2 == 0
            assertEquals("punto $x,$y", expected, dst[x, y])
        }
    }

    @Test
    fun fillRectClipsAndClears() {
        val img = BitImage(8, 8)
        img.fillRect(Rect(-5, -5, 10, 10), black = true)
        assertEquals(25, img.countBlack())
        assertTrue(img[4, 4])
        assertFalse(img[5, 5])
        img.fillRect(Rect(2, 2, 100, 100), black = false)
        assertEquals(25 - 9, img.countBlack())
        img.fillRect(Rect(50, 50, 4, 4), black = true)
        assertEquals(16, img.countBlack())
    }

    @Test
    fun toArgbMapsDotsToColors() {
        val img = BitImage(3, 2)
        img[0, 0] = true
        img[2, 1] = true
        val white = 0xFFFFFFFF.toInt()
        val black = 0xFF000000.toInt()
        assertArrayEquals(intArrayOf(black, white, white, white, white, black), img.toArgb())
        val ink = 0xFF16130F.toInt()
        val paper = 0xFFFBF8F1.toInt()
        assertArrayEquals(intArrayOf(ink, paper, paper, paper, paper, ink), img.toArgb(black = ink, white = paper))
    }

    @Test
    fun bitImageFromArgbUsesLumaAndAlpha() {
        val argb = intArrayOf(
            0xFF000000.toInt(), // nero opaco -> nero
            0x7F000000, // nero quasi trasparente -> bianco
            0x80000000.toInt(), // nero con alpha 128 -> nero
            0xFF7F7F7F.toInt(), // luma 127 < 128 -> nero
            0xFF808080.toInt(), // luma 128 -> bianco
            0xFFFF0000.toInt(), // rosso, luma 76 -> nero
        )
        val img = bitImageFromArgb(6, 1, argb)
        assertTrue(img[0, 0])
        assertFalse(img[1, 0])
        assertTrue(img[2, 0])
        assertTrue(img[3, 0])
        assertFalse(img[4, 0])
        assertTrue(img[5, 0])
        // con soglia 60 il rosso resta bianco
        assertFalse(bitImageFromArgb(6, 1, argb, threshold = 60)[5, 0])
    }

    @Test
    fun argbRoundTripIsLossless() {
        val img = BitImage(19, 7)
        for (y in 0 until 7) for (x in 0 until 19) img[x, y] = (x * 7 + y * 3) % 5 == 0
        val back = bitImageFromArgb(19, 7, img.toArgb())
        assertArrayEquals(img.data, back.data)
    }

    @Test
    fun copyIsIndependentAndCountBlackCountsDots() {
        val img = solid(10, 3)
        assertEquals(30, img.countBlack())
        val copy = img.copy()
        assertNotSame(img.data, copy.data)
        copy[0, 0] = false
        assertEquals(30, img.countBlack())
        assertEquals(29, copy.countBlack())
    }
}
