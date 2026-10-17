package io.github.nik2208.fotoflash.settings

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.ConfirmationNumber
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.FlashOn
import androidx.compose.material.icons.rounded.Grain
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.Tonality
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.BuildConfig
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.AppSettings
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.ui.components.BrandWordmark
import io.github.nik2208.fotoflash.ui.components.ChoiceChipsRow
import io.github.nik2208.fotoflash.ui.components.FfTopBar
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.PrinterStatusChip
import io.github.nik2208.fotoflash.ui.components.SectionHeader
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

private const val GITHUB_URL = "https://github.com/nb-camelot/fotoflash"
private const val OFL_URL = "https://openfontlicense.org"
private val TIMER_OPTIONS = listOf(0, 3, 10)
private val STRIP_OPTIONS = listOf(3, 4)

@Composable
fun SettingsScreen(onBack: () -> Unit, onOpenPrinter: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val vm = viewModel { SettingsViewModel(graph) }
    val settings by vm.settings.collectAsStateWithLifecycle()
    val printerState by vm.printerState.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showLicenses by rememberSaveable { mutableStateOf(false) }
    var confirmCounterReset by rememberSaveable { mutableStateOf(false) }
    val noAppMessage = stringResource(R.string.set_open_failed)
    val storageDeniedMessage = stringResource(R.string.set_auto_save_denied)

    val openUrl: (String) -> Unit = { url ->
        if (!startViewIntent(context, url)) scope.launch { snackbar.showSnackbar(noAppMessage) }
    }

    // Android 8-9: salvare gli scatti in galleria richiede WRITE_EXTERNAL_STORAGE. Si ricontrolla a
    // ogni ritorno sulla schermata: il permesso si puo concedere anche dalle impostazioni di sistema.
    val exporter = graph.exporter
    var storagePermissionMissing by remember { mutableStateOf(exporter.needsLegacyWritePermission()) }
    LifecycleResumeEffect(exporter) {
        storagePermissionMissing = exporter.needsLegacyWritePermission()
        onPauseOrDispose { }
    }
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        storagePermissionMissing = exporter.needsLegacyWritePermission()
        if (!granted) {
            // Senza permesso l'interruttore acceso mentirebbe: lo spegniamo e diciamo perche.
            vm.update { it.copy(autoSaveCaptures = false) }
            scope.launch { snackbar.showSnackbar(storageDeniedMessage) }
        }
    }
    val requestStoragePermission: () -> Unit = {
        storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
    }
    val onAutoSaveChange: (Boolean) -> Unit = { on ->
        vm.update { it.copy(autoSaveCaptures = on) }
        if (on && exporter.needsLegacyWritePermission()) requestStoragePermission()
    }

    Scaffold(
        topBar = { FfTopBar(title = stringResource(R.string.set_title), onBack = onBack) },
        snackbarHost = { SnackbarHost(hostState = snackbar) },
    ) { padding ->
        val current = settings
        if (current == null) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            SettingsContent(
                settings = current,
                printerState = printerState,
                vm = vm,
                onOpenPrinter = onOpenPrinter,
                onResetCounter = { confirmCounterReset = true },
                onOpenGithub = { openUrl(GITHUB_URL) },
                onShowLicenses = { showLicenses = true },
                storagePermissionMissing = storagePermissionMissing,
                onAutoSaveChange = onAutoSaveChange,
                onAllowStorage = requestStoragePermission,
                modifier = Modifier.fillMaxSize().padding(padding),
            )
        }
    }

    if (confirmCounterReset) {
        AlertDialog(
            onDismissRequest = { confirmCounterReset = false },
            title = { Text(text = stringResource(R.string.set_counter_reset_title)) },
            text = { Text(text = stringResource(R.string.set_counter_reset_message)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmCounterReset = false
                        vm.resetCounter()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = FfColors.Coral),
                ) {
                    Text(text = stringResource(R.string.set_counter_reset))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmCounterReset = false }) {
                    Text(text = stringResource(R.string.set_cancel))
                }
            },
        )
    }

    if (showLicenses) {
        LicensesDialog(
            onDismiss = { showLicenses = false },
            onOpenLicense = { openUrl(OFL_URL) },
        )
    }
}

