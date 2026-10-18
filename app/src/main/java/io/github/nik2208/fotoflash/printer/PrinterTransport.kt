package io.github.nik2208.fotoflash.printer

import java.io.IOException

/**
 * Canale di byte verso la stampante. Due implementazioni: BtSppTransport (Bluetooth classico SPP)
 * e BleGattTransport (Bluetooth Low Energy, GATT); PrinterManager sceglie quella del collegamento
 * della stampante e resta indipendente dal mezzo.
 */
interface PrinterTransport {
    val isConnected: Boolean

    /** Apre la connessione; lancia una [PrinterTransportException] con la causa vera. */
    suspend fun connect(address: String, timeoutMs: Long)

    /** Scrive tutti i byte o lancia [PrinterWriteException]: un errore non viene mai taciuto. */
    suspend fun write(bytes: ByteArray)

    /**
     * Come [write], e in piu [onProgress] riceve i byte di ogni pezzo appena accettato: serve alla
     * barra di avanzamento e a decidere se un lavoro fallito si puo ritentare. Aggiunta compatibile:
     * chi non scrive a pezzi la riceve gia fatta.
     */
    suspend fun write(bytes: ByteArray, onProgress: ((Int) -> Unit)?) {
        write(bytes)
        onProgress?.invoke(bytes.size)
    }

    suspend fun close()
}

/**
 * Errori tipizzati del trasporto: PrinterManager li traduce in PrintFailure guardando il tipo,
 * mai il testo del messaggio (nel bridge il confronto sul testo faceva dimenticare la stampante).
 */
sealed class PrinterTransportException(message: String, cause: Throwable? = null) : IOException(message, cause)

/** Il telefono non ha Bluetooth. */
class BluetoothUnavailableException : PrinterTransportException("Bluetooth non disponibile su questo dispositivo")

/** Bluetooth spento. */
class BluetoothDisabledException : PrinterTransportException("Bluetooth spento")

/** Manca il permesso runtime (BLUETOOTH_CONNECT su Android 12+). */
class BluetoothPermissionException(cause: Throwable?) :
    PrinterTransportException("permesso Bluetooth mancante", cause)

/** L'indirizzo indicato non risulta piu accoppiato con il telefono. */
class PrinterNotBondedException(val address: String) :
    PrinterTransportException("$address non e accoppiata")

/**
 * Connessione fallita. [timedOut] e vero solo se la stampante non ha risposto entro il tempo
 * concesso: un rifiuto immediato porta la sua causa in [cause] e non va spacciato per timeout.
 */
class PrinterConnectException(val address: String, val timedOut: Boolean, cause: Throwable?) :
    PrinterTransportException(
        if (timedOut) {
            "$address non risponde (timeout)"
        } else {
            "connessione a $address fallita: ${cause?.message ?: cause?.javaClass?.simpleName ?: "causa sconosciuta"}"
        },
        cause,
    )

/**
 * BLE: collegati, ma la stampante non espone nessun canale di scrittura conosciuto (nessun profilo
 * del driver e nessuna caratteristica scrivibile in un servizio di stampa noto). [services] elenca
 * gli UUID trovati, per il log.
 */
class BleNoChannelException(val address: String, val services: List<String>) :
    PrinterTransportException(
        "$address non espone un canale di stampa noto (servizi: ${services.joinToString().ifEmpty { "nessuno" }})",
    )

/**
 * Scrittura fallita. [stalled] e vero quando la stampante ha smesso di accettare dati
 * (buffer pieno senza controllo di flusso: carta finita, coperchio aperto, testina in blocco).
 */
class PrinterWriteException(val stalled: Boolean, cause: Throwable?) :
    PrinterTransportException(
        if (stalled) {
            "la stampante non accetta piu dati"
        } else {
            "scrittura fallita: ${cause?.message ?: cause?.javaClass?.simpleName ?: "connessione chiusa"}"
        },
        cause,
    )
