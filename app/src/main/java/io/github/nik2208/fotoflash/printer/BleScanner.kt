package io.github.nik2208.fotoflash.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.thermal.BleProfile
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.PrinterLink
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Perche una ricerca BLE non e partita o si e interrotta: la schermata lo traduce in un'azione. */
enum class BleScanIssue { UNAVAILABLE, NO_PERMISSION, BLUETOOTH_OFF, LOCATION_OFF, FAILED }

/**
 * Profili GATT di stampa noti a tutti i driver: servono alla ricerca (filtri e riconoscimento) e
 * al trasporto (ripiego quando i profili del driver non bastano).
 */
internal object BleCatalog {

    /** Tutti i profili dei driver, senza doppioni, nell'ordine dei driver. */
    val profiles: List<BleProfile> by lazy {
        PrinterDrivers.all
            .flatMap { it.bleProfiles }
            .distinctBy { (it.service + "|" + it.write).lowercase(Locale.ROOT) }
    }

    val serviceUuids: Set<UUID> by lazy { profiles.mapNotNull { uuid(it.service) }.toSet() }

    /** UUID da testo; accetta anche le forme brevi a 16 e 32 bit ("ff00"). Null se non valido. */
    fun uuid(value: String): UUID? {
        val text = value.trim()
        val full = when (text.length) {
            4 -> "0000$text$BASE_SUFFIX"
            8 -> "$text$BASE_SUFFIX"
            else -> text
        }
        return try {
            UUID.fromString(full)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private const val BASE_SUFFIX = "-0000-1000-8000-00805f9b34fb"
}

/**
 * Ricerca delle stampanti BLE vicine.
 *
 * Due scansioni insieme: una con i filtri (servizi di stampa noti e nomi tipici, che il telefono
 * applica anche a schermo spento) e una senza filtri, da cui si tengono solo i dispositivi con un
 * nome riconosciuto da PrinterDrivers.guess, con un servizio noto o con il nome di un modello non
 * supportato (per dirlo all'utente). Android ignora in silenzio piu di 5 avvii di scansione in 30 s
 * per app: [ScanBudget] li conta e, se serve, rinuncia alla scansione filtrata o aspetta il turno.
 */
@SuppressLint("MissingPermission")
class BleScanner(
    context: Context,
    private val scope: CoroutineScope,
    /** Controlli prima di partire (permessi, Bluetooth, Localizzazione): null = si puo cercare. */
    private val precheck: () -> BleScanIssue?,
) {
    private val appContext: Context = context.applicationContext

    private val _devices = MutableStateFlow<List<PrinterDevice>>(emptyList())

    /** Dispositivi trovati dall'ultima ricerca, link = BLE; prima quelli riconosciuti da un driver. */
    val devices: StateFlow<List<PrinterDevice>> = _devices.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val _issue = MutableStateFlow<BleScanIssue?>(null)

    /** Problema dell'ultima ricerca (null = nessuno). */
    val issue: StateFlow<BleScanIssue?> = _issue.asStateFlow()

    private val lock = Any()

    /** Trovati per indirizzo, nell'ordine di scoperta. Protetto da [lock]. */
    private val found = LinkedHashMap<String, Found>()
    private var sequence = 0
    private var job: Job? = null

    /** Durata chiesta e scadenza della ricerca in corso (una nuova richiesta la allunga). */
    @Volatile
    private var requestedMs: Long = PrinterTuning.BLE_SCAN_TIMEOUT_MS

    @Volatile
    private var deadline: Long = 0L

    private val failures = AtomicInteger(0)
    private val started = AtomicInteger(0)

    /** Avvia una ricerca di [timeoutMs]; se ce n'e gia una in corso la allunga soltanto. */
    fun start(timeoutMs: Long) {
        synchronized(lock) {
            val duration = timeoutMs.coerceAtLeast(MIN_SCAN_MS)
            requestedMs = duration
            deadline = maxOf(deadline, SystemClock.elapsedRealtime() + duration)
            val previous = job
            if (previous?.isActive == true) return
            // Una ricerca appena fermata puo essere ancora nel suo finally (stopScan, scanning = false):
            // la nuova parte dopo, altrimenti quel finally la darebbe per ferma mentre cerca.
            job = scope.launch {
                previous?.join()
                run()
            }
        }
    }

    fun stop() {
        val running = synchronized(lock) { job }
        running?.cancel()
    }

    private suspend fun run() {
        val problem = precheck()
        if (problem != null) {
            _issue.value = problem
            return
        }
        val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null) {
            _issue.value = BleScanIssue.UNAVAILABLE
            return
        }
        val maybeScanner: BluetoothLeScanner? = try {
            adapter.bluetoothLeScanner
        } catch (_: SecurityException) {
            _issue.value = BleScanIssue.NO_PERMISSION
            return
        }
        // Con il Bluetooth spento lo scanner non esiste.
        if (maybeScanner == null) {
            _issue.value = BleScanIssue.BLUETOOTH_OFF
            return
        }
        val scanner: BluetoothLeScanner = maybeScanner
        synchronized(lock) {
            found.clear()
            sequence = 0
        }
        _devices.value = emptyList()
        _issue.value = null
        _scanning.value = true
        failures.set(0)
        started.set(0)
        val callbacks = ArrayList<ScanCallback>(2)
        try {
            val slots = ScanBudget.acquire(2)
            // La scadenza parte da qui: l'eventuale attesa del turno non accorcia la ricerca.
            deadline = maxOf(deadline, SystemClock.elapsedRealtime() + requestedMs)
            val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
            if (slots >= 2) {
                val filtered = callback(fromFilter = true)
                scanner.startScan(filters(), settings, filtered)
                callbacks += filtered
                started.incrementAndGet()
            }
            val open = callback(fromFilter = false)
            scanner.startScan(emptyList<ScanFilter>(), settings, open)
            callbacks += open
            started.incrementAndGet()
            while (true) {
                val left = deadline - SystemClock.elapsedRealtime()
                if (left <= 0L) break
                if (failures.get() >= started.get()) {
                    _issue.value = BleScanIssue.FAILED
                    break
                }
                delay(minOf(left, POLL_MS))
            }
        } catch (e: CancellationException) {
            // stop(): non e un problema da mostrare. Va intercettata prima di IllegalStateException,
            // di cui e una sottoclasse: altrimenti ogni ricerca fermata risulterebbe "Bluetooth spento".
            throw e
        } catch (e: SecurityException) {
            Log.w(TAG, "ricerca BLE senza permesso", e)
            _issue.value = BleScanIssue.NO_PERMISSION
        } catch (e: IllegalStateException) {
            // startScan con l'adattatore che si sta spegnendo.
            Log.w(TAG, "ricerca BLE con il Bluetooth spento", e)
            _issue.value = BleScanIssue.BLUETOOTH_OFF
        } finally {
            for (cb in callbacks) {
                try {
                    scanner.stopScan(cb)
                } catch (_: Exception) {
                    // Bluetooth gia spento o permesso revocato: la scansione e comunque finita.
                }
            }
            deadline = 0L
            _scanning.value = false
        }
    }

    private fun callback(fromFilter: Boolean): ScanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            onResult(result, fromFilter)
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
            results.forEach { onResult(it, fromFilter) }
        }

