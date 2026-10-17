package io.github.nik2208.fotoflash.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.SystemClock
import android.util.Log
import java.io.IOException
import java.io.OutputStream
import java.lang.reflect.InvocationTargetException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Trasporto Bluetooth classico SPP (RFCOMM) verso stampanti ESC/POS gia accoppiate.
 *
 * Rispetto al bridge da cui deriva: le eccezioni di connect e write risalgono con la causa vera,
 * il timeout e reale (si chiude il socket per sbloccare la chiamata nativa), ci sono i ripieghi
 * per i cloni economici e le scritture sono a blocchi con pausa, perche quelle stampanti non
 * hanno controllo di flusso.
 */
class BtSppTransport(context: Context) : PrinterTransport {

    private val appContext: Context = context.applicationContext

    @Volatile
    private var socket: BluetoothSocket? = null

    @Volatile
    private var output: OutputStream? = null

    /** Messo a true dopo un errore di scrittura: il socket puo sembrare connesso ma e morto. */
    @Volatile
    private var broken: Boolean = false

    @Volatile
    var chunkSize: Int = PrinterTuning.CHUNK_SIZE_DEFAULT
        private set

    @Volatile
    var chunkDelayMs: Long = PrinterTuning.CHUNK_DELAY_DEFAULT.toLong()
        private set

    /** Metodo di apertura che ha funzionato l'ultima volta per ciascun indirizzo: si riprova per primo. */
    private val preferredMethod = ConcurrentHashMap<String, ConnectMethod>()

    override val isConnected: Boolean
        get() {
            val s = socket ?: return false
            return !broken && output != null && s.isConnected
        }

    /** Dimensione dei blocchi e pausa tra blocchi; valgono dalla prossima scrittura. */
    fun configure(chunkSize: Int, chunkDelayMs: Int) {
        this.chunkSize = PrinterTuning.clampChunkSize(chunkSize)
        this.chunkDelayMs = PrinterTuning.clampChunkDelay(chunkDelayMs).toLong()
    }

    @SuppressLint("MissingPermission")
    override suspend fun connect(address: String, timeoutMs: Long) {
        withContext(Dispatchers.IO) {
            closeNow()
            val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter
                ?: throw BluetoothUnavailableException()
            val normalized = address.trim().uppercase(Locale.ROOT)
            try {
                if (!adapter.isEnabled) throw BluetoothDisabledException()
                // Un indirizzo malformato non e "non accoppiata": e un errore di connessione.
                val device = try {
                    adapter.getRemoteDevice(normalized)
                } catch (e: IllegalArgumentException) {
                    throw PrinterConnectException(normalized, timedOut = false, cause = e)
                }
                if (device.bondState != BluetoothDevice.BOND_BONDED) throw PrinterNotBondedException(normalized)
                cancelDiscoveryQuietly(adapter)
                openWithFallbacks(device, normalized, timeoutMs)
            } catch (e: SecurityException) {
                throw BluetoothPermissionException(e)
            }
        }
    }

    override suspend fun write(bytes: ByteArray) {
        write(bytes, null)
    }

    /**
     * Scrive [bytes] a blocchi di [chunkSize] con [chunkDelayMs] di pausa dopo ogni blocco.
     * [onProgress] riceve i byte di ogni blocco appena scritto. Un blocco fermo oltre
     * PrinterTuning.WRITE_STALL_MS fa chiudere il socket (unico modo di sbloccare write()).
     */
    suspend fun write(bytes: ByteArray, onProgress: ((Int) -> Unit)?) {
        if (bytes.isEmpty()) return
        withContext(Dispatchers.IO) {
            val s = socket
            val out = output
            if (s == null || out == null || broken) {
                throw PrinterWriteException(stalled = false, cause = IOException("socket non connesso"))
            }
            val size = chunkSize
            val pause = chunkDelayMs
            val lastProgress = AtomicLong(SystemClock.elapsedRealtime())
            val stalled = AtomicBoolean(false)
            coroutineScope {
                val watchdog = launch {
                    while (isActive) {
                        delay(STALL_CHECK_MS)
                        if (SystemClock.elapsedRealtime() - lastProgress.get() > PrinterTuning.WRITE_STALL_MS) {
                            stalled.set(true)
                            closeQuietly(s)
                            break
                        }
                    }
                }
                try {
                    var offset = 0
                    while (offset < bytes.size) {
                        ensureActive()
                        val n = minOf(size, bytes.size - offset)
                        out.write(bytes, offset, n)
                        out.flush()
                        offset += n
                        lastProgress.set(SystemClock.elapsedRealtime())
                        onProgress?.invoke(n)
                        if (pause > 0L) {
                            delay(pause)
                            // la pausa non e uno stallo della stampante
                            lastProgress.set(SystemClock.elapsedRealtime())
                        }
                    }
                } catch (e: IOException) {
                    broken = true
                    throw PrinterWriteException(stalled = stalled.get(), cause = e)
                } finally {
                    watchdog.cancel()
                }
            }
        }
    }

    override suspend fun close() {
        withContext(Dispatchers.IO) { closeNow() }
    }

    private fun closeNow() {
        val s = socket
        socket = null
        output = null
        broken = false
        closeQuietly(s)
    }

