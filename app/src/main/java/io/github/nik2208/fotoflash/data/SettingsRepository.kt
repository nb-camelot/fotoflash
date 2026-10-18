package io.github.nik2208.fotoflash.data

import android.content.Context
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.thermal.ToneAdjustments
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Unico DataStore "settings" del processo: DataStore vieta due istanze sullo stesso file,
 * quindi il delegato vive qui ed e privato.
 *
 * Con un file corrotto, senza handler, ogni edit fallirebbe per sempre (onboarding a ogni avvio,
 * stampante mai salvata): meglio ripartire dai default.
 */
private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "settings",
    corruptionHandler = ReplaceFileCorruptionHandler { e ->
        Log.w("SettingsRepository", "File delle impostazioni corrotto, riparto dai default", e)
        emptyPreferences()
    },
)

/** Preferenze persistenti dell'app. Unico punto che legge e scrive AppSettings. */
class SettingsRepository(context: Context) {

    private val dataStore: DataStore<Preferences> = context.applicationContext.settingsDataStore

    /** Se il file e illeggibile emettiamo i default invece di far cadere chi osserva. */
    val settings: Flow<AppSettings> = dataStore.data
        .catch { e ->
            if (e is IOException) {
                Log.w(TAG, "Impostazioni illeggibili, uso i default", e)
                emit(emptyPreferences())
            } else {
                throw e
            }
        }
        .map { prefs -> prefs.toAppSettings() }
        .distinctUntilChanged()

    suspend fun current(): AppSettings = settings.first()

    /** Legge lo stato dentro la stessa transazione: due update concorrenti non si pestano i piedi. */
    suspend fun update(transform: (AppSettings) -> AppSettings) {
        try {
            dataStore.edit { prefs ->
                val next = transform(prefs.toAppSettings())
                prefs.write(next)
            }
        } catch (e: IOException) {
            Log.e(TAG, "Salvataggio delle impostazioni fallito", e)
        }
    }

    /** Incrementa il contatore e restituisce il nuovo valore, in un'unica transazione. */
    suspend fun nextPrintNumber(): Int {
        return try {
            val prefs = dataStore.edit { p ->
                val next = (p[K_PRINT_COUNTER] ?: 0).coerceAtLeast(0) + 1
                p[K_PRINT_COUNTER] = next
            }
            prefs[K_PRINT_COUNTER] ?: 1
        } catch (e: IOException) {
            // Meglio un numero ripetuto che una stampa bloccata.
            Log.e(TAG, "Contatore stampe non aggiornato", e)
            current().printCounter + 1
        }
    }

