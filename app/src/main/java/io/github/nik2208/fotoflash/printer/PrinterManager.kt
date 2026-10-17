package io.github.nik2208.fotoflash.printer

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.data.SettingsRepository
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.PrintJobOptions
import io.github.nik2208.fotoflash.thermal.ThermalJob
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Unico proprietario della stampante: stato osservabile, connessione, lavori di stampa.
 *
 * - Un lavoro alla volta: chi arriva mentre si stampa riceve subito BUSY (niente code nascoste).
 * - La connessione resta aperta tra stampe vicine e si chiude dopo 45 s di inattivita.
 * - Ogni chiusura dopo un lavoro aspetta che la stampante abbia svuotato il buffer.
 * - I lavori girano nello scope applicativo: se la schermata che li ha chiesti sparisce, la
 *   stampa finisce comunque (una foto tagliata a meta e peggio di una stampa in piu).
 * - Gli errori diventano PrintFailure con un messaggio per l'utente; la causa tecnica va nel log.
 *   La stampante salvata non viene mai dimenticata da sola: solo forget() la toglie.
 */
class PrinterManager(context: Context, private val settings: SettingsRepository, private val scope: CoroutineScope) {

    private val appContext: Context = context.applicationContext
    private val transport = BtSppTransport(appContext)

    /** Protegge socket e lavori: lo prendono stampa, chiusure, cambio stampante e ricevitori. */
    private val jobLock = Mutex()

    private val _state = MutableStateFlow<PrinterState>(PrinterState.NotConfigured)
    val state: StateFlow<PrinterState> = _state.asStateFlow()

    /** Indirizzo a cui e aperto il socket, null se chiuso. */
    @Volatile
    private var connectedAddress: String? = null

    @Volatile
    private var lastJobBytes: Long = 0L

    @Volatile
    private var lastJobEndedAt: Long = 0L

    @Volatile
    private var idleDisconnect: Job? = null

    /** Esito della classificazione "sembra una stampante", calcolato in bondedPrinters(). */
    private val likelyPrinters = ConcurrentHashMap<String, Boolean>()

