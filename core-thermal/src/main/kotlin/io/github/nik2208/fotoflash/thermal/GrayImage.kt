package io.github.nik2208.fotoflash.thermal

/**
 * Immagine in scala di grigi: un byte per pixel, letto SENZA segno.
 * 0 = nero, 255 = bianco (come la carta: il bianco e lo sfondo, il nero e cio che la testina scalda).
 *
 * Gli accessori [get]/[set] non controllano i limiti, per restare veloci nei cicli: gli algoritmi
 * del modulo lavorano direttamente su [pixels].
 */
class GrayImage(
    val width: Int,
    val height: Int,
    // dimensioni non valide -> array vuoto, cosi l'errore resta l'IllegalArgumentException di init
    val pixels: ByteArray = ByteArray(if (width > 0 && height > 0) width * height else 0) { 0xFF.toByte() },
) {

    init {
        require(width > 0 && height > 0) { "dimensioni non valide: ${width}x$height" }
        require(pixels.size == width * height) {
            "servono ${width * height} pixel per ${width}x$height, ricevuti ${pixels.size}"
        }
    }

    /** Luminanza del pixel, 0..255. */
    operator fun get(x: Int, y: Int): Int = pixels[y * width + x].toInt() and 0xFF

    /** Imposta la luminanza; i valori fuori range vengono riportati in 0..255. */
    operator fun set(x: Int, y: Int, value: Int) {
        pixels[y * width + x] = value.coerceIn(0, 255).toByte()
    }

    /** Copia indipendente: modificarla non tocca l'originale. */
    fun copy(): GrayImage = GrayImage(width, height, pixels.copyOf())

    /** Istogramma delle luminanze: 256 contatori. */
    fun histogram(): IntArray {
        val hist = IntArray(256)
        for (b in pixels) hist[b.toInt() and 0xFF]++
        return hist
    }

    /** Luminanza media, utile per diagnosi e test. */
    fun mean(): Double {
        var sum = 0L
        for (b in pixels) sum += (b.toInt() and 0xFF)
        return sum.toDouble() / pixels.size
    }

    companion object {
        /**
         * Converte pixel ARGB (come quelli di Bitmap.getPixels) in grigi.
         * L'alpha viene composta su bianco: un PNG trasparente diventa carta, non inchiostro.
         */
        fun fromArgb(width: Int, height: Int, argb: IntArray): GrayImage {
            val n = width * height
            require(argb.size >= n) { "servono $n pixel ARGB, ricevuti ${argb.size}" }
            val out = ByteArray(n)
            for (i in 0 until n) {
                val c = argb[i]
                val a = c ushr 24
                val l = lumaOf(c)
                // composizione su bianco: l*a + 255*(1-a), arrotondata
                val v = if (a == 255) l else (l * a + 255 * (255 - a) + 127) / 255
                out[i] = v.toByte()
            }
            return GrayImage(width, height, out)
        }

        /** Sfumatura orizzontale da nero (a sinistra) a bianco (a destra): per test e calibrazione. */
        fun gradient(width: Int, height: Int): GrayImage {
            val out = ByteArray(width * height)
            for (x in 0 until width) {
                val v = if (width == 1) 0 else x * 255 / (width - 1)
                for (y in 0 until height) out[y * width + x] = v.toByte()
            }
            return GrayImage(width, height, out)
        }
    }
}

/** Luma Rec.601 intera e arrotondata (0.299 R + 0.587 G + 0.114 B), alpha ignorata. */
internal fun lumaOf(argb: Int): Int {
    val r = (argb shr 16) and 0xFF
    val g = (argb shr 8) and 0xFF
    val b = argb and 0xFF
    return (r * 299 + g * 587 + b * 114 + 500) / 1000
}
