package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ThermalJobTest {

    private fun bytes(vararg values: Int): ByteArray = ByteArray(values.size) { values[it].toByte() }

    private fun header(packet: ByteArray): ByteArray = packet.copyOfRange(0, EscPosRaster.HEADER_SIZE)

    @Test
    fun defaultJobIsInitBandsAndFeed() {
        val img = BitImage(384, 50)
        val packets = ThermalJob.build(img, PrintJobOptions())
        // ESC @, 3 bande (24 + 24 + 2), avanzamento
        assertEquals(5, packets.size)
        assertArrayEquals(bytes(0x1B, 0x40), packets[0])
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 48, 0, 24, 0), header(packets[1]))
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 48, 0, 24, 0), header(packets[2]))
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 48, 0, 2, 0), header(packets[3]))
        assertEquals(8 + 48 * 24, packets[1].size)
        assertEquals(8 + 48 * 2, packets[3].size)
        assertArrayEquals(bytes(0x1B, 0x64, 4), packets[4])
    }

    @Test
    fun heatGoesInTheFirstPacketAndCutInTheLast() {
        val options = PrintJobOptions(bandHeight = 24, feedLinesAfter = 6, cut = true, heat = HeatSettings(9, 120, 3))
        val packets = ThermalJob.build(BitImage(384, 24), options)
        assertEquals(3, packets.size)
        assertArrayEquals(bytes(0x1B, 0x40, 0x1B, 0x37, 9, 120, 3), packets[0])
        assertArrayEquals(bytes(0x1B, 0x64, 6, 0x1D, 0x56, 66, 0), packets[2])
    }

    @Test
    fun bandsCarryTheWholeImageInOrder() {
        val img = BitImage(20, 37)
        for (y in 0 until 37) for (x in 0 until 20) img[x, y] = (x * 3 + y * 5) % 7 == 0
        val packets = ThermalJob.build(img, PrintJobOptions(bandHeight = 10))
        val bands = packets.subList(1, packets.size - 1)
        assertEquals(4, bands.size)
        val rows = bands.map { it[6].toInt() and 0xFF }
        assertEquals(listOf(10, 10, 10, 7), rows)
        // concatenando i dati delle bande si riottiene l'immagine
        val joined = bands.map { it.copyOfRange(EscPosRaster.HEADER_SIZE, it.size) }
            .fold(ByteArray(0)) { acc, part -> acc + part }
        assertArrayEquals(img.data, joined)
    }

    @Test
    fun bandHeightIsClamped() {
        val img = BitImage(8, 600)
        val oneRow = ThermalJob.build(img, PrintJobOptions(bandHeight = 0))
        assertEquals(600 + 2, oneRow.size)
        val huge = ThermalJob.build(img, PrintJobOptions(bandHeight = 999))
        // 255 + 255 + 90
        assertEquals(3 + 2, huge.size)
        assertEquals(90, huge[3][6].toInt() and 0xFF)
    }

    @Test
    fun zeroFeedStillClosesTheJob() {
        val packets = ThermalJob.build(BitImage(8, 1), PrintJobOptions(feedLinesAfter = 0))
        assertArrayEquals(bytes(0x1B, 0x64, 0), packets.last())
    }

    @Test
    fun totalBytesSumsPackets() {
        val packets = ThermalJob.build(BitImage(384, 50), PrintJobOptions())
        assertEquals(2 + (8 + 48 * 24) * 2 + (8 + 48 * 2) + 3, ThermalJob.totalBytes(packets))
    }

    @Test
    fun resyncIsAFullBandOfNul() {
        val fill = ThermalJob.resync(48, 24)
        assertEquals(8 + 48 * 24, fill.size)
        assertTrue(fill.all { it.toInt() == 0 })
        // valori fuori range riportati nel range: almeno 1 byte per riga, 1..255 righe
        assertEquals(8 + 1 * 1, ThermalJob.resync(0, 0).size)
        assertEquals(8 + 72 * 255, ThermalJob.resync(72, 999).size)
    }

    @Test
    fun resyncForCoversTheLargestPacketOfTheInterruptedJob() {
        val packets = ThermalJob.build(BitImage(384, 50), PrintJobOptions())
        val fill = ThermalJob.resyncFor(packets)
        assertEquals(8 + 48 * 24, fill.size)
        assertTrue(fill.all { it.toInt() == 0 })
        // bande alte (impostazione 8..255): il riempimento segue il lavoro, non un valore fisso
        val tall = ThermalJob.build(BitImage(576, 300), PrintJobOptions(bandHeight = 200))
        assertEquals(8 + 72 * 200, ThermalJob.resyncFor(tall).size)
        // pacchetti qualsiasi (pagina di prova): conta il piu grande
        assertEquals(5, ThermalJob.resyncFor(listOf(ByteArray(3), ByteArray(5), ByteArray(1))).size)
        assertEquals(0, ThermalJob.resyncFor(emptyList()).size)
    }
}
