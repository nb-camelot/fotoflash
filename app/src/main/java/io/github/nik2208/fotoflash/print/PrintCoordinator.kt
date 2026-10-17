package io.github.nik2208.fotoflash.print

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.data.SettingsRepository
import io.github.nik2208.fotoflash.history.HistoryRepository
import io.github.nik2208.fotoflash.model.HistoryEntry
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrintRequest
import io.github.nik2208.fotoflash.model.RenderedPrint
import io.github.nik2208.fotoflash.printer.PrinterManager
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.thermal.TemplateTexts
import io.github.nik2208.fotoflash.thermal.ToneAdjustments
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException

/**
 * Unico punto che mette insieme impostazioni, rendering, stampa e storico: editor, fotocamera
 * (stampa istantanea) e storico passano tutti da qui, cosi numerazione e storico restano coerenti.
 */
class PrintCoordinator(
    context: Context,
    private val settings: SettingsRepository,
    private val renderer: PrintRenderer,
    private val printer: PrinterManager,
    private val history: HistoryRepository,
) {
    private val appContext: Context = context.applicationContext

    /**
     * L'ultima stampa registrata nello storico. Se la stessa stampa (stessa istanza) viene
     * ritentata dopo un errore, o salvata e poi stampata, si aggiorna la voce esistente invece
     * di crearne un doppione.
     */
    private class Recorded(val rendered: RenderedPrint, val entry: HistoryEntry)

    private val recordLock = Mutex()
    private var lastRecorded: Recorded? = null

    /** Richiesta di stampa con i default delle impostazioni; i parametri non null li sostituiscono. */
    suspend fun buildRequest(
        photos: List<Bitmap>,
        template: TemplateKind? = null,
        caption: String = "",
        tone: ToneAdjustments? = null,
        dither: DitherAlgorithm? = null,
    ): PrintRequest {
        val current = settings.current()
        val texts = TemplateTexts(
            caption = caption.trim(),
            eventTitle = current.eventTitle.trim(),
            hashtag = current.hashtag.trim(),
            dateText = if (current.showDate) formatNow() else null,
            // Il numero diventa "consumato" solo a stampa riuscita (vedi printAndRecord).
            printNumber = if (current.showPrintNumber) current.printCounter + 1 else null,
        )
        return PrintRequest(
            photos = photos,
            template = template ?: current.template,
            paper = current.paper,
            dither = dither ?: current.dither,
            tone = tone ?: current.tone,
            texts = texts,
        )
    }

    suspend fun render(request: PrintRequest): RenderedPrint = renderer.render(request)

    /**
     * Stampa e registra nello storico in ogni caso: anche una stampa fallita resta ristampabile.
     * Il contatore avanza solo se la stampa e riuscita e portava un numero.
     */
    suspend fun printAndRecord(request: PrintRequest, rendered: RenderedPrint, copies: Int = 1): PrintOutcome {
        val outcome = printer.print(rendered.bitImage, copies.coerceAtLeast(1))
        val printed = outcome is PrintOutcome.Success
        if (printed && request.texts.printNumber != null) {
            try {
                settings.nextPrintNumber()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // La stampa e uscita: un errore delle preferenze non deve trasformarla in un fallimento.
                Log.w(TAG, "contatore stampe non aggiornato", e)
            }
        }
        try {
            record(request, rendered, printed)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Idem per lo storico: l'esito della stampa e cio che conta per chi aspetta il foglio.
            Log.w(TAG, "stampa non registrata nello storico", e)
        }
        return outcome
    }

    /** Solo storico (es. "Salva" dall'editor): la voce resta da stampare. */
    suspend fun saveOnly(request: PrintRequest, rendered: RenderedPrint): HistoryEntry =
        record(request, rendered, printed = false)

    /** Stampa istantanea dalla fotocamera: impostazioni correnti, nessun passaggio dall'editor. */
    suspend fun quickPrint(photos: List<Bitmap>, template: TemplateKind? = null): PrintOutcome {
        val prepared: Pair<PrintRequest, RenderedPrint> = try {
            val request = buildRequest(photos, template)
            request to render(request)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "rendering della stampa istantanea fallito", e)
            // Non c'e un codice dedicato: per l'utente conta che il foglio non e uscito.
            return PrintOutcome.Failure(PrintFailure.WRITE_FAILED, appContext.getString(R.string.ed_error_render))
        }
        val copies = settings.current().copies
        return printAndRecord(prepared.first, prepared.second, copies)
    }

    private suspend fun record(request: PrintRequest, rendered: RenderedPrint, printed: Boolean): HistoryEntry =
        recordLock.withLock {
            val last = lastRecorded
            if (last != null && last.rendered === rendered && history.find(last.entry.id) != null) {
                if (printed && !last.entry.printed) {
                    history.markPrinted(last.entry.id)
                    val updated = last.entry.copy(printed = true)
                    lastRecorded = Recorded(rendered, updated)
                    updated
                } else {
                    last.entry
                }
            } else {
                // Argomenti posizionali: l'ordine e quello del contratto in ARCHITECTURE.md.
                val entry = history.add(
                    rendered,
                    request.photos,
                    request.template,
                    request.texts.caption,
                    request.texts.printNumber,
                    printed,
                )
                lastRecorded = Recorded(rendered, entry)
                entry
            }
        }

    /** Data e ora brevi nella lingua dell'app (es. "17/10/26, 14:32"). */
    private fun formatNow(): String {
        val locales = appContext.resources.configuration.locales
        val locale: Locale = (if (locales.isEmpty()) null else locales.get(0)) ?: Locale.getDefault()
        return DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, locale).format(Date())
    }

    private companion object {
        const val TAG = "PrintCoordinator"
    }
}
