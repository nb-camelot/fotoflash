package io.github.nik2208.fotoflash.onboarding

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.BluetoothSearching
import androidx.compose.material.icons.rounded.Bluetooth
import androidx.compose.material.icons.rounded.BluetoothDisabled
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Grain
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SettingsBluetooth
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.PrinterLink
import io.github.nik2208.fotoflash.ui.components.BrandWordmark
import io.github.nik2208.fotoflash.ui.components.ChoiceChipsRow
import io.github.nik2208.fotoflash.ui.components.FlashButton
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.PrinterStatusChip
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val PAGE_SNAP = 0
private const val PAGE_PRINT = 1
private const val PAGE_KEEP = 2
private const val PAGE_PERMISSIONS = 3
private const val PAGE_PRINTER = 4
private const val PAGE_COUNT = 5
private const val PRINTER_POLL_MS = 3_000L

@Composable
fun OnboardingScreen(onFinished: () -> Unit) {
    // Sempre chiaro: l'onboarding e la "carta" del brand, anche con il telefono in tema scuro.
    FotoFlashTheme(darkTheme = false) {
        OnboardingContent(onFinished = onFinished)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun OnboardingContent(onFinished: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val vm = viewModel { OnboardingViewModel(graph) }
    val state by vm.state.collectAsStateWithLifecycle()
    val printerState by vm.printerState.collectAsStateWithLifecycle()
    val pagerState = rememberPagerState(pageCount = { PAGE_COUNT })
    val scope = rememberCoroutineScope()

    val activity = remember(context) { context.findActivity() }
    val bluetoothPermissions = remember { vm.bluetoothPermissions() }
    val scanPermissions = remember { vm.scanPermissions() }
    val scanNeedsLocation = remember { vm.scanNeedsLocationPermission() }
    // Contatore che forza la rilettura dei permessi (dopo la richiesta o al ritorno dalle impostazioni).
    var permissionTick by remember { mutableIntStateOf(0) }
    // Separati: chiedere il Bluetooth dalla pagina stampante non deve far risultare "negata" la fotocamera.
    var cameraAsked by rememberSaveable { mutableStateOf(false) }
    var bluetoothAsked by rememberSaveable { mutableStateOf(false) }
    var scanAsked by rememberSaveable { mutableStateOf(false) }
    val cameraGranted = remember(permissionTick) { isGranted(context, Manifest.permission.CAMERA) }
    val bluetoothGranted = remember(permissionTick) { bluetoothPermissions.all { isGranted(context, it) } }
    val allGranted = cameraGranted && bluetoothGranted
    // "Negato per sempre": gia chiesto, ancora negato e il sistema non mostrerebbe piu la richiesta.
    // Il rationale e false anche prima della prima richiesta: per questo conta solo dopo averla fatta.
    val cameraBlocked = remember(permissionTick, cameraAsked) {
        cameraAsked && !isGranted(context, Manifest.permission.CAMERA) &&
            isBlocked(activity, Manifest.permission.CAMERA)
    }
    val bluetoothBlocked = remember(permissionTick, bluetoothAsked) {
        bluetoothAsked && bluetoothPermissions.any { !isGranted(context, it) && isBlocked(activity, it) }
    }
    // Da Android 12 i permessi della ricerca sono gli stessi della pagina dei permessi: gia chiesti li.
    val scanEverAsked = scanAsked || (bluetoothAsked && scanPermissions.any { it in bluetoothPermissions })
    val scanBlocked = remember(permissionTick, scanEverAsked) {
        scanEverAsked && scanPermissions.any { !isGranted(context, it) && isBlocked(activity, it) }
    }
    val permanentlyDenied = cameraBlocked || bluetoothBlocked
    // Dopo un solo rifiuto Android mostra di nuovo la richiesta: quei permessi si richiedono ancora.
    val requestable = buildList<String> {
        if (!cameraGranted && !cameraBlocked) add(Manifest.permission.CAMERA)
        if (!bluetoothGranted && !bluetoothBlocked) addAll(bluetoothPermissions)
    }.distinct()

    fun goTo(page: Int) {
        scope.launch { pagerState.animateScrollToPage(page) }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        // Un risultato vuoto (richiesta annullata dal sistema) non conta come risposta dell'utente.
        if (Manifest.permission.CAMERA in result) cameraAsked = true
        if (bluetoothPermissions.any { it in result }) bluetoothAsked = true
        permissionTick++
        vm.refresh()
        val granted = isGranted(context, Manifest.permission.CAMERA) &&
            bluetoothPermissions.all { isGranted(context, it) }
        if (granted) goTo(PAGE_PRINTER)
    }

    // Permessi della sola ricerca (la posizione fino ad Android 11): appena concessi si cerca davvero.
    val scanPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        if (scanPermissions.any { it in result }) scanAsked = true
        permissionTick++
        vm.refresh()
        if (scanPermissions.all { isGranted(context, it) }) vm.startScan()
    }

    var resumed by remember { mutableStateOf(false) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        resumed = true
        permissionTick++
        vm.refresh()
    }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) {
        resumed = false
        // In background la ricerca consumerebbe batteria senza che nessuno guardi i risultati.
        vm.stopScan()
    }
    val onPrinterPage = pagerState.currentPage == PAGE_PRINTER
    // Sulla pagina stampante si ricontrolla ogni pochi secondi: il Bluetooth acceso dalla tendina
    // o una stampante appena accoppiata compaiono senza dover toccare "Aggiorna".
    LaunchedEffect(onPrinterPage, resumed) {
        if (onPrinterPage && resumed) {
            while (true) {
                vm.refresh()
                delay(PRINTER_POLL_MS)
            }
        }
    }
    // La prima ricerca BLE parte da sola appena e possibile; lasciando la pagina si ferma.
    val canScan = state.checked && state.bluetoothAvailable && state.bluetoothEnabled &&
        state.hasScanPermission && !state.locationOff
    LaunchedEffect(onPrinterPage, resumed, canScan) {
        if (onPrinterPage && resumed && canScan) vm.autoScan()
        if (!onPrinterPage) vm.stopScan()
    }

    val finish: () -> Unit = { vm.finish(onFinished) }
    val page = pagerState.currentPage
    // Dalla pagina stampante (raggiungibile anche scorrendo, senza aver toccato "Consenti").
    val grantBluetooth: () -> Unit = {
        if (bluetoothBlocked || bluetoothPermissions.isEmpty()) {
            openAppSettings(context)
        } else {
            permissionLauncher.launch(bluetoothPermissions.toTypedArray())
        }
    }
    // "Cerca": prima i permessi, poi la Localizzazione (fino ad Android 11), poi la ricerca vera.
    val search: () -> Unit = {
        when {
            !scanPermissions.all { isGranted(context, it) } -> if (scanBlocked) {
                openAppSettings(context)
            } else {
                scanPermissionLauncher.launch(scanPermissions.toTypedArray())
            }
            state.locationOff -> openLocationSettings(context)
            else -> vm.startScan()
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = FfColors.Paper, contentColor = FfColors.Ink) {
        Column(modifier = Modifier.fillMaxSize().systemBarsPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 24.dp, top = 8.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrandWordmark(height = 28.dp)
                Spacer(modifier = Modifier.weight(1f))
                TextButton(onClick = finish, enabled = !state.finishing) {
                    Text(text = stringResource(R.string.onb_skip), color = FfColors.Graphite)
                }
            }

            HorizontalPager(
                state = pagerState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) { index ->
                when (index) {
                    PAGE_SNAP -> IntroPage(
                        image = R.drawable.ill_onboarding_snap,
                        title = stringResource(R.string.onb_snap_title),
                        text = stringResource(R.string.onb_snap_text),
                    )

                    PAGE_PRINT -> IntroPage(
                        image = R.drawable.ill_onboarding_print,
                        title = stringResource(R.string.onb_print_title),
                        text = stringResource(R.string.onb_print_text),
                    )

                    PAGE_KEEP -> IntroPage(
                        image = R.drawable.ill_onboarding_keep,
                        title = stringResource(R.string.onb_keep_title),
                        text = stringResource(R.string.onb_keep_text),
                    )

                    PAGE_PERMISSIONS -> PermissionsPage(
                        cameraGranted = cameraGranted,
                        bluetoothNeeded = bluetoothPermissions.isNotEmpty(),
                        bluetoothGranted = bluetoothGranted,
                        cameraAsked = cameraAsked,
                        bluetoothAsked = bluetoothAsked,
                        permanentlyDenied = permanentlyDenied,
                        onOpenAppSettings = { openAppSettings(context) },
                    )

                    else -> PrinterPage(
                        state = state,
                        printerState = printerState,
                        bluetoothBlocked = bluetoothBlocked,
                        scanBlocked = scanBlocked,
                        scanNeedsLocation = scanNeedsLocation,
                        actions = PrinterPageActions(
                            onSelect = vm::select,
                            onGrantBluetooth = grantBluetooth,
                            onOpenBluetoothSettings = { openBluetoothSettings(context) },
                            onRefresh = vm::refresh,
                            onSearch = search,
                            onOpenLocationSettings = { openLocationSettings(context) },
                            onDriver = vm::setDriver,
                            onUseDither = vm::useDither,
                            onTestPage = vm::printTestPage,
                        ),
                    )
                }
            }

            PageDots(
                count = PAGE_COUNT,
                current = page,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(vertical = 16.dp),
            )

            // "Consenti" resta finche il sistema mostrerebbe ancora la richiesta; con un permesso negato
            // per sempre rilanciarla sarebbe un pulsante morto: si va avanti e c'e "Apri impostazioni dell'app".
            val askPermissions = page == PAGE_PERMISSIONS && !allGranted && requestable.isNotEmpty()
            val primaryText = when {
                page < PAGE_KEEP -> stringResource(R.string.onb_next)
                page == PAGE_KEEP -> stringResource(R.string.onb_start)
                askPermissions -> stringResource(R.string.onb_perm_allow)
                page == PAGE_PERMISSIONS -> stringResource(R.string.onb_next)
                else -> stringResource(R.string.onb_done)
            }
            val onPrimary: () -> Unit = {
                when {
                    page < PAGE_PERMISSIONS -> goTo(page + 1)
                    askPermissions -> permissionLauncher.launch(requestable.toTypedArray())
                    page == PAGE_PERMISSIONS -> goTo(PAGE_PRINTER)
                    else -> finish()
                }
            }
            FlashButton(
                text = primaryText,
                onClick = onPrimary,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
                enabled = !state.finishing,
                busy = state.finishing,
            )
            Spacer(modifier = Modifier.height(20.dp))
        }
    }
}

