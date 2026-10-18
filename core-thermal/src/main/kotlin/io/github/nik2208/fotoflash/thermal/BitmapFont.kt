package io.github.nik2208.fotoflash.thermal

import java.text.Normalizer

/**
 * Font bitmap 5x7 per l'ASCII stampabile (32..126), in puro Kotlin, per le pagine di prova raster.
 *
 * Perche serve: la Phomemo M02 Pro non ha font ESC/POS affidabili, quindi la sua pagina di prova
 * (e quella raster degli altri driver) disegna i testi punto per punto. Niente font di sistema e
 * niente Android: lo stesso testo produce sempre gli stessi punti, su JVM e sul telefono.
 *
 * Ogni glifo e una cella di 5 colonne per 7 righe; tra due glifi c'e una colonna vuota
 * ([SPACING]). Il fattore di scala ingrandisce ogni punto in un quadrato scala x scala
 * (x2 a 203 dpi e x3 a 300 dpi danno circa la stessa altezza sulla carta, 1,7-1,8 mm).
 *
 * I testi passano da [normalize]: accenti tolti (e accentata -> e), spazi speciali e punteggiatura
 * tipografica ricondotti all'ASCII, tutto il resto diventa "?".
 */
object BitmapFont {

    /** Colonne di un glifo. */
    const val GLYPH_WIDTH = 5

    /** Righe di un glifo. */
    const val GLYPH_HEIGHT = 7

    /** Colonne vuote tra due glifi (prima della scala). */
    const val SPACING = 1

    /** Primo e ultimo carattere disegnabile. */
    const val FIRST_CHAR = 32
    const val LAST_CHAR = 126

    /** Carattere usato al posto di quelli che il font non ha. */
    const val REPLACEMENT = '?'

