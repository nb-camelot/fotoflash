package io.github.nik2208.fotoflash.camera

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Importa foto dalla galleria (Photo Picker) come bitmap dritte e leggere, pronte per l'editor:
 * decodifica gia ridotta con inSampleSize fino a un lato lungo di circa [MAX_PHOTO_SIDE] e
 * orientamento corretto secondo l'EXIF (le foto dei telefoni sono quasi sempre "girate" nei
 * metadati, non nei pixel).
 */
object GalleryImport {

    private const val TAG = "FotoFlashGallery"

    /** Carica una foto. Lavora su Dispatchers.IO; lancia IOException se l'immagine non si legge. */
    suspend fun load(resolver: ContentResolver, uri: Uri, maxSide: Int = MAX_PHOTO_SIDE): Bitmap =
        withContext(Dispatchers.IO) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            open(resolver, uri).use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                throw IOException("formato immagine non riconosciuto: $uri")
            }

            val options = BitmapFactory.Options().apply {
                inSampleSize = sampleSizeFor(max(bounds.outWidth, bounds.outHeight), maxSide)
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            val decoded = open(resolver, uri).use { BitmapFactory.decodeStream(it, null, options) }
                ?: throw IOException("decodifica fallita: $uri")

            val oriented = decoded.oriented(readOrientation(resolver, uri), maxSide)
            if (oriented !== decoded) decoded.recycle()
            oriented
        }

    /**
     * Carica piu foto in ordine. Se una fallisce libera quelle gia caricate e rilancia:
     * meglio un messaggio chiaro che una striscia con un buco.
     */
    suspend fun loadAll(resolver: ContentResolver, uris: List<Uri>, maxSide: Int = MAX_PHOTO_SIDE): List<Bitmap> {
        val loaded = ArrayList<Bitmap>(uris.size)
        try {
            for (uri in uris) loaded += load(resolver, uri, maxSide)
        } catch (t: Throwable) {
            loaded.forEach { it.recycle() }
            throw t
        }
        return loaded
    }

    private fun open(resolver: ContentResolver, uri: Uri): InputStream =
        resolver.openInputStream(uri) ?: throw FileNotFoundException("impossibile aprire $uri")

    private fun readOrientation(resolver: ContentResolver, uri: Uri): Int = try {
        open(resolver, uri).use { stream ->
            ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }
    } catch (e: IOException) {
        // PNG senza EXIF, formati esotici: si tiene l'immagine com'e.
        Log.d(TAG, "EXIF non leggibile per $uri", e)
        ExifInterface.ORIENTATION_NORMAL
    } catch (e: RuntimeException) {
        Log.d(TAG, "EXIF non valido per $uri", e)
        ExifInterface.ORIENTATION_NORMAL
    }

    /** Applica orientamento EXIF e riduzione a [maxSide] in un solo passaggio. */
    private fun Bitmap.oriented(orientation: Int, maxSide: Int): Bitmap {
        val matrix = Matrix()
        val longSide = max(width, height)
        if (longSide > maxSide) {
            val scale = maxSide.toFloat() / longSide
            matrix.postScale(scale, scale)
        }
        // Stessa mappatura delle librerie di immagini piu diffuse (Glide): rotazioni e specchi EXIF 1-8.
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
                matrix.postRotate(180f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(-90f)
            else -> Unit
        }
        if (matrix.isIdentity) return this
        return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
    }
}
