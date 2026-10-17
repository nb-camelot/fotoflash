package io.github.nik2208.fotoflash.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.media.AudioManager
import android.media.MediaActionSound
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.annotation.MainThread
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.view.CameraController
import java.io.IOException
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resumeWithException
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Lato lungo massimo delle foto che passano all'editor. La stampa e larga 384-576 punti:
 * 2048 px lasciano margine per ritagli e zoom senza pesare in memoria (12 MB in ARGB).
 */
const val MAX_PHOTO_SIDE = 2048

/** Lato lungo delle miniature mostrate nel mirino durante la striscia. */
const val THUMBNAIL_SIDE = 192

private const val TAG = "FotoFlashCapture"

/* ------------------------------------------------------------------------------------------
 * Geometria delle bitmap
 * ---------------------------------------------------------------------------------------- */

/**
 * Riporta il rettangolo dentro un'immagine [width] x [height]. Un rettangolo vuoto o tutto fuori
 * diventa l'immagine intera: meglio una foto non ritagliata che un errore.
 */
internal fun Rect.clampedTo(width: Int, height: Int): Rect {
    val result = Rect(this)
    if (result.isEmpty() || !result.intersect(0, 0, width, height)) return Rect(0, 0, width, height)
    return result
}

/** Larghezza dopo la rotazione: a 90/270 gradi i lati si scambiano. */
internal fun uprightWidth(crop: Rect, rotationDegrees: Int): Int =
    if (rotationDegrees % 180 == 0) crop.width() else crop.height()

/**
 * Ritaglia [crop], poi scala, ruota (gradi orari) e specchia in orizzontale con un'unica
 * matrice: una sola bitmap nuova invece di tre intermedie. Non ricicla la sorgente; la
 * restituisce tale e quale se non c'e nulla da fare.
 */
fun Bitmap.cropRotateMirrorScale(crop: Rect, rotationDegrees: Int, mirror: Boolean, scale: Float): Bitmap {
    val area = crop.clampedTo(width, height)
    val matrix = Matrix()
    if (scale != 1f) matrix.postScale(scale, scale)
    if (rotationDegrees % 360 != 0) matrix.postRotate(rotationDegrees.toFloat())
    // Lo specchio va dopo la rotazione: ribalta destra/sinistra della foto gia dritta.
    if (mirror) matrix.postScale(-1f, 1f)
    val whole = area.left == 0 && area.top == 0 && area.width() == width && area.height() == height
    if (whole && matrix.isIdentity) return this
    return Bitmap.createBitmap(this, area.left, area.top, area.width(), area.height(), matrix, true)
}

/** Miniatura con lato lungo [maxSide]; restituisce la bitmap stessa se e gia piccola. */
fun Bitmap.thumbnail(maxSide: Int = THUMBNAIL_SIDE): Bitmap {
    val longSide = max(width, height)
    if (longSide <= maxSide) return this
    val scale = maxSide.toFloat() / longSide
    return Bitmap.createScaledBitmap(
        this,
        max(1, (width * scale).roundToInt()),
        max(1, (height * scale).roundToInt()),
        true,
    )
}

/**
 * inSampleSize (potenza di 2) per decodificare gia ridotta un'immagine con lato lungo
 * [longSide]. Si dimezza finche il risultato resta sopra 3/4 di [maxSide]: la riduzione
 * finale con filtro fa il resto e la memoria di picco crolla (un 12 MP decodificato pieno
 * occupa 48 MB, a meta 12 MB).
 */
internal fun sampleSizeFor(longSide: Int, maxSide: Int): Int {
    val floor = max(1, maxSide * 3 / 4)
    var sample = 1
    while (longSide / (sample * 2) >= floor) sample *= 2
    return sample
}

/* ------------------------------------------------------------------------------------------
 * Scatto
 * ---------------------------------------------------------------------------------------- */

/**
 * Converte lo scatto in memoria (JPEG) in una foto dritta e pronta per l'editor:
 * decodifica gia ridotta, ritaglio sul campo visivo del mirino ([ImageProxy.getCropRect], che
 * CameraX imposta dal viewport del PreviewView ma non applica ai byte JPEG), rotazione,
 * specchio per la frontale e lato lungo al massimo [maxSide].
 *
 * Non chiude l'[ImageProxy]: lo fa il chiamante.
 */