/** Azioni della pagina stampante: raccolte qui per non avere una firma con dieci lambda. */
private class PrinterPageActions(
    val onSelect: (PrinterDevice) -> Unit,
    val onGrantBluetooth: () -> Unit,
    val onOpenBluetoothSettings: () -> Unit,
    val onRefresh: () -> Unit,
    val onSearch: () -> Unit,
    val onOpenLocationSettings: () -> Unit,
    val onDriver: (String) -> Unit,
    val onUseDither: (DitherAlgorithm) -> Unit,
    val onTestPage: () -> Unit,
)

// --- Pagine ---------------------------------------------------------------------------------

@Composable
private fun IntroPage(@DrawableRes image: Int, title: String, text: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painter = painterResource(image),
            contentDescription = null,
            modifier = Modifier
                .weight(1f, fill = false)
                .widthIn(max = 320.dp)
                .fillMaxWidth()
                .aspectRatio(4f / 3f),
            contentScale = ContentScale.Fit,
        )
        Spacer(modifier = Modifier.height(28.dp))
        Text(
            text = title,
            fontFamily = FfFonts.Display,
            fontSize = 44.sp,
            lineHeight = 48.sp,
            textAlign = TextAlign.Center,
            color = FfColors.Ink,
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = FfColors.Graphite,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun PermissionsPage(
    cameraGranted: Boolean,
    bluetoothNeeded: Boolean,
    bluetoothGranted: Boolean,
    cameraAsked: Boolean,
    bluetoothAsked: Boolean,
    permanentlyDenied: Boolean,
    onOpenAppSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        StepTitle(text = stringResource(R.string.onb_perm_title))
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.onb_perm_text),
            style = MaterialTheme.typography.bodyLarge,
            color = FfColors.Graphite,
        )
        Spacer(modifier = Modifier.height(24.dp))
        PermissionCard(
            icon = Icons.Rounded.PhotoCamera,
            title = stringResource(R.string.onb_perm_camera),
            description = stringResource(R.string.onb_perm_camera_desc),
            status = permissionStatus(cameraGranted, cameraAsked),
        )
        if (bluetoothNeeded) {
            Spacer(modifier = Modifier.height(12.dp))
            PermissionCard(
                icon = Icons.Rounded.Bluetooth,
                title = stringResource(R.string.onb_perm_bluetooth),
                description = stringResource(R.string.onb_perm_bluetooth_desc),
                status = permissionStatus(bluetoothGranted, bluetoothAsked),
            )
        }
        // Solo quando la richiesta non comparirebbe piu: prima di allora basta "Consenti".
        if (permanentlyDenied && !(cameraGranted && bluetoothGranted)) {
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = stringResource(R.string.onb_perm_denied_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = FfColors.Graphite,
            )
            Spacer(modifier = Modifier.height(12.dp))
            GhostButton(
                text = stringResource(R.string.onb_perm_settings),
                onClick = onOpenAppSettings,
                icon = Icons.Rounded.Settings,
            )
        }
    }
}

