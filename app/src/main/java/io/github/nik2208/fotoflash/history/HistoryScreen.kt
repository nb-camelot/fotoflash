package io.github.nik2208.fotoflash.history

import android.Manifest
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.HistoryEntry
import io.github.nik2208.fotoflash.ui.components.EmptyState
import io.github.nik2208.fotoflash.ui.components.FfTopBar
import io.github.nik2208.fotoflash.ui.components.PaperSheet
import io.github.nik2208.fotoflash.ui.components.ThermalImage
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.launch

/** Finestra delle miniature (larghezza/altezza): le strisce lunghe si vedono solo in cima. */
private const val THUMB_RATIO = 3f / 4f

@Composable
fun HistoryScreen(onBack: () -> Unit, onOpenEntry: (String) -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val vm = viewModel { HistoryViewModel(graph) }
    val entries by vm.entries.collectAsStateWithLifecycle()
    val loaded by vm.loaded.collectAsStateWithLifecycle()
    val photoCount by vm.photoCount.collectAsStateWithLifecycle()
    val exportState by vm.exportState.collectAsStateWithLifecycle()
    val formatter = remember {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())
    }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var confirmExport by rememberSaveable { mutableStateOf(false) }
    val permissionMessage = stringResource(R.string.hist_msg_storage_permission)
    val settingsAction = stringResource(R.string.hist_fix_settings)

    // Android 8-9: senza permesso di archiviazione ogni copia fallirebbe, quindi si chiede prima di partire.
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            vm.startExport()
        } else {
            scope.launch {
                snackbar.currentSnackbarData?.dismiss()
                val result = snackbar.showSnackbar(
                    message = permissionMessage,
                    actionLabel = settingsAction,
                    duration = SnackbarDuration.Long,
                )
                if (result == SnackbarResult.ActionPerformed) openAppSettings(context)
            }
        }
    }
    val exporting = exportState is PhotoExportState.Running

    Scaffold(
        topBar = {
            FfTopBar(
                title = stringResource(R.string.hist_title),
                onBack = onBack,
                actions = {
                    if (loaded && photoCount > 0) {
                        IconButton(onClick = { confirmExport = true }, enabled = !exporting) {
                            Icon(
                                imageVector = Icons.Rounded.PhotoLibrary,
                                contentDescription = stringResource(R.string.hist_export_all),
                            )
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(hostState = snackbar) },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            ExportBanner(
                state = exportState,
                onCancel = vm::cancelExport,
                onDismiss = vm::dismissExportResult,
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, end = 16.dp),
            )
            Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
                when {
                    !loaded -> Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }

                    entries.isEmpty() -> EmptyState(
                        icon = Icons.Rounded.PhotoLibrary,
                        title = stringResource(R.string.hist_empty_title),
                        message = stringResource(R.string.hist_empty_message),
                        modifier = Modifier.fillMaxSize(),
                        actionText = stringResource(R.string.hist_empty_action),
                        onAction = onBack,
                    )

                    else -> LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 150.dp),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 24.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) {
                        items(entries, key = { it.id }) { entry ->
                            HistoryThumbnail(
                                entry = entry,
                                dateText = formatter.format(Instant.ofEpochMilli(entry.createdAt)),
                                loadPreview = vm::loadPreview,
                                onClick = { onOpenEntry(entry.id) },
                            )
                        }
                    }
                }
            }
        }
    }

    if (confirmExport) {
        ExportConfirmDialog(
            photoCount = photoCount,
            onConfirm = {
                confirmExport = false
                if (vm.needsStoragePermission()) {
                    storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                } else {
                    vm.startExport()
                }
            },
            onDismiss = { confirmExport = false },
        )
    }
}

// --- Esportazione di tutte le foto ------------------------------------------------------------

