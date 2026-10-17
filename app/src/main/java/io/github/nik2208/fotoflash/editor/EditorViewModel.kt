package io.github.nik2208.fotoflash.editor

import android.content.Intent
import android.graphics.Bitmap
import android.util.Log
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrintRequest
import io.github.nik2208.fotoflash.model.RenderedPrint
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.thermal.ToneAdjustments
import io.github.nik2208.fotoflash.thermal.toArgb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException

/** Fase della stampa, mostrata dal foglio di avanzamento. */
sealed interface PrintPhase {
    /** Nessuna stampa in corso: il foglio e chiuso. */
    data object Idle : PrintPhase

    /** Composizione e invio in corso: i dettagli (connessione, percentuale) li da PrinterManager.state. */
    data object Running : PrintPhase

    /** Stampa finita: l'esito arriva da PrintOutcome, non dallo stato della stampante. */
    data class Done(val outcome: PrintOutcome, val copies: Int) : PrintPhase
}

/** Stato dell'editor. Le foto sono una copia della sessione presa all'apertura. */
data class EditorUiState(
    val loading: Boolean = true,
    val photos: List<Bitmap> = emptyList(),
    val template: TemplateKind = TemplateKind.POLAROID,
    val caption: String = "",
    val tone: ToneAdjustments = ToneAdjustments(),
    val dither: DitherAlgorithm = DitherAlgorithm.ATKINSON,
    val copies: Int = 1,
    /** Anteprima in colori carta/inchiostro, stessi punti della stampa. */
    val preview: Bitmap? = null,
    /** Lunghezza della stampa in millimetri di carta (8 punti = 1 mm). */
    val paperLengthMm: Int = 0,
    val rendering: Boolean = false,
    val renderFailed: Boolean = false,
    val printPhase: PrintPhase = PrintPhase.Idle,
    val exporting: Boolean = false,
    /** Regolazioni di partenza (dalle impostazioni), per il pulsante "Ripristina". */
    val defaultTone: ToneAdjustments = ToneAdjustments(),
    val defaultDither: DitherAlgorithm = DitherAlgorithm.ATKINSON,
) {
    val isEmpty: Boolean get() = !loading && photos.isEmpty()
    val canPrint: Boolean get() = !loading && photos.isNotEmpty() && printPhase !is PrintPhase.Running
    val canExport: Boolean get() = preview != null && !exporting
    val adjustmentsChanged: Boolean get() = tone != defaultTone || dither != defaultDither
}

/** Eventi una tantum verso la schermata. */
sealed interface EditorEvent {
    data class Share(val intent: Intent) : EditorEvent
    data class Message(@StringRes val text: Int) : EditorEvent
}

class EditorViewModel(private val graph: AppGraph) : ViewModel() {

    private val coordinator = graph.coordinator

    private val _state = MutableStateFlow(EditorUiState())
    val state: StateFlow<EditorUiState> = _state.asStateFlow()

    private val _events = Channel<EditorEvent>(Channel.BUFFERED)
    val events: Flow<EditorEvent> = _events.receiveAsFlow()

    private var renderJob: Job? = null

    /** Richiesta e risultato dell'ultimo rendering riuscito: salva e condividi partono da qui. */
    private var current: Pair<PrintRequest, RenderedPrint>? = null

    /**
     * Ultima stampa inviata (scritta dallo scope dell'app). "Riprova" riusa la stessa istanza se nulla
     * e cambiato, cosi lo storico aggiorna la voce fallita invece di aggiungerne un doppione.
     */
    @Volatile
    private var lastSent: Pair<PrintRequest, RenderedPrint>? = null

    init {
        // Copia della sessione: se la fotocamera la svuota o la riempie mentre l'editor e ancora
        // nello stack, questa schermata continua a mostrare le foto con cui e stata aperta.
        val photos = graph.session.photos.value
        val suggested = graph.session.suggestedTemplate
        viewModelScope.launch {
            val settings = graph.settings.current()
            _state.update {
                it.copy(
                    loading = false,
                    photos = photos,
                    template = suggested ?: settings.template,
                    tone = settings.tone,
                    dither = settings.dither,
                    defaultTone = settings.tone,
                    defaultDither = settings.dither,
                    copies = settings.copies.coerceIn(MIN_COPIES, MAX_COPIES),
                )
            }
            if (photos.isEmpty()) return@launch
            scheduleRender(immediate = true)
            // Titolo, hashtag, data, numerazione e carta vengono dalle impostazioni: se cambiano
            // (anche il contatore dopo una stampa riuscita) l'anteprima si rifa da sola.
            graph.settings.settings
                .map { s -> listOf(s.eventTitle, s.hashtag, s.showDate, s.showPrintNumber, s.printCounter, s.paper) }
                .distinctUntilChanged()
                .drop(1)
                .collect { scheduleRender() }
        }
    }

