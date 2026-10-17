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
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import android.graphics.Rect as AndroidRect

/**
 * Esporta verso la galleria del telefono e verso le altre app.
 *
 * - Le **stampe** escono come PNG (Pictures/FotoFlash), ingrandite 2x senza filtri su fondo bianco:
 *   a 1 pixel = 1 punto sarebbero un francobollo sui telefoni moderni, e con un filtro i punti del
 *   retino diventerebbero grigi.
 * - Le **foto** originali escono come JPEG (Pictures/FotoFlash/Scatti): sono il ricordo a colori,
 *   quello che resta anche se la carta sbiadisce o l'app viene disinstallata.
 *
 * Da Android 10 si scrive con MediaStore (nessun permesso); su Android 8-9 si scrive il file in
 * Pictures e lo si fa indicizzare, e serve WRITE_EXTERNAL_STORAGE: vedi [needsLegacyWritePermission].
 * Ogni salvataggio gira su Dispatchers.IO; gli errori si registrano nel log e diventano null.
 */
class Exporter(context: Context) {

    private val appContext: Context = context.applicationContext

    /** PNG della stampa in Pictures/FotoFlash. Null se manca il permesso (Android 8-9) o se la scrittura fallisce. */
    suspend fun saveToGallery(bitmap: Bitmap, displayName: String): Uri? = withContext(Dispatchers.IO) {
        val fileName = safeFileName(displayName, EXT_PNG)
        val image = upscaled(bitmap)
        try {
            saveImage(PRINTS_DIR, fileName, MIME_PNG) { out -> writePng(image, out) }
        } finally {
            image.recycle()
        }
    }

    /**
     * Foto a colori in Pictures/FotoFlash/Scatti, JPEG qualita 92 (la stessa degli originali nello
     * storico). La bitmap del chiamante non viene mai riciclata: di solito appartiene alla sessione.
     * Null se manca il permesso (Android 8-9), se la bitmap non e piu valida o se la scrittura fallisce.
     */
    suspend fun savePhotoToGallery(bitmap: Bitmap, displayName: String): Uri? = withContext(Dispatchers.IO) {
        if (bitmap.isRecycled) {
            Log.w(TAG, "foto gia riciclata, salvataggio saltato")
            return@withContext null
        }
        val fileName = safeFileName(displayName, EXT_JPG)
        // Le bitmap HARDWARE (Photo Picker, ImageDecoder) non si comprimono: se serve, copia software.
        val source = try {
            bitmap.softwareBitmap()
        } catch (e: Exception) {
            Log.w(TAG, "foto non leggibile", e)
            return@withContext null
        } catch (e: OutOfMemoryError) {
            Log.w(TAG, "foto non leggibile (memoria)", e)
            return@withContext null
        }
        try {
            saveImage(PHOTOS_DIR, fileName, MIME_JPEG) { out -> writeJpeg(source, out) }
        } finally {
            if (source !== bitmap) source.recycle()
        }
    }

    /**
     * Copia in Pictures/FotoFlash/Scatti un JPEG gia su disco (gli originali dello storico), byte per
     * byte: niente decodifica ne ricompressione, quindi nessuna perdita di qualita e poca memoria.
     * Null se il file non esiste, se manca il permesso (Android 8-9) o se la copia fallisce.
     */
    suspend fun savePhotoFileToGallery(file: File, displayName: String): Uri? = withContext(Dispatchers.IO) {
        if (!file.isFile || file.length() <= 0L) {
            Log.w(TAG, "originale mancante o vuoto: ${file.path}")
            return@withContext null
        }
        val fileName = safeFileName(displayName, EXT_JPG)
        saveImage(
            subdir = PHOTOS_DIR,
            fileName = fileName,
            mime = MIME_JPEG,
            // Su Android 8-9 il file copiato conserva la data dell'originale: la galleria lo mette
            // al suo posto nel tempo invece che "oggi". Da Android 10 la data la decide MediaStore.
            lastModified = file.lastModified(),
        ) { out ->
            FileInputStream(file).use { input -> input.copyTo(out, COPY_BUFFER) }
        }
    }

