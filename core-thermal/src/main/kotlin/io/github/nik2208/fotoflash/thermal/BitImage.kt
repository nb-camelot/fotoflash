package io.github.nik2208.fotoflash.thermal

/**
 * Immagine a 1 bit pronta per la testina termica.
 *
 * Le righe sono impacchettate MSB-first come le vuole il comando raster ESC/POS `GS v 0`:
 * il bit 7 del primo byte e il pixel piu a sinistra; un bit a 1 e un punto nero.
 */
class BitImage(val width: Int, val height: Int) {

    init {
        require(width > 0 && height > 0) { "dimensioni non valide: ${width}x$height" }
    }

    val bytesPerRow: Int = (width + 7) / 8
    val data: ByteArray = ByteArray(bytesPerRow * height)

    operator fun get(x: Int, y: Int): Boolean {
        val i = y * bytesPerRow + (x ushr 3)
        return (data[i].toInt() and (0x80 ushr (x and 7))) != 0
    }

    operator fun set(x: Int, y: Int, black: Boolean) {
        val i = y * bytesPerRow + (x ushr 3)
        val mask = 0x80 ushr (x and 7)
        data[i] = if (black) {
            (data[i].toInt() or mask).toByte()
        } else {
            (data[i].toInt() and mask.inv()).toByte()
        }
    }

    /** Copia le righe [fromRow, fromRow + rows) in un nuovo array, per inviare l'immagine a bande. */
    fun rowsSlice(fromRow: Int, rows: Int): ByteArray {
        require(fromRow >= 0 && rows > 0 && fromRow + rows <= height) { "bande fuori range" }
        return data.copyOfRange(fromRow * bytesPerRow, (fromRow + rows) * bytesPerRow)
    }
}
