package io.github.nik2208.fotoflash.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfLightColors
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import io.github.nik2208.fotoflash.ui.theme.TornPaperShape

private val SheetPaddingH = 16.dp
private val SheetPaddingV = 14.dp

/**
 * Foglio di carta termica: color Paper anche nel tema scuro (e carta!), bordi a dente di sega
 * dove la carta e stata strappata, ombra leggera.
 *
 * Dentro il foglio vale lo schema chiaro e il colore del testo e Ink: un campo di testo o uno
 * slider messi sulla carta restano leggibili anche quando l'app e in tema scuro.
 */
@Composable
fun PaperSheet(
    modifier: Modifier = Modifier,
    zigzagTop: Boolean = true,
    zigzagBottom: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = remember(zigzagTop, zigzagBottom) {
        TornPaperShape(top = zigzagTop, bottom = zigzagBottom)
    }
    val teeth = TornPaperShape.DefaultToothDepth
    MaterialTheme(
        colorScheme = FfLightColors,
        typography = MaterialTheme.typography,
        shapes = MaterialTheme.shapes,
    ) {
        CompositionLocalProvider(LocalContentColor provides FfColors.Ink) {
            Column(
                modifier = modifier
                    // Sotto API 29 Android non proietta ombre di contorni concavi: resta solo
                    // il contrasto della carta, che basta.
                    .shadow(
                        elevation = 4.dp,
                        shape = shape,
                        clip = false,
                        ambientColor = FfColors.Ink,
                        spotColor = FfColors.Ink,
                    )
                    .clip(shape)
                    .background(FfColors.Paper)
                    .padding(
                        start = SheetPaddingH,
                        end = SheetPaddingH,
                        top = SheetPaddingV + if (zigzagTop) teeth else 0.dp,
                        bottom = SheetPaddingV + if (zigzagBottom) teeth else 0.dp,
                    ),
                horizontalAlignment = Alignment.CenterHorizontally,
                content = content,
            )
        }
    }
}

@Preview(name = "Foglio - scuro", showBackground = true, backgroundColor = 0xFF0E0C0A, widthDp = 320)
@Composable
private fun PaperSheetPreview() {
    FotoFlashTheme(darkTheme = true) {
        PaperSheet(modifier = Modifier.padding(24.dp)) {
            Text(text = "FOTOFLASH", style = MaterialTheme.typography.headlineSmall)
            DashedRule(color = FfColors.Ink, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
            Text(
                text = "Thanks for the smile!",
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Preview(name = "Foglio - senza denti sopra", showBackground = true, backgroundColor = 0xFFEDE8DE, widthDp = 320)
@Composable
private fun PaperSheetFlatTopPreview() {
    FotoFlashTheme(darkTheme = false) {
        Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PaperSheet(zigzagTop = false) {
                Text(text = "#party2026", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}
