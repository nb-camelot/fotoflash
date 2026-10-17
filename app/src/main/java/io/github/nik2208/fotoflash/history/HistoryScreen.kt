package io.github.nik2208.fotoflash.history

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
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

/** Finestra delle miniature (larghezza/altezza): le strisce lunghe si vedono solo in cima. */
private const val THUMB_RATIO = 3f / 4f

@Composable
fun HistoryScreen(onBack: () -> Unit, onOpenEntry: (String) -> Unit) {
    val graph = LocalContext.current.appGraph
    val vm = viewModel { HistoryViewModel(graph) }
    val entries by vm.entries.collectAsStateWithLifecycle()
    val loaded by vm.loaded.collectAsStateWithLifecycle()
    val formatter = remember {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())
    }

    Scaffold(
        topBar = { FfTopBar(title = stringResource(R.string.hist_title), onBack = onBack) },
    ) { padding ->
        when {
            !loaded -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            entries.isEmpty() -> EmptyState(
                icon = Icons.Rounded.PhotoLibrary,
                title = stringResource(R.string.hist_empty_title),
                message = stringResource(R.string.hist_empty_message),
                modifier = Modifier.fillMaxSize().padding(padding),
                actionText = stringResource(R.string.hist_empty_action),
                onAction = onBack,
            )

            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 150.dp),
                modifier = Modifier.fillMaxSize().padding(padding),
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