    // ---------------------------------------------------------------- modifiche

    fun selectTemplate(template: TemplateKind) {
        if (template == _state.value.template) return
        _state.update { it.copy(template = template) }
        scheduleRender(immediate = true)
    }

    fun setCaption(text: String) {
        // Una riga sola: a capo e tabulazioni diventano spazi, poi il limite della spec.
        val clean = text.replace('\n', ' ').replace('\t', ' ').take(MAX_CAPTION)
        if (clean == _state.value.caption) return
        _state.update { it.copy(caption = clean) }
        scheduleRender()
    }

    fun setBrightness(value: Float) = updateTone { it.copy(brightness = value.coerceIn(-1f, 1f)) }

    fun setContrast(value: Float) = updateTone { it.copy(contrast = value.coerceIn(-1f, 1f)) }

    fun setSharpen(value: Float) = updateTone { it.copy(sharpen = value.coerceIn(0f, 1f)) }

    fun setAutoLevels(enabled: Boolean) = updateTone(immediate = true) { it.copy(autoLevels = enabled) }

    fun selectDither(algorithm: DitherAlgorithm) {
        if (algorithm == _state.value.dither) return
        _state.update { it.copy(dither = algorithm) }
        scheduleRender(immediate = true)
    }

    fun resetAdjustments() {
        val s = _state.value
        if (!s.adjustmentsChanged) return
        _state.update { it.copy(tone = s.defaultTone, dither = s.defaultDither) }
        scheduleRender(immediate = true)
    }

    fun setCopies(copies: Int) {
        _state.update { it.copy(copies = copies.coerceIn(MIN_COPIES, MAX_COPIES)) }
    }

    private fun updateTone(immediate: Boolean = false, transform: (ToneAdjustments) -> ToneAdjustments) {
        val next = transform(_state.value.tone)
        if (next == _state.value.tone) return
        _state.update { it.copy(tone = next) }
        scheduleRender(immediate)
    }

    // ---------------------------------------------------------------- anteprima

    /**
     * Rendering annullabile: ogni modifica cancella il precedente e, se non e immediata, aspetta
     * una breve pausa (gli slider mandano decine di valori al secondo).
     */
    private fun scheduleRender(immediate: Boolean = false) {
        if (_state.value.photos.isEmpty()) return
        renderJob?.cancel()
        _state.update { it.copy(rendering = true) }
        renderJob = viewModelScope.launch {
            if (!immediate) delay(RENDER_DEBOUNCE_MS)
            val s = _state.value
            try {
                val request = coordinator.buildRequest(s.photos, s.template, s.caption, s.tone, s.dither)
                val rendered = coordinator.render(request)
                val preview = paperPreview(rendered.bitImage)
                current = request to rendered
                _state.update {
                    it.copy(
                        preview = preview,
                        paperLengthMm = (rendered.bitImage.height + DOTS_PER_MM / 2) / DOTS_PER_MM,
                        rendering = false,
                        renderFailed = false,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "rendering dell'anteprima fallito", e)
                _state.update { it.copy(rendering = false, renderFailed = true) }
            }
        }
    }

    /**
     * Gli stessi punti della stampa, ma inchiostro su carta invece di nero su bianco: sul foglio
     * dell'anteprima il bianco puro si vedrebbe come un rettangolo staccato dalla carta.
     */
    private suspend fun paperPreview(image: BitImage): Bitmap = withContext(Dispatchers.Default) {
        Bitmap.createBitmap(image.toArgb(black = PREVIEW_INK, white = PREVIEW_PAPER), image.width, image.height, Bitmap.Config.ARGB_8888)
    }

    // ---------------------------------------------------------------- stampa

    /**
     * Stampa con i parametri correnti. Gira nello scope dell'app, non in quello del ViewModel:
     * se l'utente chiude il foglio o torna indietro a meta invio, la stampante non riceve mezza foto.
     * La richiesta si ricostruisce sempre (data e numero devono essere quelli del momento) e si
     * riusa il rendering dell'anteprima se coincide.
     */
    fun print() {
        val s = _state.value
        if (!s.canPrint) return
        val candidates = listOfNotNull(lastSent, current)
        _state.update { it.copy(printPhase = PrintPhase.Running) }
        graph.scope.launch {
            val outcome = try {
                val request = coordinator.buildRequest(s.photos, s.template, s.caption, s.tone, s.dither)
                val rendered = candidates.firstOrNull { it.first == request }?.second ?: coordinator.render(request)
                lastSent = request to rendered
                coordinator.printAndRecord(request, rendered, s.copies)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "stampa fallita prima dell'invio", e)
                PrintOutcome.Failure(PrintFailure.WRITE_FAILED, graph.appContext.getString(R.string.ed_error_render))
            }
            _state.update { it.copy(printPhase = PrintPhase.Done(outcome, s.copies)) }
        }
    }

