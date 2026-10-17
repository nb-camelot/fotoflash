package io.github.nik2208.fotoflash.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.ui.theme.FfColors
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Motivo del retino: puntini su griglia sfalsata che rimpiccioliscono verso il bordo, come una
 * sfumatura stampata a punti. E il "lampo" visto con gli occhi della testina termica.
 * Decorativo: nessuna semantica.
 */
@Composable
fun HalftoneBurst(
    color: Color,
    modifier: Modifier = Modifier,
    spacing: Dp = 9.dp,
) {
    Canvas(modifier = modifier) {
        val step = spacing.toPx()
        if (step <= 0f) return@Canvas
        val maxDot = step * 0.42f
        val cx = size.width / 2f
        val cy = size.height / 2f
        val radius = min(cx, cy)
        if (radius <= 0f) return@Canvas
        val rows = (size.height / step).toInt() + 1
        val cols = (size.width / step).toInt() + 1
        for (row in 0..rows) {
            // Righe alterne sfalsate di mezzo passo: e la trama a 45 gradi dei retini veri.
            val shift = if (row % 2 == 0) 0f else step / 2f
            val y = row * step
            for (col in -1..cols) {
                val x = col * step + shift
                val dx = x - cx
                val dy = y - cy
                val distance = sqrt(dx * dx + dy * dy) / radius
                if (distance >= 1f) continue
                val r = maxDot * (1f - distance)
                if (r < 0.6f) continue
                drawCircle(color = color, radius = r, center = Offset(x, y))
            }
        }
    }
}

/** Riga tratteggiata orizzontale "da scontrino", centrata verticalmente nello spazio dato. */
@Composable
fun DashedRule(
    color: Color,
    modifier: Modifier = Modifier,
    thickness: Dp = 1.dp,
    dash: Dp = 4.dp,
    gap: Dp = 3.dp,
) {
    Canvas(modifier = modifier) {
        val y = size.height / 2f
        drawLine(
            color = color,
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = thickness.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash.toPx(), gap.toPx()), 0f),
        )
    }
}

@Preview(name = "Motivi", showBackground = true, backgroundColor = 0xFFFBF8F1)
@Composable
private fun MotifsPreview() {
    Column(modifier = Modifier.padding(16.dp)) {
        Box(modifier = Modifier.size(160.dp)) {
            HalftoneBurst(color = FfColors.Ink.copy(alpha = 0.3f), modifier = Modifier.size(160.dp))
        }
        DashedRule(color = FfColors.Graphite, modifier = Modifier.fillMaxWidth().height(12.dp))
    }
}
