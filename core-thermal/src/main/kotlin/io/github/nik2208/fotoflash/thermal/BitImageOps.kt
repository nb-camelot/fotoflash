package io.github.nik2208.fotoflash.thermal

/*
 * Operazioni sulle immagini a 1 bit usate per comporre la stampa: foto retinate e testi
 * sogliati si disegnano separatamente e poi si sommano su un'unica BitImage.
 */

/**
 * Somma (OR) i punti neri di [src] in questa immagine, con l'angolo in alto a sinistra in
 * ([left], [top]). [src] puo uscire dai bordi da qualunque lato: la parte fuori viene tagliata.
 * I punti bianchi di [src] non cancellano nulla.
 */
fun BitImage.blit(src: BitImage, left: Int, top: Int) {
    val x0 = maxOf(0, left)
    val x1 = minOf(width, left + src.width)
    val y0 = maxOf(0, top)
    val y1 = minOf(height, top + src.height)
    if (x0 >= x1 || y0 >= y1) return
    val srcData = src.data
    for (y in y0 until y1) {
        val srcRow = (y - top) * src.bytesPerRow
        var x = x0
        while (x < x1) {
            val sx = x - left
            val b = srcData[srcRow + (sx ushr 3)].toInt() and 0xFF
            if (b == 0) {
                // byte sorgente tutto bianco: si salta al byte successivo
                x += 8 - (sx and 7)
                continue
            }
            if ((b and (0x80 ushr (sx and 7))) != 0) this[x, y] = true
            x++
        }
    }
}

/** Riempie [rect] di nero ([black] = true) o di bianco, tagliando cio che esce dall'immagine. */
fun BitImage.fillRect(rect: Rect, black: Boolean) {
    val x0 = maxOf(0, rect.left)
    val x1 = minOf(width, rect.right)
    val y0 = maxOf(0, rect.top)
    val y1 = minOf(height, rect.bottom)
    if (x0 >= x1 || y0 >= y1) return
    for (y in y0 until y1) {
        for (x in x0 until x1) this[x, y] = black
    }
}

/** Pixel ARGB (riga per riga, larghezza = [BitImage.width]) per mostrare o salvare la stampa. */
fun BitImage.toArgb(black: Int = 0xFF000000.toInt(), white: Int = 0xFFFFFFFF.toInt()): IntArray {
    val out = IntArray(width * height)
    for (y in 0 until height) {
        val row = y * bytesPerRow
        val outRow = y * width
        for (x in 0 until width) {
            val b = data[row + (x ushr 3)].toInt()
            out[outRow + x] = if ((b and (0x80 ushr (x and 7))) != 0) black else white
        }
    }
    return out
}

/** Copia indipendente dell'immagine. */
fun BitImage.copy(): BitImage {
    val out = BitImage(width, height)
    data.copyInto(out.data)
    return out
}

/** Numero di punti neri: misura quanta testina si scalda (e quanta carta si annerisce). */
fun BitImage.countBlack(): Int {
    var n = 0
    for (b in data) n += (b.toInt() and 0xFF).countOneBits()
    return n
}

/**
 * Converte pixel ARGB in 1 bit con una soglia secca: nero se luma < [threshold] e alpha >= 128.
 * Serve per testi e grafica gia in bianco e nero, non per le foto (quelle si retinano).
 */
fun bitImageFromArgb(width: Int, height: Int, argb: IntArray, threshold: Int = 128): BitImage {
    require(argb.size >= width * height) { "servono ${width * height} pixel ARGB, ricevuti ${argb.size}" }
    val out = BitImage(width, height)
    for (y in 0 until height) {
        val row = y * width
        for (x in 0 until width) {
            val c = argb[row + x]
            if ((c ushr 24) >= 128 && lumaOf(c) < threshold) out[x, y] = true
        }
    }
    return out
}
