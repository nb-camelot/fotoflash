package io.github.nik2208.fotoflash.printer

import android.bluetooth.BluetoothAdapter
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.BluetoothSearching
import androidx.compose.material.icons.rounded.Bluetooth
import androidx.compose.material.icons.rounded.BluetoothConnected
import androidx.compose.material.icons.rounded.BluetoothDisabled
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCut
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Grain
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.PrintDisabled
import androidx.compose.material.icons.rounded.Receipt
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SettingsBluetooth
import androidx.compose.material.icons.rounded.Straighten
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.Whatshot
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.PrinterDriver
import io.github.nik2208.fotoflash.thermal.PrinterDrivers
import io.github.nik2208.fotoflash.thermal.PrinterLink
import io.github.nik2208.fotoflash.thermal.rasterWidth
import io.github.nik2208.fotoflash.ui.components.ChoiceChipsRow
import io.github.nik2208.fotoflash.ui.components.EmptyState
import io.github.nik2208.fotoflash.ui.components.FfTopBar
import io.github.nik2208.fotoflash.ui.components.FlashButton
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.PaperSheet
import io.github.nik2208.fotoflash.ui.components.SectionHeader
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** Posizione della sezione «Accoppiate» nella lista, per l'azione "Scegli stampante". */
private const val PRINTERS_ITEM_INDEX = 1

/** Azione principale proposta dalla scheda di stato. */
private enum class StatusAction { NONE, GRANT_PERMISSION, ENABLE_BLUETOOTH, CHOOSE_PRINTER, PAIR_PRINTER, PRINT_TEST, RETRY }

/** Come appare la scheda di stato in questo momento. */
private data class StatusModel(
    val icon: ImageVector,
    val accent: Color,
    val title: String,
    val body: String,
    val device: PrinterDevice?,
    /** null = nessuna barra; valore 0..1 = avanzamento; [indeterminate] = attesa senza percentuale. */
    val progress: Float? = null,
    val indeterminate: Boolean = false,
    val action: StatusAction = StatusAction.NONE,
    val showDisconnect: Boolean = false,
)

/** Le due carte dei driver ESC/POS: le altre larghezze appartengono ad altri driver. */
private val ESC_POS_PAPERS: List<PaperWidth> = listOf(PaperWidth.MM58, PaperWidth.MM80)

/**
 * "Stampante e carta": stato della stampante con l'azione giusta al momento giusto, scelta tra le
 * stampanti accoppiate (SPP) e quelle vicine (BLE), modello di stampante (driver), carta, intensita
 * o densita, invio BLE, calibrazione avanzata e consigli pratici.
 */
