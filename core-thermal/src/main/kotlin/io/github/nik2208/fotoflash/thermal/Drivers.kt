package io.github.nik2208.fotoflash.thermal

/*
 * Driver di stampa intercambiabili. Il contratto e docs/DRIVERS.md: il driver riceve la stampa gia
 * composta (BitImage) e restituisce i byte da inviare, piu i parametri di trasporto. Il resto
 * dell'app non sa con quale stampante sta parlando. La PWA ha gli stessi driver in JS
 * (web/src/printer/drivers/) e i due lati devono produrre GLI STESSI BYTE: lo verifica
 * DriversGoldenTest con web/tests/fixtures/drivers-golden.json.
 *
 * Aggiunte compatibili rispetto all'interfaccia di docs/DRIVERS.md (nessuna firma cambia):
 * - DriverOptions.densityOverride e DriverOptions.widthBytes, in coda e con default null: sono
 *   phomemoDensity e phomemoWidthBytes delle impostazioni. I driver ESC/POS le ignorano.
 * - EscPosDriver.heatFor(level): la tabella ESC 7 dell'intensita. E LA fonte: PrinterTuning.heatFor
 *   dell'app deve delegare qui, e la PWA la riporta con gli stessi valori.
 * - PrinterDrivers.DEFAULT_ID, ids, isUnsupported(name) (la M02X si riconosce ma non ha driver),
 *   bleServices (i servizi di tutti i profili, per i filtri della ricerca BLE).
 * - PrinterDriver.rasterWidth(options), testPageImage(options, labels), encodeTestPage(options, labels)
 *   e TestPageLabels: la pagina di prova raster, con testi che l'app puo localizzare.
 * - BleProfiles (profili GATT noti) e PhomemoEncoder (il protocollo Phomemo, scritto una volta sola).
 */

/** Profilo GATT di un canale di stampa BLE: UUID a 128 bit, minuscoli. */
data class BleProfile(val name: String, val service: String, val write: String, val notify: String? = null)

/** Come vanno spediti i byte: pezzi, pause, scrittura con o senza conferma. */
data class TransportHints(
    /** Byte per scrittura; su Android il pezzo vero e min(chunkSize, mtu - 3). */
    val chunkSize: Int,
    /** Pausa tra due scritture, in ms. */
    val chunkDelayMs: Int,
    /** true = scrittura senza conferma (WRITE_TYPE_NO_RESPONSE, writeValueWithoutResponse). */
    val withoutResponse: Boolean,
    /** Attesa prima di chiudere, per lasciar svuotare il buffer della stampante. */
    val finalDelayMs: Int = 300,
)

/** Opzioni del lavoro, comuni a tutti i driver; ciascun driver ignora quelle che non usa. */
data class DriverOptions(
    /** Righe di avanzamento dopo la stampa (ESC d n, 0..255). */
    val feedLines: Int = 4,
    /** Taglio carta: solo ESC/POS con taglierina. */
    val cut: Boolean = false,
    /** 0 = predefinito della stampante, 1..4 piu scuro (ESC 7 per ESC/POS, densita per Phomemo). */
    val heatLevel: Int = 0,
    /** Righe per banda GS v 0 (solo ESC/POS: i Phomemo usano blocchi da 255 righe). */
    val bandHeight: Int = 24,
    /** Velocita di stampa dove il protocollo la prevede (sperimentale); null = non inviata. */
    val speed: Int? = null,
    /** Phomemo: densita 1..15 che vince su [heatLevel]; null = dalla tabella di [heatLevel]. */
    val densityOverride: Int? = null,
    /** Phomemo M02 Pro: byte per riga (72 o 78); null o valori non ammessi = predefinito del driver. */
    val widthBytes: Int? = null,
)

/** Un driver: una famiglia di stampanti, con il suo protocollo e il suo trasporto. */
interface PrinterDriver {
    val id: String
    val displayName: String

    /** Carta e impaginazione: punti per riga (MM58, MM80, M02PRO). */
    val paper: PaperWidth
    val dpi: Int

    /** Trasporti supportati. */
    val links: Set<PrinterLink>

    /** Profili GATT in ordine di preferenza. */
    val bleProfiles: List<BleProfile>
    val defaultDither: DitherAlgorithm
    val defaultTransport: TransportHints

    /** Riconoscimento automatico dal nome annunciato. */
    fun matchesName(name: String?): Boolean

