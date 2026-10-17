package io.github.nik2208.fotoflash.camera

import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import androidx.annotation.StringRes
import androidx.camera.core.ImageCapture
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.CaptureSource
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrintRequest
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.model.RenderedPrint
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.ui.theme.FfColors
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** Modalita di scatto scelta sopra l'otturatore. */
enum class CaptureMode { PHOTO, STRIP }

/** Flash dello scatto, nell'ordine in cui il pulsante li fa ruotare. */
enum class FlashMode(val cameraXMode: Int) {
    AUTO(ImageCapture.FLASH_MODE_AUTO),
    ON(ImageCapture.FLASH_MODE_ON),
    OFF(ImageCapture.FLASH_MODE_OFF),
    ;

    fun next(): FlashMode = when (this) {
        AUTO -> ON
        ON -> OFF
        OFF -> AUTO
    }
}

/** Avanzamento di una striscia da fotocabina: le miniature si riempiono una alla volta. */
data class StripProgress(val total: Int, val thumbnails: List<Bitmap>) {
    /** Numero (da 1) dello scatto in preparazione o appena fatto. */
    val currentShot: Int get() = (thumbnails.size + 1).coerceAtMost(total)
}

data class CameraUiState(
    val mode: CaptureMode = CaptureMode.PHOTO,
    val flash: FlashMode = FlashMode.AUTO,
    val useFrontCamera: Boolean = false,
    val canSwitchCamera: Boolean = false,
    val hasFlashUnit: Boolean = true,
    /** La fotocamera e inizializzata e si puo scattare. */
    val cameraReady: Boolean = false,
    /** Inizializzazione fallita o nessuna fotocamera: lo diciamo invece di mostrare un nero muto. */
    val cameraUnavailable: Boolean = false,
    /** Secondi mancanti allo scatto, null fuori dal conto alla rovescia. */
    val countdown: Int? = null,
    /** Scatto in corso (otturatore occupato). */
    val capturing: Boolean = false,
    /** Import dalla galleria in corso. */
    val importing: Boolean = false,
    val strip: StripProgress? = null,
    /** Stampe istantanee in coda o in corso. */
    val pendingPrints: Int = 0,
    /** Pillola "Stampato!" visibile per qualche secondo dopo una stampa riuscita. */
    val showPrinted: Boolean = false,
) {
    /** Timer o striscia in corso: modalita, galleria e cambio fotocamera restano fermi. */
    val sequenceRunning: Boolean get() = countdown != null || strip != null

    val busy: Boolean get() = capturing || importing
}

/** Eventi una tantum verso la schermata. */
sealed interface CameraEvent {
    /** Lampo bianco a schermo: il sensore sta esponendo. */
    data object ShutterFlash : CameraEvent

    /** Le foto sono nella CaptureSession: aprire l'editor. */
    data object OpenEditor : CameraEvent

    /** Stampa istantanea fallita. [failure] null = errore inatteso senza codice. */
    data class PrintFailed(val failure: PrintFailure?, val message: String) : CameraEvent

    /** Problema da mostrare con un messaggio breve. */
    data class Problem(@StringRes val message: Int) : CameraEvent
}

/**
 * Regia della fotocamera: modalita, flash, timer, sequenza della striscia, stampa istantanea,
 * import dalla galleria. Il CameraController vive nella schermata (ha bisogno di Context e
 * LifecycleOwner): quando serve una foto il ViewModel la chiede pubblicando un id in
 * [captureRequest] e la schermata risponde con [onCaptured] o [onCaptureFailed].
 */
class CameraViewModel(private val graph: AppGraph) : ViewModel() {

    private val _ui = MutableStateFlow(CameraUiState())
    val ui: StateFlow<CameraUiState> = _ui.asStateFlow()

