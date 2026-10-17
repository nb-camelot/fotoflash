package io.github.nik2208.fotoflash.onboarding

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.nik2208.fotoflash.di.AppGraph
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
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

data class OnboardingUiState(
    /** false finche il primo controllo del Bluetooth non e finito. */
    val checked: Boolean = false,
    val bluetoothAvailable: Boolean = true,
    val bluetoothEnabled: Boolean = true,
    val hasBluetoothPermission: Boolean = false,
    /** Dispositivi accoppiati, nell'ordine di PrinterManager (stampanti probabili in cima). */
    val printers: List<PrinterDevice> = emptyList(),
    val selectedAddress: String? = null,
    val testing: Boolean = false,
    val testResult: TestPageResult? = null,
    val finishing: Boolean = false,
)

class OnboardingViewModel(private val graph: AppGraph) : ViewModel() {

    private val _ui = MutableStateFlow(OnboardingUiState())
    private var selectJob: Job? = null

    val state: StateFlow<OnboardingUiState> = combine(
        _ui,
        graph.settings.settings.map { it.printerAddress },
    ) { ui, savedAddress ->
        // La scelta appena fatta vince su quella salvata, che arriva con un attimo di ritardo.
        ui.copy(selectedAddress = ui.selectedAddress ?: savedAddress)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), OnboardingUiState())

    val printerState: StateFlow<PrinterState> = graph.printer.state

    /** Permessi Bluetooth da chiedere su questa versione di Android (vuoto prima di Android 12). */
    fun bluetoothPermissions(): List<String> =
        graph.printer.requiredPermissions().filter { it != android.Manifest.permission.CAMERA }.distinct()

    /** Rilegge stato del Bluetooth e dispositivi accoppiati (al ritorno dalle impostazioni, dopo i permessi). */
    fun refresh() {
        viewModelScope.launch {
            val printer = graph.printer
            val snapshot = withContext(Dispatchers.IO) {
                val available = safely(false) { printer.isBluetoothAvailable() }
                val permission = safely(false) { printer.hasBluetoothPermission() }
                val enabled = available && safely(false) { printer.isBluetoothEnabled() }
                val devices = if (available && permission) {
                    safely(emptyList<PrinterDevice>()) { printer.bondedPrinters() }
                } else {
                    emptyList()
                }
                // L'ordine (stampanti probabili in cima) lo decide gia PrinterManager.
                OnboardingUiState(
                    checked = true,
                    bluetoothAvailable = available,
                    bluetoothEnabled = enabled,
                    hasBluetoothPermission = permission,
                    printers = devices,
                )
            }
            _ui.update {
                it.copy(
                    checked = true,
                    bluetoothAvailable = snapshot.bluetoothAvailable,
                    bluetoothEnabled = snapshot.bluetoothEnabled,
                    hasBluetoothPermission = snapshot.hasBluetoothPermission,
                    printers = snapshot.printers,
                )
            }
        }
    }

    fun select(device: PrinterDevice) {
        _ui.update { it.copy(selectedAddress = device.address, testResult = null) }
        val previous = selectJob
        // Nello scope dell'app: la scelta deve arrivare su disco anche se si chiude subito l'onboarding.
        selectJob = graph.scope.launch {
            previous?.join()
            try {
                graph.printer.select(device)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Scelta della stampante non salvata", e)
            }
        }
    }

    fun printTestPage() {
        if (_ui.value.testing) return
        _ui.update { it.copy(testing = true, testResult = null) }
        val pendingSelect = selectJob
        val job = graph.scope.async {
            // Se la stampante e appena stata scelta, la pagina di prova deve andare a lei.
            pendingSelect?.join()
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
    }
}
