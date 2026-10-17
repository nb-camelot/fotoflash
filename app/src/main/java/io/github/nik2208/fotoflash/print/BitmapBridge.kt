package io.github.nik2208.fotoflash.print

import android.graphics.Bitmap
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.GrayImage
import io.github.nik2208.fotoflash.thermal.bitImageFromArgb
import io.github.nik2208.fotoflash.thermal.toArgb
import kotlin.math.roundToInt

/*
 * Ponte tra le Bitmap di Android e le immagini del motore termico (:core-thermal).
 * Lo usano il renderer delle stampe e l'anteprima termica dal vivo della fotocamera.
 */

/** Luminanza 0..255 (Rec.601, alpha composto su bianco), un byte per pixel. */
fun Bitmap.toGrayImage(): GrayImage {
    val source = softwareBitmap()
    val gray = GrayImage.fromArgb(source.width, source.height, source.argbPixels())
    if (source !== this) source.recycle()
    return gray
}

/** Soglia secca: nero se la luminanza e sotto [threshold] (e il pixel non e trasparente). */
fun Bitmap.toBitImage(threshold: Int = 128): BitImage {
    val source = softwareBitmap()
    val bits = bitImageFromArgb(source.width, source.height, source.argbPixels(), threshold)
    if (source !== this) source.recycle()
    return bits
}

/** Bitmap ARGB_8888 in bianco e nero puro, 1 pixel = 1 punto della testina. */
fun BitImage.toBitmap(): Bitmap =
    Bitmap.createBitmap(toArgb(), width, height, Bitmap.Config.ARGB_8888)

/**
 * Ritaglia al centro con il rapporto di destinazione e scala con filtro a [targetWidth] x [targetHeight].
 *
 * Le riduzioni forti passano per dimezzamenti successivi: il bilineare da solo, su un fattore 5-10x,
 * salta pixel e produce aliasing, che la retinatura trasforma in rumore ben visibile sulla carta.
 * Non ricicla mai la bitmap di partenza; puo restituirla se ha gia le dimensioni giuste.
 */
fun Bitmap.centerCrop(targetWidth: Int, targetHeight: Int): Bitmap {
    require(targetWidth > 0 && targetHeight > 0) { "dimensioni non valide: ${targetWidth}x$targetHeight" }
    val original = this
    // Ricicla solo le bitmap intermedie create qui: mai l'originale, mai il risultato.
    fun dispose(bitmap: Bitmap, keep: Bitmap) {
        if (bitmap !== original && bitmap !== keep && !bitmap.isRecycled) bitmap.recycle()
    }

    val source = softwareBitmap()
    val targetRatio = targetWidth.toDouble() / targetHeight.toDouble()
    val sourceRatio = source.width.toDouble() / source.height.toDouble()
    val cropWidth: Int
    val cropHeight: Int
    if (sourceRatio > targetRatio) {
        // Sorgente piu larga: si tagliano i lati.
        cropHeight = source.height
        cropWidth = (source.height * targetRatio).roundToInt().coerceIn(1, source.width)
    } else {
        // Sorgente piu alta: si tagliano sopra e sotto.
        cropWidth = source.width
        cropHeight = (source.width / targetRatio).roundToInt().coerceIn(1, source.height)
    }
    val left = (source.width - cropWidth) / 2
    val top = (source.height - cropHeight) / 2

    var current = Bitmap.createBitmap(source, left, top, cropWidth, cropHeight)
    dispose(source, current)

    while (current.width >= targetWidth * 2 && current.height >= targetHeight * 2) {
        val half = Bitmap.createScaledBitmap(current, current.width / 2, current.height / 2, true)
        dispose(current, half)
        current = half
    }

    if (current.width == targetWidth && current.height == targetHeight) return current
    val result = Bitmap.createScaledBitmap(current, targetWidth, targetHeight, true)
    dispose(current, result)
    return result
}

/**
 * Le bitmap HARDWARE (frequenti con ImageDecoder e il Photo Picker) non permettono getPixels
 * ne il disegno su Canvas software: se serve se ne fa una copia ARGB_8888.
 */
internal fun Bitmap.softwareBitmap(): Bitmap {
    if (config != Bitmap.Config.HARDWARE) return this
    return copy(Bitmap.Config.ARGB_8888, false)
        ?: throw IllegalStateException("impossibile copiare la bitmap hardware ${width}x$height")
}

/** Tutti i pixel come interi ARGB, riga per riga. */
private fun Bitmap.argbPixels(): IntArray {
    val pixels = IntArray(width * height)
    getPixels(pixels, 0, width, 0, 0, width, height)
    return pixels
}
