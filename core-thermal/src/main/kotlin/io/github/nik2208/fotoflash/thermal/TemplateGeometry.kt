package io.github.nik2208.fotoflash.thermal

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Impaginazione dei modelli di stampa, tutta in punti di testina (8 punti = 1 mm).
 *
 * Le misure sono pensate per la carta da 58 mm (384 punti) e scalate di 1.5 per l'80 mm
 * (576 punti), arrotondando all'intero. L'altezza e la somma reale degli elementi: niente spazio
 * vuoto in fondo, perche l'avanzamento carta lo fa la stampante (ESC d).
 */
object TemplateGeometry {

    /** Larghezza su cui sono pensate le misure. */
    const val BASE_WIDTH = 384

    /** Scatti massimi in una striscia. */
    const val MAX_STRIP_PHOTOS = 4

    /** Testo precompilato del blocco [TextRole.BRAND] nello scontrino. */
    const val BRAND_TEXT = "FOTOFLASH"

    // Corpi nominali a 384 punti; si riducono solo se il testo non ci sta.
    const val SIZE_EVENT_TITLE = 40
    const val SIZE_BRAND = 48
    const val SIZE_CAPTION = 28
    const val SIZE_HASHTAG = 22
    const val SIZE_DATE = 20
    const val SIZE_PRINT_NUMBER = 22
    const val SIZE_FOOTER = 22

    /**
     * Impagina [kind] sulla carta [paper].
     *
     * Modelli (misure a 384 punti):
     * - [TemplateKind.POLAROID]: margini 16, foto quadrata 352x352, poi una fascia di almeno 96
     *   punti con didascalia e data centrate. Nessuna cornice disegnata: il bordo e la carta.
     *   Senza testi la fascia sparisce e resta il margine di 16.
     * - [TemplateKind.FULL]: foto 384x512 (3:4) a filo, poi didascalia e data se presenti.
     * - [TemplateKind.STRIP]: titolo evento, [photoCount] foto 4:3 da 352x264 (1..4) separate da
     *   12 punti, piede con didascalia, data e hashtag.
     * - [TemplateKind.RECEIPT]: marchio, titolo evento, riga tratteggiata, foto 352x352,
     *   didascalia e hashtag, riga tratteggiata, numero stampa e data, riga tratteggiata, piede.
     *   Le righe tratteggiate ([Decoration.DashedLine]) stanno solo tra sezioni non vuote.
     *
     * POLAROID, FULL e RECEIPT usano sempre una sola foto, qualunque sia [photoCount]:
     * la lunghezza di [TemplateLayout.photos] dice quante foto servono.
     *
     * Testi: quelli vuoti, null o di soli spazi non occupano spazio. Tutti i blocchi sono
     * centrati e larghi quanto l'area utile. [TextRole.EVENT_TITLE] e [TextRole.CAPTION] possono
     * andare a capo: in quel caso producono DUE blocchi consecutivi con lo stesso ruolo, uno per
     * riga. Se un testo non ci sta nemmeno cosi, il corpo scende (fino al 60%) e in ultimo il testo
     * viene troncato con l'ellissi. L'hashtag riceve il '#' iniziale se manca.
     *
     * Blocchi a testo fisso, presenti solo nello scontrino e sempre in un blocco solo:
     * - [TextRole.BRAND]: precompilato con [BRAND_TEXT]; l'app puo lasciarlo o sostituirlo.
     * - [TextRole.FOOTER]: testo VUOTO, l'app deve riempirlo con la frase localizzata
     *   ("Grazie per il sorriso!"). Il blocco e dimensionato per una riga di corpo 22.
     * - [TextRole.PRINT_NUMBER] (se [TemplateTexts.printNumber] non e null): precompilato come
     *   "N. 0042" ([printNumberText]); l'app puo sostituirlo con una versione localizzata.
     *
     * Le larghezze dei testi sono stimate con le metriche reali di Righteous e Space Mono,
     * assumendo che l'app usi [TextBlock.sizeDots] come corpo del font (Paint.textSize).
     */
    fun layout(kind: TemplateKind, paper: PaperWidth, photoCount: Int, texts: TemplateTexts): TemplateLayout {
        val sheet = Sheet(paper)
        when (kind) {
            TemplateKind.POLAROID -> sheet.polaroid(texts)
            TemplateKind.FULL -> sheet.full(texts)
            // qualificata: il parametro Int `photoCount` ha lo stesso nome della funzione
            TemplateKind.STRIP -> sheet.strip(texts, TemplateGeometry.photoCount(kind, photoCount))
            TemplateKind.RECEIPT -> sheet.receipt(texts)
        }
        return sheet.build()
    }

