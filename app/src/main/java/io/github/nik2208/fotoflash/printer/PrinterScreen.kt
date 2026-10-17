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
import androidx.compose.material.icons.rounded.ContentCut
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.PrintDisabled
import androidx.compose.material.icons.rounded.Receipt
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SettingsBluetooth
import androidx.compose.material.icons.rounded.Straighten
import androidx.compose.material.icons.rounded.Tune
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
import io.github.nik2208.fotoflash.thermal.PaperWidth
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

/** Posizione della sezione "Dispositivi accoppiati" nella lista, per l'azione "Scegli stampante". */
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

/**
 * "Stampante e carta": stato della stampante con l'azione giusta al momento giusto, scelta tra i
 * dispositivi accoppiati, carta, intensita, calibrazione avanzata e consigli pratici.
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

    // Al ritorno dalle impostazioni di sistema permessi e accoppiamenti possono essere cambiati.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refresh() }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        viewModel.onPermissionResult(result.isNotEmpty() && result.values.all { it })
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
                onOpenAppSettings = openAppSettings,
                onPair = openBluetoothSettings,
                onForget = { confirmForget = true },
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

/** Contenuto scorrevole della schermata, una sezione per voce della lista. */
@Composable
private fun PrinterContent(
    ui: PrinterUiState,
    padding: PaddingValues,
    listState: LazyListState,
    advancedOpen: Boolean,
    onToggleAdvanced: () -> Unit,
    onStatusAction: (StatusAction) -> Unit,
    onOpenAppSettings: () -> Unit,
    onPair: () -> Unit,
    onForget: () -> Unit,
    viewModel: PrinterViewModel,
) {
    val status = statusModel(ui)
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
                onOpenAppSettings = onOpenAppSettings,
            )
        }
        // Deve restare in posizione PRINTERS_ITEM_INDEX: ci scorre l'azione "Scegli stampante".
        item(key = "printers_header") {
            SectionHeader(text = stringResource(R.string.prn_section_printers))
        }
        item(key = "printers") {
            PrintersSection(
                ui = ui,
                onSelect = { viewModel.select(it) },
                onPair = onPair,
                onForget = onForget,
            )
        }
        item(key = "paper_header") {
            SectionHeader(text = stringResource(R.string.prn_section_paper))
        }
        item(key = "paper") {
            PaperSection(
                ui = ui,
                onPaper = { viewModel.setPaper(it) },
                onFeedLines = { viewModel.setFeedLines(it) },
                onCut = { viewModel.setCutPaper(it) },
            )
        }
        item(key = "heat_header") {
            SectionHeader(text = stringResource(R.string.prn_section_heat))
        }
        item(key = "heat") {
            HeatSection(
                ui = ui,
                onHeat = { viewModel.setHeatLevel(it) },
                onTestPage = { viewModel.printTestPage() },
            )
        }
        item(key = "advanced") {
            AdvancedSection(
                ui = ui,
                open = advancedOpen,
                onToggle = onToggleAdvanced,
                onChunkSize = { viewModel.setChunkSize(it) },
                onChunkDelay = { viewModel.setChunkDelay(it) },
                onBandHeight = { viewModel.setBandHeight(it) },
                onReset = { viewModel.resetAdvanced() },
            )
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
        // Finche l'elenco degli accoppiati non e stato letto, "vuoto" non vuol dire "nessuno".
        PrinterState.NotConfigured -> if (ui.bondedLoaded && ui.bonded.isEmpty()) {
            StatusModel(
                icon = Icons.Rounded.PrintDisabled,
                accent = FfColors.Flash,
                title = stringResource(R.string.prn_status_none_title),
                body = stringResource(R.string.prn_status_none_body_pair),
                device = null,
                action = StatusAction.PAIR_PRINTER,
            )
        } else {
            StatusModel(
                icon = Icons.Rounded.PrintDisabled,
                accent = FfColors.Flash,
                title = stringResource(R.string.prn_status_none_title),
                body = stringResource(R.string.prn_status_none_body_pick),
                device = null,
                action = StatusAction.CHOOSE_PRINTER,
            )
        }
        is PrinterState.Disconnected -> {
            val device = printer.device
            // Stampante disaccoppiata nelle impostazioni Bluetooth: lo si dice subito, non al primo tentativo.
            val unpaired = ui.bondedLoaded &&
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
            val chooseOrPair = if (ui.bonded.isEmpty()) StatusAction.PAIR_PRINTER else StatusAction.CHOOSE_PRINTER
            val (titleRes, action) = when (printer.failure) {
                PrintFailure.NO_PERMISSION -> R.string.prn_error_title_permission to StatusAction.GRANT_PERMISSION
                PrintFailure.BLUETOOTH_OFF -> R.string.prn_error_title_bt_off to StatusAction.ENABLE_BLUETOOTH
                PrintFailure.NOT_BONDED -> R.string.prn_error_title_not_bonded to StatusAction.PAIR_PRINTER
                // Qui si puo solo provare con una pagina di prova (non con la foto): l'etichetta lo dice.
                PrintFailure.CONNECT_FAILED -> R.string.prn_error_title_connect to StatusAction.PRINT_TEST
                PrintFailure.WRITE_FAILED -> R.string.prn_error_title_write to StatusAction.PRINT_TEST
                PrintFailure.BUSY -> R.string.prn_error_title_busy to StatusAction.NONE
                PrintFailure.NO_PRINTER -> R.string.prn_error_title_no_printer to chooseOrPair
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
// Stampanti accoppiate

@Composable
private fun PrintersSection(
    ui: PrinterUiState,
    onSelect: (PrinterDevice) -> Unit,
    onPair: () -> Unit,
    onForget: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            !ui.bluetoothAvailable -> HintText(stringResource(R.string.prn_status_no_bluetooth_body))
            !ui.hasPermission -> HintText(stringResource(R.string.prn_printers_permission))
            !ui.bluetoothEnabled -> HintText(stringResource(R.string.prn_printers_bt_off))
            ui.bonded.isEmpty() -> EmptyState(
                icon = Icons.AutoMirrored.Rounded.BluetoothSearching,
                title = stringResource(R.string.prn_printers_empty_title),
                message = stringResource(R.string.prn_printers_empty_body),
                modifier = Modifier.fillMaxWidth(),
                actionText = stringResource(R.string.prn_action_pair),
                onAction = onPair,
            )
            else -> {
                val selectedAddress = ui.configured?.address
                SettingsCard(contentPadding = PaddingValues(vertical = 4.dp), spacing = 0) {
                    ui.bonded.forEachIndexed { index, item ->
                        if (index > 0) {
                            HorizontalDivider(
                                modifier = Modifier.padding(start = 64.dp),
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
                            )
                        }
                        PrinterRow(
                            item = item,
                            selected = item.device.address.equals(selectedAddress, ignoreCase = true),
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
        if (ui.configured != null) {
            GhostButton(
                text = stringResource(R.string.prn_action_forget),
                onClick = onForget,
                modifier = Modifier.fillMaxWidth(),
                icon = Icons.Rounded.DeleteOutline,
                enabled = !ui.busy,
            )
        }
    }
}

@Composable
private fun PrinterRow(item: BondedPrinterItem, selected: Boolean, enabled: Boolean, onSelect: () -> Unit) {
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
            imageVector = if (item.likelyPrinter) Icons.Rounded.Print else Icons.Rounded.Bluetooth,
            contentDescription = null,
            tint = if (item.likelyPrinter) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.device.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = item.device.address,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FfFonts.Mono,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when {
            selected -> Tag(text = stringResource(R.string.prn_printer_selected), background = FfColors.Flash)
            item.likelyPrinter -> Tag(text = stringResource(R.string.prn_printer_likely), background = FfColors.Fog)
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

// -------------------------------------------------------------------------------------------
// Carta e intensita

@Composable
private fun PaperSection(
    ui: PrinterUiState,
    onPaper: (PaperWidth) -> Unit,
    onFeedLines: (Int) -> Unit,
    onCut: (Boolean) -> Unit,
) {
    val settings = ui.settings
    SettingsCard {
        SettingTitle(
            icon = Icons.Rounded.Straighten,
            title = stringResource(R.string.prn_paper_width),
            subtitle = stringResource(R.string.prn_paper_width_hint, settings.paper.dots),
        )
        ChoiceChipsRow(
            options = PaperWidth.entries,
            selected = settings.paper,
            label = { paper ->
                stringResource(if (paper == PaperWidth.MM58) R.string.prn_paper_58 else R.string.prn_paper_80)
            },
            onSelect = onPaper,
        )
        SectionDivider()
        StepSlider(
            title = stringResource(R.string.prn_feed_lines),
            hint = stringResource(R.string.prn_feed_lines_hint),
            steps = FEED_STEPS,
            value = settings.feedLines,
            valueLabel = { stringResource(R.string.prn_feed_lines_value, it) },
            onCommit = onFeedLines,
        )
        SectionDivider()
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                SettingTitle(
                    icon = Icons.Rounded.ContentCut,
                    title = stringResource(R.string.prn_cut),
                    subtitle = stringResource(R.string.prn_cut_hint),
                )
            }
            Switch(
                checked = settings.cutPaper,
                onCheckedChange = onCut,
                colors = SwitchDefaults.colors(
                    checkedThumbColor = FfColors.Ink,
                    checkedTrackColor = FfColors.Flash,
                ),
            )
        }
    }
}

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
        GhostButton(
            text = stringResource(R.string.prn_action_test),
            onClick = onTestPage,
            modifier = Modifier.fillMaxWidth(),
            icon = Icons.Rounded.Receipt,
            enabled = ui.bluetoothReady && ui.configured != null && !ui.busy,
        )
    }
}

// -------------------------------------------------------------------------------------------
// Calibrazione avanzata

@Composable
private fun AdvancedSection(
    ui: PrinterUiState,
    open: Boolean,
    onToggle: () -> Unit,
    onChunkSize: (Int) -> Unit,
    onChunkDelay: (Int) -> Unit,
    onBandHeight: (Int) -> Unit,
    onReset: () -> Unit,
) {
    val settings = ui.settings
    val rotation by animateFloatAsState(targetValue = if (open) 180f else 0f, label = "advancedChevron")
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
                    subtitle = stringResource(R.string.prn_advanced_summary),
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
                StepSlider(
                    title = stringResource(R.string.prn_band_height),
                    hint = stringResource(R.string.prn_recommended, PrinterTuning.BAND_HEIGHT_DEFAULT),
                    steps = PrinterTuning.BAND_HEIGHT_STEPS,
                    value = settings.bandHeight,
                    valueLabel = { stringResource(R.string.prn_band_height_value, it) },
                    onCommit = onBandHeight,
                )
                HintText(stringResource(R.string.prn_band_height_hint))
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