    /** Pacchetti in ordine di invio; l'immagine viene centrata o ritagliata sulla larghezza del driver. */
    fun encode(image: BitImage, options: DriverOptions): List<ByteArray>

    /** Pagina di prova raster gia codificata (vedi [testPageImage]). */
    fun testPage(options: DriverOptions): List<ByteArray>
}

/** Ingresso generico da un'immagine in grigio: retino (del driver, se non indicato) e poi [PrinterDriver.encode]. */
fun PrinterDriver.encodeGray(
    image: GrayImage,
    options: DriverOptions,
    dither: DitherAlgorithm = defaultDither,
): List<ByteArray> = encode(Ditherer.dither(image, dither), options)

/**
 * Larghezza in punti del raster che il driver manda davvero con queste opzioni: [PaperWidth.dots],
 * tranne la M02 Pro con 78 byte per riga (624 punti). Serve per pagine di prova e anteprime.
 */
fun PrinterDriver.rasterWidth(options: DriverOptions = DriverOptions()): Int = when (this) {
    is PhomemoDriver -> widthBytesFor(options) * 8
    else -> paper.dots
}

/** Pagina di prova raster del driver, larga [rasterWidth]: si puo mostrare in anteprima prima di stamparla. */
fun PrinterDriver.testPageImage(options: DriverOptions, labels: TestPageLabels = TestPageLabels()): BitImage =
    DriverTestPage.render(this, options, labels)

/** Pagina di prova codificata con testi scelti dall'app (per esempio localizzati). */
fun PrinterDriver.encodeTestPage(options: DriverOptions, labels: TestPageLabels = TestPageLabels()): List<ByteArray> =
    encode(testPageImage(options, labels), options)

/** Profili GATT noti. */
object BleProfiles {

