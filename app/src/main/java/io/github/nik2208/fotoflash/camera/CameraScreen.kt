package io.github.nik2208.fotoflash.camera

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings as SystemSettings
import android.util.Log
import android.view.Surface
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.camera.view.RotationProvider
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Cameraswitch
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.FlashAuto
import androidx.compose.material.icons.rounded.FlashOff
import androidx.compose.material.icons.rounded.FlashOn
import androidx.compose.material.icons.rounded.Grain
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.NoPhotography
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.Timer10
import androidx.compose.material.icons.rounded.Timer3
import androidx.compose.material.icons.rounded.TimerOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.Observer
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.ui.components.FlashButton
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.PrinterStatusChip
import io.github.nik2208.fotoflash.ui.components.ShutterButton
import io.github.nik2208.fotoflash.ui.theme.CameraTheme
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

private const val TAG = "FotoFlashCameraUi"

/** Opacita massima del lampo bianco a schermo dopo lo scatto. */
private const val FLASH_PEAK_ALPHA = 0.88f

/** Un rifiuto del permesso piu rapido di cosi arriva senza dialogo: il permesso e bloccato. */
private const val INSTANT_DENIAL_MS = 500L

private val ViewfinderShape = RoundedCornerShape(28.dp)
private val PillShape = RoundedCornerShape(percent = 50)

private val CountdownTextStyle = TextStyle(
    fontFamily = FfFonts.Display,
    fontSize = 156.sp,
    lineHeight = 160.sp,
    color = FfColors.Flash,
    textAlign = TextAlign.Center,
    shadow = Shadow(color = Color.Black.copy(alpha = 0.55f), offset = Offset(0f, 6f), blurRadius = 28f),
)

/** Etichette da scontrino: Space Mono grassetto, maiuscole spaziate. */
private val LabelTextStyle = TextStyle(
    fontFamily = FfFonts.Mono,
    fontWeight = FontWeight.Bold,
    fontSize = 12.sp,
    lineHeight = 16.sp,
    letterSpacing = 1.2.sp,
)

private val OverlayLabelStyle = LabelTextStyle.copy(
    color = Color.White,
    textAlign = TextAlign.Center,
    shadow = Shadow(color = Color.Black.copy(alpha = 0.7f), offset = Offset(0f, 2f), blurRadius = 8f),
)

/**
 * Il mirino: schermata principale dell'app, sempre in tema scuro. Scatto singolo o striscia da
 * fotocabina, timer, flash, anteprima termica dal vivo, stampa istantanea e import dalla galleria.
 */
