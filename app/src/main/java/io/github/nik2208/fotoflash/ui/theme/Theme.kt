package io.github.nik2208.fotoflash.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

// Niente colore dinamico (Material You): il giallo FotoFlash deve restare riconoscibile.

internal val FfLightColors: ColorScheme = lightColorScheme(
    primary = FfColors.Flash,
    onPrimary = FfColors.Ink,
    primaryContainer = FfTones.FlashContainer,
    onPrimaryContainer = FfColors.Ink,
    inversePrimary = FfColors.Flash,
    // Ink sul corallo e sul cielo ha contrasto ~6:1, il bianco solo ~3:1.
    secondary = FfColors.Coral,
    onSecondary = FfColors.Ink,
    secondaryContainer = FfTones.CoralContainer,
    onSecondaryContainer = FfTones.OnCoralContainer,
    tertiary = FfColors.Sky,
    onTertiary = FfColors.Ink,
    tertiaryContainer = FfTones.SkyContainer,
    onTertiaryContainer = FfTones.OnSkyContainer,
    background = FfColors.Paper,
    onBackground = FfColors.Ink,
    surface = FfColors.Paper,
    onSurface = FfColors.Ink,
    surfaceVariant = FfColors.Fog,
    onSurfaceVariant = FfColors.Graphite,
    // Tinta neutra per l'elevazione tonale: il giallo sulle superfici sembrerebbe carta ingiallita.
    surfaceTint = FfColors.Graphite,
    inverseSurface = FfColors.Ink,
    inverseOnSurface = FfColors.Paper,
    error = FfTones.ErrorOnLight,
    onError = FfTones.White,
    errorContainer = FfTones.ErrorContainerLight,
    onErrorContainer = FfTones.OnErrorContainerLight,
    outline = FfColors.Graphite,
    outlineVariant = FfTones.OutlineVariantLight,
    scrim = FfTones.Black,
    surfaceBright = FfColors.Paper,
    surfaceContainer = FfTones.SurfaceContainerLight,
    surfaceContainerHigh = FfColors.Fog,
    surfaceContainerHighest = FfTones.SurfaceContainerHighestLight,
    surfaceContainerLow = FfTones.SurfaceContainerLowLight,
    surfaceContainerLowest = FfTones.White,
    surfaceDim = FfTones.SurfaceDimLight,
)

/** Schema scuro; [background] cambia solo per il mirino, che vuole il nero pieno. */
private fun ffDarkColors(background: Color): ColorScheme = darkColorScheme(
    primary = FfColors.Flash,
    onPrimary = FfColors.Ink,
    primaryContainer = FfTones.FlashContainerDark,
    onPrimaryContainer = FfTones.FlashContainer,
    inversePrimary = FfTones.InversePrimaryDark,
    secondary = FfColors.Coral,
    onSecondary = FfColors.Ink,
    secondaryContainer = FfTones.CoralContainerDark,
    onSecondaryContainer = FfTones.CoralContainer,
    tertiary = FfColors.Sky,
    onTertiary = FfColors.Ink,
    tertiaryContainer = FfTones.SkyContainerDark,
    onTertiaryContainer = FfTones.SkyContainer,
    background = background,
    onBackground = FfColors.Paper,
    surface = FfTones.SurfaceDark,
    onSurface = FfColors.Paper,
    surfaceVariant = FfTones.SurfaceVariantDark,
    onSurfaceVariant = FfTones.OnSurfaceVariantDark,
    surfaceTint = FfColors.Paper,
    inverseSurface = FfColors.Paper,
    inverseOnSurface = FfColors.Ink,
    error = FfTones.ErrorOnDark,
    onError = FfTones.OnErrorContainerLight,
    errorContainer = FfTones.ErrorContainerDark,
    onErrorContainer = FfTones.ErrorContainerLight,
    outline = FfTones.OutlineDark,
    outlineVariant = FfTones.OutlineVariantDark,
    scrim = FfTones.Black,
    surfaceBright = FfTones.SurfaceBrightDark,
    surfaceContainer = FfTones.SurfaceDark,
    surfaceContainerHigh = FfTones.SurfaceContainerHighDark,
    surfaceContainerHighest = FfTones.SurfaceContainerHighestDark,
    surfaceContainerLow = FfTones.SurfaceContainerLowDark,
    surfaceContainerLowest = FfTones.SurfaceContainerLowestDark,
    surfaceDim = FfColors.Night,
)

internal val FfDarkColors: ColorScheme = ffDarkColors(background = FfColors.Night)

private val FfCameraColors: ColorScheme = ffDarkColors(background = FfTones.Black)

/**
 * Tema dell'app. Gestisce anche il colore delle icone di sistema (orologio, batteria),
 * che deve seguire il tema dell'app e non quello del telefono.
 */
@Composable
fun FotoFlashTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val parent = LocalDarkBarsRequests.current
    if (parent != null) {
        // Tema annidato (l'onboarding e sempre chiaro): quando esce, il tema esterno deve
        // riapplicare le sue barre, altrimenti resterebbero quelle decise da questo.
        DisposableEffect(parent) {
            onDispose { parent.generation += 1 }
        }
    }
    val requests = remember { DarkBarsRequests() }
    SystemBarsEffect(darkTheme = darkTheme, requests = requests)
    CompositionLocalProvider(LocalDarkBarsRequests provides requests) {
        MaterialTheme(
            colorScheme = if (darkTheme) FfDarkColors else FfLightColors,
            typography = FfTypography,
            shapes = FfShapes,
            content = content,
        )
    }
}

/**
 * Tema del mirino: sempre scuro, sfondo nero. Finche e in composizione chiede icone di sistema
 * chiare anche se il resto dell'app e in tema chiaro.
 */
@Composable
fun CameraTheme(content: @Composable () -> Unit) {
    val requests = LocalDarkBarsRequests.current
    if (requests != null) {
        DisposableEffect(requests) {
            requests.count += 1
            onDispose { requests.count -= 1 }
        }
    } else {
        // Usato fuori da FotoFlashTheme (Preview, test): imposta direttamente.
        ApplySystemBars(lightBars = false)
    }
    MaterialTheme(
        colorScheme = FfCameraColors,
        typography = FfTypography,
        shapes = FfShapes,
        content = content,
    )
}

/**
 * Richieste di barre scure ancora attive. Un contatore, non un flag: durante le transizioni di
 * navigazione due schermate col mirino possono convivere, e l'ordine dei dispose non e garantito.
 */
private class DarkBarsRequests {
    var count by mutableIntStateOf(0)

    /** Cresce quando un FotoFlashTheme annidato esce: il tema che lo conteneva riapplica le barre. */
    var generation by mutableIntStateOf(0)
}

private val LocalDarkBarsRequests = staticCompositionLocalOf<DarkBarsRequests?> { null }

@Composable
private fun SystemBarsEffect(darkTheme: Boolean, requests: DarkBarsRequests) {
    // Lettura dello stato isolata qui: quando il mirino entra o esce ricompone solo questo nodo.
    val lightBars = !darkTheme && requests.count == 0
    // key: con lo stesso lightBars ApplySystemBars verrebbe saltato; un gruppo nuovo rilancia il SideEffect.
    key(requests.generation) {
        ApplySystemBars(lightBars = lightBars)
    }
}

@Composable
private fun ApplySystemBars(lightBars: Boolean) {
    if (LocalInspectionMode.current) return
    val view = LocalView.current
    SideEffect {
        val window = view.context.findActivity()?.window ?: return@SideEffect
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = lightBars
        controller.isAppearanceLightNavigationBars = lightBars
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