    /**
     * Stampanti ESC/POS: gli stessi profili del bridge (web/src/printer/ble.js), nello stesso ordine.
     * Il primo e quello della "BlueTooth Printer" su cui la strategia e stata provata.
     */
    val ESC_POS: List<BleProfile> = listOf(
        BleProfile("18F0", "000018f0-0000-1000-8000-00805f9b34fb", "00002af1-0000-1000-8000-00805f9b34fb"),
        BleProfile("E7810A71", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"),
        BleProfile("ISSC", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "49535343-8841-43f4-a8d4-ecbe34729bb3"),
        BleProfile("FF00", "0000ff00-0000-1000-8000-00805f9b34fb", "0000ff02-0000-1000-8000-00805f9b34fb"),
        BleProfile("FFE0", "0000ffe0-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb"),
        BleProfile("Nordic UART", "6e400001-b5a3-f393-e0a9-e50e24dcca9e", "6e400002-b5a3-f393-e0a9-e50e24dcca9e"),
    )

    /** Phomemo M02 / M02 Pro: servizio FF00, scrittura FF02, notifiche (stato) FF03. Stesso nome della PWA. */
    val PHOMEMO: BleProfile = BleProfile(
        "FF00",
        "0000ff00-0000-1000-8000-00805f9b34fb",
        "0000ff02-0000-1000-8000-00805f9b34fb",
        "0000ff03-0000-1000-8000-00805f9b34fb",
    )
}

/**
 * ESC/POS da 58 o 80 mm: il lavoro e quello di sempre, [ThermalJob.build] (init, ESC 7 se c'e
 * l'intensita, bande GS v 0, avanzamento, taglio). Sul BLE il predefinito e la strategia del
 * bridge provata sulla stampante vera: scrittura con conferma a pezzi da 100 byte.
 */
class EscPosDriver internal constructor(
    override val id: String,
    override val displayName: String,
    override val paper: PaperWidth,
    /** Solo la 58 mm si riconosce dal nome: dal nome annunciato non si capisce la larghezza. */
    private val recognizedByName: Boolean,
) : PrinterDriver {

    override val dpi: Int
        get() = paper.dpi

    override val links: Set<PrinterLink> = setOf(PrinterLink.CLASSIC, PrinterLink.BLE)

    override val bleProfiles: List<BleProfile> = BleProfiles.ESC_POS

    override val defaultDither: DitherAlgorithm = DitherAlgorithm.ATKINSON

    override val defaultTransport: TransportHints =
        TransportHints(chunkSize = 100, chunkDelayMs = 0, withoutResponse = false)

    /** Nomi ESC/POS tipici; la 80 mm non risponde mai, come nella PWA ([PrinterDrivers.guess] sceglie la 58). */
    override fun matchesName(name: String?): Boolean =
        recognizedByName && DriverNames.classify(name) == DriverNames.Family.ESC_POS

    /** Le opzioni del driver tradotte per [ThermalJob]. */
    fun jobOptions(options: DriverOptions): PrintJobOptions = PrintJobOptions(
        bandHeight = options.bandHeight,
        feedLinesAfter = options.feedLines,
        cut = options.cut,
        heat = heatFor(options.heatLevel),
    )

    override fun encode(image: BitImage, options: DriverOptions): List<ByteArray> =
        ThermalJob.build(image.centeredOn(paper.dots), jobOptions(options))

    override fun testPage(options: DriverOptions): List<ByteArray> = encodeTestPage(options)

    override fun toString(): String = id

    companion object {
        const val HEAT_LEVEL_MIN = 0
        const val HEAT_LEVEL_MAX = 4

        /**
         * Livello di intensita (0..4) -> comando ESC 7. 0 = non inviare nulla e lasciare il default
         * della stampante (alcuni cloni reagiscono male a ESC 7). Salendo cresce soprattutto il tempo
         * di riscaldamento, che e cio che scurisce i punti. Fonte unica della tabella: l'app
         * (PrinterTuning.heatFor) deve usare questa, la PWA la riporta identica.
         */
        fun heatFor(level: Int): HeatSettings? = when (level.coerceIn(HEAT_LEVEL_MIN, HEAT_LEVEL_MAX)) {
            1 -> HeatSettings(maxDots = 7, heatTime = 60, heatInterval = 2)
            2 -> HeatSettings(maxDots = 8, heatTime = 80, heatInterval = 2)
            3 -> HeatSettings(maxDots = 10, heatTime = 110, heatInterval = 2)
            4 -> HeatSettings(maxDots = 11, heatTime = 140, heatInterval = 2)
            else -> null
        }
    }
}

/**
 * Phomemo M02 e M02 Pro: stesso protocollo ([PhomemoEncoder]), cambiano larghezza e risoluzione.
 * Solo BLE, scrittura senza conferma; il predefinito sicuro e 20 byte con 15 ms di pausa.
 */
class PhomemoDriver internal constructor(
    override val id: String,
    override val displayName: String,
    override val paper: PaperWidth,
    /** Byte per riga ammessi; il primo e il predefinito. */
    val allowedWidthBytes: List<Int>,
    private val nameMatcher: (String?) -> Boolean,
) : PrinterDriver {

    init {
        require(allowedWidthBytes.isNotEmpty()) { "serve almeno una larghezza" }
    }

    /** Byte per riga predefiniti: 48 (M02, 384 punti) o 72 (M02 Pro, 576 punti). */
    val defaultWidthBytes: Int
        get() = allowedWidthBytes.first()

    override val dpi: Int
        get() = paper.dpi

    override val links: Set<PrinterLink> = setOf(PrinterLink.BLE)

    override val bleProfiles: List<BleProfile> = listOf(BleProfiles.PHOMEMO)

    override val defaultDither: DitherAlgorithm = DitherAlgorithm.FLOYD_STEINBERG

    override val defaultTransport: TransportHints =
        TransportHints(chunkSize = 20, chunkDelayMs = 15, withoutResponse = true)

    override fun matchesName(name: String?): Boolean = nameMatcher(name)

    /** Byte per riga per queste opzioni: [DriverOptions.widthBytes] se ammesso, altrimenti il predefinito. */
    fun widthBytesFor(options: DriverOptions): Int =
        options.widthBytes?.takeIf { it in allowedWidthBytes } ?: defaultWidthBytes

    /** Densita 1..15 per queste opzioni: [DriverOptions.densityOverride] o la tabella di [DriverOptions.heatLevel]. */
    fun densityFor(options: DriverOptions): Int = PhomemoEncoder.density(options.heatLevel, options.densityOverride)

    override fun encode(image: BitImage, options: DriverOptions): List<ByteArray> = PhomemoEncoder.encode(
        image = image,
        widthBytes = widthBytesFor(options),
        density = densityFor(options),
        speed = options.speed,
        feedLines = options.feedLines,
    )

    override fun testPage(options: DriverOptions): List<ByteArray> = encodeTestPage(options)

    override fun toString(): String = id
}

/**
 * Protocollo Phomemo (M02, M02 Pro, M02S), ricostruito per reverse engineering: non esiste una
 * documentazione ufficiale. La tabella dei byte di docs/DRIVERS.md si segue alla lettera: un
 * pacchetto per comando, nell'ordine della tabella. Fonti (ogni costante ne ha almeno due):
 * - ryo-endo/phomemo-printer: M02 Pro via BLE, 576 punti, init `1B 40` + `1F 11 02 04`, `GS v 0`;
 * - vivier/phomemo-tools: M02, blocchi da al massimo 255 righe, chiusura `1F 11 08/0E/07/09`;
 * - theacodes/phomemo_m02s: M02S a 300 dpi, 576 punti al massimo, comandi di stato `1F 11`;
 * - phomymo (transcriptionstream): Web Bluetooth, FF00/FF02/FF03, scrittura senza conferma, densita.
 * La velocita `1B 4E 0D` ha una sola fonte (M110): resta spenta finche [encode] non riceve speed.
 */
object PhomemoEncoder {