@Composable
fun CameraScreen(
    onOpenEditor: () -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenPrinter: () -> Unit,
) {
    val context = LocalContext.current
    val graph = context.appGraph
    val viewModel: CameraViewModel = viewModel { CameraViewModel(graph) }
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val printerState by viewModel.printerState.collectAsStateWithLifecycle()
    val lifecycleOwner = LocalLifecycleOwner.current
    val view = LocalView.current
    val snackbarHostState = remember { SnackbarHostState() }
    val shutterFlash = remember { Animatable(0f) }

    // --- Permesso fotocamera -------------------------------------------------------------
    var hasPermission by remember { mutableStateOf(context.hasCameraPermission()) }
    var permissionRequested by rememberSaveable { mutableStateOf(false) }
    var canAskAgain by rememberSaveable { mutableStateOf(true) }
    // Per distinguere "dialogo chiuso senza rispondere" da "bloccato": entrambi danno rifiuto senza razionale.
    var rationaleBefore by remember { mutableStateOf(false) }
    var launchedAt by remember { mutableLongStateOf(0L) }
    var silentDenials by rememberSaveable { mutableIntStateOf(0) }
    // I contratti si ricordano: un'istanza nuova a ogni ricomposizione registrerebbe di nuovo il launcher.
    val permissionContract = remember { ActivityResultContracts.RequestPermission() }
    val permissionLauncher = rememberLauncherForActivityResult(permissionContract) { granted ->
        hasPermission = granted
        if (!granted) {
            val rationaleNow = context.cameraRationale()
            // Risposta istantanea = il sistema non ha mostrato nessun dialogo, quindi e un blocco.
            val instant = SystemClock.elapsedRealtime() - launchedAt < INSTANT_DENIAL_MS
            // Dopo un rifiuto definitivo il sistema non mostra piu la richiesta: si passa dalle
            // impostazioni. Un dialogo chiuso col tasto indietro (Android 11+) invece si puo
            // rimostrare: lo si capisce dal razionale di prima; su un tablet lento si perde al
            // massimo un tocco, poi silentDenials porta comunque alle impostazioni.
            canAskAgain = rationaleNow || !(rationaleBefore || instant || silentDenials > 0)
            if (!rationaleNow) silentDenials += 1
        }
    }
    val requestPermission: () -> Unit = {
        rationaleBefore = context.cameraRationale()
        launchedAt = SystemClock.elapsedRealtime()
        permissionLauncher.launch(Manifest.permission.CAMERA)
    }
    LaunchedEffect(Unit) {
        if (!hasPermission && !permissionRequested) {
            permissionRequested = true
            requestPermission()
        }
    }

    // --- Galleria (Photo Picker) ---------------------------------------------------------
    val pickOneContract = remember { ActivityResultContracts.PickVisualMedia() }
    val pickOne = rememberLauncherForActivityResult(pickOneContract) { uri: Uri? ->
        if (uri != null) viewModel.onGalleryPicked(listOf(uri))
    }
    val pickManyContract = remember { ActivityResultContracts.PickMultipleVisualMedia(CameraViewModel.MAX_STRIP_SHOTS) }
    val pickMany = rememberLauncherForActivityResult(pickManyContract) { uris: List<Uri> ->
        viewModel.onGalleryPicked(uris)
    }
    val openGallery: () -> Unit = {
        val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
        try {
            // In modalita striscia si scelgono piu foto: diventano i fotogrammi della striscia.
            if (viewModel.ui.value.mode == CaptureMode.STRIP) pickMany.launch(request) else pickOne.launch(request)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "nessun selettore di foto disponibile", e)
            viewModel.onGalleryUnavailable()
        }
    }

    // --- Ciclo di vita: permesso rivisto al ritorno, sequenze fermate in background ---------
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            // Di ritorno dalle impostazioni di sistema il permesso puo essere cambiato.
            if (event == Lifecycle.Event.ON_RESUME) hasPermission = context.hasCameraPermission()
            if (event == Lifecycle.Event.ON_STOP) viewModel.onScreenStopped()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Alle feste il telefono resta sul treppiede: lo schermo non deve spegnersi nel mirino.
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

    // --- Eventi dal ViewModel --------------------------------------------------------------
    val currentOpenEditor by rememberUpdatedState(onOpenEditor)
    val currentOpenPrinter by rememberUpdatedState(onOpenPrinter)
    LaunchedEffect(viewModel, snackbarHostState) {
        viewModel.events.collect { event ->
            when (event) {
                CameraEvent.ShutterFlash -> launch {
                    shutterFlash.snapTo(FLASH_PEAK_ALPHA)
                    shutterFlash.animateTo(0f, tween(durationMillis = 320))
                }
                CameraEvent.OpenEditor -> currentOpenEditor()
                is CameraEvent.PrintFailed -> launch {
                    val text = event.message.ifBlank { context.getString(failureText(event.failure)) }
                    // Composizione fallita o stampante occupata da un altro lavoro: la schermata
                    // della stampante non risolve nulla, quindi niente azione "Stampante".
                    val printerAction = event.failure != PrintFailure.RENDER_FAILED &&
                        event.failure != PrintFailure.BUSY
                    snackbarHostState.currentSnackbarData?.dismiss()
                    val result = snackbarHostState.showSnackbar(
                        message = text,
                        actionLabel = if (printerAction) context.getString(R.string.cam_action_printer) else null,
                        withDismissAction = true,
                        duration = SnackbarDuration.Long,
                    )
                    if (result == SnackbarResult.ActionPerformed) currentOpenPrinter()
                }
                is CameraEvent.Problem -> launch {
                    snackbarHostState.currentSnackbarData?.dismiss()
                    snackbarHostState.showSnackbar(message = context.getString(event.message))
                }
            }
        }
    }

    CameraTheme {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        ) {
            if (hasPermission) {
                CameraContent(
                    viewModel = viewModel,
                    ui = ui,
                    settings = settings,
                    printerState = printerState,
                    snackbarHostState = snackbarHostState,
                    onGallery = openGallery,
                    onOpenHistory = onOpenHistory,
                    onOpenSettings = onOpenSettings,
                    onOpenPrinter = onOpenPrinter,
                )
            } else {
                PermissionContent(
                    canAskAgain = canAskAgain,
                    importing = ui.importing,
                    printerState = printerState,
                    snackbarHostState = snackbarHostState,
                    onRequestPermission = requestPermission,
                    onOpenAppSettings = { openAppSettings(context) },
                    onGallery = openGallery,
                    onOpenHistory = onOpenHistory,
                    onOpenSettings = onOpenSettings,
                    onOpenPrinter = onOpenPrinter,
                )
            }
            // Lampo bianco dello scatto: letto in fase di disegno, non ricompone nulla.
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .drawBehind {
                        val alpha = shutterFlash.value
                        if (alpha > 0f) drawRect(color = Color.White, alpha = alpha)
                    },
            )
        }
    }
}

// =========================================================================================
// Mirino con fotocamera attiva
// =========================================================================================