    /**
     * True su Android 8-9 se WRITE_EXTERNAL_STORAGE non e ancora concesso: il chiamante deve chiederlo
     * a runtime prima di salvare (gli altri metodi restituirebbero null). Da Android 10 e sempre false.
     */
    fun needsLegacyWritePermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasLegacyWritePermission()

    /**
     * Prepara l'intent di condivisione (il chiamante lo avvolge in Intent.createChooser).
     * Il PNG sta in cacheDir/shared/, esposto dal FileProvider con authority "<applicationId>.files".
     */
    suspend fun shareIntent(bitmap: Bitmap, displayName: String): Intent = withContext(Dispatchers.IO) {
        val dir = File(appContext.cacheDir, SHARED_DIR)
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("impossibile creare ${dir.path}")
        pruneShared(dir)

        val file = File(dir, safeFileName(displayName, EXT_PNG))
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

    // ---------------------------------------------------------------- scrittura in galleria

    /**
     * Scrive un'immagine in Pictures/[subdir] con la strada giusta per la versione di Android.
     * [write] riceve lo stream di destinazione e lancia un'eccezione se qualcosa va storto.
     */
    private suspend fun saveImage(
        subdir: String,
        fileName: String,
        mime: String,
        lastModified: Long? = null,
        write: (OutputStream) -> Unit,
    ): Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        saveWithMediaStore(subdir, fileName, mime, write)
    } else {
        saveToPublicPictures(subdir, fileName, mime, lastModified, write)
    }

    // ---------------------------------------------------------------- Android 10+

