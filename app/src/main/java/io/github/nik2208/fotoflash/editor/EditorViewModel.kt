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
import io.github.nik2208.fotoflash.print.centerCrop
import io.github.nik2208.fotoflash.print.toGrayImage
import io.github.nik2208.fotoflash.thermal.Backlight
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.TemplateGeometry
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.thermal.ToneAdjustments
import io.github.nik2208.fotoflash.thermal.toArgb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
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
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

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
    /**
     * Quanto le foto, ritagliate come nel modello scelto, sono in controluce (0..1, il massimo tra
     * le foto): lo stesso Backlight.score con cui Tone decide di schiarire. 0 finche non e calcolato.
     */
    val backlightScore: Float = 0f,
) {
    val isEmpty: Boolean get() = !loading && photos.isEmpty()
    val canPrint: Boolean get() = !loading && photos.isNotEmpty() && printPhase !is PrintPhase.Running
    val canExport: Boolean get() = preview != null && !exporting
    val adjustmentsChanged: Boolean get() = tone != defaultTone || dither != defaultDither

    /** La foto sembra in controluce, che la correzione automatica sia accesa o no. */
    val backlightLikely: Boolean get() = backlightScore > EditorViewModel.BACKLIGHT_THRESHOLD

    /** Controluce riconosciuto e corretto: spiega all'utente perche l'immagine e stata schiarita. */
    val backlightDetected: Boolean get() = tone.autoBacklight && backlightLikely
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

    /** Ritagli per cui il punteggio di controluce e gia calcolato (o in calcolo), e il job che lo calcola. */
    private data class BacklightKey(val template: TemplateKind, val paper: PaperWidth, val photoCount: Int)

    private var backlightKey: BacklightKey? = null
    private var backlightJob: Job? = null

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

    fun setShadows(value: Float) = updateTone { it.copy(shadows = value.coerceIn(0f, 1f)) }

    fun setLocalContrast(value: Float) = updateTone { it.copy(localContrast = value.coerceIn(0f, 1f)) }

    fun setAutoBacklight(enabled: Boolean) = updateTone(immediate = true) { it.copy(autoBacklight = enabled) }

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
                updateBacklight(request)
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
                clearPreview()
            } catch (e: OutOfMemoryError) {
                Log.e(TAG, "rendering dell'anteprima fallito (memoria)", e)
                clearPreview()
            }
        }
    }

    /**
     * Dopo un rendering fallito il risultato vecchio non vale piu (WYSIWYG): niente anteprima di un
     * altro modello, e Salva/Condividi restano spenti finche un rendering non riesce.
     */
    private fun clearPreview() {
        current = null
        _state.update { it.copy(rendering = false, renderFailed = true, preview = null, paperLengthMm = 0) }
    }

    /**
     * Ricalcola il punteggio di controluce solo quando cambiano i ritagli delle foto (modello, carta,
     * numero di foto): le regolazioni non lo toccano, perche Tone lo misura sulla foto prima di
     * correggerla. Gira in un job a parte, cosi gli slider che annullano il rendering non lo fermano.
     */
    private fun updateBacklight(request: PrintRequest) {
        val key = BacklightKey(request.template, request.paper, request.photos.size)
        if (key == backlightKey) return
        backlightKey = key
        backlightJob?.cancel()
        backlightJob = viewModelScope.launch {
            // Fino al nuovo valore resta quello del ritaglio precedente: niente lampeggio del badge.
            val score = backlightScore(request) ?: 0f
            _state.update { it.copy(backlightScore = score) }
        }
    }

    /**
     * Backlight.score di ogni foto, ritagliata con il rapporto del suo riquadro come fa il renderer ma
     * ridotta a pochi pixel: per confrontare centro e bordi basta, e costa pochi millisecondi.
     * Restituisce il massimo (nella Striscia basta una foto in controluce) o null se fallisce.
     */
    private suspend fun backlightScore(request: PrintRequest): Float? = withContext(Dispatchers.Default) {
        try {
            val layout = TemplateGeometry.layout(request.template, request.paper, request.photos.size, request.texts)
            var best = 0f
            layout.photos.forEachIndexed { index, rect ->
                ensureActive()
                if (rect.width <= 0 || rect.height <= 0) return@forEachIndexed
                val photo = request.photos[index % request.photos.size]
                val k = min(1f, BACKLIGHT_SAMPLE_SIDE.toFloat() / max(rect.width, rect.height).toFloat())
                val small = photo.centerCrop(
                    (rect.width * k).roundToInt().coerceAtLeast(1),
                    (rect.height * k).roundToInt().coerceAtLeast(1),
                )
                val gray = try {
                    small.toGrayImage()
                } finally {
                    // centerCrop non ricicla mai l'originale e puo restituirlo: si libera solo la copia.
                    if (small !== photo) small.recycle()
                }
                val score = Backlight.score(gray)
                if (!score.isNaN()) best = max(best, score.coerceIn(0f, 1f))
            }
            best
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "misura del controluce fallita", e)
            null
        } catch (e: OutOfMemoryError) {
            Log.w(TAG, "misura del controluce fallita (memoria)", e)
            null
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
     * La richiesta si ricostruisce sempre (il numero deve essere quello del momento); se coincide
     * con l'anteprima mostrata o con l'ultimo invio, a meno del valore della data, si riusa quel
     * rendering: sulla carta va la data dell'anteprima (WYSIWYG) e "Riprova" non crea doppioni.
     */
    fun print() {
        val s = _state.value
        if (!s.canPrint) return
        val candidates = listOfNotNull(lastSent, current)
        _state.update { it.copy(printPhase = PrintPhase.Running) }
        graph.scope.launch {
            // Prima la composizione, poi la stampa: un errore qui non e colpa della stampante.
            var cause: Throwable? = null
            val prepared: Pair<PrintRequest, RenderedPrint>? = try {
                val request = coordinator.buildRequest(s.photos, s.template, s.caption, s.tone, s.dither)
                candidates.firstOrNull { it.first.sameJob(request) } ?: (request to coordinator.render(request))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                cause = e
                null
            } catch (e: OutOfMemoryError) {
                cause = e
                null
            }
            val outcome = if (prepared == null) {
                Log.e(TAG, "composizione della stampa fallita", cause)
                // Titolo e consiglio li da il foglio; qui resta il dettaglio tecnico, mostrato in piccolo.
                PrintOutcome.Failure(PrintFailure.RENDER_FAILED, cause?.message ?: cause?.javaClass?.simpleName.orEmpty())
            } else {
                lastSent = prepared
                coordinator.printAndRecord(prepared.first, prepared.second, s.copies)
            }
            _state.update { it.copy(printPhase = PrintPhase.Done(outcome, s.copies)) }
        }
    }

    /**
     * "Ristampa" dal foglio "Stampato!": la stessa carta appena uscita, senza ricomporre e senza
     * consumare un altro numero (come la ristampa dallo storico).
     */
    fun reprint() {
        val s = _state.value
        if (s.printPhase is PrintPhase.Running) return
        val sent = lastSent ?: return print()
        _state.update { it.copy(printPhase = PrintPhase.Running) }
        graph.scope.launch {
            val outcome = coordinator.printAndRecord(sent.first, sent.second, s.copies)
            _state.update { it.copy(printPhase = PrintPhase.Done(outcome, s.copies)) }
        }
    }

    /** Stesso lavoro di stampa a meno del valore della data (che cambia ogni minuto); la presenza conta. */
    private fun PrintRequest.sameJob(other: PrintRequest): Boolean =
        copy(texts = texts.copy(dateText = texts.dateText?.let { "" })) ==
            other.copy(texts = other.texts.copy(dateText = other.texts.dateText?.let { "" }))

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
                } catch (e: OutOfMemoryError) {
                    Log.w(TAG, "salvataggio nello storico fallito (memoria)", e)
                }
                _events.send(EditorEvent.Message(R.string.ed_saved))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "salvataggio fallito", e)
                _events.send(EditorEvent.Message(R.string.ed_save_failed))
            } catch (e: OutOfMemoryError) {
                // L'ingrandimento 2x di una striscia lunga puo non stare in memoria: messaggio, non crash.
                Log.w(TAG, "salvataggio fallito (memoria)", e)
                _events.send(EditorEvent.Message(R.string.ed_save_failed))
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
            } catch (e: OutOfMemoryError) {
                Log.w(TAG, "condivisione fallita (memoria)", e)
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

        /** Sopra questo punteggio la foto si considera in controluce (badge e suggerimento). */
        const val BACKLIGHT_THRESHOLD = 0.4f

        private const val TAG = "EditorViewModel"

        /** Lato lungo, in pixel, del campione su cui si misura il controluce. */
        private const val BACKLIGHT_SAMPLE_SIDE = 160
        private const val RENDER_DEBOUNCE_MS = 120L
        /** Testina a 203 dpi: 8 punti per millimetro, su entrambe le larghezze di carta. */
        private const val DOTS_PER_MM = 8

        /** Ink e Paper del brand, come interi ARGB per la Bitmap dell'anteprima. */
        private const val PREVIEW_INK = 0xFF16130F.toInt()
        private const val PREVIEW_PAPER = 0xFFFBF8F1.toInt()
    }
}