@Composable
private fun CameraContent(
    viewModel: CameraViewModel,
    ui: CameraUiState,
    settings: AppSettings,
    printerState: PrinterState,
    snackbarHostState: SnackbarHostState,
    onGallery: () -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenPrinter: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val view = LocalView.current
    val cameraController = remember { createCameraController(context) }

    // Collegamento al ciclo di vita e scoperta delle fotocamere disponibili.
    DisposableEffect(cameraController, lifecycleOwner) {
        var active = true
        cameraController.bindToLifecycle(lifecycleOwner)
        val initialization = cameraController.initializationFuture
        initialization.addListener(
            {
                if (!active) return@addListener
                try {
                    initialization.get()
                    viewModel.onCameraInitialized(
                        hasBack = cameraController.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA),
                        hasFront = cameraController.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA),
                    )
                } catch (e: Exception) {
                    // Il primo bind usa la posteriore: su un dispositivo con la sola frontale fallisce,
                    // ma il provider e pronto e si puo ripiegare sulla fotocamera che c'e.
                    val hasBack = runCatching { cameraController.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) }.getOrDefault(false)
                    val hasFront = runCatching { cameraController.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) }.getOrDefault(false)
                    if (!hasBack && hasFront) {
                        Log.w(TAG, "nessuna fotocamera posteriore, si passa alla frontale", e)
                        viewModel.onCameraInitialized(hasBack = false, hasFront = true)
                    } else {
                        Log.e(TAG, "inizializzazione della fotocamera fallita", e)
                        viewModel.onCameraUnavailable()
                    }
                }
            },
            ContextCompat.getMainExecutor(context),
        )
        onDispose {
            active = false
            cameraController.unbind()
            viewModel.onCameraReleased()
        }
    }

    // Fotocamera collegata, per seguirne gli errori dopo l'avvio (vedi l'osservatore piu sotto).
    var boundInfo by remember { mutableStateOf<CameraInfo?>(null) }

    // Fotocamera frontale/posteriore; poi flash disponibile e orientamento per l'anteprima termica.
    LaunchedEffect(cameraController, ui.useFrontCamera, ui.cameraReady) {
        val selector = if (ui.useFrontCamera) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        if (cameraController.cameraSelector != selector) {
            try {
                cameraController.cameraSelector = selector
            } catch (e: RuntimeException) {
                Log.w(TAG, "cambio fotocamera rifiutato", e)
                // Il controller ha gia scollegato tutto e rimesso solo il selettore di prima: senza
                // un nuovo collegamento il mirino resterebbe nero con l'otturatore attivo.
                runCatching { cameraController.bindToLifecycle(lifecycleOwner) }
                    .onFailure {
                        Log.e(TAG, "ricollegamento della fotocamera fallito", it)
                        viewModel.onCameraUnavailable()
                    }
                viewModel.onCameraSwitchFailed()
                return@LaunchedEffect
            }
        }
        // Anche con l'avviso d'errore a schermo: un cambio di fotocamera va osservato sulla nuova.
        cameraController.cameraInfo?.let { boundInfo = it }
        if (ui.cameraReady) {
            val info = cameraController.cameraInfo
            val displayRotation = view.display?.rotation ?: Surface.ROTATION_0
            viewModel.onCameraBound(
                front = info?.let { it.lensFacing == CameraSelector.LENS_FACING_FRONT } ?: ui.useFrontCamera,
                hasFlashUnit = info?.hasFlashUnit() ?: true,
                displayRotationDegrees = info?.getSensorRotationDegrees(displayRotation),
            )
        }
    }

    LaunchedEffect(cameraController, ui.flash) {
        cameraController.imageCaptureFlashMode = ui.flash.cameraXMode
    }

    // Errori della fotocamera dopo l'avvio: occupata da un'altra app, disabilitata, guasto dell'HAL.
    // Gli errori recuperabili minori li riprova CameraX da sola; quando torna aperta si riparte.
    DisposableEffect(boundInfo, lifecycleOwner) {
        val live = boundInfo?.cameraState
        val observer = Observer<CameraState> { state ->
            val error = state.error
            if (error != null && (
                    error.type == CameraState.ErrorType.CRITICAL ||
                        error.code == CameraState.ERROR_CAMERA_IN_USE ||
                        error.code == CameraState.ERROR_MAX_CAMERAS_IN_USE
                    )
            ) {
                Log.w(TAG, "fotocamera in errore: codice ${error.code}")
                viewModel.onCameraError()
            } else if (state.type == CameraState.Type.OPEN) {
                viewModel.onCameraRecovered()
            }
        }
        live?.observe(lifecycleOwner, observer)
        onDispose { live?.removeObserver(observer) }
    }

    // La foto esce dritta rispetto al mondo (CameraX segue l'orientamento fisico), il mirino resta
    // fermo con lo schermo: conta la differenza tra le due rotazioni, non quella del telefono da
    // sola (sul tablet SM-T550 il verso naturale e orizzontale).
    var deviceRotation by remember { mutableIntStateOf(view.display?.rotation ?: Surface.ROTATION_0) }
    DisposableEffect(context) {
        val rotationProvider = RotationProvider(context)
        val listener = RotationProvider.Listener { rotation -> deviceRotation = rotation }
        if (!rotationProvider.addListener(ContextCompat.getMainExecutor(context), listener)) {
            Log.w(TAG, "orientamento del telefono non rilevabile: la guida resta verticale")
        }
        onDispose { rotationProvider.removeListener(listener) }
    }
    val screenRotation = view.display?.rotation ?: Surface.ROTATION_0
    val rotationGap = (deviceRotation - screenRotation + 4) % 4
    val sideways = rotationGap == 1 || rotationGap == 3

    // Anteprima termica: l'analizzatore si collega solo quando serve.
    val livePreview = settings.livePreview
    DisposableEffect(cameraController, livePreview) {
        if (livePreview) {
            cameraController.setImageAnalysisAnalyzer(viewModel.analysisExecutor, viewModel.thermalAnalyzer)
        }
        onDispose {
            cameraController.clearImageAnalysisAnalyzer()
            viewModel.thermalAnalyzer.reset()
        }
    }

    // Scatti richiesti dal ViewModel (singolo, timer, striscia).
    val captureRequest by viewModel.captureRequest.collectAsStateWithLifecycle()
    LaunchedEffect(cameraController, captureRequest) {
        val requestId = captureRequest ?: return@LaunchedEffect
        val front = cameraController.cameraInfo?.lensFacing == CameraSelector.LENS_FACING_FRONT
        try {
            val photo = cameraController.takeUprightPhoto(
                executor = viewModel.captureExecutor,
                mirror = front,
                onShutter = viewModel::onShutterFired,
                onExposed = viewModel::onExposureDone,
            )
            viewModel.onCaptured(requestId, photo)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            viewModel.onCaptureFailed(requestId, e)
        } catch (e: OutOfMemoryError) {
            // JPEG o bitmap troppo grandi per la memoria rimasta: uno scatto perso, non l'app intera.
            viewModel.onCaptureFailed(requestId, e)
        }
    }

    // I tasti del volume scattano: e cosi che funzionano i telecomandi Bluetooth da selfie.
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(focusRequester) { focusRequester.requestFocus() }

    val controlsLocked = ui.sequenceRunning || ui.busy
    val queueFull = settings.instantPrint && ui.mode == CaptureMode.PHOTO &&
        ui.pendingPrints >= CameraViewModel.MAX_QUEUED_PRINTS

    Column(
        modifier = Modifier
            .fillMaxSize()
            .onKeyEvent { event ->
                if (event.key != Key.VolumeUp && event.key != Key.VolumeDown) return@onKeyEvent false
                if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0) viewModel.onShutter()
                true
            }
            .focusRequester(focusRequester)
            .focusable()
            .systemBarsPadding(),
    ) {
        CameraTopBar(
            printerState = printerState,
            ui = ui,
            settings = settings,
            onOpenPrinter = onOpenPrinter,
            onCycleFlash = viewModel::onCycleFlash,
            onCycleTimer = viewModel::onCycleTimer,
            onToggleThermal = viewModel::onToggleLivePreview,
        )
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Viewfinder(
                cameraController = cameraController,
                viewModel = viewModel,
                ui = ui,
                settings = settings,
                printerState = printerState,
                snackbarHostState = snackbarHostState,
                sideways = sideways,
            )
        }
        ModeRow(
            mode = ui.mode,
            enabled = !controlsLocked,
            onSelect = viewModel::onSelectMode,
            onOpenHistory = onOpenHistory,
            onOpenSettings = onOpenSettings,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 28.dp, end = 28.dp, top = 4.dp, bottom = 18.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GalleryButton(
                label = stringResource(
                    if (ui.mode == CaptureMode.STRIP) R.string.cam_cd_gallery_strip else R.string.cam_cd_gallery,
                ),
                onClick = onGallery,
                enabled = !controlsLocked,
                importing = ui.importing,
            )
            // Coda piena: l'otturatore resta toccabile (onShutter spiega di aspettare), solo attenuato.
            ShutterButton(
                onClick = viewModel::onShutter,
                modifier = Modifier.alpha(if (queueFull && ui.countdown == null) 0.4f else 1f),
                enabled = ui.cameraReady,
                busy = ui.busy,
                countdown = ui.countdown,
            )
            val flipTurn by animateFloatAsState(
                targetValue = if (ui.useFrontCamera) 180f else 0f,
                animationSpec = spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow),
                label = "flipCamera",
            )
            CamIconButton(
                icon = Icons.Rounded.Cameraswitch,
                label = stringResource(R.string.cam_cd_switch_camera),
                onClick = viewModel::onSwitchCamera,
                enabled = ui.canSwitchCamera && !controlsLocked,
                size = 56.dp,
                iconRotation = flipTurn,
            )
        }
    }
}

