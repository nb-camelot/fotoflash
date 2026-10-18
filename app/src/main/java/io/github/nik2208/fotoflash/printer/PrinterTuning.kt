package io.github.nik2208.fotoflash.printer

import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.thermal.DriverOptions
import io.github.nik2208.fotoflash.thermal.EscPosDriver
import io.github.nik2208.fotoflash.thermal.HeatSettings
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.PhomemoEncoder
import io.github.nik2208.fotoflash.thermal.PrinterDriver
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.PrinterLink
import io.github.nik2208.fotoflash.thermal.TransportHints
import kotlin.math.abs

/**
 * Taratura della trasmissione e della testina: intervalli ammessi, valori consigliati e
 * tempi. I default coincidono con quelli di AppSettings, cosi "Ripristina" torna lo stato di fabbrica.
 */
object PrinterTuning {

    // Intensita (riscaldamento testina), vedi heatFor()
    const val HEAT_LEVEL_MIN = 0
    const val HEAT_LEVEL_MAX = 4
    const val HEAT_LEVEL_DEFAULT = 0

    // Avanzamento carta dopo la stampa, in righe di testo
    const val FEED_LINES_MIN = 0
    const val FEED_LINES_MAX = 10
    const val FEED_LINES_DEFAULT = 4

    // Byte per singola scrittura sul socket
    const val CHUNK_SIZE_MIN = 64
    const val CHUNK_SIZE_MAX = 1024
    const val CHUNK_SIZE_DEFAULT = 256

    /** Valori proposti dallo slider: le stampanti economiche ragionano in potenze di due. */
    val CHUNK_SIZE_STEPS: List<Int> = listOf(64, 128, 192, 256, 384, 512, 768, 1024)

    // Pausa tra due blocchi, in millisecondi
    const val CHUNK_DELAY_MIN = 0
    const val CHUNK_DELAY_MAX = 60
    const val CHUNK_DELAY_DEFAULT = 15
    const val CHUNK_DELAY_STEP = 5

    // Righe per comando raster GS v 0
    const val BAND_HEIGHT_MIN = 8
    const val BAND_HEIGHT_MAX = 255
    const val BAND_HEIGHT_DEFAULT = 24
    val BAND_HEIGHT_STEPS: List<Int> = listOf(8, 16, 24, 32, 48, 64, 96, 128, 192, 255)

    /** Copie per lavoro: un limite evita rotoli interi per un tocco di troppo. */
    const val COPIES_MAX = 10

    /** Tempo massimo per aprire il socket, tutti i tentativi compresi. */
    const val CONNECT_TIMEOUT_MS = 10_000L

    /**
     * BLE: collegamento, scoperta dei servizi e MTU nello stesso budget. Piu largo dell'SPP perche
     * una stampante appena accesa puo metterci qualche secondo a farsi trovare.
     */
    const val BLE_CONNECT_TIMEOUT_MS = 15_000L

    /** Ricerca BLE: durata predefinita di una scansione avviata con «Cerca». */
    const val BLE_SCAN_TIMEOUT_MS = 10_000L

    /** La connessione resta aperta tra stampe vicine, poi si libera la stampante. */
    const val IDLE_DISCONNECT_MS = 45_000L

    /** Se un blocco resta fermo piu di cosi, la stampante non sta piu leggendo. */
    const val WRITE_STALL_MS = 10_000L

    /** Velocita prudente con cui la stampante svuota il buffer (stampa + buffer Bluetooth). */
    const val DRAIN_BYTES_PER_SECOND = 8 * 1024
    const val DRAIN_MIN_MS = 300L
    const val DRAIN_MAX_MS = 4_000L

    /**
     * Livello di intensita (0..4) → comando ESC 7; null = nessun comando (default della stampante).
     * La tabella sta nel driver ESC/POS del core, unica fonte condivisa con la PWA: qui si delega,
     * cosi pagina di prova e stampe non possono divergere.
     */
    fun heatFor(level: Int): HeatSettings? = EscPosDriver.heatFor(clampHeatLevel(level))

    fun clampHeatLevel(value: Int): Int = value.coerceIn(HEAT_LEVEL_MIN, HEAT_LEVEL_MAX)

    /** Nome del livello di intensita, condiviso da schermata e pagina di prova. */
    fun heatLevelLabel(level: Int): Int = when (clampHeatLevel(level)) {
        1 -> R.string.prn_heat_level_1
        2 -> R.string.prn_heat_level_2
        3 -> R.string.prn_heat_level_3
        4 -> R.string.prn_heat_level_4
        else -> R.string.prn_heat_level_0
    }

    fun clampFeedLines(value: Int): Int = value.coerceIn(FEED_LINES_MIN, FEED_LINES_MAX)

    fun clampChunkSize(value: Int): Int = value.coerceIn(CHUNK_SIZE_MIN, CHUNK_SIZE_MAX)

