package io.github.nik2208.fotoflash.camera

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.util.Log
import android.widget.Toast
import androidx.annotation.MainThread
import androidx.annotation.StringRes
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.print.Exporter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Salvataggio automatico in galleria degli scatti della fotocamera (impostazione Scatto ›
 * «salva ogni scatto anche in galleria»): l'originale a colori finisce in
 * Pictures/FotoFlash/Scatti, cosi il ricordo resta anche se la carta termica sbiadisce o lo
 * storico viene svuotato. Le foto importate dalla galleria non passano di qui: ci sono gia.
 *
 * Il lavoro gira nello [scope] dell'app, una foto alla volta: lo scatto non aspetta, e una
 * foto gia scattata viene salvata anche se nel frattempo si esce dal mirino.
 *
 * Gli avvisi sono Toast: quando il salvataggio finisce l'utente e spesso gia nell'editor, dove
 * un avviso del mirino non arriverebbe. Uno per processo: il primo salvataggio riuscito (per
 * dire dove sono le foto) e il primo fallito; gli altri fallimenti finiscono solo nel log.
 */
internal class CaptureAutoSave(
    private val appContext: Context,
    private val exporter: Exporter,
    private val scope: CoroutineScope,
) {
    /** Una foto alla volta: quattro JPEG da 2048 px in parallelo peserebbero sulla memoria per niente. */
    private val queue = Mutex()

    private val prefs: SharedPreferences by lazy {
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val successAnnounced = AtomicBoolean(false)
    private val failureAnnounced = AtomicBoolean(false)

    /**
     * Android 8-9: true se bisogna ancora chiedere WRITE_EXTERNAL_STORAGE. Si chiede una volta
     * sola per installazione ([markLegacyPermissionAsked]): chi rifiuta riceve un avviso e non
     * viene piu disturbato (puo sempre concederlo dalle impostazioni dell'app, o spegnere il
     * salvataggio automatico). Da Android 10 e sempre false.
     */
    suspend fun needsLegacyPermissionRequest(): Boolean = withContext(Dispatchers.IO) {
        exporter.needsLegacyWritePermission() && !prefs.getBoolean(KEY_LEGACY_ASKED, false)
    }

    /** Il dialogo del permesso sta per aprirsi: non lo si riproporra piu. */
    @MainThread
    fun markLegacyPermissionAsked() {
        // Le preferenze sono gia caricate da needsLegacyPermissionRequest; apply scrive in background.
        prefs.edit().putBoolean(KEY_LEGACY_ASKED, true).apply()
    }

    /** Esito della richiesta del permesso: un rifiuto si spiega una volta, poi si rispetta. */
    @MainThread
    fun onLegacyPermissionResult(granted: Boolean) {
        if (!granted) Toast.makeText(appContext, R.string.cam_autosave_denied, Toast.LENGTH_LONG).show()
    }

    /**
     * Accoda il salvataggio di [photo] e torna subito. [onDone] riceve l'esito su un thread in
     * background. La bitmap non viene mai riciclata ne modificata: appartiene alla sessione.
     */
    fun save(photo: Bitmap, displayName: String, onDone: (saved: Boolean) -> Unit = {}) {
        // Android 8-9 senza permesso: la richiesta e gia stata fatta e rifiutata (con avviso),
        // quindi niente tentativi a vuoto a ogni scatto.
        if (exporter.needsLegacyWritePermission()) return
        scope.launch {
            val uri = try {
                queue.withLock { exporter.savePhotoToGallery(photo, displayName) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "salvataggio in galleria di $displayName fallito", e)
                null
            } catch (e: OutOfMemoryError) {
                Log.w(TAG, "memoria esaurita salvando $displayName in galleria", e)
                null
            }
            val saved = uri != null
            if (!saved) Log.w(TAG, "scatto non salvato in galleria: $displayName")
            onDone(saved)
            if (saved) {
                if (successAnnounced.compareAndSet(false, true)) toast(R.string.cam_autosave_done)
            } else {
                if (failureAnnounced.compareAndSet(false, true)) toast(R.string.cam_autosave_failed)
            }
        }
    }

    private suspend fun toast(@StringRes message: Int) {
        withContext(Dispatchers.Main) { Toast.makeText(appContext, message, Toast.LENGTH_LONG).show() }
    }

    companion object {
        private const val TAG = "FotoFlashAutoSave"
        private const val PREFS_NAME = "camera"
        private const val KEY_LEGACY_ASKED = "legacy_storage_permission_asked"

        /**
         * Nome del file in galleria: "FotoFlash_20261017_153012345", con "_2" ecc. per gli
         * scatti di una striscia (stesso orario d'inizio, cosi restano vicini e in ordine).
         * I millisecondi evitano doppioni con la stampa istantanea a raffica.
         */
        fun photoName(takenAtMillis: Long, shot: Int? = null): String {
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmssSSS", Locale.US).format(Date(takenAtMillis))
            return if (shot == null) "FotoFlash_$stamp" else "FotoFlash_${stamp}_$shot"
        }
    }
}