    /** Quante foto usa davvero [kind] se ne vengono offerte [requested]. */
    fun photoCount(kind: TemplateKind, requested: Int): Int =
        if (kind == TemplateKind.STRIP) requested.coerceIn(1, MAX_STRIP_PHOTOS) else 1

    /** Testo del numero progressivo: "N. 0042". */
    fun printNumberText(number: Int): String = "N. " + number.coerceAtLeast(0).toString().padStart(4, '0')
}

// Misure a 384 punti
private const val MARGIN = 16
private const val GAP = 12
private const val TEXT_TAIL = 8
private const val TEXT_INSET = 4
private const val SEPARATOR = 20
private const val DASH = 6
private const val DASH_GAP = 4
private const val DASH_THICKNESS = 2
private const val POLAROID_BAND = 96
private const val POLAROID_BAND_PAD = 12
private const val FULL_PHOTO_HEIGHT = 512
private const val MIN_TEXT = 14

/** Riduzione massima del corpo pur di restare su una riga, prima di andare a capo. */
private const val ONE_LINE_SHRINK = 0.85

/** Riduzione massima del corpo in assoluto (oltre si tronca con l'ellissi). */
private const val MIN_SHRINK = 0.6

private const val ELLIPSIS = "\u2026"

private val WHITESPACE = Regex("\\s+")

/** Spazi multipli e a capo diventano uno spazio; null diventa "". */
internal fun normalizeText(raw: String?): String = raw?.replace(WHITESPACE, " ")?.trim().orEmpty()

/** Altezza di una riga di testo: corpo + circa 25% di aria. */
internal fun lineHeightFor(size: Int): Int = size + (size + 2) / 4

/** Testo gia diviso in righe, prima di essere posato sul foglio. */
private class Fitted(
    val role: TextRole,
    val font: FontRole,
    val size: Int,
    val lines: List<String>,
    val lineHeight: Int,
) {
    val height: Int get() = lines.size * lineHeight
}

/** Foglio in costruzione: un cursore verticale che scende man mano che si posano gli elementi. */
private class Sheet(paper: PaperWidth) {
    val width: Int = paper.dots
    private val scale: Double = paper.dots.toDouble() / TemplateGeometry.BASE_WIDTH
    val margin: Int = sc(MARGIN)
    val contentWidth: Int = width - 2 * margin
    private val textAvail: Int = contentWidth - 2 * sc(TEXT_INSET)

    var y: Int = 0
    private val photos = ArrayList<Rect>()
    private val texts = ArrayList<TextBlock>()
    private val decorations = ArrayList<Decoration>()

    fun sc(v: Int): Int = (v * scale).roundToInt()

    fun polaroid(t: TemplateTexts) {
        space(margin)
        photo(margin, contentWidth, contentWidth)
        val blocks = listOfNotNull(
            text(TextRole.CAPTION, t.caption, FontRole.MONO_BOLD, TemplateGeometry.SIZE_CAPTION, 2),
            text(TextRole.DATE, t.dateText, FontRole.MONO, TemplateGeometry.SIZE_DATE, 1),
        )
        if (blocks.isEmpty()) {
            space(margin)
            return
        }
        // fascia bassa da instantanea: i testi stanno centrati in una fascia di altezza minima fissa
        val content = blocks.sumOf { it.height }
        val band = max(sc(POLAROID_BAND), content + 2 * sc(POLAROID_BAND_PAD))
        val bandTop = y
        space((band - content) / 2)
        for (block in blocks) place(block)
        y = bandTop + band
    }

    fun full(t: TemplateTexts) {
        photo(0, width, sc(FULL_PHOTO_HEIGHT))
        val blocks = listOfNotNull(
            text(TextRole.CAPTION, t.caption, FontRole.MONO_BOLD, TemplateGeometry.SIZE_CAPTION, 2),
            text(TextRole.DATE, t.dateText, FontRole.MONO, TemplateGeometry.SIZE_DATE, 1),
        )
        if (blocks.isNotEmpty()) {
            space(sc(GAP))
            for (block in blocks) place(block)
            space(sc(TEXT_TAIL))
        }
    }