    val settings: StateFlow<AppSettings> =
        graph.settings.settings.stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())

    val printerState: StateFlow<PrinterState> = graph.printer.state

    private val _events = Channel<CameraEvent>(Channel.BUFFERED)
    val events: Flow<CameraEvent> = _events.receiveAsFlow()

    private val _captureRequest = MutableStateFlow<Long?>(null)

    /** Id dello scatto richiesto alla schermata; null = nessuna richiesta pendente. */
    val captureRequest: StateFlow<Long?> = _captureRequest.asStateFlow()

    /** Analizzatore dell'anteprima termica: lo collega al controller la schermata. */
    val thermalAnalyzer = ThermalPreviewAnalyzer(inkArgb = FfColors.Ink.toArgb(), paperArgb = FfColors.Paper.toArgb())
    val thermalFrames: StateFlow<Bitmap?> = thermalAnalyzer.frames

    /** Thread dell'analisi: uno solo, i fotogrammi in eccesso li scarta CameraX (keep-only-latest). */
    val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "fotoflash-analysis")
    }

    /**
     * Thread per decodificare e raddrizzare gli scatti, separato dall'analisi. Non si chiude in
     * onCleared: CameraX consegna su questo executor anche l'esito degli scatti interrotti
     * dall'unbind, e un executor chiuso lo rifiuterebbe con un'eccezione sul main thread. Il
     * thread si spegne da solo dopo qualche secondo di inattivita.
     */
    val captureExecutor: ExecutorService = ThreadPoolExecutor(
        1,
        1,
        CAPTURE_THREAD_KEEP_ALIVE_S,
        TimeUnit.SECONDS,
        LinkedBlockingQueue<Runnable>(),
        ThreadFactory { runnable -> Thread(runnable, "fotoflash-capture") },
    ).apply { allowCoreThreadTimeOut(true) }

    private val feedback = CaptureFeedback(graph.appContext)

    private var sequenceJob: Job? = null
    private var importJob: Job? = null
    private var printedJob: Job? = null

    private var shotCounter = 0L
    private var pendingShot: CompletableDeferred<Bitmap?>? = null

    @Volatile private var shotSoundEnabled = true

    /** La fotocamera collegata e in errore (occupata, disabilitata, guasta): l'avviso copre il mirino. */
    private var cameraError = false

    /** Le stampe istantanee escono una alla volta, nell'ordine degli scatti. */
    private val printLock = Mutex()

    init {
        viewModelScope.launch {
            settings.collect { thermalAnalyzer.configure(it.dither, it.tone) }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Comandi dalla schermata
    // ---------------------------------------------------------------------------------------

    fun onShutter() {
        val state = _ui.value
        if (state.countdown != null) {
            // Un tocco durante il conto alla rovescia (anche tra gli scatti della striscia) annulla.
            cancelSequence()
            return
        }
        if (!state.cameraReady || state.busy || sequenceJob?.isActive == true) return
        if (settings.value.instantPrint && state.mode == CaptureMode.PHOTO &&
            state.pendingPrints >= MAX_QUEUED_PRINTS
        ) {
            _events.trySend(CameraEvent.Problem(R.string.cam_queue_full))
            return
        }
        val mode = state.mode
        sequenceJob = viewModelScope.launch {
            val current = graph.settings.current()
            when (mode) {
                CaptureMode.PHOTO -> takeSinglePhoto(current)
                CaptureMode.STRIP -> takeStrip(current)
            }
        }
    }

    fun onSelectMode(mode: CaptureMode) {
        val state = _ui.value
        if (state.sequenceRunning || state.busy) return
        _ui.update { it.copy(mode = mode) }
    }

    fun onCycleFlash() {
        _ui.update { it.copy(flash = it.flash.next()) }
    }

    fun onCycleTimer() {
        viewModelScope.launch {
            graph.settings.update { it.copy(timerSeconds = nextTimer(it.timerSeconds)) }
        }
    }

    fun onToggleLivePreview() {
        viewModelScope.launch {
            graph.settings.update { it.copy(livePreview = !it.livePreview) }
        }
    }

    fun onSwitchCamera() {
        val state = _ui.value
        if (!state.canSwitchCamera || state.sequenceRunning || state.busy) return
        _ui.update { it.copy(useFrontCamera = !it.useFrontCamera) }
        thermalAnalyzer.reset()
    }

    /** Foto scelte nel Photo Picker: una per l'editor, due o piu diventano una striscia. */
    fun onGalleryPicked(uris: List<Uri>) {
        if (uris.isEmpty()) return
        if (importJob?.isActive == true || _ui.value.sequenceRunning) return
        importJob = viewModelScope.launch {
            _ui.update { it.copy(importing = true) }
            try {
                val photos = GalleryImport.loadAll(graph.appContext.contentResolver, uris.take(MAX_STRIP_SHOTS))
                val template = if (photos.size >= 2) TemplateKind.STRIP else null
                openEditor(photos, CaptureSource.GALLERY, template)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "import dalla galleria fallito", e)
                _events.send(CameraEvent.Problem(R.string.cam_error_import))
            } catch (e: OutOfMemoryError) {
                Log.w(TAG, "memoria esaurita durante l'import", e)
                _events.send(CameraEvent.Problem(R.string.cam_error_import))
            } finally {
                _ui.update { it.copy(importing = false) }
            }
        }
    }

    /** Il Photo Picker non si e aperto (nessuna app che gestisca la richiesta). */
    fun onGalleryUnavailable() {
        _events.trySend(CameraEvent.Problem(R.string.cam_error_picker))
    }

    // ---------------------------------------------------------------------------------------
    // Stato della fotocamera, riportato dalla schermata
    // ---------------------------------------------------------------------------------------

    fun onCameraInitialized(hasBack: Boolean, hasFront: Boolean) {
        _ui.update {
            it.copy(
                cameraReady = hasBack || hasFront,
                cameraUnavailable = !hasBack && !hasFront,
                canSwitchCamera = hasBack && hasFront,
                // Tablet e Chromebook a volte hanno solo la frontale.
                useFrontCamera = when {
                    !hasBack && hasFront -> true
                    !hasFront -> false
                    else -> it.useFrontCamera
                },
            )
        }
    }

    fun onCameraUnavailable() {
        _ui.update { it.copy(cameraReady = false, cameraUnavailable = true) }
    }

    /**
     * Il controller e stato scollegato (la schermata e uscita di scena). Al ritorno ne nasce uno
     * nuovo: finche non e inizializzato non si scatta, e l'inizializzazione riparte da capo.
     */
    fun onCameraReleased() {
        cancelSequence()
        cameraError = false
        _ui.update { it.copy(cameraReady = false, cameraUnavailable = false) }
        thermalAnalyzer.reset()
    }

    /**
     * La fotocamera collegata e in errore dopo l'avvio (usata da un'altra app, disabilitata,
     * guasto dell'HAL): si dice com'e invece di lasciare un mirino nero con l'otturatore attivo.
     */
    fun onCameraError() {
        cameraError = true
        _ui.update { it.copy(cameraReady = false, cameraUnavailable = true) }
    }

    /** La fotocamera e tornata aperta dopo un errore: si riprende a scattare. */
    fun onCameraRecovered() {
        if (!cameraError) return
        cameraError = false
        _ui.update { it.copy(cameraReady = true, cameraUnavailable = false) }
    }

    /** Il controller ha rifiutato il cambio di fotocamera: si torna a quella di prima. */
    fun onCameraSwitchFailed() {
        _ui.update { it.copy(useFrontCamera = !it.useFrontCamera, canSwitchCamera = false) }
        thermalAnalyzer.reset()
    }

    /** Fotocamera collegata: [displayRotationDegrees] null = sconosciuta (si usa quella dei fotogrammi). */
    fun onCameraBound(front: Boolean, hasFlashUnit: Boolean, displayRotationDegrees: Int?) {
        _ui.update { it.copy(hasFlashUnit = hasFlashUnit) }
        thermalAnalyzer.setOrientation(front, displayRotationDegrees)
    }

    /** La schermata non e piu visibile: una sequenza a meta non ha senso. */
    fun onScreenStopped() {
        cancelSequence()
        thermalAnalyzer.reset()
    }

    /** Chiamato dal thread dello scatto quando il sensore inizia a esporre. */
    fun onShutterFired() {
        // Niente vibrazione qui: con poca luce l'esposizione dura 1/15-1/30 s e la foto verrebbe mossa.
        feedback.playShutter(shotSoundEnabled)
        _events.trySend(CameraEvent.ShutterFlash)
    }

    /** Chiamato dal thread dello scatto a esposizione finita, prima della decodifica. */
    fun onExposureDone() {
        feedback.vibrate()
    }

    fun onCaptured(requestId: Long, photo: Bitmap) {
        val waiting = pendingShot
        if (waiting != null && requestId == shotCounter && waiting.complete(photo)) return
        // Risposta arrivata fuori tempo (sequenza annullata): la foto non serve a nessuno.
        photo.recycle()
    }

    fun onCaptureFailed(requestId: Long, error: Throwable) {
        Log.w(TAG, "scatto $requestId fallito", error)
        if (requestId == shotCounter) pendingShot?.complete(null)
    }

    // ---------------------------------------------------------------------------------------
    // Sequenze
    // ---------------------------------------------------------------------------------------

    private suspend fun takeSinglePhoto(settings: AppSettings) {
        if (settings.timerSeconds > 0) countdown(settings.timerSeconds, settings.shutterSound)
        val photo = shoot(settings.shutterSound) ?: return
        if (settings.instantPrint) {
            enqueueInstantPrint(listOf(photo))
        } else {
            openEditor(listOf(photo), CaptureSource.CAMERA, null)
        }
    }

    private suspend fun takeStrip(settings: AppSettings) {
        val total = settings.stripShots.coerceIn(MIN_STRIP_SHOTS, MAX_STRIP_SHOTS)
        val photos = ArrayList<Bitmap>(total)
        _ui.update { it.copy(strip = StripProgress(total, emptyList())) }
        try {
            for (index in 0 until total) {
                // Il primo conto usa il timer se e piu lungo: il tempo di mettersi in posa.
                val seconds = if (index == 0) max(STRIP_COUNTDOWN_SECONDS, settings.timerSeconds) else STRIP_COUNTDOWN_SECONDS
                countdown(seconds, settings.shutterSound)
                // Uno scatto fallito non butta via la posa di tutti: si riprova una volta con un
                // nuovo 3-2-1; se fallisce ancora, le foto gia fatte bastano per una striscia piu corta.
                val firstTry = shoot(settings.shutterSound)
                val retried = firstTry ?: run {
                    countdown(STRIP_COUNTDOWN_SECONDS, settings.shutterSound)
                    shoot(settings.shutterSound)
                }
                val photo = retried ?: run {
                    if (photos.size >= MIN_STRIP_SHOTS) {
                        delay(STRIP_REVEAL_MS)
                        openEditor(photos.toList(), CaptureSource.CAMERA, TemplateKind.STRIP)
                    }
                    return
                }
                photos += photo
                val thumb = withContext(Dispatchers.Default) { photo.thumbnail() }
                _ui.update { state ->
                    val strip = state.strip ?: return@update state
                    state.copy(strip = strip.copy(thumbnails = strip.thumbnails + thumb))
                }
            }
            // Un attimo per vedere la striscia completa prima di passare all'editor.
            delay(STRIP_REVEAL_MS)
            openEditor(photos.toList(), CaptureSource.CAMERA, TemplateKind.STRIP)
        } finally {
            _ui.update { it.copy(strip = null) }
        }
    }

    private suspend fun countdown(seconds: Int, sound: Boolean) {
        try {
            for (remaining in seconds downTo 1) {
                _ui.update { it.copy(countdown = remaining) }
                // Bip e vibrazione solo negli ultimi 3 secondi: con 10 s sarebbero un tormento.
                if (remaining <= 3) {
                    if (sound) feedback.beep(last = remaining == 1)
                    feedback.vibrate(12L)
                }
                delay(1_000L)
            }
        } finally {
            _ui.update { it.copy(countdown = null) }
        }
    }

    /** Chiede uno scatto alla schermata e lo aspetta. null = fallito (l'utente e gia avvisato). */
    private suspend fun shoot(sound: Boolean): Bitmap? {
        shotCounter += 1
        val id = shotCounter
        val waiting = CompletableDeferred<Bitmap?>()
        pendingShot = waiting
        shotSoundEnabled = sound
        _ui.update { it.copy(capturing = true) }
        try {
            _captureRequest.value = id
            val photo = withTimeoutOrNull(CAPTURE_TIMEOUT_MS) { waiting.await() }
            if (photo == null) _events.send(CameraEvent.Problem(R.string.cam_error_capture))
            return photo
        } finally {
            if (_captureRequest.value == id) _captureRequest.value = null
            if (pendingShot === waiting) pendingShot = null
            _ui.update { it.copy(capturing = false) }
        }
    }

    private suspend fun openEditor(photos: List<Bitmap>, source: CaptureSource, template: TemplateKind?) {
        graph.session.set(photos, source, template)
        _events.send(CameraEvent.OpenEditor)
    }

    /**
     * Stampa istantanea: il lavoro gira nello scope dell'app, cosi un foglio iniziato finisce
     * anche se l'utente esce dal mirino; qui si aspetta solo l'esito per mostrarlo.
     */
    private fun enqueueInstantPrint(photos: List<Bitmap>) {
        _ui.update { it.copy(pendingPrints = it.pendingPrints + 1) }
        val job = graph.scope.async {
            printLock.withLock { printInstantly(photos) }
        }
        viewModelScope.launch {
            val outcome: PrintOutcome? = try {
                job.await()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "stampa istantanea fallita", e)
                null
            } catch (e: OutOfMemoryError) {
                // Memoria finita componendo o impaginando: si avvisa invece di far cadere l'app nel mirino.
                Log.e(TAG, "memoria esaurita nella stampa istantanea", e)
                PrintOutcome.Failure(PrintFailure.RENDER_FAILED, "")
            } finally {
                _ui.update { it.copy(pendingPrints = max(0, it.pendingPrints - 1)) }
            }
            when (outcome) {
                is PrintOutcome.Success -> showPrinted()
                is PrintOutcome.Failure -> _events.send(CameraEvent.PrintFailed(outcome.failure, outcome.message))
                null -> _events.send(CameraEvent.PrintFailed(null, ""))
            }
        }
    }

    /**
     * Una stampa istantanea, sotto [printLock]. La stampante risponde subito BUSY a chi arriva
     * mentre gira un altro lavoro (una ristampa dallo storico, una pagina di prova): invece di
     * perdere la foto si aspetta che si liberi e si riprova con lo stesso rendering, cosi lo
     * storico aggiorna la voce gia creata invece di duplicarla.
     */
    private suspend fun printInstantly(photos: List<Bitmap>): PrintOutcome {
        val coordinator = graph.coordinator
        // Prima di comporre: il numero dello Scontrino si calcola dopo che l'altra stampa ha preso il suo.
        awaitPrinterIdle()
        val prepared: Pair<PrintRequest, RenderedPrint> = try {
            val request = coordinator.buildRequest(photos)
            request to coordinator.render(request)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // La stampante non c'entra: messaggio vuoto, il mirino usa il suo testo per RENDER_FAILED.
            Log.e(TAG, "composizione della stampa istantanea fallita", e)
            return PrintOutcome.Failure(PrintFailure.RENDER_FAILED, "")
        } catch (e: OutOfMemoryError) {
            Log.e(TAG, "memoria esaurita componendo la stampa istantanea", e)
            return PrintOutcome.Failure(PrintFailure.RENDER_FAILED, "")
        }
        val copies = graph.settings.current().copies
        var attempt = 1
        while (true) {
            val outcome = coordinator.printAndRecord(prepared.first, prepared.second, copies)
            val busy = outcome is PrintOutcome.Failure && outcome.failure == PrintFailure.BUSY
            if (!busy || attempt >= BUSY_ATTEMPTS) return outcome
            attempt += 1
            delay(BUSY_RETRY_DELAY_MS)
            awaitPrinterIdle()
        }
    }

    /** Aspetta (al massimo un minuto) che la stampante non stia collegandosi o stampando. */
    private suspend fun awaitPrinterIdle() {
        withTimeoutOrNull(PRINTER_IDLE_WAIT_MS) {
            graph.printer.state.first { it !is PrinterState.Printing && it !is PrinterState.Connecting }
        }
    }

    private fun showPrinted() {
        printedJob?.cancel()
        printedJob = viewModelScope.launch {
            _ui.update { it.copy(showPrinted = true) }
            feedback.vibrate(40L)
            try {
                delay(PRINTED_BADGE_MS)
            } finally {
                _ui.update { it.copy(showPrinted = false) }
            }
        }
    }

    private fun cancelSequence() {
        sequenceJob?.cancel()
        sequenceJob = null
    }

    override fun onCleared() {
        cancelSequence()
        feedback.release()
        // Dopo lo shutdown CameraX riceve un rifiuto per i fotogrammi in volo e lo gestisce da
        // se (li scarta); captureExecutor invece resta vivo, vedi la sua documentazione.
        analysisExecutor.shutdown()
    }

    companion object {
        /** Valori del timer, nell'ordine del pulsante. */
        val TIMER_STEPS = listOf(0, 3, 10)

        const val MIN_STRIP_SHOTS = 2
        const val MAX_STRIP_SHOTS = 4

        /** Oltre questo numero di stampe in coda l'otturatore aspetta: i bambini premono a raffica. */
        const val MAX_QUEUED_PRINTS = 3

        private const val STRIP_COUNTDOWN_SECONDS = 3
        private const val STRIP_REVEAL_MS = 600L
        private const val CAPTURE_TIMEOUT_MS = 10_000L
        private const val CAPTURE_THREAD_KEEP_ALIVE_S = 5L
        private const val PRINTED_BADGE_MS = 2_600L

        /** Tentativi di una stampa istantanea che trova la stampante occupata da un altro lavoro. */
        private const val BUSY_ATTEMPTS = 3
        private const val BUSY_RETRY_DELAY_MS = 1_500L
        private const val PRINTER_IDLE_WAIT_MS = 60_000L
        private const val TAG = "FotoFlashCamera"

        fun nextTimer(current: Int): Int {
            val index = TIMER_STEPS.indexOf(current)
            return if (index < 0) TIMER_STEPS.first() else TIMER_STEPS[(index + 1) % TIMER_STEPS.size]
        }
    }
}
