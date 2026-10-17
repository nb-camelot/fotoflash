package io.github.nik2208.fotoflash.editor

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
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
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.SaveAlt
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.TextFields
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.WbSunny
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
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.thermal.DitherAlgorithm
import io.github.nik2208.fotoflash.thermal.PaperWidth
import io.github.nik2208.fotoflash.thermal.TemplateGeometry
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.thermal.TemplateTexts
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
import io.github.nik2208.fotoflash.ui.theme.FfPillShape
import kotlinx.coroutines.launch
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
            // Le snackbar partono a parte: showSnackbar sospende finche non spariscono, e un evento
            // Share in coda dietro "Salvata in galleria" aprirebbe il chooser con secondi di ritardo.
            when (event) {
                is EditorEvent.Share -> {
                    val chooser = Intent.createChooser(event.intent, context.getString(R.string.ed_share_title))
                    val started = try {
                        context.startActivity(chooser)
                        true
                    } catch (e: ActivityNotFoundException) {
                        false
                    }
                    if (!started) {
                        launch { snackbarHostState.showSnackbar(context.getString(R.string.ed_share_failed)) }
                    }
                }
                is EditorEvent.Message -> {
                    launch {
                        // Il messaggio nuovo sostituisce quello vecchio invece di aspettarlo.
                        snackbarHostState.currentSnackbarData?.dismiss()
                        snackbarHostState.showSnackbar(context.getString(event.text))
                    }
                }
            }
        }
    }

    // Android 8-9 vuole il permesso di scrittura per salvare in Pictures; dal 10 basta MediaStore.
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.save() else vm.showMessage(R.string.ed_save_permission)
    }
    val onSave: () -> Unit = {
        if (graph.exporter.needsLegacyWritePermission()) {
            storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            vm.save()
        }
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
        onReprint = vm::reprint,
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
            // Sopra l'anteprima, dove si vede l'effetto: dice perche la foto e piu chiara dello scatto.
            BacklightBadge(
                visible = state.backlightDetected && state.preview != null,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(start = 12.dp, top = 12.dp),
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

/**
 * Pillola "Controluce rilevato": compare quando la correzione automatica ha schiarito la foto.
 * Funzione a parte per lo stesso motivo di RenderingIndicator (AnimatedVisibility senza scope).
 * Gialla come le cose "accese" del brand, con un'ombra che la stacca dalla carta quando si scorre.
 */
@Composable
private fun BacklightBadge(visible: Boolean, modifier: Modifier = Modifier) {
    val spoken = stringResource(R.string.ed_backlight_detected_cd)
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(animationSpec = tween(durationMillis = 220)) +
            scaleIn(initialScale = 0.85f, animationSpec = tween(durationMillis = 220)),
        exit = fadeOut(animationSpec = tween(durationMillis = 150)) +
            scaleOut(targetScale = 0.85f, animationSpec = tween(durationMillis = 150)),
    ) {
        Surface(
            // Una sola frase per TalkBack (non etichetta + descrizione), annunciata quando compare
            // senza interrompere quello che sta leggendo.
            modifier = Modifier.clearAndSetSemantics {
                contentDescription = spoken
                liveRegion = LiveRegionMode.Polite
            },
            shape = FfPillShape,
            color = FfColors.Flash,
            contentColor = FfColors.Ink,
            shadowElevation = 3.dp,
        ) {
            Row(
                modifier = Modifier.padding(start = 8.dp, end = 12.dp, top = 5.dp, bottom = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Rounded.WbSunny,
                    contentDescription = null,
                    tint = FfColors.Ink,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = stringResource(R.string.ed_backlight_detected),
                    style = MaterialTheme.typography.labelMedium,
                    color = FfColors.Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Margine minimo del "tavolo" ai lati del foglio, usato solo se la carta altrimenti non ci sta. */
private val PreviewEdge = 8.dp

/** Margine in piu per lato quando la scala lo consente: il foglio resta a 24 dp dal bordo. */
private val PreviewBreath = 16.dp

/** Padding orizzontale interno di PaperSheet (16 dp per lato). */
private val PreviewSheetPadding = 16.dp

@Composable
private fun PreviewArea(state: EditorUiState, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            // Il "tavolo" su cui posa il foglio: la carta si stacca dallo sfondo anche nel tema scuro.
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PreviewEdge, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val preview = state.preview
        if (preview != null) {
            BoxWithConstraints(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                val density = LocalDensity.current
                val dots = preview.width.coerceAtLeast(1)
                // Scala INTERA (ogni punto della testina = N x N pixel): con una scala frazionaria, e
                // peggio sotto 1:1, il retino si deformerebbe o perderebbe colonne che la carta ha.
                val roomyPx = with(density) { (maxWidth - (PreviewBreath + PreviewSheetPadding) * 2).roundToPx() }
                val tightPx = with(density) { (maxWidth - PreviewSheetPadding * 2).roundToPx() }
                val scale = if (roomyPx >= dots) roomyPx / dots else tightPx / dots
                val imageWidth = with(density) { (dots * scale.coerceAtLeast(1)).toDp() }
                if (scale >= 1) {
                    PreviewSheet(preview = preview, imageWidth = imageWidth)
                } else {
                    // Carta da 80 mm su un telefono stretto: 1:1 con scorrimento laterale, mai punti persi.
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                    ) {
                        PreviewSheet(preview = preview, imageWidth = imageWidth)
                    }
                }
            }
        } else {
            PaperSheet(
                modifier = Modifier
                    .widthIn(max = 360.dp)
                    .fillMaxWidth(0.86f),
            ) {
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

/**
 * Il foglio con la stampa a larghezza esatta [imageWidth]: il foglio si adatta all'immagine e non
 * il contrario, cosi la scala intera calcolata da PreviewArea arriva intatta a ThermalImage.
 */
@Composable
private fun PreviewSheet(preview: Bitmap, imageWidth: Dp) {
    PaperSheet {
        ThermalImage(
            bitmap = preview,
            contentDescription = stringResource(R.string.ed_preview_cd),
            modifier = Modifier.width(imageWidth),
        )
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

/** Tessera di un modello: miniatura + nome; la scelta e gialla come ogni cosa "accesa" nel brand. */
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
        TemplateThumbnail(kind = kind, color = content)
        Text(
            text = stringResource(templateLabel(kind)),
            style = MaterialTheme.typography.labelSmall,
            color = content,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Testi di prova per le miniature: bastano a far comparire tutte le fasce di ogni modello. */
private val ThumbnailTexts = TemplateTexts(
    caption = "Aa",
    eventTitle = "Aa",
    hashtag = "a",
    dateText = "00",
    printNumber = 1,
)

/**
 * Miniatura di un modello: la stessa impaginazione del core in piccolo (foto piene, testi a
 * barrette), cosi si vede la forma della carta prima di sceglierla. Colore unico, come un'icona.
 */
@Composable
private fun TemplateThumbnail(kind: TemplateKind, color: Color, modifier: Modifier = Modifier) {
    val layout = remember(kind) {
        TemplateGeometry.layout(kind, PaperWidth.MM58, if (kind == TemplateKind.STRIP) 3 else 1, ThumbnailTexts)
    }
    val ratio = if (layout.width > 0 && layout.height > 0) layout.width.toFloat() / layout.height.toFloat() else 1f
    Canvas(
        modifier = modifier
            .height(36.dp)
            .aspectRatio(ratio),
    ) {
        val k = size.width / layout.width.coerceAtLeast(1).toFloat()
        val line = 1.dp.toPx()
        drawRect(color = color, style = Stroke(width = line))
        for (photo in layout.photos) {
            drawRect(
                color = color.copy(alpha = 0.55f),
                topLeft = Offset(photo.left * k, photo.top * k),
                size = Size(photo.width * k, photo.height * k),
            )
        }
        for (block in layout.texts) {
            val r = block.rect
            val barWidth = r.width * k * 0.6f
            val barHeight = (r.height * k * 0.45f).coerceAtLeast(line)
            drawRect(
                color = color,
                topLeft = Offset(r.left * k + (r.width * k - barWidth) / 2f, r.top * k + (r.height * k - barHeight) / 2f),
                size = Size(barWidth, barHeight),
            )
        }
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
    // Ombre e contrasto locale accanto ai toni: sono i controlli del controluce, il viso scuro
    // davanti a un cielo chiaro che sulla carta diventerebbe una macchia.
    AdjustSlider(
        label = stringResource(R.string.ed_adjust_shadows),
        value = state.tone.shadows,
        valueRange = 0f..1f,
        signed = false,
        onChange = vm::setShadows,
    )
    AdjustSlider(
        label = stringResource(R.string.ed_adjust_local_contrast),
        value = state.tone.localContrast,
        valueRange = 0f..1f,
        signed = false,
        onChange = vm::setLocalContrast,
    )
    AdjustSlider(
        label = stringResource(R.string.ed_adjust_sharpen),
        value = state.tone.sharpen,
        valueRange = 0f..1f,
        signed = false,
        onChange = vm::setSharpen,
    )
    AdjustSwitchRow(
        title = stringResource(R.string.ed_adjust_autobacklight),
        // Il suggerimento cambia con la foto: spiega cosa e successo, o cosa si guadagna ad accenderlo.
        hint = stringResource(
            when {
                state.backlightDetected -> R.string.ed_adjust_autobacklight_detected
                state.backlightLikely -> R.string.ed_adjust_autobacklight_suggest
                else -> R.string.ed_adjust_autobacklight_hint
            },
        ),
        checked = state.tone.autoBacklight,
        onChange = vm::setAutoBacklight,
    )
    AdjustSwitchRow(
        title = stringResource(R.string.ed_adjust_autolevels),
        hint = stringResource(R.string.ed_adjust_autolevels_hint),
        checked = state.tone.autoLevels,
        onChange = vm::setAutoLevels,
    )
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

/**
 * Interruttore delle regolazioni: titolo, una riga di aiuto e lo Switch con i colori del brand
 * (giallo acceso, pallino inchiostro), gli stessi delle Impostazioni.
 */
@Composable
private fun AdjustSwitchRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = hint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(12.dp))
        // onCheckedChange null: tocca tutta la riga (toggleable), non solo l'interruttore.
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

@Composable
private fun ditherLabel(algorithm: DitherAlgorithm): String = stringResource(
    when (algorithm) {
        DitherAlgorithm.ATKINSON -> R.string.ed_dither_atkinson
        DitherAlgorithm.FLOYD_STEINBERG -> R.string.ed_dither_floyd
        DitherAlgorithm.ORDERED_BAYER -> R.string.ed_dither_bayer
        DitherAlgorithm.THRESHOLD -> R.string.ed_dither_threshold
    },
)