    fun clampChunkDelay(value: Int): Int = value.coerceIn(CHUNK_DELAY_MIN, CHUNK_DELAY_MAX)

    fun clampBandHeight(value: Int): Int = value.coerceIn(BAND_HEIGHT_MIN, BAND_HEIGHT_MAX)

    /**
     * Attesa prima di chiudere il socket dopo un lavoro di [bytes] byte: flush() non garantisce
     * che i dati siano arrivati, e chiudere subito puo troncare la coda (avanzamento, taglio).
     */
    fun drainMillis(bytes: Long): Long {
        if (bytes <= 0L) return DRAIN_MIN_MS
        return (bytes * 1000L / DRAIN_BYTES_PER_SECOND).coerceIn(DRAIN_MIN_MS, DRAIN_MAX_MS)
    }

    /** Velocita massima teorica in KB/s con questi parametri, null se senza pausa (illimitata). */
    fun maxThroughputKbPerSecond(chunkSize: Int, chunkDelayMs: Int): Int? {
        if (chunkDelayMs <= 0) return null
        val bytesPerSecond = clampChunkSize(chunkSize).toLong() * 1000L / chunkDelayMs
        return (bytesPerSecond / 1024L).toInt().coerceAtLeast(1)
    }

    // ---------------------------------------------------------------------------------------
    // Driver (docs/DRIVERS.md)

    const val DRIVER_ESCPOS_58 = "escpos-58"
    const val DRIVER_ESCPOS_80 = "escpos-80"
    const val DRIVER_PHOMEMO_M02 = "phomemo-m02"
    const val DRIVER_PHOMEMO_M02PRO = "phomemo-m02pro"

    /** I driver ESC/POS hanno carta 58/80, intensita ESC 7, bande e taglio; gli altri no. */
    fun isEscPos(driver: PrinterDriver): Boolean = driver.id.startsWith("escpos")

    fun isPhomemo(driver: PrinterDriver): Boolean = driver.id.startsWith("phomemo")

    /** Solo la M02 Pro ha una larghezza di riga da scegliere (72 o 78 byte). */
    fun hasWidthChoice(driver: PrinterDriver): Boolean = driver.id == DRIVER_PHOMEMO_M02PRO

    /** Nome del driver per la schermata (displayName del core per un driver sconosciuto all'app). */
    fun driverNameRes(driver: PrinterDriver): Int? = when (driver.id) {
        DRIVER_ESCPOS_58 -> R.string.prn_driver_escpos_58
        DRIVER_ESCPOS_80 -> R.string.prn_driver_escpos_80
        DRIVER_PHOMEMO_M02 -> R.string.prn_driver_phomemo_m02
        DRIVER_PHOMEMO_M02PRO -> R.string.prn_driver_phomemo_m02pro
        else -> null
    }

    /** Riga di descrizione del driver: quali stampanti copre. */
    fun driverDescriptionRes(driver: PrinterDriver): Int? = when (driver.id) {
        DRIVER_ESCPOS_58 -> R.string.prn_driver_escpos_58_desc
        DRIVER_ESCPOS_80 -> R.string.prn_driver_escpos_80_desc
        DRIVER_PHOMEMO_M02 -> R.string.prn_driver_phomemo_m02_desc
        DRIVER_PHOMEMO_M02PRO -> R.string.prn_driver_phomemo_m02pro_desc
        else -> null
    }

    /** Collegamenti supportati, in parole. */
    fun driverLinksRes(driver: PrinterDriver): Int = when {
        PrinterLink.CLASSIC in driver.links && PrinterLink.BLE in driver.links -> R.string.prn_link_classic_or_ble
        PrinterLink.BLE in driver.links -> R.string.prn_link_ble_only
        else -> R.string.prn_link_classic_only
    }

    /** Il driver ESC/POS di una larghezza di carta (58 o 80 mm); null per le carte di altri driver. */
    fun escPosDriverFor(paper: PaperWidth): String? = when (paper) {
        PaperWidth.MM58 -> DRIVER_ESCPOS_58
        PaperWidth.MM80 -> DRIVER_ESCPOS_80
        else -> null
    }

    /** Tempo massimo di collegamento per il tipo di collegamento (serve anche al messaggio d'errore). */
    fun connectTimeoutMs(link: PrinterLink): Long =
        if (link == PrinterLink.BLE) BLE_CONNECT_TIMEOUT_MS else CONNECT_TIMEOUT_MS

    /**
     * La Phomemo M02X usa un protocollo diverso e incompatibile: PrinterDrivers.guess() la scarta
     * (come un nome sconosciuto), e qui la si riconosce per dirlo all'utente invece di tacere.
     * Le regole sui nomi sono quelle del core, le stesse della PWA.
     */
    fun isUnsupportedModel(name: String?): Boolean = PrinterDrivers.isUnsupported(name)