@Composable
private fun SettingsContent(
    settings: AppSettings,
    printerState: PrinterState,
    vm: SettingsViewModel,
    onOpenPrinter: () -> Unit,
    onResetCounter: () -> Unit,
    onOpenGithub: () -> Unit,
    onShowLicenses: () -> Unit,
    storagePermissionMissing: Boolean,
    onAutoSaveChange: (Boolean) -> Unit,
    onAllowStorage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val focusManager = LocalFocusManager.current
    val tone = settings.tone

    Column(
        modifier = modifier
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, bottom = 32.dp),
    ) {
        // --- Stampante e carta: il dettaglio (carta, calibrazione) sta nella schermata stampante.
        SectionHeader(text = stringResource(R.string.set_section_printer), modifier = Modifier.padding(top = 8.dp))
        SettingsCard {
            PrinterRow(settings = settings, printerState = printerState, onOpenPrinter = onOpenPrinter)
        }

        // --- Immagine: valori di partenza dell'editor.
        SectionHeader(text = stringResource(R.string.set_section_image), modifier = Modifier.padding(top = 24.dp))
        SettingsCard {
            LabeledBlock(
                label = stringResource(R.string.set_dither_label),
                description = ditherDescription(settings.dither),
            ) {
                ChoiceChipsRow(
                    options = DitherAlgorithm.entries,
                    selected = settings.dither,
                    label = { ditherLabel(it) },
                    onSelect = { algorithm -> vm.update { it.copy(dither = algorithm) } },
                )
            }
            CardDivider()
            ToneSlider(
                label = stringResource(R.string.set_brightness),
                value = tone.brightness,
                range = -1f..1f,
                steps = 39,
                format = ::formatSigned,
                onCommit = { v -> vm.update { it.copy(tone = it.tone.copy(brightness = v)) } },
            )
            ToneSlider(
                label = stringResource(R.string.set_contrast),
                value = tone.contrast,
                range = -1f..1f,
                steps = 39,
                format = ::formatSigned,
                onCommit = { v -> vm.update { it.copy(tone = it.tone.copy(contrast = v)) } },
            )
            ToneSlider(
                label = stringResource(R.string.set_sharpen),
                value = tone.sharpen,
                range = 0f..1f,
                steps = 19,
                format = ::formatPercent,
                onCommit = { v -> vm.update { it.copy(tone = it.tone.copy(sharpen = v)) } },
            )
            ToneSlider(
                label = stringResource(R.string.set_gamma),
                value = tone.gamma,
                range = 0.4f..2.5f,
                steps = 41,
                format = ::formatDecimal,
                onCommit = { v -> vm.update { it.copy(tone = it.tone.copy(gamma = v)) } },
            )
            // Controluce: sulla carta un viso in ombra diventa una macchia nera, qui si recupera.
            ToneSlider(
                label = stringResource(R.string.set_shadows),
                description = stringResource(R.string.set_shadows_desc),
                value = tone.shadows,
                range = 0f..1f,
                steps = 19,
                format = ::formatPercent,
                onCommit = { v -> vm.update { it.copy(tone = it.tone.copy(shadows = v)) } },
            )
            ToneSlider(
                label = stringResource(R.string.set_local_contrast),
                description = stringResource(R.string.set_local_contrast_desc),
                value = tone.localContrast,
                range = 0f..1f,
                steps = 19,
                format = ::formatPercent,
                onCommit = { v -> vm.update { it.copy(tone = it.tone.copy(localContrast = v)) } },
            )
            CardDivider()
            SwitchRow(
                title = stringResource(R.string.set_auto_levels),
                description = stringResource(R.string.set_auto_levels_desc),
                icon = Icons.Rounded.Tonality,
                checked = tone.autoLevels,
                onCheckedChange = { on -> vm.update { it.copy(tone = it.tone.copy(autoLevels = on)) } },
            )
            SwitchRow(
                title = stringResource(R.string.set_auto_backlight),
                description = stringResource(R.string.set_auto_backlight_desc),
                icon = Icons.Rounded.WbSunny,
                checked = tone.autoBacklight,
                onCheckedChange = { on -> vm.update { it.copy(tone = it.tone.copy(autoBacklight = on)) } },
            )
            CardDivider()
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.set_image_help),
                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = vm::resetImageDefaults) {
                    Text(text = stringResource(R.string.set_image_reset))
                }
            }
        }

        // --- Evento: testi stampati sui modelli.
        SectionHeader(text = stringResource(R.string.set_section_event), modifier = Modifier.padding(top = 24.dp))
        SettingsCard {
            Column(modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 8.dp)) {
                val title = vm.eventTitleDraft ?: settings.eventTitle
                OutlinedTextField(
                    value = title,
                    onValueChange = vm::onEventTitleChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .onFocusChanged { if (!it.isFocused) vm.commitTextFields() },
                    label = { Text(text = stringResource(R.string.set_event_title)) },
                    placeholder = { Text(text = stringResource(R.string.set_event_title_placeholder)) },
                    supportingText = {
                        Text(
                            text = "${title.length}/${SettingsViewModel.MAX_EVENT_TITLE}",
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.End,
                            fontFamily = FfFonts.Mono,
                        )
                    },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = ImeAction.Next,
                    ),
                )
                val hashtag = vm.hashtagDraft ?: settings.hashtag
                OutlinedTextField(
                    value = hashtag,
                    onValueChange = vm::onHashtagChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .onFocusChanged { if (!it.isFocused) vm.commitTextFields() },
                    label = { Text(text = stringResource(R.string.set_hashtag)) },
                    placeholder = { Text(text = stringResource(R.string.set_hashtag_placeholder)) },
                    supportingText = { Text(text = stringResource(R.string.set_event_help)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(
                        onDone = {
                            vm.commitTextFields()
                            focusManager.clearFocus()
                        },
                    ),
                )
            }
            CardDivider()
            SwitchRow(
                title = stringResource(R.string.set_show_date),
                icon = Icons.Rounded.Event,
                checked = settings.showDate,
                onCheckedChange = { on -> vm.update { it.copy(showDate = on) } },
            )
            SwitchRow(
                title = stringResource(R.string.set_show_number),
                description = stringResource(R.string.set_show_number_desc),
                icon = Icons.Rounded.ConfirmationNumber,
                checked = settings.showPrintNumber,
                onCheckedChange = { on -> vm.update { it.copy(showPrintNumber = on) } },
            )
            CounterRow(counter = settings.printCounter, onReset = onResetCounter)
            CardDivider()
            LabeledBlock(label = stringResource(R.string.set_default_template)) {
                ChoiceChipsRow(
                    options = TemplateKind.entries,
                    selected = settings.template,
                    label = { templateLabel(it) },
                    onSelect = { kind -> vm.update { it.copy(template = kind) } },
                )
            }
        }

        // --- Scatto.
        SectionHeader(text = stringResource(R.string.set_section_capture), modifier = Modifier.padding(top = 24.dp))
        SettingsCard {
            SwitchRow(
                title = stringResource(R.string.set_instant_print),
                description = stringResource(R.string.set_instant_print_desc),
                icon = Icons.Rounded.FlashOn,
                checked = settings.instantPrint,
                onCheckedChange = { on -> vm.update { it.copy(instantPrint = on) } },
            )
            SwitchRow(
                title = stringResource(R.string.set_auto_save),
                description = stringResource(R.string.set_auto_save_desc),
                icon = Icons.Rounded.PhotoLibrary,
                checked = settings.autoSaveCaptures,
                onCheckedChange = onAutoSaveChange,
            )
            if (settings.autoSaveCaptures && storagePermissionMissing) {
                PermissionHintRow(
                    text = stringResource(R.string.set_auto_save_permission),
                    actionText = stringResource(R.string.set_auto_save_allow),
                    onAction = onAllowStorage,
                )
            }
            CardDivider()
            LabeledBlock(label = stringResource(R.string.set_timer)) {
                ChoiceChipsRow(
                    options = TIMER_OPTIONS,
                    selected = settings.timerSeconds,
                    label = { seconds ->
                        if (seconds == 0) stringResource(R.string.set_timer_off) else stringResource(R.string.set_timer_seconds, seconds)
                    },
                    onSelect = { seconds -> vm.update { it.copy(timerSeconds = seconds) } },
                )
            }
            LabeledBlock(label = stringResource(R.string.set_strip_shots)) {
                ChoiceChipsRow(
                    options = STRIP_OPTIONS,
                    selected = settings.stripShots,
                    label = { shots -> stringResource(R.string.set_strip_shots_value, shots) },
                    onSelect = { shots -> vm.update { it.copy(stripShots = shots) } },
                )
            }
            CardDivider()
            SwitchRow(
                title = stringResource(R.string.set_shutter_sound),
                icon = Icons.Rounded.MusicNote,
                checked = settings.shutterSound,
                onCheckedChange = { on -> vm.update { it.copy(shutterSound = on) } },
            )
            SwitchRow(
                title = stringResource(R.string.set_live_preview),
                description = stringResource(R.string.set_live_preview_desc),
                icon = Icons.Rounded.Grain,
                checked = settings.livePreview,
                onCheckedChange = { on -> vm.update { it.copy(livePreview = on) } },
            )
        }

        // --- Informazioni.
        SectionHeader(text = stringResource(R.string.set_section_about), modifier = Modifier.padding(top = 24.dp))
        SettingsCard {
            ValueRow(
                icon = Icons.Rounded.Info,
                title = stringResource(R.string.set_version),
                value = BuildConfig.VERSION_NAME,
            )
            CardDivider()
            LinkRow(
                icon = Icons.Rounded.Code,
                title = stringResource(R.string.set_github),
                description = stringResource(R.string.set_github_desc),
                onClick = onOpenGithub,
            )
            LinkRow(
                icon = Icons.Rounded.Description,
                title = stringResource(R.string.set_licenses),
                description = stringResource(R.string.set_licenses_desc),
                onClick = onShowLicenses,
            )
        }

        BrandFooter(modifier = Modifier.fillMaxWidth().padding(top = 32.dp))
    }
}

