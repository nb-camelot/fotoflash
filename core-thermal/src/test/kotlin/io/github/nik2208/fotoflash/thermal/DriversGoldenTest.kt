package io.github.nik2208.fotoflash.thermal

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parita Kotlin <-> JS: i driver Kotlin devono produrre GLI STESSI BYTE dei driver della PWA.
 *
 * I vettori stanno in web/tests/fixtures/drivers-golden.json, generato dai test web e committato
 * (formato e pattern in docs/DRIVERS.md, "Vettori di prova condivisi"). Se il file manca il test
 * fallisce: la parita e un requisito, non un controllo facoltativo.
 *
 * Due controlli separati, per capire subito che cosa diverge:
 * - [sameBytesAsWeb]: il flusso di byte concatenato (cio che arriva alla stampante);
 * - [samePacketBoundariesAsWeb]: la divisione in pacchetti (avanzamento, risincronizzazione).
 *   Se fallisce solo questo, i byte sono gli stessi ma spezzati in modo diverso.
 */
class DriversGoldenTest {

    private class GoldenCase(
        val label: String,
        val driver: PrinterDriver,
        val pattern: String,
        val image: BitImage,
        val options: DriverOptions,
        val packets: List<ByteArray>,
    )

    @Test
    fun goldenFileHasTheMinimumCases() {
        val cases = loadCases()
        val missing = ArrayList<String>()
        for (driver in PrinterDrivers.all) {
            val covered = cases.any {
                it.driver === driver && it.pattern == "checker8" && it.image.width == 100 && it.image.height == 300
            }
            if (!covered) missing += "${driver.id} checker8 100x300"
        }
        val m02pro = PrinterDrivers.PHOMEMO_M02PRO
        if (cases.none { it.driver === m02pro && it.options.widthBytes == 78 }) missing += "phomemo-m02pro widthBytes 78"
        if (cases.none { it.driver === m02pro && it.options.heatLevel == 3 }) missing += "phomemo-m02pro heatLevel 3"
        if (cases.none { it.driver === PrinterDrivers.ESCPOS_58 && it.options.cut }) missing += "escpos-58 cut = true"
        assertTrue("Casi minimi di docs/DRIVERS.md assenti dal file condiviso: ${missing.joinToString("; ")}", missing.isEmpty())
    }

