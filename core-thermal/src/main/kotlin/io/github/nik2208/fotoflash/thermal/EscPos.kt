package io.github.nik2208.fotoflash.thermal

import java.nio.charset.Charset

/**
 * Costruttore di comandi ESC/POS (sottoinsieme supportato dalle stampanti termiche da 58/80 mm
 * economiche). Ogni metodo accoda byte e restituisce il builder, per concatenare le chiamate.
 *
 * Nota: la dimensione dei caratteri si imposta con GS ! (0x1D 0x21). ESC ! (0x1B 0x21) e il
 * "print mode" con un'altra codifica dei bit: usarlo per le dimensioni da caratteri sbagliati.
 */
class EscPosBuilder {

    private var buf = ByteArray(64)
    private var count = 0

    /** Byte accodati finora. */
    val size: Int
        get() = count

    /** ESC @: azzera la stampante (modo testo, allineamento, dimensioni). */
    fun init(): EscPosBuilder = raw(ESC, 0x40)

    /** ESC t n: tabella caratteri. Il numero dipende dal firmware (spesso 16 = WPC1252). */
    fun codepage(n: Int): EscPosBuilder = raw(ESC, 0x74, n.coerceIn(0, 255))

    /** ESC a n: 0 sinistra, 1 centro, 2 destra. */
    fun align(align: TextAlign): EscPosBuilder = raw(
        ESC,
        0x61,
        when (align) {
            TextAlign.START -> 0
            TextAlign.CENTER -> 1
            TextAlign.END -> 2
        },
    )

    /** ESC E n: grassetto. */
    fun bold(on: Boolean): EscPosBuilder = raw(ESC, 0x45, if (on) 1 else 0)

    /** GS ! n: moltiplicatori di larghezza e altezza 1..8, n = ((w-1) shl 4) or (h-1). */
    fun size(width: Int, height: Int): EscPosBuilder {
        val w = width.coerceIn(1, 8) - 1
        val h = height.coerceIn(1, 8) - 1
        return raw(GS, 0x21, (w shl 4) or h)
    }

    /** Testo codificato con [charset]; i caratteri non rappresentabili diventano '?'. */
    fun text(s: String, charset: Charset = Charsets.ISO_8859_1): EscPosBuilder = append(s.toByteArray(charset))

    /** Testo seguito da LF. */
    fun line(s: String = ""): EscPosBuilder = text(s).raw(LF)

    /** ESC d n: stampa il buffer e avanza di n righe (0..255). */
    fun feed(lines: Int): EscPosBuilder = raw(ESC, 0x64, lines.coerceIn(0, 255))

    /**
     * GS V m 0 (funzione B): avanza fino alla taglierina e taglia.
     * [partial] = true -> m = 66 (taglio parziale), false -> m = 65 (taglio completo).
     */
    fun cut(partial: Boolean = true): EscPosBuilder = raw(GS, 0x56, if (partial) 66 else 65, 0)

    /**
     * ESC 7 n1 n2 n3: punti scaldati insieme, tempo di riscaldamento, intervallo (0..255).
     * Tempi piu lunghi = neri piu pieni ma stampa piu lenta e piu assorbimento.
     */
    fun heat(heat: HeatSettings): EscPosBuilder = raw(
        ESC,
        0x37,
        heat.maxDots.coerceIn(0, 255),
        heat.heatTime.coerceIn(0, 255),
        heat.heatInterval.coerceIn(0, 255),
    )

    /**
     * Immagine raster a bande di [bandHeight] righe (1..255), un comando GS v 0 per banda:
     * le stampanti con buffer piccolo reggono meglio tanti comandi corti che uno lungo.
     */
    fun raster(image: BitImage, bandHeight: Int = 24): EscPosBuilder {
        val band = bandHeight.coerceIn(1, 255)
        var row = 0
        while (row < image.height) {
            val rows = minOf(band, image.height - row)
            append(EscPosRaster.band(image, row, rows))
            row += rows
        }
        return this
    }

    /** Byte grezzi; ogni valore viene troncato a 8 bit. */
    fun raw(vararg bytes: Int): EscPosBuilder {
        ensure(bytes.size)
        for (b in bytes) buf[count++] = b.toByte()
        return this
    }

    /** Accoda un blocco di byte gia pronto (per esempio una banda raster). */
    fun append(data: ByteArray): EscPosBuilder {
        ensure(data.size)
        data.copyInto(buf, count)
        count += data.size
        return this
    }

    /** Copia dei byte accodati. */
    fun bytes(): ByteArray = buf.copyOf(count)

    private fun ensure(extra: Int) {
        val needed = count + extra
        if (needed > buf.size) buf = buf.copyOf(maxOf(needed, buf.size * 2))
    }

    private companion object {
        const val ESC = 0x1B
        const val GS = 0x1D
        const val LF = 0x0A
    }
}

/** Comando raster ESC/POS GS v 0. */
object EscPosRaster {

    /** Lunghezza dell'intestazione di ogni banda: GS v 0 m xL xH yL yH. */
    const val HEADER_SIZE = 8

    /**
     * Una banda: GS v 0 m=0 xL xH yL yH seguita dalle righe [fromRow, fromRow + rows) di [image].
     * x = byte per riga, y = righe della banda, entrambi little-endian.
     */
    fun band(image: BitImage, fromRow: Int, rows: Int): ByteArray {
        require(fromRow >= 0 && rows > 0 && fromRow + rows <= image.height) {
            "banda fuori range: righe $fromRow+$rows su ${image.height}"
        }
        require(rows <= 0xFFFF && image.bytesPerRow <= 0xFFFF) { "banda troppo grande" }
        val payload = image.rowsSlice(fromRow, rows)
        val out = ByteArray(HEADER_SIZE + payload.size)
        out[0] = 0x1D
        out[1] = 0x76
        out[2] = 0x30
        out[3] = 0x00
        out[4] = (image.bytesPerRow and 0xFF).toByte()
        out[5] = ((image.bytesPerRow shr 8) and 0xFF).toByte()
        out[6] = (rows and 0xFF).toByte()
        out[7] = ((rows shr 8) and 0xFF).toByte()
        payload.copyInto(out, HEADER_SIZE)
        return out
    }
}