    fun strip(t: TemplateTexts, count: Int) {
        space(margin)
        val title = text(TextRole.EVENT_TITLE, t.eventTitle, FontRole.DISPLAY, TemplateGeometry.SIZE_EVENT_TITLE, 2)
        if (title != null) {
            place(title)
            space(sc(GAP))
        }
        // 4:3 esatto anche a 576 punti
        val photoHeight = contentWidth * 3 / 4
        for (i in 0 until count) {
            if (i > 0) space(sc(GAP))
            photo(margin, contentWidth, photoHeight)
        }
        val footer = listOfNotNull(
            text(TextRole.CAPTION, t.caption, FontRole.MONO_BOLD, TemplateGeometry.SIZE_CAPTION, 2),
            text(TextRole.DATE, t.dateText, FontRole.MONO, TemplateGeometry.SIZE_DATE, 1),
            text(TextRole.HASHTAG, hashtag(t.hashtag), FontRole.MONO, TemplateGeometry.SIZE_HASHTAG, 1),
        )
        if (footer.isEmpty()) {
            space(margin)
            return
        }
        space(sc(GAP))
        for (block in footer) place(block)
        space(sc(TEXT_TAIL))
    }

    fun receipt(t: TemplateTexts) {
        space(margin)
        // intestazione
        place(fixedText(TextRole.BRAND, TemplateGeometry.BRAND_TEXT, FontRole.DISPLAY, TemplateGeometry.SIZE_BRAND, 1))
        val title = text(TextRole.EVENT_TITLE, t.eventTitle, FontRole.DISPLAY, TemplateGeometry.SIZE_EVENT_TITLE, 2)
        if (title != null) place(title)
        dashed()
        // foto e note
        photo(margin, contentWidth, contentWidth)
        val notes = listOfNotNull(
            text(TextRole.CAPTION, t.caption, FontRole.MONO_BOLD, TemplateGeometry.SIZE_CAPTION, 2),
            text(TextRole.HASHTAG, hashtag(t.hashtag), FontRole.MONO, TemplateGeometry.SIZE_HASHTAG, 1),
        )
        if (notes.isNotEmpty()) {
            space(sc(GAP))
            for (block in notes) place(block)
        }
        // dati della stampa: la sezione sparisce se e vuota, senza doppie righe tratteggiate
        val number = t.printNumber
        val numberText = if (number != null) TemplateGeometry.printNumberText(number) else null
        val info = listOfNotNull(
            text(TextRole.PRINT_NUMBER, numberText, FontRole.MONO, TemplateGeometry.SIZE_PRINT_NUMBER, 1),
            text(TextRole.DATE, t.dateText, FontRole.MONO, TemplateGeometry.SIZE_DATE, 1),
        )
        if (info.isNotEmpty()) {
            dashed()
            for (block in info) place(block)
        }
        // piede: la frase la mette l'app, localizzata
        dashed()
        place(fixedText(TextRole.FOOTER, "", FontRole.MONO, TemplateGeometry.SIZE_FOOTER, 1))
        space(sc(TEXT_TAIL))
    }

    fun build(): TemplateLayout = TemplateLayout(width, y, photos.toList(), texts.toList(), decorations.toList())

    private fun space(dots: Int) {
        y += dots
    }

    private fun photo(left: Int, w: Int, h: Int) {
        photos.add(Rect(left, y, w, h))
        y += h
    }

    private fun hashtag(raw: String): String {
        val text = normalizeText(raw)
        return if (text.isEmpty() || text.startsWith("#")) text else "#$text"
    }

    /** Testo facoltativo: null se vuoto. */
    private fun text(role: TextRole, raw: String?, font: FontRole, nominal: Int, maxLines: Int): Fitted? {
        val text = normalizeText(raw)
        if (text.isEmpty()) return null
        return fixedText(role, text, font, nominal, maxLines)
    }

    /** Testo sempre presente, anche se vuoto (blocchi che riempie l'app). */
    private fun fixedText(role: TextRole, text: String, font: FontRole, nominal: Int, maxLines: Int): Fitted {
        val size = sc(nominal)
        val minSize = min(size, max(sc(MIN_TEXT), (size * MIN_SHRINK).roundToInt()))
        val fit = TextFit.fit(text, font, size, minSize, textAvail, maxLines)
        return Fitted(role, font, fit.size, fit.lines, lineHeightFor(fit.size))
    }