    /** Righe massime per blocco GS v 0: l'altezza sta in un byte. */
    const val MAX_BLOCK_ROWS = 255

    const val DENSITY_MIN = 1
    const val DENSITY_MAX = 15
    const val DENSITY_DEFAULT = 4

    /** Interrogazioni di stato in chiusura, come l'app ufficiale: energia, timer, firmware, batteria. */
    private val STATUS_QUERIES = intArrayOf(0x08, 0x0E, 0x07, 0x09)

    /** Densita dal livello di intensita dell'app: 0 -> 4 (predefinito), 1 -> 2, 2 -> 4, 3 -> 6, 4 -> 8. */
    fun densityForHeat(heatLevel: Int): Int = when (heatLevel.coerceIn(0, 4)) {
        1 -> 2
        3 -> 6
        4 -> 8
        else -> DENSITY_DEFAULT
    }

    /** Densita effettiva: [override] (riportata in 1..15) se c'e, altrimenti quella di [heatLevel]. */
    fun density(heatLevel: Int, override: Int? = null): Int =
        override?.coerceIn(DENSITY_MIN, DENSITY_MAX) ?: densityForHeat(heatLevel)

    /**
     * Pacchetti in ordine di invio (tabella di docs/DRIVERS.md):
     * 1. `1B 40` (ESC @);
     * 2. `1B 61 01` (centro);
     * 3. `1F 11 02 dd`, densita 1..15;
     * 4. `1B 4E 0D ss` SOLO se [speed] non e null (comando delle M110, non verificato sulla M02 Pro);
     * 5. un blocco `1D 76 30 00 wL wH hh 00` + righe per ogni gruppo di al massimo 255 righe;
     * 6. `1B 64 nn` con nn = [feedLines] (0..255), poi `1B 64 02`;
     * 7. `1F 11 08`, `1F 11 0E`, `1F 11 07`, `1F 11 09`.
     *
     * L'immagine viene centrata (o ritagliata al centro) su [widthBytes] x 8 punti, cosi ogni
     * riga e lunga esattamente [widthBytes] byte, MSB a sinistra e 1 = nero.
     */
    fun encode(
        image: BitImage,
        widthBytes: Int,
        density: Int = DENSITY_DEFAULT,
        speed: Int? = null,
        feedLines: Int = 4,
    ): List<ByteArray> {
        require(widthBytes in 1..0xFFFF) { "larghezza non valida: $widthBytes byte per riga" }
        val raster = image.centeredOn(widthBytes * 8)
        val packets = ArrayList<ByteArray>(raster.height / MAX_BLOCK_ROWS + 12)

        packets.add(command(0x1B, 0x40))
        packets.add(command(0x1B, 0x61, 0x01))
        packets.add(command(0x1F, 0x11, 0x02, density.coerceIn(DENSITY_MIN, DENSITY_MAX)))
        if (speed != null) packets.add(command(0x1B, 0x4E, 0x0D, speed.coerceIn(0, 255)))

        var row = 0
        while (row < raster.height) {
            val rows = minOf(MAX_BLOCK_ROWS, raster.height - row)
            // stesso formato di GS v 0 ESC/POS: m = 0, larghezza in byte e righe little-endian
            packets.add(EscPosRaster.band(raster, row, rows))
            row += rows
        }

        // riga 6 della tabella: l'avanzamento richiesto, poi il 1B 64 02 delle app di riferimento
        packets.add(command(0x1B, 0x64, feedLines.coerceIn(0, 255)))
        packets.add(command(0x1B, 0x64, 0x02))
        for (query in STATUS_QUERIES) packets.add(command(0x1F, 0x11, query))
        return packets
    }