private fun createCameraController(context: Context): LifecycleCameraController =
    LifecycleCameraController(context).apply {
        // Formato e coda dell'analisi si impostano prima del bind: cambiarli dopo riconfigura la fotocamera.
        setEnabledUseCases(CameraController.IMAGE_CAPTURE or CameraController.IMAGE_ANALYSIS)
        setImageAnalysisBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        setImageAnalysisOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
        // Per una fotocamera istantanea conta lo scatto immediato: la stampa e comunque a 203 dpi.
        setImageCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
    }

// -----------------------------------------------------------------------------------------
// Barra in alto
// -----------------------------------------------------------------------------------------

@Composable
private fun CameraTopBar(
    printerState: PrinterState,
    ui: CameraUiState,
    settings: AppSettings,
    onOpenPrinter: () -> Unit,
    onCycleFlash: () -> Unit,
    onCycleTimer: () -> Unit,
    onToggleThermal: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PrinterStatusChip(
            state = printerState,
            onClick = onOpenPrinter,
            modifier = Modifier.weight(1f, fill = false),
        )
        Spacer(Modifier.width(8.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (ui.hasFlashUnit) {
                val (flashIcon, flashState) = when (ui.flash) {
                    FlashMode.AUTO -> Icons.Rounded.FlashAuto to R.string.cam_flash_auto
                    FlashMode.ON -> Icons.Rounded.FlashOn to R.string.cam_flash_on
                    FlashMode.OFF -> Icons.Rounded.FlashOff to R.string.cam_flash_off
                }
                CamIconButton(
                    icon = flashIcon,
                    label = stringResource(R.string.cam_cd_flash, stringResource(flashState)),
                    onClick = onCycleFlash,
                    active = ui.flash == FlashMode.ON,
                )
            }
            val timer = settings.timerSeconds
            val timerIcon = when (timer) {
                0 -> Icons.Rounded.TimerOff
                3 -> Icons.Rounded.Timer3
                10 -> Icons.Rounded.Timer10
                else -> Icons.Rounded.Timer
            }
            val timerState = if (timer > 0) {
                stringResource(R.string.cam_timer_seconds, timer)
            } else {
                stringResource(R.string.cam_timer_off)
            }
            CamIconButton(
                icon = timerIcon,
                label = stringResource(R.string.cam_cd_timer, timerState),
                onClick = onCycleTimer,
                active = timer > 0,
                enabled = !ui.sequenceRunning,
            )
            CamIconButton(
                icon = Icons.Rounded.Grain,
                label = stringResource(
                    R.string.cam_cd_thermal,
                    stringResource(if (settings.livePreview) R.string.cam_state_on else R.string.cam_state_off),
                ),
                onClick = onToggleThermal,
                active = settings.livePreview,
            )
        }
    }
}