@Composable
fun PrinterScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val viewModel = viewModel { PrinterViewModel(graph) }
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var confirmForget by rememberSaveable { mutableStateOf(false) }
    var advancedOpen by rememberSaveable { mutableStateOf(false) }

    // Al ritorno dalle impostazioni di sistema permessi, accoppiamenti e Localizzazione possono essere cambiati.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refresh() }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        viewModel.onPermissionResult(result.isNotEmpty() && result.values.all { it })
    }
    // Permessi della ricerca BLE: chiesti solo premendo «Cerca», mai all'apertura della schermata.
    val scanPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        viewModel.onScanPermissionResult(result.isNotEmpty() && result.values.all { it })
    }
    val enableLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { viewModel.refresh() }

    val sentText = stringResource(R.string.prn_test_sent)
    val resetText = stringResource(R.string.prn_reset_done)
    val noSettingsText = stringResource(R.string.prn_settings_unavailable)
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            val text = when (event) {
                PrinterEvent.TestPageSent -> sentText
                PrinterEvent.CalibrationReset -> resetText
                is PrinterEvent.Message -> event.text
            }
            snackbarHostState.showSnackbar(text)
        }
    }

    val openSystemScreen: (Intent) -> Unit = { intent ->
        if (!startSafely(context, intent)) {
            scope.launch { snackbarHostState.showSnackbar(noSettingsText) }
        }
    }
    val openBluetoothSettings: () -> Unit = { openSystemScreen(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
    val openLocationSettings: () -> Unit = { openSystemScreen(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
    val openAppSettings: () -> Unit = {
        openSystemScreen(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
        )
    }
    val requestPermission: () -> Unit = {
        val permissions = viewModel.requiredPermissions()
        // Prima di Android 12 non c'e nulla da chiedere: basta rileggere lo stato.
        if (permissions.isEmpty()) viewModel.refresh() else permissionLauncher.launch(permissions)
    }
    val enableBluetooth: () -> Unit = {
        if (!ui.hasPermission) {
            // ACTION_REQUEST_ENABLE senza BLUETOOTH_CONNECT lancia SecurityException su Android 12+.
            requestPermission()
        } else {
            try {
                enableLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            } catch (_: ActivityNotFoundException) {
                openBluetoothSettings()
            } catch (_: SecurityException) {
                requestPermission()
            }
        }
    }
    val startScan: () -> Unit = {
        val permissions = viewModel.scanPermissions()
        // Senza permessi si chiedono prima; il ViewModel avvia la ricerca appena concessi.
        if (!ui.hasScanPermission && permissions.isNotEmpty()) {
            scanPermissionLauncher.launch(permissions)
        } else {
            viewModel.startScan()
        }
    }
    val onStatusAction: (StatusAction) -> Unit = { action ->
        when (action) {
            StatusAction.GRANT_PERMISSION -> requestPermission()
            StatusAction.ENABLE_BLUETOOTH -> enableBluetooth()
            StatusAction.CHOOSE_PRINTER -> {
                scope.launch { listState.animateScrollToItem(PRINTERS_ITEM_INDEX) }
            }
            StatusAction.PAIR_PRINTER -> openBluetoothSettings()
            StatusAction.PRINT_TEST, StatusAction.RETRY -> viewModel.printTestPage()
            StatusAction.NONE -> Unit
        }
    }

    Scaffold(
        topBar = { FfTopBar(title = stringResource(R.string.prn_title), onBack = onBack) },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        if (!ui.loaded) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            PrinterContent(
                ui = ui,
                padding = padding,
                listState = listState,
                advancedOpen = advancedOpen,
                onToggleAdvanced = { advancedOpen = !advancedOpen },
                onStatusAction = onStatusAction,
                actions = ScreenActions(
                    openAppSettings = openAppSettings,
                    pair = openBluetoothSettings,
                    forget = { confirmForget = true },
                    scan = startScan,
                    openLocationSettings = openLocationSettings,
                    enableBluetooth = enableBluetooth,
                ),
                viewModel = viewModel,
            )
        }
    }

    if (confirmForget) {
        val name = ui.configured?.name.orEmpty()
        AlertDialog(
            onDismissRequest = { confirmForget = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmForget = false
                        viewModel.forget()
                    },
                ) { Text(stringResource(R.string.prn_forget_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmForget = false }) { Text(stringResource(R.string.prn_cancel)) }
            },
            icon = { Icon(Icons.Rounded.DeleteOutline, contentDescription = null) },
            title = { Text(stringResource(R.string.prn_forget_title, name)) },
            text = { Text(stringResource(R.string.prn_forget_body)) },
        )
    }
}

/** Azioni che passano dalle schermate di sistema o dai launcher dei permessi. */
private class ScreenActions(
    val openAppSettings: () -> Unit,
    val pair: () -> Unit,
    val forget: () -> Unit,
    val scan: () -> Unit,
    val openLocationSettings: () -> Unit,
    val enableBluetooth: () -> Unit,
)

/** Contenuto scorrevole della schermata, una sezione per voce della lista. */
@Composable
private fun PrinterContent(
    ui: PrinterUiState,
    padding: PaddingValues,
    listState: LazyListState,
    advancedOpen: Boolean,
    onToggleAdvanced: () -> Unit,
    onStatusAction: (StatusAction) -> Unit,
    actions: ScreenActions,
    viewModel: PrinterViewModel,
) {
    val status = statusModel(ui)
    val driver = ui.driver
    val escPos = PrinterTuning.isEscPos(driver)
    val link = ui.configured?.link
    // Senza stampante scelta si mostra cio che il driver puo usare; con la stampante, il suo collegamento.
    val showBle = link == PrinterLink.BLE || (link == null && PrinterLink.CLASSIC !in driver.links)
    val showSpp = link == PrinterLink.CLASSIC || (link == null && PrinterLink.CLASSIC in driver.links)
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = padding.calculateTopPadding() + 12.dp,
            bottom = padding.calculateBottomPadding() + 32.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "status") {
            StatusCard(
                model = status,
                busy = ui.busy,
                testPrinting = ui.testPrinting,
                showAppSettings = ui.permissionDenied && status.action == StatusAction.GRANT_PERMISSION,
                onAction = onStatusAction,
                onDisconnect = { viewModel.disconnect() },
                onOpenAppSettings = actions.openAppSettings,
            )
        }
        // Deve restare in posizione PRINTERS_ITEM_INDEX: ci scorre l'azione "Scegli stampante".
        item(key = "printers_header") {
            SectionHeader(text = stringResource(R.string.prn_section_printers))
        }
        item(key = "printers") {
            PairedSection(
                ui = ui,
                onSelect = { viewModel.select(it) },
                onPair = actions.pair,
            )
        }
        item(key = "nearby_header") {
            SectionHeader(text = stringResource(R.string.prn_section_nearby))
        }
        item(key = "nearby") {
            NearbySection(
                ui = ui,
                onSelect = { viewModel.select(it) },
                onScan = actions.scan,
                onStopScan = { viewModel.stopScan() },
                onOpenAppSettings = actions.openAppSettings,
                onOpenLocationSettings = actions.openLocationSettings,
                onEnableBluetooth = actions.enableBluetooth,
            )
        }
        if (ui.configured != null) {
            item(key = "forget") {
                GhostButton(
                    text = stringResource(R.string.prn_action_forget),
                    onClick = actions.forget,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.DeleteOutline,
                    enabled = !ui.busy,
                )
            }
        }
        item(key = "driver_header") {
            SectionHeader(text = stringResource(R.string.prn_section_driver))
        }
        item(key = "driver") {
            DriverSection(
                ui = ui,
                onDriver = { viewModel.setDriver(it) },
                onDither = { viewModel.setDither(it) },
            )
        }
        item(key = "paper_header") {
            SectionHeader(text = stringResource(R.string.prn_section_paper))
        }
        item(key = "paper") {
            PaperSection(
                ui = ui,
                onPaper = { viewModel.setPaper(it) },
                onWidthBytes = { viewModel.setPhomemoWidthBytes(it) },
                onFeedLines = { viewModel.setFeedLines(it) },
                onCut = { viewModel.setCutPaper(it) },
            )
        }
        item(key = "heat_header") {
            SectionHeader(text = stringResource(R.string.prn_section_heat))
        }
        item(key = "heat") {
            if (escPos) {
                HeatSection(
                    ui = ui,
                    onHeat = { viewModel.setHeatLevel(it) },
                    onTestPage = { viewModel.printTestPage() },
                )
            } else {
                DensitySection(
                    ui = ui,
                    onDensity = { viewModel.setPhomemoDensity(it) },
                    onSpeed = { viewModel.setPrinterSpeed(it) },
                    onTestPage = { viewModel.printTestPage() },
                )
            }
        }
        if (showBle) {
            item(key = "ble_header") {
                SectionHeader(text = stringResource(R.string.prn_section_ble))
            }
            item(key = "ble") {
                BleSection(
                    ui = ui,
                    onPreset = { viewModel.setBlePreset(it) },
                    onTestPage = { viewModel.printTestPage() },
                )
            }
        }
        // Blocchi e pause valgono solo in SPP, le bande solo per ESC/POS: per una Phomemo in BLE non c'e nulla.
        if (showSpp || escPos) {
            item(key = "advanced") {
                AdvancedSection(
                    ui = ui,
                    showTransfer = showSpp,
                    showBand = escPos,
                    open = advancedOpen,
                    onToggle = onToggleAdvanced,
                    onChunkSize = { viewModel.setChunkSize(it) },
                    onChunkDelay = { viewModel.setChunkDelay(it) },
                    onBandHeight = { viewModel.setBandHeight(it) },
                    onReset = { viewModel.resetAdvanced() },
                )
            }
        }
        item(key = "help_header") {
            SectionHeader(text = stringResource(R.string.prn_section_help))
        }
        item(key = "help") {
            HelpSection()
        }
    }
}

/** Avvia una schermata di sistema; falso se il telefono non ce l'ha. */
private fun startSafely(context: Context, intent: Intent): Boolean = try {
    context.startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
} catch (_: SecurityException) {
    false
}

// -------------------------------------------------------------------------------------------
// Scheda di stato