    private fun command(vararg bytes: Int): ByteArray = ByteArray(bytes.size) { bytes[it].toByte() }
}

/** Elenco dei driver e riconoscimento dal nome. */
object PrinterDrivers {

    /** Driver usato quando non ce n'e uno valido: la "BlueTooth Printer" / Netum da 58 mm. */
    const val DEFAULT_ID = "escpos-58"

    val ESCPOS_58: EscPosDriver = EscPosDriver("escpos-58", "ESC/POS 58 mm", PaperWidth.MM58, recognizedByName = true)

    val ESCPOS_80: EscPosDriver = EscPosDriver("escpos-80", "ESC/POS 80 mm", PaperWidth.MM80, recognizedByName = false)

    /** M02: 384 punti (48 byte) a 203 dpi, stessa impaginazione della Netum. */
    val PHOMEMO_M02: PhomemoDriver = PhomemoDriver(
        id = "phomemo-m02",
        displayName = "Phomemo M02",
        paper = PaperWidth.MM58,
        allowedWidthBytes = listOf(48),
        nameMatcher = { DriverNames.classify(it) == DriverNames.Family.PHOMEMO_M02 },
    )

    /** M02 Pro (e M02S): 576 punti (72 byte) a 300 dpi; 78 byte per le unita che stampano 624 punti. */
    val PHOMEMO_M02PRO: PhomemoDriver = PhomemoDriver(
        id = "phomemo-m02pro",
        displayName = "Phomemo M02 Pro",
        paper = PaperWidth.M02PRO,
        allowedWidthBytes = listOf(72, 78),
        nameMatcher = { DriverNames.classify(it) == DriverNames.Family.PHOMEMO_M02PRO },
    )

    /** Tutti i driver, nell'ordine in cui si mostrano. */
    val all: List<PrinterDriver> = listOf(ESCPOS_58, ESCPOS_80, PHOMEMO_M02, PHOMEMO_M02PRO)

    val ids: List<String> = all.map { it.id }

    /** UUID dei servizi di tutti i profili, senza doppioni: i filtri della ricerca BLE. */
    val bleServices: List<String> = all.flatMap { driver -> driver.bleProfiles.map { it.service } }.distinct()

    /** Driver con questo id; id sconosciuto o null -> escpos-58. */
    fun byId(id: String?): PrinterDriver {
        val key = id?.trim()
        return all.firstOrNull { it.id == key } ?: ESCPOS_58
    }

    /**
     * Driver suggerito dal nome annunciato, null se il nome non dice nulla. Prima i Phomemo, cosi
     * "M02 Printer" non finisce tra le ESC/POS; i nomi ESC/POS tipici danno escpos-58 (dal nome
     * non si capisce la larghezza). La M02X da null: protocollo diverso, vedi [isUnsupported].
     */
    fun guess(name: String?): PrinterDriver? = when (DriverNames.classify(name)) {
        DriverNames.Family.PHOMEMO_M02PRO -> PHOMEMO_M02PRO
        DriverNames.Family.PHOMEMO_M02 -> PHOMEMO_M02
        DriverNames.Family.ESC_POS -> ESCPOS_58
        DriverNames.Family.UNSUPPORTED -> null
        null -> null
    }

    /** true per le stampanti riconosciute ma senza driver (Phomemo M02X): la UI lo deve dire. */
    fun isUnsupported(name: String?): Boolean = DriverNames.classify(name) == DriverNames.Family.UNSUPPORTED
}

/**
 * Riconoscimento dai nomi annunciati, senza maiuscole e spazi ai bordi. Sono le stesse regole di
 * guessDriver nella PWA (web/src/printer/drivers/), cosi app e web suggeriscono lo stesso driver:
 * - "M02X" -> non supportata (protocollo diverso e incompatibile);
 * - "M02 Pro", "M02PRO", "M02S" -> M02 Pro;
 * - "M02" da solo o seguito da cifre o spazi -> M02;
 * - "BlueTooth Printer", oppure un nome che comincia con "Printer", "MPT", "NT-", "Netum", "POS",
 *   "MTP" -> ESC/POS.
 */
internal object DriverNames {

    enum class Family { ESC_POS, PHOMEMO_M02, PHOMEMO_M02PRO, UNSUPPORTED }

