package io.github.nik2208.fotoflash.thermal

/**
 * Tipi condivisi del motore di stampa termica. Sono il contratto tra il modulo `core-thermal`
 * (algoritmi puri, testabili in JVM) e l'app Android: cambiarli vuol dire toccare entrambi.
 */

/** Larghezza della carta e punti stampabili per riga (testina a 203 dpi, 8 punti/mm). */
enum class PaperWidth(val mm: Int, val dots: Int) {
    MM58(58, 384),
    MM80(80, 576),
}

/** Algoritmo di retinatura: trasforma i grigi in punti neri/bianchi. */
enum class DitherAlgorithm {
    /** Diffusione d'errore di Bill Atkinson: contrasto alto, luci pulite. Default. */
    ATKINSON,

    /** Floyd-Steinberg a serpentina: sfumature morbide, piu grana. */
    FLOYD_STEINBERG,

    /** Retino ordinato Bayer 8x8: trama regolare "da giornale", stabile tra le stampe. */
    ORDERED_BAYER,

    /** Soglia secca: bianco e nero puro, per disegni e testi. */
    THRESHOLD,
}

/**
 * Regolazioni tonali applicate prima della retinatura.
 * I valori fuori range vengono riportati nel range dagli algoritmi.
 */
data class ToneAdjustments(
    /** -1 (scuro) .. +1 (chiaro). */
    val brightness: Float = 0f,
    /** -1 (piatto) .. +1 (duro). */
    val contrast: Float = 0.15f,
    /** 0.4 .. 2.5; > 1 schiarisce i medi toni (utile: la carta termica tende a impastare gli scuri). */
    val gamma: Float = 1.25f,
    /** Stira l'istogramma tra l'1% e il 99% prima delle altre regolazioni. */
    val autoLevels: Boolean = true,
    /** 0 .. 1: maschera di contrasto (unsharp mask) per bordi leggibili sulla carta. */
    val sharpen: Float = 0.5f,
)

/** Modelli di stampa: definiscono impaginazione, testi e decorazioni. */
enum class TemplateKind {
    /** Foto quadrata con cornice bianca e fascia bassa per la didascalia, come una instantanea. */
    POLAROID,

    /** Foto a tutta larghezza (3:4), didascalia opzionale sotto. */
    FULL,

    /** Striscia da fotocabina: 3-4 scatti 4:3 in colonna con intestazione e piede. */
    STRIP,

    /** Scontrino ricordo: intestazione, foto, righe tratteggiate, numero progressivo, data. */
    RECEIPT,
}

/** Testi che un modello puo stampare. Le stringhe vuote o null non occupano spazio. */
data class TemplateTexts(
    val caption: String = "",
    val eventTitle: String = "",
    val hashtag: String = "",
    /** Data/ora gia formattata dall'app (locale dell'utente), null = non stampare. */
    val dateText: String? = null,
    /** Numero progressivo della stampa ("RICORDO N. 0042"), null = non stampare. */
    val printNumber: Int? = null,
)

/** Rettangolo in punti di stampa (pixel della testina). */
data class Rect(val left: Int, val top: Int, val width: Int, val height: Int) {
    val right: Int get() = left + width
    val bottom: Int get() = top + height
}

enum class TextAlign { START, CENTER, END }

/** Famiglia di carattere: l'app la mappa sui font del brand. */
enum class FontRole {
    /** Righteous: titoli e marchio. */
    DISPLAY,

    /** Space Mono: dati da scontrino, numeri, date. */
    MONO,

    /** Space Mono grassetto: didascalie scritte dall'utente. */
    MONO_BOLD,
}

enum class TextRole { EVENT_TITLE, CAPTION, HASHTAG, DATE, PRINT_NUMBER, BRAND, FOOTER }

/** Blocco di testo posizionato: l'app lo disegna centrato verticalmente in [rect]. */
data class TextBlock(
    val role: TextRole,
    val text: String,
    val rect: Rect,
    val font: FontRole,
    /** Altezza del corpo in punti di stampa (8 punti = 1 mm). */
    val sizeDots: Int,
    val align: TextAlign = TextAlign.CENTER,
)

/** Elementi grafici vettoriali semplici che l'app disegna in nero. */
sealed interface Decoration {
    /** Linea orizzontale tratteggiata (stile scontrino). */
    data class DashedLine(val y: Int, val from: Int, val to: Int, val dash: Int = 6, val gap: Int = 4, val thickness: Int = 2) : Decoration

    /** Riquadro a filo (bordo nero) attorno a un'area. */
    data class Frame(val rect: Rect, val thickness: Int = 2) : Decoration

    /** Bordo a dente di sega (carta strappata) lungo una riga orizzontale. */
    data class Zigzag(val y: Int, val tooth: Int = 8) : Decoration
}

/** Impaginazione completa di una stampa: tutto in punti, larghezza = carta. */
data class TemplateLayout(
    val width: Int,
    val height: Int,
    val photos: List<Rect>,
    val texts: List<TextBlock>,
    val decorations: List<Decoration>,
)

/** Parametri della trasmissione verso la stampante. */
data class PrintJobOptions(
    /** Righe per comando GS v 0: bande piccole = meno rischio di saturare il buffer. */
    val bandHeight: Int = 24,
    /** Righe di avanzamento carta dopo la stampa, per poter strappare sotto la foto. */
    val feedLinesAfter: Int = 4,
    /** Taglio carta (GS V) solo per stampanti con taglierina. */
    val cut: Boolean = false,
    /** Riscaldamento testina (ESC 7), null = lascia il default della stampante. */
    val heat: HeatSettings? = null,
)

/** ESC 7 n1 n2 n3: punti riscaldati per volta, tempo di riscaldamento, intervallo. */
data class HeatSettings(val maxDots: Int = 7, val heatTime: Int = 80, val heatInterval: Int = 2)
