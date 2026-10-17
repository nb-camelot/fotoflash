package io.github.nik2208.fotoflash.history

import android.content.Intent
import android.graphics.Bitmap
import android.util.Log
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.HistoryEntry
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.PaperWidth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Griglia dello storico: espone l'indice del repository, il caricamento delle miniature e
 * l'esportazione di tutte le foto in galleria.
 */
class HistoryViewModel(private val graph: AppGraph) : ViewModel() {
    val entries: StateFlow<List<HistoryEntry>> = graph.history.entries
    val loaded: StateFlow<Boolean> = graph.history.loaded

    /**
     * Foto originali in tutto lo storico. Si contano i percorsi gia verificati alla lettura
     * dell'indice: niente accessi al disco a ogni cambio della lista.
     */
    val photoCount: StateFlow<Int> = entries
        .map { list -> countPhotos(list) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), countPhotos(entries.value))

    /** Lo stato vive fuori dal ViewModel: sopravvive a rotazione e uscita dalla schermata. */
    val exportState: StateFlow<PhotoExportState> = PhotoExport.state

    /** Android 8-9 senza WRITE_EXTERNAL_STORAGE: la schermata deve chiederlo prima di esportare. */
    fun needsStoragePermission(): Boolean = graph.exporter.needsLegacyWritePermission()

    /** Ignorata se un'esportazione e gia in corso: un secondo tocco non raddoppia le copie. */
    fun startExport() {
        PhotoExport.start(graph)
    }

    fun cancelExport() = PhotoExport.cancel()

    fun dismissExportResult() = PhotoExport.dismiss()

    suspend fun loadPreview(entry: HistoryEntry): Bitmap? = graph.history.loadPreview(entry)

    private companion object {
        fun countPhotos(list: List<HistoryEntry>): Int = list.sumOf { it.originalPaths.size }
    }
}

/** Azioni del dettaglio che possono essere in corso, una per tipo. */
enum class DetailAction { PRINT, SAVE, SAVE_PHOTOS, SHARE, DELETE }

/** Stato dell'anteprima grande nel dettaglio. */
sealed interface PreviewState {
    data object Loading : PreviewState
    data class Ready(val bitmap: Bitmap) : PreviewState
    data object Failed : PreviewState
}

data class HistoryDetailUiState(
    val loaded: Boolean = false,
    val entry: HistoryEntry? = null,
    val preview: PreviewState = PreviewState.Loading,
    val busy: Set<DetailAction> = emptySet(),
    /** Avanzamento 0..1 della ristampa in corso, null se non si sta ristampando. */
    val printProgress: Float? = null,
)

/**
 * Azione proposta nella snackbar quando qualcosa non riesce: l'errore va detto insieme al rimedio.
 * STORAGE apre le impostazioni dell'app (permesso di archiviazione negato su Android 8-9).
 */
enum class ReprintFix { RETRY, BLUETOOTH, PERMISSION, PRINTER, STORAGE }

/** Eventi una tantum verso la UI (snackbar, chooser di condivisione, uscita dopo l'eliminazione). */
sealed interface HistoryDetailEvent {
    /** [args] riempie i segnaposto del testo; [fix] e l'azione della snackbar, se c'e. */
    data class Message(
        @StringRes val resId: Int,
        val args: List<Any> = emptyList(),
        val fix: ReprintFix? = null,
    ) : HistoryDetailEvent

    /** Testo al plurale ("1 foto salvata", "2 foto salvate"): [quantity] sceglie la forma, [args] i numeri. */
    data class PluralMessage(
        @PluralsRes val resId: Int,
        val quantity: Int,
        val args: List<Any> = emptyList(),
    ) : HistoryDetailEvent

    data class Share(val intent: Intent) : HistoryDetailEvent
    data object Deleted : HistoryDetailEvent
}

/** Esito interno della ristampa: non tutto e un PrintFailure (file rovinato, carta piu stretta della stampa). */
private sealed interface ReprintResult {
    data object LoadFailed : ReprintResult
    data class PaperTooNarrow(val mm: Int?) : ReprintResult
    data class Done(val outcome: PrintOutcome) : ReprintResult
}

class HistoryDetailViewModel(private val graph: AppGraph, private val entryId: String) : ViewModel() {

    private val history = graph.history
    private val _preview = MutableStateFlow<PreviewState>(PreviewState.Loading)
    private val _busy = MutableStateFlow<Set<DetailAction>>(emptySet())
    private val _events = Channel<HistoryDetailEvent>(Channel.BUFFERED)