// -----------------------------------------------------------------------------------------
// Mirino
// -----------------------------------------------------------------------------------------

/** Tocco sul mirino da evidenziare con l'anello di messa a fuoco; [id] lo rende unico. */
private data class FocusTap(val position: Offset, val id: Int)

/** Contenitore non osservabile: scriverci durante la composizione non provoca ricomposizioni. */
private class RetainedStrip {
    var value: StripProgress? = null
}

@Composable
private fun Viewfinder(
    cameraController: LifecycleCameraController,
    viewModel: CameraViewModel,
    ui: CameraUiState,
    settings: AppSettings,
    printerState: PrinterState,
    snackbarHostState: SnackbarHostState,
    sideways: Boolean,
) {
    var focusTap by remember { mutableStateOf<FocusTap?>(null) }
    var tapCount by remember { mutableIntStateOf(0) }

    Box(
        modifier = Modifier
            // 3:4 come il sensore: niente ritagli nascosti, il mirino mostra tutta la foto.
            .aspectRatio(3f / 4f)
            .clip(ViewfinderShape)
            .background(Color.Black)
            .pointerInput(Unit) {
                // Il PreviewView mette a fuoco da solo al tocco; qui si disegna solo l'anello.
                observeTaps { position ->
                    tapCount += 1
                    focusTap = FocusTap(position, tapCount)
                }
            },
    ) {
        AndroidView(
            factory = { viewContext ->
                PreviewView(viewContext).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    // TextureView: si ritaglia con gli angoli arrotondati e convive con le animazioni Compose.
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    this.controller = cameraController
                }
            },
            modifier = Modifier.fillMaxSize(),
            onRelease = { previewView -> previewView.controller = null },
        )

        AnimatedVisibility(
            visible = settings.livePreview,
            modifier = Modifier.fillMaxSize(),
            enter = fadeIn(tween(durationMillis = 220)),
            exit = fadeOut(tween(durationMillis = 180)),
            label = "thermalOverlay",
        ) {
            ThermalOverlay(frames = viewModel.thermalFrames)
        }

        FramingGuide(aspect = guideAspect(ui.mode, settings.template, sideways))

        focusTap?.let { tap -> key(tap.id) { FocusRing(position = tap.position) } }

        StatusPill(
            ui = ui,
            instantPrint = settings.instantPrint,
            printerState = printerState,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 14.dp),
        )

        AnimatedVisibility(
            visible = ui.strip != null,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 12.dp),
            enter = slideInHorizontally { it } + fadeIn(),
            exit = slideOutHorizontally { it } + fadeOut(),
            label = "stripProgress",
        ) {
            // Durante l'animazione di uscita lo stato e gia null: si mostra l'ultimo valore visto.
            val retained = remember { RetainedStrip() }
            ui.strip?.let { retained.value = it }
            retained.value?.let { StripProgressOverlay(strip = it) }
        }

        val countdown = ui.countdown
        if (countdown != null) {
            CountdownOverlay(
                seconds = countdown,
                strip = ui.strip,
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = 24.dp),
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val showStripHint = ui.mode == CaptureMode.STRIP && !ui.sequenceRunning &&
                snackbarHostState.currentSnackbarData == null
            AnimatedVisibility(
                visible = showStripHint,
                enter = fadeIn(),
                exit = fadeOut(),
                label = "stripHint",
            ) {
                Pill(container = Color.Black.copy(alpha = 0.55f), content = Color.White) {
                    Text(
                        text = stringResource(
                            R.string.cam_strip_hint,
                            settings.stripShots.coerceIn(CameraViewModel.MIN_STRIP_SHOTS, CameraViewModel.MAX_STRIP_SHOTS),
                        ),
                        style = LabelTextStyle,
                    )
                }
            }
            CamSnackbarHost(state = snackbarHostState)
        }

        if (ui.cameraUnavailable) CameraUnavailableOverlay()
    }
}

/** Osserva i tocchi senza consumarli: il PreviewView sotto continua a ricevere fuoco e zoom. */
private suspend fun PointerInputScope.observeTaps(onTap: (Offset) -> Unit) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var isTap = true
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            if (event.changes.size > 1) isTap = false
            val change = event.changes.firstOrNull { it.id == down.id } ?: break
            if ((change.position - down.position).getDistance() > viewConfiguration.touchSlop) isTap = false
            if (!change.pressed) {
                if (isTap) onTap(change.position)
                break
            }
        }
    }
}

/** Fotogrammi retinati dal vivo, ingranditi senza filtro: si vedono i punti come sulla carta. */
@Composable
private fun ThermalOverlay(frames: StateFlow<Bitmap?>) {
    val frame by frames.collectAsStateWithLifecycle()
    val bitmap = frame ?: return
    val image = remember(bitmap) { bitmap.asImageBitmap() }
    Image(
        bitmap = image,
        contentDescription = null,
        modifier = Modifier.fillMaxSize(),
        contentScale = ContentScale.Crop,
        filterQuality = FilterQuality.None,
    )
}

/**
 * Rapporto (larghezza/altezza sullo schermo) della parte di inquadratura che finisce sulla carta;
 * null = tutta l'inquadratura (3:4). Con il telefono di lato ([sideways]) la foto esce dritta
 * rispetto al mondo mentre il mirino resta in verticale: il riquadro si gira di 90 gradi.
 */
