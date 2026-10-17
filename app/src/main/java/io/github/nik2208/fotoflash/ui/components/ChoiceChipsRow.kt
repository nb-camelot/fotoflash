package io.github.nik2208.fotoflash.ui.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfPillShape
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import kotlin.math.roundToInt

/**
 * Scelta singola tra poche opzioni (modello, retino, timer...) come riga di chip scorrevole.
 * Il chip scelto e giallo con la spunta: si riconosce anche senza leggere.
 * Lo spazio ai lati lo decide il chiamante con [modifier].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> ChoiceChipsRow(
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Giallo e inchiostro espliciti: il primary del tema chiaro e un tono scuro per i testi.
    val colors = FilterChipDefaults.filterChipColors(
        containerColor = MaterialTheme.colorScheme.surface,
        labelColor = MaterialTheme.colorScheme.onSurface,
        selectedContainerColor = FfColors.Flash,
        selectedLabelColor = FfColors.Ink,
        selectedLeadingIconColor = FfColors.Ink,
    )
    val scroll = rememberScrollState()
    // Larghezza visibile della riga e posizione (nel contenuto scorrevole) del chip scelto.
    var viewport by remember { mutableIntStateOf(0) }
    var selectedSpan by remember { mutableStateOf<IntRange?>(null) }

    // Il chip scelto puo stare oltre il bordo (retino "Soglia" su un telefono stretto): si porta
    // in vista scorrendo solo questa riga. bringIntoView scorrerebbe anche la pagina che la contiene.
    LaunchedEffect(selectedSpan, viewport) {
        val span = selectedSpan ?: return@LaunchedEffect
        if (viewport <= 0) return@LaunchedEffect
        val start = span.first
        val end = span.last
        if (start < scroll.value || end > scroll.value + viewport) {
            val centered = start - (viewport - (end - start)) / 2
            scroll.animateScrollTo(centered.coerceIn(0, scroll.maxValue))
        }
    }

    Row(
        modifier = modifier
            .onSizeChanged { viewport = it.width }
            .horizontalScroll(scroll)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        options.forEach { option ->
            val isSelected = option == selected
            // FilterChip si dichiara casella di controllo: qui la scelta e singola, come i radio.
            val chipSemantics = Modifier.semantics { role = Role.RadioButton }
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(option) },
                label = { Text(text = label(option), maxLines = 1) },
                modifier = if (isSelected) {
                    chipSemantics.onPlaced { coordinates ->
                        val x = coordinates.positionInParent().x.roundToInt()
                        selectedSpan = x..(x + coordinates.size.width)
                    }
                } else {
                    chipSemantics
                },
                leadingIcon = if (isSelected) {
                    {
                        Icon(
                            imageVector = Icons.Rounded.Check,
                            contentDescription = null,
                            modifier = Modifier.size(FilterChipDefaults.IconSize),
                        )
                    }
                } else {
                    null
                },
                shape = FfPillShape,
                colors = colors,
            )
        }
    }
}

private enum class PreviewTimer { OFF, THREE, TEN }

@Preview(name = "Chip di scelta", showBackground = true, backgroundColor = 0xFFFBF8F1, widthDp = 360)
@Composable
private fun ChoiceChipsRowPreview() {
    FotoFlashTheme(darkTheme = false) {
        ChoiceChipsRow(
            options = PreviewTimer.entries,
            selected = PreviewTimer.THREE,
            label = { timer ->
                when (timer) {
                    PreviewTimer.OFF -> "Off"
                    PreviewTimer.THREE -> "3 s"
                    PreviewTimer.TEN -> "10 s"
                }
            },
            onSelect = {},
            modifier = Modifier.padding(16.dp),
        )
    }
}