fun ImageProxy.toUprightPhoto(mirror: Boolean, maxSide: Int = MAX_PHOTO_SIDE): Bitmap {
    val rotation = imageInfo.rotationDegrees
    val decoded: Bitmap
    val crop: Rect
    val plane = planes.firstOrNull()
    if (format == ImageFormat.JPEG && plane != null) {
        val buffer = plane.buffer
        buffer.rewind()
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val jpegWidth = bounds.outWidth
        val jpegHeight = bounds.outHeight
        if (jpegWidth <= 0 || jpegHeight <= 0) throw IOException("JPEG dello scatto illeggibile")

        // Il cropRect e nelle coordinate dell'immagine: vale solo se il JPEG ha le stesse misure.
        val cropInJpeg = if (jpegWidth == width && jpegHeight == height) {
            cropRect.clampedTo(jpegWidth, jpegHeight)
        } else {
            Rect(0, 0, jpegWidth, jpegHeight)
        }
        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(max(cropInJpeg.width(), cropInJpeg.height()), maxSide)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: throw IOException("decodifica dello scatto fallita")
        val fx = decoded.width.toFloat() / jpegWidth
        val fy = decoded.height.toFloat() / jpegHeight
        crop = Rect(
            (cropInJpeg.left * fx).roundToInt(),
            (cropInJpeg.top * fy).roundToInt(),
            (cropInJpeg.right * fx).roundToInt(),
            (cropInJpeg.bottom * fy).roundToInt(),
        ).clampedTo(decoded.width, decoded.height)
    } else {
        // Formati diversi dal JPEG (es. JPEG_R): conversione di CameraX, poi stessi passaggi.
        decoded = toBitmap()
        crop = cropRect.clampedTo(decoded.width, decoded.height)
    }

    val longSide = max(crop.width(), crop.height())
    val scale = if (longSide > maxSide) maxSide.toFloat() / longSide else 1f
    val upright = decoded.cropRotateMirrorScale(crop, rotation, mirror, scale)
    if (upright !== decoded) decoded.recycle()
    return upright
}

/**
 * Scatta una foto in memoria e la restituisce dritta (vedi [toUprightPhoto]).
 *
 * [onShutter] scatta quando il sensore inizia l'esposizione (il momento giusto per suono e
 * lampo); [onExposed] quando l'esposizione e finita, prima della decodifica: e il momento della
 * vibrazione, che durante l'esposizione muoverebbe la foto con poca luce. Entrambi girano
 * sull'[executor], non sul main thread. L'elaborazione pesante (decodifica, rotazione) avviene
 * anch'essa sull'[executor].
 */
@MainThread
suspend fun CameraController.takeUprightPhoto(
    executor: Executor,
    mirror: Boolean,
    maxSide: Int = MAX_PHOTO_SIDE,
    onShutter: () -> Unit = {},
    onExposed: () -> Unit = {},
): Bitmap = suspendCancellableCoroutine { continuation ->
    val shutterFired = AtomicBoolean(false)
    fun fireShutter() {
        if (shutterFired.compareAndSet(false, true)) onShutter()
    }
    takePicture(
        executor,
        object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureStarted() {
                fireShutter()
            }

            override fun onCaptureSuccess(image: ImageProxy) {
                // Se il dispositivo salta onCaptureStarted, il feedback arriva comunque.
                fireShutter()
                onExposed()
                val photo = try {
                    image.toUprightPhoto(mirror, maxSide)
                } catch (t: Throwable) {
                    continuation.resumeWithException(t)
                    return
                } finally {
                    image.close()
                }
                // Scatto annullato nel frattempo (uscita dal mirino, timeout): nessuno ricevera la
                // foto, quindi la si ricicla subito invece di lasciare 12 MB al GC.
                continuation.resume(photo) { _, value, _ -> value.recycle() }
            }

            override fun onError(exception: ImageCaptureException) {
                continuation.resumeWithException(exception)
            }
        },
    )
}

/* ------------------------------------------------------------------------------------------
 * Feedback fisico
 * ---------------------------------------------------------------------------------------- */

/**
 * Suono dell'otturatore, bip del conto alla rovescia e vibrazione. Vive nel ViewModel col
 * Context dell'applicazione (mai quello dell'Activity); i metodi si possono chiamare da
 * qualunque thread.
 */
class CaptureFeedback(appContext: Context) {

    private val shutterSound = MediaActionSound().apply { load(MediaActionSound.SHUTTER_CLICK) }

    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        appContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        appContext.getSystemService(Vibrator::class.java)
    }

    private var beeper: ToneGenerator? = null
    private var beeperFailed = false
    private var released = false

    /**
     * In Giappone e Corea il suono e obbligatorio per legge: lo rispettiamo anche se l'utente lo ha spento.
     * Sincronizzato con [release]: arriva dal thread dello scatto e un MediaActionSound gia
     * rilasciato non va piu toccato.
     */
    @Synchronized
    fun playShutter(enabled: Boolean) {
        if (released) return
        val mandatory = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            MediaActionSound.mustPlayShutterSound()
        if (enabled || mandatory) shutterSound.play(MediaActionSound.SHUTTER_CLICK)
    }

    /** Bip del conto alla rovescia; l'ultimo e piu acuto, come nelle fotocamere vere. */
    @Synchronized
    fun beep(last: Boolean) {
        if (released || beeperFailed) return
        val generator = beeper ?: try {
            ToneGenerator(AudioManager.STREAM_SYSTEM, BEEP_VOLUME).also { beeper = it }
        } catch (e: RuntimeException) {
            // Alcuni dispositivi rifiutano il generatore di toni (audio occupato): niente bip, si scatta lo stesso.
            Log.w(TAG, "ToneGenerator non disponibile", e)
            beeperFailed = true
            return
        }
        generator.startTone(
            if (last) ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP,
            if (last) 180 else 90,
        )
    }

    fun vibrate(millis: Long = 28L) {
        val device = vibrator ?: return
        if (released || !device.hasVibrator()) return
        device.vibrate(VibrationEffect.createOneShot(millis, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    @Synchronized
    fun release() {
        if (released) return
        released = true
        shutterSound.release()
        beeper?.release()
        beeper = null
    }

    private companion object {
        const val BEEP_VOLUME = 80
    }
}
