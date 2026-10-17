package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BacklightTest {

    /**
     * Scena con un soggetto ovale al centro (semiassi [rx] x larghezza e [ry] x altezza) e uno
     * sfondo; i valori dipendono dalla posizione, cosi si possono aggiungere trame o un orizzonte.
     */
    private fun scene(
        w: Int,
        h: Int,
        rx: Double = 0.3,
        ry: Double = 0.35,
        subject: (Int, Int) -> Int,
        background: (Int, Int) -> Int,
    ): GrayImage {
        val img = GrayImage(w, h)
        for (y in 0 until h) for (x in 0 until w) {
            val dx = (x + 0.5 - w / 2.0) / (rx * w)
            val dy = (y + 0.5 - h / 2.0) / (ry * h)
            img[x, y] = if (dx * dx + dy * dy <= 1.0) subject(x, y) else background(x, y)
        }
        return img
    }

    private fun flat(w: Int, h: Int, v: Int): GrayImage = GrayImage(w, h, ByteArray(w * h) { v.toByte() })

    @Test
    fun darkSubjectOnWhiteBackgroundIsStrongBacklight() {
        val img = scene(120, 160, subject = { x, y -> 40 + (x * 7 + y * 13) % 30 }, background = { x, y -> 225 + (x * 5 + y * 3) % 25 })
        val score = Backlight.score(img)
        assertTrue("controluce netto: $score", score >= 0.9f)
    }

    @Test
    fun documentedExampleScoresFull() {
        // bordo medio sopra 200, centro sotto 90: il soggetto copre tutta la zona centrale
        val img = scene(240, 320, rx = 0.43, ry = 0.43, subject = { _, _ -> 89 }, background = { _, _ -> 201 })
        assertEquals(1f, Backlight.score(img), 1e-6f)
    }

    @Test
    fun uniformScenesAreNotBacklit() {
        for (v in listOf(0, 30, 128, 230, 255)) {
            assertEquals("grigio $v", 0f, Backlight.score(flat(240, 320, v)), 0f)
        }
    }

    @Test
    fun brightSubjectOnDarkBackgroundIsNotBacklit() {
        val img = scene(240, 320, subject = { _, _ -> 220 }, background = { x, y -> 20 + (x + y) % 30 })
        assertEquals(0f, Backlight.score(img), 0f)
    }

    @Test
    fun darkSceneWithSlightlyBrighterBorderIsNotBacklit() {
        // notte o interno buio: il bordo e piu chiaro, ma non e uno sfondo luminoso
        val img = scene(240, 320, rx = 0.43, ry = 0.43, subject = { _, _ -> 40 }, background = { _, _ -> 100 })
        assertTrue(Backlight.score(img) < 0.1f)
    }

    @Test
    fun scoreGrowsAsTheSubjectGetsDarker() {
        var previous = -1f
        for (subject in listOf(220, 180, 150, 120, 90, 60)) {
            val img = scene(240, 320, rx = 0.43, ry = 0.43, subject = { _, _ -> subject }, background = { _, _ -> 230 })
            val score = Backlight.score(img)
            assertTrue("soggetto $subject: $score < $previous", score >= previous)
            previous = score
        }
        assertEquals(1f, previous, 1e-6f)
    }

    @Test
    fun whiteSkyCountsEvenWithDarkGround() {
        // meta alta cielo, meta bassa prato scuro: la media del bordo e bassa, la quota di bianco no
        val skyWhite = scene(240, 320, rx = 0.43, ry = 0.43, subject = { _, _ -> 50 }, background = { _, y -> if (y < 160) 250 else 90 })
        val skyGray = scene(240, 320, rx = 0.43, ry = 0.43, subject = { _, _ -> 50 }, background = { _, y -> if (y < 160) 215 else 90 })
        assertTrue("cielo bianco: ${Backlight.score(skyWhite)}", Backlight.score(skyWhite) >= 0.9f)
        assertTrue("cielo grigio: ${Backlight.score(skyGray)}", Backlight.score(skyGray) < 0.2f)
    }

    @Test
    fun tinyImagesNeverFail() {
        assertEquals(0f, Backlight.score(flat(1, 1, 0)), 0f)
        val sizes = listOf(1 to 7, 7 to 1, 2 to 2, 1 to 300, 300 to 1, 3 to 3)
        for ((w, h) in sizes) {
            val img = GrayImage(w, h, ByteArray(w * h) { (if (it % 3 == 0) 255 else 10).toByte() })
            val score = Backlight.score(img)
            assertTrue("${w}x$h: $score", score in 0f..1f)
        }
    }

    @Test
    fun scoreIsAlwaysInRange() {
        var seed = 12345L
        for (n in 0 until 20) {
            val w = 8 + n * 13
            val h = 5 + n * 17
            val img = GrayImage(w, h, ByteArray(w * h) {
                seed = (seed * 6364136223846793005L + 1442695040888963407L)
                (seed ushr 56).toByte()
            })
            val score = Backlight.score(img)
            assertTrue("${w}x$h: $score", score in 0f..1f)
        }
    }
}