@Composable
private fun PrinterPage(
    state: OnboardingUiState,
    printerState: PrinterState,
    bluetoothBlocked: Boolean,
    scanBlocked: Boolean,
    scanNeedsLocation: Boolean,
    actions: PrinterPageActions,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StepTitle(text = stringResource(R.string.onb_printer_title), modifier = Modifier.weight(1f))
            IconButton(onClick = actions.onRefresh) {
                Icon(
                    imageVector = Icons.Rounded.Refresh,
                    contentDescription = stringResource(R.string.onb_refresh),
                    tint = FfColors.Graphite,
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.onb_printer_text),
            style = MaterialTheme.typography.bodyLarge,
            color = FfColors.Graphite,
        )
        Spacer(modifier = Modifier.height(20.dp))

        when {
            !state.checked -> Box(modifier = Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = FfColors.Ink)
            }

            !state.bluetoothAvailable -> Notice(
                icon = Icons.Rounded.BluetoothDisabled,
                text = stringResource(R.string.onb_printer_bt_unavailable),
            )

            // Senza un'azione qui l'unica via sarebbe tornare a mano alla pagina dei permessi.
            !state.hasBluetoothPermission -> Column {
                Notice(
                    icon = Icons.Rounded.Bluetooth,
                    text = stringResource(R.string.onb_printer_no_permission),
                )
                Spacer(modifier = Modifier.height(12.dp))
                GhostButton(
                    text = stringResource(if (bluetoothBlocked) R.string.onb_perm_settings else R.string.onb_perm_allow),
                    onClick = actions.onGrantBluetooth,
                    icon = if (bluetoothBlocked) Icons.Rounded.Settings else Icons.Rounded.Bluetooth,
                )
            }

            !state.bluetoothEnabled -> Column {
                Notice(
                    icon = Icons.Rounded.BluetoothDisabled,
                    text = stringResource(R.string.onb_printer_bt_off),
                )
                Spacer(modifier = Modifier.height(12.dp))
                GhostButton(
                    text = stringResource(R.string.onb_open_bt_settings),
                    onClick = actions.onOpenBluetoothSettings,
                    icon = Icons.Rounded.Settings,
                )
            }

            else -> Column {
                PairedSection(state = state, actions = actions)
                Spacer(modifier = Modifier.height(28.dp))
                NearbySection(
                    state = state,
                    scanBlocked = scanBlocked,
                    scanNeedsLocation = scanNeedsLocation,
                    actions = actions,
                )
            }
        }

        val selected = state.selected
        if (selected != null && state.bluetoothAvailable) {
            Spacer(modifier = Modifier.height(28.dp))
            DriverCard(
                choice = selected,
                driverId = state.driverId,
                dither = state.dither,
                onDriver = actions.onDriver,
                onUseDither = actions.onUseDither,
            )
            Spacer(modifier = Modifier.height(20.dp))
            PrinterStatusChip(state = printerState, onClick = actions.onRefresh)
            Spacer(modifier = Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                GhostButton(
                    text = stringResource(R.string.onb_test_page),
                    onClick = actions.onTestPage,
                    icon = Icons.Rounded.Print,
                    enabled = !state.testing,
                )
                if (state.testing) {
                    Spacer(modifier = Modifier.width(12.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        color = FfColors.Ink,
                        strokeWidth = 2.dp,
                    )
                }
            }
            state.testResult?.let { result ->
                Spacer(modifier = Modifier.height(12.dp))
                TestResultLine(result = result)
            }
        }

        Spacer(modifier = Modifier.height(20.dp))
        Text(
            text = stringResource(R.string.onb_printer_later),
            style = MaterialTheme.typography.bodySmall,
            color = FfColors.Graphite,
        )
    }
}

