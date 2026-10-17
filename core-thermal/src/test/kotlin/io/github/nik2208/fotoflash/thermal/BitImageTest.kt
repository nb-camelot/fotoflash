package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BitImageTest {

    @Test
    fun packsPixelsMsbFirst() {
        val img = BitImage(10, 2)
        assertEquals(2, img.bytesPerRow)
        img[0, 0] = true
        img[9, 0] = true
        img[8, 1] = true
        assertArrayEquals(
            byteArrayOf(0x80.toByte(), 0x40, 0x00, 0x80.toByte()),
            img.data,
        )
        assertTrue(img[9, 0])
        assertFalse(img[1, 0])
        img[0, 0] = false
        assertFalse(img[0, 0])
    }

    @Test
    fun slicesBands() {
        val img = BitImage(8, 3)
        img[0, 2] = true
        assertArrayEquals(byteArrayOf(0x80.toByte()), img.rowsSlice(2, 1))
    }
}
