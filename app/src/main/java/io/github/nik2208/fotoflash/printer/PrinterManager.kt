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
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.location.LocationManagerCompat
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.data.SettingsRepository
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.PrinterDriver
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.PrinterLink
import io.github.nik2208.fotoflash.thermal.TestPageLabels
import io.github.nik2208.fotoflash.thermal.TransportHints
import io.github.nik2208.fotoflash.thermal.blit
import io.github.nik2208.fotoflash.thermal.encodeTestPage
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
 * - I byte li prepara il driver scelto (docs/DRIVERS.md); il mezzo segue il collegamento della
 *   stampante: SPP con BtSppTransport, BLE con BleGattTransport. Stati, riconnessione, lock e
 *   chiusura per inattivita sono gli stessi per entrambi.
 */
class PrinterManager(context: Context, private val settings: SettingsRepository, private val scope: CoroutineScope) {

    private val appContext: Context = context.applicationContext
    private val sppTransport = BtSppTransport(appContext)
    private val bleTransport = BleGattTransport(appContext)
    private val scanner = BleScanner(appContext, scope) { scanPrecheck() }

    /** Protegge socket e lavori: lo prendono stampa, chiusure, cambio stampante e ricevitori. */
    private val jobLock = Mutex()

    private val _state = MutableStateFlow<PrinterState>(PrinterState.NotConfigured)
    val state: StateFlow<PrinterState> = _state.asStateFlow()

    /** Dispositivi BLE trovati dall'ultima ricerca (link = BLE). */
    val discovered: StateFlow<List<PrinterDevice>> = scanner.devices

    /** Vero mentre gira una ricerca BLE. */
    val scanning: StateFlow<Boolean> = scanner.scanning

    /** Perche l'ultima ricerca BLE non e partita o si e fermata; null = nessun problema. */
    val scanIssue: StateFlow<BleScanIssue?> = scanner.issue

    private val _selectedDriver = MutableStateFlow(PrinterDrivers.byId(null))

    /** Driver delle impostazioni correnti, osservabile (currentDriver() ne e la lettura istantanea). */
    val selectedDriver: StateFlow<PrinterDriver> = _selectedDriver.asStateFlow()

    /** Indirizzo e collegamento aperti, null se chiuso. */
    @Volatile
    private var connectedAddress: String? = null

