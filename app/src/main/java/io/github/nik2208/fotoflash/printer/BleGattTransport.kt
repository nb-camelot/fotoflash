package io.github.nik2208.fotoflash.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.Log
import io.github.nik2208.fotoflash.thermal.BleProfile
import io.github.nik2208.fotoflash.thermal.TransportHints
import java.io.IOException
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Trasporto Bluetooth Low Energy (GATT) verso stampanti che non parlano SPP, come le Phomemo.
 *
 * - Collegamento diretto (autoConnect = false) con TRANSPORT_LE, scoperta dei servizi e MTU, tutto
 *   dentro un unico budget di tempo; lo stato 133 e simili si ritentano una volta.
 * - Canale scelto come sul web: i profili del driver in ordine, poi la prima caratteristica
 *   scrivibile di un servizio di stampa noto.
 * - Scritture serializzate: un pezzo parte solo dopo onCharacteristicWrite del precedente (Android
 *   la chiama anche senza conferma, quando il pezzo e passato al controller), piu la pausa del driver.
 * - Le callback arrivano sui thread binder: ogni attesa e un CompletableDeferred creato prima della
 *   richiesta, e una disconnessione le fa fallire tutte invece di lasciarle appese fino al timeout.
 */
@SuppressLint("MissingPermission")
class BleGattTransport(context: Context) : PrinterTransport {

    private val appContext: Context = context.applicationContext

    /** GATT non accetta richieste sovrapposte: collegamento, scritture e chiusura una alla volta. */
    private val mutex = Mutex()

    @Volatile
    private var link: GattLink? = null

    @Volatile
    private var profiles: List<BleProfile> = emptyList()

    @Volatile
    private var hints: TransportHints = FALLBACK_HINTS

    @Volatile
    private var lastWriteEndedAt: Long = 0L

    /** Vero se dall'ultima chiusura e stato scritto qualcosa: la chiusura deve lasciar svuotare il buffer. */
    @Volatile
    private var unflushed: Boolean = false

    /**
     * Una scrittura senza conferma e stata rifiutata: il resto del lavoro va con conferma, come sul
     * web. Il lavoro sono piu pacchetti (una write() ciascuno), quindi la scelta non puo restare
     * dentro write(); la azzerano configure() (un lavoro nuovo) e connect().
     */
    @Volatile
    private var confirmedFallback: Boolean = false

    /**
     * Collegato e pronto. Se nel frattempo sono cambiati i profili (altro driver), il canale scelto
     * potrebbe non essere piu quello giusto: si risponde "no" e PrinterManager riapre.
     */
    override val isConnected: Boolean
        get() {
            val current = link ?: return false
            return current.ready && !current.broken && current.profiles == profiles
        }

    /** MTU del collegamento aperto (23, il minimo, se non ce n'e uno o la richiesta e fallita). */
    val mtu: Int
        get() = link?.mtu ?: DEFAULT_MTU

    /** Nome del profilo usato per il canale di stampa (log e diagnostica). */
    val channelName: String?
        get() = link?.channelName

    /**
     * Profili GATT del driver (in ordine di preferenza) e parametri di invio; i profili valgono dal
     * prossimo collegamento, i parametri dalla prossima scrittura.
     */
    fun configure(profiles: List<BleProfile>, hints: TransportHints) {
        this.profiles = profiles
        this.hints = hints
        confirmedFallback = false
    }

    override suspend fun connect(address: String, timeoutMs: Long) {
        mutex.withLock {
            link?.shutdown()
            link = null
            unflushed = false
            confirmedFallback = false
            val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter
                ?: throw BluetoothUnavailableException()
            val normalized = address.trim().uppercase(Locale.ROOT)
            try {
                if (!adapter.isEnabled) throw BluetoothDisabledException()
                val device = try {
                    adapter.getRemoteDevice(normalized)
                } catch (e: IllegalArgumentException) {
                    throw PrinterConnectException(normalized, timedOut = false, cause = e)
                }
                link = openWithRetry(device, normalized, timeoutMs)
            } catch (e: SecurityException) {
                throw BluetoothPermissionException(e)
            }
        }
    }

