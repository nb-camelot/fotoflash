package io.github.nik2208.fotoflash.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts

/**
 * Marchio: lampo + "FotoFlash" in Righteous. [height] e l'altezza del lampo; il testo si
 * dimensiona di conseguenza e NON segue la scala caratteri di sistema (e un logo, non un testo).
 * [onDark] = testo Paper per sfondi scuri (mirino, splash), altrimenti Ink.
 */
@Composable
fun BrandWordmark(modifier: Modifier = Modifier, height: Dp = 28.dp, onDark: Boolean = false) {
    val name = stringResource(R.string.app_name)
    val fontSize = with(LocalDensity.current) { (height * 0.86f).toSp() }
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = name },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painter = painterResource(R.drawable.ic_brand_bolt),
            contentDescription = null,
            modifier = Modifier.size(height),
            contentScale = ContentScale.Fit,
        )
        Spacer(Modifier.width(height * 0.2f))
        Text(
            text = name,
            style = TextStyle(
                fontFamily = FfFonts.Display,
                fontWeight = FontWeight.Normal,
                fontSize = fontSize,
                lineHeight = fontSize,
                color = if (onDark) FfColors.Paper else FfColors.Ink,
            ),
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Preview(name = "Marchio", showBackground = true, backgroundColor = 0xFFFBF8F1)
@Composable
private fun BrandWordmarkPreview() {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BrandWordmark()
        BrandWordmark(height = 44.dp)
    }
}

@Preview(name = "Marchio - scuro", showBackground = true, backgroundColor = 0xFF0E0C0A)
@Composable
private fun BrandWordmarkDarkPreview() {
    BrandWordmark(modifier = Modifier.padding(16.dp), height = 36.dp, onDark = true)
}
