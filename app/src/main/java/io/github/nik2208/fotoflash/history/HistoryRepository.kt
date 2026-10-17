package io.github.nik2208.fotoflash.history

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.util.LruCache
import io.github.nik2208.fotoflash.model.HistoryEntry
import io.github.nik2208.fotoflash.model.RenderedPrint
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.thermal.bitImageFromArgb
import io.github.nik2208.fotoflash.thermal.toArgb
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Storico delle stampe su file: filesDir/history/<id>/ con
 * - print.png: l'immagine a 1 bit (1 pixel = 1 punto), da cui si ristampa identica;
 * - photo_N.jpg: gli originali ridotti (lato lungo 1600 px, JPEG 85);
 * - meta.json: i dati della voce. E scritto per ultimo: una cartella senza meta.json e
 *   un salvataggio interrotto e viene ripulita al caricamento.
 *
 * Nessun errore di I/O risale ai chiamanti: si logga e si restituisce null / si ignora.
 */
class HistoryRepository(context: Context, private val scope: CoroutineScope) {

    private val root = File(context.applicationContext.filesDir, DIR_NAME)
    private val mutex = Mutex()

    private val _entries = MutableStateFlow<List<HistoryEntry>>(emptyList())

    /** Voci dello storico, piu recenti per prime. */
    val entries: StateFlow<List<HistoryEntry>> = _entries.asStateFlow()

    private val _loaded = MutableStateFlow(false)

    /** true quando l'indice su disco e stato letto: distingue "vuoto" da "non ancora caricato". */
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    /** Le anteprime servono sia alla griglia sia al dettaglio: una cache evita di ridecodificarle. */
    private val previewCache = object : LruCache<String, Bitmap>(previewCacheBytes()) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    /**
     * Chiave d'ordine per voce, salvata in meta.json. Coincide con createdAt finche l'orologio va
     * avanti, ma cresce sempre: con la data azzerata (batteria scarica, tablet senza rete) le stampe
     * nuove restano in cima e non vengono potate come "le piu vecchie". Le voci senza seq usano createdAt.
     */
    private val seqs = ConcurrentHashMap<String, Long>()
    private val lastSeq = AtomicLong(0L)

