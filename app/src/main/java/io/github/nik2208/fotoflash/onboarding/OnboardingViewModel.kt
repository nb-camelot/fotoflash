package io.github.nik2208.fotoflash.onboarding

import android.Manifest
import android.content.pm.PackageManager
import android.location.LocationManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.PrinterLink
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Esito della pagina di prova, mostrato sotto il pulsante. */
sealed interface TestPageResult {
    data object Success : TestPageResult
    data class Failure(val failure: PrintFailure) : TestPageResult
}

/** Stampante scelta: lo stesso indirizzo puo comparire tra le accoppiate (SPP) e tra le vicine (BLE). */
data class PrinterChoice(val address: String, val name: String, val link: PrinterLink) {
    fun matches(device: PrinterDevice): Boolean =
        device.link == link && device.address.equals(address, ignoreCase = true)
}

data class OnboardingUiState(
    /** false finche il primo controllo del Bluetooth non e finito. */
    val checked: Boolean = false,
    val bluetoothAvailable: Boolean = true,
    val bluetoothEnabled: Boolean = true,
    val hasBluetoothPermission: Boolean = false,
    /** Permessi della ricerca BLE: "Dispositivi nelle vicinanze" da Android 12, la posizione prima. */
    val hasScanPermission: Boolean = false,
    /** Fino ad Android 11 la ricerca BLE non trova nulla con la Localizzazione spenta. */
    val locationOff: Boolean = false,
    /** Accoppiate (SPP), nell'ordine di PrinterManager (stampanti probabili in cima). */
    val bonded: List<PrinterDevice> = emptyList(),
    /** Trovate dall'ultima ricerca BLE. */
    val nearby: List<PrinterDevice> = emptyList(),
    val scanning: Boolean = false,
    /** Vero dopo la prima ricerca: distingue "mai cercato" da "nessuna trovata". */
    val scanned: Boolean = false,
    val selected: PrinterChoice? = null,
    /** Driver della stampante scelta (id di PrinterDrivers). */
    val driverId: String = AppSettings().printerDriver,
    /** Retino predefinito attuale: serve a proporre quello del driver. */
    val dither: DitherAlgorithm = AppSettings().dither,
    val testing: Boolean = false,
    val testResult: TestPageResult? = null,
    val finishing: Boolean = false,
)

/** Driver ESC/POS (escpos-58, escpos-80): gli id sono quelli del contratto di docs/DRIVERS.md. */
internal fun isEscPosDriverId(id: String): Boolean = id.startsWith("escpos-")

/** La parte delle impostazioni che interessa all'onboarding. */
private data class SavedPrinter(
    val address: String?,
    val name: String?,
    val link: PrinterLink,
    val driverId: String,
    val dither: DitherAlgorithm,
)

class OnboardingViewModel(private val graph: AppGraph) : ViewModel() {

    private val _ui = MutableStateFlow(OnboardingUiState())

    /**
     * Driver appena scelto (o indovinato dal nome) e non ancora su disco: evita che per un attimo
     * si veda quello vecchio. Torna null quando l'ultima scrittura in coda e finita.
     */
    private val pendingDriver = MutableStateFlow<String?>(null)

    /** Scelte e cambi di driver, in ordine: un cambio di driver non deve precedere la scelta della stampante. */
    private var printerJob: Job? = null

    @Volatile
    private var printerJobSeq = 0

    /** La prima ricerca parte da sola arrivando sulla pagina; le successive solo con "Cerca". */
    private var autoScanDone = false

    val state: StateFlow<OnboardingUiState> = combine(
        _ui,
        graph.settings.settings
            .map { SavedPrinter(it.printerAddress, it.printerName, it.printerLink, it.printerDriver, it.dither) }
            .distinctUntilChanged(),
        graph.printer.discovered,
        graph.printer.scanning,
        pendingDriver,
    ) { ui, saved, nearby, scanning, pending ->
        val savedChoice = saved.address?.let { address -> PrinterChoice(address, saved.name ?: address, saved.link) }
        ui.copy(
            nearby = nearby,
            scanning = scanning,
            // La scelta appena fatta vince su quella salvata, che arriva con un attimo di ritardo.
            selected = ui.selected ?: savedChoice,
            driverId = pending ?: saved.driverId,
            dither = saved.dither,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), OnboardingUiState())

