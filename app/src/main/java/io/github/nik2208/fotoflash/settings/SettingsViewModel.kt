package io.github.nik2208.fotoflash.settings

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.ToneAdjustments
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(private val graph: AppGraph) : ViewModel() {

    /** null finche il DataStore non ha risposto: la UI non mostra valori di default finti. */
    val settings: StateFlow<AppSettings?> = graph.settings.settings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val printerState: StateFlow<PrinterState> = graph.printer.state

    /**
     * Testo dei campi mentre l'utente scrive (null = mostra il valore salvato). E stato Compose
     * aggiornato in modo sincrono: passare da un flow asincrono farebbe saltare il cursore.
     */
    var eventTitleDraft by mutableStateOf<String?>(null)
        private set
    var hashtagDraft by mutableStateOf<String?>(null)
        private set

    private var titleJob: Job? = null
    private var hashtagJob: Job? = null
    private var pendingTitle: String? = null
    private var pendingHashtag: String? = null

    /**
     * Scritture in coda, eseguite in ordine nello scope dell'app: due tocchi rapidi sullo stesso
     * interruttore non si invertono, e uscire dalla schermata non perde l'ultima modifica.
     */
    private val writes = Channel<(AppSettings) -> AppSettings>(Channel.UNLIMITED)

    init {
        graph.scope.launch {
            for (transform in writes) {
                try {
                    graph.settings.update(transform)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Impostazione non salvata", e)
                }
            }
        }
    }

    fun update(transform: (AppSettings) -> AppSettings) {
        writes.trySend(transform)
    }

    fun onEventTitleChange(text: String) {
        val clipped = text.take(MAX_EVENT_TITLE)
        eventTitleDraft = clipped
        pendingTitle = clipped
        titleJob?.cancel()
        titleJob = viewModelScope.launch {
            delay(DEBOUNCE_MS)
            flushTitle()
        }
    }

    fun onHashtagChange(text: String) {
        val clipped = text.take(MAX_HASHTAG)
        hashtagDraft = clipped
        pendingHashtag = clipped
        hashtagJob?.cancel()
        hashtagJob = viewModelScope.launch {
            delay(DEBOUNCE_MS)
            flushHashtag()
        }
    }

    /** Salva subito i campi di testo (tasto "Fatto" della tastiera, perdita del fuoco). */
    fun commitTextFields() {
        titleJob?.cancel()
        hashtagJob?.cancel()
        flushTitle()
        flushHashtag()
    }

    fun resetCounter() = update { it.copy(printCounter = 0) }

    /** Il retino "di serie" e quello del driver in uso: Floyd-Steinberg sulle Phomemo, Atkinson sulle ESC/POS. */
    fun resetImageDefaults() {
        update { it.copy(dither = PrinterDrivers.byId(it.printerDriver).defaultDither, tone = ToneAdjustments()) }
    }

    private fun flushTitle() {
        val text = pendingTitle ?: return
        pendingTitle = null
        update { it.copy(eventTitle = text.trim()) }
    }

    private fun flushHashtag() {
        val text = pendingHashtag ?: return
        pendingHashtag = null
        update { it.copy(hashtag = text.trim()) }
    }

    override fun onCleared() {
        // viewModelScope e gia cancellato: i testi in attesa del debounce si salvano qui.
        flushTitle()
        flushHashtag()
        writes.close()
        super.onCleared()
    }

    companion object {
        const val MAX_EVENT_TITLE = 32
        const val MAX_HASHTAG = 32
        private const val DEBOUNCE_MS = 500L
        private const val TAG = "SettingsViewModel"
    }
}