/** Stampanti accoppiate nelle impostazioni Bluetooth: si usano in SPP. */
@Composable
private fun PairedSection(state: OnboardingUiState, actions: PrinterPageActions) {
    ListTitle(text = stringResource(R.string.onb_printer_paired))
    Spacer(modifier = Modifier.height(10.dp))
    if (state.bonded.isEmpty()) {
        Notice(
            icon = Icons.AutoMirrored.Rounded.BluetoothSearching,
            text = stringResource(R.string.onb_printer_none),
        )
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.bonded.forEach { device ->
                PrinterOption(
                    device = device,
                    selected = state.selected?.matches(device) == true,
                    onClick = { actions.onSelect(device) },
                )
            }
        }
    }
    Spacer(modifier = Modifier.height(12.dp))
    GhostButton(
        text = stringResource(R.string.onb_open_bt_settings),
        onClick = actions.onOpenBluetoothSettings,
        icon = Icons.Rounded.SettingsBluetooth,
    )
}

/** Stampanti Bluetooth LE trovate con la ricerca (Phomemo e simili): non serve accoppiarle. */
@Composable
private fun NearbySection(
    state: OnboardingUiState,
    scanBlocked: Boolean,
    scanNeedsLocation: Boolean,
    actions: PrinterPageActions,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        ListTitle(text = stringResource(R.string.onb_printer_nearby), modifier = Modifier.weight(1f))
        TextButton(
            onClick = actions.onSearch,
            enabled = !state.scanning,
            colors = ButtonDefaults.textButtonColors(contentColor = FfColors.Ink),
        ) {
            if (state.scanning) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), color = FfColors.Ink, strokeWidth = 2.dp)
            } else {
                Icon(imageVector = Icons.Rounded.Search, contentDescription = null, modifier = Modifier.size(18.dp))
            }
            Spacer(modifier = Modifier.width(6.dp))
            Text(text = stringResource(if (state.scanning) R.string.onb_scan_running else R.string.onb_scan))
        }
    }
    Spacer(modifier = Modifier.height(10.dp))
    when {
        !state.hasScanPermission -> {
            Notice(
                icon = if (scanNeedsLocation) Icons.Rounded.LocationOn else Icons.Rounded.Bluetooth,
                text = stringResource(
                    if (scanNeedsLocation) R.string.onb_scan_permission_location else R.string.onb_scan_permission_nearby,
                ),
            )
            Spacer(modifier = Modifier.height(12.dp))
            GhostButton(
                text = stringResource(if (scanBlocked) R.string.onb_perm_settings else R.string.onb_perm_allow),
                onClick = actions.onSearch,
                icon = if (scanBlocked) Icons.Rounded.Settings else Icons.Rounded.Search,
            )
        }

        state.locationOff -> {
            Notice(icon = Icons.Rounded.LocationOn, text = stringResource(R.string.onb_scan_location_off))
            Spacer(modifier = Modifier.height(12.dp))
            GhostButton(
                text = stringResource(R.string.onb_scan_location_settings),
                onClick = actions.onOpenLocationSettings,
                icon = Icons.Rounded.LocationOn,
            )
        }

        state.nearby.isNotEmpty() -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.nearby.forEach { device ->
                PrinterOption(
                    device = device,
                    selected = state.selected?.matches(device) == true,
                    onClick = { actions.onSelect(device) },
                )
            }
        }

        state.scanning -> Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(FfColors.Fog)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = FfColors.Ink, strokeWidth = 2.dp)
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = stringResource(R.string.onb_scan_progress),
                style = MaterialTheme.typography.bodyMedium,
                color = FfColors.Ink,
            )
        }

        state.scanned -> Notice(
            icon = Icons.AutoMirrored.Rounded.BluetoothSearching,
            text = stringResource(R.string.onb_scan_none),
        )

        else -> Text(
            text = stringResource(R.string.onb_scan_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = FfColors.Graphite,
        )
    }
}