    /** Chiude il foglio di avanzamento; durante l'invio non si chiude. */
    fun dismissPrint() {
        if (_state.value.printPhase is PrintPhase.Running) return
        _state.update { it.copy(printPhase = PrintPhase.Idle) }
    }

    /** "Nuova foto": la sessione e consumata, le sue bitmap possono essere liberate. */
    fun finishSession() {
        dismissPrint()
        graph.session.clear()
    }

    // ---------------------------------------------------------------- salva e condividi

    /** PNG in galleria + voce nello storico (ogni stampa, anche solo salvata, entra nello storico). */
    fun save() {
        if (_state.value.exporting) return
        _state.update { it.copy(exporting = true) }
        viewModelScope.launch {
            try {
                // Se c'e un rendering in arrivo si salva quello, non l'anteprima di un attimo fa.
                renderJob?.join()
                val ready = current
                if (ready == null) {
                    _events.send(EditorEvent.Message(R.string.ed_save_failed))
                    return@launch
                }
                val uri = graph.exporter.saveToGallery(ready.second.preview, exportName())
                if (uri == null) {
                    _events.send(EditorEvent.Message(R.string.ed_save_failed))
                    return@launch
                }
                try {
                    coordinator.saveOnly(ready.first, ready.second)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // Il PNG e in galleria: lo storico mancato non deve far sembrare fallito il salvataggio.
                    Log.w(TAG, "salvataggio nello storico fallito", e)
                }
                _events.send(EditorEvent.Message(R.string.ed_saved))
            } finally {
                _state.update { it.copy(exporting = false) }
            }
        }
    }

    fun share() {
        if (_state.value.exporting) return
        _state.update { it.copy(exporting = true) }
        viewModelScope.launch {
            try {
                renderJob?.join()
                val ready = current
                if (ready == null) {
                    _events.send(EditorEvent.Message(R.string.ed_share_failed))
                    return@launch
                }
                val intent = graph.exporter.shareIntent(ready.second.preview, exportName())
                _events.send(EditorEvent.Share(intent))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "condivisione fallita", e)
                _events.send(EditorEvent.Message(R.string.ed_share_failed))
            } finally {
                _state.update { it.copy(exporting = false) }
            }
        }
    }

    /** Messaggi decisi dalla schermata (es. permesso negato). */
    fun showMessage(@StringRes text: Int) {
        viewModelScope.launch { _events.send(EditorEvent.Message(text)) }
    }

    private fun exportName(): String =
        "FotoFlash_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())

    companion object {
        const val MAX_CAPTION = 40
        const val MIN_COPIES = 1
        const val MAX_COPIES = 5

        private const val TAG = "EditorViewModel"
        private const val RENDER_DEBOUNCE_MS = 150L
        /** Testina a 203 dpi: 8 punti per millimetro, su entrambe le larghezze di carta. */
        private const val DOTS_PER_MM = 8

        /** Ink e Paper del brand, come interi ARGB per la Bitmap dell'anteprima. */
        private const val PREVIEW_INK = 0xFF16130F.toInt()
        private const val PREVIEW_PAPER = 0xFFFBF8F1.toInt()
    }
}