    @Test
    fun sameBytesAsWeb() {
        val failures = ArrayList<String>()
        for (case in loadCases()) {
            val expected = concat(case.packets)
            val actual = concat(case.driver.encode(case.image, case.options))
            val at = firstDifference(expected, actual)
            if (at >= 0) {
                failures += "${case.label}: primo byte diverso all'offset $at " +
                    "(JS ${expected.size} byte, Kotlin ${actual.size}); " +
                    "JS ...${hexAround(expected, at)}... / Kotlin ...${hexAround(actual, at)}..."
            }
        }
        assertTrue("Byte diversi tra Kotlin e JS:\n" + failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun samePacketBoundariesAsWeb() {
        val failures = ArrayList<String>()
        for (case in loadCases()) {
            val expected = case.packets.map { it.size }
            val actual = case.driver.encode(case.image, case.options).map { it.size }
            if (expected != actual) {
                failures += "${case.label}: pacchetti JS ${expected.size} ${summary(expected)}, " +
                    "Kotlin ${actual.size} ${summary(actual)}"
            }
        }
        assertTrue("Stessi byte ma pacchetti divisi in modo diverso:\n" + failures.joinToString("\n"), failures.isEmpty())
    }

    // ---- lettura del file condiviso ----

    private fun goldenFile(): File {
        // Gradle esegue i test da core-thermal/; dall'IDE la cartella di lavoro puo essere la radice
        val candidates = listOf(
            File("../web/tests/fixtures/drivers-golden.json"),
            File("web/tests/fixtures/drivers-golden.json"),
        )
        return candidates.firstOrNull { it.isFile } ?: throw AssertionError(
            "Manca il file dei vettori condivisi Kotlin <-> JS (cercato in: " +
                candidates.joinToString(", ") { it.absoluteFile.normalize().path } + "). " +
                "Lo generano i test web dei driver (node --test web/tests/*.test.mjs) e va committato: " +
                "vedi docs/DRIVERS.md, \"Vettori di prova condivisi\". La parita dei byte e un requisito.",
        )
    }

    private fun loadCases(): List<GoldenCase> {
        val file = goldenFile()
        val root = try {
            MiniJson(file.readText(Charsets.UTF_8)).parse()
        } catch (e: IllegalStateException) {
            throw AssertionError("${file.path}: JSON non valido (${e.message})", e)
        }
        val cases = (root as? Map<*, *>)?.get("cases") as? List<*>
            ?: throw AssertionError("${file.path}: manca l'array \"cases\"")
        if (cases.isEmpty()) throw AssertionError("${file.path}: \"cases\" e vuoto")
        val problems = ArrayList<String>()
        val parsed = ArrayList<GoldenCase>()
        cases.forEachIndexed { index, raw ->
            try {
                parsed += parseCase(index, raw)
            } catch (e: IllegalArgumentException) {
                problems += "caso $index: ${e.message}"
            }
        }
        if (problems.isNotEmpty()) throw AssertionError("${file.path}: casi non leggibili:\n" + problems.joinToString("\n"))
        return parsed
    }

    private fun parseCase(index: Int, raw: Any?): GoldenCase {
        val case = raw as? Map<*, *> ?: throw IllegalArgumentException("non e un oggetto")
        val driverId = case["driver"] as? String ?: throw IllegalArgumentException("manca \"driver\"")
        // niente byId: ripiegherebbe su escpos-58 e nasconderebbe un id sbagliato
        val driver = PrinterDrivers.all.firstOrNull { it.id == driverId }
            ?: throw IllegalArgumentException("driver sconosciuto \"$driverId\"")

        val image = case["image"] as? Map<*, *> ?: throw IllegalArgumentException("manca \"image\"")
        val width = intOf(image["width"], "image.width") ?: throw IllegalArgumentException("manca image.width")
        val height = intOf(image["height"], "image.height") ?: throw IllegalArgumentException("manca image.height")
        val pattern = image["pattern"] as? String ?: throw IllegalArgumentException("manca image.pattern")
        require(width > 0 && height > 0) { "dimensioni non valide ${width}x$height" }

        val options = optionsOf(case["options"])
        val hex = case["packetsHex"] as? List<*> ?: throw IllegalArgumentException("manca \"packetsHex\"")
        val packets = hex.mapIndexed { i, h -> bytesOf(h as? String ?: throw IllegalArgumentException("packetsHex[$i] non e una stringa"), i) }

        return GoldenCase(
            label = "#$index $driverId $pattern ${width}x$height $options",
            driver = driver,
            pattern = pattern,
            image = patternImage(pattern, width, height),
            options = options,
            packets = packets,
        )
    }

    /**
     * Opzioni del caso. Sono ammessi i campi di DriverOptions e i nomi delle impostazioni per le
     * opzioni Phomemo; un campo sconosciuto e un errore, perche ignorarlo produrrebbe una differenza
     * di byte incomprensibile.
     */
    private fun optionsOf(raw: Any?): DriverOptions {
        if (raw == null) return DriverOptions()
        val map = raw as? Map<*, *> ?: throw IllegalArgumentException("\"options\" non e un oggetto")
        val unknown = map.keys.map { it.toString() }.filter { it !in OPTION_KEYS }
        require(unknown.isEmpty()) { "opzioni sconosciute $unknown (ammesse: $OPTION_KEYS)" }
        val defaults = DriverOptions()
        val density = listOf("densityOverride", "density", "phomemoDensity").firstNotNullOfOrNull { intOf(map[it], it) }
        val widthBytes = listOf("widthBytes", "phomemoWidthBytes").firstNotNullOfOrNull { intOf(map[it], it) }
        return DriverOptions(
            feedLines = intOf(map["feedLines"], "feedLines") ?: defaults.feedLines,
            cut = boolOf(map["cut"], "cut") ?: defaults.cut,
            heatLevel = intOf(map["heatLevel"], "heatLevel") ?: defaults.heatLevel,
            bandHeight = intOf(map["bandHeight"], "bandHeight") ?: defaults.bandHeight,
            speed = intOf(map["speed"], "speed"),
            densityOverride = density,
            widthBytes = widthBytes,
        )
    }

    private fun intOf(value: Any?, name: String): Int? = when (value) {
        null -> null
        is Long -> value.toInt()
        is Double -> {
            require(value == Math.floor(value)) { "$name non e un intero: $value" }
            value.toInt()
        }
        else -> throw IllegalArgumentException("$name non e un numero: $value")
    }

    private fun boolOf(value: Any?, name: String): Boolean? = when (value) {
        null -> null
        is Boolean -> value
        else -> throw IllegalArgumentException("$name non e un booleano: $value")
    }

    private fun bytesOf(hex: String, index: Int): ByteArray {
        require(hex.length % 2 == 0) { "packetsHex[$index] ha un numero dispari di cifre" }
        return ByteArray(hex.length / 2) { i ->
            val pair = hex.substring(i * 2, i * 2 + 2)
            (pair.toIntOrNull(16) ?: throw IllegalArgumentException("packetsHex[$index]: \"$pair\" non e esadecimale")).toByte()
        }
    }

    /** Pattern di docs/DRIVERS.md, identici a quelli dei test JS. */
    private fun patternImage(pattern: String, width: Int, height: Int): BitImage {
        require(pattern in PATTERNS) { "pattern sconosciuto \"$pattern\" (ammessi: $PATTERNS)" }
        val img = BitImage(width, height)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val black = when (pattern) {
                    "checker8" -> ((x shr 3) + (y shr 3)) % 2 == 0
                    "diag" -> x % 64 == y % 64
                    "solid" -> true
                    else -> false
                }
                if (black) img[x, y] = true
            }
        }
        return img
    }

