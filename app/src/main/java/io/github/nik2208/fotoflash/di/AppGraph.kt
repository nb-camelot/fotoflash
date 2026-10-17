package io.github.nik2208.fotoflash.di

import android.content.Context
import io.github.nik2208.fotoflash.FotoFlashApp
import io.github.nik2208.fotoflash.data.SettingsRepository
import io.github.nik2208.fotoflash.history.HistoryRepository
import io.github.nik2208.fotoflash.model.CaptureSession
import io.github.nik2208.fotoflash.print.Exporter
import io.github.nik2208.fotoflash.print.PrintCoordinator
import io.github.nik2208.fotoflash.print.PrintRenderer
import io.github.nik2208.fotoflash.printer.PrinterManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Grafo delle dipendenze, costruito a mano (niente Hilt/kapt: meno cose che possono rompersi
 * in una build cieca). Un'istanza per processo, creata da FotoFlashApp.
 */
class AppGraph(context: Context) {
    val appContext: Context = context.applicationContext

    /** Scope applicativo per lavori che devono sopravvivere alle schermate (stampa, storico). */
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val settings = SettingsRepository(appContext)
    val history = HistoryRepository(appContext, scope)
    val printer = PrinterManager(appContext, settings, scope)
    val renderer = PrintRenderer(appContext)
    val exporter = Exporter(appContext)
    val session = CaptureSession()
    val coordinator = PrintCoordinator(appContext, settings, renderer, printer, history)
}

/** Accesso al grafo da qualunque Context (Activity, Composable via LocalContext.current). */
val Context.appGraph: AppGraph
    get() = (applicationContext as FotoFlashApp).graph