        override fun onScanFailed(errorCode: Int) {
            if (errorCode == ScanCallback.SCAN_FAILED_ALREADY_STARTED) return
            Log.w(TAG, "ricerca BLE non partita (codice $errorCode, filtrata=$fromFilter)")
            failures.incrementAndGet()
        }
    }

    private fun onResult(result: ScanResult, fromFilter: Boolean) {
        val device: BluetoothDevice = result.device ?: return
        val rawAddress: String? = try {
            device.address
        } catch (_: SecurityException) {
            null
        }
        val address = rawAddress?.uppercase(Locale.ROOT) ?: return
        val record = result.scanRecord
        // Il nome annunciato non richiede permessi; device.name solo come ripiego.
        val name = record?.deviceName?.trim()?.takeIf { it.isNotEmpty() } ?: safeName(device)
        val knownService = record?.serviceUuids.orEmpty().any { it.uuid in BleCatalog.serviceUuids }
        val recognized = PrinterDrivers.guess(name) != null
        val unsupported = PrinterTuning.isUnsupportedModel(name)
        if (!fromFilter && !recognized && !knownService && !unsupported) return
        val changed = synchronized(lock) {
            val previous = found[address]
            val shownName = name ?: previous?.device?.name ?: address
            val nowRecognized = recognized || previous?.recognized == true
            if (previous != null && previous.device.name == shownName && previous.recognized == nowRecognized) {
                false
            } else {
                found[address] = Found(
                    device = PrinterDevice(shownName, address, PrinterLink.BLE),
                    recognized = nowRecognized,
                    order = previous?.order ?: sequence++,
                )
                true
            }
        }
        if (changed) publish()
    }

    /** Elenco stabile: prima i riconosciuti, poi nell'ordine di scoperta (niente salti per l'RSSI). */
    private fun publish() {
        _devices.value = synchronized(lock) {
            found.values
                .sortedWith(compareByDescending<Found> { it.recognized }.thenBy { it.order })
                .map { it.device }
        }
    }

    private fun safeName(device: BluetoothDevice): String? = try {
        device.name?.trim()?.takeIf { it.isNotEmpty() }
    } catch (_: SecurityException) {
        null
    }

    private fun filters(): List<ScanFilter> {
        val byService = BleCatalog.serviceUuids.map { ScanFilter.Builder().setServiceUuid(ParcelUuid(it)).build() }
        val byName = TYPICAL_NAMES.map { ScanFilter.Builder().setDeviceName(it).build() }
        return byService + byName
    }

    private data class Found(val device: PrinterDevice, val recognized: Boolean, val order: Int)

    /**
     * Android scarta in silenzio il sesto avvio di scansione in 30 s della stessa app: qui si
     * contano gli avvii di tutto il processo e si concede solo quello che la piattaforma accetta.
     */
    private object ScanBudget {
        private const val WINDOW_MS = 30_000L
        private const val MAX_STARTS = 5
        private val starts = ArrayList<Long>()

        /** Avvii concessi adesso (da 1 a [wanted]); con la finestra piena aspetta un posto libero. */
        suspend fun acquire(wanted: Int): Int {
            while (true) {
                val wait: Long = synchronized(this) {
                    val now = SystemClock.elapsedRealtime()
                    starts.removeAll { now - it >= WINDOW_MS }
                    val free = MAX_STARTS - starts.size
                    if (free > 0) {
                        val granted = minOf(wanted, free)
                        repeat(granted) { starts.add(now) }
                        return granted
                    }
                    WINDOW_MS - (now - starts.min()) + 50L
                }
                delay(wait.coerceAtLeast(50L))
            }
        }
    }

    private companion object {
        const val TAG = "FotoFlashBleScan"
        const val MIN_SCAN_MS = 2_000L
        const val POLL_MS = 250L

        /** Nomi annunciati esatti delle stampanti piu comuni (il filtro per nome e solo esatto). */
        val TYPICAL_NAMES = listOf("M02 Pro", "M02PRO", "M02S", "M02", "BlueTooth Printer")
    }
}
