package io.github.nik2208.fotoflash.print

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.util.Log
import androidx.annotation.FontRes
import androidx.core.content.res.ResourcesCompat
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.model.PrintRequest
import io.github.nik2208.fotoflash.model.RenderedPrint
import io.github.nik2208.fotoflash.thermal.BitImage
import io.github.nik2208.fotoflash.thermal.Decoration
import io.github.nik2208.fotoflash.thermal.Ditherer
import io.github.nik2208.fotoflash.thermal.FontRole
import io.github.nik2208.fotoflash.thermal.Rect
import io.github.nik2208.fotoflash.thermal.TemplateGeometry
import io.github.nik2208.fotoflash.thermal.TemplateLayout
import io.github.nik2208.fotoflash.thermal.TemplateTexts
import io.github.nik2208.fotoflash.thermal.TextAlign
import io.github.nik2208.fotoflash.thermal.TextBlock
import io.github.nik2208.fotoflash.thermal.TextRole
import io.github.nik2208.fotoflash.thermal.Tone
import io.github.nik2208.fotoflash.thermal.bitImageFromArgb
import io.github.nik2208.fotoflash.thermal.blit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.math.min
import android.graphics.Rect as AndroidRect

/**
 * Compone una stampa: impaginazione dal core, foto retinate, testi e decorazioni in nero pieno.
 *
 * Le foto e i testi seguono due strade diverse apposta: le foto passano da regolazioni tonali e
 * retino; i testi si disegnano con antialias e poi si sogliano, cosi restano nitidi e mai puntinati.
 * Alla fine tutto si somma (OR) in un'unica immagine a 1 bit, che e esattamente cio che va alla testina.
 */
class PrintRenderer(context: Context) {

    private val appContext: Context = context.applicationContext

    // I font si caricano una volta sola: ResourcesCompat legge il file .ttf a ogni chiamata.
    private val displayFace: Typeface by lazy { loadFont(R.font.righteous_regular, Typeface.DEFAULT_BOLD) }
    private val monoFace: Typeface by lazy { loadFont(R.font.space_mono_regular, Typeface.MONOSPACE) }
    private val monoBoldFace: Typeface by lazy {
        loadFont(R.font.space_mono_bold, Typeface.create(Typeface.MONOSPACE, Typeface.BOLD))
    }

    suspend fun render(request: PrintRequest): RenderedPrint = withContext(Dispatchers.Default) {
        require(request.photos.isNotEmpty()) { "nessuna foto da stampare" }
        val layout = TemplateGeometry.layout(request.template, request.paper, request.photos.size, request.texts)
        val print = BitImage(layout.width, layout.height)

        layout.photos.forEachIndexed { index, rect ->
            ensureActive()
            if (rect.width <= 0 || rect.height <= 0) return@forEachIndexed
            // La Striscia ha tanti riquadri quante foto (1..4); gli altri modelli usano solo la prima.
            // Il modulo e solo una difesa: il core non da mai piu riquadri che foto.
            val photo = request.photos[index % request.photos.size]
            print.blit(renderPhoto(photo, rect, request), rect.left, rect.top)
        }

        ensureActive()
        if (layout.texts.isNotEmpty() || layout.decorations.isNotEmpty()) {
            print.blit(renderOverlay(layout, request.texts), 0, 0)
        }

        RenderedPrint(bitImage = print, preview = print.toBitmap())
    }

    /** Foto: ritaglio al riquadro, scala di grigi, regolazioni tonali, retino. */
    private fun renderPhoto(photo: Bitmap, rect: Rect, request: PrintRequest): BitImage {
        val cropped = photo.centerCrop(rect.width, rect.height)
        val gray = cropped.toGrayImage()
        if (cropped !== photo) cropped.recycle()
        val toned = Tone.apply(gray, request.tone)
        return Ditherer.dither(toned, request.dither)
    }

