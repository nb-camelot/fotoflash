package io.github.nik2208.fotoflash.printer

import android.content.Context
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.Ditherer
import io.github.nik2208.fotoflash.thermal.EscPosBuilder
import io.github.nik2208.fotoflash.thermal.GrayImage
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.TextAlign
import io.github.nik2208.fotoflash.thermal.TransportHints
import java.text.DateFormat
import java.text.Normalizer
import java.util.Date
import java.util.Locale

/**
 * Pagina di prova: e lo strumento di calibrazione. Usa le stesse impostazioni di una stampa vera
 * (intensita, altezza banda, avanzamento, taglio) e mostra i quattro retini su una sfumatura,
 * cosi si vede subito l'effetto di ogni regolazione.
 *
 * Solo ASCII sulla carta: le codepage delle stampanti economiche variano e gli accenti escono a caso.
 */
object TestPage {

    /** Altezza in punti delle bande di sfumatura (5 mm). */
    private const val GRADIENT_ROWS = 40

    /** Altezza in punti del riquadro di controllo larghezza. */
    private const val FRAME_ROWS = 32

    /**
     * Pacchetti in ordine di invio: intestazione, controllo larghezza, un retino per pacchetto, piede.
     * [bleHints] non null = stampante ESC/POS collegata in BLE: la riga di trasferimento riporta i
     * parametri di invio BLE invece dei blocchi SPP.
     */
    fun build(
        context: Context,
        settings: AppSettings,
        printerName: String,
        now: Date = Date(),
        bleHints: TransportHints? = null,
    ): List<ByteArray> {
        val paper = settings.paper
        val dots = paper.dots
        // Una colonna in meno del massimo: alcune stampanti a riga piena vanno a capo da sole
        // e il LF successivo lascerebbe una riga vuota.
        val columns = (if (paper == PaperWidth.MM58) 32 else 48) - 1
        val bandHeight = PrinterTuning.clampBandHeight(settings.bandHeight)
        val heatLevel = PrinterTuning.clampHeatLevel(settings.heatLevel)
        val rule = "-".repeat(columns)
        val locale = context.resources.configuration.locales[0] ?: Locale.getDefault()
        val packets = ArrayList<ByteArray>()

        // Intestazione con i dati della taratura corrente
        val header = EscPosBuilder().init()
        PrinterTuning.heatFor(heatLevel)?.let { header.heat(it) }
        header.align(TextAlign.CENTER)
            .bold(true)
            .size(2, 2)
            .line(asciiOnly(context.getString(R.string.app_name).uppercase(Locale.ROOT)))
            .size(1, 1)
            .bold(false)
            .line(asciiOnly(context.getString(R.string.prn_test_payoff)))
            .line(rule)
            .align(TextAlign.START)
        val dateText = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale).format(now)
        val info = listOf(
            context.getString(R.string.prn_test_printer, printerName),
            context.getString(R.string.prn_test_date, dateText),
            context.getString(R.string.prn_test_paper, paper.mm, dots),
            PrinterDrivers.byId(settings.printerDriver).let { driver ->
                context.getString(R.string.prn_test_driver, driver.displayName, driver.dpi)
            },
            context.getString(R.string.prn_test_heat, context.getString(PrinterTuning.heatLevelLabel(heatLevel)), heatLevel),
            if (bleHints != null) {
                context.getString(
                    R.string.prn_test_transfer_ble,
                    bandHeight,
                    bleHints.chunkSize,
                    bleHints.chunkDelayMs,
                    context.getString(if (bleHints.withoutResponse) R.string.prn_ble_no_response else R.string.prn_ble_with_response),
                )
            } else {
                context.getString(
                    R.string.prn_test_transfer,
                    bandHeight,
                    PrinterTuning.clampChunkSize(settings.chunkSize),
                    PrinterTuning.clampChunkDelay(settings.chunkDelayMs),
                )
            },
        )
        info.forEach { text -> wrap(asciiOnly(text), columns).forEach { header.line(it) } }
        header.line(rule)
        packets += header.bytes()

        // Controllo larghezza: se un bordo laterale manca, la larghezza carta e sbagliata
        val frame = EscPosBuilder().align(TextAlign.START)
        wrap(asciiOnly(context.getString(R.string.prn_test_width)), columns).forEach { frame.line(it) }
        frame.raster(widthFrame(dots), bandHeight).line("")
        packets += frame.bytes()

        // Un retino per pacchetto: la sfumatura nero → bianco mostra come rende ogni metodo
        val title = EscPosBuilder().align(TextAlign.START)
        wrap(asciiOnly(context.getString(R.string.prn_test_dither)), columns).forEach { title.line(it) }
        packets += title.bytes()
        for (algorithm in DitherAlgorithm.entries) {
            val name = context.getString(ditherName(algorithm))
            val label = if (algorithm == settings.dither) {
                context.getString(R.string.prn_test_dither_current, name)
            } else {
                name
            }
            val band = Ditherer.dither(GrayImage.gradient(dots, GRADIENT_ROWS), algorithm)
            val block = EscPosBuilder().align(TextAlign.START)
            wrap(asciiOnly(label), columns).forEach { block.line(it) }
            block.raster(band, bandHeight).line("")
            packets += block.bytes()
        }