@Composable
private fun statusModel(ui: PrinterUiState): StatusModel {
    val configured = ui.configured
    if (!ui.bluetoothAvailable) {
        return StatusModel(
            icon = Icons.Rounded.BluetoothDisabled,
            accent = FfColors.Graphite,
            title = stringResource(R.string.prn_status_no_bluetooth_title),
            body = stringResource(R.string.prn_status_no_bluetooth_body),
            device = configured,
        )
    }
    if (!ui.hasPermission) {
        return StatusModel(
            icon = Icons.Rounded.Lock,
            accent = FfColors.Flash,
            title = stringResource(R.string.prn_status_permission_title),
            body = stringResource(R.string.prn_status_permission_body),
            device = configured,
            action = StatusAction.GRANT_PERMISSION,
        )
    }
    if (!ui.bluetoothEnabled) {
        return StatusModel(
            icon = Icons.Rounded.BluetoothDisabled,
            accent = FfColors.Flash,
            title = stringResource(R.string.prn_status_bt_off_title),
            body = stringResource(R.string.prn_status_bt_off_body),
            device = configured,
            action = StatusAction.ENABLE_BLUETOOTH,
        )
    }
    return when (val printer = ui.printer) {
        // Finche l'elenco degli accoppiati non e stato letto, "vuoto" non vuol dire "nessuno". Senza
        // accoppiate il testo spiega anche la ricerca BLE: l'azione porta agli elenchi, dove ci sono entrambe le strade.
        PrinterState.NotConfigured -> StatusModel(
            icon = Icons.Rounded.PrintDisabled,
            accent = FfColors.Flash,
            title = stringResource(R.string.prn_status_none_title),
            body = stringResource(
                if (ui.bondedLoaded && ui.bonded.isEmpty()) R.string.prn_status_none_body_pair else R.string.prn_status_none_body_pick,
            ),
            device = null,
            action = StatusAction.CHOOSE_PRINTER,
        )
        is PrinterState.Disconnected -> {
            val device = printer.device
            // Stampante SPP disaccoppiata nelle impostazioni Bluetooth: lo si dice subito, non al primo
            // tentativo. Le stampanti BLE non si accoppiano, quindi per loro il controllo non vale.
            val unpaired = device.link == PrinterLink.CLASSIC && ui.bondedLoaded &&
                ui.bonded.none { it.device.address.equals(device.address, ignoreCase = true) }
            if (unpaired) {
                StatusModel(
                    icon = Icons.Rounded.ErrorOutline,
                    accent = FfColors.Coral,
                    title = stringResource(R.string.prn_error_title_not_bonded),
                    body = stringResource(R.string.prn_err_not_bonded, device.name),
                    device = device,
                    action = StatusAction.PAIR_PRINTER,
                )
            } else {
                StatusModel(
                    icon = Icons.Rounded.Print,
                    accent = FfColors.Mint,
                    title = stringResource(R.string.prn_status_ready_title),
                    body = stringResource(R.string.prn_status_ready_body),
                    device = device,
                    action = StatusAction.PRINT_TEST,
                )
            }
        }
        is PrinterState.Connecting -> StatusModel(
            icon = Icons.AutoMirrored.Rounded.BluetoothSearching,
            accent = FfColors.Sky,
            title = stringResource(R.string.prn_status_connecting_title),
            body = stringResource(R.string.prn_status_connecting_body),
            device = printer.device,
            indeterminate = true,
        )
        is PrinterState.Connected -> StatusModel(
            icon = Icons.Rounded.BluetoothConnected,
            accent = FfColors.Mint,
            title = stringResource(R.string.prn_status_connected_title),
            body = stringResource(R.string.prn_status_connected_body),
            device = printer.device,
            action = StatusAction.PRINT_TEST,
            showDisconnect = true,
        )
        is PrinterState.Printing -> StatusModel(
            icon = Icons.Rounded.Print,
            accent = FfColors.Sky,
            title = stringResource(R.string.prn_status_printing_title, (printer.progress * 100f).roundToInt()),
            body = stringResource(R.string.prn_status_printing_body),
            device = printer.device,
            progress = printer.progress,
        )
        is PrinterState.Error -> {
            val (titleRes, action) = when (printer.failure) {
                PrintFailure.NO_PERMISSION -> R.string.prn_error_title_permission to StatusAction.GRANT_PERMISSION
                PrintFailure.BLUETOOTH_OFF -> R.string.prn_error_title_bt_off to StatusAction.ENABLE_BLUETOOTH
                PrintFailure.NOT_BONDED -> R.string.prn_error_title_not_bonded to StatusAction.PAIR_PRINTER
                // Qui si puo solo provare con una pagina di prova (non con la foto): l'etichetta lo dice.
                PrintFailure.CONNECT_FAILED -> R.string.prn_error_title_connect to StatusAction.PRINT_TEST
                PrintFailure.WRITE_FAILED -> R.string.prn_error_title_write to StatusAction.PRINT_TEST
                PrintFailure.BUSY -> R.string.prn_error_title_busy to StatusAction.NONE
                PrintFailure.NO_PRINTER -> R.string.prn_error_title_no_printer to StatusAction.CHOOSE_PRINTER
                // Non arriva quasi mai qui (il ViewModel lo ripulisce): la stampante funziona, niente azioni Bluetooth.
                PrintFailure.RENDER_FAILED -> R.string.prn_error_title_render to StatusAction.PRINT_TEST
            }
            StatusModel(
                icon = Icons.Rounded.ErrorOutline,
                accent = FfColors.Coral,
                title = stringResource(titleRes),
                body = printer.message,
                device = printer.device ?: configured,
                action = action,
            )
        }
    }
}

@Composable
private fun StatusCard(
    model: StatusModel,
    busy: Boolean,
    testPrinting: Boolean,
    showAppSettings: Boolean,
    onAction: (StatusAction) -> Unit,
    onDisconnect: () -> Unit,
    onOpenAppSettings: () -> Unit,
) {
    val onAccent = if (model.accent == FfColors.Graphite) FfColors.Paper else FfColors.Ink
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
        border = BorderStroke(2.dp, model.accent),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Box(
                    modifier = Modifier.size(56.dp).clip(CircleShape).background(model.accent),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(model.icon, contentDescription = null, tint = onAccent, modifier = Modifier.size(30.dp))
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = model.title,
                        style = MaterialTheme.typography.titleLarge,
                        fontFamily = FfFonts.Display,
                    )
                    val device = model.device
                    if (device != null) {
                        Text(
                            text = device.name,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = device.address,
                            style = MaterialTheme.typography.labelMedium,
                            fontFamily = FfFonts.Mono,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            Text(
                text = model.body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val progress = model.progress
            if (progress != null) {
                val animated by animateFloatAsState(targetValue = progress, label = "printProgress")
                LinearProgressIndicator(
                    progress = { animated },
                    modifier = Modifier.fillMaxWidth(),
                    color = model.accent,
                    trackColor = model.accent.copy(alpha = 0.2f),
                )
            } else if (model.indeterminate) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = model.accent,
                    trackColor = model.accent.copy(alpha = 0.2f),
                )
            }
            if (model.action != StatusAction.NONE) {
                val testAction = model.action == StatusAction.PRINT_TEST || model.action == StatusAction.RETRY
                FlashButton(
                    text = stringResource(actionLabel(model.action)),
                    onClick = { onAction(model.action) },
                    modifier = Modifier.fillMaxWidth(),
                    icon = actionIcon(model.action),
                    enabled = !(testAction && busy),
                    busy = testAction && testPrinting,
                )
            }
            if (showAppSettings) {
                GhostButton(
                    text = stringResource(R.string.prn_action_app_settings),
                    onClick = onOpenAppSettings,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.Settings,
                )
            }
            if (model.showDisconnect) {
                GhostButton(
                    text = stringResource(R.string.prn_action_disconnect),
                    onClick = onDisconnect,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.LinkOff,
                    enabled = !busy,
                )
            }
        }
    }
}

