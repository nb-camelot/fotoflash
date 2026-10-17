package io.github.nik2208.fotoflash.history

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.annotation.StringRes
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BrokenImage
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.SaveAlt
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.HistoryEntry
import io.github.nik2208.fotoflash.thermal.TemplateKind
import io.github.nik2208.fotoflash.ui.components.EmptyState
import io.github.nik2208.fotoflash.ui.components.FfTopBar
import io.github.nik2208.fotoflash.ui.components.FlashButton
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.PaperSheet
import io.github.nik2208.fotoflash.ui.components.ThermalImage
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * [onOpenPrinter] e facoltativo: se c'e, gli errori "nessuna stampante" e "carta diversa" propongono
 * di aprire la schermata Stampante; senza, resta solo il testo.
 */
@Composable
fun HistoryDetailScreen(entryId: String, onBack: () -> Unit, onOpenPrinter: (() -> Unit)? = null) {
    val context = LocalContext.current
    val graph = context.appGraph
    val vm = viewModel(key = "history-detail-$entryId") { HistoryDetailViewModel(graph, entryId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    val shareTitle = stringResource(R.string.hist_share_chooser)
    val currentOnBack by rememberUpdatedState(onBack)
    val currentOnOpenPrinter by rememberUpdatedState(onOpenPrinter)

    // Android 8-9: scrivere in Immagini richiede il permesso di archiviazione.
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.save() else vm.onStoragePermissionDenied()
    }
    val requestSave: () -> Unit = {
        val needsPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
            PackageManager.PERMISSION_GRANTED
        if (needsPermission) storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) else vm.save()
    }

    LaunchedEffect(vm) {
        vm.events.collect { event ->
            when (event) {
                is HistoryDetailEvent.Message -> {
                    val text = if (event.args.isEmpty()) {
                        context.getString(event.resId)
                    } else {
                        context.getString(event.resId, *event.args.toTypedArray())
                    }
                    // L'azione "Stampante" si offre solo se la schermata e raggiungibile da qui.
                    val fix = event.fix?.takeIf { it != ReprintFix.PRINTER || currentOnOpenPrinter != null }
                    val actionLabel = fix?.let { context.getString(fixLabel(it)) }
                    // In un'altra coroutine: la snackbar resta a schermo senza bloccare gli eventi successivi.
                    launch {
                        snackbar.currentSnackbarData?.dismiss()
                        // Con un'azione la durata predefinita sarebbe infinita: Long basta per leggerla e toccarla.
                        val result = snackbar.showSnackbar(
                            message = text,
                            actionLabel = actionLabel,
                            duration = if (actionLabel != null) SnackbarDuration.Long else SnackbarDuration.Short,
                        )
                        if (result == SnackbarResult.ActionPerformed && fix != null) {
                            when (fix) {
                                ReprintFix.RETRY -> vm.reprint()
                                ReprintFix.BLUETOOTH -> openBluetoothSettings(context)
                                ReprintFix.PERMISSION -> {
                                    val openPrinter = currentOnOpenPrinter
                                    if (openPrinter != null) openPrinter() else openAppSettings(context)
                                }
                                ReprintFix.PRINTER -> currentOnOpenPrinter?.invoke()
                            }
                        }
                    }
                }

                is HistoryDetailEvent.Share -> {
                    try {
                        context.startActivity(Intent.createChooser(event.intent, shareTitle))
                    } catch (e: ActivityNotFoundException) {
                        val text = context.getString(R.string.hist_msg_share_failed)
                        launch { snackbar.showSnackbar(text) }
                    }
                }

                HistoryDetailEvent.Deleted -> currentOnBack()
            }
        }
    }

    val entry = state.entry
    Scaffold(
        topBar = {
            FfTopBar(
                title = if (entry != null) templateLabel(entry.template) else stringResource(R.string.hist_detail_title),
                onBack = onBack,
            )
        },
        snackbarHost = { SnackbarHost(hostState = snackbar) },
    ) { padding ->
        when {
            !state.loaded -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            entry == null -> EmptyState(
                icon = Icons.Rounded.BrokenImage,
                title = stringResource(R.string.hist_not_found_title),
                message = stringResource(R.string.hist_not_found_message),
                modifier = Modifier.fillMaxSize().padding(padding),
                actionText = stringResource(R.string.hist_back),
                onAction = onBack,
            )

            else -> DetailContent(
                entry = entry,
                state = state,
                onReprint = vm::reprint,
                onShare = vm::share,
                onSave = requestSave,
                onDelete = { confirmDelete = true },
                modifier = Modifier.fillMaxSize().padding(padding),
            )
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            icon = { Icon(imageVector = Icons.Rounded.DeleteOutline, contentDescription = null) },
            title = { Text(text = stringResource(R.string.hist_delete_title)) },
            text = { Text(text = stringResource(R.string.hist_delete_message)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDelete = false
                        vm.delete()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = FfColors.Coral),
                ) {
                    Text(text = stringResource(R.string.hist_delete_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) {
                    Text(text = stringResource(R.string.hist_cancel))
                }
            },
        )
    }
}

@Composable
private fun DetailContent(
    entry: HistoryEntry,
    state: HistoryDetailUiState,
    onReprint: () -> Unit,
    onShare: () -> Unit,
    onSave: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val formatter = remember {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())
    }
    val printing = DetailAction.PRINT in state.busy
    val deleting = DetailAction.DELETE in state.busy

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        PaperSheet(modifier = Modifier.widthIn(max = 380.dp).fillMaxWidth()) {
            when (val preview = state.preview) {
                PreviewState.Loading -> Box(
                    modifier = Modifier.fillMaxWidth().aspectRatio(0.8f),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = FfColors.Graphite)
                }

                is PreviewState.Ready -> ThermalImage(
                    bitmap = preview.bitmap,
                    contentDescription = stringResource(R.string.hist_preview_cd),
                    modifier = Modifier.fillMaxWidth(),
                )

                PreviewState.Failed -> Column(
                    modifier = Modifier.fillMaxWidth().aspectRatio(0.8f).background(FfColors.Fog),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.BrokenImage,
                        contentDescription = null,
                        tint = FfColors.Graphite,
                        modifier = Modifier.size(40.dp),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.hist_msg_load_failed),
                        color = FfColors.Graphite,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Dati della stampa in stile scontrino: etichetta a sinistra, valore a destra, righe tratteggiate.
        Column(modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth()) {
            InfoRow(
                label = stringResource(R.string.hist_label_date),
                value = formatter.format(Instant.ofEpochMilli(entry.createdAt)),
            )
            DashedDivider()
            InfoRow(label = stringResource(R.string.hist_label_template), value = templateLabel(entry.template))
            if (entry.caption.isNotBlank()) {
                DashedDivider()
                InfoRow(label = stringResource(R.string.hist_label_caption), value = entry.caption)
            }
            entry.printNumber?.let { number ->
                DashedDivider()
                InfoRow(
                    label = stringResource(R.string.hist_label_number),
                    value = stringResource(R.string.hist_print_number, number),
                )
            }
            DashedDivider()
            InfoRow(
                label = stringResource(R.string.hist_label_status),
                value = stringResource(if (entry.printed) R.string.hist_status_printed else R.string.hist_status_saved),
                // Il tema fornisce un rosso leggibile sia su Paper sia su Night (il Coral puro no).
                valueColor = if (entry.printed) Color.Unspecified else MaterialTheme.colorScheme.error,
            )
        }

        Spacer(modifier = Modifier.height(28.dp))

        Column(modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth()) {
            if (printing) {
                val progress = state.printProgress
                if (progress != null) {
                    LinearProgressIndicator(
                        progress = { progress.coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(50)),
                        color = FfColors.Flash,
                    )
                    Text(
                        text = stringResource(R.string.hist_printing, (progress.coerceIn(0f, 1f) * 100f).roundToInt()),
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 12.dp),
                        style = MaterialTheme.typography.labelMedium,
                        fontFamily = FfFonts.Mono,
                        textAlign = TextAlign.Center,
                    )
                } else {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(50)),
                        color = FfColors.Flash,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                }
            }

            FlashButton(
                text = stringResource(R.string.hist_action_reprint),
                onClick = onReprint,
                modifier = Modifier.fillMaxWidth(),
                icon = Icons.Rounded.Print,
                enabled = !deleting,
                busy = printing,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                GhostButton(
                    text = stringResource(R.string.hist_action_share),
                    onClick = onShare,
                    modifier = Modifier.weight(1f),
                    icon = Icons.Rounded.Share,
                    enabled = !deleting && DetailAction.SHARE !in state.busy,
                )
                GhostButton(
                    text = stringResource(R.string.hist_action_save),
                    onClick = onSave,
                    modifier = Modifier.weight(1f),
                    icon = Icons.Rounded.SaveAlt,
                    enabled = !deleting && DetailAction.SAVE !in state.busy,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            TextButton(
                onClick = onDelete,
                enabled = !deleting && !printing,
                modifier = Modifier.align(Alignment.CenterHorizontally),
                colors = ButtonDefaults.textButtonColors(contentColor = FfColors.Coral),
            ) {
                Icon(
                    imageVector = Icons.Rounded.DeleteOutline,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.size(6.dp))
                Text(text = stringResource(R.string.hist_action_delete))
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String, valueColor: Color = Color.Unspecified) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = label.uppercase(),
            modifier = Modifier.padding(end = 16.dp, top = 2.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontFamily = FfFonts.Mono,
            fontSize = 12.sp,
            letterSpacing = 1.sp,
        )
        Text(
            text = value,
            modifier = Modifier.weight(1f),
            color = if (valueColor == Color.Unspecified) MaterialTheme.colorScheme.onSurface else valueColor,
            fontFamily = FfFonts.Mono,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
            textAlign = TextAlign.End,
        )
    }
}

/** Riga tratteggiata come sugli scontrini. */
@Composable
private fun DashedDivider() {
    val color = MaterialTheme.colorScheme.outline
    Canvas(modifier = Modifier.fillMaxWidth().height(1.dp)) {
        drawLine(
            color = color,
            start = Offset(0f, size.height / 2f),
            end = Offset(size.width, size.height / 2f),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()), 0f),
        )
    }
}

@StringRes
private fun fixLabel(fix: ReprintFix): Int = when (fix) {
    ReprintFix.RETRY -> R.string.hist_fix_retry
    ReprintFix.BLUETOOTH -> R.string.hist_fix_bluetooth
    ReprintFix.PERMISSION -> R.string.hist_fix_allow
    ReprintFix.PRINTER -> R.string.hist_fix_printer
}

// android.provider.Settings resta qualificato, come nel resto dell'app.
private fun openBluetoothSettings(context: Context) {
    try {
        context.startActivity(Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS))
    } catch (e: ActivityNotFoundException) {
        // Alcune ROM non espongono la pagina Bluetooth: ripieghiamo sulle impostazioni generali.
        try {
            context.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
        } catch (ignored: ActivityNotFoundException) {
            // Nessuna app impostazioni: resta il testo della snackbar.
        }
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

@Composable
internal fun templateLabel(kind: TemplateKind): String = stringResource(
    when (kind) {
        TemplateKind.POLAROID -> R.string.hist_template_polaroid
        TemplateKind.FULL -> R.string.hist_template_full
        TemplateKind.STRIP -> R.string.hist_template_strip
        TemplateKind.RECEIPT -> R.string.hist_template_receipt
    },
)
