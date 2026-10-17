package io.github.nik2208.fotoflash.history

import android.util.Log
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.HistoryEntry
import io.github.nik2208.fotoflash.print.Exporter
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Stato dell'esportazione di tutte le foto originali dello storico in galleria. */
sealed interface PhotoExportState {
    /** Niente da mostrare. */
    data object Idle : PhotoExportState

    /** In corso: [done] foto elaborate su [total]; [total] e 0 finche l'elenco non e pronto. */
    data class Running(val done: Int, val total: Int) : PhotoExportState

    /** Finita in uno dei modi di [end]: resta visibile finche l'utente non la chiude. */
    data class Finished(val saved: Int, val failed: Int, val total: Int, val end: ExportEnd) : PhotoExportState
}

enum class ExportEnd {
    COMPLETED,

    /** Annullata dall'utente: le foto gia salvate restano in galleria. */
    CANCELLED,

    /** Fermata dopo troppi errori di fila (memoria piena, galleria non scrivibile). */
    ABORTED,
}

/** Esito del salvataggio delle foto di una sola voce, per il dettaglio. */
internal data class EntryPhotosResult(val saved: Int, val total: Int)

/**
 * Esportazione di tutte le foto originali dello storico in Pictures/FotoFlash/Scatti.
 *
 * Deve vivere piu a lungo della schermata: il lavoro gira in graph.scope e lo stato sta qui, cosi
 * dopo una rotazione o tornando nello storico piu tardi si ritrova l'avanzamento (o il risultato) e un
 * secondo tocco non avvia una seconda esportazione. E un oggetto perche AppGraph, unico per processo,
 * e fuori da quest'area: la durata coincide.
 */
internal object PhotoExport {

    private const val TAG = "PhotoExport"

    /** Oltre questi errori consecutivi non ha senso insistere: la galleria non accetta file. */
    private const val MAX_CONSECUTIVE_FAILURES = 5

    private val lock = Any()
    private val _state = MutableStateFlow<PhotoExportState>(PhotoExportState.Idle)
    val state: StateFlow<PhotoExportState> = _state.asStateFlow()

    private var job: Job? = null

    /**
     * L'annullamento e un flag letto tra una foto e l'altra, non la cancellazione della coroutine:
     * la foto in copia arriva in fondo e i conteggi del risultato sono esatti.
     */
    private val cancelRequested = AtomicBoolean(false)

    /** Avvia l'esportazione delle voci presenti ora; false (e nessun effetto) se ce n'e gia una in corso. */
    fun start(graph: AppGraph): Boolean = synchronized(lock) {
        if (job?.isActive == true) return@synchronized false
        val snapshot = graph.history.entries.value
        cancelRequested.set(false)
        _state.value = PhotoExportState.Running(done = 0, total = 0)
        job = graph.scope.launch(Dispatchers.IO) { exportAll(graph, snapshot) }
        true
    }

    fun cancel() {
        synchronized(lock) {
            if (job?.isActive == true) cancelRequested.set(true)
        }
    }

    /** Chiude il riquadro del risultato; un'esportazione in corso non si nasconde. */
    fun dismiss() {
        _state.update { if (it is PhotoExportState.Finished) PhotoExportState.Idle else it }
    }

    private suspend fun exportAll(graph: AppGraph, entries: List<HistoryEntry>) {
        var saved = 0
        var failed = 0
        var total = 0
        try {
            // Dalla piu vecchia alla piu recente: in galleria l'ultima copiata (la piu recente) finisce in cima.
            val photos = entries.asReversed().flatMap { entry ->
                graph.history.originalFiles(entry).mapIndexed { index, file -> file to photoDisplayName(entry, index + 1) }
            }
            total = photos.size
            _state.value = PhotoExportState.Running(done = 0, total = total)

            var consecutiveFailures = 0
            for ((index, photo) in photos.withIndex()) {
                if (cancelRequested.get()) {
                    _state.value = PhotoExportState.Finished(saved, failed, total, ExportEnd.CANCELLED)
                    return
                }
                val (file, name) = photo
                // Voce eliminata durante l'esportazione: non e un errore, la si salta.
                if (file.isFile) {
                    if (saveOriginal(graph.exporter, file, name)) {
                        saved++
                        consecutiveFailures = 0
                    } else {
                        failed++
                        consecutiveFailures++
                    }
                }
                _state.value = PhotoExportState.Running(done = index + 1, total = total)
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    Log.w(TAG, "Esportazione fermata dopo $consecutiveFailures errori di fila")
                    _state.value = PhotoExportState.Finished(saved, failed, total, ExportEnd.ABORTED)
                    return
                }
            }
            _state.value = PhotoExportState.Finished(saved, failed, total, ExportEnd.COMPLETED)
        } catch (e: CancellationException) {
            // Solo se muore lo scope dell'app: lo stato non deve restare "in corso" per sempre.
            _state.value = PhotoExportState.Finished(saved, failed, total, ExportEnd.CANCELLED)
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Esportazione delle foto fallita", e)
            _state.value = PhotoExportState.Finished(saved, failed, total, ExportEnd.ABORTED)
        }
    }
}

/**
 * Salva in galleria tutte le foto originali di una voce, nell'ordine degli scatti.
 * Le foto non salvate si contano, non interrompono le altre.
 */
internal suspend fun saveEntryPhotos(graph: AppGraph, entry: HistoryEntry): EntryPhotosResult {
    val files = withContext(Dispatchers.IO) { graph.history.originalFiles(entry) }
    var saved = 0
    files.forEachIndexed { index, file ->
        if (saveOriginal(graph.exporter, file, photoDisplayName(entry, index + 1))) saved++
    }
    return EntryPhotosResult(saved = saved, total = files.size)
}

/** Una foto; false se l'Exporter non l'ha salvata o ha lanciato un errore (finito nel log). */
private suspend fun saveOriginal(exporter: Exporter, file: File, displayName: String): Boolean = try {
    exporter.savePhotoFileToGallery(file, displayName) != null
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Log.w("PhotoExport", "Foto ${file.name} non salvata", e)
    false
}

/** Data e ora locali dello scatto, con cifre ASCII qualunque sia la lingua del telefono. */
private val NAME_STAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss", Locale.ROOT)

/**
 * Nome leggibile in galleria: FotoFlash_<data>_<n> (l'Exporter aggiunge ".jpg"), con lo stesso
 * prefisso degli scatti salvati dalla fotocamera: nella cartella Scatti stanno insieme.
 * Due voci nello stesso secondo, o una seconda esportazione, prendono un suffisso dall'Exporter.
 */
internal fun photoDisplayName(entry: HistoryEntry, number: Int): String {
    val stamp = NAME_STAMP.format(Instant.ofEpochMilli(entry.createdAt).atZone(ZoneId.systemDefault()))
    return "FotoFlash_${stamp}_$number"
}