private fun actionLabel(action: StatusAction): Int = when (action) {
    StatusAction.GRANT_PERMISSION -> R.string.prn_action_grant
    StatusAction.ENABLE_BLUETOOTH -> R.string.prn_action_enable_bt
    StatusAction.CHOOSE_PRINTER -> R.string.prn_action_choose
    StatusAction.PAIR_PRINTER -> R.string.prn_action_pair
    StatusAction.PRINT_TEST -> R.string.prn_action_test
    StatusAction.RETRY -> R.string.prn_action_retry
    StatusAction.NONE -> R.string.prn_action_test
}

private fun actionIcon(action: StatusAction): ImageVector = when (action) {
    StatusAction.GRANT_PERMISSION -> Icons.Rounded.Lock
    StatusAction.ENABLE_BLUETOOTH -> Icons.Rounded.Bluetooth
    StatusAction.CHOOSE_PRINTER -> Icons.Rounded.Print
    StatusAction.PAIR_PRINTER -> Icons.Rounded.SettingsBluetooth
    StatusAction.PRINT_TEST -> Icons.Rounded.Receipt
    StatusAction.RETRY -> Icons.Rounded.Refresh
    StatusAction.NONE -> Icons.Rounded.Print
}

// -------------------------------------------------------------------------------------------
// Stampanti accoppiate (SPP)

@Composable
private fun PairedSection(
    ui: PrinterUiState,
    onSelect: (PrinterDevice) -> Unit,
    onPair: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            !ui.bluetoothAvailable -> HintText(stringResource(R.string.prn_status_no_bluetooth_body))
            !ui.hasPermission -> HintText(stringResource(R.string.prn_printers_permission))
            !ui.bluetoothEnabled -> HintText(stringResource(R.string.prn_printers_bt_off))
            ui.bonded.isEmpty() -> EmptyState(
                icon = Icons.Rounded.SettingsBluetooth,
                title = stringResource(R.string.prn_printers_empty_title),
                message = stringResource(R.string.prn_printers_empty_body),
                modifier = Modifier.fillMaxWidth(),
                actionText = stringResource(R.string.prn_action_pair),
                onAction = onPair,
            )
            else -> {
                val configured = ui.configured
                SettingsCard(contentPadding = PaddingValues(vertical = 4.dp), spacing = 0) {
                    ui.bonded.forEachIndexed { index, item ->
                        if (index > 0) RowDivider()
                        DeviceRow(
                            device = item.device,
                            likelyPrinter = item.likelyPrinter,
                            driver = item.driver,
                            unsupported = item.unsupported,
                            selected = isSelected(configured, item.device, PrinterLink.CLASSIC),
                            enabled = !ui.busy,
                            onSelect = { onSelect(item.device) },
                        )
                    }
                }
                GhostButton(
                    text = stringResource(R.string.prn_pair_new),
                    onClick = onPair,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.SettingsBluetooth,
                )
                HintText(stringResource(R.string.prn_printers_hint))
            }
        }
    }
}

/** Vero se [device] e la stampante scelta con quel collegamento (lo stesso indirizzo puo esistere in SPP e BLE). */
private fun isSelected(configured: PrinterDevice?, device: PrinterDevice, link: PrinterLink): Boolean =
    configured != null && configured.link == link && configured.address.equals(device.address, ignoreCase = true)

// -------------------------------------------------------------------------------------------
// Stampanti vicine (BLE)

@Composable
private fun NearbySection(
    ui: PrinterUiState,
    onSelect: (PrinterDevice) -> Unit,
    onScan: () -> Unit,
    onStopScan: () -> Unit,
    onOpenAppSettings: () -> Unit,
    onOpenLocationSettings: () -> Unit,
    onEnableBluetooth: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!ui.bluetoothAvailable) {
            HintText(stringResource(R.string.prn_status_no_bluetooth_body))
        } else {
            HintText(stringResource(R.string.prn_nearby_hint))
            val configured = ui.configured
            // La stampante BLE scelta resta in elenco anche prima di una ricerca o se non annuncia piu.
            val rows: List<NearbyPrinterItem> = remember(ui.nearby, configured) {
                val pinned = configured?.takeIf { device ->
                    device.link == PrinterLink.BLE &&
                        ui.nearby.none { it.device.address.equals(device.address, ignoreCase = true) }
                }
                if (pinned == null) {
                    ui.nearby
                } else {
                    listOf(
                        NearbyPrinterItem(
                            device = pinned,
                            driver = PrinterDrivers.guess(pinned.name),
                            unsupported = PrinterTuning.isUnsupportedModel(pinned.name),
                        ),
                    ) + ui.nearby
                }
            }
            if (rows.isNotEmpty()) {
                SettingsCard(contentPadding = PaddingValues(vertical = 4.dp), spacing = 0) {
                    rows.forEachIndexed { index, item ->
                        if (index > 0) RowDivider()
                        DeviceRow(
                            device = item.device,
                            likelyPrinter = item.driver != null || item.unsupported,
                            driver = item.driver,
                            unsupported = item.unsupported,
                            selected = isSelected(configured, item.device, PrinterLink.BLE),
                            enabled = !ui.busy,
                            onSelect = { onSelect(item.device) },
                        )
                    }
                }
            }
            ScanStatus(
                ui = ui,
                listEmpty = rows.isEmpty(),
                onScan = onScan,
                onOpenAppSettings = onOpenAppSettings,
                onOpenLocationSettings = onOpenLocationSettings,
                onEnableBluetooth = onEnableBluetooth,
            )
            if (ui.scanning) {
                GhostButton(
                    text = stringResource(R.string.prn_action_scan_stop),
                    onClick = onStopScan,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.Close,
                )
            } else {
                GhostButton(
                    text = stringResource(R.string.prn_action_scan),
                    onClick = onScan,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.Search,
                    enabled = !ui.busy,
                )
            }
        }
    }
}

/**
 * Cosa dire sotto l'elenco BLE: ricerca in corso, il problema dell'ultima ricerca (se e ancora
 * vero) con l'azione che lo risolve, gli avvisi prima di cercare, oppure "non trovata".
 */