    private fun place(f: Fitted) {
        for (line in f.lines) {
            texts.add(TextBlock(f.role, line, Rect(margin, y, contentWidth, f.lineHeight), f.font, f.size, TextAlign.CENTER))
            y += f.lineHeight
        }
    }

    /** Riga tratteggiata centrata in una fascia propria, cosi non tocca foto e testi vicini. */
    private fun dashed() {
        val band = sc(SEPARATOR)
        val thickness = sc(DASH_THICKNESS)
        decorations.add(
            Decoration.DashedLine(
                y = y + (band - thickness) / 2,
                from = margin,
                to = width - margin,
                dash = sc(DASH),
                gap = sc(DASH_GAP),
                thickness = thickness,
            ),
        )
        y += band
    }
}

/** Esito dell'impaginazione di un testo: corpo scelto e righe. */
internal class FitResult(val size: Int, val lines: List<String>)

/** Distribuzione di un testo in righe che stanno nella larghezza disponibile. */
internal object TextFit {

    /**
     * Cerca, in ordine: una riga al corpo pieno (o ridotto fino all'85%); poi, se [maxLines] > 1,
     * righe a capo tra le parole riducendo il corpo fino a [minSize]; altrimenti una riga fino a
     * [minSize]; in ultimo spezza le parole e tronca con l'ellissi. Ogni riga sta in [avail].
     */
    fun fit(text: String, font: FontRole, nominal: Int, minSize: Int, avail: Int, maxLines: Int): FitResult {
        val oneLineFloor = min(nominal, max(minSize, (nominal * ONE_LINE_SHRINK).roundToInt()))
        for (s in nominal downTo oneLineFloor) {
            if (TextMetrics.width(text, font, s) <= avail) return FitResult(s, listOf(text))
        }
        if (maxLines > 1) {
            for (s in nominal downTo minSize) {
                val lines = wrapWords(text, font, s, avail)
                if (lines != null && lines.size <= maxLines) {
                    val balanced = if (lines.size == 2) balance(text, font, s, avail) else null
                    return FitResult(s, balanced ?: lines)
                }
            }
        } else {
            for (s in oneLineFloor - 1 downTo minSize) {
                if (TextMetrics.width(text, font, s) <= avail) return FitResult(s, listOf(text))
            }
        }
        val hard = wrapHard(text, font, minSize, avail)
        return FitResult(minSize, limit(hard, maxLines.coerceAtLeast(1), font, minSize, avail))
    }

    /** A capo tra le parole (greedy); null se una parola da sola non ci sta. */
    fun wrapWords(text: String, font: FontRole, size: Int, avail: Int): List<String>? {
        val lines = ArrayList<String>()
        var line = ""
        for (word in text.split(' ')) {
            if (word.isEmpty()) continue
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (TextMetrics.width(candidate, font, size) <= avail) {
                line = candidate
                continue
            }
            if (line.isEmpty() || TextMetrics.width(word, font, size) > avail) return null
            lines.add(line)
            line = word
        }
        if (line.isNotEmpty()) lines.add(line)
        return lines
    }

    /** Due righe di lunghezza simile: un titolo centrato con la seconda riga corta sembra un errore. */
    private fun balance(text: String, font: FontRole, size: Int, avail: Int): List<String>? {
        val words = text.split(' ').filter { it.isNotEmpty() }
        var best: List<String>? = null
        var bestWidth = Double.MAX_VALUE
        for (i in 1 until words.size) {
            val first = words.subList(0, i).joinToString(" ")
            val second = words.subList(i, words.size).joinToString(" ")
            val w = max(TextMetrics.width(first, font, size), TextMetrics.width(second, font, size))
            if (w <= avail && w < bestWidth) {
                bestWidth = w
                best = listOf(first, second)
            }
        }
        return best
    }

    /** A capo spezzando anche le parole troppo lunghe. */
    private fun wrapHard(text: String, font: FontRole, size: Int, avail: Int): List<String> {
        val lines = ArrayList<String>()
        var line = ""
        for (word in text.split(' ')) {
            if (word.isEmpty()) continue
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (TextMetrics.width(candidate, font, size) <= avail) {
                line = candidate
                continue
            }
            if (line.isNotEmpty()) lines.add(line)
            var rest = word
            while (rest.isNotEmpty() && TextMetrics.width(rest, font, size) > avail) {
                val n = fittingPrefix(rest, font, size, avail)
                lines.add(rest.substring(0, n))
                rest = rest.substring(n)
            }
            line = rest
        }
        if (line.isNotEmpty()) lines.add(line)
        if (lines.isEmpty()) lines.add("")
        return lines
    }