    @Volatile
    private var connectedLink: PrinterLink? = null

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
        // Driver corrente, e carta sempre allineata al driver (anche per le impostazioni di prima dei driver).
        scope.launch {
            settings.settings
                .map { it.printerDriver to it.paper }
                .distinctUntilChanged()
                .collect { (driverId, paper) ->
                    val current = PrinterDrivers.byId(driverId)
                    _selectedDriver.value = current
                    if (current.paper != paper) settings.update { alignPaper(it) }
                }
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

    // ---------------------------------------------------------------------------------------
    // Ricerca BLE

    /**
     * Permessi per la ricerca BLE. Android 12+: BLUETOOTH_SCAN (dichiarato "neverForLocation") e
     * BLUETOOTH_CONNECT; fino ad Android 11 la ricerca BLE richiede la posizione precisa.
     */
    fun scanPermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    fun hasScanPermission(): Boolean = scanPermissions().all {
        ContextCompat.checkSelfPermission(appContext, it) == PackageManager.PERMISSION_GRANTED
    }

    /** Fino ad Android 11 la ricerca BLE non trova nulla se la Localizzazione del telefono e spenta. */
    fun isLocationNeededForScan(): Boolean = Build.VERSION.SDK_INT <= Build.VERSION_CODES.R

    /** Localizzazione di sistema attiva (conta solo se [isLocationNeededForScan]). */
    fun isLocationEnabled(): Boolean {
        val manager = appContext.getSystemService(LocationManager::class.java) ?: return false
        return LocationManagerCompat.isLocationEnabled(manager)
    }

    /**
     * Cerca le stampanti BLE vicine per [timeoutMs]; i risultati arrivano in [discovered].
     * Senza permessi, Bluetooth o Localizzazione non parte e lo dice [scanIssue].
     */
    fun startBleScan(timeoutMs: Long = PrinterTuning.BLE_SCAN_TIMEOUT_MS) {
        scanner.start(timeoutMs)
    }

    fun stopBleScan() {
        scanner.stop()
    }

    private fun scanPrecheck(): BleScanIssue? {
        if (adapter() == null) return BleScanIssue.UNAVAILABLE
        if (!hasScanPermission()) return BleScanIssue.NO_PERMISSION
        if (!isBluetoothEnabled()) return BleScanIssue.BLUETOOTH_OFF
        if (isLocationNeededForScan() && !isLocationEnabled()) return BleScanIssue.LOCATION_OFF
        return null
    }

    // ---------------------------------------------------------------------------------------
    // Stampante e driver

    /** Driver delle impostazioni correnti (escpos-58 finche le impostazioni non sono lette). */
    fun currentDriver(): PrinterDriver = _selectedDriver.value

    /**
     * Tutti i dispositivi accoppiati (SPP), ordinati per nome con prima quelli che sembrano
     * stampanti (classe IMAGING, nome tipico o riconosciuto da un driver). Non si esclude nessuno:
     * molti cloni hanno nomi improbabili.
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
                Pair(PrinterDevice(name, address, PrinterLink.CLASSIC), likely)
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

    /**
     * Sceglie la stampante e il suo driver. [driverId] null = riconoscimento dal nome
     * (PrinterDrivers.guess); se il nome non dice nulla si tiene il driver ESC/POS in uso, altrimenti
     * escpos-58. Riscegliere la stessa stampante non cambia un driver scelto a mano.
     * La carta segue il driver; il retino passa a quello del driver solo se era quello del precedente.
     */
    suspend fun select(device: PrinterDevice, driverId: String? = null) {
        val normalized = device.copy(address = device.address.trim().uppercase(Locale.ROOT))
        // Con la stampante scelta la ricerca non serve piu e rallenterebbe il collegamento BLE.
        if (normalized.link == PrinterLink.BLE) scanner.stop()
        settings.update { s ->
            val previous = PrinterDrivers.byId(s.printerDriver)
            val sameDevice = s.printerAddress.equals(normalized.address, ignoreCase = true) && s.printerLink == normalized.link
            val chosen = when {
                driverId != null -> PrinterDrivers.byId(driverId)
                sameDevice -> previous
                // Stessa regola della PWA (manager.js): il nome non distingue una ESC/POS da 58 mm da una da
                // 80 mm, quindi tra ESC/POS resta la scelta dell'utente; un nome sconosciuto lascia una ESC/POS
                // com'è e riporta un Phomemo alla 58 mm.
                else -> {
                    val guessed = PrinterDrivers.guess(normalized.name)
                    when {
                        guessed != null && PrinterTuning.isEscPos(guessed) && PrinterTuning.isEscPos(previous) -> previous
                        guessed != null -> guessed
                        PrinterTuning.isEscPos(previous) -> previous
                        else -> PrinterDrivers.byId(null)
                    }
                }
            }
            withDriver(
                s.copy(printerAddress = normalized.address, printerName = normalized.name, printerLink = normalized.link),
                chosen,
            )
        }
        // Riscegliere la stessa stampante dopo un errore riparte da uno stato pulito; un indirizzo
        // diverso lo gestisce applyConfiguredDevice (chiude il vecchio collegamento).
        val current = _state.value
        if (current is PrinterState.Error && current.device?.address == normalized.address) {
            _state.compareAndSet(current, PrinterState.Disconnected(normalized))
        }
    }

    /** Cambia il driver della stampante scelta (carta e retino come in [select]). */
    suspend fun setDriver(driverId: String) {
        val chosen = PrinterDrivers.byId(driverId)
        settings.update { withDriver(it, chosen) }
    }

    suspend fun forget() {
        cancelIdleDisconnect()
        // applyConfiguredDevice(null) chiude la connessione e porta lo stato a NotConfigured.
        settings.update { it.copy(printerAddress = null, printerName = null, printerLink = PrinterLink.CLASSIC) }
    }

    suspend fun print(image: BitImage, copies: Int = 1): PrintOutcome {
        // Ristampa dallo storico dopo un cambio di carta: un'immagine piu larga della testina uscirebbe
        // come spazzatura, quindi si rifiuta subito, senza toccare stato e connessione.
        val requested = PrinterDrivers.byId(settings.current().printerDriver)
        if (image.width > requested.paper.dots) {
            return PrintOutcome.Failure(PrintFailure.RENDER_FAILED, tooWideMessage(image.width, requested))
        }
        return scope.async {
            runJob(copies.coerceIn(1, PrinterTuning.COPIES_MAX)) { s, _, driver ->
                val dots = driver.paper.dots
                // Driver cambiato nel frattempo: il try di runJob lo traduce in RENDER_FAILED.
                if (image.width > dots) throw RenderRejectedException(tooWideMessage(image.width, driver))
                val options = PrinterTuning.driverOptions(s)
                withContext(Dispatchers.Default) {
                    // Composta per carta piu stretta: la si centra invece di lasciarla attaccata a sinistra.
                    val fitted = if (image.width < dots) {
                        BitImage(dots, image.height).also { it.blit(image, (dots - image.width) / 2, 0) }
                    } else {
                        image
                    }
                    driver.encode(fitted, options)
                }
            }
        }.await()
    }

    /**
     * Pagina di prova del driver: per ESC/POS quella testuale dell'app (con i dati di taratura),
     * per gli altri la pagina raster del driver (la M02 Pro non ha font affidabili), con i testi
     * localizzati, il retino scelto in evidenza e i parametri di invio in uso.
     */
    suspend fun printTestPage(): PrintOutcome =
        scope.async {
            runJob(1) { s, device, driver ->
                val hints = if (device.link == PrinterLink.BLE) PrinterTuning.bleHints(driver, s) else null
                withContext(Dispatchers.Default) {
                    if (PrinterTuning.isEscPos(driver)) {
                        TestPage.build(appContext, s, device.name, bleHints = hints)
                    } else {
                        driver.encodeTestPage(PrinterTuning.driverOptions(s), rasterTestLabels(s, device, hints))
                    }
                }
            }
        }.await()

    /**
     * Testi della pagina di prova raster nella lingua dell'app. Restano le righe tecniche del driver
     * (id, punti, dpi, densita, velocita): sono sigle che servono a chi confronta due stampe.
     */
    private fun rasterTestLabels(s: AppSettings, device: PrinterDevice, hints: TransportHints?): TestPageLabels {
        fun text(res: Int, vararg args: Any): String = TestPage.asciiOnly(appContext.getString(res, *args))
        val extra = ArrayList<String>(2)
        extra.add(text(R.string.prn_test_printer, device.name))
        if (hints != null) {
            val mode = appContext.getString(if (hints.withoutResponse) R.string.prn_ble_no_response else R.string.prn_ble_with_response)
            extra.add(text(R.string.prn_test_transfer_ble_raster, hints.chunkSize, hints.chunkDelayMs, mode))
        }
        return TestPageLabels(
            subtitle = text(R.string.prn_test_subtitle),
            extraLines = extra,
            widthCheck = text(R.string.prn_test_width),
            ditherTitle = text(R.string.prn_test_dither),
            ditherNames = DitherAlgorithm.entries.associateWith { text(TestPage.ditherName(it)) },
            highlight = s.dither,
            highlightSuffix = " *",
            grayTitle = text(R.string.prn_test_gray),
            blackTitle = text(R.string.prn_test_black),
            footer = text(R.string.prn_test_end),
        )
    }

    /** Chiude subito la connessione (dopo lo svuotamento), per liberare la stampante per un altro telefono. */
    suspend fun disconnect() {
        // Nello scope dell'app: se la schermata sparisce durante lo svuotamento la chiusura finisce
        // comunque (altrimenti il collegamento resterebbe aperto, senza timer, e la stampante occupata).
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
                // L'accoppiamento riguarda solo l'SPP: per una stampante BLE l'errore non ha piu senso.
                errorDevice?.link == PrinterLink.BLE ||
                    (
                        adapter != null && errorDevice != null && hasBluetoothPermission() &&
                            isBonded(adapter, errorDevice.address) == true
                        )
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
        buildPackets: suspend (AppSettings, PrinterDevice, PrinterDriver) -> List<ByteArray>,
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
            val driver = PrinterDrivers.byId(s.printerDriver)

            // Composizione: se fallisce la stampante non c'entra, quindi niente errore nello stato
            // e nessuna chiusura di una connessione sana.
            val packets = try {
                buildPackets(s, target, driver)
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
            val transport = prepareTransport(target.link, driver, s)
            val startedAt = SystemClock.elapsedRealtime()
            var retried = false
            while (true) {
                val reused = transport.isConnected && connectedAddress == target.address && connectedLink == target.link
                var sentBytes = 0L
                try {
                    if (!reused) {
                        // Collegamento aperto verso un'altra stampante (o morto): si chiude prima di riaprire.
                        if (connectedAddress != null) closeConnection(drain = true)
                        open(target, transport)
                    }
                    send(target, transport, packets, copies, total) { n -> sentBytes += n }
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
            // Collegamento rimasto aperto senza timer (es. precheck fallito o composizione fallita con
            // una connessione viva): si riprogramma la chiusura, altrimenti la stampante resta occupata.
            if (connectedAddress != null && idleDisconnect == null) scheduleIdleDisconnect()
            jobRunning = false
            jobLock.unlock()
        }
    }

    /**
     * Il trasporto del collegamento, configurato per questo lavoro: in SPP blocchi e pause delle
     * impostazioni; in BLE i profili del driver e i suoi parametri di invio, con le scelte dell'utente.
     */
    private fun prepareTransport(link: PrinterLink, driver: PrinterDriver, s: AppSettings): PrinterTransport =
        when (link) {
            PrinterLink.CLASSIC -> sppTransport.also { it.configure(s.chunkSize, s.chunkDelayMs) }
            PrinterLink.BLE -> bleTransport.also { it.configure(driver.bleProfiles, PrinterTuning.bleHints(driver, s)) }
        }

    private suspend fun open(device: PrinterDevice, transport: PrinterTransport) {
        _state.value = PrinterState.Connecting(device)
        // Una ricerca BLE in corso rallenta o fa fallire il collegamento.
        if (device.link == PrinterLink.BLE) scanner.stop()
        transport.connect(device.address, PrinterTuning.connectTimeoutMs(device.link))
        connectedAddress = device.address
        connectedLink = device.link
        _state.value = PrinterState.Connected(device)
    }

    /** Invia il lavoro; [onBytes] riceve i byte accettati di ogni blocco (serve a decidere se riprovare). */
    private suspend fun send(
        device: PrinterDevice,
        transport: PrinterTransport,
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

    /** Controlli prima di toccare il collegamento: errori chiari e immediati, senza passare da Connecting. */
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
        // Le stampanti BLE non si accoppiano: il controllo vale solo per l'SPP.
        if (device.link == PrinterLink.CLASSIC && isBonded(adapter, device.address) == false) {
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
        // Bluetooth spento durante la connessione o la stampa: arriva come errore di collegamento, ma
        // la causa vera e questa, e l'azione giusta e "Accendi il Bluetooth", non "Riprova".
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
            is BleNoChannelException ->
                fail(device, PrintFailure.CONNECT_FAILED, appContext.getString(R.string.prn_err_ble_no_channel, name))
            is PrinterConnectException -> if (error.timedOut) {
                val link = device?.link ?: PrinterLink.CLASSIC
                fail(
                    device,
                    PrintFailure.CONNECT_FAILED,
                    appContext.getString(
                        R.string.prn_err_connect_timeout,
                        name,
                        (PrinterTuning.connectTimeoutMs(link) / 1000L).toInt(),
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

    /** Chiude il collegamento; con [drain] aspetta prima che la stampante abbia ricevuto la coda dell'ultimo lavoro. */
    private suspend fun closeConnection(drain: Boolean) {
        try {
            // In BLE ogni pezzo e gia stato consegnato al controller: l'attesa finale del driver la fa
            // BleGattTransport.close(). In SPP flush() non lo garantisce, quindi si stima lo svuotamento.
            if (drain && connectedAddress != null && connectedLink != PrinterLink.BLE) {
                val needed = PrinterTuning.drainMillis(lastJobBytes)
                val elapsed = SystemClock.elapsedRealtime() - lastJobEndedAt
                val wait = needed - elapsed
                if (wait > 0L) delay(wait)
            }
        } finally {
            // Anche se chi chiude viene cancellato durante l'attesa, il collegamento si chiude davvero.
            withContext(NonCancellable) {
                sppTransport.close()
                bleTransport.close()
            }
            connectedAddress = null
            connectedLink = null
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

    /** Reazione alle impostazioni: nuova stampante, stessa con altro nome o collegamento, oppure nessuna. */
    private suspend fun applyConfiguredDevice(device: PrinterDevice?) {
        // Aspetta l'eventuale lavoro in corso: lo stato finale lo decide chi arriva per ultimo.
        jobLock.withLock {
            val open = connectedAddress
            if (open != null && (open != device?.address || connectedLink != device?.link)) {
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
                connectedAddress == device.address && connectedLink == device.link &&
                    transportFor(device.link).isConnected -> PrinterState.Connected(device)
                else -> PrinterState.Disconnected(device)
            }
        }
    }

    private fun transportFor(link: PrinterLink): PrinterTransport =
        if (link == PrinterLink.BLE) bleTransport else sppTransport

    /** Bluetooth spento o collegamento ACL caduto: il collegamento aperto non vale piu nulla. */
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
     * Bluetooth spento: il collegamento aperto non vale piu nulla e, a riposo, lo stato deve dirlo
     * subito (altrimenti la pillola resta "a riposo" e lo si scopre solo dopo lo scatto).
     */
    private fun onBluetoothOff() {
        scanner.stop()
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

    /**
     * Messaggio per un'immagine composta per una carta piu larga di quella del driver. 576 punti
     * possono essere 80 mm (203 dpi) o la M02 Pro (300 dpi): si propone prima la carta con la
     * risoluzione del driver in uso, poi la piu stretta che basta.
     */
    private fun tooWideMessage(width: Int, driver: PrinterDriver): String {
        val fits = PaperWidth.entries.filter { it.dots >= width }
        val paper = fits.filter { it.dpi == driver.paper.dpi }.minByOrNull { it.dots }
            ?: fits.minByOrNull { it.dots }
            ?: PaperWidth.entries.maxBy { it.dots }
        return appContext.getString(R.string.prn_err_too_wide, paper.mm)
    }

    private fun configuredDevice(s: AppSettings): PrinterDevice? {
        val address = s.printerAddress?.trim()?.uppercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: return null
        val name = s.printerName?.takeIf { it.isNotBlank() } ?: address
        return PrinterDevice(name, address, s.printerLink)
    }

    private fun adapter(): BluetoothAdapter? = appContext.getSystemService(BluetoothManager::class.java)?.adapter

    private fun looksLikePrinterName(name: String): Boolean {
        val lower = name.lowercase(Locale.ROOT)
        return PRINTER_HINTS.any { lower.contains(it) } || PrinterDrivers.guess(name) != null
    }

    private companion object {
        const val TAG = "FotoFlashPrinter"

        /** Pezzi di nome tipici delle stampanti termiche economiche (solo per l'ordinamento). */
        val PRINTER_HINTS = listOf("print", "pos", "58", "mtp", "pt-", "thermal", "receipt")

        /**
         * Nuovo driver: carta del driver; il retino proposto dal driver solo se l'utente teneva quello
         * del precedente; le scelte di invio BLE (tarate sul driver precedente) tornano ai predefiniti.
         */
        fun withDriver(s: AppSettings, driver: PrinterDriver): AppSettings {
            val previous = PrinterDrivers.byId(s.printerDriver)
            if (previous.id == driver.id) return s.copy(printerDriver = driver.id, paper = driver.paper)
            val changed = s.copy(
                printerDriver = driver.id,
                paper = driver.paper,
                dither = if (s.dither == previous.defaultDither) driver.defaultDither else s.dither,
            )
            // La taratura BLE vale per una famiglia di protocollo: si azzera solo cambiando famiglia
            // (ESC/POS ↔ Phomemo), come nella PWA.
            if (PrinterTuning.isEscPos(previous) == PrinterTuning.isEscPos(driver)) return changed
            return changed.copy(bleChunkSize = null, bleChunkDelayMs = null, bleWithoutResponse = null)
        }

        /**
         * Carta diversa da quella del driver. Nelle impostazioni di prima dei driver la carta 58/80 era
         * una scelta dell'utente e il driver un valore predefinito: in quel caso vince la carta.
         */
        fun alignPaper(s: AppSettings): AppSettings {
            val driver = PrinterDrivers.byId(s.printerDriver)
            if (driver.paper == s.paper) return s
            val legacy = if (PrinterTuning.isEscPos(driver)) PrinterTuning.escPosDriverFor(s.paper) else null
            return if (legacy != null) s.copy(printerDriver = legacy) else s.copy(paper = driver.paper)
        }
    }
}

/** Composizione rifiutata con un messaggio gia pronto per l'utente (es. immagine piu larga della carta). */
private class RenderRejectedException(val userMessage: String) : Exception(userMessage)