@Composable
private fun ScanStatus(
    ui: PrinterUiState,
    listEmpty: Boolean,
    onScan: () -> Unit,
    onOpenAppSettings: () -> Unit,
    onOpenLocationSettings: () -> Unit,
    onEnableBluetooth: () -> Unit,
) {
    // Un problema gia risolto (permesso concesso, Bluetooth o Localizzazione riaccesi) non si mostra piu.
    val issue = ui.scanIssue?.takeUnless { problem ->
        when (problem) {
            BleScanIssue.NO_PERMISSION -> ui.hasScanPermission
            BleScanIssue.BLUETOOTH_OFF -> ui.bluetoothEnabled
            BleScanIssue.LOCATION_OFF -> ui.locationEnabled
            BleScanIssue.UNAVAILABLE, BleScanIssue.FAILED -> false
        }
    }
    val permissionText = stringResource(
        if (ui.locationNeeded) R.string.prn_nearby_permission_location else R.string.prn_nearby_permission,
    )
    when {
        ui.scanning -> Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = FfColors.Sky)
            Text(
                text = stringResource(R.string.prn_nearby_scanning),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        issue == BleScanIssue.NO_PERMISSION || (!ui.hasScanPermission && ui.scanPermissionDenied) -> NoteCard(
            icon = Icons.Rounded.Lock,
            accent = FfColors.Flash,
            text = permissionText,
            actionText = stringResource(
                if (ui.scanPermissionDenied) R.string.prn_action_app_settings else R.string.prn_action_scan_permission,
            ),
            onAction = if (ui.scanPermissionDenied) onOpenAppSettings else onScan,
        )
        issue == BleScanIssue.BLUETOOTH_OFF || (ui.hasPermission && !ui.bluetoothEnabled) -> NoteCard(
            icon = Icons.Rounded.BluetoothDisabled,
            accent = FfColors.Flash,
            text = stringResource(R.string.prn_nearby_bt_off),
            actionText = stringResource(R.string.prn_action_enable_bt),
            onAction = onEnableBluetooth,
        )
        // Fino ad Android 11 senza Localizzazione la ricerca non trova nulla: lo si dice prima di cercare.
        issue == BleScanIssue.LOCATION_OFF || (ui.locationNeeded && !ui.locationEnabled) -> NoteCard(
            icon = Icons.Rounded.LocationOn,
            accent = FfColors.Flash,
            text = stringResource(R.string.prn_nearby_location_off),
            actionText = stringResource(R.string.prn_action_location_settings),
            onAction = onOpenLocationSettings,
        )
        issue == BleScanIssue.UNAVAILABLE -> HintText(stringResource(R.string.prn_status_no_bluetooth_body))
        issue == BleScanIssue.FAILED -> NoteCard(
            icon = Icons.Rounded.ErrorOutline,
            accent = FfColors.Coral,
            text = stringResource(R.string.prn_nearby_failed),
        )
        !ui.hasScanPermission -> HintText(permissionText)
        ui.scanRequested && ui.nearby.isEmpty() -> HintText(stringResource(R.string.prn_nearby_empty))
        listEmpty -> HintText(stringResource(R.string.prn_nearby_idle))
        else -> Unit
    }
}

// -------------------------------------------------------------------------------------------
// Righe dei dispositivi

@Composable
private fun DeviceRow(
    device: PrinterDevice,
    likelyPrinter: Boolean,
    driver: PrinterDriver?,
    unsupported: Boolean,
    selected: Boolean,
    enabled: Boolean,
    onSelect: () -> Unit,
) {
    // Anche una stampante non supportata resta selezionabile: l'avviso sta nel tag e nella sezione del modello.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RadioButton(
            selected = selected,
            onClick = null,
            enabled = enabled,
            colors = RadioButtonDefaults.colors(selectedColor = FfColors.FlashDeep),
        )
        Icon(
            imageVector = if (likelyPrinter) Icons.Rounded.Print else Icons.Rounded.Bluetooth,
            contentDescription = null,
            tint = if (likelyPrinter) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = device.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = device.address,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FfFonts.Mono,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (driver != null && !unsupported) {
                Text(
                    text = stringResource(R.string.prn_device_driver, driverName(driver)),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        when {
            selected -> Tag(text = stringResource(R.string.prn_printer_selected), background = FfColors.Flash)
            unsupported -> Tag(text = stringResource(R.string.prn_tag_unsupported), background = FfColors.Coral)
            likelyPrinter -> Tag(text = stringResource(R.string.prn_printer_likely), background = FfColors.Fog)
            else -> Unit
        }
    }
}

@Composable
private fun Tag(text: String, background: Color) {
    Surface(shape = RoundedCornerShape(50), color = background, contentColor = FfColors.Ink) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FfFonts.Mono,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** Nome del driver nella lingua dell'app (displayName del core se l'app non lo conosce). */
@Composable
private fun driverName(driver: PrinterDriver): String {
    val res = PrinterTuning.driverNameRes(driver)
    return if (res != null) stringResource(res) else driver.displayName
}

// -------------------------------------------------------------------------------------------
// Modello di stampante (driver)

@Composable
private fun DriverSection(
    ui: PrinterUiState,
    onDriver: (String) -> Unit,
    onDither: (DitherAlgorithm) -> Unit,
) {
    val current = ui.driver
    val configured = ui.configured
    val suggested = ui.suggestedDriver
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // M02X: si avvisa invece di stampare spazzatura; la scelta resta all'utente.
        if (ui.configuredUnsupported) {
            NoteCard(
                icon = Icons.Rounded.Warning,
                accent = FfColors.Coral,
                text = stringResource(R.string.prn_unsupported_m02x),
            )
        }
        SettingsCard(contentPadding = PaddingValues(vertical = 4.dp), spacing = 0) {
            Box(modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp)) {
                SettingTitle(
                    icon = Icons.Rounded.Print,
                    title = stringResource(R.string.prn_driver_title),
                    subtitle = stringResource(R.string.prn_driver_hint),
                )
            }
            PrinterDrivers.all.forEachIndexed { index, driver ->
                if (index > 0) RowDivider()
                DriverRow(
                    driver = driver,
                    selected = driver.id == current.id,
                    recognized = configured != null && suggested?.id == driver.id,
                    enabled = !ui.busy,
                    onSelect = { onDriver(driver.id) },
                )
            }
        }
        if (configured != null && suggested != null && suggested.id != current.id) {
            NoteCard(
                icon = Icons.Rounded.Info,
                accent = FfColors.Sky,
                text = stringResource(R.string.prn_driver_suggest, driverName(suggested)),
                actionText = stringResource(R.string.prn_action_use_suggested),
                onAction = { onDriver(suggested.id) },
                enabled = !ui.busy,
            )
        }
        if (configured != null && configured.link !in current.links) {
            NoteCard(
                icon = Icons.Rounded.Warning,
                accent = FfColors.Flash,
                text = stringResource(
                    if (configured.link == PrinterLink.CLASSIC) {
                        R.string.prn_driver_link_mismatch_ble
                    } else {
                        R.string.prn_driver_link_mismatch_classic
                    },
                ),
            )
        }
        // Il retino consigliato si propone, non si impone: select() lo cambia da solo solo se era quello del driver precedente.
        if (!PrinterTuning.isEscPos(current) && ui.settings.dither != current.defaultDither) {
            val ditherName = stringResource(TestPage.ditherName(current.defaultDither))
            NoteCard(
                icon = Icons.Rounded.Grain,
                accent = FfColors.Sky,
                text = stringResource(R.string.prn_driver_dither_hint, ditherName),
                actionText = stringResource(R.string.prn_action_use_dither, ditherName),
                onAction = { onDither(current.defaultDither) },
            )
        }
    }
}