// --- Righe ---------------------------------------------------------------------------------

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    // Tinta neutra derivata dal tema: funziona sia sul Paper chiaro sia sul Night scuro.
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.04f),
    ) {
        Column(modifier = Modifier.fillMaxWidth(), content = content)
    }
}

@Composable
private fun CardDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(horizontal = 16.dp),
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
    )
}

@Composable
private fun PrinterRow(settings: AppSettings, printerState: PrinterState, onOpenPrinter: () -> Unit) {
    val name = settings.printerName ?: settings.printerAddress
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onOpenPrinter)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(44.dp).clip(CircleShape).background(FfColors.Flash),
            contentAlignment = Alignment.Center,
        ) {
            Icon(imageVector = Icons.Rounded.Print, contentDescription = null, tint = FfColors.Ink)
        }
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = name ?: stringResource(R.string.set_printer_none),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (name == null) {
                    stringResource(R.string.set_printer_hint_none)
                } else {
                    stringResource(R.string.set_printer_paper, settings.paper.mm)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            PrinterStatusChip(state = printerState, onClick = onOpenPrinter)
        }
        Spacer(modifier = Modifier.width(8.dp))
        Icon(
            imageVector = Icons.AutoMirrored.Rounded.KeyboardArrowRight,
            contentDescription = stringResource(R.string.set_printer_open_cd),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun LabeledBlock(
    label: String,
    description: String? = null,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(text = label, style = MaterialTheme.typography.bodyLarge)
        if (description != null) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        content()
    }
}