/**
 * Driver della stampante scelta: riconosciuto dal nome, ma modificabile, perche molti cloni
 * annunciano nomi generici. Avvisa se il collegamento scelto non va bene per quel driver.
 */
@Composable
private fun DriverCard(
    choice: PrinterChoice,
    driverId: String,
    dither: DitherAlgorithm,
    onDriver: (String) -> Unit,
    onUseDither: (DitherAlgorithm) -> Unit,
) {
    val driver = remember(driverId) { PrinterDrivers.byId(driverId) }
    val guessed = remember(choice.name) { PrinterDrivers.guess(choice.name) }
    // Per id: le stringhe si confrontano per valore, qualunque cosa restituisca byId.
    val driverIds = remember { PrinterDrivers.all.map { it.id } }
    val driverNames = remember { PrinterDrivers.all.associate { it.id to it.displayName } }
    // La M02X parla un protocollo diverso (docs/DRIVERS.md): stesse regole di guess(), nel core.
    val unsupported = remember(choice.name) { PrinterDrivers.isUnsupported(choice.name) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(FfColors.Fog)
            .padding(16.dp),
    ) {
        Text(
            text = stringResource(R.string.onb_driver_title),
            style = MaterialTheme.typography.titleMedium,
            color = FfColors.Ink,
        )
        Text(
            text = stringResource(R.string.onb_driver_for, choice.name, linkLabel(choice.link)),
            style = MaterialTheme.typography.bodySmall,
            color = FfColors.Graphite,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(12.dp))
        ChoiceChipsRow(
            options = driverIds,
            selected = driver.id,
            label = { id -> driverNames[id] ?: id },
            onSelect = onDriver,
        )
        // Con un modello incompatibile parla solo l'avviso: "riconosciuto" o "scelto da te" sarebbero fuorvianti.
        if (!unsupported) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = when {
                    guessed != null && guessed.id == driver.id -> stringResource(R.string.onb_driver_auto)
                    // Nome muto: si e tenuto l'ESC/POS in uso o si e ripiegato su escpos-58.
                    guessed == null && isEscPosDriverId(driver.id) ->
                        stringResource(R.string.onb_driver_unknown, driver.displayName)
                    else -> stringResource(R.string.onb_driver_manual)
                },
                style = MaterialTheme.typography.bodySmall,
                color = FfColors.Graphite,
            )
        }
        if (unsupported) {
            Spacer(modifier = Modifier.height(12.dp))
            WarningNote(text = stringResource(R.string.onb_driver_unsupported))
        }
        if (choice.link !in driver.links) {
            Spacer(modifier = Modifier.height(12.dp))
            WarningNote(
                text = stringResource(
                    if (PrinterLink.BLE in driver.links) R.string.onb_driver_ble_only else R.string.onb_driver_classic_only,
                ),
            )
        }
        // Si propone solo un retino diverso da quello di serie dell'app (Floyd-Steinberg per le Phomemo):
        // chi ha scelto apposta un altro retino non viene disturbato da ogni driver ESC/POS.
        val suggested = driver.defaultDither
        if (suggested != dither && suggested != AppSettings().dither) {
            Spacer(modifier = Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.Grain,
                    contentDescription = null,
                    tint = FfColors.Ink,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = stringResource(R.string.onb_dither_suggest, ditherLabel(suggested)),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = FfColors.Ink,
                )
                TextButton(
                    onClick = { onUseDither(suggested) },
                    colors = ButtonDefaults.textButtonColors(contentColor = FfColors.Ink),
                ) {
                    Text(text = stringResource(R.string.onb_dither_use), fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// --- Elementi -------------------------------------------------------------------------------

@Composable
private fun StepTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        fontFamily = FfFonts.Display,
        fontSize = 34.sp,
        lineHeight = 38.sp,
        color = FfColors.Ink,
    )
}

@Composable
private fun ListTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        fontFamily = FfFonts.Mono,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        color = FfColors.Graphite,
    )
}

