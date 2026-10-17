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
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.PrintJobOptions
import io.github.nik2208.fotoflash.thermal.ThermalJob
import io.github.nik2208.fotoflash.thermal.blit
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
import kotlinx.coroutines.withTimeoutOrNull

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

    /** Vero mentre gira un lavoro di stampa: distingue un lavoro vero da una chiusura che tiene il lock. */
    @Volatile
    private var jobRunning: Boolean = false

    /** Esito della classificazione "sembra una stampante", calcolato in bondedPrinters(). */
    private val likelyPrinters = ConcurrentHashMap<String, Boolean>()

    private val systemReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                        BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> onBluetoothOff()
                        BluetoothAdapter.STATE_ON -> revalidate()
                    }
                }
                // Stampante riaccoppiata: un errore "non accoppiata" non e piu vero.
                BluetoothDevice.ACTION_BOND_STATE_CHANGED -> revalidate()
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
            addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
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

    suspend fun print(image: BitImage, copies: Int = 1): PrintOutcome {
        // Ristampa dallo storico dopo un cambio di carta: un'immagine piu larga della testina uscirebbe
        // come spazzatura, quindi si rifiuta subito, senza toccare stato e connessione.
        if (image.width > settings.current().paper.dots) {
            return PrintOutcome.Failure(PrintFailure.RENDER_FAILED, tooWideMessage(image.width))
        }
        return scope.async {
            runJob(copies.coerceIn(1, PrinterTuning.COPIES_MAX)) { s, _ ->
                val dots = s.paper.dots
                // Carta cambiata nel frattempo: il try di runJob lo traduce in RENDER_FAILED.
                if (image.width > dots) throw RenderRejectedException(tooWideMessage(image.width))
                val options = PrintJobOptions(
                    bandHeight = PrinterTuning.clampBandHeight(s.bandHeight),
                    feedLinesAfter = PrinterTuning.clampFeedLines(s.feedLines),
                    cut = s.cutPaper,
                    heat = PrinterTuning.heatFor(s.heatLevel),
                )
                withContext(Dispatchers.Default) {
                    // Composta per carta piu stretta: la si centra invece di lasciarla attaccata a sinistra.
                    val fitted = if (image.width < dots) {
                        BitImage(dots, image.height).also { it.blit(image, (dots - image.width) / 2, 0) }
                    } else {
                        image
                    }
                    ThermalJob.build(fitted, options)
                }
            }
        }.await()
    }

    suspend fun printTestPage(): PrintOutcome =
        scope.async {
            runJob(1) { s, device ->
                withContext(Dispatchers.Default) { TestPage.build(appContext, s, device.name) }
            }
        }.await()

    /** Chiude subito la connessione (dopo lo svuotamento), per liberare la stampante per un altro telefono. */
    suspend fun disconnect() {
        // Nello scope dell'app: se la schermata sparisce durante lo svuotamento la chiusura finisce
        // comunque (altrimenti il socket resterebbe aperto, senza timer, e la stampante occupata).
        scope.launch {
            cancelIdleDisconnect()
            jobLock.withLock {
                closeConnection(drain = true)
                markDisconnected()
            }
        }.join()
    }

    /**
     * Toglie dallo stato un errore di sistema che non e piu vero (permesso concesso, stampante
     * riaccoppiata, Bluetooth riacceso): le pillole di tutte le schermate devono dire com'e adesso.
     */
    fun revalidate() {
        val current = _state.value as? PrinterState.Error ?: return
        val errorDevice = current.device
        val stale = when (current.failure) {
            PrintFailure.NO_PERMISSION -> hasBluetoothPermission()
            PrintFailure.BLUETOOTH_OFF -> adapter() != null && isBluetoothEnabled()
            PrintFailure.NOT_BONDED -> {
                val adapter = adapter()
                adapter != null && errorDevice != null && hasBluetoothPermission() &&
                    isBonded(adapter, errorDevice.address) == true
            }
            else -> false
        }
        if (!stale) return
        _state.compareAndSet(
            current,
            if (errorDevice != null) PrinterState.Disconnected(errorDevice) else PrinterState.NotConfigured,
        )
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
            // Il lock puo tenerlo anche una chiusura in corso (svuotamento fino a 4 s), non un lavoro:
            // in quel caso si aspetta un poco invece di dire "occupata" senza nessuna stampa in corso.
            val acquired = !jobRunning &&
                withTimeoutOrNull(PrinterTuning.DRAIN_MAX_MS + 1_000L) { jobLock.lock() } != null
            if (!acquired) {
                // Lo stato non cambia: sta gia mostrando il lavoro in corso.
                return PrintOutcome.Failure(PrintFailure.BUSY, appContext.getString(R.string.prn_err_busy))
            }
        }
        jobRunning = true
        var device: PrinterDevice? = null
        try {
            cancelIdleDisconnect()
            val s = settings.current()
            val target = configuredDevice(s)
                ?: return fail(null, PrintFailure.NO_PRINTER, appContext.getString(R.string.prn_err_no_printer))
            device = target
            precheck(target)?.let { return it }

            // Composizione: se fallisce la stampante non c'entra, quindi niente errore nello stato
            // e nessuna chiusura di una connessione sana.
            val packets = try {
                buildPackets(s, target)
            } catch (e: CancellationException) {
                throw e
            } catch (e: RenderRejectedException) {
                Log.w(TAG, "composizione rifiutata", e)
                return PrintOutcome.Failure(PrintFailure.RENDER_FAILED, e.userMessage)
            } catch (e: Exception) {
                Log.w(TAG, "composizione fallita", e)
                return PrintOutcome.Failure(PrintFailure.RENDER_FAILED, appContext.getString(R.string.prn_err_render))
            } catch (e: OutOfMemoryError) {
                Log.w(TAG, "memoria insufficiente per comporre la stampa", e)
                return PrintOutcome.Failure(PrintFailure.RENDER_FAILED, appContext.getString(R.string.prn_err_render))
            }
            val total = packets.sumOf { it.size.toLong() } * copies
            transport.configure(s.chunkSize, s.chunkDelayMs)
            val startedAt = SystemClock.elapsedRealtime()
            var retried = false
            while (true) {
                val reused = transport.isConnected && connectedAddress == target.address
                var sentBytes = 0L
                try {
                    if (!reused) {
                        // Socket aperto verso un'altra stampante (o morto): si chiude prima di riaprire.
                        if (connectedAddress != null) closeConnection(drain = true)
                        open(target)
                    }
                    send(target, packets, copies, total) { n -> sentBytes += n }
                    break
                } catch (e: PrinterWriteException) {
                    closeConnection(drain = false)
                    // Una riconnessione sola: se il collegamento riusato era morto in silenzio (stampante
                    // spenta e riaccesa) o se uno nuovo e caduto prima di accettare dati. Mai dopo uno
                    // stallo (carta finita, coperchio aperto): raddoppierebbe solo l'attesa.
                    if (!retried && !e.stalled && (reused || sentBytes == 0L)) {
                        Log.w(TAG, "scrittura fallita (riusata=$reused, inviati=$sentBytes), riprovo", e)
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
            // Socket rimasto aperto senza timer (es. precheck fallito o composizione fallita con una
            // connessione viva): si riprogramma la chiusura, altrimenti la stampante resta occupata.
            if (connectedAddress != null && idleDisconnect == null) scheduleIdleDisconnect()
            jobRunning = false
            jobLock.unlock()
        }
    }

    private suspend fun open(device: PrinterDevice) {
        _state.value = PrinterState.Connecting(device)
        transport.connect(device.address, PrinterTuning.CONNECT_TIMEOUT_MS)
        connectedAddress = device.address
        _state.value = PrinterState.Connected(device)
    }

    /** Invia il lavoro; [onBytes] riceve i byte accettati di ogni blocco (serve a decidere se riprovare). */
    private suspend fun send(
        device: PrinterDevice,
        packets: List<ByteArray>,
        copies: Int,
        total: Long,
        onBytes: (Int) -> Unit,
    ) {
        var sent = 0L
        var shownPercent = -1
        _state.value = PrinterState.Printing(device, 0f)
        repeat(copies) {
            for (packet in packets) {
                transport.write(packet) { n ->
                    sent += n
                    onBytes(n)
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
        // Bluetooth spento durante la connessione o la stampa: arriva come errore di socket, ma la
        // causa vera e questa, e l'azione giusta e "Accendi il Bluetooth", non "Riprova".
        if (error !is BluetoothUnavailableException && error !is BluetoothPermissionException &&
            error !is SecurityException && hasBluetoothPermission() && adapter() != null && !isBluetoothEnabled()
        ) {
            return fail(device, PrintFailure.BLUETOOTH_OFF, appContext.getString(R.string.prn_err_bluetooth_off))
        }
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
        try {
            if (drain && connectedAddress != null) {
                val needed = PrinterTuning.drainMillis(lastJobBytes)
                val elapsed = SystemClock.elapsedRealtime() - lastJobEndedAt
                val wait = needed - elapsed
                if (wait > 0L) delay(wait)
            }
        } finally {
            // Anche se chi chiude viene cancellato durante l'attesa, il socket si chiude davvero.
            withContext(NonCancellable) { transport.close() }
            connectedAddress = null
        }
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
                // Bluetooth gia spento (anche all'avvio): la pillola lo dice subito, non dopo lo scatto.
                isBluetoothKnownOff() -> PrinterState.Error(
                    device,
                    PrintFailure.BLUETOOTH_OFF,
                    appContext.getString(R.string.prn_err_bluetooth_off),
                )
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

    /**
     * Bluetooth spento: il socket aperto non vale piu nulla e, a riposo, lo stato deve dirlo subito
     * (altrimenti la pillola resta "a riposo" e lo si scopre solo dopo lo scatto).
     */
    private fun onBluetoothOff() {
        scope.launch {
            if (!jobLock.tryLock()) {
                // Durante un lavoro la scrittura fallira da sola e il lavoro riportera l'errore;
                // se il lock lo tiene una chiusura, si aspetta che finisca.
                if (jobRunning) return@launch
                withTimeoutOrNull(PrinterTuning.DRAIN_MAX_MS + 1_000L) { jobLock.lock() } ?: return@launch
            }
            try {
                cancelIdleDisconnect()
                if (connectedAddress != null) closeConnection(drain = false)
                val device = configuredDevice(settings.current())
                // Si ricontrolla qui: se il Bluetooth e gia tornato acceso, l'errore sarebbe falso.
                if (device != null && isBluetoothKnownOff()) {
                    _state.value = PrinterState.Error(
                        device,
                        PrintFailure.BLUETOOTH_OFF,
                        appContext.getString(R.string.prn_err_bluetooth_off),
                    )
                } else {
                    markDisconnected()
                }
            } finally {
                jobLock.unlock()
            }
        }
    }

    /**
     * Vero solo se il Bluetooth risulta davvero spento: senza permesso isBluetoothEnabled() puo
     * restituire false anche ad adattatore acceso, e l'errore sarebbe falso.
     */
    private fun isBluetoothKnownOff(): Boolean =
        adapter() != null && hasBluetoothPermission() && !isBluetoothEnabled()

    /** Messaggio per un'immagine composta per una carta piu larga di quella impostata. */
    private fun tooWideMessage(width: Int): String {
        val mm = PaperWidth.entries.filter { it.dots >= width }.minByOrNull { it.dots }?.mm
            ?: PaperWidth.entries.maxBy { it.dots }.mm
        return appContext.getString(R.string.prn_err_too_wide, mm)
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

/** Composizione rifiutata con un messaggio gia pronto per l'utente (es. immagine piu larga della carta). */
private class RenderRejectedException(val userMessage: String) : Exception(userMessage)