@Composable
private fun DriverRow(
    driver: PrinterDriver,
    selected: Boolean,
    recognized: Boolean,
    enabled: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RadioButton(
            selected = selected,
            onClick = null,
            enabled = enabled,
            colors = RadioButtonDefaults.colors(selectedColor = FfColors.FlashDeep),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = driverName(driver),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            )
            val description = PrinterTuning.driverDescriptionRes(driver)
            if (description != null) {
                Text(
                    text = stringResource(description),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = stringResource(
                    R.string.prn_driver_specs,
                    driver.paper.dots,
                    driver.dpi,
                    stringResource(PrinterTuning.driverLinksRes(driver)),
                ),
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FfFonts.Mono,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (recognized) Tag(text = stringResource(R.string.prn_tag_auto), background = FfColors.Mint)
    }
}

// -------------------------------------------------------------------------------------------
// Carta, intensita e densita

@Composable
private fun PaperSection(
    ui: PrinterUiState,
    onPaper: (PaperWidth) -> Unit,
    onWidthBytes: (Int) -> Unit,
    onFeedLines: (Int) -> Unit,
    onCut: (Boolean) -> Unit,
) {
    val settings = ui.settings
    val driver = ui.driver
    val escPos = PrinterTuning.isEscPos(driver)
    SettingsCard {
        if (escPos) {
            // ESC/POS: la carta e la scelta tra i due driver 58/80, come prima dei driver.
            SettingTitle(
                icon = Icons.Rounded.Straighten,
                title = stringResource(R.string.prn_paper_width),
                subtitle = stringResource(R.string.prn_paper_width_hint, driver.paper.dots),
            )
            ChoiceChipsRow(
                options = ESC_POS_PAPERS,
                selected = if (driver.paper in ESC_POS_PAPERS) driver.paper else PaperWidth.MM58,
                label = { paper ->
                    stringResource(if (paper == PaperWidth.MM80) R.string.prn_paper_80 else R.string.prn_paper_58)
                },
                onSelect = onPaper,
            )
        } else {
            // Gli altri driver hanno una sola carta: si dice quale, in punti e in millimetri stampati.
            val options = PrinterTuning.driverOptions(settings)
            val dots = driver.rasterWidth(options)
            SettingTitle(
                icon = Icons.Rounded.Straighten,
                title = stringResource(R.string.prn_paper_width),
                subtitle = stringResource(R.string.prn_paper_driver, dots, driver.dpi, printedMillimeters(dots, driver.dpi)),
            )
            HintText(stringResource(R.string.prn_paper_driver_hint))
            if (PrinterTuning.hasWidthChoice(driver)) {
                SectionDivider()
                Text(text = stringResource(R.string.prn_phomemo_width), style = MaterialTheme.typography.titleSmall)
                val widths = PrinterTuning.PHOMEMO_WIDTH_BYTES
                ChoiceChipsRow(
                    options = widths,
                    selected = if (settings.phomemoWidthBytes in widths) settings.phomemoWidthBytes else PrinterTuning.PHOMEMO_WIDTH_BYTES_DEFAULT,
                    label = { bytes -> stringResource(R.string.prn_phomemo_width_value, bytes, bytes * 8) },
                    onSelect = onWidthBytes,
                )
                HintText(stringResource(R.string.prn_phomemo_width_hint))
            }
        }
        SectionDivider()
        StepSlider(
            title = stringResource(R.string.prn_feed_lines),
            hint = stringResource(R.string.prn_feed_lines_hint),
            steps = FEED_STEPS,
            value = settings.feedLines,
            valueLabel = { stringResource(R.string.prn_feed_lines_value, it) },
            onCommit = onFeedLines,
        )
        // Il taglio esiste solo nel protocollo ESC/POS.
        if (escPos) {
            SectionDivider()
            SwitchRow(
                icon = Icons.Rounded.ContentCut,
                title = stringResource(R.string.prn_cut),
                subtitle = stringResource(R.string.prn_cut_hint),
                checked = settings.cutPaper,
                onCheckedChange = onCut,
            )
        }
    }
}

/** Larghezza stampata in millimetri interi: 384 punti a 203 dpi = 48 mm, 576 a 300 dpi = 49 mm. */
private fun printedMillimeters(dots: Int, dpi: Int): Int = if (dpi <= 0) 0 else (dots * 254 + dpi * 5) / (dpi * 10)

@Composable
private fun HeatSection(ui: PrinterUiState, onHeat: (Int) -> Unit, onTestPage: () -> Unit) {
    SettingsCard {
        SettingTitle(
            icon = Icons.Rounded.Whatshot,
            title = stringResource(R.string.prn_heat_title),
            subtitle = null,
        )
        StepSlider(
            title = null,
            hint = stringResource(R.string.prn_heat_hint),
            steps = HEAT_STEPS,
            value = ui.settings.heatLevel,
            valueLabel = { stringResource(PrinterTuning.heatLevelLabel(it)) },
            onCommit = onHeat,
        )
        TestPageButton(ui = ui, onTestPage = onTestPage)
    }
}

/** Phomemo: densita 1..15 (1F 11 02) al posto dell'intensita ESC 7, e la velocita sperimentale. */
@Composable
private fun DensitySection(
    ui: PrinterUiState,
    onDensity: (Int?) -> Unit,
    onSpeed: (Int?) -> Unit,
    onTestPage: () -> Unit,
) {
    val settings = ui.settings
    val effective = PrinterTuning.effectivePhomemoDensity(settings)
    val automatic = settings.phomemoDensity == null
    SettingsCard {
        SettingTitle(
            icon = Icons.Rounded.Whatshot,
            title = stringResource(R.string.prn_density_title),
            subtitle = null,
        )
        StepSlider(
            title = null,
            hint = stringResource(R.string.prn_density_hint, PrinterTuning.PHOMEMO_DENSITY_DEFAULT),
            steps = DENSITY_STEPS,
            value = effective,
            valueLabel = { value ->
                if (automatic && value == effective) {
                    stringResource(R.string.prn_density_value_default, value, PrinterTuning.PHOMEMO_DENSITY_MAX)
                } else {
                    stringResource(R.string.prn_density_value, value, PrinterTuning.PHOMEMO_DENSITY_MAX)
                }
            },
            onCommit = { onDensity(it) },
        )
        if (!automatic) {
            TextButton(onClick = { onDensity(null) }) {
                Icon(Icons.Rounded.RestartAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(
                    text = stringResource(R.string.prn_density_reset),
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
        SectionDivider()
        val speed = settings.printerSpeed
        SwitchRow(
            icon = Icons.Rounded.Timer,
            title = stringResource(R.string.prn_speed_title),
            subtitle = stringResource(R.string.prn_speed_hint),
            checked = speed != null,
            onCheckedChange = { on -> onSpeed(if (on) PrinterTuning.SPEED_DEFAULT else null) },
        )
        if (speed != null) {
            StepSlider(
                title = null,
                hint = null,
                steps = SPEED_STEPS,
                value = speed,
                valueLabel = { stringResource(R.string.prn_speed_value, it, PrinterTuning.SPEED_MAX) },
                onCommit = { onSpeed(it) },
            )
        }
        TestPageButton(ui = ui, onTestPage = onTestPage)
    }
}

@Composable
private fun TestPageButton(ui: PrinterUiState, onTestPage: () -> Unit) {
    GhostButton(
        text = stringResource(R.string.prn_action_test),
        onClick = onTestPage,
        modifier = Modifier.fillMaxWidth(),
        icon = Icons.Rounded.Receipt,
        enabled = ui.bluetoothReady && ui.configured != null && !ui.busy,
    )
}

// -------------------------------------------------------------------------------------------
// Invio BLE

@Composable
private fun BleSection(
    ui: PrinterUiState,
    onPreset: (PrinterTuning.BlePreset) -> Unit,
    onTestPage: () -> Unit,
) {
    val active = PrinterTuning.blePresetOf(ui.settings)
    val inUse = ui.bleHints
    val driverDefault = ui.driver.defaultTransport
    SettingsCard(contentPadding = PaddingValues(vertical = 4.dp), spacing = 0) {
        Column(
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SettingTitle(
                icon = Icons.Rounded.Bluetooth,
                title = stringResource(R.string.prn_ble_title),
                subtitle = null,
            )
            HintText(stringResource(R.string.prn_ble_hint))
        }
        PrinterTuning.BlePreset.entries.forEachIndexed { index, preset ->
            if (index > 0) RowDivider()
            val description = if (preset == PrinterTuning.BlePreset.DRIVER) {
                stringResource(
                    R.string.prn_ble_preset_driver_desc,
                    driverDefault.chunkSize,
                    driverDefault.chunkDelayMs,
                    stringResource(writeModeLabel(driverDefault.withoutResponse)),
                )
            } else {
                stringResource(presetDescription(preset))
            }
            OptionRow(
                title = stringResource(presetTitle(preset)),
                description = description,
                selected = preset == active,
                enabled = !ui.busy,
                onSelect = { onPreset(preset) },
            )
        }
        Column(
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (active == null) HintText(stringResource(R.string.prn_ble_custom))
            HintText(
                stringResource(
                    R.string.prn_ble_current,
                    inUse.chunkSize,
                    inUse.chunkDelayMs,
                    stringResource(writeModeLabel(inUse.withoutResponse)),
                ),
            )
            TestPageButton(ui = ui, onTestPage = onTestPage)
        }
    }
}

private fun writeModeLabel(withoutResponse: Boolean): Int =
    if (withoutResponse) R.string.prn_ble_no_response else R.string.prn_ble_with_response

private fun presetTitle(preset: PrinterTuning.BlePreset): Int = when (preset) {
    PrinterTuning.BlePreset.DRIVER -> R.string.prn_ble_preset_driver
    PrinterTuning.BlePreset.SAFE -> R.string.prn_ble_preset_safe
    PrinterTuning.BlePreset.FAST -> R.string.prn_ble_preset_fast
    PrinterTuning.BlePreset.MAX -> R.string.prn_ble_preset_max
    PrinterTuning.BlePreset.CONFIRMED -> R.string.prn_ble_preset_confirmed
}

private fun presetDescription(preset: PrinterTuning.BlePreset): Int = when (preset) {
    PrinterTuning.BlePreset.DRIVER -> R.string.prn_ble_preset_driver_desc
    PrinterTuning.BlePreset.SAFE -> R.string.prn_ble_preset_safe_desc
    PrinterTuning.BlePreset.FAST -> R.string.prn_ble_preset_fast_desc
    PrinterTuning.BlePreset.MAX -> R.string.prn_ble_preset_max_desc
    PrinterTuning.BlePreset.CONFIRMED -> R.string.prn_ble_preset_confirmed_desc
}

@Composable
private fun OptionRow(
    title: String,
    description: String,
    selected: Boolean,
    enabled: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RadioButton(
            selected = selected,
            onClick = null,
            enabled = enabled,
            colors = RadioButtonDefaults.colors(selectedColor = FfColors.FlashDeep),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// -------------------------------------------------------------------------------------------
// Calibrazione avanzata

@Composable
private fun AdvancedSection(
    ui: PrinterUiState,
    showTransfer: Boolean,
    showBand: Boolean,
    open: Boolean,
    onToggle: () -> Unit,
    onChunkSize: (Int) -> Unit,
    onChunkDelay: (Int) -> Unit,
    onBandHeight: (Int) -> Unit,
    onReset: () -> Unit,
) {
    val settings = ui.settings
    val rotation by animateFloatAsState(targetValue = if (open) 180f else 0f, label = "advancedChevron")
    val summary = when {
        showTransfer && showBand -> R.string.prn_advanced_summary
        showTransfer -> R.string.prn_advanced_summary_spp
        else -> R.string.prn_advanced_summary_band
    }
    SettingsCard(contentPadding = PaddingValues(0.dp), spacing = 0) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                SettingTitle(
                    icon = Icons.Rounded.Tune,
                    title = stringResource(R.string.prn_section_advanced),
                    subtitle = stringResource(summary),
                )
            }
            Icon(
                imageVector = Icons.Rounded.ExpandMore,
                contentDescription = stringResource(
                    if (open) R.string.prn_advanced_collapse else R.string.prn_advanced_expand,
                ),
                modifier = Modifier.rotate(rotation),
            )
        }
        AnimatedVisibility(visible = open) {
            Column(
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                HintText(stringResource(R.string.prn_advanced_hint))
                if (showTransfer) {
                    StepSlider(
                        title = stringResource(R.string.prn_chunk_size),
                        hint = stringResource(R.string.prn_recommended, PrinterTuning.CHUNK_SIZE_DEFAULT),
                        steps = PrinterTuning.CHUNK_SIZE_STEPS,
                        value = settings.chunkSize,
                        valueLabel = { stringResource(R.string.prn_chunk_size_value, it) },
                        onCommit = onChunkSize,
                    )
                    StepSlider(
                        title = stringResource(R.string.prn_chunk_delay),
                        hint = stringResource(R.string.prn_recommended, PrinterTuning.CHUNK_DELAY_DEFAULT),
                        steps = DELAY_STEPS,
                        value = settings.chunkDelayMs,
                        valueLabel = { stringResource(R.string.prn_chunk_delay_value, it) },
                        onCommit = onChunkDelay,
                    )
                    val speed = PrinterTuning.maxThroughputKbPerSecond(settings.chunkSize, settings.chunkDelayMs)
                    HintText(
                        if (speed == null) {
                            stringResource(R.string.prn_speed_unlimited)
                        } else {
                            stringResource(R.string.prn_speed_estimate, speed)
                        },
                    )
                }
                if (showBand) {
                    StepSlider(
                        title = stringResource(R.string.prn_band_height),
                        hint = stringResource(R.string.prn_recommended, PrinterTuning.BAND_HEIGHT_DEFAULT),
                        steps = PrinterTuning.BAND_HEIGHT_STEPS,
                        value = settings.bandHeight,
                        valueLabel = { stringResource(R.string.prn_band_height_value, it) },
                        onCommit = onBandHeight,
                    )
                    HintText(stringResource(R.string.prn_band_height_hint))
                }
                GhostButton(
                    text = stringResource(R.string.prn_reset),
                    onClick = onReset,
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Rounded.RestartAlt,
                )
            }
        }
    }
}

// -------------------------------------------------------------------------------------------
// Problemi?

@Composable
private fun HelpSection() {
    val tips = listOf(
        R.string.prn_tip_blank_title to R.string.prn_tip_blank_body,
        R.string.prn_tip_garbled_title to R.string.prn_tip_garbled_body,
        R.string.prn_tip_pale_title to R.string.prn_tip_pale_body,
        R.string.prn_tip_broken_title to R.string.prn_tip_broken_body,
        R.string.prn_tip_connect_title to R.string.prn_tip_connect_body,
        R.string.prn_tip_missing_title to R.string.prn_tip_missing_body,
    )
    // Su un foglio di carta termica, come uno scontrino di istruzioni.
    PaperSheet(modifier = Modifier.fillMaxWidth()) {
        // Il foglio centra i figli e ha gia i suoi margini: qui solo larghezza piena e un filo d'aria.
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            tips.forEachIndexed { index, (titleRes, bodyRes) ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = stringResource(R.string.prn_tip_number, index + 1, stringResource(titleRes)),
                        style = MaterialTheme.typography.titleSmall,
                        fontFamily = FfFonts.Mono,
                        fontWeight = FontWeight.Bold,
                        color = FfColors.Ink,
                    )
                    Text(
                        text = stringResource(bodyRes),
                        style = MaterialTheme.typography.bodyMedium,
                        color = FfColors.Graphite,
                    )
                }
            }
        }
    }
}

// -------------------------------------------------------------------------------------------
// Mattoncini locali

private val FEED_STEPS: List<Int> = (PrinterTuning.FEED_LINES_MIN..PrinterTuning.FEED_LINES_MAX).toList()
private val HEAT_STEPS: List<Int> = (PrinterTuning.HEAT_LEVEL_MIN..PrinterTuning.HEAT_LEVEL_MAX).toList()
private val DENSITY_STEPS: List<Int> = (PrinterTuning.PHOMEMO_DENSITY_MIN..PrinterTuning.PHOMEMO_DENSITY_MAX).toList()
private val SPEED_STEPS: List<Int> = (PrinterTuning.SPEED_MIN..PrinterTuning.SPEED_MAX).toList()
private val DELAY_STEPS: List<Int> =
    (PrinterTuning.CHUNK_DELAY_MIN..PrinterTuning.CHUNK_DELAY_MAX step PrinterTuning.CHUNK_DELAY_STEP).toList()

/** Riquadro delle impostazioni, coerente in tema chiaro e scuro. */
@Composable
private fun SettingsCard(
    contentPadding: PaddingValues = PaddingValues(16.dp),
    spacing: Int = 12,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)),
    ) {
        Column(
            modifier = Modifier.padding(contentPadding),
            verticalArrangement = Arrangement.spacedBy(spacing.dp),
            content = content,
        )
    }
}

