package io.github.nik2208.fotoflash.camera

import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import io.github.nik2208.fotoflash.print.toGrayImage
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.Ditherer
import io.github.nik2208.fotoflash.thermal.GrayImage
import io.github.nik2208.fotoflash.thermal.Tone
import io.github.nik2208.fotoflash.thermal.ToneAdjustments
import io.github.nik2208.fotoflash.thermal.toArgb
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Anteprima termica dal vivo: trasforma i fotogrammi di ImageAnalysis (RGBA_8888) in come
 * uscirebbero dalla stampante, cioe retinati a 1 bit, e li pubblica in [frames].
 *
 * Il fotogramma viene ritagliato sul campo visivo del mirino (cropRect del viewport), messo
 * dritto rispetto allo schermo, specchiato per la frontale e ridotto a [targetWidth] punti:
 * mostrato con ContentScale.Crop sopra il PreviewView in FILL_CENTER combacia con l'anteprima.
 *
 * I punti neri e bianchi hanno i colori della carta ([inkArgb], [paperArgb]): sembra uno
 * scontrino appena stampato, non un filtro bianco e nero.
 *
 * Le regolazioni sono quelle delle impostazioni, comprese ombre, contrasto locale e controluce
 * automatico: quello che si vede e quello che esce. Le regolazioni che guardano l'immagine
 * (controluce, contrasto locale, auto-livelli) si calcolano sulla parte che finisce sulla carta
 * ([setPrintAspect]), come fa la stampa sulla foto ritagliata dal modello.
 */
