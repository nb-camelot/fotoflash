package io.github.nik2208.fotoflash

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.nav.FotoFlashNavHost
import io.github.nik2208.fotoflash.nav.Routes
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    /** Prima destinazione: si decide dopo aver letto le impostazioni, intanto resta lo splash. */
    private var startRoute by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        splash.setKeepOnScreenCondition { startRoute == null }

        lifecycleScope.launch {
            val settings = appGraph.settings.current()
            startRoute = if (settings.onboardingDone) Routes.CAMERA else Routes.ONBOARDING
        }

        setContent {
            FotoFlashTheme {
                val start = startRoute
                if (start != null) {
                    FotoFlashNavHost(startDestination = start)
                }
            }
        }
    }
}
