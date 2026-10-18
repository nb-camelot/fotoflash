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
    /** Si tiene allineata al driver: la imposta PrinterManager quando cambia stampante o driver. */
    val paper: PaperWidth = PaperWidth.MM58,
    /** Driver di stampa (docs/DRIVERS.md): escpos-58, escpos-80, phomemo-m02, phomemo-m02pro. */
    val printerDriver: String = "escpos-58",
    /** Collegamento della stampante scelta: CLASSIC (SPP) o BLE. */
    val printerLink: io.github.nik2208.fotoflash.thermal.PrinterLink = io.github.nik2208.fotoflash.thermal.PrinterLink.CLASSIC,
    /** BLE: byte per scrittura, pausa e modalità senza conferma; null = predefiniti del driver. */
    val bleChunkSize: Int? = null,
    val bleChunkDelayMs: Int? = null,
    val bleWithoutResponse: Boolean? = null,
    /** Phomemo: densità 1..15 (null = da heatLevel), larghezza della riga in byte (72 o 78 per la M02 Pro). */
    val phomemoDensity: Int? = null,
    val phomemoWidthBytes: Int = 72,
    /** Velocità di stampa dove il protocollo la prevede (sperimentale); null = non inviata. */
    val printerSpeed: Int? = null,
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
