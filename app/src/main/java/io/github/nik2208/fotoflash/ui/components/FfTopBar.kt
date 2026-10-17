package io.github.nik2208.fotoflash.ui.components

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.ui.theme.FfTopBarTitleStyle
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme

/**
 * Barra in alto delle schermate "di servizio" (editor, storico, impostazioni...): titolo centrato
 * in Righteous, freccia indietro solo se [onBack] non e null, azioni a destra.
 * Stesso colore dello sfondo: la barra non deve sembrare un blocco separato dalla pagina.
 * Gestisce da sola lo spazio della barra di stato (edge-to-edge).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FfTopBar(
    title: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = MaterialTheme.colorScheme
    CenterAlignedTopAppBar(
        title = {
            Text(
                text = title,
                style = FfTopBarTitleStyle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        modifier = modifier,
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = stringResource(R.string.common_back),
                    )
                }
            }
        },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = colors.background,
            scrolledContainerColor = colors.surfaceContainer,
            navigationIconContentColor = colors.onBackground,
            titleContentColor = colors.onBackground,
            actionIconContentColor = colors.onBackground,
        ),
    )
}

@Preview(name = "Barra in alto", showBackground = true, backgroundColor = 0xFFFBF8F1, widthDp = 360)
@Composable
private fun FfTopBarPreview() {
    FotoFlashTheme(darkTheme = false) {
        FfTopBar(
            title = "History",
            onBack = {},
            actions = {
                IconButton(onClick = {}) {
                    Icon(imageVector = Icons.Rounded.Settings, contentDescription = null)
                }
            },
        )
    }
}

@Preview(name = "Barra in alto - scuro", showBackground = true, backgroundColor = 0xFF0E0C0A, widthDp = 360)
@Composable
private fun FfTopBarDarkPreview() {
    FotoFlashTheme(darkTheme = true) {
        FfTopBar(title = "Settings", onBack = null)
    }
}
