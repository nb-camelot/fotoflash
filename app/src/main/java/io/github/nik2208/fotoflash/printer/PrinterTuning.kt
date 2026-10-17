package io.github.nik2208.fotoflash.printer

import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.thermal.HeatSettings
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

    /** La connessione resta aperta tra stampe vicine, poi si libera la stampante. */
    const val IDLE_DISCONNECT_MS = 45_000L

    /** Se un blocco resta fermo piu di cosi, la stampante non sta piu leggendo. */
    const val WRITE_STALL_MS = 10_000L

    /** Velocita prudente con cui la stampante svuota il buffer (stampa + buffer Bluetooth). */
    const val DRAIN_BYTES_PER_SECOND = 8 * 1024
    const val DRAIN_MIN_MS = 300L
    const val DRAIN_MAX_MS = 4_000L

    /**
     * Livello di intensita (0..4) → comando ESC 7. 0 = non inviare nulla e lasciare il default
     * della stampante (alcuni cloni reagiscono male a ESC 7). Salendo cresce soprattutto il
     * tempo di riscaldamento, che e cio che scurisce i punti.
     */
    fun heatFor(level: Int): HeatSettings? = when (level.coerceIn(HEAT_LEVEL_MIN, HEAT_LEVEL_MAX)) {
        1 -> HeatSettings(maxDots = 7, heatTime = 60, heatInterval = 2)
        2 -> HeatSettings(maxDots = 8, heatTime = 80, heatInterval = 2)
        3 -> HeatSettings(maxDots = 10, heatTime = 110, heatInterval = 2)
        4 -> HeatSettings(maxDots = 11, heatTime = 140, heatInterval = 2)
        else -> null
    }

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
