package io.github.nik2208.fotoflash.nav

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import io.github.nik2208.fotoflash.camera.CameraScreen
import io.github.nik2208.fotoflash.editor.EditorScreen
import io.github.nik2208.fotoflash.history.HistoryDetailScreen
import io.github.nik2208.fotoflash.history.HistoryScreen
import io.github.nik2208.fotoflash.onboarding.OnboardingScreen
import io.github.nik2208.fotoflash.printer.PrinterScreen
import io.github.nik2208.fotoflash.settings.SettingsScreen

object Routes {
    const val ONBOARDING = "onboarding"
    const val CAMERA = "camera"
    const val EDITOR = "editor"
    const val HISTORY = "history"
    const val HISTORY_DETAIL = "history/{id}"
    const val SETTINGS = "settings"
    const val PRINTER = "printer"

    fun historyDetail(id: String) = "history/$id"
}

@Composable
fun FotoFlashNavHost(
    startDestination: String,
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
) {
    NavHost(navController = navController, startDestination = startDestination, modifier = modifier) {
        composable(Routes.ONBOARDING) {
            OnboardingScreen(
                onFinished = {
                    navController.navigate(Routes.CAMERA) {
                        popUpTo(Routes.ONBOARDING) { inclusive = true }
                    }
                },
            )
        }
        composable(Routes.CAMERA) {
            CameraScreen(
                onOpenEditor = { navController.navigate(Routes.EDITOR) { launchSingleTop = true } },
                onOpenHistory = { navController.navigate(Routes.HISTORY) { launchSingleTop = true } },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) { launchSingleTop = true } },
                onOpenPrinter = { navController.navigate(Routes.PRINTER) { launchSingleTop = true } },
            )
        }
        composable(Routes.EDITOR) {
            EditorScreen(
                onBack = { navController.popBackStack() },
                // Dopo la stampa si torna al mirino, pronti per la prossima foto.
                onDone = { navController.popBackStack(Routes.CAMERA, inclusive = false) },
                onOpenPrinter = { navController.navigate(Routes.PRINTER) { launchSingleTop = true } },
            )
        }
        composable(Routes.HISTORY) {
            HistoryScreen(
                onBack = { navController.popBackStack() },
                onOpenEntry = { id -> navController.navigate(Routes.historyDetail(id)) },
            )
        }
        composable(
            route = Routes.HISTORY_DETAIL,
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            HistoryDetailScreen(
                entryId = entry.arguments?.getString("id").orEmpty(),
                onBack = { navController.popBackStack() },
                onOpenPrinter = { navController.navigate(Routes.PRINTER) { launchSingleTop = true } },
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onOpenPrinter = { navController.navigate(Routes.PRINTER) { launchSingleTop = true } },
            )
        }
        composable(Routes.PRINTER) {
            PrinterScreen(onBack = { navController.popBackStack() })
        }
    }
}