private enum class PermissionStatus { GRANTED, DENIED, PENDING }

private fun permissionStatus(granted: Boolean, asked: Boolean): PermissionStatus = when {
    granted -> PermissionStatus.GRANTED
    asked -> PermissionStatus.DENIED
    else -> PermissionStatus.PENDING
}

@Composable
private fun PermissionCard(icon: ImageVector, title: String, description: String, status: PermissionStatus) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(FfColors.Fog)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(44.dp).clip(CircleShape).background(FfColors.Flash),
            contentAlignment = Alignment.Center,
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = FfColors.Ink)
        }
        Spacer(modifier = Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.titleMedium, color = FfColors.Ink)
            Text(text = description, style = MaterialTheme.typography.bodySmall, color = FfColors.Graphite)
        }
        Spacer(modifier = Modifier.width(8.dp))
        val (label, color) = when (status) {
            PermissionStatus.GRANTED -> stringResource(R.string.onb_perm_granted) to FfColors.Mint
            PermissionStatus.DENIED -> stringResource(R.string.onb_perm_denied) to FfColors.Coral
            PermissionStatus.PENDING -> stringResource(R.string.onb_perm_pending) to FfColors.Graphite
        }
        StatusPill(text = label, color = color)
    }
}

@Composable
private fun StatusPill(text: String, color: Color) {
    // Testo Ink su fondo tinto: Mint e Coral puri su carta non sono leggibili come testo.
    Text(
        text = text,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.28f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        color = FfColors.Ink,
        fontFamily = FfFonts.Mono,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        maxLines = 1,
    )
}