    // Va dichiarato per ultimo: la coroutine parte subito e usa i campi sopra.
    private val loadJob: Job = scope.launch(Dispatchers.IO) {
        try {
            mutex.withLock {
                val list = readIndex()
                val maxSeq = list.maxOfOrNull { seqOf(it) } ?: 0L
                lastSeq.updateAndGet { maxOf(it, maxSeq) }
                _entries.value = list
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Indice dello storico illeggibile", e)
        } finally {
            _loaded.value = true
        }
    }

    fun find(id: String): HistoryEntry? = _entries.value.firstOrNull { it.id == id }

    /**
     * Registra una stampa. Se il salvataggio fallisce la voce restituita non e nello storico
     * (e lo si scrive nel log): la stampa vera e propria non deve mai fallire per colpa dell'archivio.
     */
    suspend fun add(
        rendered: RenderedPrint,
        originals: List<Bitmap>,
        template: TemplateKind,
        caption: String,
        printNumber: Int?,
        printed: Boolean,
    ): HistoryEntry = withContext(Dispatchers.IO) {
        loadJob.join()
        val createdAt = System.currentTimeMillis()
        // Dopo loadJob: lastSeq contiene gia il massimo letto da disco.
        val seq = lastSeq.updateAndGet { maxOf(it + 1, createdAt) }
        val dir = newEntryDir(createdAt)
        val id = dir.name
        val printFile = File(dir, PRINT_FILE)
        var entry = HistoryEntry(
            id = id,
            createdAt = createdAt,
            template = template,
            caption = caption,
            printNumber = printNumber,
            renderedPath = printFile.absolutePath,
            originalPaths = emptyList(),
            printed = printed,
        )
        try {
            if (!dir.mkdirs() && !dir.isDirectory) throw java.io.IOException("cartella non creata: $dir")
            writePrintPng(rendered.bitImage, printFile)

            val saved = ArrayList<String>(originals.size)
            originals.forEachIndexed { index, bitmap ->
                val file = File(dir, "photo_${index + 1}.jpg")
                if (writeOriginal(bitmap, file)) saved += file.absolutePath
            }
            entry = entry.copy(originalPaths = saved)
            seqs[id] = seq
            writeMeta(dir, entry, seq)

            mutex.withLock {
                // La voce nuova non si pota mai: si scartano solo le altre, le piu vecchie per seq.
                val others = _entries.value.filterNot { it.id == id }.sortedByDescending { seqOf(it) }
                others.drop(MAX_ENTRIES - 1).forEach { old -> evict(old.id) }
                _entries.value = (listOf(entry) + others.take(MAX_ENTRIES - 1)).sortedByDescending { seqOf(it) }
            }
        } catch (e: CancellationException) {
            seqs.remove(id)
            dir.deleteRecursively()
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Voce dello storico non salvata", e)
            seqs.remove(id)
            dir.deleteRecursively()
        } catch (e: OutOfMemoryError) {
            // PNG di una striscia lunga su un telefono con poco heap: si perde la voce, non l'app.
            Log.e(TAG, "Memoria insufficiente per la voce", e)
            seqs.remove(id)
            dir.deleteRecursively()
        }
        entry
    }

    suspend fun markPrinted(id: String) {
        withContext(Dispatchers.IO) {
            loadJob.join()
            try {
                mutex.withLock {
                    val current = _entries.value.firstOrNull { it.id == id }
                    if (current != null && !current.printed) {
                        val updated = current.copy(printed = true)
                        // Riscrivendo meta.json va conservata la chiave d'ordine.
                        writeMeta(File(root, id), updated, seqOf(current))
                        _entries.value = _entries.value.map { if (it.id == id) updated else it }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Stato 'stampata' non salvato per $id", e)
            }
        }
    }

    suspend fun delete(id: String) {
        if (!isValidId(id)) return
        withContext(Dispatchers.IO) {
            loadJob.join()
            try {
                mutex.withLock {
                    previewCache.remove(id)
                    val dir = File(root, id)
                    if (dir.exists() && !dir.deleteRecursively()) Log.w(TAG, "Cartella $id non eliminata del tutto")
                    seqs.remove(id)
                    _entries.value = _entries.value.filterNot { it.id == id }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Eliminazione di $id fallita", e)
            }
        }
    }

    /** Anteprima a 1 bit (1 pixel = 1 punto) da mostrare con ThermalImage. Non va riciclata. */
    suspend fun loadPreview(entry: HistoryEntry): Bitmap? {
        previewCache.get(entry.id)?.let { return it }
        return withContext(Dispatchers.IO) {
            val bitmap = decodePrint(entry)
            if (bitmap != null) previewCache.put(entry.id, bitmap)
            bitmap
        }
    }

    /** Ricostruisce l'immagine per la testina dal PNG salvato: la ristampa e identica all'originale. */
    suspend fun loadBitImage(entry: HistoryEntry): BitImage? = withContext(Dispatchers.IO) {
        val bitmap = previewCache.get(entry.id) ?: decodePrint(entry) ?: return@withContext null
        try {
            val w = bitmap.width
            val h = bitmap.height
            val argb = IntArray(w * h)
            bitmap.getPixels(argb, 0, w, 0, 0, w, h)
            bitImageFromArgb(w, h, argb)
        } catch (e: Exception) {
            Log.e(TAG, "Conversione della stampa ${entry.id} fallita", e)
            null
        } catch (e: OutOfMemoryError) {
            Log.e(TAG, "Memoria insufficiente per la stampa ${entry.id}", e)
            null
        }
    }

    // --- interni -------------------------------------------------------------------------

    private fun decodePrint(entry: HistoryEntry): Bitmap? {
        val file = File(entry.renderedPath)
        if (!file.isFile) {
            Log.w(TAG, "PNG mancante per ${entry.id}")
            return null
        }
        return try {
            val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
            BitmapFactory.decodeFile(file.absolutePath, options)
                ?: run {
                    Log.w(TAG, "PNG illeggibile per ${entry.id}")
                    null
                }
        } catch (e: Exception) {
            Log.e(TAG, "Decodifica della stampa ${entry.id} fallita", e)
            null
        } catch (e: OutOfMemoryError) {
            Log.e(TAG, "Memoria insufficiente per l'anteprima ${entry.id}", e)
            null
        }
    }

    private fun seqOf(entry: HistoryEntry): Long = seqs[entry.id] ?: entry.createdAt

    /** Toglie una voce potata da disco e dalle cache. Va chiamata con il mutex preso. */
    private fun evict(id: String) {
        previewCache.remove(id)
        seqs.remove(id)
        File(root, id).deleteRecursively()
    }

    private fun readIndex(): List<HistoryEntry> {
        val dirs = root.listFiles()?.filter { it.isDirectory } ?: return emptyList()
        val result = ArrayList<HistoryEntry>(dirs.size)
        for (dir in dirs) {
            val entry = readEntry(dir)
            if (entry != null) {
                result += entry
            } else {
                // Salvataggio interrotto o file corrotti: meglio liberare spazio che mostrare voci vuote.
                Log.w(TAG, "Voce non valida rimossa: ${dir.name}")
                seqs.remove(dir.name)
                dir.deleteRecursively()
            }
        }
        val sorted = result.sortedByDescending { seqOf(it) }
        sorted.drop(MAX_ENTRIES).forEach { evict(it.id) }
        return sorted.take(MAX_ENTRIES)
    }

    private fun readEntry(dir: File): HistoryEntry? {
        if (!isValidId(dir.name)) return null
        val metaFile = File(dir, META_FILE)
        val printFile = File(dir, PRINT_FILE)
        if (!metaFile.isFile || !printFile.isFile) return null
        return try {
            val json = JSONObject(metaFile.readText(Charsets.UTF_8))
            val templateName = json.optString(KEY_TEMPLATE, TemplateKind.POLAROID.name)
            val template = TemplateKind.entries.firstOrNull { it.name == templateName } ?: TemplateKind.POLAROID
            val names = json.optJSONArray(KEY_ORIGINALS)
            val originals = ArrayList<String>()
            if (names != null) {
                for (i in 0 until names.length()) {
                    val name = names.optString(i, "")
                    // Solo nomi semplici: il meta.json non deve poter puntare fuori dalla cartella.
                    if (name.isNotEmpty() && !name.contains('/') && !name.contains('\\')) {
                        val file = File(dir, name)
                        if (file.isFile) originals += file.absolutePath
                    }
                }
            }
            val createdAt = json.optLong(KEY_CREATED_AT, dir.lastModified())
            seqs[dir.name] = json.optLong(KEY_SEQ, createdAt)
            HistoryEntry(
                id = dir.name,
                createdAt = createdAt,
                template = template,
                caption = json.optString(KEY_CAPTION, ""),
                printNumber = if (json.has(KEY_PRINT_NUMBER) && !json.isNull(KEY_PRINT_NUMBER)) json.optInt(KEY_PRINT_NUMBER) else null,
                renderedPath = printFile.absolutePath,
                originalPaths = originals,
                printed = json.optBoolean(KEY_PRINTED, false),
            )
        } catch (e: Exception) {
            Log.w(TAG, "meta.json illeggibile in ${dir.name}", e)
            null
        }
    }

    private fun writeMeta(dir: File, entry: HistoryEntry, seq: Long) {
        val json = JSONObject()
        json.put(KEY_VERSION, META_VERSION)
        json.put(KEY_ID, entry.id)
        json.put(KEY_CREATED_AT, entry.createdAt)
        json.put(KEY_SEQ, seq)
        json.put(KEY_TEMPLATE, entry.template.name)
        json.put(KEY_CAPTION, entry.caption)
        entry.printNumber?.let { json.put(KEY_PRINT_NUMBER, it) }
        json.put(KEY_PRINTED, entry.printed)
        val names = JSONArray()
        entry.originalPaths.forEach { names.put(File(it).name) }
        json.put(KEY_ORIGINALS, names)

        // Scrittura atomica: o il vecchio meta.json o il nuovo, mai uno troncato.
        val tmp = File(dir, "$META_FILE.tmp")
        tmp.writeText(json.toString(), Charsets.UTF_8)
        val target = File(dir, META_FILE)
        if (!tmp.renameTo(target)) {
            target.delete()
            if (!tmp.renameTo(target)) throw java.io.IOException("meta.json non scritto in ${dir.name}")
        }
    }

    private fun writePrintPng(image: BitImage, file: File) {
        val bitmap = Bitmap.createBitmap(image.toArgb(), image.width, image.height, Bitmap.Config.ARGB_8888)
        try {
            FileOutputStream(file).use { out ->
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) {
                    throw java.io.IOException("PNG non codificato")
                }
            }
        } finally {
            bitmap.recycle()
        }
    }

    /** Salva un originale ridotto. Un originale perso non deve far perdere la voce intera. */
    private fun writeOriginal(source: Bitmap, file: File): Boolean {
        var software: Bitmap? = null
        var scaled: Bitmap? = null
        return try {
            // Le bitmap HARDWARE non si possono ridimensionare via Canvas software: prima una copia.
            val base: Bitmap = if (source.config == Bitmap.Config.HARDWARE) {
                val copy: Bitmap? = source.copy(Bitmap.Config.ARGB_8888, false)
                software = copy
                copy ?: return false
            } else {
                source
            }
            val longSide = max(base.width, base.height)
            val toWrite = if (longSide > ORIGINAL_MAX_SIDE) {
                val factor = ORIGINAL_MAX_SIDE.toFloat() / longSide
                val w = (base.width * factor).roundToInt().coerceAtLeast(1)
                val h = (base.height * factor).roundToInt().coerceAtLeast(1)
                Bitmap.createScaledBitmap(base, w, h, true).also { scaled = it }
            } else {
                base
            }
            val ok = FileOutputStream(file).use { out ->
                toWrite.compress(Bitmap.CompressFormat.JPEG, ORIGINAL_JPEG_QUALITY, out)
            }
            if (!ok) {
                Log.w(TAG, "JPEG non codificato: ${file.name}")
                file.delete()
            }
            ok
        } catch (e: Exception) {
            Log.w(TAG, "Originale non salvato: ${file.name}", e)
            file.delete()
            false
        } catch (e: OutOfMemoryError) {
            Log.w(TAG, "Memoria insufficiente per l'originale ${file.name}", e)
            file.delete()
            false
        } finally {
            // Si riciclano solo le copie create qui: gli originali appartengono al chiamante.
            scaled?.let { if (it !== source && it !== software) it.recycle() }
            software?.let { if (it !== source) it.recycle() }
        }
    }

    /** Id ordinabile e sicuro come segmento di URL (la rotta e history/{id}). */
    private fun newEntryDir(createdAt: Long): File {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(Date(createdAt))
        while (true) {
            val suffix = UUID.randomUUID().toString().replace("-", "").take(6)
            val dir = File(root, "$stamp-$suffix")
            if (!dir.exists()) return dir
        }
    }

    private fun isValidId(id: String): Boolean = id.isNotEmpty() && id.length <= 64 && ID_REGEX.matches(id)

    private companion object {
        const val TAG = "HistoryRepository"
        const val DIR_NAME = "history"
        const val PRINT_FILE = "print.png"
        const val META_FILE = "meta.json"
        const val MAX_ENTRIES = 200
        const val ORIGINAL_MAX_SIDE = 1600
        const val ORIGINAL_JPEG_QUALITY = 85
        const val META_VERSION = 1

        const val KEY_VERSION = "version"
        const val KEY_ID = "id"
        const val KEY_CREATED_AT = "createdAt"
        const val KEY_SEQ = "seq"
        const val KEY_TEMPLATE = "template"
        const val KEY_CAPTION = "caption"
        const val KEY_PRINT_NUMBER = "printNumber"
        const val KEY_PRINTED = "printed"
        const val KEY_ORIGINALS = "originals"

        val ID_REGEX = Regex("[a-z0-9-]+")

        /** Un ottavo dell'heap, al massimo 32 MB: bastano decine di anteprime da 384 punti. */
        fun previewCacheBytes(): Int {
            val eighth = Runtime.getRuntime().maxMemory() / 8
            return eighth.coerceIn(4L * 1024 * 1024, 32L * 1024 * 1024).toInt()
        }
    }
}
