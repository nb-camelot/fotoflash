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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.ui.theme.FfPillShape
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme

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
    val colors = FilterChipDefaults.filterChipColors(
        containerColor = MaterialTheme.colorScheme.surface,
        labelColor = MaterialTheme.colorScheme.onSurface,
        selectedContainerColor = MaterialTheme.colorScheme.primary,
        selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
        selectedLeadingIconColor = MaterialTheme.colorScheme.onPrimary,
    )
    Row(
        modifier = modifier
            .horizontalScroll(rememberScrollState())
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        options.forEach { option ->
            val isSelected = option == selected
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(option) },
                label = { Text(text = label(option), maxLines = 1) },
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