/**
 * Avviso in un riquadro colorato: problemi della ricerca, modello non supportato, suggerimenti del
 * driver. L'azione, se c'e, e quella che risolve il problema.
 */
@Composable
private fun NoteCard(
    icon: ImageVector,
    accent: Color,
    text: String,
    actionText: String? = null,
    onAction: (() -> Unit)? = null,
    enabled: Boolean = true,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = accent.copy(alpha = 0.14f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.7f)),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
            }
            if (actionText != null && onAction != null) {
                GhostButton(
                    text = actionText,
                    onClick = onAction,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = enabled,
                )
            }
        }
    }
}

@Composable
private fun SettingTitle(icon: ImageVector, title: String, subtitle: String?) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Titolo con interruttore a destra (taglio carta, velocita sperimentale). */
@Composable
private fun SwitchRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(modifier = Modifier.weight(1f)) {
            SettingTitle(icon = icon, title = title, subtitle = subtitle)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = FfColors.Ink,
                checkedTrackColor = FfColors.Flash,
            ),
        )
    }
}

@Composable
private fun HintText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun SectionDivider() {
    HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
}

/** Separatore tra le righe di un elenco, allineato al testo dopo il pulsante radio. */
@Composable
private fun RowDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 64.dp),
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
    )
}

/**
 * Slider a gradini su una lista di valori ammessi. Durante il trascinamento mostra il valore in
 * anteprima e salva solo al rilascio: un salvataggio per ogni pixel martellerebbe DataStore.
 */