@Composable
private fun Notice(icon: ImageVector, text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(FfColors.Fog)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = FfColors.Graphite)
        Spacer(modifier = Modifier.width(12.dp))
        Text(text = text, style = MaterialTheme.typography.bodyMedium, color = FfColors.Ink)
    }
}

/** Avviso da non ignorare (driver incompatibile): Coral tinto, testo Ink per la leggibilita. */
@Composable
private fun WarningNote(text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(FfColors.Coral.copy(alpha = 0.16f))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Rounded.Warning,
            contentDescription = null,
            tint = FfColors.Coral,
            modifier = Modifier.size(20.dp),
        )
        Spacer(modifier = Modifier.width(10.dp))
        Text(text = text, style = MaterialTheme.typography.bodySmall, color = FfColors.Ink)
    }
}

@Composable
private fun PrinterOption(device: PrinterDevice, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    // Il modello riconosciuto dal nome aiuta a distinguere stampanti dal nome criptico.
    val model = remember(device.name) { PrinterDrivers.guess(device.name)?.displayName }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) FfColors.Flash.copy(alpha = 0.22f) else FfColors.Fog)
            .border(width = 2.dp, color = if (selected) FfColors.Ink else Color.Transparent, shape = shape)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (device.link == PrinterLink.BLE) Icons.Rounded.Bluetooth else Icons.Rounded.Print,
            contentDescription = null,
            tint = FfColors.Ink,
        )
        Spacer(modifier = Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = device.name,
                style = MaterialTheme.typography.titleMedium,
                color = FfColors.Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (model != null) stringResource(R.string.onb_device_detail, device.address, model) else device.address,
                fontFamily = FfFonts.Mono,
                fontSize = 12.sp,
                color = FfColors.Graphite,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(
            imageVector = if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
            contentDescription = if (selected) stringResource(R.string.onb_selected) else null,
            tint = if (selected) FfColors.Ink else FfColors.Graphite.copy(alpha = 0.5f),
        )
    }
}