    /** Ultima voce vista: resta a schermo mentre la si elimina, invece di "non trovata". */
    private var lastEntry: HistoryEntry? = null

    val events: Flow<HistoryDetailEvent> = _events.receiveAsFlow()

    val state: StateFlow<HistoryDetailUiState> = combine(
        history.entries,
        history.loaded,
        _preview,
        _busy,
        graph.printer.state,
    ) { list, loaded, preview, busy, printer ->
        val found = list.firstOrNull { it.id == entryId }
        if (found != null) lastEntry = found
        val entry = found ?: lastEntry.takeIf { DetailAction.DELETE in busy }
        HistoryDetailUiState(
            loaded = loaded,
            entry = entry,
            preview = preview,
            busy = busy,
            printProgress = if (DetailAction.PRINT in busy) (printer as? PrinterState.Printing)?.progress else null,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HistoryDetailUiState())

    init {
        viewModelScope.launch {
            history.loaded.first { it }
            val entry = history.find(entryId)
            if (entry == null) {
                _preview.value = PreviewState.Failed
            } else {
                val bitmap = history.loadPreview(entry)
                _preview.value = if (bitmap != null) PreviewState.Ready(bitmap) else PreviewState.Failed
            }
        }
    }

    fun reprint() {
        val entry = currentEntry() ?: return
        if (!begin(DetailAction.PRINT)) return
        // La stampa gira nello scope dell'app: uscire dalla schermata non deve troncarla a meta foglio.
        val job = graph.scope.async<ReprintResult> {
            val image = history.loadBitImage(entry) ?: return@async ReprintResult.LoadFailed
            // GS v 0 usa la larghezza dell'immagine: una stampa da 80 mm su una testina da 58 esce a
            // righe spezzate ma risulterebbe "stampata". Una stampa piu stretta della carta invece va bene.
            val paper = graph.settings.current().paper
            if (image.width > paper.dots) {
                return@async ReprintResult.PaperTooNarrow(PaperWidth.entries.firstOrNull { it.dots == image.width }?.mm)
            }
            val outcome = graph.printer.print(image, 1)
            if (outcome is PrintOutcome.Success) history.markPrinted(entry.id)
            ReprintResult.Done(outcome)
        }
        viewModelScope.launch {
            try {
                val message = when (val result = job.await()) {
                    ReprintResult.LoadFailed -> HistoryDetailEvent.Message(R.string.hist_msg_load_failed)
                    is ReprintResult.PaperTooNarrow -> result.mm?.let { mm ->
                        HistoryDetailEvent.Message(R.string.hist_msg_paper_mismatch, listOf(mm), ReprintFix.PRINTER)
                    } ?: HistoryDetailEvent.Message(R.string.hist_msg_paper_mismatch_generic, fix = ReprintFix.PRINTER)
                    is ReprintResult.Done -> when (val outcome = result.outcome) {
                        is PrintOutcome.Success -> HistoryDetailEvent.Message(R.string.hist_msg_printed)
                        is PrintOutcome.Failure -> HistoryDetailEvent.Message(
                            resId = failureMessage(outcome.failure),
                            fix = failureFix(outcome.failure),
                        )
                    }
                }
                _events.send(message)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Ristampa fallita", e)
                _events.send(HistoryDetailEvent.Message(R.string.hist_fail_write))
            } finally {
                end(DetailAction.PRINT)
            }
        }
    }

    fun save() {
        val entry = currentEntry() ?: return
        if (!begin(DetailAction.SAVE)) return
        viewModelScope.launch {
            try {
                val bitmap = previewBitmap() ?: history.loadPreview(entry)
                val uri = if (bitmap != null) graph.exporter.saveToGallery(bitmap, displayName(entry)) else null
                _events.send(
                    HistoryDetailEvent.Message(if (uri != null) R.string.hist_msg_saved else R.string.hist_msg_save_failed),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Salvataggio in galleria fallito", e)
                _events.send(HistoryDetailEvent.Message(R.string.hist_msg_save_failed))
            } finally {
                end(DetailAction.SAVE)
            }
        }
    }

    /**
     * Salva in galleria tutte le foto originali della voce (non la stampa: per quella c'e [save]).
     * Gira nello scope dell'app: uscire dalla schermata non lascia l'esportazione a meta.
     */
    fun savePhotos() {
        val entry = currentEntry() ?: return
        if (!begin(DetailAction.SAVE_PHOTOS)) return
        val job = graph.scope.async { saveEntryPhotos(graph, entry) }
        viewModelScope.launch {
            try {
                val result = job.await()
                val event = when {
                    result.total == 0 -> HistoryDetailEvent.Message(R.string.hist_msg_no_photos)
                    result.saved == result.total -> HistoryDetailEvent.PluralMessage(
                        resId = R.plurals.hist_msg_photos_saved,
                        quantity = result.saved,
                        args = listOf(result.saved),
                    )
                    result.saved == 0 -> HistoryDetailEvent.Message(R.string.hist_msg_photos_failed)
                    else -> HistoryDetailEvent.PluralMessage(
                        resId = R.plurals.hist_msg_photos_partial,
                        quantity = result.saved,
                        args = listOf(result.saved, result.total),
                    )
                }
                _events.send(event)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Salvataggio delle foto fallito", e)
                _events.send(HistoryDetailEvent.Message(R.string.hist_msg_photos_failed))
            } finally {
                end(DetailAction.SAVE_PHOTOS)
            }
        }
    }

    fun share() {
        val entry = currentEntry() ?: return
        if (!begin(DetailAction.SHARE)) return
        viewModelScope.launch {
            try {
                val bitmap = previewBitmap() ?: history.loadPreview(entry)
                if (bitmap == null) {
                    _events.send(HistoryDetailEvent.Message(R.string.hist_msg_load_failed))
                } else {
                    val intent = graph.exporter.shareIntent(bitmap, displayName(entry))
                    _events.send(HistoryDetailEvent.Share(intent))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Condivisione fallita", e)
                _events.send(HistoryDetailEvent.Message(R.string.hist_msg_share_failed))
            } finally {
                end(DetailAction.SHARE)
            }
        }
    }

    fun delete() {
        if (currentEntry() == null) return
        if (!begin(DetailAction.DELETE)) return
        viewModelScope.launch {
            history.delete(entryId)
            // DELETE resta "in corso": la schermata sta per chiudersi e deve mostrare ancora la voce.
            _events.send(HistoryDetailEvent.Deleted)
        }
    }

    /** Android 8-9: true se va chiesto WRITE_EXTERNAL_STORAGE prima di salvare stampa o foto. */
    fun needsStoragePermission(): Boolean = graph.exporter.needsLegacyWritePermission()

    /** Android 8-9 senza permesso di scrittura: niente salvataggio, ma diciamo perche e dove rimediare. */
    fun onStoragePermissionDenied() {
        viewModelScope.launch {
            _events.send(HistoryDetailEvent.Message(R.string.hist_msg_storage_permission, fix = ReprintFix.STORAGE))
        }
    }

    private fun currentEntry(): HistoryEntry? = history.find(entryId) ?: lastEntry

    private fun previewBitmap(): Bitmap? = (_preview.value as? PreviewState.Ready)?.bitmap

    private fun begin(action: DetailAction): Boolean {
        if (action in _busy.value || DetailAction.DELETE in _busy.value) return false
        _busy.update { it + action }
        return true
    }

    private fun end(action: DetailAction) {
        _busy.update { it - action }
    }

    private companion object {
        const val TAG = "HistoryDetailViewModel"

        fun displayName(entry: HistoryEntry): String = "FotoFlash_${entry.id}"

        @StringRes
        fun failureMessage(failure: PrintFailure): Int = when (failure) {
            PrintFailure.NO_PRINTER -> R.string.hist_fail_no_printer
            PrintFailure.NO_PERMISSION -> R.string.hist_fail_no_permission
            PrintFailure.BLUETOOTH_OFF -> R.string.hist_fail_bluetooth_off
            PrintFailure.NOT_BONDED -> R.string.hist_fail_not_bonded
            PrintFailure.CONNECT_FAILED -> R.string.hist_fail_connect
            PrintFailure.WRITE_FAILED -> R.string.hist_fail_write
            PrintFailure.BUSY -> R.string.hist_fail_busy
            PrintFailure.RENDER_FAILED -> R.string.hist_fail_render
        }

        /** Rimedio da proporre: per un errore di composizione non c'e nulla da sistemare sulla stampante. */
        fun failureFix(failure: PrintFailure): ReprintFix? = when (failure) {
            PrintFailure.NO_PRINTER -> ReprintFix.PRINTER
            PrintFailure.NO_PERMISSION -> ReprintFix.PERMISSION
            PrintFailure.BLUETOOTH_OFF, PrintFailure.NOT_BONDED -> ReprintFix.BLUETOOTH
            PrintFailure.CONNECT_FAILED, PrintFailure.WRITE_FAILED, PrintFailure.BUSY -> ReprintFix.RETRY
            PrintFailure.RENDER_FAILED -> null
        }
    }
}
