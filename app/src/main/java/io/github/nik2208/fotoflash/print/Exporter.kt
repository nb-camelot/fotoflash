package io.github.nik2208.fotoflash.print

import android.Manifest
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import kotlin.coroutines.resume
import android.graphics.Rect as AndroidRect

/**
 * Esporta le stampe come PNG: in galleria (Pictures/FotoFlash) o in condivisione verso altre app.
 *
 * Il PNG e la stampa ingrandita 2x senza filtri su fondo bianco: a 1 pixel = 1 punto sarebbe un
 * francobollo sui telefoni moderni, e con un filtro i punti del retino diventerebbero grigi.
 */
class Exporter(context: Context) {

    private val appContext: Context = context.applicationContext

    /** Salva in Pictures/FotoFlash. Restituisce null se manca il permesso (Android 8-9) o se la scrittura fallisce. */
    suspend fun saveToGallery(bitmap: Bitmap, displayName: String): Uri? = withContext(Dispatchers.IO) {
        val fileName = pngName(displayName)
        val image = upscaled(bitmap)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveWithMediaStore(image, fileName)
            } else {
                saveToPublicPictures(image, fileName)
            }
        } finally {
            image.recycle()
        }
    }

    /**
     * Prepara l'intent di condivisione (il chiamante lo avvolge in Intent.createChooser).
     * Il PNG sta in cacheDir/shared/, esposto dal FileProvider con authority "<applicationId>.files".
     */
    suspend fun shareIntent(bitmap: Bitmap, displayName: String): Intent = withContext(Dispatchers.IO) {
        val dir = File(appContext.cacheDir, SHARED_DIR)
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("impossibile creare ${dir.path}")
        pruneShared(dir)

        val file = File(dir, pngName(displayName))
        val image = upscaled(bitmap)
        try {
            FileOutputStream(file).use { out -> writePng(image, out) }
        } finally {
            image.recycle()
        }

        val uri = FileProvider.getUriForFile(appContext, appContext.packageName + AUTHORITY_SUFFIX, file)
        Intent(Intent.ACTION_SEND).apply {
            type = MIME_PNG
            putExtra(Intent.EXTRA_STREAM, uri)
            // Senza ClipData alcune app (e l'anteprima del chooser) non ricevono il permesso di lettura.
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    // ---------------------------------------------------------------- Android 10+

    // RELATIVE_PATH, IS_PENDING e VOLUME_EXTERNAL_PRIMARY sono API 29: il controllo di versione sta
    // nel chiamante, l'annotazione lo dice a lint (NewApi) che non lo vede attraverso la chiamata.
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveWithMediaStore(image: Bitmap, fileName: String): Uri? {
        val resolver = appContext.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, MIME_PNG)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM)
            // In attesa finche il file non e completo: la galleria non mostra mezze immagini.
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri: Uri? = try {
            resolver.insert(collection, values)
        } catch (e: Exception) {
            Log.w(TAG, "MediaStore non disponibile", e)
            null
        }
        if (uri == null) return null

        return try {
            val stream = resolver.openOutputStream(uri) ?: throw IOException("stream nullo per $uri")
            stream.use { out -> writePng(image, out) }
            val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
            uri
        } catch (e: Exception) {
            Log.w(TAG, "salvataggio in galleria fallito", e)
            // Niente voci orfane in galleria se la scrittura si e interrotta.
            runCatching { resolver.delete(uri, null, null) }
            null
        }
    }

    // ---------------------------------------------------------------- Android 8-9

    @Suppress("DEPRECATION")
    private suspend fun saveToPublicPictures(image: Bitmap, fileName: String): Uri? {
        val granted = ContextCompat.checkSelfPermission(appContext, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return null

        val file = try {
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM)
            if (!dir.isDirectory && !dir.mkdirs()) throw IOException("impossibile creare ${dir.path}")
            val target = uniqueFile(dir, fileName)
            FileOutputStream(target).use { out -> writePng(image, out) }
            target
        } catch (e: Exception) {
            Log.w(TAG, "salvataggio in Pictures fallito", e)
            return null
        }

        // La scansione rende la foto visibile subito in galleria e ci da un content:// Uri.
        val scanned = withTimeoutOrNull(SCAN_TIMEOUT_MS) {
            suspendCancellableCoroutine<Uri?> { continuation ->
                MediaScannerConnection.scanFile(appContext, arrayOf(file.absolutePath), arrayOf(MIME_PNG)) { _, uri ->
                    if (continuation.isActive) continuation.resume(uri)
                }
            }
        }
        return scanned ?: Uri.fromFile(file)
    }

    // ---------------------------------------------------------------- utilita

    /** Ingrandimento 2x nearest neighbour su bianco: i punti restano punti, la trasparenza diventa carta. */
    private fun upscaled(bitmap: Bitmap): Bitmap {
        val source = bitmap.softwareBitmap()
        val width = source.width * SCALE
        val height = source.height * SCALE
        val out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.WHITE)
        val paint = Paint().apply {
            isAntiAlias = false
            isFilterBitmap = false
        }
        canvas.drawBitmap(source, null, AndroidRect(0, 0, width, height), paint)
        if (source !== bitmap) source.recycle()
        return out
    }

    private fun writePng(image: Bitmap, out: OutputStream) {
        if (!image.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IOException("compressione PNG fallita")
        out.flush()
    }

    /** Nome file sicuro con estensione .png. */
    private fun pngName(displayName: String): String {
        val base = displayName.trim()
            .removeSuffix(".png")
            .replace(Regex("[^A-Za-z0-9._-]+"), "_")
            .trim('_', '.')
            .ifEmpty { DEFAULT_NAME }
        return "$base.png"
    }

    private fun uniqueFile(dir: File, fileName: String): File {
        val base = fileName.removeSuffix(".png")
        var candidate = File(dir, fileName)
        var n = 1
        while (candidate.exists()) {
            candidate = File(dir, "${base}_$n.png")
            n++
        }
        return candidate
    }

    /** I PNG condivisi servono solo il tempo della condivisione: si tengono gli ultimi, gli altri si buttano. */
    private fun pruneShared(dir: File) {
        val limit = System.currentTimeMillis() - SHARED_MAX_AGE_MS
        dir.listFiles()?.forEach { file ->
            if (file.isFile && file.lastModified() < limit) file.delete()
        }
    }

    private companion object {
        const val TAG = "Exporter"
        const val ALBUM = "FotoFlash"
        const val MIME_PNG = "image/png"
        const val SHARED_DIR = "shared"
        const val AUTHORITY_SUFFIX = ".files"
        const val DEFAULT_NAME = "FotoFlash"
        const val SCALE = 2
        const val SCAN_TIMEOUT_MS = 3_000L
        const val SHARED_MAX_AGE_MS = 60L * 60L * 1000L
    }
}