    /**
     * Testi e decorazioni su una bitmap bianca grande quanto la stampa (1 pixel = 1 punto),
     * poi soglia: i bordi antialias un po' scuri diventano neri e i tratti restano pieni.
     */
    private fun renderOverlay(layout: TemplateLayout, texts: TemplateTexts): BitImage {
        val bitmap = Bitmap.createBitmap(layout.width, layout.height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        val canvas = Canvas(bitmap)

        drawDecorations(canvas, layout)
        for (block in layout.texts) {
            drawText(canvas, block, resolveText(block, texts))
        }

        val pixels = IntArray(layout.width * layout.height)
        bitmap.getPixels(pixels, 0, layout.width, 0, 0, layout.width, layout.height)
        bitmap.recycle()
        return bitImageFromArgb(layout.width, layout.height, pixels, TEXT_THRESHOLD)
    }

    /**
     * I testi fissi li decide l'app, non il core (che non conosce la lingua dell'utente):
     * marchio, ringraziamento finale e numero progressivo nella forma localizzata.
     */
    private fun resolveText(block: TextBlock, texts: TemplateTexts): String = when (block.role) {
        TextRole.BRAND -> block.text.ifBlank { BRAND_TEXT }
        TextRole.FOOTER -> appContext.getString(R.string.ed_footer_thanks)
        TextRole.PRINT_NUMBER -> texts.printNumber?.let { appContext.getString(R.string.ed_print_number, it) } ?: block.text
        else -> block.text
    }

    // ---------------------------------------------------------------- testi

    private fun drawText(canvas: Canvas, block: TextBlock, rawText: String) {
        val text = rawText.trim()
        val rect = block.rect
        if (text.isEmpty() || rect.width <= 0 || rect.height <= 0) return

        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            typeface = typefaceFor(block.font)
            letterSpacing = if (block.role == TextRole.BRAND) BRAND_LETTER_SPACING else 0f
            textAlign = when (block.align) {
                TextAlign.START -> Paint.Align.LEFT
                TextAlign.CENTER -> Paint.Align.CENTER
                TextAlign.END -> Paint.Align.RIGHT
            }
        }
        val fitted = fitText(text, paint, block.sizeDots, rect)
        paint.textSize = fitted.size

        // Centratura ottica: si centra l'altezza delle maiuscole, le discendenti scendono sotto la base.
        val bounds = AndroidRect()
        paint.getTextBounds(CAP_SAMPLE, 0, CAP_SAMPLE.length, bounds)
        val capHeight = if (bounds.top < 0) -bounds.top.toFloat() else fitted.size * 0.7f
        val lineSpacing = paint.fontSpacing
        val blockHeight = capHeight + lineSpacing * (fitted.lines.size - 1)
        var baseline = rect.top + (rect.height - blockHeight) / 2f + capHeight

        val x = when (block.align) {
            TextAlign.START -> rect.left.toFloat()
            TextAlign.CENTER -> rect.left + rect.width / 2f
            TextAlign.END -> rect.right.toFloat()
        }
        for (line in fitted.lines) {
            canvas.drawText(line, x, baseline, paint)
            baseline += lineSpacing
        }
    }

    private class FittedText(val size: Float, val lines: List<String>)

    /**
     * Prima prova il corpo pieno (andando a capo solo se il riquadro e alto abbastanza per piu righe),
     * poi riduce fino al 70%, infine tronca con i puntini di sospensione.
     */
    private fun fitText(text: String, paint: TextPaint, sizeDots: Int, rect: Rect): FittedText {
        val width = rect.width.toFloat()
        val maxSize = sizeDots.coerceAtLeast(MIN_TEXT_DOTS).toFloat()
        val minSize = (maxSize * MIN_TEXT_SCALE).coerceAtLeast(MIN_TEXT_DOTS.toFloat())
        var size = maxSize
        while (true) {
            paint.textSize = size
            val lines = wrapOrNull(text, paint, width, maxLinesFor(paint, rect.height))
            if (lines != null) return FittedText(size, lines)
            if (size <= minSize) break
            size = (size - 1f).coerceAtLeast(minSize)
        }
        paint.textSize = minSize
        return FittedText(minSize, wrapEllipsized(text, paint, width, maxLinesFor(paint, rect.height)))
    }

    private fun maxLinesFor(paint: TextPaint, height: Int): Int =
        (height / paint.fontSpacing).toInt().coerceIn(1, MAX_LINES)

    /** Il testo su una riga, o a capo sulle parole se c'e spazio; null se non entra. */
    private fun wrapOrNull(text: String, paint: TextPaint, width: Float, maxLines: Int): List<String>? {
        if (paint.measureText(text) <= width) return listOf(text)
        if (maxLines < 2) return null
        val lines = mutableListOf<String>()
        var line = ""
        for (word in words(text)) {
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (paint.measureText(candidate) <= width) {
                line = candidate
                continue
            }
            // Una parola che da sola non sta nella riga non si spezza: meglio rimpicciolire.
            if (line.isEmpty() || paint.measureText(word) > width) return null
            lines += line
            line = word
        }
        if (line.isNotEmpty()) lines += line
        return if (lines.size <= maxLines) lines else null
    }

    /** Ultima spiaggia al corpo minimo: righe piene finche ci stanno, l'ultima troncata. */
    private fun wrapEllipsized(text: String, paint: TextPaint, width: Float, maxLines: Int): List<String> {
        if (maxLines < 2) return listOf(ellipsize(text, paint, width))
        val words = words(text)
        val lines = mutableListOf<String>()
        var index = 0
        while (lines.size < maxLines - 1 && index < words.size && paint.measureText(words[index]) <= width) {
            var line = words[index++]
            while (index < words.size && paint.measureText("$line ${words[index]}") <= width) {
                line = "$line ${words[index++]}"
            }
            lines += line
        }
        val rest = words.drop(index).joinToString(" ")
        if (rest.isNotEmpty()) lines += ellipsize(rest, paint, width)
        return lines
    }