private fun guideAspect(mode: CaptureMode, template: TemplateKind, sideways: Boolean): Float? {
    val upright = when {
        mode == CaptureMode.STRIP -> 4f / 3f
        template == TemplateKind.POLAROID || template == TemplateKind.RECEIPT -> 1f
        template == TemplateKind.STRIP -> 4f / 3f
        else -> null
    }
    if (!sideways) return upright
    // Modello Pieno (foto 3:4 nel mondo): sullo schermo girato diventa una fascia 4:3.
    return 1f / (upright ?: (3f / 4f))
}

/** Oscura cio che la stampa tagliera e segna gli angoli della parte che finisce sulla carta. */
@Composable
private fun FramingGuide(aspect: Float?) {
    if (aspect == null) return
    Canvas(modifier = Modifier.fillMaxSize()) {
        var guideWidth = size.width
        var guideHeight = size.width / aspect
        if (guideHeight > size.height) {
            guideHeight = size.height
            guideWidth = size.height * aspect
        }
        val left = (size.width - guideWidth) / 2f
        val top = (size.height - guideHeight) / 2f
        val right = left + guideWidth
        val bottom = top + guideHeight
        val shade = Color.Black.copy(alpha = 0.42f)
        if (top >= 1f) {
            drawRect(color = shade, topLeft = Offset.Zero, size = Size(size.width, top))
            drawRect(color = shade, topLeft = Offset(0f, bottom), size = Size(size.width, size.height - bottom))
        }
        if (left >= 1f) {
            drawRect(color = shade, topLeft = Offset(0f, top), size = Size(left, guideHeight))
            drawRect(color = shade, topLeft = Offset(right, top), size = Size(size.width - right, guideHeight))
        }

        val arm = 22.dp.toPx()
        val stroke = 2.5.dp.toPx()
        val inset = 10.dp.toPx()
        val color = Color.White.copy(alpha = 0.85f)
        val l = left + inset
        val t = top + inset
        val r = right - inset
        val b = bottom - inset
        fun corner(x: Float, y: Float, dx: Float, dy: Float) {
            drawLine(color = color, start = Offset(x, y), end = Offset(x + dx, y), strokeWidth = stroke, cap = StrokeCap.Round)
            drawLine(color = color, start = Offset(x, y), end = Offset(x, y + dy), strokeWidth = stroke, cap = StrokeCap.Round)
        }
        corner(l, t, arm, arm)
        corner(r, t, -arm, arm)
        corner(l, b, arm, -arm)
        corner(r, b, -arm, -arm)
    }
}

@Composable
private fun FocusRing(position: Offset) {
    val settle = remember { Animatable(0f) }
    val fade = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        settle.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow))
        delay(450L)
        fade.animateTo(0f, tween(durationMillis = 250))
    }
    Canvas(modifier = Modifier.fillMaxSize()) {
        val alpha = fade.value
        if (alpha <= 0f) return@Canvas
        val radius = 34.dp.toPx() * (1.5f - 0.5f * settle.value)
        drawCircle(
            color = FfColors.Flash,
            radius = radius,
            center = position,
            alpha = alpha,
            style = Stroke(width = 2.dp.toPx()),
        )
        drawCircle(color = FfColors.Flash, radius = 3.dp.toPx(), center = position, alpha = alpha)
    }
}

@Composable
private fun CountdownOverlay(seconds: Int, strip: StripProgress?, modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        // key: ogni secondo riparte dall'animazione di ingresso.
        key(seconds) {
            val pop = remember { Animatable(0f) }
            LaunchedEffect(Unit) {
                pop.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow))
            }
            Text(
                text = seconds.toString(),
                style = CountdownTextStyle,
                modifier = Modifier.graphicsLayer {
                    val scale = 0.55f + 0.45f * pop.value
                    scaleX = scale
                    scaleY = scale
                    alpha = pop.value.coerceIn(0f, 1f)
                },
            )
        }
        if (strip != null) {
            Text(
                text = stringResource(R.string.cam_strip_progress, strip.currentShot, strip.total),
                style = OverlayLabelStyle.copy(fontSize = 15.sp, color = FfColors.Flash),
            )
            Spacer(Modifier.height(6.dp))
        }
        Text(text = stringResource(R.string.cam_tap_to_cancel), style = OverlayLabelStyle)
    }
}

/** Striscia di carta che si riempie scatto dopo scatto, in bianco e nero come sara stampata. */
@Composable
private fun StripProgressOverlay(strip: StripProgress) {
    val grayscale = remember { ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) }) }
    val stripShape = RoundedCornerShape(4.dp)
    Column(
        modifier = Modifier
            .width(70.dp)
            .shadow(elevation = 10.dp, shape = stripShape)
            .background(FfColors.Paper, stripShape)
            .padding(5.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        for (index in 0 until strip.total) {
            key(index) {
                val thumb = strip.thumbnails.getOrNull(index)
                val isNext = index == strip.thumbnails.size
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(4f / 3f)
                        .background(if (isNext) FfColors.Flash else FfColors.Fog),
                    contentAlignment = Alignment.Center,
                ) {
                    if (thumb != null) {
                        val image = remember(thumb) { thumb.asImageBitmap() }
                        Image(
                            bitmap = image,
                            contentDescription = null,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Crop,
                            colorFilter = grayscale,
                        )
                    } else {
                        Text(
                            text = (index + 1).toString(),
                            style = LabelTextStyle,
                            color = if (isNext) FfColors.Ink else FfColors.Graphite.copy(alpha = 0.6f),
                        )
                    }
                }
            }
        }
    }
}

