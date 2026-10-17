package io.github.nik2208.fotoflash.editor

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddAPhoto
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CropPortrait
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Portrait
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.Receipt
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.SaveAlt
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.TextFields
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.ViewAgenda
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.ui.components.ChoiceChipsRow
import io.github.nik2208.fotoflash.ui.components.EmptyState
import io.github.nik2208.fotoflash.ui.components.FfTopBar
import io.github.nik2208.fotoflash.ui.components.FlashButton
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.PaperSheet
import io.github.nik2208.fotoflash.ui.components.PrinterStatusChip
import io.github.nik2208.fotoflash.ui.components.SectionHeader
import io.github.nik2208.fotoflash.ui.components.ThermalImage
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import kotlin.math.roundToInt

/** Schede del pannello dei controlli. */
private enum class EditorTab { TEMPLATE, TEXT, ADJUST }

/**
 * Editor e stampa: anteprima WYSIWYG su un foglio di carta, controlli raccolti in tre schede,
 * e in basso le azioni. "Stampa" e sempre visibile: dallo scatto alla carta bastano due tocchi.
 */
@Composable
fun EditorScreen(onBack: () -> Unit, onDone: () -> Unit, onOpenPrinter: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val vm: EditorViewModel = viewModel { EditorViewModel(graph) }
    val state by vm.state.collectAsStateWithLifecycle()
    val printerState by graph.printer.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(vm) {
        vm.events.collect { event ->
            when (event) {
                is EditorEvent.Share -> {
                    val chooser = Intent.createChooser(event.intent, context.getString(R.string.ed_share_title))
                    val started = try {
                        context.startActivity(chooser)
                        true
                    } catch (e: ActivityNotFoundException) {
                        false
                    }
                    if (!started) snackbarHostState.showSnackbar(context.getString(R.string.ed_share_failed))
                }
                is EditorEvent.Message -> snackbarHostState.showSnackbar(context.getString(event.text))
            }
        }
    }

    // Android 8-9 vuole il permesso di scrittura per salvare in Pictures; dal 10 basta MediaStore.
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.save() else vm.showMessage(R.string.ed_save_permission)
    }
    val onSave: () -> Unit = {
        val needsPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
            PackageManager.PERMISSION_GRANTED
        if (needsPermission) storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) else vm.save()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when {
            state.loading -> FfTopBar(title = stringResource(R.string.ed_title), onBack = onBack)
            state.isEmpty -> EmptyEditor(onBack = onBack)
            else -> EditorContent(
                state = state,
                printerState = printerState,
                snackbarHostState = snackbarHostState,
                vm = vm,
                onBack = onBack,
                onOpenPrinter = onOpenPrinter,
                onSave = onSave,
            )
        }
    }

    PrintProgressSheet(
        phase = state.printPhase,
        onDismiss = vm::dismissPrint,
        onRetry = vm::print,
        onReprint = vm::print,
        onNewPhoto = {
            vm.finishSession()
            onDone()
        },
        onOpenPrinter = {
            // Prima si chiude il foglio: al ritorno dalla schermata stampante non deve riapparire.
            vm.dismissPrint()
            onOpenPrinter()
        },
    )
}

@Composable
private fun EmptyEditor(onBack: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        FfTopBar(title = stringResource(R.string.ed_title), onBack = onBack)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentAlignment = Alignment.Center,
        ) {
            EmptyState(
                icon = Icons.Rounded.AddAPhoto,
                title = stringResource(R.string.ed_empty_title),
                message = stringResource(R.string.ed_empty_message),
                actionText = stringResource(R.string.ed_empty_action),
                onAction = onBack,
            )
        }
    }
}