@Composable
private fun StepSlider(
    title: String?,
    hint: String?,
    steps: List<Int>,
    value: Int,
    valueLabel: @Composable (Int) -> String,
    onCommit: (Int) -> Unit,
) {
    val lastIndex = steps.lastIndex
    var position by remember(value, steps) {
        mutableFloatStateOf(PrinterTuning.nearestIndex(steps, value).toFloat())
    }
    val shown = steps[position.roundToInt().coerceIn(0, lastIndex)]
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (title != null) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Box(modifier = Modifier.weight(1f))
            }
            Text(
                text = valueLabel(shown),
                style = MaterialTheme.typography.labelLarge,
                fontFamily = FfFonts.Mono,
                fontWeight = FontWeight.Bold,
            )
        }
        Slider(
            value = position,
            onValueChange = { position = it },
            valueRange = 0f..lastIndex.toFloat(),
            steps = (steps.size - 2).coerceAtLeast(0),
            onValueChangeFinished = {
                onCommit(steps[position.roundToInt().coerceIn(0, lastIndex)])
            },
            colors = SliderDefaults.colors(
                thumbColor = FfColors.FlashDeep,
                activeTrackColor = FfColors.Flash,
                activeTickColor = FfColors.Ink.copy(alpha = 0.4f),
            ),
        )
        if (hint != null) HintText(hint)
    }
}