    // "M02" non deve essere la coda di un'altra sigla (es. "XM02"), da qui il lookbehind
    private val M02X = Regex("""(?<![A-Z0-9])M02\s*X""")
    private val M02PRO = Regex("""(?<![A-Z0-9])M02\s*(PRO|S)(?![A-Z])""")
    private val M02 = Regex("""(?<![A-Z0-9])M02(?=[\s\d]|$)""")
    private val ESC_POS = Regex("""^(BLUETOOTH PRINTER$|PRINTER|MPT|NT-|NETUM|POS|MTP)""")

    fun classify(name: String?): Family? {
        val n = name?.trim()?.uppercase()
        if (n.isNullOrEmpty()) return null
        return when {
            M02X.containsMatchIn(n) -> Family.UNSUPPORTED
            M02PRO.containsMatchIn(n) -> Family.PHOMEMO_M02PRO
            M02.containsMatchIn(n) -> Family.PHOMEMO_M02
            ESC_POS.containsMatchIn(n) -> Family.ESC_POS
            else -> null
        }
    }
}

/**
 * Testi della pagina di prova raster. I predefiniti sono sigle tecniche in inglese (solo ASCII,
 * come tutto cio che passa da [BitmapFont]); l'app puo passare i suoi, localizzati.
 */
data class TestPageLabels(
    val title: String = TemplateGeometry.BRAND_TEXT,
    val subtitle: String = "TEST PAGE",
    /** Righe dei parametri gia composte; null = righe tecniche del driver (id, punti, dpi, densita...). */
    val parameters: List<String>? = null,
    /** Righe aggiunte dopo i parametri (per esempio il trasporto BLE in uso, che il core non conosce). */
    val extraLines: List<String> = emptyList(),
    val widthCheck: String = "WIDTH CHECK: BOTH SIDE EDGES MUST BE ON THE PAPER",
    val ditherTitle: String = "HALFTONES, BLACK TO WHITE",
    val ditherNames: Map<DitherAlgorithm, String> = DEFAULT_DITHER_NAMES,
    /** Retino da evidenziare (quello scelto dall'utente); null = il predefinito del driver. */
    val highlight: DitherAlgorithm? = null,
    /** Aggiunto al nome del retino evidenziato. */
    val highlightSuffix: String = " *",
    val grayTitle: String = "GRAY SCALE, % BLACK",
    val blackTitle: String = "SOLID BLACK, 1-DOT LINES",
    val footer: String = "TEST PAGE COMPLETE",
) {
    companion object {
        val DEFAULT_DITHER_NAMES: Map<DitherAlgorithm, String> = mapOf(
            DitherAlgorithm.ATKINSON to "ATKINSON",
            DitherAlgorithm.FLOYD_STEINBERG to "FLOYD-STEINBERG",
            DitherAlgorithm.ORDERED_BAYER to "BAYER 8X8",
            DitherAlgorithm.THRESHOLD to "THRESHOLD",
        )
    }
}

/**
 * Pagina di prova raster, uguale per tutti i driver: "FOTOFLASH" grande, nome del driver,
 * parametri correnti, controllo della larghezza, una banda di sfumatura per ciascun retino, una
 * scala di grigi e un controllo dei neri. Tutto in punti e deterministico; le misure seguono i
 * dpi, cosi a 203 e a 300 dpi la pagina esce fisicamente simile.
 */
internal object DriverTestPage {

    /** Gradini della scala di grigi, in percentuale di nero. */
    private val GRAY_STEPS = intArrayOf(0, 20, 40, 60, 80, 100)

