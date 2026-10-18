package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class DriversTest {

    private val escpos58 = PrinterDrivers.ESCPOS_58
    private val escpos80 = PrinterDrivers.ESCPOS_80
    private val m02 = PrinterDrivers.PHOMEMO_M02
    private val m02pro = PrinterDrivers.PHOMEMO_M02PRO

    private fun bytes(vararg values: Int): ByteArray = ByteArray(values.size) { values[it].toByte() }

    private fun header(packet: ByteArray): ByteArray = packet.copyOfRange(0, EscPosRaster.HEADER_SIZE)

    /** Riga [y] dei dati di un blocco raster con [widthBytes] byte per riga. */
    private fun row(packet: ByteArray, widthBytes: Int, y: Int): ByteArray {
        val from = EscPosRaster.HEADER_SIZE + y * widthBytes
        return packet.copyOfRange(from, from + widthBytes)
    }

    private fun solid(w: Int, h: Int): BitImage = BitImage(w, h).also { it.fillRect(Rect(0, 0, w, h), black = true) }

    /** Stesso pattern dei vettori condivisi: nero se ((x >> 3) + (y >> 3)) e pari. */
    private fun checker8(w: Int, h: Int): BitImage {
        val img = BitImage(w, h)
        for (y in 0 until h) for (x in 0 until w) img[x, y] = ((x shr 3) + (y shr 3)) % 2 == 0
        return img
    }

    private fun assertPackets(expected: List<ByteArray>, actual: List<ByteArray>) {
        assertEquals("numero di pacchetti", expected.size, actual.size)
        for (i in expected.indices) assertArrayEquals("pacchetto $i", expected[i], actual[i])
    }

    /** Glifo disegnato come righe di '#' (nero) e '.' (bianco). */
    private fun art(img: BitImage): List<String> = (0 until img.height).map { y ->
        (0 until img.width).joinToString("") { x -> if (img[x, y]) "#" else "." }
    }

    // ---- Phomemo ----

    @Test
    fun m02ProJobFollowsTheProtocolTable() {
        val packets = m02pro.encode(BitImage(576, 300), DriverOptions())
        assertEquals(11, packets.size)
        assertArrayEquals(bytes(0x1B, 0x40), packets[0])
        assertArrayEquals(bytes(0x1B, 0x61, 0x01), packets[1])
        assertArrayEquals(bytes(0x1F, 0x11, 0x02, 0x04), packets[2])
        // 300 righe = un blocco da 255 e uno da 45, righe da 72 byte
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x48, 0x00, 0xFF, 0x00), header(packets[3]))
        assertEquals(8 + 72 * 255, packets[3].size)
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x48, 0x00, 45, 0x00), header(packets[4]))
        assertEquals(8 + 72 * 45, packets[4].size)
        assertArrayEquals(bytes(0x1B, 0x64, 0x04), packets[5])
        assertArrayEquals(bytes(0x1B, 0x64, 0x02), packets[6])
        assertArrayEquals(bytes(0x1F, 0x11, 0x08), packets[7])
        assertArrayEquals(bytes(0x1F, 0x11, 0x0E), packets[8])
        assertArrayEquals(bytes(0x1F, 0x11, 0x07), packets[9])
        assertArrayEquals(bytes(0x1F, 0x11, 0x09), packets[10])
    }

    @Test
    fun phomemoBlocksCarryTheWholeImageInOrder() {
        val img = checker8(576, 300)
        val packets = m02pro.encode(img, DriverOptions())
        val joined = packets[3].copyOfRange(8, packets[3].size) + packets[4].copyOfRange(8, packets[4].size)
        assertArrayEquals(img.data, joined)
    }

    @Test
    fun phomemoIgnoresBandHeight() {
        val img = checker8(576, 300)
        val reference = m02pro.encode(img, DriverOptions())
        assertPackets(reference, m02pro.encode(img, DriverOptions(bandHeight = 8)))
        assertPackets(reference, m02pro.encode(img, DriverOptions(bandHeight = 999)))
    }

    @Test
    fun phomemoBlockSplitAtExactMultiples() {
        assertEquals(3 + 1 + 6, m02pro.encode(BitImage(576, 1), DriverOptions()).size)
        val one = m02pro.encode(BitImage(576, 1), DriverOptions())
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x48, 0x00, 1, 0x00), header(one[3]))
        val two = m02pro.encode(BitImage(576, 510), DriverOptions())
        assertEquals(3 + 2 + 6, two.size)
        assertEquals(255, two[4][6].toInt() and 0xFF)
        val three = m02pro.encode(BitImage(576, 511), DriverOptions())
        assertEquals(3 + 3 + 6, three.size)
        assertEquals(1, three[5][6].toInt() and 0xFF)
    }

    @Test
    fun densityFollowsHeatLevel() {
        val img = BitImage(576, 8)
        val table = listOf(0 to 4, 1 to 2, 2 to 4, 3 to 6, 4 to 8, -3 to 4, 9 to 8)
        for ((level, density) in table) {
            val packets = m02pro.encode(img, DriverOptions(heatLevel = level))
            assertArrayEquals("livello $level", bytes(0x1F, 0x11, 0x02, density), packets[2])
        }
    }

    @Test
    fun densityOverrideWinsAndIsClamped() {
        val img = BitImage(384, 8)
        assertArrayEquals(bytes(0x1F, 0x11, 0x02, 12), m02.encode(img, DriverOptions(heatLevel = 4, densityOverride = 12))[2])
        assertArrayEquals(bytes(0x1F, 0x11, 0x02, 1), m02.encode(img, DriverOptions(densityOverride = 0))[2])
        assertArrayEquals(bytes(0x1F, 0x11, 0x02, 15), m02.encode(img, DriverOptions(densityOverride = 40))[2])
        assertEquals(6, m02pro.densityFor(DriverOptions(heatLevel = 3)))
        assertEquals(9, m02pro.densityFor(DriverOptions(heatLevel = 3, densityOverride = 9)))
    }

    @Test
    fun speedIsSentOnlyWhenSet() {
        val img = BitImage(576, 8)
        val plain = m02pro.encode(img, DriverOptions())
        assertTrue(plain.none { it.size >= 2 && it[0] == 0x1B.toByte() && it[1] == 0x4E.toByte() })
        val fast = m02pro.encode(img, DriverOptions(speed = 3))
        assertEquals(plain.size + 1, fast.size)
        assertArrayEquals(bytes(0x1F, 0x11, 0x02, 0x04), fast[2])
        assertArrayEquals(bytes(0x1B, 0x4E, 0x0D, 0x03), fast[3])
        assertArrayEquals(bytes(0x1B, 0x4E, 0x0D, 0xFF), m02pro.encode(img, DriverOptions(speed = 999))[3])
    }

    @Test
    fun m02ProWidth78CentersOn624Dots() {
        val packets = m02pro.encode(solid(576, 10), DriverOptions(widthBytes = 78))
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x4E, 0x00, 10, 0x00), header(packets[3]))
        assertEquals(8 + 78 * 10, packets[3].size)
        // (624 - 576) / 2 = 24 punti = 3 byte bianchi per lato
        val expected = ByteArray(78) { if (it in 3 until 75) 0xFF.toByte() else 0.toByte() }
        assertArrayEquals(expected, row(packets[3], 78, 0))
        assertArrayEquals(expected, row(packets[3], 78, 9))
    }

    @Test
    fun m02ProAcceptsOnly72Or78Bytes() {
        val img = BitImage(576, 4)
        for (width in listOf(null, 48, 72, 100, 0, -1)) {
            val packets = m02pro.encode(img, DriverOptions(widthBytes = width))
            assertArrayEquals("widthBytes $width", bytes(0x1D, 0x76, 0x30, 0x00, 0x48, 0x00, 4, 0x00), header(packets[3]))
        }
        assertEquals(72, m02pro.widthBytesFor(DriverOptions()))
        assertEquals(78, m02pro.widthBytesFor(DriverOptions(widthBytes = 78)))
    }

    @Test
    fun m02UsesFortyEightBytesAndIgnoresTheWidthOption() {
        val packets = m02.encode(checker8(384, 300), DriverOptions(widthBytes = 78))
        assertEquals(11, packets.size)
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x30, 0x00, 0xFF, 0x00), header(packets[3]))
        assertEquals(8 + 48 * 255, packets[3].size)
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x30, 0x00, 45, 0x00), header(packets[4]))
        assertEquals(8 + 48 * 45, packets[4].size)
        assertEquals(48, m02.widthBytesFor(DriverOptions(widthBytes = 72)))
    }

    @Test
    fun narrowerImageIsCenteredOn576() {
        val packets = m02pro.encode(solid(384, 2), DriverOptions())
        // (576 - 384) / 2 = 96 punti = 12 byte bianchi per lato
        val expected = ByteArray(72) { if (it in 12 until 60) 0xFF.toByte() else 0.toByte() }
        assertArrayEquals(expected, row(packets[3], 72, 0))
        assertArrayEquals(expected, row(packets[3], 72, 1))
    }

    @Test
    fun widerImageIsCroppedInTheMiddle() {
        // 700 punti su 576: si perdono 62 punti per lato
        val img = BitImage(700, 1)
        for (x in 0 until 62) img[x, 0] = true
        img[62, 0] = true
        img[637, 0] = true
        for (x in 638 until 700) img[x, 0] = true
        val packets = m02pro.encode(img, DriverOptions())
        val expected = ByteArray(72)
        expected[0] = 0x80.toByte()
        expected[71] = 0x01
        assertArrayEquals(expected, row(packets[3], 72, 0))
    }

    @Test
    fun feedIsClampedAndAlwaysFollowedByTwoLines() {
        val img = BitImage(576, 1)
        val none = m02pro.encode(img, DriverOptions(feedLines = 0))
        assertArrayEquals(bytes(0x1B, 0x64, 0x00), none[4])
        assertArrayEquals(bytes(0x1B, 0x64, 0x02), none[5])
        assertArrayEquals(bytes(0x1B, 0x64, 0xFF), m02pro.encode(img, DriverOptions(feedLines = 300))[4])
        assertArrayEquals(bytes(0x1B, 0x64, 0x00), m02pro.encode(img, DriverOptions(feedLines = -5))[4])
    }

    @Test
    fun encoderCanBeUsedDirectly() {
        val packets = PhomemoEncoder.encode(solid(8, 2), widthBytes = 1, density = 20, speed = null, feedLines = 1)
        assertArrayEquals(bytes(0x1F, 0x11, 0x02, 15), packets[2])
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0xFF, 0xFF), packets[3])
        assertArrayEquals(bytes(0x1B, 0x64, 0x01), packets[4])
        assertEquals(PhomemoEncoder.DENSITY_DEFAULT, PhomemoEncoder.density(0, null))
        assertEquals(PhomemoEncoder.DENSITY_DEFAULT, PhomemoEncoder.densityForHeat(2))
    }

    // ---- ESC/POS ----

    @Test
    fun escPosEncodeIsThermalJobWithTheHeatTable() {
        val img = checker8(100, 50)
        val options = DriverOptions(feedLines = 6, cut = true, heatLevel = 3, bandHeight = 16)
        val expected = ThermalJob.build(
            img.centeredOn(384),
            PrintJobOptions(bandHeight = 16, feedLinesAfter = 6, cut = true, heat = HeatSettings(10, 110, 2)),
        )
        val actual = escpos58.encode(img, options)
        assertPackets(expected, actual)
        // 50 righe a bande da 16: 16 + 16 + 16 + 2
        assertEquals(1 + 4 + 1, actual.size)
        assertArrayEquals(bytes(0x1B, 0x40, 0x1B, 0x37, 10, 110, 2), actual[0])
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 48, 0, 16, 0), header(actual[1]))
        assertArrayEquals(bytes(0x1B, 0x64, 6, 0x1D, 0x56, 66, 0), actual.last())
    }

    @Test
    fun escPosDefaultSendsNoHeat() {
        val packets = escpos58.encode(BitImage(384, 24), DriverOptions())
        assertArrayEquals(bytes(0x1B, 0x40), packets[0])
        assertArrayEquals(bytes(0x1B, 0x64, 4), packets.last())
        assertNull(escpos58.jobOptions(DriverOptions()).heat)
    }

    @Test
    fun heatTableMatchesPrinterTuning() {
        assertNull(EscPosDriver.heatFor(0))
        assertEquals(HeatSettings(maxDots = 7, heatTime = 60, heatInterval = 2), EscPosDriver.heatFor(1))
        assertEquals(HeatSettings(maxDots = 8, heatTime = 80, heatInterval = 2), EscPosDriver.heatFor(2))
        assertEquals(HeatSettings(maxDots = 10, heatTime = 110, heatInterval = 2), EscPosDriver.heatFor(3))
        assertEquals(HeatSettings(maxDots = 11, heatTime = 140, heatInterval = 2), EscPosDriver.heatFor(4))
        assertEquals(EscPosDriver.heatFor(4), EscPosDriver.heatFor(9))
        assertNull(EscPosDriver.heatFor(-2))
    }

    @Test
    fun escPos80CentersOn576() {
        val packets = escpos80.encode(solid(384, 1), DriverOptions())
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x48, 0x00, 1, 0x00), header(packets[1]))
        val expected = ByteArray(72) { if (it in 12 until 60) 0xFF.toByte() else 0.toByte() }
        assertArrayEquals(expected, row(packets[1], 72, 0))
    }

    @Test
    fun escPosIgnoresPhomemoOptions() {
        val img = checker8(384, 40)
        assertPackets(
            escpos58.encode(img, DriverOptions()),
            escpos58.encode(img, DriverOptions(speed = 3, densityOverride = 9, widthBytes = 78)),
        )
    }

    // ---- elenco, riconoscimento, profili ----

    @Test
    fun driverTable() {
        assertEquals(listOf("escpos-58", "escpos-80", "phomemo-m02", "phomemo-m02pro"), PrinterDrivers.all.map { it.id })
        assertEquals(PrinterDrivers.all.map { it.id }, PrinterDrivers.ids)

        assertEquals(PaperWidth.MM58, escpos58.paper)
        assertEquals(PaperWidth.MM80, escpos80.paper)
        assertEquals(PaperWidth.MM58, m02.paper)
        assertEquals(PaperWidth.M02PRO, m02pro.paper)
        assertEquals(listOf(203, 203, 203, 300), PrinterDrivers.all.map { it.dpi })
        assertEquals(listOf(384, 576, 384, 576), PrinterDrivers.all.map { it.rasterWidth() })
        assertEquals(624, m02pro.rasterWidth(DriverOptions(widthBytes = 78)))

        assertEquals(DitherAlgorithm.ATKINSON, escpos58.defaultDither)
        assertEquals(DitherAlgorithm.ATKINSON, escpos80.defaultDither)
        assertEquals(DitherAlgorithm.FLOYD_STEINBERG, m02.defaultDither)
        assertEquals(DitherAlgorithm.FLOYD_STEINBERG, m02pro.defaultDither)

        assertEquals(setOf(PrinterLink.CLASSIC, PrinterLink.BLE), escpos58.links)
        assertEquals(setOf(PrinterLink.BLE), m02pro.links)

        assertEquals(TransportHints(chunkSize = 100, chunkDelayMs = 0, withoutResponse = false, finalDelayMs = 300), escpos58.defaultTransport)
        assertEquals(TransportHints(chunkSize = 20, chunkDelayMs = 15, withoutResponse = true, finalDelayMs = 300), m02pro.defaultTransport)
        assertEquals(m02pro.defaultTransport, m02.defaultTransport)
    }

    @Test
    fun byIdFallsBackToEscPos58() {
        for (driver in PrinterDrivers.all) assertSame(driver, PrinterDrivers.byId(driver.id))
        assertSame(escpos58, PrinterDrivers.byId(null))
        assertSame(escpos58, PrinterDrivers.byId(""))
        assertSame(escpos58, PrinterDrivers.byId("phomemo-m02x"))
        assertSame(m02, PrinterDrivers.byId(" phomemo-m02 "))
        assertEquals("escpos-58", PrinterDrivers.DEFAULT_ID)
    }

    @Test
    fun bleProfiles() {
        val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        val phomemo = m02pro.bleProfiles.single()
        assertEquals("0000ff00-0000-1000-8000-00805f9b34fb", phomemo.service)
        assertEquals("0000ff02-0000-1000-8000-00805f9b34fb", phomemo.write)
        assertEquals("0000ff03-0000-1000-8000-00805f9b34fb", phomemo.notify)
        assertEquals(m02pro.bleProfiles, m02.bleProfiles)

        val escPos = escpos58.bleProfiles
        assertEquals(listOf("18F0", "E7810A71", "ISSC", "FF00", "FFE0", "Nordic UART"), escPos.map { it.name })
        assertEquals("000018f0-0000-1000-8000-00805f9b34fb", escPos[0].service)
        assertEquals("00002af1-0000-1000-8000-00805f9b34fb", escPos[0].write)
        assertEquals(escPos, escpos80.bleProfiles)

        for (profile in PrinterDrivers.all.flatMap { it.bleProfiles }) {
            assertTrue(profile.service, uuid.matches(profile.service))
            assertTrue(profile.write, uuid.matches(profile.write))
            profile.notify?.let { assertTrue(it, uuid.matches(it)) }
        }
        // FF00 e di entrambe le famiglie: nei filtri compare una volta sola
        assertEquals(6, PrinterDrivers.bleServices.size)
        assertEquals(1, PrinterDrivers.bleServices.count { it == "0000ff00-0000-1000-8000-00805f9b34fb" })
    }

    @Test
    fun guessRecognizesPhomemoModels() {
        for (name in listOf("M02 Pro", "M02PRO", "m02 pro", "Phomemo M02 Pro", "M02S", "m02s", "M02 S", "M02S-A1B2")) {
            assertSame(name, m02pro, PrinterDrivers.guess(name))
        }
        for (name in listOf("M02", "  m02  ", "M02 1234", "M02123", "Phomemo M02", "M02 Printer")) {
            assertSame(name, m02, PrinterDrivers.guess(name))
        }
    }

    @Test
    fun guessRecognizesEscPosNames() {
        for (name in listOf("BlueTooth Printer", "bluetooth printer ", "Printer001", "MPT-II", "NT-1809", "Netum NT-G58", "POS-5890", "MTP-3")) {
            assertSame(name, escpos58, PrinterDrivers.guess(name))
        }
        // come nella PWA: un nome esatto e dei prefissi, non una parola qualsiasi nel mezzo
        assertNull(PrinterDrivers.guess("Thermal Printer"))
    }

    @Test
    fun guessRejectsM02XAndUnknownNames() {
        for (name in listOf("M02X", "M02 X", "Phomemo M02X", "m02x-1234")) {
            assertNull(name, PrinterDrivers.guess(name))
            assertTrue(name, PrinterDrivers.isUnsupported(name))
        }
        for (name in listOf(null, "", "   ", "Galaxy Buds", "M04S", "XM02", "M02-1A2B")) {
            assertNull(name, PrinterDrivers.guess(name))
            assertFalse(PrinterDrivers.isUnsupported(name))
        }
        assertFalse(PrinterDrivers.isUnsupported("M02 Pro"))
    }

    @Test
    fun matchesNameAgreesWithGuess() {
        assertTrue(m02pro.matchesName("M02 Pro"))
        assertFalse(m02.matchesName("M02 Pro"))
        assertTrue(m02.matchesName("M02"))
        assertFalse(m02pro.matchesName("M02X"))
        assertFalse(m02.matchesName(null))
        assertTrue(escpos58.matchesName("BlueTooth Printer"))
        // dal nome non si capisce la larghezza: risponde solo la 58 mm
        assertFalse(escpos80.matchesName("BlueTooth Printer"))
        assertFalse(escpos58.matchesName("M02"))
        for (driver in PrinterDrivers.all) {
            for (name in listOf("M02 Pro", "M02", "BlueTooth Printer", "M02X", "Galaxy Buds")) {
                assertEquals("${driver.id} / $name", PrinterDrivers.guess(name) === driver, driver.matchesName(name))
            }
        }
    }

    // ---- ingresso in grigio ----

    @Test
    fun encodeGrayDithersWithTheDriverDefault() {
        val gray = GrayImage.gradient(200, 30)
        val options = DriverOptions(feedLines = 2)
        assertPackets(
            m02pro.encode(Ditherer.dither(gray, DitherAlgorithm.FLOYD_STEINBERG), options),
            m02pro.encodeGray(gray, options),
        )
        assertPackets(
            escpos58.encode(Ditherer.dither(gray, DitherAlgorithm.ATKINSON), options),
            escpos58.encodeGray(gray, options),
        )
        assertPackets(
            m02.encode(Ditherer.dither(gray, DitherAlgorithm.THRESHOLD), options),
            m02.encodeGray(gray, options, DitherAlgorithm.THRESHOLD),
        )
    }

    // ---- pagina di prova ----

    @Test
    fun testPageIsARasterJobForEveryDriver() {
        val options = DriverOptions()
        for (driver in PrinterDrivers.all) {
            val image = driver.testPageImage(options)
            assertEquals(driver.id, driver.rasterWidth(options), image.width)
            assertTrue("${driver.id}: altezza ${image.height}", image.height in 400..4000)
            assertTrue(driver.id, image.countBlack() > image.width * 10)
            val packets = driver.testPage(options)
            assertPackets(driver.encode(image, options), packets)
            assertArrayEquals(driver.id, bytes(0x1B, 0x40), packets[0].copyOfRange(0, 2))
        }
        val phomemo = m02pro.testPage(options)
        assertArrayEquals(bytes(0x1B, 0x61, 0x01), phomemo[1])
        assertArrayEquals(bytes(0x1F, 0x11, 0x09), phomemo.last())
    }

    @Test
    fun testPageIsDeterministic() {
        val options = DriverOptions(heatLevel = 2, speed = 2)
        for (driver in PrinterDrivers.all) {
            assertArrayEquals(driver.id, driver.testPageImage(options).data, driver.testPageImage(options).data)
        }
    }

    @Test
    fun testPageFollowsTheM02ProWidthOption() {
        val options = DriverOptions(widthBytes = 78)
        assertEquals(624, m02pro.testPageImage(options).width)
        val packets = m02pro.testPage(options)
        assertArrayEquals(bytes(0x1D, 0x76, 0x30, 0x00, 0x4E, 0x00, 0xFF, 0x00), header(packets[3]))
    }

    @Test
    fun testPageUsesTheLabels() {
        val options = DriverOptions()
        val plain = m02pro.testPageImage(options)
        val custom = m02pro.testPageImage(options, TestPageLabels(parameters = listOf("STAMPANTE DI PROVA"), footer = "FINE"))
        assertFalse(plain.data.contentEquals(custom.data))
        // anche senza titolo la pagina si compone
        assertTrue(m02.testPageImage(options, TestPageLabels(title = "")).height > 0)
        assertTrue(m02pro.encodeTestPage(options, TestPageLabels(highlight = DitherAlgorithm.THRESHOLD)).isNotEmpty())
    }

    @Test
    fun technicalLinesDescribeTheJob() {
        val phomemo = DriverTestPage.technicalLines(m02pro, DriverOptions())
        assertEquals(
            listOf("phomemo-m02pro", "576 DOTS, 300 DPI, 48.8 MM", "DENSITY 4/15, SPEED OFF", "ROW 72 B, FEED 4"),
            phomemo,
        )
        val wide = DriverTestPage.technicalLines(m02pro, DriverOptions(widthBytes = 78, speed = 2, densityOverride = 10))
        assertEquals(listOf("phomemo-m02pro", "624 DOTS, 300 DPI, 52.8 MM", "DENSITY 10/15, SPEED 2", "ROW 78 B, FEED 4"), wide)
        val escPos = DriverTestPage.technicalLines(escpos58, DriverOptions(heatLevel = 2, cut = true))
        assertEquals(
            listOf("escpos-58", "384 DOTS, 203 DPI, 48.0 MM", "HEAT 2/4, BAND 24", "FEED 4, CUT ON"),
            escPos,
        )
        // nessuna riga va a capo a 384 punti x2 (30 caratteri)
        for (driver in PrinterDrivers.all) {
            for (line in DriverTestPage.technicalLines(driver, DriverOptions(widthBytes = 78, speed = 255, densityOverride = 15))) {
                assertTrue(line, line.length <= 30)
            }
        }
    }

    // ---- font bitmap ----

    @Test
    fun glyphIsTheClassicFiveBySeven() {
        assertEquals(
            listOf(".###.", "#...#", "#...#", "#...#", "#####", "#...#", "#...#"),
            art(BitmapFont.render("A")),
        )
        assertEquals(
            listOf("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
            art(BitmapFont.render("T")),
        )
    }

    @Test
    fun scaleEnlargesEveryDot() {
        val img = BitmapFont.render("I", 2)
        assertEquals(10, img.width)
        assertEquals(14, img.height)
        // riga 0 del glifo ".###." e riga 1 "..#..", ogni punto diventa 2x2
        assertTrue(img[2, 0])
        assertTrue(img[7, 1])
        assertFalse(img[0, 0])
        assertFalse(img[8, 0])
        assertTrue(img[4, 2])
        assertTrue(img[5, 3])
        assertFalse(img[2, 2])
    }

    @Test
    fun metricsCountTheSpacing() {
        assertEquals(11, BitmapFont.textWidth("AB"))
        assertEquals(33, BitmapFont.textWidth("AB", 3))
        assertEquals(0, BitmapFont.textWidth(""))
        assertEquals(12, BitmapFont.advance(2))
        assertEquals(21, BitmapFont.lineHeight(3))
        assertEquals(11, BitmapFont.render("AB").width)
    }

    @Test
    fun normalizeStripsAccentsAndReplacesTheRest() {
        assertEquals("Perche e cosi", BitmapFont.normalize("Perché è così"))
        assertEquals("a b c", BitmapFont.normalize("a\tb\nc"))
        assertEquals("?", BitmapFont.normalize("日"))
        assertEquals("\"ok\" - 3...", BitmapFont.normalize("“ok” – 3…"))
        assertArrayEquals(BitmapFont.render("?").data, BitmapFont.render("Ж").data)
    }

    @Test
    fun everyPrintableGlyphHasInk() {
        for (c in '!'..'~') {
            var ink = false
            for (col in 0 until BitmapFont.GLYPH_WIDTH) for (row in 0 until BitmapFont.GLYPH_HEIGHT) ink = ink || BitmapFont.pixel(c, col, row)
            assertTrue("glifo vuoto per '$c'", ink)
        }
        assertEquals(0, BitmapFont.render(" ").countBlack())
        assertFalse(BitmapFont.pixel('A', 5, 0))
        assertFalse(BitmapFont.pixel('A', 0, 7))
    }

    @Test
    fun wrapBreaksOnWordsAndSplitsLongWords() {
        val four = BitmapFont.textWidth("AAAA")
        assertEquals(listOf("AAAA", "BBBB"), BitmapFont.wrap("AAAA BBBB", four))
        assertEquals(listOf("AAAA", "AAAA", "AA"), BitmapFont.wrap("AAAAAAAAAA", four))
        assertEquals(listOf("AB CD"), BitmapFont.wrap("AB  CD", 100))
        assertEquals(listOf("A", "B"), BitmapFont.wrap("A\nB", 100))
        assertEquals(listOf("A", "B"), BitmapFont.wrap("AB", 1))
    }

    @Test
    fun drawClipsAtTheEdges() {
        val small = BitImage(3, 3)
        BitmapFont.draw(small, "A", -2, -2, 1)
        BitmapFont.draw(small, "W", 2, 2, 3)
        assertTrue(small.countBlack() > 0)
    }
}