@Composable
private fun SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    description: String? = null,
    icon: ImageVector? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp),
            )
            Spacer(modifier = Modifier.width(16.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge)
            if (description != null) {
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        // Il tocco lo gestisce la riga intera (toggleable): lo Switch e solo l'indicatore.
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = FfColors.Ink,
                checkedTrackColor = FfColors.Flash,
                checkedBorderColor = FfColors.Flash,
            ),
        )
    }
}

@Composable
private fun ToneSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int,
    format: (Float) -> String,
    onCommit: (Float) -> Unit,
    description: String? = null,
) {
    // Stato locale durante il trascinamento: si salva solo al rilascio, non a ogni pixel.
    var local by remember(value) { mutableFloatStateOf(value) }
    Column(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, end = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text(
                text = format(local),
                fontFamily = FfFonts.Mono,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (description != null) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Slider(
            value = local,
            onValueChange = { local = it },
            valueRange = range,
            steps = steps,
            onValueChangeFinished = { onCommit(local) },
            colors = SliderDefaults.colors(
                thumbColor = FfColors.FlashDeep,
                activeTrackColor = FfColors.Flash,
                // Decine di tacche sul binario sarebbero solo rumore visivo.
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent,
            ),
        )
    }
}

/** Avviso sotto un interruttore che da solo non basta (manca un permesso), con l'azione per rimediare. */
@Composable
private fun PermissionHintRow(text: String, actionText: String, onAction: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 54.dp, end = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall,
            // Il rosso del tema e leggibile sia su Paper sia su Night (il Coral puro no).
            color = MaterialTheme.colorScheme.error,
        )
        TextButton(onClick = onAction) {
            Text(text = actionText)
        }
    }
}

