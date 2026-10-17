package io.github.nik2208.fotoflash.printer

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.PaperWidth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Dispositivo accoppiato mostrato nell'elenco. */
data class BondedPrinterItem(val device: PrinterDevice, val likelyPrinter: Boolean)

/** Tutto cio che serve alla schermata "Stampante e carta". */
data class PrinterUiState(
    /** Falso finche le impostazioni non sono state lette: evita di mostrare valori di default. */
    val loaded: Boolean = false,
    /** Stato della stampante gia ripulito dagli errori non piu veri (es. Bluetooth riacceso). */
    val printer: PrinterState = PrinterState.NotConfigured,
    val settings: AppSettings = AppSettings(),
    val bluetoothAvailable: Boolean = true,
    val hasPermission: Boolean = true,
    val bluetoothEnabled: Boolean = true,
    val bonded: List<BondedPrinterItem> = emptyList(),
    /** L'utente ha negato il permesso almeno una volta: si offre anche la strada delle impostazioni app. */
    val permissionDenied: Boolean = false,
    val testPrinting: Boolean = false,
    /** Vero dopo la prima lettura dei dispositivi accoppiati: prima [bonded] vuota non vuol dire nulla. */
    val bondedLoaded: Boolean = false,
) {
    val configured: PrinterDevice?
        get() = settings.printerAddress?.let { address -> PrinterDevice(settings.printerName ?: address, address) }

    /** Bluetooth utilizzabile adesso: presente, permesso concesso, acceso. */
    val bluetoothReady: Boolean
        get() = bluetoothAvailable && hasPermission && bluetoothEnabled

    val busy: Boolean
        get() = testPrinting || printer is PrinterState.Connecting || printer is PrinterState.Printing
}

/** Eventi una tantum per lo snackbar. */
sealed interface PrinterEvent {
    data object TestPageSent : PrinterEvent
    data object CalibrationReset : PrinterEvent
    data class Message(val text: String) : PrinterEvent
}

class PrinterViewModel(private val graph: AppGraph) : ViewModel() {

    private val printer = graph.printer
    private val settingsRepository = graph.settings

    private data class SystemStatus(
        val available: Boolean,
        val permission: Boolean,
        val enabled: Boolean,
        val bonded: List<BondedPrinterItem>,
        val bondedLoaded: Boolean = false,
    )

    private data class Extras(val permissionDenied: Boolean = false, val testPrinting: Boolean = false)

    private val system = MutableStateFlow(
        SystemStatus(
            available = printer.isBluetoothAvailable(),
            permission = printer.hasBluetoothPermission(),
            enabled = printer.isBluetoothEnabled(),
            bonded = emptyList(),
        ),
    )
    private val extras = MutableStateFlow(Extras())

    private val _events = Channel<PrinterEvent>(Channel.BUFFERED)
    val events: Flow<PrinterEvent> = _events.receiveAsFlow()