@Composable
private fun EditorContent(
    state: EditorUiState,
    printerState: PrinterState,
    snackbarHostState: SnackbarHostState,
    vm: EditorViewModel,
    onBack: () -> Unit,
    onOpenPrinter: () -> Unit,
    onSave: () -> Unit,
) {
    // Scheda aperta (null = pannello chiuso, piu spazio all'anteprima) e scheda mostrata
    // durante l'animazione di chiusura, che non deve cambiare contenuto mentre si chiude.
    var openTab by rememberSaveable { mutableStateOf<EditorTab?>(EditorTab.TEMPLATE) }
    var shownTab by rememberSaveable { mutableStateOf(EditorTab.TEMPLATE) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            // La tastiera della didascalia spinge su il pannello invece di coprirlo.
            .windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime).only(WindowInsetsSides.Bottom)),
    ) {
        FfTopBar(
            title = stringResource(R.string.ed_title),
            onBack = onBack,
            actions = {
                PrinterStatusChip(
                    state = printerState,
                    onClick = onOpenPrinter,
                    modifier = Modifier.padding(end = 12.dp),
                )
            },
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            PreviewArea(state = state, modifier = Modifier.fillMaxSize())
            RenderingIndicator(
                visible = state.rendering,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth(),
            )
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 12.dp,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                TabSwitcher(
                    open = openTab,
                    onClick = { tab ->
                        if (openTab == tab) {
                            openTab = null
                        } else {
                            openTab = tab
                            shownTab = tab
                        }
                    },
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
                AnimatedVisibility(visible = openTab != null) {
                    Crossfade(
                        targetState = shownTab,
                        modifier = Modifier.animateContentSize(),
                        label = "editorTab",
                    ) { tab ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 236.dp)
                                .verticalScroll(rememberScrollState())
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                        ) {
                            when (tab) {
                                EditorTab.TEMPLATE -> TemplatePicker(selected = state.template, onSelect = vm::selectTemplate)
                                EditorTab.TEXT -> CaptionEditor(caption = state.caption, onChange = vm::setCaption)
                                EditorTab.ADJUST -> AdjustPanel(state = state, vm = vm)
                            }
                        }
                    }
                }
                ActionBar(
                    state = state,
                    onSave = onSave,
                    onShare = vm::share,
                    onPrint = vm::print,
                    onCopies = vm::setCopies,
                )
            }
        }
    }
}

// ---------------------------------------------------------------- anteprima

/**
 * Indicatore discreto del ricalcolo: compare solo se il calcolo dura piu di un attimo.
 * Funzione a parte anche perche, chiamato dentro un Box annidato in una Column, AnimatedVisibility
 * verrebbe risolto sull'estensione di ColumnScope (errore di compilazione per il DslMarker).
 */
@Composable
private fun RenderingIndicator(visible: Boolean, modifier: Modifier = Modifier) {
    val label = stringResource(R.string.ed_rendering)
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(animationSpec = tween(durationMillis = 200, delayMillis = 150)),
        exit = fadeOut(animationSpec = tween(durationMillis = 150)),
    ) {
        LinearProgressIndicator(
            modifier = Modifier
                .fillMaxWidth()
                .height(3.dp)
                .semantics { contentDescription = label },
            color = MaterialTheme.colorScheme.onSurface,
            trackColor = Color.Transparent,
        )
    }
}

