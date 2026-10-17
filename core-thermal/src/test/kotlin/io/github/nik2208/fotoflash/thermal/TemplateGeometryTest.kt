package io.github.nik2208.fotoflash.thermal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class TemplateGeometryTest {

    private val empty = TemplateTexts()

    private val full = TemplateTexts(
        caption = "Ciao mamma!",
        eventTitle = "Festa di Leo",
        hashtag = "festa2026",
        dateText = "17/10/2026 15:42",
        printNumber = 42,
    )

    private val long = TemplateTexts(
        caption = "Il compleanno piu bello di sempre con tutti",
        eventTitle = "Matrimonio di Anna e Marco a Villa Bellavista",
        hashtag = "#unhashtagdavverolunghissimoesenzaspazi2026",
        dateText = "sabato 17 ottobre 2026 alle 15:42:10",
        printNumber = 123456,
    )

    private val blank = TemplateTexts(caption = "   ", eventTitle = "\n\t", hashtag = " ", dateText = "  ", printNumber = null)

    private val allTexts = listOf(empty, full, long, blank)

    private fun overlaps(a: Rect, b: Rect): Boolean =
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

    private fun inside(r: Rect, layout: TemplateLayout): Boolean =
        r.left >= 0 && r.top >= 0 && r.right <= layout.width && r.bottom <= layout.height && r.width > 0 && r.height > 0

    /** Invarianti comuni a ogni impaginazione. */
    private fun assertValid(kind: TemplateKind, layout: TemplateLayout, what: String) {
        val rects = layout.photos + layout.texts.map { it.rect }
        for (r in rects) assertTrue("$what: $r fuori dal foglio ${layout.width}x${layout.height}", inside(r, layout))
        for (i in rects.indices) for (j in i + 1 until rects.size) {
            assertFalse("$what: ${rects[i]} si sovrappone a ${rects[j]}", overlaps(rects[i], rects[j]))
        }
        for (d in layout.decorations) {
            if (d is Decoration.DashedLine) {
                assertTrue("$what: riga fuori dal foglio", d.y >= 0 && d.y + d.thickness <= layout.height)
                assertTrue("$what: riga fuori larghezza", d.from >= 0 && d.to <= layout.width && d.from < d.to)
                val band = Rect(d.from, d.y, d.to - d.from, d.thickness)
                for (r in rects) assertFalse("$what: riga tratteggiata su $r", overlaps(band, r))
            }
        }
        for (t in layout.texts) {
            assertTrue("$what: corpo ${t.sizeDots}", t.sizeDots > 0)
            assertTrue("$what: blocco basso per corpo ${t.sizeDots}", t.rect.height >= t.sizeDots)
            assertTrue(
                "$what: '${t.text}' non sta in ${t.rect.width}",
                TextMetrics.width(t.text, t.font, t.sizeDots) <= t.rect.width,
            )
        }
        // niente spazio morto in fondo: l'ultimo elemento e vicino al bordo inferiore
        // (la Polaroid centra i testi nella sua fascia bassa, quindi sotto resta un po' di carta)
        val lastBottom = rects.maxOf { it.bottom }
        val tail = layout.height - lastBottom
        val base = if (kind == TemplateKind.POLAROID) 48 else 16
        val maxTail = if (layout.width == 576) base * 3 / 2 else base
        assertTrue("$what: $tail punti vuoti in fondo", tail in 0..maxTail)
    }

    @Test
    fun everyTemplateIsValidOnBothPapers() {
        for (kind in TemplateKind.entries) {
            for (paper in PaperWidth.entries) {
                for ((i, texts) in allTexts.withIndex()) {
                    for (count in listOf(0, 1, 3, 4, 9)) {
                        val layout = TemplateGeometry.layout(kind, paper, count, texts)
                        assertEquals(paper.dots, layout.width)
                        assertValid(kind, layout, "$kind $paper testi#$i foto=$count")
                    }
                }
            }
        }
    }

    @Test
    fun polaroidWithoutTextsIsASquareWithEqualMargins() {
        val layout = TemplateGeometry.layout(TemplateKind.POLAROID, PaperWidth.MM58, 1, empty)
        assertEquals(listOf(Rect(16, 16, 352, 352)), layout.photos)
        assertEquals(384, layout.height)
        assertTrue(layout.texts.isEmpty())
        assertTrue("nessuna cornice: il bordo e la carta", layout.decorations.isEmpty())
    }

    @Test
    fun polaroidBandHoldsCaptionAndDate() {
        val layout = TemplateGeometry.layout(TemplateKind.POLAROID, PaperWidth.MM58, 3, full)
        assertEquals(listOf(Rect(16, 16, 352, 352)), layout.photos)
        val photoBottom = layout.photos[0].bottom
        assertTrue("fascia bassa >= 96", layout.height - photoBottom >= 96)
        assertEquals(listOf(TextRole.CAPTION, TextRole.DATE), layout.texts.map { it.role })
        val caption = layout.texts[0]
        assertEquals("Ciao mamma!", caption.text)
        assertEquals(FontRole.MONO_BOLD, caption.font)
        assertEquals(28, caption.sizeDots)
        assertEquals(TextAlign.CENTER, caption.align)
        val date = layout.texts[1]
        assertEquals(FontRole.MONO, date.font)
        assertEquals(20, date.sizeDots)
        // i testi sono centrati nella fascia
        val above = caption.rect.top - photoBottom
        val below = layout.height - date.rect.bottom
        assertTrue("sopra $above, sotto $below", abs(above - below) <= 1)
        assertTrue(layout.decorations.isEmpty())
    }

    @Test
    fun fullIsEdgeToEdgeThreeByFour() {
        val bare = TemplateGeometry.layout(TemplateKind.FULL, PaperWidth.MM58, 1, empty)
        assertEquals(listOf(Rect(0, 0, 384, 512)), bare.photos)
        assertEquals(512, bare.height)
        val withTexts = TemplateGeometry.layout(TemplateKind.FULL, PaperWidth.MM58, 1, full)
        assertEquals(listOf(Rect(0, 0, 384, 512)), withTexts.photos)
        assertEquals(listOf(TextRole.CAPTION, TextRole.DATE), withTexts.texts.map { it.role })
        assertTrue(withTexts.texts[0].rect.top >= 512)
    }

    @Test
    fun stripStacksFourByThreePhotosWithGaps() {
        val layout = TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM58, 3, full)
        assertEquals(3, layout.photos.size)
        for (p in layout.photos) {
            assertEquals(16, p.left)
            assertEquals(352, p.width)
            assertEquals(264, p.height)
        }
        for (i in 1 until 3) assertEquals(12, layout.photos[i].top - layout.photos[i - 1].bottom)
        val title = layout.texts.first()
        assertEquals(TextRole.EVENT_TITLE, title.role)
        assertEquals(FontRole.DISPLAY, title.font)
        assertEquals(40, title.sizeDots)
        assertTrue(title.rect.bottom <= layout.photos[0].top)
        val footer = layout.texts.filter { it.rect.top >= layout.photos.last().bottom }.map { it.role }
        assertEquals(listOf(TextRole.CAPTION, TextRole.DATE, TextRole.HASHTAG), footer)
        assertEquals("#festa2026", layout.texts.first { it.role == TextRole.HASHTAG }.text)
    }

    @Test
    fun stripPhotoCountIsClamped() {
        assertEquals(1, TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM58, 0, empty).photos.size)
        assertEquals(1, TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM58, -3, empty).photos.size)
        assertEquals(4, TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM58, 4, empty).photos.size)
        assertEquals(4, TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM58, 9, empty).photos.size)
        assertEquals(4, TemplateGeometry.photoCount(TemplateKind.STRIP, 9))
        assertEquals(1, TemplateGeometry.photoCount(TemplateKind.POLAROID, 3))
    }

    @Test
    fun singlePhotoTemplatesIgnorePhotoCount() {
        for (kind in listOf(TemplateKind.POLAROID, TemplateKind.FULL, TemplateKind.RECEIPT)) {
            assertEquals(1, TemplateGeometry.layout(kind, PaperWidth.MM58, 4, full).photos.size)
        }
    }

    @Test
    fun receiptHasSectionsSeparatedByDashedLines() {
        val layout = TemplateGeometry.layout(TemplateKind.RECEIPT, PaperWidth.MM58, 1, full)
        assertEquals(listOf(Rect(16, 146, 352, 352)), layout.photos)
        assertEquals(
            listOf(
                TextRole.BRAND, TextRole.EVENT_TITLE, TextRole.CAPTION, TextRole.HASHTAG,
                TextRole.PRINT_NUMBER, TextRole.DATE, TextRole.FOOTER,
            ),
            layout.texts.map { it.role },
        )
        val brand = layout.texts.first { it.role == TextRole.BRAND }
        assertEquals(TemplateGeometry.BRAND_TEXT, brand.text)
        assertEquals(FontRole.DISPLAY, brand.font)
        assertEquals(48, brand.sizeDots)
        assertEquals("N. 0042", layout.texts.first { it.role == TextRole.PRINT_NUMBER }.text)
        val footer = layout.texts.last()
        assertEquals(TextRole.FOOTER, footer.role)
        assertEquals("", footer.text)
        val lines = layout.decorations.filterIsInstance<Decoration.DashedLine>()
        assertEquals(3, lines.size)
        // una riga tra intestazione e foto, una tra note e dati, una prima del piede
        assertTrue(lines[0].y < layout.photos[0].top)
        assertTrue(lines[1].y > layout.photos[0].bottom)
        assertTrue(lines[2].y < footer.rect.top)
        assertEquals(702, layout.height)
    }

    @Test
    fun receiptWithoutOptionalTextsKeepsBrandAndFooterOnly() {
        val layout = TemplateGeometry.layout(TemplateKind.RECEIPT, PaperWidth.MM58, 1, empty)
        assertEquals(listOf(TextRole.BRAND, TextRole.FOOTER), layout.texts.map { it.role })
        // niente sezione vuota: due righe soltanto, mai due di fila
        assertEquals(2, layout.decorations.size)
        assertEquals(504, layout.height)
    }

    @Test
    fun emptyAndBlankTextsTakeNoSpace() {
        for (kind in TemplateKind.entries) {
            for (texts in listOf(empty, blank)) {
                val layout = TemplateGeometry.layout(kind, PaperWidth.MM58, 3, texts)
                val optional = layout.texts.filter { it.role != TextRole.BRAND && it.role != TextRole.FOOTER }
                assertTrue("$kind: $optional", optional.isEmpty())
            }
            assertEquals(
                TemplateGeometry.layout(kind, PaperWidth.MM58, 3, empty).height,
                TemplateGeometry.layout(kind, PaperWidth.MM58, 3, blank).height,
            )
        }
    }

    @Test
    fun longTextsWrapOrShrinkButStayInside() {
        for (kind in TemplateKind.entries) {
            val layout = TemplateGeometry.layout(kind, PaperWidth.MM58, 3, long)
            for (role in listOf(TextRole.CAPTION, TextRole.EVENT_TITLE)) {
                val blocks = layout.texts.filter { it.role == role }
                assertTrue("$kind $role: ${blocks.size} righe", blocks.size <= 2)
                // righe consecutive e dello stesso corpo
                for (i in 1 until blocks.size) {
                    assertEquals(blocks[i - 1].rect.bottom, blocks[i].rect.top)
                    assertEquals(blocks[i - 1].sizeDots, blocks[i].sizeDots)
                }
            }
            for (role in listOf(TextRole.HASHTAG, TextRole.DATE, TextRole.PRINT_NUMBER)) {
                assertTrue(layout.texts.count { it.role == role } <= 1)
            }
        }
        // l'hashtag senza spazi non ci sta: corpo ridotto e troncato con l'ellissi
        val strip = TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM58, 3, long)
        val tag = strip.texts.first { it.role == TextRole.HASHTAG }
        assertTrue(tag.sizeDots < 22)
        assertTrue(tag.text.endsWith("\u2026"))
    }

    @Test
    fun captionWrapsIntoTwoBalancedLines() {
        val layout = TemplateGeometry.layout(TemplateKind.POLAROID, PaperWidth.MM58, 1, long)
        val lines = layout.texts.filter { it.role == TextRole.CAPTION }.map { it.text }
        assertEquals(2, lines.size)
        assertEquals(long.caption, lines.joinToString(" "))
    }

    @Test
    fun wideTitleWrapsWithoutLosingWords() {
        val layout = TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM58, 3, long)
        val lines = layout.texts.filter { it.role == TextRole.EVENT_TITLE }.map { it.text }
        assertEquals(2, lines.size)
        assertEquals(long.eventTitle, lines.joinToString(" "))
    }

    @Test
    fun eightyMillimetersScalesByOneAndAHalf() {
        val polaroid = TemplateGeometry.layout(TemplateKind.POLAROID, PaperWidth.MM80, 1, empty)
        assertEquals(576, polaroid.width)
        assertEquals(listOf(Rect(24, 24, 528, 528)), polaroid.photos)
        assertEquals(576, polaroid.height)

        val fullBleed = TemplateGeometry.layout(TemplateKind.FULL, PaperWidth.MM80, 1, empty)
        assertEquals(listOf(Rect(0, 0, 576, 768)), fullBleed.photos)

        val strip = TemplateGeometry.layout(TemplateKind.STRIP, PaperWidth.MM80, 3, full)
        for (p in strip.photos) {
            assertEquals(24, p.left)
            assertEquals(528, p.width)
            assertEquals(396, p.height)
        }
        for (i in 1 until 3) assertEquals(18, strip.photos[i].top - strip.photos[i - 1].bottom)
        assertEquals(60, strip.texts.first { it.role == TextRole.EVENT_TITLE }.sizeDots)

        val receipt = TemplateGeometry.layout(TemplateKind.RECEIPT, PaperWidth.MM80, 1, full)
        assertEquals(72, receipt.texts.first { it.role == TextRole.BRAND }.sizeDots)
        assertEquals(3, receipt.decorations.filterIsInstance<Decoration.DashedLine>().first().thickness)

        for (kind in TemplateKind.entries) {
            val small = TemplateGeometry.layout(kind, PaperWidth.MM58, 3, full)
            val big = TemplateGeometry.layout(kind, PaperWidth.MM80, 3, full)
            assertTrue(
                "$kind: ${big.height} contro ${small.height} x 1.5",
                abs(big.height - small.height * 1.5) <= 6.0,
            )
            assertEquals(small.texts.map { it.role }, big.texts.map { it.role })
            assertEquals(small.photos.size, big.photos.size)
        }
    }

    @Test
    fun printNumberIsZeroPadded() {
        assertEquals("N. 0042", TemplateGeometry.printNumberText(42))
        assertEquals("N. 0000", TemplateGeometry.printNumberText(0))
        assertEquals("N. 12345", TemplateGeometry.printNumberText(12345))
        assertEquals("N. 0000", TemplateGeometry.printNumberText(-7))
    }

    @Test
    fun textMetricsMatchTheBrandFonts() {
        // Space Mono: 612/1000 em per carattere
        assertEquals(10 * 0.612 * 20, TextMetrics.width("0123456789", FontRole.MONO, 20), 1e-9)
        assertEquals(TextMetrics.width("abc", FontRole.MONO, 28), TextMetrics.width("abc", FontRole.MONO_BOLD, 28), 1e-9)
        // Righteous e proporzionale: la M e piu larga della i
        assertTrue(TextMetrics.width("M", FontRole.DISPLAY, 40) > TextMetrics.width("i", FontRole.DISPLAY, 40))
        // il marchio a corpo 48 sta comodo nei 352 punti utili
        assertTrue(TextMetrics.width(TemplateGeometry.BRAND_TEXT, FontRole.DISPLAY, 48) < 300.0)
    }
}