    // ---- confronto ----

    private fun concat(packets: List<ByteArray>): ByteArray {
        val out = ByteArray(packets.sumOf { it.size })
        var offset = 0
        for (p in packets) {
            p.copyInto(out, offset)
            offset += p.size
        }
        return out
    }

    /** Primo offset in cui i due flussi differiscono, -1 se sono uguali. */
    private fun firstDifference(a: ByteArray, b: ByteArray): Int {
        val n = minOf(a.size, b.size)
        for (i in 0 until n) if (a[i] != b[i]) return i
        return if (a.size == b.size) -1 else n
    }

    private fun hexAround(data: ByteArray, at: Int): String {
        val from = maxOf(0, at - 8)
        val to = minOf(data.size, at + 8)
        return (from until to).joinToString(" ") { i ->
            val h = "%02x".format(data[i].toInt() and 0xFF)
            if (i == at) "[$h]" else h
        }
    }

    /** Dimensioni dei pacchetti compresse: [2, 3, 4, 1160x3, 728, 3]. */
    private fun summary(sizes: List<Int>): String {
        val parts = ArrayList<String>()
        var i = 0
        while (i < sizes.size) {
            var j = i
            while (j + 1 < sizes.size && sizes[j + 1] == sizes[i]) j++
            parts += if (j > i) "${sizes[i]}x${j - i + 1}" else sizes[i].toString()
            i = j + 1
        }
        return parts.joinToString(", ", "[", "]")
    }

    private companion object {
        val PATTERNS = setOf("checker8", "diag", "solid", "empty")

        val OPTION_KEYS = setOf(
            "feedLines", "cut", "heatLevel", "bandHeight", "speed",
            "widthBytes", "phomemoWidthBytes", "densityOverride", "density", "phomemoDensity",
        )
    }
}