    /**
     * Prova i metodi di apertura in ordine (prima quello che ha funzionato l'ultima volta) dentro
     * un unico budget di tempo. Ogni tentativo usa un socket nuovo: uno fallito non e riutilizzabile.
     */
    private suspend fun openWithFallbacks(device: BluetoothDevice, address: String, timeoutMs: Long) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        val methods = orderedMethods(address)
        var firstError: Throwable? = null
        for ((index, method) in methods.withIndex()) {
            if (index > 0) {
                // Lo stack RFCOMM ha bisogno di un attimo per liberare il canale dopo un fallimento.
                delay(RETRY_PAUSE_MS)
            }
            val remaining = deadline - SystemClock.elapsedRealtime()
            if (remaining < MIN_ATTEMPT_MS) break
            val candidate = try {
                createSocket(device, method)
            } catch (e: SecurityException) {
                throw e
            } catch (e: IOException) {
                Log.w(TAG, "creazione socket $method fallita", e)
                if (firstError == null) firstError = e
                continue
            } catch (e: ReflectiveOperationException) {
                Log.w(TAG, "metodo $method non disponibile", e)
                if (firstError == null) firstError = e
                continue
            }
            try {
                connectWithDeadline(candidate, remaining)
            } catch (e: ConnectTimeoutException) {
                closeQuietly(candidate)
                Log.w(TAG, "connessione $method: nessuna risposta entro ${remaining} ms")
                // Tempo finito: la stampante non risponde, inutile provare altri metodi.
                throw PrinterConnectException(address, timedOut = true, cause = firstError ?: e)
            } catch (e: IOException) {
                closeQuietly(candidate)
                Log.w(TAG, "connessione $method fallita", e)
                if (firstError == null) firstError = e
                continue
            } catch (e: Throwable) {
                closeQuietly(candidate)
                throw e
            }
            socket = candidate
            output = try {
                candidate.outputStream
            } catch (e: IOException) {
                closeNow()
                throw PrinterConnectException(address, timedOut = false, cause = e)
            }
            broken = false
            preferredMethod[address] = method
            Log.i(TAG, "connesso a $address con $method")
            return
        }
        throw PrinterConnectException(address, timedOut = false, cause = firstError)
    }

    private fun orderedMethods(address: String): List<ConnectMethod> {
        val all = ConnectMethod.entries
        val preferred = preferredMethod[address] ?: return all
        return listOf(preferred) + all.filter { it != preferred }
    }

    @SuppressLint("MissingPermission")
    private fun createSocket(device: BluetoothDevice, method: ConnectMethod): BluetoothSocket = when (method) {
        ConnectMethod.INSECURE -> device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
        ConnectMethod.SECURE -> device.createRfcommSocketToServiceRecord(SPP_UUID)
        ConnectMethod.CHANNEL_1 -> {
            // Ripiego classico per i cloni senza record SDP corretto: canale RFCOMM 1 diretto.
            // E un'API nascosta, quindi reflection; se il sistema la blocca si salta il tentativo.
            val factory = BluetoothDevice::class.java.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
            try {
                factory.invoke(device, 1) as? BluetoothSocket
                    ?: throw IOException("createRfcommSocket non ha restituito un socket")
            } catch (e: InvocationTargetException) {
                when (val cause = e.targetException) {
                    is SecurityException -> throw cause
                    is IOException -> throw cause
                    else -> throw e
                }
            }
        }
    }

    /**
     * connect() bloccante con timeout vero: allo scadere (o se il chiamante rinuncia) si chiude il
     * socket, l'unico modo per far tornare la chiamata nativa. Un errore arrivato prima della
     * scadenza risale cosi com'e, senza diventare un "timeout".
     */
    private suspend fun connectWithDeadline(candidate: BluetoothSocket, timeoutMs: Long) {
        coroutineScope {
            val finished = AtomicBoolean(false)
            val timedOut = AtomicBoolean(false)
            val watchdog = launch {
                try {
                    delay(timeoutMs)
                    timedOut.set(true)
                } finally {
                    if (!finished.get()) closeQuietly(candidate)
                }
            }
            try {
                candidate.connect()
            } catch (e: IOException) {
                ensureActive()
                if (timedOut.get()) throw ConnectTimeoutException(e)
                throw e
            } finally {
                finished.set(true)
                watchdog.cancel()
            }
            if (timedOut.get()) throw ConnectTimeoutException(null)
        }
    }

    @SuppressLint("MissingPermission")
    private fun cancelDiscoveryQuietly(adapter: BluetoothAdapter) {
        // Una scansione in corso rallenta o fa fallire la connessione. Su Android 12+ serve
        // BLUETOOTH_SCAN, che non chiediamo: in quel caso si rinuncia senza danni.
        try {
            adapter.cancelDiscovery()
        } catch (_: SecurityException) {
        }
    }

    private fun closeQuietly(target: BluetoothSocket?) {
        if (target == null) return
        try {
            target.close()
        } catch (_: Exception) {
            // alcuni stack lanciano anche eccezioni non IO in chiusura: il socket e comunque perso
        }
    }

    /** Ordine di default dei tentativi di apertura. */
    private enum class ConnectMethod { INSECURE, SECURE, CHANNEL_1 }

    private class ConnectTimeoutException(cause: Throwable?) : IOException("timeout di connessione", cause)

    private companion object {
        const val TAG = "FotoFlashBt"
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        const val RETRY_PAUSE_MS = 300L
        const val MIN_ATTEMPT_MS = 800L
        const val STALL_CHECK_MS = 500L
    }
}
