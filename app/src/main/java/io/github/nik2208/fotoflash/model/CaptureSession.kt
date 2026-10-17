package io.github.nik2208.fotoflash.model

import android.graphics.Bitmap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Passa le foto dalla fotocamera (o dalla galleria) all'editor senza farle viaggiare negli
 * argomenti di navigazione. Vive in AppGraph per tutta la durata del processo.
 */
class CaptureSession {
    private val _photos = MutableStateFlow<List<Bitmap>>(emptyList())
    val photos: StateFlow<List<Bitmap>> = _photos.asStateFlow()

    var source: CaptureSource = CaptureSource.CAMERA
        private set

    /** Modello suggerito dalla fotocamera (es. STRIP dopo una sequenza), null = quello delle impostazioni. */
    var suggestedTemplate: io.github.nik2208.fotoflash.thermal.TemplateKind? = null
        private set

    fun set(photos: List<Bitmap>, source: CaptureSource, suggestedTemplate: io.github.nik2208.fotoflash.thermal.TemplateKind? = null) {
        this.source = source
        this.suggestedTemplate = suggestedTemplate
        _photos.value = photos
    }

    fun clear() {
        _photos.value = emptyList()
        suggestedTemplate = null
    }
}