    fun render(driver: PrinterDriver, options: DriverOptions, labels: TestPageLabels): BitImage {
        val width = driver.rasterWidth(options)
        val dpi = driver.dpi
        // x2 a 203 dpi e x3 a 300 dpi: circa 1,7-1,8 mm di altezza in entrambi i casi
        val scale = if (dpi >= 250) 3 else 2
        val margin = mmToDots(1, dpi).coerceAtLeast(4)
        val gap = scale * 3
        val bandRows = mmToDots(5, dpi)
        val page = PageBuilder(width, margin)

        page.space(margin)
        val titleWidth = BitmapFont.textWidth(labels.title, 1)
        if (titleWidth > 0) {
            val titleScale = ((width - 2 * margin) / titleWidth).coerceIn(1, 12)
            page.text(labels.title, titleScale, TextAlign.CENTER, titleScale * 2)
        }
        page.text(labels.subtitle, scale, TextAlign.CENTER, gap)
        page.text(driver.displayName, scale, TextAlign.CENTER, gap)
        page.rule(scale, gap)

        val parameters = labels.parameters ?: technicalLines(driver, options)
        for (line in parameters + labels.extraLines) page.text(line, scale, TextAlign.START, gap)
        page.rule(scale, gap * 2)

        // Controllo larghezza: il riquadro occupa tutto il raster; se un bordo manca, la larghezza e sbagliata
        page.text(labels.widthCheck, scale, TextAlign.START, gap)
        page.piece(widthFrame(width, mmToDots(4, dpi), scale, dpi))
        page.space(gap * 2)

        // Una banda per retino: la sfumatura nero -> bianco mostra come rende ciascuno
        page.text(labels.ditherTitle, scale, TextAlign.START, gap)
        val highlight = labels.highlight ?: driver.defaultDither
        for (algorithm in DitherAlgorithm.entries) {
            val name = labels.ditherNames[algorithm] ?: algorithm.name
            page.text(if (algorithm == highlight) name + labels.highlightSuffix else name, scale, TextAlign.START, scale * 2)
            page.inset(Ditherer.dither(GrayImage.gradient(width - 2 * margin, bandRows), algorithm))
            page.space(gap * 2)
        }

        // Scala di grigi con il retino evidenziato: sei gradini dal bianco al nero pieno
        page.text(labels.grayTitle, scale, TextAlign.START, gap)
        page.piece(grayScale(width, margin, bandRows, scale, highlight))
        page.space(gap)

        // Neri pieni (densita, energia) e linee da un punto (risoluzione, testina)
        page.text(labels.blackTitle, scale, TextAlign.START, gap)
        page.piece(blackCheck(width, margin, mmToDots(3, dpi), gap))
        page.space(gap)

        page.rule(scale, gap)
        page.text(labels.footer, scale, TextAlign.CENTER, 0)
        page.space(margin)
        return page.build()
    }

    /**
     * Righe tecniche predefinite: cio che serve per capire una stampa di prova senza l'app davanti.
     * Ogni riga sta in 30 caratteri, quanti ne entrano a 384 punti x2 e a 576 punti x3: cosi non
     * va a capo a meta di un valore.
     */
    internal fun technicalLines(driver: PrinterDriver, options: DriverOptions): List<String> {
        val width = driver.rasterWidth(options)
        // larghezza stampata in decimi di mm, senza Locale: 576 punti a 300 dpi = 48.8 MM
        val tenths = (width * 254 + driver.dpi / 2) / driver.dpi
        val feed = options.feedLines.coerceIn(0, 255)
        val lines = ArrayList<String>()
        lines.add(driver.id)
        lines.add("$width DOTS, ${driver.dpi} DPI, ${tenths / 10}.${tenths % 10} MM")
        when (driver) {
            is PhomemoDriver -> {
                val speed = options.speed?.coerceIn(0, 255)?.toString() ?: "OFF"
                lines.add("DENSITY ${driver.densityFor(options)}/${PhomemoEncoder.DENSITY_MAX}, SPEED $speed")
                lines.add("ROW ${driver.widthBytesFor(options)} B, FEED $feed")
            }
            is EscPosDriver -> {
                val heat = options.heatLevel.coerceIn(EscPosDriver.HEAT_LEVEL_MIN, EscPosDriver.HEAT_LEVEL_MAX)
                val band = options.bandHeight.coerceIn(1, 255)
                lines.add("HEAT $heat/${EscPosDriver.HEAT_LEVEL_MAX}, BAND $band")
                lines.add("FEED $feed, CUT ${if (options.cut) "ON" else "OFF"}")
            }
            else -> lines.add("FEED $feed")
        }
        return lines
    }

    /** Riquadro a tutta larghezza con tacche ogni 5 mm, piu lunghe ogni 10 mm. */
    private fun widthFrame(width: Int, height: Int, border: Int, dpi: Int): BitImage {
        val frame = BitImage(width, height.coerceAtLeast(border * 2 + 2))
        val h = frame.height
        frame.fillRect(Rect(0, 0, width, border), true)
        frame.fillRect(Rect(0, h - border, width, border), true)
        frame.fillRect(Rect(0, 0, border, h), true)
        frame.fillRect(Rect(width - border, 0, border, h), true)
        val step = mmToDots(5, dpi).coerceAtLeast(4)
        var x = step
        var index = 1
        while (x < width - border) {
            val length = if (index % 2 == 0) h / 2 else h / 4
            frame.fillRect(Rect(x - 1, border, 2, length), true)
            x += step
            index++
        }
        return frame
    }