    /**
     * Lunghezza del prefisso piu lungo che sta in [avail]; almeno un cluster, per avanzare sempre.
     * Si taglia solo tra cluster ([TextMetrics.clusterEnd]): mai tra le due meta di una bandiera
     * o subito dopo uno ZWJ.
     */
    private fun fittingPrefix(s: String, font: FontRole, size: Int, avail: Int): Int {
        var end = TextMetrics.clusterEnd(s, 0)
        while (end < s.length) {
            val next = TextMetrics.clusterEnd(s, end)
            if (TextMetrics.width(s.substring(0, next), font, size) > avail) break
            end = next
        }
        return end
    }

    /** Tiene al massimo [maxLines] righe; se ne taglia, l'ultima finisce con l'ellissi. */
    private fun limit(lines: List<String>, maxLines: Int, font: FontRole, size: Int, avail: Int): List<String> {
        if (lines.size <= maxLines) return lines
        val kept = ArrayList<String>(lines.subList(0, maxLines))
        var last = kept[maxLines - 1].trimEnd()
        while (last.isNotEmpty() && TextMetrics.width(last + ELLIPSIS, font, size) > avail) {
            last = dropLastCluster(last).trimEnd()
        }
        kept[maxLines - 1] = last + ELLIPSIS
        return kept
    }

    /** Toglie l'ultimo cluster intero: una bandiera o un'emoji composta spariscono tutte insieme. */
    private fun dropLastCluster(s: String): String {
        // i cluster si contano dall'inizio: le coppie di indicatori regionali dipendono dalla parita
        var start = 0
        var lastStart = 0
        while (start < s.length) {
            lastStart = start
            start = TextMetrics.clusterEnd(s, start)
        }
        return s.substring(0, lastStart)
    }
}

/**
 * Larghezza stimata dei testi, dalle tabelle di avanzamento dei font del brand (app/res/font).
 * Space Mono e monospaziato: 612/1000 em per ogni glifo latino.
 */
internal object TextMetrics {

    private const val RIGHTEOUS_UPEM = 2048.0
    private const val RIGHTEOUS_ELLIPSIS = 1616
    private const val MONO_ADVANCE = 0.612

    /** Righteous, avanzamenti in unita/2048 per i codici 32..126. */
    private val RIGHTEOUS_ASCII = intArrayOf(
        573, 563, 838, 1149, 938, 1403, 995, 489, 719, 719, 1208, 995, 541, 1083, 539, 1004,
        1315, 651, 1169, 1202, 1292, 1200, 1260, 1057, 1266, 1262, 567, 567, 979, 1104, 979, 1235,
        1290, 1380, 1364, 1311, 1339, 1184, 1151, 1362, 1413, 553, 854, 1280, 1153, 1679, 1413, 1593,
        1315, 1593, 1335, 1251, 1184, 1380, 1233, 1679, 1247, 1270, 1202, 780, 1004, 780, 602, 1225,
        461, 1245, 1223, 1069, 1243, 1075, 811, 1245, 1151, 483, 487, 1104, 483, 1561, 1151, 1186,
        1247, 1245, 848, 1073, 897, 1151, 1090, 1550, 1083, 1153, 987, 956, 547, 956, 924,
    )

    /** Righteous, avanzamenti in unita/2048 per i codici 160..255 (Latin-1: lettere accentate). */
    private val RIGHTEOUS_LATIN1 = intArrayOf(
        573, 563, 948, 1395, 930, 1339, 551, 1167, 616, 1343, 924, 1442, 1085, 858, 901, 506,
        782, 1057, 729, 727, 461, 1171, 1655, 535, 426, 475, 885, 1440, 1329, 1305, 1452, 1233,
        1380, 1380, 1380, 1380, 1380, 1380, 2025, 1311, 1184, 1184, 1184, 1184, 553, 553, 553, 553,
        1378, 1413, 1593, 1593, 1593, 1593, 1593, 981, 1593, 1380, 1380, 1380, 1380, 1270, 1305, 1667,
        1245, 1245, 1245, 1245, 1245, 1245, 1999, 1069, 1075, 1075, 1075, 1075, 483, 483, 483, 483,
        1190, 1151, 1186, 1186, 1186, 1186, 1186, 1012, 1186, 1151, 1151, 1151, 1151, 1153, 1247, 1153,
    )