class ThermalPreviewAnalyzer(
    private val inkArgb: Int,
    private val paperArgb: Int,
    private val targetWidth: Int = PREVIEW_WIDTH,
    private val minFrameIntervalMs: Long = MIN_FRAME_INTERVAL_MS,
) : ImageAnalysis.Analyzer {

    private val _frames = MutableStateFlow<Bitmap?>(null)

    /** Ultimo fotogramma retinato (ARGB_8888, 1 pixel = 1 punto); null = nessuno da mostrare. */
    val frames: StateFlow<Bitmap?> = _frames.asStateFlow()

    @Volatile private var dither: DitherAlgorithm = DitherAlgorithm.ATKINSON
    @Volatile private var tone: ToneAdjustments = previewTone(ToneAdjustments())
    @Volatile private var mirror: Boolean = false

    /** Rotazione oraria dal buffer del sensore allo schermo; -1 = usa quella del fotogramma. */
    @Volatile private var displayRotationDegrees: Int = -1

    /** Larghezza/altezza (sullo schermo) della parte stampata; 0 = tutta l'inquadratura. */
    @Volatile private var printAspect: Float = 0f

    @Volatile private var lastFrameAt: Long = 0L
    @Volatile private var pausedUntil: Long = 0L

    /** Il primo fotogramma lento finisce nel log, una volta: serve a capire i telefoni lenti. */
    @Volatile private var slowFrameLogged = false

    /** Cambia a ogni reset: un fotogramma iniziato prima del reset non viene pubblicato. */
    @Volatile private var generation: Int = 0

    /** Buffer riusato tra i fotogrammi; lo tocca solo il thread di analisi. */
    private var rgbaBuffer: Bitmap? = null

    /** Retino e regolazioni dalle impostazioni: l'anteprima deve somigliare alla stampa. */
    fun configure(dither: DitherAlgorithm, tone: ToneAdjustments) {
        this.dither = dither
        this.tone = previewTone(tone)
    }

    /**
     * Rapporto (larghezza/altezza sullo schermo) della parte di inquadratura che il modello
     * mette sulla carta, centrata come la guida del mirino; null = tutta l'inquadratura.
     */
    fun setPrintAspect(aspect: Float?) {
        printAspect = if (aspect != null && aspect.isFinite() && aspect > 0f) aspect else 0f
    }

    /**
     * Fotocamera in uso: specchio per la frontale e rotazione verso lo schermo. La rotazione
     * va data a parte perche, con l'Activity bloccata in verticale, CameraX ruota i fotogrammi
     * secondo come e tenuto il telefono, mentre il mirino resta fermo.
     */
    fun setOrientation(front: Boolean, displayRotationDegrees: Int?) {
        val rotation = displayRotationDegrees ?: -1
        if (front == mirror && rotation == this.displayRotationDegrees) return
        mirror = front
        this.displayRotationDegrees = rotation
        reset()
    }

    /**
     * Toglie il fotogramma corrente e ignora quelli dei prossimi istanti: dopo un cambio di
     * fotocamera arrivano ancora fotogrammi della vecchia, che apparirebbero girati.
     */
    fun reset() {
        generation += 1
        pausedUntil = SystemClock.elapsedRealtime() + SETTLE_MS
        _frames.value = null
    }

    override fun analyze(image: ImageProxy) {
        try {
            val now = SystemClock.elapsedRealtime()
            // Scarto per tempo: circa 8 fotogrammi al secondo bastano e lasciano respirare la batteria.
            if (now < pausedUntil || now - lastFrameAt < minFrameIntervalMs) return
            val startedGeneration = generation
            try {
                val frame = render(image)
                if (startedGeneration == generation) _frames.value = frame
            } finally {
                // L'intervallo parte dalla fine del fotogramma: su un telefono lento (contrasto
                // locale e retino costano) l'anteprima rallenta invece di tenere la CPU sempre occupata.
                val end = SystemClock.elapsedRealtime()
                lastFrameAt = end
                if (end - now > SLOW_FRAME_MS && !slowFrameLogged) {
                    slowFrameLogged = true
                    Log.i(TAG, "anteprima termica lenta: ${end - now} ms per fotogramma")
                }
            }
        } catch (e: Exception) {
            // Un fotogramma perso non si vede; il successivo ci riprova.
            Log.w(TAG, "fotogramma dell'anteprima termica scartato", e)
        } catch (e: OutOfMemoryError) {
            Log.w(TAG, "memoria esaurita per l'anteprima termica", e)
        } finally {
            image.close()
        }
    }

    private fun render(image: ImageProxy): Bitmap {
        val source = rgbaBitmap(image)
        val crop = image.cropRect.clampedTo(source.width, source.height)
        val rotation = displayRotationDegrees.takeIf { it >= 0 } ?: image.imageInfo.rotationDegrees
        val scale = min(1f, targetWidth.toFloat() / uprightWidth(crop, rotation))
        val small = source.cropRotateMirrorScale(crop, rotation, mirror, scale)
        val gray = small.toGrayImage()
        // Il buffer riusato non si ricicla mai; le bitmap create qui si liberano subito.
        if (small !== rgbaBuffer) small.recycle()
        if (source !== rgbaBuffer && source !== small && !source.isRecycled) source.recycle()

        val bits = Ditherer.dither(toneLikePrint(gray, tone, printAspect), dither)
        return Bitmap.createBitmap(bits.toArgb(inkArgb, paperArgb), bits.width, bits.height, Bitmap.Config.ARGB_8888)
    }

    /**
     * Copia il piano RGBA in una bitmap riusata quando le righe non hanno padding (il caso
     * comune), altrimenti lascia fare a toBitmap(), che gestisce il rowStride.
     */
    private fun rgbaBitmap(image: ImageProxy): Bitmap {
        val plane = image.planes.firstOrNull()
        if (image.format == PixelFormat.RGBA_8888 && plane != null &&
            plane.pixelStride == 4 && plane.rowStride == image.width * 4
        ) {
            val existing = rgbaBuffer
            val buffer = if (existing != null && existing.width == image.width && existing.height == image.height) {
                existing
            } else {
                existing?.recycle()
                Bitmap.createBitmap(image.width, image.height, Bitmap.Config.ARGB_8888).also { rgbaBuffer = it }
            }
            val bytes = plane.buffer
            bytes.rewind()
            if (bytes.remaining() >= buffer.byteCount) {
                buffer.copyPixelsFromBuffer(bytes)
                return buffer
            }
        }
        return image.toBitmap()
    }

    companion object {
        /** Larghezza dell'anteprima in punti: abbastanza per leggere il retino, poco per la CPU. */
        const val PREVIEW_WIDTH = 240

        /** Pausa minima tra la fine di un fotogramma e l'inizio del successivo: ~8 al secondo. */
        const val MIN_FRAME_INTERVAL_MS = 100L

        private const val SETTLE_MS = 300L

        /** Oltre questo tempo per fotogramma l'anteprima si fa notare (e lo diciamo nel log). */
        private const val SLOW_FRAME_MS = 80L

        /** Sotto questi pixel di differenza la parte stampata e di fatto tutta l'inquadratura. */
        private const val MIN_CROP_MARGIN = 4
        private const val TAG = "FotoFlashThermal"

        /**
         * Regolazioni "leggere": quelle dell'utente con meta nitidezza, perche l'anteprima e
         * ingrandita 4-5 volte sullo schermo e gli aloni della maschera di contrasto si
         * vedrebbero piu che sulla carta. Ombre, contrasto locale e controluce restano quelli
         * delle impostazioni: sono proprio cio che deve vedersi uguale alla stampa.
         */
        fun previewTone(tone: ToneAdjustments): ToneAdjustments = tone.copy(sharpen = tone.sharpen * 0.5f)

        /**
         * Tono come in stampa. La stampa regola la sola foto ritagliata dal modello, e il
         * controluce, il contrasto locale e gli auto-livelli dipendono da cosa c'e nell'immagine
         * (un cielo tagliato via cambia il risultato): la parte centrale con rapporto
         * [printAspect] si regola quindi per conto suo e si incolla sopra il resto, regolato
         * sull'inquadratura intera. Il bordo tra le due cade sulla guida del mirino, che scurisce
         * cio che resta fuori. [printAspect] <= 0 = tutta l'inquadratura, una sola passata.
         *
         * Costo: a 240 px di larghezza le due passate restano nell'ordine dei millisecondi.
         */
        internal fun toneLikePrint(gray: GrayImage, tone: ToneAdjustments, printAspect: Float): GrayImage {
            val whole = Tone.apply(gray, tone)
            if (!(printAspect > 0f)) return whole
            var cropWidth = gray.width
            var cropHeight = (gray.width / printAspect).roundToInt()
            if (cropHeight > gray.height) {
                cropHeight = gray.height
                cropWidth = (gray.height * printAspect).roundToInt()
            }
            cropWidth = cropWidth.coerceIn(1, gray.width)
            cropHeight = cropHeight.coerceIn(1, gray.height)
            if (gray.width - cropWidth <= MIN_CROP_MARGIN && gray.height - cropHeight <= MIN_CROP_MARGIN) return whole
            val left = (gray.width - cropWidth) / 2
            val top = (gray.height - cropHeight) / 2
            val printed = Tone.apply(gray.copyArea(left, top, cropWidth, cropHeight), tone)
            whole.pasteArea(printed, left, top)
            return whole
        }

        /** Copia del rettangolo indicato (che deve stare dentro l'immagine). */
        private fun GrayImage.copyArea(left: Int, top: Int, areaWidth: Int, areaHeight: Int): GrayImage {
            val out = ByteArray(areaWidth * areaHeight)
            for (y in 0 until areaHeight) {
                System.arraycopy(pixels, (top + y) * width + left, out, y * areaWidth, areaWidth)
            }
            return GrayImage(areaWidth, areaHeight, out)
        }

        /** Scrive [src] in questa immagine a partire da ([left], [top]); deve starci per intero. */
        private fun GrayImage.pasteArea(src: GrayImage, left: Int, top: Int) {
            for (y in 0 until src.height) {
                System.arraycopy(src.pixels, y * src.width, pixels, (top + y) * width + left, src.width)
            }
        }
    }
}