    /**
     * Glifi per colonne, 5 byte per carattere da [FIRST_CHAR] a [LAST_CHAR]: il bit 0 di ogni
     * byte e la riga in alto, il bit 6 quella in basso (il bit 7 non si usa). E la tabella 5x7
     * classica dei display a caratteri, con le minuscole compresse nelle stesse 7 righe.
     */
    private val GLYPHS = intArrayOf(
        0x00, 0x00, 0x00, 0x00, 0x00, // 32 spazio
        0x00, 0x00, 0x5F, 0x00, 0x00, // 33 !
        0x00, 0x07, 0x00, 0x07, 0x00, // 34 "
        0x14, 0x7F, 0x14, 0x7F, 0x14, // 35 #
        0x24, 0x2A, 0x7F, 0x2A, 0x12, // 36 $
        0x23, 0x13, 0x08, 0x64, 0x62, // 37 %
        0x36, 0x49, 0x55, 0x22, 0x50, // 38 &
        0x00, 0x05, 0x03, 0x00, 0x00, // 39 '
        0x00, 0x1C, 0x22, 0x41, 0x00, // 40 (
        0x00, 0x41, 0x22, 0x1C, 0x00, // 41 )
        0x14, 0x08, 0x3E, 0x08, 0x14, // 42 *
        0x08, 0x08, 0x3E, 0x08, 0x08, // 43 +
        0x00, 0x50, 0x30, 0x00, 0x00, // 44 ,
        0x08, 0x08, 0x08, 0x08, 0x08, // 45 -
        0x00, 0x60, 0x60, 0x00, 0x00, // 46 .
        0x20, 0x10, 0x08, 0x04, 0x02, // 47 /
        0x3E, 0x51, 0x49, 0x45, 0x3E, // 48 0
        0x00, 0x42, 0x7F, 0x40, 0x00, // 49 1
        0x42, 0x61, 0x51, 0x49, 0x46, // 50 2
        0x21, 0x41, 0x45, 0x4B, 0x31, // 51 3
        0x18, 0x14, 0x12, 0x7F, 0x10, // 52 4
        0x27, 0x45, 0x45, 0x45, 0x39, // 53 5
        0x3C, 0x4A, 0x49, 0x49, 0x30, // 54 6
        0x01, 0x71, 0x09, 0x05, 0x03, // 55 7
        0x36, 0x49, 0x49, 0x49, 0x36, // 56 8
        0x06, 0x49, 0x49, 0x29, 0x1E, // 57 9
        0x00, 0x36, 0x36, 0x00, 0x00, // 58 :
        0x00, 0x56, 0x36, 0x00, 0x00, // 59 ;
        0x08, 0x14, 0x22, 0x41, 0x00, // 60 <
        0x14, 0x14, 0x14, 0x14, 0x14, // 61 =
        0x00, 0x41, 0x22, 0x14, 0x08, // 62 >
        0x02, 0x01, 0x51, 0x09, 0x06, // 63 ?
        0x32, 0x49, 0x79, 0x41, 0x3E, // 64 @
        0x7E, 0x11, 0x11, 0x11, 0x7E, // 65 A
        0x7F, 0x49, 0x49, 0x49, 0x36, // 66 B
        0x3E, 0x41, 0x41, 0x41, 0x22, // 67 C
        0x7F, 0x41, 0x41, 0x22, 0x1C, // 68 D
        0x7F, 0x49, 0x49, 0x49, 0x41, // 69 E
        0x7F, 0x09, 0x09, 0x09, 0x01, // 70 F
        0x3E, 0x41, 0x49, 0x49, 0x7A, // 71 G
        0x7F, 0x08, 0x08, 0x08, 0x7F, // 72 H
        0x00, 0x41, 0x7F, 0x41, 0x00, // 73 I
        0x20, 0x40, 0x41, 0x3F, 0x01, // 74 J
        0x7F, 0x08, 0x14, 0x22, 0x41, // 75 K
        0x7F, 0x40, 0x40, 0x40, 0x40, // 76 L
        0x7F, 0x02, 0x0C, 0x02, 0x7F, // 77 M
        0x7F, 0x04, 0x08, 0x10, 0x7F, // 78 N
        0x3E, 0x41, 0x41, 0x41, 0x3E, // 79 O
        0x7F, 0x09, 0x09, 0x09, 0x06, // 80 P
        0x3E, 0x41, 0x51, 0x21, 0x5E, // 81 Q
        0x7F, 0x09, 0x19, 0x29, 0x46, // 82 R
        0x46, 0x49, 0x49, 0x49, 0x31, // 83 S
        0x01, 0x01, 0x7F, 0x01, 0x01, // 84 T
        0x3F, 0x40, 0x40, 0x40, 0x3F, // 85 U
        0x1F, 0x20, 0x40, 0x20, 0x1F, // 86 V
        0x3F, 0x40, 0x38, 0x40, 0x3F, // 87 W
        0x63, 0x14, 0x08, 0x14, 0x63, // 88 X
        0x07, 0x08, 0x70, 0x08, 0x07, // 89 Y
        0x61, 0x51, 0x49, 0x45, 0x43, // 90 Z
        0x00, 0x7F, 0x41, 0x41, 0x00, // 91 [
        0x02, 0x04, 0x08, 0x10, 0x20, // 92 barra rovescia
        0x00, 0x41, 0x41, 0x7F, 0x00, // 93 ]
        0x04, 0x02, 0x01, 0x02, 0x04, // 94 ^
        0x40, 0x40, 0x40, 0x40, 0x40, // 95 _
        0x00, 0x01, 0x02, 0x04, 0x00, // 96 `
        0x20, 0x54, 0x54, 0x54, 0x78, // 97 a
        0x7F, 0x48, 0x44, 0x44, 0x38, // 98 b
        0x38, 0x44, 0x44, 0x44, 0x20, // 99 c
        0x38, 0x44, 0x44, 0x48, 0x7F, // 100 d
        0x38, 0x54, 0x54, 0x54, 0x18, // 101 e
        0x08, 0x7E, 0x09, 0x01, 0x02, // 102 f
        0x0C, 0x52, 0x52, 0x52, 0x3E, // 103 g
        0x7F, 0x08, 0x04, 0x04, 0x78, // 104 h
        0x00, 0x44, 0x7D, 0x40, 0x00, // 105 i
        0x20, 0x40, 0x44, 0x3D, 0x00, // 106 j
        0x7F, 0x10, 0x28, 0x44, 0x00, // 107 k
        0x00, 0x41, 0x7F, 0x40, 0x00, // 108 l
        0x7C, 0x04, 0x18, 0x04, 0x78, // 109 m
        0x7C, 0x08, 0x04, 0x04, 0x78, // 110 n
        0x38, 0x44, 0x44, 0x44, 0x38, // 111 o
        0x7C, 0x14, 0x14, 0x14, 0x08, // 112 p
        0x08, 0x14, 0x14, 0x18, 0x7C, // 113 q
        0x7C, 0x08, 0x04, 0x04, 0x08, // 114 r
        0x48, 0x54, 0x54, 0x54, 0x20, // 115 s
        0x04, 0x3F, 0x44, 0x40, 0x20, // 116 t
        0x3C, 0x40, 0x40, 0x20, 0x7C, // 117 u
        0x1C, 0x20, 0x40, 0x20, 0x1C, // 118 v
        0x3C, 0x40, 0x30, 0x40, 0x3C, // 119 w
        0x44, 0x28, 0x10, 0x28, 0x44, // 120 x
        0x0C, 0x50, 0x50, 0x50, 0x3C, // 121 y
        0x44, 0x64, 0x54, 0x4C, 0x44, // 122 z
        0x00, 0x08, 0x36, 0x41, 0x00, // 123 {
        0x00, 0x00, 0x7F, 0x00, 0x00, // 124 |
        0x00, 0x41, 0x36, 0x08, 0x00, // 125 }
        0x08, 0x04, 0x08, 0x10, 0x08, // 126 ~
    )

