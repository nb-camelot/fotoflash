package io.github.nik2208.fotoflash.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.github.nik2208.fotoflash.R

/** Caratteri del brand (OFL, in res/font). Il testo corrente resta sul font di sistema. */
object FfFonts {
    /** Righteous: marchio, titoli, numeri del conto alla rovescia. Esiste solo in regular. */
    val Display: FontFamily = FontFamily(
        Font(R.font.righteous_regular, FontWeight.Normal),
    )

    /** Space Mono: etichette ed elementi "da scontrino" (date, numeri, stati tecnici). */
    val Mono: FontFamily = FontFamily(
        Font(R.font.space_mono_regular, FontWeight.Normal),
        Font(R.font.space_mono_bold, FontWeight.Bold),
    )
}

// Partiamo dai default Material per ereditare dimensioni e interlinee collaudate e cambiamo
// solo famiglia, peso e spaziatura dove il carattere del brand lo richiede.
private val Base = Typography()

private fun TextStyle.display(): TextStyle =
    copy(fontFamily = FfFonts.Display, fontWeight = FontWeight.Normal, letterSpacing = 0.sp)

/** Space Mono e molto largo: niente spaziatura extra, altrimenti le etichette vanno a capo. */
private fun TextStyle.mono(weight: FontWeight, tracking: Float): TextStyle =
    copy(fontFamily = FfFonts.Mono, fontWeight = weight, letterSpacing = tracking.sp)

internal val FfTypography: Typography = Typography(
    displayLarge = Base.displayLarge.display(),
    displayMedium = Base.displayMedium.display(),
    displaySmall = Base.displaySmall.display(),
    headlineLarge = Base.headlineLarge.display(),
    headlineMedium = Base.headlineMedium.display(),
    headlineSmall = Base.headlineSmall.display(),
    titleLarge = Base.titleLarge,
    titleMedium = Base.titleMedium,
    titleSmall = Base.titleSmall,
    bodyLarge = Base.bodyLarge,
    bodyMedium = Base.bodyMedium,
    bodySmall = Base.bodySmall,
    labelLarge = Base.labelLarge.mono(FontWeight.Bold, 0f),
    labelMedium = Base.labelMedium.mono(FontWeight.Normal, 0.2f),
    labelSmall = Base.labelSmall.mono(FontWeight.Normal, 0.3f),
)

/** Testo dei pulsanti grandi: Righteous, giocoso e leggibile anche da lontano. */
internal val FfButtonTextStyle: TextStyle = TextStyle(
    fontFamily = FfFonts.Display,
    fontWeight = FontWeight.Normal,
    fontSize = 18.sp,
    lineHeight = 22.sp,
    letterSpacing = 0.2.sp,
)

/** Titolo delle barre in alto: stesso corpo di titleLarge ma con il carattere del marchio. */
internal val FfTopBarTitleStyle: TextStyle = Base.titleLarge.display()