        // Consigli e avanzamento finale (con le impostazioni reali: anche questo si calibra)
        val footer = EscPosBuilder().align(TextAlign.START).line(rule)
        listOf(R.string.prn_test_tip_pale, R.string.prn_test_tip_broken, R.string.prn_test_tip_blank).forEach { res ->
            wrap(asciiOnly(context.getString(res)), columns).forEach { footer.line(it) }
        }
        footer.align(TextAlign.CENTER)
            .line(rule)
            .line(asciiOnly(context.getString(R.string.prn_test_end)))
            .align(TextAlign.START)
            .feed(PrinterTuning.clampFeedLines(settings.feedLines))
        if (settings.cutPaper) footer.cut()
        packets += footer.bytes()
        return packets
    }

    /** Nome localizzato del retino (lo usa anche la pagina di prova raster dei driver non ESC/POS). */
    internal fun ditherName(algorithm: DitherAlgorithm): Int = when (algorithm) {
        DitherAlgorithm.ATKINSON -> R.string.prn_dither_atkinson
        DitherAlgorithm.FLOYD_STEINBERG -> R.string.prn_dither_floyd_steinberg
        DitherAlgorithm.ORDERED_BAYER -> R.string.prn_dither_bayer
        DitherAlgorithm.THRESHOLD -> R.string.prn_dither_threshold
    }

    /** Riquadro a tutta larghezza con tacche ogni 6 mm (48 punti), piu lunghe ogni 24 mm. */
    private fun widthFrame(width: Int): BitImage {
        val image = BitImage(width, FRAME_ROWS)
        val border = 3
        for (x in 0 until width) {
            for (t in 0 until border) {
                image[x, t] = true
                image[x, FRAME_ROWS - 1 - t] = true
            }
        }
        for (y in 0 until FRAME_ROWS) {
            for (t in 0 until border) {
                image[t, y] = true
                image[width - 1 - t, y] = true
            }
        }
        var x = 48
        while (x < width - border) {
            val length = if (x % 192 == 0) 16 else 8
            for (y in border until border + length) {
                image[x, y] = true
                if (x + 1 < width) image[x + 1, y] = true
            }
            x += 48
        }
        return image
    }

    /** A capo per parole entro [columns]; le parole piu lunghe di una riga si spezzano. */
    private fun wrap(text: String, columns: Int): List<String> {
        val lines = ArrayList<String>()
        for (paragraph in text.split('\n')) {
            var current = StringBuilder()
            for (rawWord in paragraph.split(' ')) {
                if (rawWord.isEmpty()) continue
                var word = rawWord
                while (word.length > columns) {
                    if (current.isNotEmpty()) {
                        lines += current.toString()
                        current = StringBuilder()
                    }
                    lines += word.substring(0, columns)
                    word = word.substring(columns)
                }
                if (word.isEmpty()) continue
                when {
                    current.isEmpty() -> current.append(word)
                    current.length + 1 + word.length <= columns -> current.append(' ').append(word)
                    else -> {
                        lines += current.toString()
                        current = StringBuilder(word)
                    }
                }
            }
            if (current.isNotEmpty() || paragraph.isBlank()) lines += current.toString()
        }
        return lines
    }

    /**
     * Riduce un testo ad ASCII stampabile: toglie gli accenti (NFD + segni combinanti), converte
     * spazi speciali (es. lo spazio stretto delle date di Android 14) e punteggiatura tipografica,
     * sostituisce il resto con "?". Vale anche per testi non nostri, come il nome della stampante.
     */
    internal fun asciiOnly(text: String): String {
        val decomposed = Normalizer.normalize(text, Normalizer.Form.NFD)
        val out = StringBuilder(decomposed.length)
        for (c in decomposed) {
            when {
                c in ' '..'~' -> out.append(c)
                c == '\n' -> out.append(c)
                Character.getType(c) == Character.NON_SPACING_MARK.toInt() -> Unit
                Character.isWhitespace(c) || Character.isSpaceChar(c) -> out.append(' ')
                c == '‘' || c == '’' -> out.append('\'')
                c == '“' || c == '”' || c == '«' || c == '»' -> out.append('"')
                c == '–' || c == '—' -> out.append('-')
                c == '…' -> out.append("...")
                c == '·' || c == '•' -> out.append('-')
                c == '→' -> out.append("->")
                else -> out.append('?')
            }
        }
        return out.toString()
    }
}
