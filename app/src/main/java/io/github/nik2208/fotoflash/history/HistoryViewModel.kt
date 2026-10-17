package io.github.nik2208.fotoflash.history

import android.content.Intent
import android.graphics.Bitmap
import android.util.Log
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.HistoryEntry
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Griglia dello storico: espone l'indice del repository e il caricamento delle miniature. */
class HistoryViewModel(private val graph: AppGraph) : ViewModel() {
    val entries: StateFlow<List<HistoryEntry>> = graph.history.entries
    val loaded: StateFlow<Boolean> = graph.history.loaded

    suspend fun loadPreview(entry: HistoryEntry): Bitmap? = graph.history.loadPreview(entry)
}

/** Azioni del dettaglio che possono essere in corso, una per tipo. */
enum class DetailAction { PRINT, SAVE, SHARE, DELETE }

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

/** Eventi una tantum verso la UI (snackbar, chooser di condivisione, uscita dopo l'eliminazione). */
sealed interface HistoryDetailEvent {
    data class Message(@StringRes val resId: Int) : HistoryDetailEvent
    data class Share(val intent: Intent) : HistoryDetailEvent
    data object Deleted : HistoryDetailEvent
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
        val job = graph.scope.async {
            val image = history.loadBitImage(entry) ?: return@async null
            val outcome = graph.printer.print(image, 1)
            if (outcome is PrintOutcome.Success) history.markPrinted(entry.id)
            outcome
        }
        viewModelScope.launch {
            try {
                val message = when (val outcome = job.await()) {
                    null -> R.string.hist_msg_load_failed
                    is PrintOutcome.Success -> R.string.hist_msg_printed
                    is PrintOutcome.Failure -> failureMessage(outcome.failure)
                }
                _events.send(HistoryDetailEvent.Message(message))
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

    /** Android 8-9 senza permesso di scrittura: niente salvataggio, ma diciamo perche. */
    fun onStoragePermissionDenied() {
        viewModelScope.launch { _events.send(HistoryDetailEvent.Message(R.string.hist_msg_storage_permission)) }
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
        }
    }
}