    private fun Preferences.toAppSettings(): AppSettings {
        val d = DEFAULTS
        val dt = d.tone
        return AppSettings(
            onboardingDone = this[K_ONBOARDING_DONE] ?: d.onboardingDone,
            printerAddress = this[K_PRINTER_ADDRESS]?.takeIf { it.isNotBlank() },
            printerName = this[K_PRINTER_NAME]?.takeIf { it.isNotBlank() },
            // Per nome: comprende M02PRO; un nome sconosciuto torna a MM58.
            paper = enumOrDefault(this[K_PAPER], d.paper),
            // L'id resta una stringa: un driver sconosciuto lo risolve PrinterDrivers.byId (ripiego su escpos-58).
            printerDriver = this[K_PRINTER_DRIVER]?.trim()?.takeIf { it.isNotEmpty() } ?: d.printerDriver,
            printerLink = enumOrDefault(this[K_PRINTER_LINK], d.printerLink),
            // I campi BLE nulli vogliono dire "predefiniti del driver": la chiave assente resta null.
            bleChunkSize = this[K_BLE_CHUNK_SIZE]?.coerceIn(1, 65_536),
            bleChunkDelayMs = this[K_BLE_CHUNK_DELAY_MS]?.coerceIn(0, 10_000),
            bleWithoutResponse = this[K_BLE_WITHOUT_RESPONSE],
            phomemoDensity = this[K_PHOMEMO_DENSITY]?.coerceIn(1, 15),
            // Solo le due larghezze che il protocollo conosce (72 = 576 punti, 78 = 624 punti).
            phomemoWidthBytes = this[K_PHOMEMO_WIDTH_BYTES]?.takeIf { it in PHOMEMO_WIDTHS } ?: d.phomemoWidthBytes,
            // Va in un byte del comando.
            printerSpeed = this[K_PRINTER_SPEED]?.coerceIn(0, 255),
            feedLines = (this[K_FEED_LINES] ?: d.feedLines).coerceIn(0, 255),
            cutPaper = this[K_CUT_PAPER] ?: d.cutPaper,
            heatLevel = (this[K_HEAT_LEVEL] ?: d.heatLevel).coerceIn(0, 4),
            chunkSize = (this[K_CHUNK_SIZE] ?: d.chunkSize).coerceIn(1, 65_536),
            chunkDelayMs = (this[K_CHUNK_DELAY_MS] ?: d.chunkDelayMs).coerceIn(0, 10_000),
            bandHeight = (this[K_BAND_HEIGHT] ?: d.bandHeight).coerceIn(1, 1_024),
            dither = enumOrDefault(this[K_DITHER], d.dither),
            tone = ToneAdjustments(
                brightness = finiteOr(this[K_TONE_BRIGHTNESS], dt.brightness).coerceIn(-1f, 1f),
                contrast = finiteOr(this[K_TONE_CONTRAST], dt.contrast).coerceIn(-1f, 1f),
                gamma = finiteOr(this[K_TONE_GAMMA], dt.gamma).coerceIn(0.4f, 2.5f),
                autoLevels = this[K_TONE_AUTO_LEVELS] ?: dt.autoLevels,
                sharpen = finiteOr(this[K_TONE_SHARPEN], dt.sharpen).coerceIn(0f, 1f),
                shadows = finiteOr(this[K_TONE_SHADOWS], dt.shadows).coerceIn(0f, 1f),
                localContrast = finiteOr(this[K_TONE_LOCAL_CONTRAST], dt.localContrast).coerceIn(0f, 1f),
                autoBacklight = this[K_TONE_AUTO_BACKLIGHT] ?: dt.autoBacklight,
            ),
            template = enumOrDefault(this[K_TEMPLATE], d.template),
            eventTitle = this[K_EVENT_TITLE] ?: d.eventTitle,
            hashtag = this[K_HASHTAG] ?: d.hashtag,
            showDate = this[K_SHOW_DATE] ?: d.showDate,
            showPrintNumber = this[K_SHOW_PRINT_NUMBER] ?: d.showPrintNumber,
            printCounter = (this[K_PRINT_COUNTER] ?: d.printCounter).coerceAtLeast(0),
            instantPrint = this[K_INSTANT_PRINT] ?: d.instantPrint,
            timerSeconds = (this[K_TIMER_SECONDS] ?: d.timerSeconds).coerceIn(0, 60),
            stripShots = (this[K_STRIP_SHOTS] ?: d.stripShots).coerceIn(2, 4),
            shutterSound = this[K_SHUTTER_SOUND] ?: d.shutterSound,
            livePreview = this[K_LIVE_PREVIEW] ?: d.livePreview,
            autoSaveCaptures = this[K_AUTO_SAVE_CAPTURES] ?: d.autoSaveCaptures,
            copies = (this[K_COPIES] ?: d.copies).coerceIn(1, 5),
        )
    }

    /** Scrive tutti i campi: cosi un AppSettings salvato e sempre completo. */
    private fun MutablePreferences.write(s: AppSettings) {
        this[K_ONBOARDING_DONE] = s.onboardingDone
        putOrRemove(K_PRINTER_ADDRESS, s.printerAddress)
        putOrRemove(K_PRINTER_NAME, s.printerName)
        this[K_PAPER] = s.paper.name
        this[K_PRINTER_DRIVER] = s.printerDriver.trim().ifEmpty { DEFAULTS.printerDriver }
        this[K_PRINTER_LINK] = s.printerLink.name
        putOrRemoveValue(K_BLE_CHUNK_SIZE, s.bleChunkSize)
        putOrRemoveValue(K_BLE_CHUNK_DELAY_MS, s.bleChunkDelayMs)
        putOrRemoveValue(K_BLE_WITHOUT_RESPONSE, s.bleWithoutResponse)
        putOrRemoveValue(K_PHOMEMO_DENSITY, s.phomemoDensity)
        this[K_PHOMEMO_WIDTH_BYTES] = s.phomemoWidthBytes
        putOrRemoveValue(K_PRINTER_SPEED, s.printerSpeed)
        this[K_FEED_LINES] = s.feedLines
        this[K_CUT_PAPER] = s.cutPaper
        this[K_HEAT_LEVEL] = s.heatLevel
        this[K_CHUNK_SIZE] = s.chunkSize
        this[K_CHUNK_DELAY_MS] = s.chunkDelayMs
        this[K_BAND_HEIGHT] = s.bandHeight
        this[K_DITHER] = s.dither.name
        this[K_TONE_BRIGHTNESS] = s.tone.brightness
        this[K_TONE_CONTRAST] = s.tone.contrast
        this[K_TONE_GAMMA] = s.tone.gamma
        this[K_TONE_AUTO_LEVELS] = s.tone.autoLevels
        this[K_TONE_SHARPEN] = s.tone.sharpen
        this[K_TONE_SHADOWS] = s.tone.shadows
        this[K_TONE_LOCAL_CONTRAST] = s.tone.localContrast
        this[K_TONE_AUTO_BACKLIGHT] = s.tone.autoBacklight
        this[K_TEMPLATE] = s.template.name
        this[K_EVENT_TITLE] = s.eventTitle
        this[K_HASHTAG] = s.hashtag
        this[K_SHOW_DATE] = s.showDate
        this[K_SHOW_PRINT_NUMBER] = s.showPrintNumber
        this[K_PRINT_COUNTER] = s.printCounter
        this[K_INSTANT_PRINT] = s.instantPrint
        this[K_TIMER_SECONDS] = s.timerSeconds
        this[K_STRIP_SHOTS] = s.stripShots
        this[K_SHUTTER_SOUND] = s.shutterSound
        this[K_LIVE_PREVIEW] = s.livePreview
        this[K_AUTO_SAVE_CAPTURES] = s.autoSaveCaptures
        this[K_COPIES] = s.copies
    }