    val printerState: StateFlow<PrinterState> = graph.printer.state

    /**
     * Permessi Bluetooth della pagina dei permessi: collegamento e, da Android 12, ricerca (stesso
     * gruppo "Dispositivi nelle vicinanze", una sola richiesta). La posizione che serve alla ricerca
     * fino ad Android 11 si chiede solo quando si cerca, spiegando perche.
     */
    fun bluetoothPermissions(): List<String> {
        val printer = graph.printer
        return (printer.requiredPermissions().toList() + printer.scanPermissions().toList())
            .filter { it != Manifest.permission.CAMERA && it !in LOCATION_PERMISSIONS }
            .distinct()
    }

    /** Permessi della ricerca BLE su questa versione di Android. */
    fun scanPermissions(): List<String> = graph.printer.scanPermissions().toList().distinct()

    /** Vero se la ricerca chiede la posizione (Android 11 e precedenti): cambia la spiegazione. */
    fun scanNeedsLocationPermission(): Boolean = scanPermissions().any { it in LOCATION_PERMISSIONS }

    /** Rilegge stato del Bluetooth, permessi e dispositivi accoppiati (al ritorno dalle impostazioni, dopo i permessi). */
    fun refresh() {
        viewModelScope.launch {
            val printer = graph.printer
            val snapshot = withContext(Dispatchers.IO) {
                val available = safely(false) { printer.isBluetoothAvailable() }
                val permission = safely(false) { printer.hasBluetoothPermission() }
                val enabled = available && safely(false) { printer.isBluetoothEnabled() }
                val scanPermission = safely(false) { printer.scanPermissions().all { isGranted(it) } }
                val locationOff = safely(false) { printer.isLocationNeededForScan() } && !isLocationEnabled()
                val devices = if (available && permission) {
                    safely(emptyList<PrinterDevice>()) { printer.bondedPrinters() }
                } else {
                    emptyList()
                }
                OnboardingUiState(
                    checked = true,
                    bluetoothAvailable = available,
                    bluetoothEnabled = enabled,
                    hasBluetoothPermission = permission,
                    hasScanPermission = scanPermission,
                    locationOff = locationOff,
                    bonded = devices,
                )
            }
            _ui.update {
                it.copy(
                    checked = true,
                    bluetoothAvailable = snapshot.bluetoothAvailable,
                    bluetoothEnabled = snapshot.bluetoothEnabled,
                    hasBluetoothPermission = snapshot.hasBluetoothPermission,
                    hasScanPermission = snapshot.hasScanPermission,
                    locationOff = snapshot.locationOff,
                    bonded = snapshot.bonded,
                )
            }
        }
    }

    /**
     * Ricerca BLE di 10 s. Se non puo partire (permessi, Bluetooth spento, Localizzazione spenta fino
     * ad Android 11) PrinterManager non fa nulla: allora non la si conta come fatta, altrimenti la
     * pagina direbbe "nessuna trovata" senza aver cercato e la ricerca automatica non ripartirebbe
     * quando il problema e risolto. Si rilegge lo stato, che mostra l'avviso giusto.
     */
    fun startScan() {
        val printer = graph.printer
        val ready = safely(false) {
            printer.isBluetoothEnabled() &&
                printer.scanPermissions().all { isGranted(it) } &&
                !(printer.isLocationNeededForScan() && !isLocationEnabled())
        }
        if (!ready) {
            refresh()
            return
        }
        autoScanDone = true
        _ui.update { it.copy(scanned = true) }
        safely(Unit) { printer.startBleScan() }
    }

    /** Prima ricerca automatica, una volta sola: le vicine compaiono senza dover toccare "Cerca". */
    fun autoScan() {
        if (!autoScanDone) startScan()
    }

    fun stopScan() {
        if (graph.printer.scanning.value) safely(Unit) { graph.printer.stopBleScan() }
    }

