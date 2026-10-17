package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class EscPosTest {

    private fun bytes(vararg values: Int): ByteArray = ByteArray(values.size) { values[it].toByte() }

    @Test
    fun initAndBasicCommands() {
        assertArrayEquals(bytes(0x1B, 0x40), EscPosBuilder().init().bytes())
        assertArrayEquals(bytes(0x1B, 0x74, 16), EscPosBuilder().codepage(16).bytes())
        assertArrayEquals(bytes(0x1B, 0x45, 1, 0x1B, 0x45, 0), EscPosBuilder().bold(true).bold(false).bytes())
        assertArrayEquals(bytes(0x1B, 0x64, 3), EscPosBuilder().feed(3).bytes())
    }

    @Test
    fun alignUsesEscA() {
        val out = EscPosBuilder().align(TextAlign.START).align(TextAlign.CENTER).align(TextAlign.END).bytes()
        assertArrayEquals(bytes(0x1B, 0x61, 0, 0x1B, 0x61, 1, 0x1B, 0x61, 2), out)
    }

    @Test
    fun sizeUsesGsExclamationNotEscExclamation() {
        // GS ! = 0x1D 0x21; ESC ! (0x1B 0x21) e un altro comando
        assertArrayEquals(bytes(0x1D, 0x21, 0x00), EscPosBuilder().size(1, 1).bytes())
        assertArrayEquals(bytes(0x1D, 0x21, 0x11), EscPosBuilder().size(2, 2).bytes())
        assertArrayEquals(bytes(0x1D, 0x21, 0x10), EscPosBuilder().size(2, 1).bytes())
        assertArrayEquals(bytes(0x1D, 0x21, 0x01), EscPosBuilder().size(1, 2).bytes())
        assertArrayEquals(bytes(0x1D, 0x21, 0x77), EscPosBuilder().size(8, 8).bytes())
        // fuori range: riportato in 1..8
        assertArrayEquals(bytes(0x1D, 0x21, 0x07), EscPosBuilder().size(0, 9).bytes())
    }

    @Test
    fun cutUsesFunctionB() {
        assertArrayEquals(bytes(0x1D, 0x56, 66, 0), EscPosBuilder().cut().bytes())
        assertArrayEquals(bytes(0x1D, 0x56, 66, 0), EscPosBuilder().cut(partial = true).bytes())
        assertArrayEquals(bytes(0x1D, 0x56, 65, 0), EscPosBuilder().cut(partial = false).bytes())
    }

    @Test
    fun heatUsesEsc7AndClamps() {
        assertArrayEquals(bytes(0x1B, 0x37, 7, 80, 2), EscPosBuilder().heat(HeatSettings()).bytes())
        assertArrayEquals(
            bytes(0x1B, 0x37, 0, 255, 255),
            EscPosBuilder().heat(HeatSettings(maxDots = -3, heatTime = 300, heatInterval = 1000)).bytes(),
        )
    }

    @Test
    fun feedClampsToOneByte() {
        assertArrayEquals(bytes(0x1B, 0x64, 255), EscPosBuilder().feed(1000).bytes())
        assertArrayEquals(bytes(0x1B, 0x64, 0), EscPosBuilder().feed(-2).bytes())
    }

    @Test
    fun textIsLatin1AndUnmappableBecomesQuestionMark() {
        assertArrayEquals(bytes(0x43, 0x61, 0x66, 0x66, 0xE8), EscPosBuilder().text("Caff\u00E8").bytes())
        assertArrayEquals(bytes(0x3F), EscPosBuilder().text("\u20AC").bytes())
        assertArrayEquals(bytes(0x41, 0x0A, 0x0A), EscPosBuilder().line("A").line().bytes())
        assertArrayEquals(bytes(0xC3, 0xA8), EscPosBuilder().text("\u00E8", Charsets.UTF_8).bytes())
    }

    @Test
    fun rawTruncatesToEightBitsAndSizeCounts() {
        val b = EscPosBuilder().raw(0x1B, 0x140, -1)
        assertArrayEquals(bytes(0x1B, 0x40, 0xFF), b.bytes())
        assertEquals(3, b.size)
        // il buffer cresce oltre la capacita iniziale senza perdere byte
        val big = EscPosBuilder()
        repeat(1000) { big.raw(it) }
        assertEquals(1000, big.size)
        val out = big.bytes()
        for (i in 0 until 1000) assertEquals(i and 0xFF, out[i].toInt() and 0xFF)
    }

    @Test
    fun bandHeaderHasBytesPerRowAndRows() {
        val img = BitImage(20, 5)
        img[0, 0] = true
        img[19, 4] = true
        val band = EscPosRaster.band(img, 0, 5)
        assertEquals(EscPosRaster.HEADER_SIZE + 3 * 5, band.size)
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 3, 0, 5, 0), band.copyOfRange(0, 8))
        assertEquals(0x80, band[8].toInt() and 0xFF)
        // punto 19 della riga 4: terzo byte, bit 4 (MSB-first)
        assertEquals(0x10, band[8 + 4 * 3 + 2].toInt() and 0xFF)
    }

    @Test
    fun bandHeaderIsLittleEndian() {
        // 2056 punti = 257 byte per riga: xL = 1, xH = 1; 300 righe: yL = 44, yH = 1
        val img = BitImage(2056, 300)
        val band = EscPosRaster.band(img, 0, 300)
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 1, 1, 44, 1), band.copyOfRange(0, 8))
        assertEquals(8 + 257 * 300, band.size)
    }

    @Test
    fun bandCarriesTheRequestedRows() {
        val img = BitImage(8, 4)
        img[0, 2] = true
        img[7, 3] = true
        val band = EscPosRaster.band(img, 2, 2)
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0x80, 0x01), band)
    }

    @Test(expected = IllegalArgumentException::class)
    fun bandOutOfRangeIsRejected() {
        EscPosRaster.band(BitImage(8, 4), 3, 2)
    }

    @Test
    fun rasterSplitsIntoBandsWithShortLastBand() {
        val img = BitImage(16, 50)
        val out = EscPosBuilder().raster(img, bandHeight = 24).bytes()
        assertEquals(3 * 8 + 2 * 50, out.size)
        val second = 8 + 2 * 24
        val third = second + 8 + 2 * 24
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 2, 0, 24, 0), out.copyOfRange(0, 8))
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 2, 0, 24, 0), out.copyOfRange(second, second + 8))
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 2, 0, 2, 0), out.copyOfRange(third, third + 8))
    }

    @Test
    fun rasterClampsBandHeight() {
        val img = BitImage(8, 300)
        // banda 0 -> 1 riga: 300 comandi
        assertEquals(300 * (8 + 1), EscPosBuilder().raster(img, bandHeight = 0).size)
        // banda 1000 -> 255 righe: 2 comandi (255 + 45)
        val big = EscPosBuilder().raster(img, bandHeight = 1000).bytes()
        assertEquals(2 * 8 + 300, big.size)
        assertEquals(255, big[6].toInt() and 0xFF)
        assertEquals(45, big[8 + 255 + 6].toInt() and 0xFF)
    }

    @Test
    fun appendAndChaining() {
        val out = EscPosBuilder().init().append(bytes(1, 2, 3)).align(TextAlign.CENTER).bytes()
        assertArrayEquals(bytes(0x1B, 0x40, 1, 2, 3, 0x1B, 0x61, 1), out)
    }
}