    /**
     * Opzioni del lavoro per il driver, dalle impostazioni (con gli stessi limiti della schermata).
     * Densita e larghezza Phomemo passano sempre: i driver ESC/POS le ignorano, e la M02 (48 byte)
     * scarta da sola una larghezza che non le appartiene.
     */
    fun driverOptions(s: AppSettings): DriverOptions = DriverOptions(
        feedLines = clampFeedLines(s.feedLines),
        cut = s.cutPaper,
        heatLevel = clampHeatLevel(s.heatLevel),
        bandHeight = clampBandHeight(s.bandHeight),
        speed = s.printerSpeed?.let { clampSpeed(it) },
        densityOverride = s.phomemoDensity?.let { clampPhomemoDensity(it) },
        widthBytes = s.phomemoWidthBytes,
    )

    // Phomemo: densita 1F 11 02 dd
    const val PHOMEMO_DENSITY_MIN = PhomemoEncoder.DENSITY_MIN
    const val PHOMEMO_DENSITY_MAX = PhomemoEncoder.DENSITY_MAX
    const val PHOMEMO_DENSITY_DEFAULT = PhomemoEncoder.DENSITY_DEFAULT

    /** Densita usata quando non e scelta a mano: la tabella del driver (0→4, 1→2, 2→4, 3→6, 4→8). */
    fun phomemoDensityFromHeat(level: Int): Int = PhomemoEncoder.densityForHeat(clampHeatLevel(level))

    fun clampPhomemoDensity(value: Int): Int = value.coerceIn(PHOMEMO_DENSITY_MIN, PHOMEMO_DENSITY_MAX)

    /** Densita effettiva: quella scelta a mano o quella che discende dall'intensita. */
    fun effectivePhomemoDensity(s: AppSettings): Int =
        s.phomemoDensity?.let { clampPhomemoDensity(it) } ?: phomemoDensityFromHeat(s.heatLevel)

    /** Byte per riga ammessi dalla M02 Pro: 72 (576 punti) o 78 (624 punti, alcune unita). */
    val PHOMEMO_WIDTH_BYTES: List<Int> = listOf(72, 78)
    const val PHOMEMO_WIDTH_BYTES_DEFAULT = 72

    // Velocita sperimentale (ESC N 0D ss, comando delle M110 non verificato sulla M02 Pro)
    const val SPEED_MIN = 1
    const val SPEED_MAX = 5
    const val SPEED_DEFAULT = 3

    fun clampSpeed(value: Int): Int = value.coerceIn(SPEED_MIN, SPEED_MAX)

    // ---------------------------------------------------------------------------------------
    // Invio BLE

    /** Limiti dei pezzi BLE: 20 e il carico utile con l'MTU minimo, 512 il massimo di un attributo. */
    const val BLE_CHUNK_MIN = 20
    const val BLE_CHUNK_MAX = 512
    const val BLE_DELAY_MIN = 0
    const val BLE_DELAY_MAX = 100

    fun clampBleChunk(value: Int): Int = value.coerceIn(BLE_CHUNK_MIN, BLE_CHUNK_MAX)

    fun clampBleDelay(value: Int): Int = value.coerceIn(BLE_DELAY_MIN, BLE_DELAY_MAX)

    /**
     * Preset di invio BLE proposti dalla schermata. DRIVER = nessuna scelta a mano (tre null nelle
     * impostazioni): valgono i predefiniti del driver, che cambiano con il driver.
     */
    enum class BlePreset(val chunkSize: Int?, val chunkDelayMs: Int?, val withoutResponse: Boolean?) {
        DRIVER(null, null, null),
        SAFE(20, 15, true),
        FAST(60, 20, true),
        MAX(128, 20, true),
        CONFIRMED(100, 0, false),
    }

    /** Preset corrispondente alle impostazioni; null se i valori non sono quelli di un preset. */
    fun blePresetOf(s: AppSettings): BlePreset? = BlePreset.entries.firstOrNull {
        it.chunkSize == s.bleChunkSize && it.chunkDelayMs == s.bleChunkDelayMs && it.withoutResponse == s.bleWithoutResponse
    }

    /** Come spedire i byte in BLE: i predefiniti del driver, sovrascritti dalle scelte dell'utente. */
    fun bleHints(driver: PrinterDriver, s: AppSettings): TransportHints {
        val base = driver.defaultTransport
        return base.copy(
            chunkSize = clampBleChunk(s.bleChunkSize ?: base.chunkSize),
            chunkDelayMs = clampBleDelay(s.bleChunkDelayMs ?: base.chunkDelayMs),
            withoutResponse = s.bleWithoutResponse ?: base.withoutResponse,
        )
    }

    /** Indice del valore di [steps] piu vicino a [value], per posizionare gli slider a gradini. */
    fun nearestIndex(steps: List<Int>, value: Int): Int {
        var best = 0
        var bestDistance = Int.MAX_VALUE
        steps.forEachIndexed { index, step ->
            val distance = abs(step - value)
            if (distance < bestDistance) {
                best = index
                bestDistance = distance
            }
        }
        return best
    }
}
