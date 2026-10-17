package io.github.nik2208.fotoflash.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme

/**
 * Intestazione di sezione "da scontrino": Space Mono maiuscolo piccolo e una riga tratteggiata
 * che chiude la riga. Colore onSurfaceVariant: Graphite sul chiaro, un grigio caldo leggibile
 * sullo scuro (Graphite su Night non si leggerebbe).
 */
@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier) {
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 20.dp, bottom = 8.dp)
            // mergeDescendants: il testo entra nel nodo intestazione, cosi TalkBack lo trova
            // navigando per intestazioni (la riga tratteggiata non ha semantica).
            .semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text.uppercase(),
            style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 1.5.sp),
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.width(10.dp))
        DashedRule(
            color = MaterialTheme.colorScheme.outlineVariant,
            modifier = Modifier
                .weight(1f)
                .height(8.dp),
        )
    }
}

@Preview(name = "Intestazioni", showBackground = true, backgroundColor = 0xFFFBF8F1, widthDp = 360)
@Composable
private fun SectionHeaderPreview() {
    FotoFlashTheme(darkTheme = false) {
        Column(modifier = Modifier.padding(horizontal = 16.dp)) {
            SectionHeader(text = "Printer")
            SectionHeader(text = "Paper and print")
        }
    }
}