    /**
     * Il driver lo sceglie PrinterManager dal nome (o escpos-58); qui lo si anticipa solo per la UI.
     * Ritoccare la stampante gia scelta non deve perdere il driver cambiato a mano.
     */
    fun select(device: PrinterDevice) {
        val current = state.value
        val keptDriver = if (current.selected?.matches(device) == true) current.driverId else null
        _ui.update {
            it.copy(selected = PrinterChoice(device.address, device.name, device.link), testResult = null)
        }
        // Stessa regola di PrinterManager.select: dal nome, se no l'ESC/POS in uso, se no escpos-58.
        val expected = keptDriver
            ?: PrinterDrivers.guess(device.name)?.id
            ?: current.driverId.takeIf { isEscPosDriverId(it) }
            ?: PrinterDrivers.byId(null).id
        enqueuePrinterChange(expected, "Scelta della stampante non salvata") {
            graph.printer.select(device, keptDriver)
        }
    }

    fun setDriver(driverId: String) {
        _ui.update { it.copy(testResult = null) }
        enqueuePrinterChange(driverId, "Driver non salvato") { graph.printer.setDriver(driverId) }
    }

    /** Usa come retino predefinito quello consigliato dal driver (Floyd-Steinberg per le Phomemo). */
    fun useDither(algorithm: DitherAlgorithm) {
        graph.scope.launch {
            try {
                graph.settings.update { it.copy(dither = algorithm) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Retino non salvato", e)
            }
        }
    }

    fun printTestPage() {
        if (_ui.value.testing) return
        _ui.update { it.copy(testing = true, testResult = null) }
        val pendingChange = printerJob
        val job = graph.scope.async {
            // Se stampante o driver sono appena cambiati, la pagina di prova deve usare quelli nuovi.
            pendingChange?.join()
            graph.printer.printTestPage()
        }
        viewModelScope.launch {
            val result = try {
                when (val outcome = job.await()) {
                    is PrintOutcome.Success -> TestPageResult.Success
                    is PrintOutcome.Failure -> TestPageResult.Failure(outcome.failure)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Pagina di prova fallita", e)
                TestPageResult.Failure(PrintFailure.WRITE_FAILED)
            }
            _ui.update { it.copy(testing = false, testResult = result) }
        }
    }

    /** Segna l'onboarding come fatto (anche con "Salta": altrimenti ricomparirebbe a ogni avvio). */
    fun finish(onDone: () -> Unit) {
        if (_ui.value.finishing) return
        _ui.update { it.copy(finishing = true) }
        stopScan()
        viewModelScope.launch {
            try {
                graph.settings.update { it.copy(onboardingDone = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Un salvataggio fallito non deve lasciare l'utente bloccato sull'onboarding.
                Log.e(TAG, "Fine dell'onboarding non salvata", e)
            }
            onDone()
        }
    }

    override fun onCleared() {
        // Una ricerca lasciata accesa consumerebbe batteria fino al suo timeout.
        stopScan()
        super.onCleared()
    }

    /**
     * Mette in coda una modifica della stampante nello scope dell'app: deve arrivare su disco
     * anche se si chiude subito l'onboarding, e nell'ordine dei tocchi.
     */
    private fun enqueuePrinterChange(expectedDriver: String, errorLog: String, change: suspend () -> Unit) {
        pendingDriver.value = expectedDriver
        val seq = ++printerJobSeq
        val previous = printerJob
        printerJob = graph.scope.launch {
            previous?.join()
            try {
                change()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, errorLog, e)
            } finally {
                // Solo l'ultima modifica in coda libera il valore anticipato: da qui vale quello salvato.
                if (seq == printerJobSeq) pendingDriver.value = null
            }
        }
    }

    private fun isGranted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(graph.appContext, permission) == PackageManager.PERMISSION_GRANTED

    /** Senza LocationManager non si puo sapere: meglio non mostrare un avviso falso. */
    private fun isLocationEnabled(): Boolean {
        val manager = graph.appContext.getSystemService(LocationManager::class.java) ?: return true
        return LocationManagerCompat.isLocationEnabled(manager)
    }

    private inline fun <T> safely(fallback: T, block: () -> T): T = try {
        block()
    } catch (e: SecurityException) {
        Log.w(TAG, "Permesso Bluetooth mancante", e)
        fallback
    } catch (e: RuntimeException) {
        Log.w(TAG, "Bluetooth non interrogabile", e)
        fallback
    }

    private companion object {
        const val TAG = "OnboardingViewModel"

        val LOCATION_PERMISSIONS = setOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
    }
}