private enum class PillKind { INSTANT, PRINTING, PRINTED }

/** In alto nel mirino: modalita stampa istantanea, avanzamento della stampa, esito. */
@Composable
private fun StatusPill(
    ui: CameraUiState,
    instantPrint: Boolean,
    printerState: PrinterState,
    modifier: Modifier = Modifier,
) {
    val kind = when {
        ui.showPrinted -> PillKind.PRINTED
        ui.pendingPrints > 0 -> PillKind.PRINTING
        instantPrint && ui.mode == CaptureMode.PHOTO -> PillKind.INSTANT
        else -> null
    }
    Crossfade(
        targetState = kind,
        modifier = modifier,
        animationSpec = tween(durationMillis = 220),
        label = "cameraStatusPill",
    ) { current ->
        when (current) {
            PillKind.PRINTED -> Pill(container = FfColors.Mint, content = FfColors.Ink) {
                Icon(imageVector = Icons.Rounded.CheckCircle, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(text = stringResource(R.string.cam_printed), style = LabelTextStyle)
            }
            PillKind.PRINTING -> Pill(container = Color.Black.copy(alpha = 0.62f), content = Color.White) {
                val progress = (printerState as? PrinterState.Printing)?.progress
                if (progress != null) {
                    CircularProgressIndicator(
                        progress = { progress },
                        modifier = Modifier.size(14.dp),
                        color = FfColors.Flash,
                        strokeWidth = 2.dp,
                        trackColor = Color.White.copy(alpha = 0.25f),
                    )
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        color = FfColors.Flash,
                        strokeWidth = 2.dp,
                        trackColor = Color.Transparent,
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (progress != null) {
                        stringResource(R.string.cam_printing_percent, (progress.coerceIn(0f, 1f) * 100f).roundToInt())
                    } else {
                        stringResource(R.string.cam_printing)
                    },
                    style = LabelTextStyle,
                )
                if (ui.pendingPrints > 1) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.cam_printing_queue, ui.pendingPrints - 1),
                        style = LabelTextStyle,
                        color = FfColors.Flash,
                    )
                }
            }
            PillKind.INSTANT -> Pill(container = FfColors.Flash, content = FfColors.Ink) {
                Icon(imageVector = Icons.Rounded.Bolt, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text(text = stringResource(R.string.cam_instant_print), style = LabelTextStyle)
            }
            null -> Spacer(Modifier.size(0.dp))
        }
    }
}

@Composable
private fun Pill(
    container: Color,
    content: Color,
    modifier: Modifier = Modifier,
    body: @Composable RowScope.() -> Unit,
) {
    CompositionLocalProvider(LocalContentColor provides content) {
        Row(
            modifier = modifier
                .clip(PillShape)
                .background(container)
                .padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = body,
        )
    }
}

@Composable
private fun CameraUnavailableOverlay() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = Icons.Rounded.NoPhotography,
            contentDescription = null,
            tint = FfColors.Coral,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.cam_unavailable_title),
            style = MaterialTheme.typography.titleLarge.copy(fontFamily = FfFonts.Display),
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.cam_unavailable_message),
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.72f),
            textAlign = TextAlign.Center,
        )
    }
}

// -----------------------------------------------------------------------------------------
// Barra in basso
// -----------------------------------------------------------------------------------------

@Composable
private fun ModeRow(
    mode: CaptureMode,
    enabled: Boolean,
    onSelect: (CaptureMode) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CamIconButton(
            icon = Icons.Rounded.History,
            label = stringResource(R.string.cam_cd_history),
            onClick = onOpenHistory,
        )
        Row(
            modifier = Modifier
                .weight(1f)
                .selectableGroup(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ModeTab(
                text = stringResource(R.string.cam_mode_photo),
                selected = mode == CaptureMode.PHOTO,
                enabled = enabled,
                onClick = { onSelect(CaptureMode.PHOTO) },
            )
            Spacer(Modifier.width(6.dp))
            ModeTab(
                text = stringResource(R.string.cam_mode_strip),
                selected = mode == CaptureMode.STRIP,
                enabled = enabled,
                onClick = { onSelect(CaptureMode.STRIP) },
            )
        }
        CamIconButton(
            icon = Icons.Rounded.Settings,
            label = stringResource(R.string.cam_cd_settings),
            onClick = onOpenSettings,
        )
    }
}

@Composable
private fun ModeTab(text: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val color by animateColorAsState(
        targetValue = when {
            selected -> FfColors.Flash
            enabled -> Color.White.copy(alpha = 0.66f)
            else -> Color.White.copy(alpha = 0.3f)
        },
        label = "modeTabColor",
    )
    val dot by animateFloatAsState(targetValue = if (selected) 1f else 0f, label = "modeTabDot")
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .selectable(selected = selected, enabled = enabled, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = text, style = LabelTextStyle.copy(fontSize = 13.sp, letterSpacing = 1.6.sp), color = color)
        Spacer(Modifier.height(5.dp))
        Box(
            modifier = Modifier
                .size(5.dp)
                .graphicsLayer {
                    scaleX = dot
                    scaleY = dot
                    alpha = dot
                }
                .background(FfColors.Flash, CircleShape),
        )
    }
}

