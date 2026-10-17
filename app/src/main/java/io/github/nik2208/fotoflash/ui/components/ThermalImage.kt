package io.github.nik2208.fotoflash.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import kotlin.math.roundToInt

/**
 * Anteprima WYSIWYG di una stampa: l'immagine a 1 bit (1 pixel = 1 punto) a tutta larghezza.
 * Quando ingrandisce va SENZA filtro (nearest neighbour), cosi si vedono i punti veri del retino
 * e non una versione sfocata. Quando riduce (schermi mdpi/hdpi, carta da 80 mm, miniature dello
 * storico) il nearest neighbour scarterebbe righe e colonne intere di punti: li si media.
 */
@Composable
fun ThermalImage(bitmap: Bitmap, contentDescription: String?, modifier: Modifier = Modifier) {
    val image = remember(bitmap) {
        // Sotto meta scala il bilineare da solo salta ancora punti: le mipmap fanno la media vera.
        // E solo un suggerimento al renderer, valido anche sulle bitmap immutabili.
        if (!bitmap.isRecycled) bitmap.setHasMipMap(true)
        bitmap.asImageBitmap()
    }
    val ratio = remember(bitmap) {
        if (bitmap.width > 0 && bitmap.height > 0) bitmap.width.toFloat() / bitmap.height.toFloat() else 1f
    }
    val description = contentDescription
    val semanticsModifier = if (description != null) {
        Modifier.semantics {
            this.contentDescription = description
            role = Role.Image
        }
    } else {
        Modifier
    }
    Spacer(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .then(semanticsModifier)
            .drawBehind {
                if (size.width <= 0f || size.height <= 0f || image.width <= 0) return@drawBehind
                val reducing = size.width < image.width.toFloat()
                drawImage(
                    image = image,
                    dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()),
                    filterQuality = if (reducing) FilterQuality.Low else FilterQuality.None,
                )
            },
    )
}

@Preview(name = "Anteprima termica", showBackground = true, widthDp = 240)
@Composable
private fun ThermalImagePreview() {
    // Scacchiera a 1 bit con trama a puntini: basta a vedere che l'ingrandimento non sfuma.
    val sample = remember {
        val w = 96
        val h = 64
        val pixels = IntArray(w * h) { i ->
            val x = i % w
            val y = i / w
            val dark = ((x / 8 + y / 8) % 2 == 0) || (x % 3 == 0 && y % 3 == 0)
            if (dark) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
        }
        Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
    }
    FotoFlashTheme(darkTheme = false) {
        ThermalImage(bitmap = sample, contentDescription = null, modifier = Modifier.padding(12.dp))
    }
}