@Composable
private fun ExportConfirmDialog(photoCount: Int, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val resources = LocalContext.current.resources
    if (photoCount <= 0) {
        // Le voci sono state eliminate mentre il dialogo era aperto: niente da esportare.
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(text = stringResource(R.string.hist_export_title)) },
            text = { Text(text = stringResource(R.string.hist_export_none)) },
            confirmButton = {
                TextButton(onClick = onDismiss) { Text(text = stringResource(R.string.hist_ok)) }
            },
        )
    } else {
        AlertDialog(
            onDismissRequest = onDismiss,
            icon = { Icon(imageVector = Icons.Rounded.PhotoLibrary, contentDescription = null) },
            title = { Text(text = stringResource(R.string.hist_export_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(text = resources.getQuantityString(R.plurals.hist_export_message, photoCount, photoCount))
                    // Nessun controllo dei doppioni: chi riesporta lo deve sapere prima.
                    Text(
                        text = stringResource(R.string.hist_export_duplicates),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = onConfirm) { Text(text = stringResource(R.string.hist_export_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = onDismiss) { Text(text = stringResource(R.string.hist_cancel)) }
            },
        )
    }
}

/** Riquadro in cima alla griglia: avanzamento con "Annulla", poi il risultato finche non lo si chiude. */
@Composable
private fun ExportBanner(
    state: PhotoExportState,
    onCancel: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (state) {
        PhotoExportState.Idle -> Unit
        is PhotoExportState.Running -> BannerSurface(modifier) { ExportRunning(state, onCancel) }
        is PhotoExportState.Finished -> BannerSurface(modifier) { ExportFinished(state, onDismiss) }
    }
}

@Composable
private fun BannerSurface(modifier: Modifier, content: @Composable ColumnScope.() -> Unit) {
    // Stessa tinta neutra delle schede delle impostazioni: leggibile su Paper e su Night.
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.05f),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 12.dp, end = 8.dp, bottom = 12.dp),
            content = content,
        )
    }
}

@Composable
private fun ExportRunning(state: PhotoExportState.Running, onCancel: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = Icons.Rounded.PhotoLibrary,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(22.dp),
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = stringResource(R.string.hist_export_running), style = MaterialTheme.typography.titleSmall)
            Text(
                text = if (state.total > 0) {
                    stringResource(R.string.hist_export_progress, state.done, state.total)
                } else {
                    stringResource(R.string.hist_export_preparing)
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontFamily = FfFonts.Mono,
                fontSize = 12.sp,
            )
        }
        TextButton(onClick = onCancel) { Text(text = stringResource(R.string.hist_cancel)) }
    }
    Spacer(modifier = Modifier.height(8.dp))
    val barModifier = Modifier.fillMaxWidth().padding(end = 8.dp).clip(RoundedCornerShape(50))
    if (state.total > 0) {
        val fraction = (state.done.toFloat() / state.total.toFloat()).coerceIn(0f, 1f)
        LinearProgressIndicator(progress = { fraction }, modifier = barModifier, color = FfColors.Flash)
    } else {
        LinearProgressIndicator(modifier = barModifier, color = FfColors.Flash)
    }
}

