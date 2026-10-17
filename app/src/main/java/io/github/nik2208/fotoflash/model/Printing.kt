package io.github.nik2208.fotoflash.model

import android.graphics.Bitmap
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.thermal.TemplateTexts
import io.github.nik2208.fotoflash.thermal.ToneAdjustments

/** Stampante Bluetooth accoppiata. */
data class PrinterDevice(val name: String, val address: String)

/** Stato osservabile della stampante, esposto da PrinterManager.state. */
sealed interface PrinterState {
    /** Nessuna stampante scelta. */
    data object NotConfigured : PrinterState

    data class Disconnected(val device: PrinterDevice) : PrinterState

    data class Connecting(val device: PrinterDevice) : PrinterState

    data class Connected(val device: PrinterDevice) : PrinterState

    /** progress 0..1 sui byte inviati del lavoro corrente. */
    data class Printing(val device: PrinterDevice, val progress: Float) : PrinterState

    data class Error(val device: PrinterDevice?, val failure: PrintFailure, val message: String) : PrinterState
}

/** RENDER_FAILED: la stampa non si e potuta comporre (memoria, immagine non valida): la stampante non c entra. */
enum class PrintFailure { NO_PRINTER, NO_PERMISSION, BLUETOOTH_OFF, NOT_BONDED, CONNECT_FAILED, WRITE_FAILED, BUSY, RENDER_FAILED }

sealed interface PrintOutcome {
    data class Success(val bytes: Int, val millis: Long) : PrintOutcome
    data class Failure(val failure: PrintFailure, val message: String) : PrintOutcome
}

/** Tutto cio che serve per comporre una stampa. Le foto sono gia orientate correttamente. */
data class PrintRequest(
    val photos: List<Bitmap>,
    val template: TemplateKind,
    val paper: PaperWidth,
    val dither: DitherAlgorithm,
    val tone: ToneAdjustments,
    val texts: TemplateTexts,
)

/**
 * Risultato del rendering: [bitImage] e cio che va alla testina, [preview] e la stessa immagine
 * in bianco e nero (1 pixel = 1 punto) da mostrare ingrandita senza filtri (WYSIWYG).
 */
data class RenderedPrint(val bitImage: BitImage, val preview: Bitmap)

/** Da dove arrivano le foto della sessione corrente. */
enum class CaptureSource { CAMERA, GALLERY }

/** Una voce dello storico stampe. I file stanno in filesDir/history/<id>/. */
data class HistoryEntry(
    val id: String,
    val createdAt: Long,
    val template: TemplateKind,
    val caption: String,
    val printNumber: Int?,
    /** PNG in bianco e nero, 1 pixel = 1 punto: si ristampa da qui. */
    val renderedPath: String,
    /** JPEG delle foto originali ridotte (lato lungo 1600 px). */
    val originalPaths: List<String>,
    val printed: Boolean,
)