    init {
        // Una riga mancante o in piu sfaserebbe tutti i glifi successivi: meglio accorgersene subito.
        check(GLYPHS.size == (LAST_CHAR - FIRST_CHAR + 1) * GLYPH_WIDTH) { "tabella dei glifi incompleta" }
    }

    /** true se il carattere ha un glifo (ASCII 32..126). */
    fun supports(c: Char): Boolean = c.code in FIRST_CHAR..LAST_CHAR

    /**
     * Punto ([col], [row]) del glifo di [c]: col 0..4, row 0..6. I caratteri senza glifo usano
     * quello di [REPLACEMENT]; fuori dalla cella il punto e bianco.
     */
    fun pixel(c: Char, col: Int, row: Int): Boolean {
        if (col !in 0 until GLYPH_WIDTH || row !in 0 until GLYPH_HEIGHT) return false
        val code = if (supports(c)) c.code else REPLACEMENT.code
        val bits = GLYPHS[(code - FIRST_CHAR) * GLYPH_WIDTH + col]
        return ((bits ushr row) and 1) != 0
    }

    /** Passo orizzontale di un carattere, spaziatura compresa, in punti. */
    fun advance(scale: Int = 1): Int = (GLYPH_WIDTH + SPACING) * scale.coerceAtLeast(1)

    /** Altezza di una riga di testo in punti (senza interlinea). */
    fun lineHeight(scale: Int = 1): Int = GLYPH_HEIGHT * scale.coerceAtLeast(1)

    /** Larghezza in punti di [text] gia normalizzato o no (senza la spaziatura dopo l'ultimo glifo). */
    fun textWidth(text: String, scale: Int = 1): Int {
        val n = normalize(text).length
        if (n == 0) return 0
        val s = scale.coerceAtLeast(1)
        return n * advance(s) - SPACING * s
    }