    private fun MutablePreferences.putOrRemove(key: Preferences.Key<String>, value: String?) {
        if (value.isNullOrBlank()) remove(key) else this[key] = value
    }

    /** null toglie la chiave: alla lettura torna null, cioe "usa il predefinito". */
    private fun <T : Any> MutablePreferences.putOrRemoveValue(key: Preferences.Key<T>, value: T?) {
        if (value == null) remove(key) else this[key] = value
    }

    private companion object {
        const val TAG = "SettingsRepository"
        val DEFAULTS = AppSettings()

        val K_ONBOARDING_DONE = booleanPreferencesKey("onboarding_done")
        val K_PRINTER_ADDRESS = stringPreferencesKey("printer_address")
        val K_PRINTER_NAME = stringPreferencesKey("printer_name")
        val K_PAPER = stringPreferencesKey("paper")
        val K_PRINTER_DRIVER = stringPreferencesKey("printer_driver")
        val K_PRINTER_LINK = stringPreferencesKey("printer_link")
        val K_BLE_CHUNK_SIZE = intPreferencesKey("ble_chunk_size")
        val K_BLE_CHUNK_DELAY_MS = intPreferencesKey("ble_chunk_delay_ms")
        val K_BLE_WITHOUT_RESPONSE = booleanPreferencesKey("ble_without_response")
        val K_PHOMEMO_DENSITY = intPreferencesKey("phomemo_density")
        val K_PHOMEMO_WIDTH_BYTES = intPreferencesKey("phomemo_width_bytes")
        val K_PRINTER_SPEED = intPreferencesKey("printer_speed")
        val PHOMEMO_WIDTHS = setOf(72, 78)
        val K_FEED_LINES = intPreferencesKey("feed_lines")
        val K_CUT_PAPER = booleanPreferencesKey("cut_paper")
        val K_HEAT_LEVEL = intPreferencesKey("heat_level")
        val K_CHUNK_SIZE = intPreferencesKey("chunk_size")
        val K_CHUNK_DELAY_MS = intPreferencesKey("chunk_delay_ms")
        val K_BAND_HEIGHT = intPreferencesKey("band_height")
        val K_DITHER = stringPreferencesKey("dither")
        val K_TONE_BRIGHTNESS = floatPreferencesKey("tone_brightness")
        val K_TONE_CONTRAST = floatPreferencesKey("tone_contrast")
        val K_TONE_GAMMA = floatPreferencesKey("tone_gamma")
        val K_TONE_AUTO_LEVELS = booleanPreferencesKey("tone_auto_levels")
        val K_TONE_SHARPEN = floatPreferencesKey("tone_sharpen")
        val K_TONE_SHADOWS = floatPreferencesKey("tone_shadows")
        val K_TONE_LOCAL_CONTRAST = floatPreferencesKey("tone_local_contrast")
        val K_TONE_AUTO_BACKLIGHT = booleanPreferencesKey("tone_auto_backlight")
        val K_TEMPLATE = stringPreferencesKey("template")
        val K_EVENT_TITLE = stringPreferencesKey("event_title")
        val K_HASHTAG = stringPreferencesKey("hashtag")
        val K_SHOW_DATE = booleanPreferencesKey("show_date")
        val K_SHOW_PRINT_NUMBER = booleanPreferencesKey("show_print_number")
        val K_PRINT_COUNTER = intPreferencesKey("print_counter")
        val K_INSTANT_PRINT = booleanPreferencesKey("instant_print")
        val K_TIMER_SECONDS = intPreferencesKey("timer_seconds")
        val K_STRIP_SHOTS = intPreferencesKey("strip_shots")
        val K_SHUTTER_SOUND = booleanPreferencesKey("shutter_sound")
        val K_LIVE_PREVIEW = booleanPreferencesKey("live_preview")
        val K_AUTO_SAVE_CAPTURES = booleanPreferencesKey("auto_save_captures")
        val K_COPIES = intPreferencesKey("copies")

        /** Un valore sconosciuto (enum rinominato in una versione futura) torna al default. */
        inline fun <reified E : Enum<E>> enumOrDefault(name: String?, default: E): E =
            if (name == null) default else enumValues<E>().firstOrNull { it.name == name } ?: default

        fun finiteOr(value: Float?, default: Float): Float =
            if (value == null || value.isNaN() || value.isInfinite()) default else value
    }
}