@Composable
private fun GalleryButton(label: String, onClick: () -> Unit, enabled: Boolean, importing: Boolean) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier = Modifier
            .size(56.dp)
            .clip(shape)
            .background(Color.White.copy(alpha = 0.10f))
            .border(width = 1.5.dp, color = Color.White.copy(alpha = if (enabled) 0.55f else 0.2f), shape = shape)
            .clickable(enabled = enabled && !importing, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (importing) {
            CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                color = FfColors.Flash,
                strokeWidth = 2.5.dp,
                trackColor = Color.Transparent,
            )
        } else {
            Icon(
                imageVector = Icons.Rounded.PhotoLibrary,
                contentDescription = label,
                tint = if (enabled) Color.White else Color.White.copy(alpha = 0.32f),
                modifier = Modifier.size(26.dp),
            )
        }
    }
}

/** Pulsante tondo su vetro scuro per i comandi del mirino; [active] lo accende di giallo. */
@Composable
private fun CamIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    enabled: Boolean = true,
    size: Dp = 48.dp,
    iconRotation: Float = 0f,
) {
    val tint by animateColorAsState(
        targetValue = when {
            !enabled -> Color.White.copy(alpha = 0.32f)
            active -> FfColors.Flash
            else -> Color.White
        },
        label = "camIconTint",
    )
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.10f))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = tint,
            modifier = Modifier
                .size(size * 0.5f)
                .graphicsLayer { rotationZ = iconRotation },
        )
    }
}

@Composable
private fun CamSnackbarHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(hostState = state, modifier = modifier) { data ->
        // Avvisi color carta, come uno scontrino appoggiato sul mirino.
        Snackbar(
            snackbarData = data,
            shape = RoundedCornerShape(16.dp),
            containerColor = FfColors.Paper,
            contentColor = FfColors.Ink,
            actionColor = FfColors.Ink,
            dismissActionContentColor = FfColors.Graphite,
        )
    }
}

// =========================================================================================
// Permesso negato
// =========================================================================================

@Composable
private fun PermissionContent(
    canAskAgain: Boolean,
    importing: Boolean,
    printerState: PrinterState,
    snackbarHostState: SnackbarHostState,
    onRequestPermission: () -> Unit,
    onOpenAppSettings: () -> Unit,
    onGallery: () -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenPrinter: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 64.dp)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PrinterStatusChip(
                state = printerState,
                onClick = onOpenPrinter,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CamIconButton(
                    icon = Icons.Rounded.History,
                    label = stringResource(R.string.cam_cd_history),
                    onClick = onOpenHistory,
                )
                CamIconButton(
                    icon = Icons.Rounded.Settings,
                    label = stringResource(R.string.cam_cd_settings),
                    onClick = onOpenSettings,
                )
            }
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = 480.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 28.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(112.dp)
                        .background(FfColors.Flash, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.PhotoCamera,
                        contentDescription = null,
                        tint = FfColors.Ink,
                        modifier = Modifier.size(52.dp),
                    )
                }
                Spacer(Modifier.height(24.dp))
                Text(
                    text = stringResource(R.string.cam_perm_title),
                    style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FfFonts.Display),
                    color = Color.White,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = stringResource(
                        if (canAskAgain) R.string.cam_perm_message else R.string.cam_perm_message_blocked,
                    ),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.White.copy(alpha = 0.74f),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(32.dp))
                FlashButton(
                    text = stringResource(
                        if (canAskAgain) R.string.cam_perm_allow else R.string.cam_perm_open_settings,
                    ),
                    onClick = if (canAskAgain) onRequestPermission else onOpenAppSettings,
                    modifier = Modifier.fillMaxWidth(),
                    icon = if (canAskAgain) Icons.Rounded.PhotoCamera else Icons.Rounded.Settings,
                )
                Spacer(Modifier.height(12.dp))
                GhostButton(
                    text = stringResource(R.string.cam_perm_gallery),
                    onClick = onGallery,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.PhotoLibrary,
                    enabled = !importing,
                )
            }
        }
        CamSnackbarHost(
            state = snackbarHostState,
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
        )
    }
}

// =========================================================================================
// Utilita
// =========================================================================================

private fun Context.hasCameraPermission(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** true se il sistema suggerisce di spiegare il permesso: c'e gia stato un rifiuto, non definitivo. */
private fun Context.cameraRationale(): Boolean =
    findActivity()?.let { ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.CAMERA) } ?: false

private fun openAppSettings(context: Context) {
    val details = Intent(SystemSettings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(details)
    } catch (e: ActivityNotFoundException) {
        // Alcune ROM non hanno la pagina di dettaglio: almeno le impostazioni generali.
        Log.w(TAG, "pagina impostazioni dell'app non disponibile", e)
        try {
            context.startActivity(Intent(SystemSettings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (fallback: ActivityNotFoundException) {
            Log.e(TAG, "impostazioni di sistema non raggiungibili", fallback)
        }
    }
}

/** Testo breve per un errore di stampa quando il messaggio del PrinterManager manca. */
private fun failureText(failure: PrintFailure?): Int = when (failure) {
    PrintFailure.NO_PRINTER -> R.string.cam_print_failed_no_printer
    PrintFailure.NO_PERMISSION -> R.string.cam_print_failed_no_permission
    PrintFailure.BLUETOOTH_OFF -> R.string.cam_print_failed_bluetooth_off
    PrintFailure.NOT_BONDED -> R.string.cam_print_failed_not_bonded
    PrintFailure.CONNECT_FAILED -> R.string.cam_print_failed_connect
    PrintFailure.WRITE_FAILED -> R.string.cam_print_failed_write
    PrintFailure.BUSY -> R.string.cam_print_failed_busy
    PrintFailure.RENDER_FAILED -> R.string.cam_print_failed_render
    null -> R.string.cam_error_print_generic
}
