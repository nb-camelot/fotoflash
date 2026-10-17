package io.github.nik2208.fotoflash.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Palette del brand FotoFlash. Stessi valori di res/values/colors.xml (ff_*): li duplichiamo qui
 * perche Compose non legge i colori XML a costo zero e il tema deve esistere anche nei Preview.
 */
object FfColors {
    /** Inchiostro: testi e tratti, il "nero" della carta termica (mai nero puro). */
    val Ink = Color(0xFF16130F)

    /** Notte: sfondo del tema scuro e del mirino. */
    val Night = Color(0xFF0E0C0A)

    /** Carta: lo sfondo chiaro, e il colore di ogni foglio stampato anche nel tema scuro. */
    val Paper = Color(0xFFFBF8F1)

    /** Nebbia: superfici secondarie sul chiaro. */
    val Fog = Color(0xFFEDE8DE)

    /** Grafite: testi secondari, contorni, stato "non connessa". */
    val Graphite = Color(0xFF4A4640)

    /** Flash: il giallo del marchio, azioni primarie e otturatore. */
    val Flash = Color(0xFFFFCC00)

    /** Flash scuro: bordo 3D dei pulsanti gialli e accenti su sfondo chiaro. */
    val FlashDeep = Color(0xFFE0A800)

    /** Corallo: errori e accenti caldi. */
    val Coral = Color(0xFFFF5B45)

    /** Menta: successo, stampante pronta. */
    val Mint = Color(0xFF22B89A)

    /** Cielo: link e accenti informativi. */
    val Sky = Color(0xFF3D8BFF)
}

/**
 * Toni di servizio derivati dalla palette per i ruoli Material che il brand non copre
 * (contenitori, superfici a livelli, errori leggibili sul chiaro). Restano interni al tema.
 */
internal object FfTones {
    val White = Color(0xFFFFFFFF)
    val Black = Color(0xFF000000)

    // Chiaro
    val FlashContainer = Color(0xFFFFEB99)
    val CoralContainer = Color(0xFFFFDAD3)
    val OnCoralContainer = Color(0xFF3E0B04)
    val SkyContainer = Color(0xFFDCE7FF)
    val OnSkyContainer = Color(0xFF0A1F45)

    /** Il corallo puro su carta ha contrasto 2.9:1: per i testi di errore serve un rosso piu cupo (5:1). */
    val ErrorOnLight = Color(0xFFC4321E)
    val ErrorContainerLight = Color(0xFFFFDAD3)
    val OnErrorContainerLight = Color(0xFF410802)
    val OutlineVariantLight = Color(0xFFD6CFC2)
    val SurfaceDimLight = Color(0xFFDDD7CB)
    val SurfaceContainerLowLight = Color(0xFFF6F2EA)
    val SurfaceContainerLight = Color(0xFFF1ECE3)
    val SurfaceContainerHighestLight = Color(0xFFE6E0D5)

    // Scuro
    val SurfaceDark = Color(0xFF1C1915)
    val SurfaceVariantDark = Color(0xFF2E2A24)
    val OnSurfaceVariantDark = Color(0xFFCFC7BA)
    val FlashContainerDark = Color(0xFF4A3B00)
    val InversePrimaryDark = Color(0xFF6B5300)
    val CoralContainerDark = Color(0xFF5C1A10)
    val SkyContainerDark = Color(0xFF13336B)
    val ErrorOnDark = Color(0xFFFF8A78)
    val ErrorContainerDark = Color(0xFF7A1B0E)
    val OutlineDark = Color(0xFF8E877B)
    val OutlineVariantDark = Color(0xFF3B362F)
    val SurfaceBrightDark = Color(0xFF3A352E)
    val SurfaceContainerLowestDark = Color(0xFF090807)
    val SurfaceContainerLowDark = Color(0xFF161411)
    val SurfaceContainerHighDark = Color(0xFF26221D)
    val SurfaceContainerHighestDark = Color(0xFF312C26)
}