@Composable
private fun TestResultLine(result: TestPageResult) {
    val (icon, color, text) = when (result) {
        TestPageResult.Success -> Triple(Icons.Rounded.CheckCircle, FfColors.Mint, stringResource(R.string.onb_test_ok))
        is TestPageResult.Failure -> Triple(Icons.Rounded.ErrorOutline, FfColors.Coral, failureText(result.failure))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = text, style = MaterialTheme.typography.bodyMedium, color = FfColors.Ink)
    }
}

@Composable
private fun PageDots(count: Int, current: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val selected = index == current
            val width by animateDpAsState(targetValue = if (selected) 24.dp else 8.dp, label = "onboardingDot")
            Box(
                modifier = Modifier
                    .height(8.dp)
                    .width(width)
                    .clip(CircleShape)
                    .background(if (selected) FfColors.FlashDeep else FfColors.Ink.copy(alpha = 0.16f)),
            )
        }
    }
}

@Composable
private fun failureText(failure: PrintFailure): String = stringResource(
    when (failure) {
        PrintFailure.NO_PRINTER -> R.string.onb_fail_no_printer
        PrintFailure.NO_PERMISSION -> R.string.onb_fail_no_permission
        PrintFailure.BLUETOOTH_OFF -> R.string.onb_fail_bluetooth_off
        PrintFailure.NOT_BONDED -> R.string.onb_fail_not_bonded
        PrintFailure.CONNECT_FAILED -> R.string.onb_fail_connect
        PrintFailure.WRITE_FAILED -> R.string.onb_fail_write
        PrintFailure.BUSY -> R.string.onb_fail_busy
        PrintFailure.RENDER_FAILED -> R.string.onb_fail_render
    },
)

@Composable
private fun linkLabel(link: PrinterLink): String = stringResource(
    when (link) {
        PrinterLink.CLASSIC -> R.string.onb_link_classic
        PrinterLink.BLE -> R.string.onb_link_ble
    },
)

@Composable
private fun ditherLabel(algorithm: DitherAlgorithm): String = stringResource(
    when (algorithm) {
        DitherAlgorithm.ATKINSON -> R.string.onb_dither_atkinson
        DitherAlgorithm.FLOYD_STEINBERG -> R.string.onb_dither_floyd
        DitherAlgorithm.ORDERED_BAYER -> R.string.onb_dither_bayer
        DitherAlgorithm.THRESHOLD -> R.string.onb_dither_threshold
    },
)

// --- Intent di sistema ----------------------------------------------------------------------

private fun isGranted(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

/** Vero se il sistema non mostrerebbe la richiesta. Senza Activity si ripiega sulle impostazioni dell'app. */
private fun isBlocked(activity: Activity?, permission: String): Boolean =
    activity == null || !ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)

/** LocalContext puo essere un ContextWrapper: per il rationale serve l'Activity vera. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

// android.provider.Settings resta qualificato: il nome Settings e gia l'icona importata sopra.
private fun openBluetoothSettings(context: Context) {
    try {
        context.startActivity(Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS))
    } catch (e: ActivityNotFoundException) {
        // Alcune ROM non espongono la pagina Bluetooth: ripieghiamo sulle impostazioni generali.
        openSystemSettings(context)
    }
}

/** Fino ad Android 11 la ricerca BLE richiede la Localizzazione attiva. */
private fun openLocationSettings(context: Context) {
    try {
        context.startActivity(Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS))
    } catch (e: ActivityNotFoundException) {
        openSystemSettings(context)
    }
}

private fun openSystemSettings(context: Context) {
    try {
        context.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
    } catch (ignored: ActivityNotFoundException) {
        // Nessuna app impostazioni: non c'e altro da fare.
    }
}

private fun openAppSettings(context: Context) {
    try {
        context.startActivity(
            Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null),
            ),
        )
    } catch (e: ActivityNotFoundException) {
        openBluetoothSettings(context)
    }
}
