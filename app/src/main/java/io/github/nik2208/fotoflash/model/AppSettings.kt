package io.github.nik2208.fotoflash.model

import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.thermal.ToneAdjustments

/** Tutte le preferenze persistenti dell'app. Le scrive solo SettingsRepository. */
data class AppSettings(
    val onboardingDone: Boolean = false,

    // Stampante
    val printerAddress: String? = null,
    val printerName: String? = null,
    val paper: PaperWidth = PaperWidth.MM58,
    val feedLines: Int = 4,
    val cutPaper: Boolean = false,
    /** Livello di riscaldamento 0..4 (0 = default della stampante). Vedi PrinterTuning.heatFor(). */
    val heatLevel: Int = 0,
    /** Byte per scrittura sul socket: le stampanti economiche hanno buffer piccoli. */
    val chunkSize: Int = 256,
    /** Pausa tra due scritture, in ms: e la "velocita" di invio. */
    val chunkDelayMs: Int = 15,
    /** Righe per banda raster GS v 0. */
    val bandHeight: Int = 24,

    // Immagine
    val dither: DitherAlgorithm = DitherAlgorithm.ATKINSON,
    val tone: ToneAdjustments = ToneAdjustments(),

    // Modello e testi
    val template: TemplateKind = TemplateKind.POLAROID,
    val eventTitle: String = "",
    val hashtag: String = "",
    val showDate: Boolean = true,
    val showPrintNumber: Boolean = true,
    val printCounter: Int = 0,

    // Scatto
    val instantPrint: Boolean = false,
    val timerSeconds: Int = 0,
    val stripShots: Int = 3,
    val shutterSound: Boolean = true,
    val livePreview: Boolean = true,
    /** Ogni scatto della fotocamera viene salvato anche in galleria (Pictures/FotoFlash/Scatti). */
    val autoSaveCaptures: Boolean = true,
    val copies: Int = 1,
)
