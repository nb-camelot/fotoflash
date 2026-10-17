package io.github.nik2208.fotoflash.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.roundToInt

/** Angoli morbidi ma non "bolla": il brand e giocoso, l'interfaccia resta ordinata. */
internal val FfShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(28.dp),
    extraLarge = RoundedCornerShape(36.dp),
)

/** Pillola: pulsanti principali, chip di stato. */
internal val FfPillShape: Shape = RoundedCornerShape(percent = 50)

/**
 * Bordo della carta strappata: dente di sega sopra e/o sotto, lati dritti.
 *
 * Il numero di denti si arrotonda perche dividano esattamente la larghezza: cosi il bordo
 * finisce sempre su un dente intero e non ha mezzi denti storti ai lati.
 */
class TornPaperShape(
    private val top: Boolean = true,
    private val bottom: Boolean = true,
    private val toothWidth: Dp = DefaultToothWidth,
    private val toothDepth: Dp = DefaultToothDepth,
) : Shape {

    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val depth = with(density) { toothDepth.toPx() }
        val wanted = with(density) { toothWidth.toPx() }
        val count = max(1, (size.width / wanted).roundToInt())
        val step = size.width / count
        val path = Path()

        if (top) {
            path.moveTo(0f, depth)
            for (i in 0 until count) {
                path.lineTo(i * step + step / 2f, 0f)
                path.lineTo((i + 1) * step, depth)
            }
        } else {
            path.moveTo(0f, 0f)
            path.lineTo(size.width, 0f)
        }

        if (bottom) {
            path.lineTo(size.width, size.height - depth)
            for (i in count - 1 downTo 0) {
                path.lineTo(i * step + step / 2f, size.height)
                path.lineTo(i * step, size.height - depth)
            }
        } else {
            path.lineTo(size.width, size.height)
            path.lineTo(0f, size.height)
        }
        path.close()
        return Outline.Generic(path)
    }

    // Equals/hashCode: una Shape stabile evita di ricalcolare outline e ombra a ogni ricomposizione.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TornPaperShape) return false
        return top == other.top && bottom == other.bottom &&
            toothWidth == other.toothWidth && toothDepth == other.toothDepth
    }

    override fun hashCode(): Int {
        var result = top.hashCode()
        result = 31 * result + bottom.hashCode()
        result = 31 * result + toothWidth.hashCode()
        result = 31 * result + toothDepth.hashCode()
        return result
    }

    override fun toString(): String = "TornPaperShape(top=$top, bottom=$bottom)"

    companion object {
        val DefaultToothWidth: Dp = 12.dp
        val DefaultToothDepth: Dp = 6.dp
    }
}
