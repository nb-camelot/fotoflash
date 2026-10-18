package io.github.nik2208.fotoflash.printer

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.PrinterDriver
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.PrinterLink
import io.github.nik2208.fotoflash.thermal.TransportHints
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

/** Dispositivo accoppiato (SPP) mostrato nell'elenco, con il driver riconosciuto dal nome. */
data class BondedPrinterItem(
    val device: PrinterDevice,
    val likelyPrinter: Boolean,
    val driver: PrinterDriver? = null,
    /** Modello noto ma con un protocollo non supportato (Phomemo M02X). */
    val unsupported: Boolean = false,
)

/** Dispositivo BLE trovato dalla ricerca. */
data class NearbyPrinterItem(
    val device: PrinterDevice,
    val driver: PrinterDriver?,
    val unsupported: Boolean,
)

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
    /** Ricerca BLE: risultati, stato e ultimo problema. */
    val nearby: List<NearbyPrinterItem> = emptyList(),
    val scanning: Boolean = false,
    val scanIssue: BleScanIssue? = null,
    /** Vero dopo la prima ricerca avviata da questa schermata: prima un elenco vuoto non dice nulla. */
    val scanRequested: Boolean = false,
    val hasScanPermission: Boolean = true,
    val scanPermissionDenied: Boolean = false,
    /** Fino ad Android 11 la ricerca BLE vuole la Localizzazione accesa. */
    val locationNeeded: Boolean = false,
    val locationEnabled: Boolean = true,
) {
    val configured: PrinterDevice?
        get() = settings.printerAddress?.let { address ->
            PrinterDevice(settings.printerName ?: address, address, settings.printerLink)
        }

    /** Driver in uso (escpos-58 per un id sconosciuto). */
    val driver: PrinterDriver
        get() = PrinterDrivers.byId(settings.printerDriver)

    /** Driver che il nome della stampante scelta suggerisce, null se il nome non dice nulla. */
    val suggestedDriver: PrinterDriver?
        get() = configured?.let { PrinterDrivers.guess(it.name) }

    /** La stampante scelta e un modello noto ma non supportato (Phomemo M02X). */
    val configuredUnsupported: Boolean
        get() = PrinterTuning.isUnsupportedModel(configured?.name)

    /** Parametri di invio BLE effettivi: predefiniti del driver con le scelte dell'utente. */
    val bleHints: TransportHints
        get() = PrinterTuning.bleHints(driver, settings)

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
        val scanPermission: Boolean = true,
        val locationNeeded: Boolean = false,
        val locationEnabled: Boolean = true,
    )

    private data class Extras(
        val permissionDenied: Boolean = false,
        val testPrinting: Boolean = false,
        val scanPermissionDenied: Boolean = false,
        val scanRequested: Boolean = false,
    )

    private data class ScanStatus(
        val nearby: List<NearbyPrinterItem>,
        val scanning: Boolean,
        val issue: BleScanIssue?,
    )

    private val system = MutableStateFlow(
        SystemStatus(
            available = printer.isBluetoothAvailable(),
            permission = printer.hasBluetoothPermission(),
            enabled = printer.isBluetoothEnabled(),
            bonded = emptyList(),
            scanPermission = printer.hasScanPermission(),
            locationNeeded = printer.isLocationNeededForScan(),
        ),
    )
    private val extras = MutableStateFlow(Extras())

    private val scan: Flow<ScanStatus> =
        combine(printer.discovered, printer.scanning, printer.scanIssue) { devices, scanning, issue ->
            ScanStatus(
                nearby = devices.map { device ->
                    NearbyPrinterItem(
                        device = device,
                        driver = PrinterDrivers.guess(device.name),
                        unsupported = PrinterTuning.isUnsupportedModel(device.name),
                    )
                },
                scanning = scanning,
                issue = issue,
            )
        }

    private val _events = Channel<PrinterEvent>(Channel.BUFFERED)
    val events: Flow<PrinterEvent> = _events.receiveAsFlow()

    val ui: StateFlow<PrinterUiState> =
        combine(printer.state, settingsRepository.settings, system, extras, scan) { state, settings, sys, ext, sc ->
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
                nearby = sc.nearby,
                scanning = sc.scanning,
                scanIssue = sc.issue,
                scanRequested = ext.scanRequested,
                hasScanPermission = sys.scanPermission,
                scanPermissionDenied = ext.scanPermissionDenied && !sys.scanPermission,
                locationNeeded = sys.locationNeeded,
                locationEnabled = sys.locationEnabled,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PrinterUiState())

    /** Accensione/spegnimento di Bluetooth e Localizzazione e nuovi accoppiamenti cambiano cosa mostrare. */
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            refresh()
        }
    }

    init {
        val filter = IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
            addAction(LocationManager.MODE_CHANGED_ACTION)
        }
        // Inviati dal sistema: serve EXPORTED (sono broadcast protetti, non falsificabili).
        ContextCompat.registerReceiver(graph.appContext, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        refresh()
    }

    override fun onCleared() {
        // Una ricerca lasciata a meta consuma batteria per niente.
        printer.stopBleScan()
        try {
            graph.appContext.unregisterReceiver(receiver)
        } catch (_: IllegalArgumentException) {
            // gia rimosso
        }
    }

    fun requiredPermissions(): Array<String> = printer.requiredPermissions()

    fun scanPermissions(): Array<String> = printer.scanPermissions()

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

    /** Esito della richiesta dei permessi di ricerca: se concessi, la ricerca parte subito. */
    fun onScanPermissionResult(granted: Boolean) {
        extras.update { it.copy(scanPermissionDenied = !granted) }
        refresh()
        if (granted) startScan()
    }

    /** «Cerca»: ricerca BLE; senza permessi o Bluetooth non parte e la schermata dice perche. */
    fun startScan() {
        extras.update { it.copy(scanRequested = true) }
        printer.startBleScan()
    }

    fun stopScan() {
        printer.stopBleScan()
    }

    fun select(device: PrinterDevice) {
        viewModelScope.launch { printer.select(device) }
    }

    fun setDriver(driverId: String) {
        viewModelScope.launch { printer.setDriver(driverId) }
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

    /** Carta 58/80 dei driver ESC/POS: la larghezza e una proprieta del driver, quindi si cambia quello. */
    fun setPaper(paper: PaperWidth) {
        val driverId = PrinterTuning.escPosDriverFor(paper) ?: return
        setDriver(driverId)
    }

    /** Retino consigliato dal driver (proposto dalla schermata, mai imposto). */
    fun setDither(dither: DitherAlgorithm) = updateSettings { it.copy(dither = dither) }

    fun setFeedLines(lines: Int) = updateSettings { it.copy(feedLines = PrinterTuning.clampFeedLines(lines)) }

    fun setCutPaper(cut: Boolean) = updateSettings { it.copy(cutPaper = cut) }

    fun setHeatLevel(level: Int) = updateSettings { it.copy(heatLevel = PrinterTuning.clampHeatLevel(level)) }

    fun setChunkSize(size: Int) = updateSettings { it.copy(chunkSize = PrinterTuning.clampChunkSize(size)) }

    fun setChunkDelay(delayMs: Int) = updateSettings { it.copy(chunkDelayMs = PrinterTuning.clampChunkDelay(delayMs)) }

    fun setBandHeight(rows: Int) = updateSettings { it.copy(bandHeight = PrinterTuning.clampBandHeight(rows)) }

    /** Densita Phomemo 1..15; null = torna a seguire l'intensita. */
    fun setPhomemoDensity(density: Int?) =
        updateSettings { it.copy(phomemoDensity = density?.let { d -> PrinterTuning.clampPhomemoDensity(d) }) }

    fun setPhomemoWidthBytes(bytes: Int) {
        if (bytes !in PrinterTuning.PHOMEMO_WIDTH_BYTES) return
        updateSettings { it.copy(phomemoWidthBytes = bytes) }
    }

    /** Velocita sperimentale; null = non inviata (predefinito). */
    fun setPrinterSpeed(speed: Int?) =
        updateSettings { it.copy(printerSpeed = speed?.let { v -> PrinterTuning.clampSpeed(v) }) }

    fun setBlePreset(preset: PrinterTuning.BlePreset) = updateSettings {
        it.copy(
            bleChunkSize = preset.chunkSize,
            bleChunkDelayMs = preset.chunkDelayMs,
            bleWithoutResponse = preset.withoutResponse,
        )
    }

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
            printer.bondedPrinters().map { device ->
                BondedPrinterItem(
                    device = device,
                    likelyPrinter = printer.isLikelyPrinter(device),
                    driver = PrinterDrivers.guess(device.name),
                    unsupported = PrinterTuning.isUnsupportedModel(device.name),
                )
            }
        } else {
            emptyList()
        }
        val locationNeeded = printer.isLocationNeededForScan()
        return SystemStatus(
            available = available,
            permission = permission,
            enabled = enabled,
            bonded = bonded,
            bondedLoaded = true,
            scanPermission = printer.hasScanPermission(),
            locationNeeded = locationNeeded,
            locationEnabled = !locationNeeded || printer.isLocationEnabled(),
        )
    }

    /**
     * Un errore registrato dal manager puo non essere piu vero (permesso concesso dopo, stampante
     * riaccoppiata, stampante scelta): la schermata deve dire com'e adesso, non com'era.
     */
    private fun withoutStaleError(state: PrinterState, settings: AppSettings, sys: SystemStatus): PrinterState {
        if (state !is PrinterState.Error) return state
        val configured = settings.printerAddress?.let { PrinterDevice(settings.printerName ?: it, it, settings.printerLink) }
        val resting: PrinterState = if (configured != null) PrinterState.Disconnected(configured) else PrinterState.NotConfigured
        val errorAddress = state.device?.address
        val stale = when (state.failure) {
            PrintFailure.NO_PERMISSION -> sys.permission
            PrintFailure.BLUETOOTH_OFF -> sys.available && sys.enabled
            // L'accoppiamento conta solo in SPP.
            PrintFailure.NOT_BONDED -> state.device?.link == PrinterLink.BLE ||
                sys.bonded.any { it.device.address.equals(errorAddress, ignoreCase = true) }
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