    private val systemReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                        BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> onLinkLost(null)
                        BluetoothAdapter.STATE_ON -> clearStaleBluetoothError()
                    }
                }
                BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                    val device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    val address = try {
                        device?.address
                    } catch (_: SecurityException) {
                        null
                    }
                    // Senza indirizzo leggibile non si sa chi si e scollegato: meglio non toccare nulla.
                    if (address != null) onLinkLost(address)
                }
            }
        }
    }

    init {
        // Stato a riposo derivato dalle impostazioni: NotConfigured o Disconnected(stampante salvata).
        scope.launch {
            settings.settings
                .map { configuredDevice(it) }
                .distinctUntilChanged()
                .collect { device -> applyConfiguredDevice(device) }
        }
        val filter = IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
        }
        // Broadcast protetti inviati anche dal processo Bluetooth (non dall'UID di sistema): per
        // riceverli serve EXPORTED; nessun'altra app puo falsificarli.
        ContextCompat.registerReceiver(appContext, systemReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
    }

    /** Permessi runtime da chiedere su questa versione di Android (Android 12+: Dispositivi nelle vicinanze). */
    fun requiredPermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            emptyArray()
        }

    fun hasBluetoothPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED

    fun isBluetoothAvailable(): Boolean = adapter() != null

    fun isBluetoothEnabled(): Boolean = try {
        adapter()?.isEnabled == true
    } catch (_: SecurityException) {
        false
    }

    /**
     * Tutti i dispositivi accoppiati, ordinati per nome con prima quelli che sembrano stampanti
     * (classe IMAGING o nome tipico). Non si esclude nessuno: molti cloni hanno nomi improbabili.
     */
    @SuppressLint("MissingPermission")
    fun bondedPrinters(): List<PrinterDevice> {
        if (!hasBluetoothPermission()) return emptyList()
        val adapter = adapter() ?: return emptyList()
        val bonded = try {
            adapter.bondedDevices.orEmpty().toList()
        } catch (_: SecurityException) {
            return emptyList()
        }
        val entries = bonded.mapNotNull { device ->
            try {
                val address = device.address.uppercase(Locale.ROOT)
                val name = device.name?.takeIf { it.isNotBlank() } ?: address
                val imaging = device.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.IMAGING
                val likely = imaging || looksLikePrinterName(name)
                likelyPrinters[address] = likely
                Pair(PrinterDevice(name, address), likely)
            } catch (_: SecurityException) {
                null
            }
        }
        return entries
            .sortedWith(
                compareByDescending<Pair<PrinterDevice, Boolean>> { it.second }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.first.name },
            )
            .map { it.first }
    }

    /** Vero se il dispositivo sembra una stampante (classe Bluetooth o nome); serve solo all'interfaccia. */
    fun isLikelyPrinter(device: PrinterDevice): Boolean =
        likelyPrinters[device.address.uppercase(Locale.ROOT)] ?: looksLikePrinterName(device.name)

    suspend fun select(device: PrinterDevice) {
        val normalized = device.copy(address = device.address.trim().uppercase(Locale.ROOT))
        settings.update { it.copy(printerAddress = normalized.address, printerName = normalized.name) }
        // Riscegliere la stessa stampante dopo un errore riparte da uno stato pulito; un indirizzo
        // diverso lo gestisce applyConfiguredDevice (chiude il vecchio socket).
        val current = _state.value
        if (current is PrinterState.Error && current.device?.address == normalized.address) {
            _state.compareAndSet(current, PrinterState.Disconnected(normalized))
        }
    }

    suspend fun forget() {
        cancelIdleDisconnect()
        // applyConfiguredDevice(null) chiude la connessione e porta lo stato a NotConfigured.
        settings.update { it.copy(printerAddress = null, printerName = null) }
    }

    suspend fun print(image: BitImage, copies: Int = 1): PrintOutcome =
        scope.async {
            runJob(copies.coerceIn(1, PrinterTuning.COPIES_MAX)) { s, _ ->
                val options = PrintJobOptions(
                    bandHeight = PrinterTuning.clampBandHeight(s.bandHeight),
                    feedLinesAfter = PrinterTuning.clampFeedLines(s.feedLines),
                    cut = s.cutPaper,
                    heat = PrinterTuning.heatFor(s.heatLevel),
                )
                withContext(Dispatchers.Default) { ThermalJob.build(image, options) }
            }
        }.await()

    suspend fun printTestPage(): PrintOutcome =
        scope.async {
            runJob(1) { s, device ->
                withContext(Dispatchers.Default) { TestPage.build(appContext, s, device.name) }
            }
        }.await()

    /** Chiude subito la connessione (dopo lo svuotamento), per liberare la stampante per un altro telefono. */
    suspend fun disconnect() {
        cancelIdleDisconnect()
        jobLock.withLock {
            closeConnection(drain = true)
            markDisconnected()
        }
    }

    /** Connected (o residui di Connecting/Printing) → Disconnected; gli altri stati restano. */
    private fun markDisconnected() {
        val device = when (val current = _state.value) {
            is PrinterState.Connected -> current.device
            is PrinterState.Connecting -> current.device
            is PrinterState.Printing -> current.device
            else -> null
        }
        if (device != null) _state.value = PrinterState.Disconnected(device)
    }

    // ---------------------------------------------------------------------------------------
    // Lavori

    private suspend fun runJob(
        copies: Int,
        buildPackets: suspend (AppSettings, PrinterDevice) -> List<ByteArray>,
    ): PrintOutcome {
        if (!jobLock.tryLock()) {
            // Lo stato non cambia: sta gia mostrando il lavoro in corso.
            return PrintOutcome.Failure(PrintFailure.BUSY, appContext.getString(R.string.prn_err_busy))
        }
        var device: PrinterDevice? = null
        try {
            cancelIdleDisconnect()
            val s = settings.current()
            val target = configuredDevice(s)
                ?: return fail(null, PrintFailure.NO_PRINTER, appContext.getString(R.string.prn_err_no_printer))
            device = target
            precheck(target)?.let { return it }

            val packets = buildPackets(s, target)
            val total = packets.sumOf { it.size.toLong() } * copies
            transport.configure(s.chunkSize, s.chunkDelayMs)
            val startedAt = SystemClock.elapsedRealtime()
            var retried = false
            while (true) {
                val reused = transport.isConnected && connectedAddress == target.address
                try {
                    if (!reused) {
                        // Socket aperto verso un'altra stampante (o morto): si chiude prima di riaprire.
                        if (connectedAddress != null) closeConnection(drain = true)
                        open(target)
                    }
                    send(target, packets, copies, total)
                    break
                } catch (e: PrinterWriteException) {
                    closeConnection(drain = false)
                    if (reused && !retried) {
                        // Una connessione tenuta aperta puo essere morta in silenzio (stampante
                        // spenta e riaccesa): si riconnette una volta e si rifa il lavoro da capo.
                        Log.w(TAG, "scrittura fallita su connessione riusata, riprovo", e)
                        retried = true
                        continue
                    }
                    throw e
                }
            }
            lastJobBytes = total
            lastJobEndedAt = SystemClock.elapsedRealtime()
            _state.value = PrinterState.Connected(target)
            scheduleIdleDisconnect()
            return PrintOutcome.Success(
                bytes = total.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
                millis = lastJobEndedAt - startedAt,
            )
        } catch (e: CancellationException) {
            // Succede solo se si chiude lo scope dell'app: la stampante resta con dati a meta.
            withContext(NonCancellable) { closeConnection(drain = false) }
            val lost = device
            _state.value = if (lost != null) PrinterState.Disconnected(lost) else PrinterState.NotConfigured
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "stampa fallita", e)
            withContext(NonCancellable) { closeConnection(drain = false) }
            return failFrom(device, e)
        } finally {
            jobLock.unlock()
        }
    }

    private suspend fun open(device: PrinterDevice) {
        _state.value = PrinterState.Connecting(device)
        transport.connect(device.address, PrinterTuning.CONNECT_TIMEOUT_MS)
        connectedAddress = device.address
        _state.value = PrinterState.Connected(device)
    }

    private suspend fun send(device: PrinterDevice, packets: List<ByteArray>, copies: Int, total: Long) {
        var sent = 0L
        var shownPercent = -1
        _state.value = PrinterState.Printing(device, 0f)
        repeat(copies) {
            for (packet in packets) {
                transport.write(packet) { n ->
                    sent += n
                    // Al massimo un aggiornamento per punto percentuale: niente tempeste di ricomposizioni.
                    val percent = if (total > 0L) (sent * 100L / total).toInt() else 100
                    if (percent != shownPercent) {
                        shownPercent = percent
                        val progress = if (total > 0L) (sent.toFloat() / total.toFloat()).coerceIn(0f, 1f) else 1f
                        _state.value = PrinterState.Printing(device, progress)
                    }
                }
            }
        }
    }

    /** Controlli prima di toccare il socket: errori chiari e immediati, senza passare da Connecting. */
    private fun precheck(device: PrinterDevice): PrintOutcome.Failure? {
        val adapter = adapter()
            ?: return fail(device, PrintFailure.BLUETOOTH_OFF, appContext.getString(R.string.prn_err_no_bluetooth))
        if (!hasBluetoothPermission()) {
            return fail(device, PrintFailure.NO_PERMISSION, appContext.getString(R.string.prn_err_permission))
        }
        val enabled = try {
            adapter.isEnabled
        } catch (_: SecurityException) {
            return fail(device, PrintFailure.NO_PERMISSION, appContext.getString(R.string.prn_err_permission))
        }
        if (!enabled) {
            return fail(device, PrintFailure.BLUETOOTH_OFF, appContext.getString(R.string.prn_err_bluetooth_off))
        }
        if (isBonded(adapter, device.address) == false) {
            return fail(device, PrintFailure.NOT_BONDED, appContext.getString(R.string.prn_err_not_bonded, device.name))
        }
        return null
    }

    /** null = non verificabile (lo dira il trasporto con la causa vera). */
    @SuppressLint("MissingPermission")
    private fun isBonded(adapter: BluetoothAdapter, address: String): Boolean? = try {
        adapter.bondedDevices.orEmpty().any { it.address.equals(address, ignoreCase = true) }
    } catch (_: SecurityException) {
        null
    }

    private fun fail(device: PrinterDevice?, failure: PrintFailure, message: String): PrintOutcome.Failure {
        _state.value = PrinterState.Error(device, failure, message)
        return PrintOutcome.Failure(failure, message)
    }

    private fun failFrom(device: PrinterDevice?, error: Throwable): PrintOutcome.Failure {
        val name = device?.name ?: appContext.getString(R.string.prn_unknown_printer)
        return when (error) {
            is BluetoothUnavailableException ->
                fail(device, PrintFailure.BLUETOOTH_OFF, appContext.getString(R.string.prn_err_no_bluetooth))
            is BluetoothDisabledException ->
                fail(device, PrintFailure.BLUETOOTH_OFF, appContext.getString(R.string.prn_err_bluetooth_off))
            is BluetoothPermissionException, is SecurityException ->
                fail(device, PrintFailure.NO_PERMISSION, appContext.getString(R.string.prn_err_permission))
            is PrinterNotBondedException ->
                fail(device, PrintFailure.NOT_BONDED, appContext.getString(R.string.prn_err_not_bonded, name))
            is PrinterConnectException -> if (error.timedOut) {
                fail(
                    device,
                    PrintFailure.CONNECT_FAILED,
                    appContext.getString(
                        R.string.prn_err_connect_timeout,
                        name,
                        (PrinterTuning.CONNECT_TIMEOUT_MS / 1000L).toInt(),
                    ),
                )
            } else {
                fail(device, PrintFailure.CONNECT_FAILED, appContext.getString(R.string.prn_err_connect, name))
            }
            is PrinterWriteException -> if (error.stalled) {
                fail(device, PrintFailure.WRITE_FAILED, appContext.getString(R.string.prn_err_write_stalled, name))
            } else {
                fail(device, PrintFailure.WRITE_FAILED, appContext.getString(R.string.prn_err_write, name))
            }
            else -> fail(
                device,
                PrintFailure.WRITE_FAILED,
                appContext.getString(
                    R.string.prn_err_unexpected,
                    error.message ?: error.javaClass.simpleName,
                ),
            )
        }
    }

    // ---------------------------------------------------------------------------------------
    // Connessione

    /** Chiude il socket; con [drain] aspetta prima che la stampante abbia ricevuto la coda dell'ultimo lavoro. */
    private suspend fun closeConnection(drain: Boolean) {
        if (drain && connectedAddress != null) {
            val needed = PrinterTuning.drainMillis(lastJobBytes)
            val elapsed = SystemClock.elapsedRealtime() - lastJobEndedAt
            val wait = needed - elapsed
            if (wait > 0L) delay(wait)
        }
        transport.close()
        connectedAddress = null
    }

    private fun scheduleIdleDisconnect() {
        idleDisconnect?.cancel()
        idleDisconnect = scope.launch {
            delay(PrinterTuning.IDLE_DISCONNECT_MS)
            // Se nel frattempo e partito un lavoro, ci pensera lui a riprogrammare la chiusura.
            if (!jobLock.tryLock()) return@launch
            try {
                if (connectedAddress != null) {
                    closeConnection(drain = true)
                    val current = _state.value
                    if (current is PrinterState.Connected) _state.value = PrinterState.Disconnected(current.device)
                }
            } finally {
                jobLock.unlock()
            }
        }
    }

    private fun cancelIdleDisconnect() {
        idleDisconnect?.cancel()
        idleDisconnect = null
    }

    /** Reazione alle impostazioni: nuova stampante, stessa con altro nome, oppure nessuna. */
    private suspend fun applyConfiguredDevice(device: PrinterDevice?) {
        // Aspetta l'eventuale lavoro in corso: lo stato finale lo decide chi arriva per ultimo.
        jobLock.withLock {
            val open = connectedAddress
            if (open != null && open != device?.address) {
                cancelIdleDisconnect()
                closeConnection(drain = true)
            }
            _state.value = when {
                device == null -> PrinterState.NotConfigured
                connectedAddress == device.address && transport.isConnected -> PrinterState.Connected(device)
                else -> PrinterState.Disconnected(device)
            }
        }
    }

    /** Bluetooth spento o collegamento ACL caduto: il socket aperto non vale piu nulla. */
    private fun onLinkLost(address: String?) {
        scope.launch {
            val open = connectedAddress ?: return@launch
            if (address != null && !address.equals(open, ignoreCase = true)) return@launch
            // Durante un lavoro la scrittura fallira da sola e il lavoro lo riportera.
            if (!jobLock.tryLock()) return@launch
            try {
                cancelIdleDisconnect()
                closeConnection(drain = false)
                val current = _state.value
                if (current is PrinterState.Connected) _state.value = PrinterState.Disconnected(current.device)
            } finally {
                jobLock.unlock()
            }
        }
    }

    /** Il Bluetooth e tornato: un errore "Bluetooth spento" non e piu vero. */
    private fun clearStaleBluetoothError() {
        val current = _state.value
        if (current is PrinterState.Error && current.failure == PrintFailure.BLUETOOTH_OFF) {
            val device = current.device
            _state.compareAndSet(
                current,
                if (device != null) PrinterState.Disconnected(device) else PrinterState.NotConfigured,
            )
        }
    }

    private fun configuredDevice(s: AppSettings): PrinterDevice? {
        val address = s.printerAddress?.trim()?.uppercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: return null
        val name = s.printerName?.takeIf { it.isNotBlank() } ?: address
        return PrinterDevice(name, address)
    }

    private fun adapter(): BluetoothAdapter? = appContext.getSystemService(BluetoothManager::class.java)?.adapter

    private fun looksLikePrinterName(name: String): Boolean {
        val lower = name.lowercase(Locale.ROOT)
        return PRINTER_HINTS.any { lower.contains(it) }
    }

    private companion object {
        const val TAG = "FotoFlashPrinter"

        /** Pezzi di nome tipici delle stampanti termiche economiche (solo per l'ordinamento). */
        val PRINTER_HINTS = listOf("print", "pos", "58", "mtp", "pt-", "thermal", "receipt")
    }
}