@Composable
private fun ExportFinished(state: PhotoExportState.Finished, onDismiss: () -> Unit) {
    val resources = LocalContext.current.resources
    val clean = state.end == ExportEnd.COMPLETED && state.failed == 0
    Row(verticalAlignment = Alignment.Top) {
        Icon(
            imageVector = if (clean) Icons.Rounded.CheckCircle else Icons.Rounded.ErrorOutline,
            contentDescription = null,
            tint = if (clean) FfColors.Mint else MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(top = 2.dp).size(22.dp),
        )
        Spacer(modifier = Modifier.width(12.dp))
        // Regione "live": chi usa TalkBack sente il risultato anche se e altrove nella schermata.
        Column(modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }) {
            Text(
                text = stringResource(
                    when (state.end) {
                        ExportEnd.COMPLETED -> R.string.hist_export_done_title
                        ExportEnd.CANCELLED -> R.string.hist_export_cancelled_title
                        ExportEnd.ABORTED -> R.string.hist_export_aborted_title
                    },
                ),
                style = MaterialTheme.typography.titleSmall,
            )
            Text(
                text = if (state.saved > 0) {
                    resources.getQuantityString(R.plurals.hist_msg_photos_saved, state.saved, state.saved)
                } else {
                    stringResource(R.string.hist_export_saved_none)
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            if (state.failed > 0) {
                Text(
                    text = resources.getQuantityString(R.plurals.hist_export_failed, state.failed, state.failed),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (state.end == ExportEnd.ABORTED) {
                Text(
                    text = stringResource(R.string.hist_export_aborted_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        IconButton(onClick = onDismiss) {
            Icon(imageVector = Icons.Rounded.Close, contentDescription = stringResource(R.string.hist_export_dismiss))
        }
    }
}

// --- Griglia --------------------------------------------------------------------------------

@Composable
private fun HistoryThumbnail(
    entry: HistoryEntry,
    dateText: String,
    loadPreview: suspend (HistoryEntry) -> Bitmap?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Caricamento asincrono: la griglia scorre subito, le miniature arrivano appena decodificate.
    val preview by produceState<Bitmap?>(null, entry.id) {
        value = loadPreview(entry)
    }
    val description = stringResource(R.string.hist_thumb_cd, dateText)

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(2.dp),
    ) {
        PaperSheet(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(THUMB_RATIO)
                    .clipToBounds(),
                contentAlignment = Alignment.TopCenter,
            ) {
                val bitmap = preview
                if (bitmap != null) {
                    ThermalImage(
                        bitmap = bitmap,
                        contentDescription = description,
                        // Altezza libera: l'immagine resta a tutta larghezza e la finestra la ritaglia.
                        modifier = Modifier
                            .fillMaxWidth()
                            .wrapContentHeight(align = Alignment.Top, unbounded = true),
                    )
                    if (bitmap.height.toFloat() > bitmap.width.toFloat() / THUMB_RATIO + 1f) {
                        // Sfumatura in fondo: la stampa continua oltre la miniatura.
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth()
                                .height(36.dp)
                                .background(
                                    Brush.verticalGradient(listOf(FfColors.Paper.copy(alpha = 0f), FfColors.Paper)),
                                ),
                        )
                    }
                } else {
                    ThumbnailPlaceholder()
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = dateText,
                    modifier = Modifier.weight(1f),
                    color = FfColors.Graphite,
                    fontFamily = FfFonts.Mono,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                entry.printNumber?.let { number ->
                    Text(
                        text = stringResource(R.string.hist_print_number, number),
                        color = FfColors.Ink,
                        fontFamily = FfFonts.Mono,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        maxLines = 1,
                    )
                }
            }
        }
        if (!entry.printed) {
            NotPrintedBadge(modifier = Modifier.align(Alignment.TopEnd).padding(top = 6.dp, end = 6.dp))
        }
    }
}

@Composable
private fun ThumbnailPlaceholder() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(FfColors.Fog),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = Icons.Rounded.Image,
            contentDescription = null,
            tint = FfColors.Graphite.copy(alpha = 0.35f),
            modifier = Modifier.size(32.dp),
        )
    }
}

/** Etichetta per le stampe solo salvate: si capisce a colpo d'occhio cosa manca da stampare. */
@Composable
private fun NotPrintedBadge(modifier: Modifier = Modifier) {
    Text(
        text = stringResource(R.string.hist_not_printed),
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(FfColors.Coral)
            .padding(horizontal = 8.dp, vertical = 3.dp),
        // Ink su Coral: il bianco su corallo non arriva al contrasto minimo a 10 sp.
        color = FfColors.Ink,
        fontFamily = FfFonts.Mono,
        fontWeight = FontWeight.Bold,
        fontSize = 10.sp,
        maxLines = 1,
    )
}