    private fun words(text: String): List<String> = text.split(' ').filter { it.isNotEmpty() }

    private fun ellipsize(text: String, paint: TextPaint, width: Float): String =
        TextUtils.ellipsize(text, paint, width, TextUtils.TruncateAt.END).toString()

    private fun typefaceFor(role: FontRole): Typeface = when (role) {
        FontRole.DISPLAY -> displayFace
        FontRole.MONO -> monoFace
        FontRole.MONO_BOLD -> monoBoldFace
    }

    private fun loadFont(@FontRes id: Int, fallback: Typeface): Typeface =
        try {
            ResourcesCompat.getFont(appContext, id) ?: fallback
        } catch (e: Exception) {
            // Senza il font del brand la stampa esce comunque, con il carattere di sistema.
            Log.w(TAG, "font $id non disponibile, uso quello di sistema", e)
            fallback
        }

    // ---------------------------------------------------------------- decorazioni

    /** Niente antialias: sulla carta un punto e nero o bianco, le sfumature diventerebbero sbavature. */
    private fun drawDecorations(canvas: Canvas, layout: TemplateLayout) {
        if (layout.decorations.isEmpty()) return
        val fill = Paint().apply {
            isAntiAlias = false
            color = Color.BLACK
            style = Paint.Style.FILL
        }
        for (decoration in layout.decorations) {
            when (decoration) {
                is Decoration.DashedLine -> drawDashedLine(canvas, decoration, fill)
                is Decoration.Frame -> drawFrame(canvas, decoration, fill)
                is Decoration.Zigzag -> drawZigzag(canvas, decoration, layout.width, fill)
            }
        }
    }

    /** Trattini da [Decoration.DashedLine.from] a [Decoration.DashedLine.to]; y e la prima riga del tratto. */
    private fun drawDashedLine(canvas: Canvas, line: Decoration.DashedLine, paint: Paint) {
        val dash = line.dash.coerceAtLeast(1)
        val step = dash + line.gap.coerceAtLeast(0)
        val top = line.y.toFloat()
        val bottom = (line.y + line.thickness.coerceAtLeast(1)).toFloat()
        var x = line.from
        while (x < line.to) {
            canvas.drawRect(x.toFloat(), top, min(x + dash, line.to).toFloat(), bottom, paint)
            x += step
        }
    }

    /** Cornice disegnata all'interno del rettangolo, cosi non sfora mai i margini calcolati dal core. */
    private fun drawFrame(canvas: Canvas, frame: Decoration.Frame, paint: Paint) {
        val r = frame.rect
        val t = frame.thickness.coerceAtLeast(1).coerceAtMost(min(r.width, r.height) / 2 + 1)
        val left = r.left.toFloat()
        val top = r.top.toFloat()
        val right = r.right.toFloat()
        val bottom = r.bottom.toFloat()
        canvas.drawRect(left, top, right, top + t, paint)
        canvas.drawRect(left, bottom - t, right, bottom, paint)
        canvas.drawRect(left, top, left + t, bottom, paint)
        canvas.drawRect(right - t, top, right, bottom, paint)
    }

    /**
     * Dente di sega della carta strappata: una fila di triangoli pieni che parte dalla riga [y]
     * e scende di mezzo dente, larga quanto la stampa.
     */
    private fun drawZigzag(canvas: Canvas, zigzag: Decoration.Zigzag, width: Int, paint: Paint) {
        val tooth = zigzag.tooth.coerceAtLeast(2)
        val top = zigzag.y.toFloat()
        val depth = tooth / 2f
        val path = Path()
        var x = 0
        while (x < width) {
            path.moveTo(x.toFloat(), top)
            path.lineTo((x + tooth).toFloat(), top)
            path.lineTo(x + tooth / 2f, top + depth)
            path.close()
            x += tooth
        }
        canvas.drawPath(path, paint)
    }

    private companion object {
        const val TAG = "PrintRenderer"

        /** Marchio stampato in testa allo scontrino: e un logotipo, non si traduce. */
        const val BRAND_TEXT = "FOTOFLASH"

        /** Soglia per i testi: sopra 128 i bordi antialias si ispessiscono un poco, tratti piu pieni. */
        const val TEXT_THRESHOLD = 150

        /** Il corpo si riduce al massimo fino al 70% prima di troncare. */
        const val MIN_TEXT_SCALE = 0.7f
        const val MIN_TEXT_DOTS = 8
        const val MAX_LINES = 4

        /** Spaziatura del marchio, in em: il logotipo respira come sul brand. */
        const val BRAND_LETTER_SPACING = 0.08f

        /** Lettera di riferimento per l'altezza delle maiuscole. */
        const val CAP_SAMPLE = "H"
    }
}