@Composable
private fun PreviewArea(state: EditorUiState, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            // Il "tavolo" su cui posa il foglio: la carta si stacca dallo sfondo anche nel tema scuro.
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val preview = state.preview
        PaperSheet(
            modifier = Modifier
                .fillMaxWidth(0.86f)
                .widthIn(max = 360.dp),
        ) {
            if (preview != null) {
                ThermalImage(bitmap = preview, contentDescription = stringResource(R.string.ed_preview_cd))
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(0.78f),
                    contentAlignment = Alignment.Center,
                ) {
                    if (state.renderFailed) {
                        Text(
                            text = stringResource(R.string.ed_render_failed),
                            style = MaterialTheme.typography.bodyMedium,
                            color = FfColors.Graphite,
                            textAlign = TextAlign.Center,
                        )
                    } else {
                        CircularProgressIndicator(
                            modifier = Modifier.size(32.dp),
                            color = FfColors.Ink,
                            strokeWidth = 3.dp,
                            trackColor = Color.Transparent,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        when {
            state.renderFailed && preview != null -> Text(
                text = stringResource(R.string.ed_render_failed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
            )
            preview != null -> Text(
                text = stringResource(R.string.ed_preview_paper, state.paperLengthMm),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ---------------------------------------------------------------- schede

@Composable
private fun TabSwitcher(open: EditorTab?, onClick: (EditorTab) -> Unit, modifier: Modifier = Modifier) {
    val pill = RoundedCornerShape(50)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(pill)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(4.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        EditorTab.entries.forEach { tab ->
            val selected = tab == open
            val container by animateColorAsState(
                targetValue = if (selected) MaterialTheme.colorScheme.onSurface else Color.Transparent,
                label = "tabContainer",
            )
            val content = if (selected) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface
            Row(
                modifier = Modifier
                    .weight(1f)
                    .height(40.dp)
                    .clip(pill)
                    .background(container)
                    .selectable(selected = selected, role = Role.Tab, onClick = { onClick(tab) }),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = tabIcon(tab),
                    contentDescription = null,
                    tint = content,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = stringResource(tabLabel(tab)),
                    style = MaterialTheme.typography.labelLarge,
                    color = content,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun TemplatePicker(selected: TemplateKind, onSelect: (TemplateKind) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TemplateKind.entries.forEach { kind ->
            TemplateTile(
                kind = kind,
                selected = kind == selected,
                onClick = { onSelect(kind) },
                modifier = Modifier.weight(1f),
            )
        }
    }
    Spacer(Modifier.height(10.dp))
    Text(
        text = stringResource(templateDescription(selected)),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Tessera di un modello: icona + nome; la scelta e gialla come ogni cosa "accesa" nel brand. */
@Composable
private fun TemplateTile(kind: TemplateKind, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(16.dp)
    val container by animateColorAsState(
        targetValue = if (selected) FfColors.Flash else MaterialTheme.colorScheme.surfaceContainerHigh,
        label = "templateTile",
    )
    val content = if (selected) FfColors.Ink else MaterialTheme.colorScheme.onSurface
    Column(
        modifier = modifier
            .clip(shape)
            .background(container)
            .border(
                width = if (selected) 2.dp else 1.dp,
                color = if (selected) FfColors.Ink else MaterialTheme.colorScheme.outlineVariant,
                shape = shape,
            )
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            imageVector = templateIcon(kind),
            contentDescription = null,
            tint = content,
            modifier = Modifier.size(26.dp),
        )
        Text(
            text = stringResource(templateLabel(kind)),
            style = MaterialTheme.typography.labelSmall,
            color = content,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun CaptionEditor(caption: String, onChange: (String) -> Unit) {
    val focusManager = LocalFocusManager.current
    // Stato locale: il campo risponde subito ai tasti senza aspettare il giro dal ViewModel.
    var text by rememberSaveable { mutableStateOf(caption) }
    OutlinedTextField(
        value = text,
        onValueChange = { input ->
            val clean = input.replace('\n', ' ').take(EditorViewModel.MAX_CAPTION)
            text = clean
            onChange(clean)
        },
        modifier = Modifier.fillMaxWidth(),
        // Space Mono grassetto: lo stesso carattere con cui la didascalia esce sulla carta.
        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FfFonts.Mono, fontWeight = FontWeight.Bold),
        label = { Text(text = stringResource(R.string.ed_caption_label)) },
        placeholder = { Text(text = stringResource(R.string.ed_caption_placeholder)) },
        trailingIcon = if (text.isNotEmpty()) {
            {
                IconButton(
                    onClick = {
                        text = ""
                        onChange("")
                    },
                ) {
                    Icon(imageVector = Icons.Rounded.Close, contentDescription = stringResource(R.string.ed_caption_clear))
                }
            }
        } else {
            null
        },
        supportingText = {
            Text(
                text = stringResource(R.string.ed_caption_counter, text.length, EditorViewModel.MAX_CAPTION),
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.End,
            )
        },
        singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
    )
    Spacer(Modifier.height(4.dp))
    Text(
        text = stringResource(R.string.ed_caption_hint),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun AdjustPanel(state: EditorUiState, vm: EditorViewModel) {
    AdjustSlider(
        label = stringResource(R.string.ed_adjust_brightness),
        value = state.tone.brightness,
        valueRange = -1f..1f,
        signed = true,
        onChange = vm::setBrightness,
    )
    AdjustSlider(
        label = stringResource(R.string.ed_adjust_contrast),
        value = state.tone.contrast,
        valueRange = -1f..1f,
        signed = true,
        onChange = vm::setContrast,
    )
    AdjustSlider(
        label = stringResource(R.string.ed_adjust_sharpen),
        value = state.tone.sharpen,
        valueRange = 0f..1f,
        signed = false,
        onChange = vm::setSharpen,
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = state.tone.autoLevels, role = Role.Switch, onValueChange = vm::setAutoLevels)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.ed_adjust_autolevels),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = stringResource(R.string.ed_adjust_autolevels_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(12.dp))
        // onCheckedChange null: tocca tutta la riga (toggleable), non solo l'interruttore.
        Switch(checked = state.tone.autoLevels, onCheckedChange = null)
    }
    SectionHeader(text = stringResource(R.string.ed_adjust_dither))
    ChoiceChipsRow(
        options = DitherAlgorithm.entries,
        selected = state.dither,
        label = { algorithm -> ditherLabel(algorithm) },
        onSelect = vm::selectDither,
    )
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        TextButton(
            onClick = vm::resetAdjustments,
            enabled = state.adjustmentsChanged,
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
        ) {
            Text(text = stringResource(R.string.ed_adjust_reset))
        }
    }
}

@Composable
private fun AdjustSlider(
    label: String,
    value: Float,
    valueRange: ClosedFloatingPointRange<Float>,
    signed: Boolean,
    onChange: (Float) -> Unit,
) {
    val percent = (value * 100f).roundToInt()
    val valueText = if (signed) {
        stringResource(R.string.ed_adjust_value_signed, percent)
    } else {
        stringResource(R.string.ed_adjust_value, percent)
    }
    val ink = MaterialTheme.colorScheme.onSurface
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = ink,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = valueText,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    // Inchiostro invece del giallo: sulla carta chiara il giallo del tema non si legge.
    Slider(
        value = value,
        onValueChange = onChange,
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = label },
        valueRange = valueRange,
        colors = SliderDefaults.colors(
            thumbColor = ink,
            activeTrackColor = ink,
            inactiveTrackColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    )
}

// ---------------------------------------------------------------- azioni

@Composable
private fun ActionBar(
    state: EditorUiState,
    onSave: () -> Unit,
    onShare: () -> Unit,
    onPrint: () -> Unit,
    onCopies: (Int) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            // Sui telefoni stretti le icone ruberebbero spazio al testo dei pulsanti.
            val roomy = maxWidth >= 352.dp
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                GhostButton(
                    text = stringResource(R.string.ed_save),
                    onClick = onSave,
                    modifier = Modifier.weight(1f),
                    icon = if (roomy) Icons.Rounded.SaveAlt else null,
                    enabled = state.canExport,
                )
                GhostButton(
                    text = stringResource(R.string.ed_share),
                    onClick = onShare,
                    modifier = Modifier.weight(1f),
                    icon = if (roomy) Icons.Rounded.Share else null,
                    enabled = state.canExport,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Stesso rialzo di 4 dp dei pulsanti, cosi lo stepper si allinea alla pillola gialla.
            CopiesStepper(
                copies = state.copies,
                onChange = onCopies,
                modifier = Modifier.padding(bottom = 4.dp),
            )
            FlashButton(
                text = stringResource(R.string.ed_print),
                onClick = onPrint,
                modifier = Modifier.weight(1f),
                icon = Icons.Rounded.Print,
                enabled = state.canPrint,
                busy = state.printPhase is PrintPhase.Running,
            )
        }
    }
}

@Composable
private fun CopiesStepper(copies: Int, onChange: (Int) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val spoken = context.resources.getQuantityString(R.plurals.ed_copies, copies, copies)
    val ink = MaterialTheme.colorScheme.onSurface
    Row(
        modifier = modifier
            .height(56.dp)
            .border(width = 2.dp, color = ink, shape = RoundedCornerShape(50))
            .padding(horizontal = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = { onChange(copies - 1) }, enabled = copies > EditorViewModel.MIN_COPIES) {
            Icon(imageVector = Icons.Rounded.Remove, contentDescription = stringResource(R.string.ed_copies_less))
        }
        Text(
            text = stringResource(R.string.ed_copies_short, copies),
            style = MaterialTheme.typography.titleMedium.copy(fontFamily = FfFonts.Mono, fontWeight = FontWeight.Bold),
            color = ink,
            modifier = Modifier.semantics { contentDescription = spoken },
        )
        IconButton(onClick = { onChange(copies + 1) }, enabled = copies < EditorViewModel.MAX_COPIES) {
            Icon(imageVector = Icons.Rounded.Add, contentDescription = stringResource(R.string.ed_copies_more))
        }
    }
}

// ---------------------------------------------------------------- etichette e icone

@StringRes
private fun tabLabel(tab: EditorTab): Int = when (tab) {
    EditorTab.TEMPLATE -> R.string.ed_tab_template
    EditorTab.TEXT -> R.string.ed_tab_text
    EditorTab.ADJUST -> R.string.ed_tab_adjust
}

private fun tabIcon(tab: EditorTab): ImageVector = when (tab) {
    EditorTab.TEMPLATE -> Icons.Rounded.Dashboard
    EditorTab.TEXT -> Icons.Rounded.TextFields
    EditorTab.ADJUST -> Icons.Rounded.Tune
}

@StringRes
private fun templateLabel(kind: TemplateKind): Int = when (kind) {
    TemplateKind.POLAROID -> R.string.ed_template_polaroid
    TemplateKind.FULL -> R.string.ed_template_full
    TemplateKind.STRIP -> R.string.ed_template_strip
    TemplateKind.RECEIPT -> R.string.ed_template_receipt
}

@StringRes
private fun templateDescription(kind: TemplateKind): Int = when (kind) {
    TemplateKind.POLAROID -> R.string.ed_template_polaroid_desc
    TemplateKind.FULL -> R.string.ed_template_full_desc
    TemplateKind.STRIP -> R.string.ed_template_strip_desc
    TemplateKind.RECEIPT -> R.string.ed_template_receipt_desc
}

private fun templateIcon(kind: TemplateKind): ImageVector = when (kind) {
    TemplateKind.POLAROID -> Icons.Rounded.Portrait
    TemplateKind.FULL -> Icons.Rounded.CropPortrait
    TemplateKind.STRIP -> Icons.Rounded.ViewAgenda
    TemplateKind.RECEIPT -> Icons.Rounded.Receipt
}

@Composable
private fun ditherLabel(algorithm: DitherAlgorithm): String = stringResource(
    when (algorithm) {
        DitherAlgorithm.ATKINSON -> R.string.ed_dither_atkinson
        DitherAlgorithm.FLOYD_STEINBERG -> R.string.ed_dither_floyd
        DitherAlgorithm.ORDERED_BAYER -> R.string.ed_dither_bayer
        DitherAlgorithm.THRESHOLD -> R.string.ed_dither_threshold
    },
)