@Composable
private fun CounterRow(counter: Int, onReset: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 54.dp, top = 4.dp, end = 16.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = stringResource(R.string.set_counter), style = MaterialTheme.typography.bodyMedium)
            Text(
                text = if (counter > 0) {
                    stringResource(R.string.set_counter_value, counter)
                } else {
                    stringResource(R.string.set_counter_zero)
                },
                fontFamily = FfFonts.Mono,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        GhostButton(
            text = stringResource(R.string.set_counter_reset),
            onClick = onReset,
            enabled = counter > 0,
        )
    }
}

@Composable
private fun ValueRow(icon: ImageVector, title: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(22.dp),
        )
        Spacer(modifier = Modifier.width(16.dp))
        Text(text = title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(
            text = value,
            fontFamily = FfFonts.Mono,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun LinkRow(icon: ImageVector, title: String, description: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(22.dp),
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge)
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(
            imageVector = Icons.AutoMirrored.Rounded.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun BrandFooter(modifier: Modifier = Modifier) {
    val onDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        BrandWordmark(height = 24.dp, onDark = onDark)
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = stringResource(R.string.set_tagline),
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FfFonts.Mono,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun LicensesDialog(onDismiss: () -> Unit, onOpenLicense: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(text = stringResource(R.string.set_licenses_title)) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                LicenseBlock(
                    name = stringResource(R.string.set_font_righteous),
                    copyright = stringResource(R.string.set_license_righteous),
                )
                LicenseBlock(
                    name = stringResource(R.string.set_font_space_mono),
                    copyright = stringResource(R.string.set_license_space_mono),
                )
                Text(text = stringResource(R.string.set_licenses_ofl), style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(text = stringResource(R.string.set_ok)) }
        },
        dismissButton = {
            TextButton(onClick = onOpenLicense) { Text(text = stringResource(R.string.set_licenses_read)) }
        },
    )
}

@Composable
private fun LicenseBlock(name: String, copyright: String) {
    Column {
        Text(text = name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Text(
            text = copyright,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FfFonts.Mono,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// --- Etichette ------------------------------------------------------------------------------

@Composable
private fun ditherLabel(algorithm: DitherAlgorithm): String = stringResource(
    when (algorithm) {
        DitherAlgorithm.ATKINSON -> R.string.set_dither_atkinson
        DitherAlgorithm.FLOYD_STEINBERG -> R.string.set_dither_floyd
        DitherAlgorithm.ORDERED_BAYER -> R.string.set_dither_bayer
        DitherAlgorithm.THRESHOLD -> R.string.set_dither_threshold
    },
)

@Composable
private fun ditherDescription(algorithm: DitherAlgorithm): String = stringResource(
    when (algorithm) {
        DitherAlgorithm.ATKINSON -> R.string.set_dither_desc_atkinson
        DitherAlgorithm.FLOYD_STEINBERG -> R.string.set_dither_desc_floyd
        DitherAlgorithm.ORDERED_BAYER -> R.string.set_dither_desc_bayer
        DitherAlgorithm.THRESHOLD -> R.string.set_dither_desc_threshold
    },
)

@Composable
private fun templateLabel(kind: TemplateKind): String = stringResource(
    when (kind) {
        TemplateKind.POLAROID -> R.string.set_template_polaroid
        TemplateKind.FULL -> R.string.set_template_full
        TemplateKind.STRIP -> R.string.set_template_strip
        TemplateKind.RECEIPT -> R.string.set_template_receipt
    },
)

// --- Formati numerici (non sono testi tradotti: solo cifre e segni) --------------------------

private fun formatSigned(value: Float): String {
    val percent = (value * 100f).roundToInt()
    return when {
        percent > 0 -> "+$percent"
        else -> percent.toString()
    }
}

private fun formatPercent(value: Float): String = "${(value * 100f).roundToInt()}%"

private fun formatDecimal(value: Float): String = String.format(Locale.ROOT, "%.2f", value)

/** Apre un link; false se nessuna app sa farlo (succede su dispositivi senza browser). */
private fun startViewIntent(context: Context, url: String): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
    true
} catch (e: ActivityNotFoundException) {
    false
}