    /**
     * Disegna [text] su una riga in [target], con l'angolo in alto a sinistra in ([left], [top]).
     * Somma i punti neri (come [blit]) e taglia cio che esce dall'immagine.
     * Restituisce la larghezza disegnata, come [textWidth].
     */
    fun draw(target: BitImage, text: String, left: Int, top: Int, scale: Int = 1): Int {
        val s = scale.coerceAtLeast(1)
        val line = normalize(text)
        var x0 = left
        for (c in line) {
            for (col in 0 until GLYPH_WIDTH) {
                for (row in 0 until GLYPH_HEIGHT) {
                    if (pixel(c, col, row)) fillDot(target, x0 + col * s, top + row * s, s)
                }
            }
            x0 += advance(s)
        }
        return if (line.isEmpty()) 0 else line.length * advance(s) - SPACING * s
    }

    /** [text] su un'immagine larga quanto serve (almeno 1 punto) e alta [lineHeight]. */
    fun render(text: String, scale: Int = 1): BitImage {
        val s = scale.coerceAtLeast(1)
        val out = BitImage(textWidth(text, s).coerceAtLeast(1), lineHeight(s))
        draw(out, text, 0, 0, s)
        return out
    }

    /**
     * Va a capo per parole entro [maxWidth] punti; le parole piu lunghe di una riga si spezzano.
     * I "\n" del testo separano i paragrafi; le righe restituite sono gia normalizzate.
     */
    fun wrap(text: String, maxWidth: Int, scale: Int = 1): List<String> {
        val s = scale.coerceAtLeast(1)
        // almeno un carattere per riga, anche con una larghezza assurda
        val columns = ((maxWidth + SPACING * s) / advance(s)).coerceAtLeast(1)
        val lines = ArrayList<String>()
        for (paragraph in text.split('\n')) {
            var current = StringBuilder()
            for (rawWord in normalize(paragraph).split(' ')) {
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
            if (current.isNotEmpty()) lines += current.toString()
        }
        return lines
    }

    /**
     * Riduce un testo all'ASCII che il font sa disegnare: toglie gli accenti (NFD + segni
     * combinanti), trasforma spazi e a capo in spazi, converte la punteggiatura tipografica e
     * sostituisce il resto con [REPLACEMENT]. Vale anche per testi non nostri (nomi di stampanti).
     */
    fun normalize(text: String): String {
        val decomposed = Normalizer.normalize(text, Normalizer.Form.NFD)
        val out = StringBuilder(decomposed.length)
        for (c in decomposed) {
            when {
                supports(c) -> out.append(c)
                Character.getType(c) == Character.NON_SPACING_MARK.toInt() -> Unit
                Character.isWhitespace(c) || Character.isSpaceChar(c) -> out.append(' ')
                c == '‘' || c == '’' -> out.append('\'')
                c == '“' || c == '”' || c == '«' || c == '»' -> out.append('"')
                c == '–' || c == '—' -> out.append('-')
                c == '…' -> out.append("...")
                c == '·' || c == '•' -> out.append('-')
                c == '→' -> out.append("->")
                c == 'ß' -> out.append("ss")
                c == 'Æ' -> out.append("AE")
                c == 'æ' -> out.append("ae")
                c == 'Œ' -> out.append("OE")
                c == 'œ' -> out.append("oe")
                c == 'Ø' -> out.append('O')
                c == 'ø' -> out.append('o')
                c == '€' -> out.append("EUR")
                c == '°' -> out.append('o')
                else -> out.append(REPLACEMENT)
            }
        }
        return out.toString()
    }

    /** Un punto del glifo ingrandito: quadrato [size] x [size], tagliato ai bordi di [target]. */
    private fun fillDot(target: BitImage, x: Int, y: Int, size: Int) {
        val x0 = maxOf(0, x)
        val x1 = minOf(target.width, x + size)
        val y0 = maxOf(0, y)
        val y1 = minOf(target.height, y + size)
        for (yy in y0 until y1) {
            for (xx in x0 until x1) target[xx, yy] = true
        }
    }
}
