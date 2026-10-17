package io.github.nik2208.fotoflash.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme

/**
 * Anteprima WYSIWYG di una stampa: l'immagine a 1 bit (1 pixel = 1 punto) ingrandita a tutta
 * larghezza SENZA filtro, cosi si vedono i punti veri del retino e non una versione sfocata.
 */
@Composable
fun ThermalImage(bitmap: Bitmap, contentDescription: String?, modifier: Modifier = Modifier) {
    val image = remember(bitmap) { bitmap.asImageBitmap() }
    val ratio = remember(bitmap) {
        if (bitmap.width > 0 && bitmap.height > 0) bitmap.width.toFloat() / bitmap.height.toFloat() else 1f
    }
    Image(
        bitmap = image,
        contentDescription = contentDescription,
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(ratio),
        contentScale = ContentScale.FillWidth,
        filterQuality = FilterQuality.None,
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