    /** Sei gradini di grigio retinati, ognuno con il suo bordo da un punto e la percentuale sotto. */
    private fun grayScale(width: Int, margin: Int, cellRows: Int, scale: Int, dither: DitherAlgorithm): BitImage {
        val cell = (width - 2 * margin) / GRAY_STEPS.size
        val labelTop = cellRows + scale * 2
        val out = BitImage(width, labelTop + BitmapFont.lineHeight(scale))
        for ((i, percent) in GRAY_STEPS.withIndex()) {
            val left = margin + i * cell
            val boxWidth = cell - 2
            if (boxWidth < 3) continue
            val gray = 255 - percent * 255 / 100
            val inner = GrayImage(boxWidth - 2, cellRows - 2, ByteArray((boxWidth - 2) * (cellRows - 2)) { gray.toByte() })
            out.blit(Ditherer.dither(inner, dither), left + 1, 1)
            // bordo: il gradino bianco altrimenti sarebbe invisibile
            out.fillRect(Rect(left, 0, boxWidth, 1), true)
            out.fillRect(Rect(left, cellRows - 1, boxWidth, 1), true)
            out.fillRect(Rect(left, 0, 1, cellRows), true)
            out.fillRect(Rect(left + boxWidth - 1, 0, 1, cellRows), true)
            val label = percent.toString()
            val labelWidth = BitmapFont.textWidth(label, scale)
            BitmapFont.draw(out, label, left + (boxWidth - labelWidth) / 2, labelTop, scale)
        }
        return out
    }

    /** Barra nera piena, poi linee verticali (a sinistra) e orizzontali (a destra) da un punto. */
    private fun blackCheck(width: Int, margin: Int, rows: Int, gap: Int): BitImage {
        val inner = width - 2 * margin
        val out = BitImage(width, rows * 2 + gap)
        out.fillRect(Rect(margin, 0, inner, rows), true)
        val top = rows + gap
        val half = inner / 2
        for (y in top until top + rows) {
            for (x in margin until margin + inner) {
                val black = if (x < margin + half) (x - margin) % 2 == 0 else (y - top) % 2 == 0
                if (black) out[x, y] = true
            }
        }
        return out
    }

    /** Millimetri -> punti alla risoluzione [dpi], arrotondati. */
    private fun mmToDots(mm: Int, dpi: Int): Int = (mm * dpi * 10 + 127) / 254
}

/** Compone la pagina a strisce larghe quanto il raster, poi le impila in un'unica BitImage. */
private class PageBuilder(private val width: Int, private val margin: Int) {

    private val pieces = ArrayList<BitImage>()

    fun space(rows: Int) {
        if (rows > 0) pieces.add(BitImage(width, rows))
    }

    /** Una striscia gia pronta; se ha un'altra larghezza viene centrata. */
    fun piece(image: BitImage) {
        pieces.add(image.centeredOn(width))
    }

    /** Un'immagine con il margine sinistro della pagina. */
    fun inset(image: BitImage) {
        val out = BitImage(width, image.height)
        out.blit(image, margin, 0)
        pieces.add(out)
    }

    /** Testo a capo per parole entro i margini, con [gap] righe vuote sotto ogni riga. */
    fun text(text: String, scale: Int, align: TextAlign, gap: Int) {
        for (line in BitmapFont.wrap(text, width - 2 * margin, scale)) {
            val out = BitImage(width, BitmapFont.lineHeight(scale) + gap.coerceAtLeast(0))
            val lineWidth = BitmapFont.textWidth(line, scale)
            val left = when (align) {
                TextAlign.START -> margin
                TextAlign.CENTER -> (width - lineWidth) / 2
                TextAlign.END -> width - margin - lineWidth
            }
            BitmapFont.draw(out, line, left, 0, scale)
            pieces.add(out)
        }
    }

    /** Filetto orizzontale tra i margini. */
    fun rule(thickness: Int, gap: Int) {
        val out = BitImage(width, thickness + gap.coerceAtLeast(0))
        out.fillRect(Rect(margin, 0, width - 2 * margin, thickness), true)
        pieces.add(out)
    }

    /** Le strisce hanno tutte la stessa larghezza, quindi le righe impacchettate si accodano cosi come sono. */
    fun build(): BitImage {
        val out = BitImage(width, pieces.sumOf { it.height }.coerceAtLeast(1))
        var offset = 0
        for (piece in pieces) {
            piece.data.copyInto(out.data, offset)
            offset += piece.data.size
        }
        return out
    }
}