    private const val ZWJ = 0x200D
    private const val KEYCAP = 0x20E3

    /**
     * Larghezza in punti di [text] al corpo [size].
     *
     * Le emoji si misurano per glifo disegnato, non per code point: selettori di variante,
     * modificatori di carnagione, tag, ZWJ e segni combinanti non occupano spazio, e una coppia
     * di indicatori regionali e una bandiera sola. Il code point dopo uno ZWJ conta invece per
     * intero: sui telefoni il cui font emoji non conosce la sequenza (Android 8-10) i glifi escono
     * davvero affiancati, e sovrastimare riduce solo il corpo, mentre sottostimare tronca.
     */
    fun width(text: String, font: FontRole, size: Int): Double {
        var em = 0.0
        var i = 0
        // indicatori regionali consecutivi: il secondo di ogni coppia completa la bandiera
        var regional = 0
        while (i < text.length) {
            val cp = Character.codePointAt(text, i)
            if (isRegionalIndicator(cp)) regional++ else regional = 0
            val silent = isZeroWidth(cp) || (regional > 0 && regional % 2 == 0)
            if (!silent) em += advance(cp, font)
            i += Character.charCount(cp)
        }
        return em * size
    }

    /**
     * Fine (esclusa) del cluster che comincia in [start]: un code point, il secondo indicatore
     * regionale se il primo lo e, poi i code point a larghezza zero che lo seguono, il keycap e
     * quello unito da ogni ZWJ. E l'unita minima per andare a capo o troncare: approssima i
     * grafemi senza BreakIterator, che sulla JVM dei test e su Android (ICU) si comporta in modo
     * diverso con ZWJ e bandiere. [start] < [s].length.
     */
    fun clusterEnd(s: String, start: Int): Int {
        var prev = Character.codePointAt(s, start)
        var end = start + Character.charCount(prev)
        if (isRegionalIndicator(prev) && end < s.length) {
            val next = Character.codePointAt(s, end)
            if (isRegionalIndicator(next)) {
                end += Character.charCount(next)
                prev = next
            }
        }
        while (end < s.length) {
            val cp = Character.codePointAt(s, end)
            // il keycap non e a larghezza zero ma fa parte della cifra che lo precede
            if (prev != ZWJ && cp != KEYCAP && !isZeroWidth(cp)) break
            end += Character.charCount(cp)
            prev = cp
        }
        return end
    }

    private fun isRegionalIndicator(cp: Int): Boolean = cp in 0x1F1E6..0x1F1FF

    /**
     * Code point che non avanzano: ZWJ, selettori di variante (U+FE0F rende emoji il simbolo
     * davanti), carnagioni, tag delle bandiere regionali, segni combinanti. Il keycap U+20E3 resta
     * largo: trasforma la cifra davanti in un'emoji, piu larga della cifra stessa.
     */
    private fun isZeroWidth(cp: Int): Boolean {
        if (cp == KEYCAP) return false
        if (cp == ZWJ || cp in 0xFE00..0xFE0F || cp in 0x1F3FB..0x1F3FF || cp in 0xE0020..0xE007F) return true
        val type = Character.getType(cp)
        return type == Character.NON_SPACING_MARK.toInt() || type == Character.ENCLOSING_MARK.toInt()
    }

    /** Avanzamento in em; fuori dalle tabelle stime prudenti (quei glifi arrivano da font di ripiego). */
    private fun advance(cp: Int, font: FontRole): Double = when (font) {
        FontRole.MONO, FontRole.MONO_BOLD -> when {
            cp <= 0x24F -> MONO_ADVANCE
            cp <= 0xFFFF -> 1.0
            else -> 1.25
        }
        FontRole.DISPLAY -> when {
            cp in 32..126 -> RIGHTEOUS_ASCII[cp - 32] / RIGHTEOUS_UPEM
            cp in 160..255 -> RIGHTEOUS_LATIN1[cp - 160] / RIGHTEOUS_UPEM
            cp == 0x2026 -> RIGHTEOUS_ELLIPSIS / RIGHTEOUS_UPEM
            cp <= 0x24F -> 0.7
            cp <= 0xFFFF -> 1.0
            else -> 1.25
        }
    }
}