    override suspend fun write(bytes: ByteArray) {
        write(bytes, null)
    }

    /**
     * Scrive [bytes] a pezzi di min(chunkSize, MTU - 3) byte. Un pezzo senza conferma rifiutato si
     * ritenta con conferma e da li in poi, per il resto del lavoro, si resta con conferma, come fa
     * la versione web.
     */
    override suspend fun write(bytes: ByteArray, onProgress: ((Int) -> Unit)?) {
        if (bytes.isEmpty()) return
        mutex.withLock {
            val current = link
            val characteristic = current?.characteristic
            val gatt = current?.gatt
            if (current == null || characteristic == null || gatt == null || !current.ready || current.broken) {
                throw PrinterWriteException(stalled = false, cause = IOException("collegamento BLE non aperto"))
            }
            val h = hints
            var writeType = if (confirmedFallback && supportsWithResponse(characteristic)) {
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            } else {
                chooseWriteType(characteristic, h.withoutResponse)
            }
            val piece = minOf(h.chunkSize, current.mtu - ATT_HEADER_BYTES).coerceAtLeast(1)
            val pause = h.chunkDelayMs.toLong().coerceAtLeast(0L)
            try {
                var offset = 0
                while (offset < bytes.size) {
                    currentCoroutineContext().ensureActive()
                    val n = minOf(piece, bytes.size - offset)
                    val chunk = bytes.copyOfRange(offset, offset + n)
                    var status = writeChunk(current, gatt, characteristic, chunk, writeType)
                    if (status != BluetoothGatt.GATT_SUCCESS &&
                        writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE &&
                        supportsWithResponse(characteristic)
                    ) {
                        Log.w(TAG, "scrittura senza conferma rifiutata (stato $status): ripiego con conferma")
                        writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                        confirmedFallback = true
                        status = writeChunk(current, gatt, characteristic, chunk, writeType)
                    }
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        throw PrinterWriteException(stalled = false, cause = GattFailure("scrittura rifiutata", status))
                    }
                    offset += n
                    lastWriteEndedAt = SystemClock.elapsedRealtime()
                    unflushed = true
                    onProgress?.invoke(n)
                    if (pause > 0L) delay(pause)
                }
            } catch (e: PrinterWriteException) {
                current.broken = true
                throw e
            }
        }
    }

    override suspend fun close() {
        mutex.withLock {
            val current = link
            link = null
            try {
                if (current != null && unflushed && !current.broken) {
                    // Senza conferma il pezzo lascia il telefono dopo la callback: chiudere subito puo
                    // perdere la coda del lavoro (avanzamento carta, comandi finali).
                    val wait = hints.finalDelayMs.toLong() - (SystemClock.elapsedRealtime() - lastWriteEndedAt)
                    if (wait > 0L) delay(wait)
                }
            } finally {
                unflushed = false
                current?.shutdown()
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Collegamento

    private suspend fun openWithRetry(device: BluetoothDevice, address: String, timeoutMs: Long): GattLink {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        var lastError: GattFailure? = null
        for (attempt in 1..MAX_CONNECT_ATTEMPTS) {
            if (attempt > 1) {
                // Lo stack ha bisogno di un attimo per liberare il client dopo uno stato 133.
                delay(RETRY_PAUSE_MS)
            }
            if (deadline - SystemClock.elapsedRealtime() < MIN_ATTEMPT_MS) break
            try {
                return open(device, address, deadline)
            } catch (e: GattTimeout) {
                Log.w(TAG, "$address: nessuna risposta (${e.message})")
                throw PrinterConnectException(address, timedOut = true, cause = lastError ?: e)
            } catch (e: GattFailure) {
                Log.w(TAG, "collegamento GATT a $address fallito (tentativo $attempt)", e)
                lastError = e
            }
        }
        if (lastError == null) throw PrinterConnectException(address, timedOut = true, cause = null)
        throw PrinterConnectException(address, timedOut = false, cause = lastError)
    }

    private suspend fun open(device: BluetoothDevice, address: String, deadline: Long): GattLink {
        val candidate = GattLink(profiles)
        try {
            // Dal thread principale, come vuole la piattaforma su diversi telefoni: le callback
            // arrivano comunque sui thread binder.
            val gatt = withContext(Dispatchers.Main) {
                device.connectGatt(appContext, false, candidate, BluetoothDevice.TRANSPORT_LE)
            } ?: throw GattFailure("connectGatt non ha restituito un client", STATUS_NONE)
            candidate.gatt = gatt
            awaitPhase(candidate.connected, deadline, "collegamento")

            if (!gatt.discoverServices()) throw GattFailure("discoverServices rifiutata", STATUS_NONE)
            val discovery = awaitPhase(candidate.servicesDiscovered, deadline, "scoperta dei servizi")
            if (discovery != BluetoothGatt.GATT_SUCCESS) throw GattFailure("scoperta dei servizi fallita", discovery)

            candidate.mtu = negotiateMtu(candidate, gatt, deadline)
            // Intervallo di connessione corto: i pezzi piccoli escono molto piu in fretta.
            gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)

            val channel = pickChannel(gatt, candidate.profiles)
                ?: throw BleNoChannelException(address, gatt.services.orEmpty().map { it.uuid.toString() })
            candidate.characteristic = channel.first
            candidate.channelName = channel.second
            candidate.ready = true
            Log.i(TAG, "collegata $address via ${channel.second} (MTU ${candidate.mtu})")
            return candidate
        } catch (e: Throwable) {
            // Un client GATT lasciato aperto e la causa tipica dei 133 successivi.
            candidate.shutdown()
            throw e
        }
    }

    /** MTU 247 (pezzi fino a 244 byte); se il telefono o la stampante non rispondono si resta a 23. */
    private suspend fun negotiateMtu(candidate: GattLink, gatt: BluetoothGatt, deadline: Long): Int {
        val pending = CompletableDeferred<Int>()
        candidate.pendingMtu = pending
        try {
            if (!gatt.requestMtu(REQUESTED_MTU)) return DEFAULT_MTU
            val budget = minOf(MTU_TIMEOUT_MS, deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1L)
            val mtu = withTimeoutOrNull(budget) { pending.await() } ?: DEFAULT_MTU
            return mtu.coerceIn(DEFAULT_MTU, MAX_MTU)
        } finally {
            candidate.pendingMtu = null
        }
    }

    /** Attende una fase del collegamento entro la scadenza complessiva. */
    private suspend fun <T : Any> awaitPhase(deferred: CompletableDeferred<T>, deadline: Long, phase: String): T {
        val remaining = deadline - SystemClock.elapsedRealtime()
        if (remaining <= 0L) throw GattTimeout(phase)
        return withTimeoutOrNull(remaining) { deferred.await() } ?: throw GattTimeout(phase)
    }

    /** Profili del driver in ordine, poi i servizi di stampa noti a tutti i driver. */
    private fun pickChannel(gatt: BluetoothGatt, preferred: List<BleProfile>): Pair<BluetoothGattCharacteristic, String>? {
        for (candidates in listOf(preferred, BleCatalog.profiles)) {
            for (profile in candidates) {
                val serviceUuid = BleCatalog.uuid(profile.service) ?: continue
                val service = gatt.getService(serviceUuid) ?: continue
                val expected = BleCatalog.uuid(profile.write)?.let { service.getCharacteristic(it) }
                if (expected != null && isWritable(expected)) return expected to profile.name
                // UUID atteso assente: la prima caratteristica scrivibile dello stesso servizio, come sul web.
                val fallback = service.characteristics.orEmpty().firstOrNull { isWritable(it) }
                if (fallback != null) return fallback to profile.name
            }
        }
        return null
    }

    // ---------------------------------------------------------------------------------------
    // Scritture

    /**
     * Un pezzo: richiesta (ritentata finche lo stack e occupato) e attesa di onCharacteristicWrite.
     * Restituisce lo stato GATT della callback; niente callback entro WRITE_STALL_MS = stallo.
     */
    private suspend fun writeChunk(
        current: GattLink,
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        chunk: ByteArray,
        writeType: Int,
    ): Int {
        val deadline = SystemClock.elapsedRealtime() + PrinterTuning.WRITE_STALL_MS
        while (true) {
            if (current.broken) {
                throw PrinterWriteException(stalled = false, cause = current.failure ?: IOException("collegamento BLE chiuso"))
            }
            val done = CompletableDeferred<Int>()
            current.pendingWrite = done
            // Disconnessione arrivata tra il controllo e l'assegnazione: nessuno completerebbe l'attesa.
            if (current.broken) {
                current.pendingWrite = null
                throw PrinterWriteException(stalled = false, cause = current.failure ?: IOException("collegamento BLE chiuso"))
            }
            // Su API 33+ la piattaforma puo dormire qualche ms dentro writeCharacteristic: mai sul main.
            val submitted = withContext(Dispatchers.IO) { submit(gatt, characteristic, chunk, writeType) }
            if (submitted == SUBMIT_BUSY) {
                current.pendingWrite = null
                if (SystemClock.elapsedRealtime() >= deadline) {
                    throw PrinterWriteException(stalled = true, cause = IOException("stack GATT occupato"))
                }
                delay(BUSY_RETRY_MS)
                continue
            }
            if (submitted != SUBMIT_OK) {
                current.pendingWrite = null
                throw PrinterWriteException(stalled = false, cause = GattFailure("scrittura non accettata", submitted))
            }
            val remaining = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1L)
            val status = try {
                withTimeoutOrNull(remaining) { done.await() }
            } catch (e: IOException) {
                // Collegamento caduto o chiuso durante l'attesa (GattFailure o chiusura locale).
                throw PrinterWriteException(stalled = false, cause = e)
            } finally {
                current.pendingWrite = null
            }
            return status ?: throw PrinterWriteException(
                stalled = true,
                cause = IOException("nessuna conferma di scrittura entro ${PrinterTuning.WRITE_STALL_MS} ms"),
            )
        }
    }

    /** SUBMIT_OK, SUBMIT_BUSY (da ritentare) oppure il codice d'errore della piattaforma. */
    private fun submit(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, chunk: ByteArray, writeType: Int): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return when (val code = gatt.writeCharacteristic(characteristic, chunk, writeType)) {
                BluetoothStatusCodes.SUCCESS -> SUBMIT_OK
                BluetoothStatusCodes.ERROR_GATT_WRITE_REQUEST_BUSY -> SUBMIT_BUSY
                else -> code
            }
        }
        return submitLegacy(gatt, characteristic, chunk, writeType)
    }

    /** Fino ad Android 12: valore sulla caratteristica, poi la richiesta; false = occupato o chiuso. */
    @Suppress("DEPRECATION")
    private fun submitLegacy(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, chunk: ByteArray, writeType: Int): Int {
        characteristic.writeType = writeType
        if (!characteristic.setValue(chunk)) return STATUS_NONE
        // Un rifiuto qui e quasi sempre "operazione precedente ancora in corso": si ritenta; se invece
        // il collegamento e caduto, la callback di disconnessione lo segnala e il ciclo si ferma.
        return if (gatt.writeCharacteristic(characteristic)) SUBMIT_OK else SUBMIT_BUSY
    }

    private fun chooseWriteType(characteristic: BluetoothGattCharacteristic, withoutResponse: Boolean): Int {
        val noResponse = supportsNoResponse(characteristic)
        val withResponse = supportsWithResponse(characteristic)
        return when {
            withoutResponse && noResponse -> BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            withResponse -> BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            else -> BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        }
    }

    private fun isWritable(characteristic: BluetoothGattCharacteristic): Boolean =
        supportsNoResponse(characteristic) || supportsWithResponse(characteristic)

    private fun supportsNoResponse(characteristic: BluetoothGattCharacteristic): Boolean =
        (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0

    private fun supportsWithResponse(characteristic: BluetoothGattCharacteristic): Boolean =
        (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0

    // ---------------------------------------------------------------------------------------
    // Un collegamento GATT con le sue attese

    /**
     * Callback e stato di un singolo client GATT: ogni collegamento ne ha uno nuovo, cosi le
     * callback tardive di un client vecchio non toccano quello attuale.
     */
    private class GattLink(val profiles: List<BleProfile>) : BluetoothGattCallback() {

        @Volatile
        var gatt: BluetoothGatt? = null

        val connected = CompletableDeferred<Unit>()
        val servicesDiscovered = CompletableDeferred<Int>()

        @Volatile
        var pendingMtu: CompletableDeferred<Int>? = null

        @Volatile
        var pendingWrite: CompletableDeferred<Int>? = null

        @Volatile
        var characteristic: BluetoothGattCharacteristic? = null

        @Volatile
        var channelName: String? = null

        @Volatile
        var mtu: Int = DEFAULT_MTU

        @Volatile
        var ready: Boolean = false

        @Volatile
        var broken: Boolean = false

        @Volatile
        var failure: IOException? = null

        private val closed = AtomicBoolean(false)

        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when {
                newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS ->
                    connected.complete(Unit)
                newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS ->
                    fail(GattFailure("collegamento GATT chiuso (stato $status)", status))
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            servicesDiscovered.complete(status)
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            pendingMtu?.complete(if (status == BluetoothGatt.GATT_SUCCESS) mtu else DEFAULT_MTU)
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val expected = this.characteristic
            if (expected == null || expected.uuid == characteristic.uuid) pendingWrite?.complete(status)
        }

        /** Disconnessione o errore: ogni attesa in corso fallisce subito. */
        fun fail(error: IOException) {
            if (failure == null) failure = error
            broken = true
            connected.completeExceptionally(error)
            servicesDiscovered.completeExceptionally(error)
            pendingMtu?.completeExceptionally(error)
            pendingWrite?.completeExceptionally(error)
        }

        /** Chiude il client una volta sola; le eccezioni di chiusura non servono a nessuno. */
        fun shutdown() {
            if (!closed.compareAndSet(false, true)) return
            ready = false
            fail(IOException("collegamento BLE chiuso"))
            val client = gatt ?: return
            gatt = null
            try {
                client.disconnect()
            } catch (_: Exception) {
            }
            try {
                client.close()
            } catch (_: Exception) {
            }
        }
    }

    /** Errore GATT con il suo codice di stato (133 e compagni), da ritentare in collegamento. */
    private class GattFailure(message: String, val status: Int) : IOException("$message (stato $status)")

    /** Una fase del collegamento non si e conclusa entro il budget. */
    private class GattTimeout(phase: String) : IOException("timeout: $phase")

    private companion object {
        const val TAG = "FotoFlashBle"
        const val DEFAULT_MTU = 23
        const val REQUESTED_MTU = 247
        const val MAX_MTU = 517
        const val ATT_HEADER_BYTES = 3
        const val MTU_TIMEOUT_MS = 3_000L
        const val MAX_CONNECT_ATTEMPTS = 2
        const val RETRY_PAUSE_MS = 400L
        const val MIN_ATTEMPT_MS = 2_000L
        const val BUSY_RETRY_MS = 10L

        const val SUBMIT_OK = 0
        const val SUBMIT_BUSY = -1

        /** Nessun codice di stato disponibile (richiesta rifiutata prima di partire). */
        const val STATUS_NONE = -2

        /** Usati solo se nessuno chiama configure(): i valori sicuri di DRIVERS.md. */
        val FALLBACK_HINTS = TransportHints(chunkSize = 20, chunkDelayMs = 15, withoutResponse = true)
    }
}