/**
 * JSON minimo per leggere i vettori condivisi senza dipendenze: oggetti (Map), array (List),
 * stringhe, numeri (Long se interi, altrimenti Double), true/false/null. Errori = IllegalStateException.
 */
private class MiniJson(private val text: String) {

    private var pos = 0

    fun parse(): Any? {
        val value = readValue()
        skipSpaces()
        check(pos == text.length) { "caratteri in piu alla posizione $pos" }
        return value
    }

    private fun readValue(): Any? {
        skipSpaces()
        check(pos < text.length) { "JSON troncato" }
        val c = text[pos]
        return when {
            c == '{' -> readObject()
            c == '[' -> readArray()
            c == '"' -> readString()
            c == '-' || c.isDigit() -> readNumber()
            text.startsWith("true", pos) -> {
                pos += 4
                true
            }
            text.startsWith("false", pos) -> {
                pos += 5
                false
            }
            text.startsWith("null", pos) -> {
                pos += 4
                null
            }
            else -> error("carattere inatteso '$c' alla posizione $pos")
        }
    }

    private fun readObject(): Map<String, Any?> {
        expect('{')
        val out = LinkedHashMap<String, Any?>()
        skipSpaces()
        if (peek() == '}') {
            pos++
            return out
        }
        while (true) {
            skipSpaces()
            val key = readString()
            skipSpaces()
            expect(':')
            out[key] = readValue()
            skipSpaces()
            when (peek()) {
                ',' -> pos++
                '}' -> {
                    pos++
                    return out
                }
                else -> error("atteso ',' o '}' alla posizione $pos")
            }
        }
    }

    private fun readArray(): List<Any?> {
        expect('[')
        val out = ArrayList<Any?>()
        skipSpaces()
        if (peek() == ']') {
            pos++
            return out
        }
        while (true) {
            out.add(readValue())
            skipSpaces()
            when (peek()) {
                ',' -> pos++
                ']' -> {
                    pos++
                    return out
                }
                else -> error("atteso ',' o ']' alla posizione $pos")
            }
        }
    }

    private fun readString(): String {
        expect('"')
        val out = StringBuilder()
        while (true) {
            check(pos < text.length) { "stringa non chiusa" }
            val c = text[pos++]
            when (c) {
                '"' -> return out.toString()
                '\\' -> {
                    check(pos < text.length) { "escape troncato" }
                    when (val e = text[pos++]) {
                        '"', '\\', '/' -> out.append(e)
                        'b' -> out.append('\b')
                        'f' -> out.append('\u000C')
                        'n' -> out.append('\n')
                        'r' -> out.append('\r')
                        't' -> out.append('\t')
                        'u' -> {
                            check(pos + 4 <= text.length) { "escape \\u troncato" }
                            val code = text.substring(pos, pos + 4).toIntOrNull(16) ?: error("escape \\u non valido alla posizione $pos")
                            out.append(Char(code))
                            pos += 4
                        }
                        else -> error("escape sconosciuto '\\$e' alla posizione $pos")
                    }
                }
                else -> out.append(c)
            }
        }
    }

    private fun readNumber(): Any {
        val start = pos
        if (peek() == '-') pos++
        while (pos < text.length && (text[pos].isDigit() || text[pos] in ".eE+-")) pos++
        val token = text.substring(start, pos)
        val isInteger = token.none { it == '.' || it == 'e' || it == 'E' }
        return if (isInteger) {
            token.toLongOrNull() ?: error("numero non valido \"$token\"")
        } else {
            token.toDoubleOrNull() ?: error("numero non valido \"$token\"")
        }
    }

    private fun skipSpaces() {
        while (pos < text.length && text[pos].isWhitespace()) pos++
    }

    private fun peek(): Char {
        check(pos < text.length) { "JSON troncato" }
        return text[pos]
    }

    private fun expect(c: Char) {
        check(peek() == c) { "atteso '$c' alla posizione $pos" }
        pos++
    }
}