    // RELATIVE_PATH, IS_PENDING e VOLUME_EXTERNAL_PRIMARY sono API 29: il controllo di versione sta
    // nel chiamante, l'annotazione lo dice a lint (NewApi) che non lo vede attraverso la chiamata.
    // I nomi doppi li risolve MediaStore: a parita di cartella rinomina il nuovo in "nome (1).jpg".
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveWithMediaStore(subdir: String, fileName: String, mime: String, write: (OutputStream) -> Unit): Uri? {
        val resolver = appContext.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + subdir)
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
            stream.use { out -> write(out) }
            val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
            uri
        } catch (e: Exception) {
            Log.w(TAG, "salvataggio in galleria fallito ($fileName)", e)
            // Niente voci orfane in galleria se la scrittura si e interrotta.
            runCatching { resolver.delete(uri, null, null) }
            null
        } catch (e: OutOfMemoryError) {
            Log.w(TAG, "salvataggio in galleria fallito per memoria ($fileName)", e)
            runCatching { resolver.delete(uri, null, null) }
            null
        }
    }

    // ---------------------------------------------------------------- Android 8-9

    @Suppress("DEPRECATION")
    private suspend fun saveToPublicPictures(
        subdir: String,
        fileName: String,
        mime: String,
        lastModified: Long?,
        write: (OutputStream) -> Unit,
    ): Uri? {
        if (!hasLegacyWritePermission()) {
            Log.w(TAG, "manca WRITE_EXTERNAL_STORAGE: $fileName non salvato")
            return null
        }

        var target: File? = null
        val file = try {
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), subdir)
            if (!dir.isDirectory && !dir.mkdirs()) throw IOException("impossibile creare ${dir.path}")
            val reserved = reserveUniqueFile(dir, fileName)
            target = reserved
            FileOutputStream(reserved).use { out -> write(out) }
            if (lastModified != null && lastModified > 0L) reserved.setLastModified(lastModified)
            reserved
        } catch (e: Exception) {
            Log.w(TAG, "salvataggio in Pictures fallito ($fileName)", e)
            // Un file a meta in galleria e peggio di nessun file.
            target?.delete()
            return null
        } catch (e: OutOfMemoryError) {
            Log.w(TAG, "salvataggio in Pictures fallito per memoria ($fileName)", e)
            target?.delete()
            return null
        }

        // La scansione rende la foto visibile subito in galleria e ci da un content:// Uri.
        // Il file e gia completo: se il chiamante annulla qui, la foto resta comunque salvata.
        val scanned = try {
            withTimeoutOrNull(SCAN_TIMEOUT_MS) {
                suspendCancellableCoroutine<Uri?> { continuation ->
                    MediaScannerConnection.scanFile(appContext, arrayOf(file.absolutePath), arrayOf(mime)) { _, uri ->
                        if (continuation.isActive) continuation.resume(uri)
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "scansione di ${file.name} fallita", e)
            null
        }
        return scanned ?: Uri.fromFile(file)
    }

    private fun hasLegacyWritePermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Crea un file vuoto con un nome libero in [dir]: "nome.jpg", poi "nome_1.jpg", "nome_2.jpg"...
     * createNewFile e atomico: due salvataggi contemporanei con lo stesso nome (gli scatti di una
     * striscia nello stesso secondo) non si sovrascrivono mai a vicenda.
     */
    private fun reserveUniqueFile(dir: File, fileName: String): File {
        val dot = fileName.lastIndexOf('.')
        val base = if (dot > 0) fileName.substring(0, dot) else fileName
        val ext = if (dot > 0) fileName.substring(dot) else ""
        var candidate = File(dir, fileName)
        var n = 1
        while (!candidate.createNewFile()) {
            if (n > MAX_NAME_ATTEMPTS) throw IOException("nessun nome libero per $fileName in ${dir.path}")
            candidate = File(dir, "${base}_$n$ext")
            n++
        }
        return candidate
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

    private fun writeJpeg(image: Bitmap, out: OutputStream) {
        if (!image.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)) throw IOException("compressione JPEG fallita")
        out.flush()
    }

    /**
     * Nome file sicuro con l'estensione [ext] (".png" o ".jpg"): via i caratteri che le gallerie o i
     * file system non gradiscono e l'eventuale estensione gia presente, in qualunque maiuscola.
     */
    private fun safeFileName(displayName: String, ext: String): String {
        var base = displayName.trim()
        for (known in KNOWN_EXTENSIONS) {
            if (base.endsWith(known, ignoreCase = true)) {
                base = base.dropLast(known.length)
                break
            }
        }
        base = base
            .replace(Regex("[^A-Za-z0-9._-]+"), "_")
            .trim('_', '.')
            .take(MAX_BASE_NAME)
            .ifEmpty { DEFAULT_NAME }
        return base + ext
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

        /** Cartelle sotto Pictures: le stampe in FotoFlash, le foto originali in FotoFlash/Scatti. */
        const val PRINTS_DIR = "FotoFlash"
        const val PHOTOS_DIR = "FotoFlash/Scatti"

        const val MIME_PNG = "image/png"
        const val MIME_JPEG = "image/jpeg"
        const val EXT_PNG = ".png"
        const val EXT_JPG = ".jpg"
        val KNOWN_EXTENSIONS = listOf(".png", ".jpeg", ".jpg")

        /** Come gli originali dello storico: nessuna perdita visibile, file ancora leggeri. */
        const val JPEG_QUALITY = 92

        const val SHARED_DIR = "shared"
        const val AUTHORITY_SUFFIX = ".files"
        const val DEFAULT_NAME = "FotoFlash"
        const val SCALE = 2
        const val SCAN_TIMEOUT_MS = 3_000L
        const val SHARED_MAX_AGE_MS = 60L * 60L * 1000L
        const val COPY_BUFFER = 64 * 1024

        /** Nomi di file lunghi danno noia ad alcune gallerie; la data e il numero stanno ben dentro. */
        const val MAX_BASE_NAME = 96

        /** Difesa contro cartelle piene o non scrivibili: oltre, si rinuncia con un errore. */
        const val MAX_NAME_ATTEMPTS = 999
    }
}