    val ui: StateFlow<PrinterUiState> =
        combine(printer.state, settingsRepository.settings, system, extras) { state, settings, sys, ext ->
            PrinterUiState(
                loaded = true,
                printer = withoutStaleError(state, settings, sys),
                settings = settings,
                bluetoothAvailable = sys.available,
                hasPermission = sys.permission,
                bluetoothEnabled = sys.enabled,
                bonded = sys.bonded,
                permissionDenied = ext.permissionDenied && !sys.permission,
                testPrinting = ext.testPrinting,
                bondedLoaded = sys.bondedLoaded,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PrinterUiState())

    /** Accensione/spegnimento del Bluetooth e nuovi accoppiamenti cambiano cosa mostrare. */
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            refresh()
        }
    }

    init {
        val filter = IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
        }
        // Inviati dal processo Bluetooth: serve EXPORTED (sono broadcast protetti, non falsificabili).
        ContextCompat.registerReceiver(graph.appContext, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        refresh()
    }

    override fun onCleared() {
        try {
            graph.appContext.unregisterReceiver(receiver)
        } catch (_: IllegalArgumentException) {
            // gia rimosso
        }
    }

    fun requiredPermissions(): Array<String> = printer.requiredPermissions()

    /** Rilegge permessi, stato del Bluetooth e dispositivi accoppiati (al ritorno sulla schermata). */
    fun refresh() {
        viewModelScope.launch {
            system.value = withContext(Dispatchers.IO) {
                // Un errore risolto qui (permesso, riaccoppiamento) va tolto anche dalle pillole delle altre schermate.
                printer.revalidate()
                readSystem()
            }
        }
    }

    fun onPermissionResult(granted: Boolean) {
        extras.update { it.copy(permissionDenied = !granted) }
        refresh()
    }

    fun select(device: PrinterDevice) {
        viewModelScope.launch { printer.select(device) }
    }

    fun forget() {
        viewModelScope.launch { printer.forget() }
    }

    fun disconnect() {
        viewModelScope.launch { printer.disconnect() }
    }

    fun printTestPage() {
        if (extras.value.testPrinting) return
        extras.update { it.copy(testPrinting = true) }
        viewModelScope.launch {
            try {
                // Il lavoro gira nello scope dell'app: se si esce dalla schermata la pagina finisce comunque.
                when (val outcome = printer.printTestPage()) {
                    is PrintOutcome.Success -> _events.trySend(PrinterEvent.TestPageSent)
                    is PrintOutcome.Failure -> {
                        // Gli altri errori li mostra la scheda di stato; BUSY e RENDER_FAILED non cambiano
                        // lo stato, quindi senza messaggio l'utente non vedrebbe nulla.
                        if (outcome.failure == PrintFailure.BUSY || outcome.failure == PrintFailure.RENDER_FAILED) {
                            _events.trySend(PrinterEvent.Message(outcome.message))
                        }
                    }
                }
            } finally {
                extras.update { it.copy(testPrinting = false) }
            }
        }
    }

    fun setPaper(paper: PaperWidth) = updateSettings { it.copy(paper = paper) }

    fun setFeedLines(lines: Int) = updateSettings { it.copy(feedLines = PrinterTuning.clampFeedLines(lines)) }

    fun setCutPaper(cut: Boolean) = updateSettings { it.copy(cutPaper = cut) }

    fun setHeatLevel(level: Int) = updateSettings { it.copy(heatLevel = PrinterTuning.clampHeatLevel(level)) }

    fun setChunkSize(size: Int) = updateSettings { it.copy(chunkSize = PrinterTuning.clampChunkSize(size)) }

    fun setChunkDelay(delayMs: Int) = updateSettings { it.copy(chunkDelayMs = PrinterTuning.clampChunkDelay(delayMs)) }

    fun setBandHeight(rows: Int) = updateSettings { it.copy(bandHeight = PrinterTuning.clampBandHeight(rows)) }

    /** Riporta la calibrazione avanzata ai valori consigliati. */
    fun resetAdvanced() {
        viewModelScope.launch {
            settingsRepository.update {
                it.copy(
                    chunkSize = PrinterTuning.CHUNK_SIZE_DEFAULT,
                    chunkDelayMs = PrinterTuning.CHUNK_DELAY_DEFAULT,
                    bandHeight = PrinterTuning.BAND_HEIGHT_DEFAULT,
                )
            }
            _events.trySend(PrinterEvent.CalibrationReset)
        }
    }

    private fun updateSettings(transform: (AppSettings) -> AppSettings) {
        viewModelScope.launch { settingsRepository.update(transform) }
    }

    private fun readSystem(): SystemStatus {
        val available = printer.isBluetoothAvailable()
        val permission = printer.hasBluetoothPermission()
        val enabled = available && printer.isBluetoothEnabled()
        val bonded = if (available && permission && enabled) {
            printer.bondedPrinters().map { BondedPrinterItem(it, printer.isLikelyPrinter(it)) }
        } else {
            emptyList()
        }
        return SystemStatus(available, permission, enabled, bonded, bondedLoaded = true)
    }

    /**
     * Un errore registrato dal manager puo non essere piu vero (permesso concesso dopo, stampante
     * riaccoppiata, stampante scelta): la schermata deve dire com'e adesso, non com'era.
     */
    private fun withoutStaleError(state: PrinterState, settings: AppSettings, sys: SystemStatus): PrinterState {
        if (state !is PrinterState.Error) return state
        val configured = settings.printerAddress?.let { PrinterDevice(settings.printerName ?: it, it) }
        val resting: PrinterState = if (configured != null) PrinterState.Disconnected(configured) else PrinterState.NotConfigured
        val errorAddress = state.device?.address
        val stale = when (state.failure) {
            PrintFailure.NO_PERMISSION -> sys.permission
            PrintFailure.BLUETOOTH_OFF -> sys.available && sys.enabled
            PrintFailure.NOT_BONDED -> sys.bonded.any { it.device.address.equals(errorAddress, ignoreCase = true) }
            PrintFailure.NO_PRINTER -> configured != null
            // Composizione fallita: la stampante non c'entra, non va mai mostrata come suo errore.
            PrintFailure.RENDER_FAILED -> true
            else -> false
        }
        // Se nel frattempo e stata scelta un'altra stampante, l'errore riguarda quella vecchia.
        val otherPrinter = errorAddress != null && configured != null &&
            !configured.address.equals(errorAddress, ignoreCase = true)
        return if (stale || otherPrinter) resting else state
    }
}
