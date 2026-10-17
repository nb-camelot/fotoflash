package io.github.nik2208.fotoflash

import android.app.Application
import io.github.nik2208.fotoflash.di.AppGraph

class FotoFlashApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}
