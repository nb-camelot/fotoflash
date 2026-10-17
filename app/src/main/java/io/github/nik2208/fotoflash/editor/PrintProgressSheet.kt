package io.github.nik2208.fotoflash.editor

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.annotation.StringRes
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bluetooth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.PriorityHigh
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrintOutcome
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.ui.components.FlashButton
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.HalftoneBurst
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import kotlinx.coroutines.launch

/**
 * Foglio di avanzamento della stampa. Mentre l'invio e in corso racconta lo stato reale della
 * stampante (connessione, percentuale) e non si lascia chiudere; a stampa finita mostra l'esito
 * con le azioni utili. L'esito viene dal PrintOutcome, non da PrinterState: dopo una stampa
 * riuscita la stampante torna "connessa" e non saprebbe dire com'e andata.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrintProgressSheet(
    phase: PrintPhase,
    onDismiss: () -> Unit,
    onRetry: () -> Unit,
    onReprint: () -> Unit,
    onNewPhoto: () -> Unit,
    onOpenPrinter: () -> Unit,
) {
    if (phase is PrintPhase.Idle) return

    val context = LocalContext.current
    val printerState by context.appGraph.printer.state.collectAsStateWithLifecycle()
    val running by rememberUpdatedState(phase is PrintPhase.Running)
    // Durante l'invio niente swipe, tocco sullo sfondo o indietro: il foglio resta finche c'e un esito.
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { value -> value != SheetValue.Hidden || !running },
    )

    val scope = rememberCoroutineScope()

    ModalBottomSheet(
        onDismissRequest = {
            // Il tasto indietro nasconde il foglio senza passare da confirmValueChange (che vale solo
            // per swipe e sfondo): durante l'invio lo si riapre, altrimenti l'esito non si vedrebbe piu.
            if (running) {
                scope.launch { sheetState.show() }
            } else {
                onDismiss()
            }
        },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .animateContentSize()
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (phase) {
                is PrintPhase.Running -> RunningContent(printerState)
                is PrintPhase.Done -> when (val outcome = phase.outcome) {
                    is PrintOutcome.Success -> SuccessContent(
                        copies = phase.copies,
                        onNewPhoto = onNewPhoto,
                        onReprint = onReprint,
                    )
                    is PrintOutcome.Failure -> FailureContent(
                        outcome = outcome,
                        onRetry = onRetry,
                        onOpenPrinter = onOpenPrinter,
                        onOpenBluetooth = { openBluetoothSettings(context) },
                    )
                }
                is PrintPhase.Idle -> Unit
            }
        }
    }
}

// ---------------------------------------------------------------- in corso

/**
 * Memoria dell'invio, volutamente non osservabile (cambia solo insieme a printerState, che
 * ricompone gia). Dopo l'ultimo pacchetto la stampante torna "connessa" mentre si aggiornano
 * contatore e storico: senza memoria il foglio tornerebbe a "Preparo la stampa" come se ripartisse.
 */
private class PrintMemo {
    var printing = false
    var last = 0f
}

@Composable
private fun RunningContent(printerState: PrinterState) {
    val printing = printerState as? PrinterState.Printing
    val memo = remember { PrintMemo() }
    if (printing != null) {
        memo.printing = true
        memo.last = printing.progress.coerceIn(0f, 1f)
    }
    // Byte tutti inviati, la carta e fuori: restano solo contatore e storico.
    val finishing = memo.printing && printerState is PrinterState.Connected
    // Dalla prima percentuale in poi la barra resta determinata (anche se l'invio si interrompe).
    val sending = printing != null || memo.printing
    val progress by animateFloatAsState(
        targetValue = printing?.progress?.coerceIn(0f, 1f)
            ?: (if (finishing) 1f else if (memo.printing) memo.last else 0f),
        animationSpec = tween(durationMillis = 250),
        label = "printProgress",
    )
    // Prima dei byte la carta "si scalda": un piccolo avanti e indietro, per dire che si lavora.
    val warmup = rememberInfiniteTransition(label = "warmup")
    val idlePaper by warmup.animateFloat(
        initialValue = 0.04f,
        targetValue = 0.14f,
        animationSpec = infiniteRepeatable(animation = tween(durationMillis = 900), repeatMode = RepeatMode.Reverse),
        label = "warmupPaper",
    )

    PrinterIllustration(
        paper = if (sending) 0.12f + 0.88f * progress else idlePaper,
        led = FfColors.Flash,
        badge = null,
    )
    Spacer(Modifier.height(16.dp))

    val title = when {
        printerState is PrinterState.Connecting -> stringResource(R.string.ed_sheet_connecting, printerState.device.name)
        printing != null -> stringResource(R.string.ed_sheet_printing)
        finishing -> stringResource(R.string.ed_sheet_finishing)
        // Invio interrotto, l'esito sta per arrivare: la percentuale resta dove si e fermata.
        memo.printing -> stringResource(R.string.ed_sheet_printing)
        else -> stringResource(R.string.ed_sheet_preparing)
    }
    Text(
        text = title,
        style = MaterialTheme.typography.headlineSmall,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
    Spacer(Modifier.height(16.dp))

    val barColor = MaterialTheme.colorScheme.onSurface
    val trackColor = MaterialTheme.colorScheme.surfaceVariant
    if (sending) {
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp),
            color = barColor,
            trackColor = trackColor,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.ed_sheet_percent, (progress * 100f).toInt()),
            style = MaterialTheme.typography.titleMedium.copy(fontFamily = FfFonts.Mono),
            color = MaterialTheme.colorScheme.onSurface,
        )
    } else {
        LinearProgressIndicator(
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp),
            color = barColor,
            trackColor = trackColor,
        )
    }
    Spacer(Modifier.height(12.dp))
    Text(
        text = stringResource(R.string.ed_sheet_keep_close),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(8.dp))
}

// ---------------------------------------------------------------- stampato

@Composable
private fun SuccessContent(copies: Int, onNewPhoto: () -> Unit, onReprint: () -> Unit) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(Unit) { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    // Il foglio finisce di uscire anche se l'ultima percentuale vista era sotto il 100%.
    val paper = remember { Animatable(0.7f) }
    LaunchedEffect(Unit) { paper.animateTo(1f, animationSpec = tween(durationMillis = 450)) }

    PrinterIllustration(paper = paper.value, led = FfColors.Mint, badge = SheetBadge.SUCCESS)
    Spacer(Modifier.height(16.dp))
    Text(
        text = stringResource(R.string.ed_sheet_done),
        style = MaterialTheme.typography.headlineMedium,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
    Spacer(Modifier.height(6.dp))
    Text(
        text = stringResource(R.string.ed_sheet_done_hint),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
    if (copies > 1) {
        Spacer(Modifier.height(4.dp))
        Text(
            text = context.resources.getQuantityString(R.plurals.ed_copies, copies, copies),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
    Spacer(Modifier.height(24.dp))
    FlashButton(
        text = stringResource(R.string.ed_sheet_new_photo),
        onClick = onNewPhoto,
        modifier = Modifier.fillMaxWidth(),
        icon = Icons.Rounded.PhotoCamera,
    )
    Spacer(Modifier.height(8.dp))
    GhostButton(
        text = stringResource(R.string.ed_sheet_reprint),
        onClick = onReprint,
        modifier = Modifier.fillMaxWidth(),
        icon = Icons.Rounded.Print,
    )
}

// ---------------------------------------------------------------- errore

private enum class FailureAction { RETRY, PRINTER, CHOOSE_PRINTER, BLUETOOTH }

private class FailureCopy(
    @StringRes val title: Int,
    @StringRes val hint: Int,
    val primary: FailureAction,
    val secondary: FailureAction?,
)

/** Per ogni errore: cosa e successo, cosa fare, e l'azione che lo risolve davvero per prima. */
private fun failureCopy(failure: PrintFailure): FailureCopy = when (failure) {
    PrintFailure.NO_PRINTER -> FailureCopy(
        R.string.ed_fail_no_printer_title, R.string.ed_fail_no_printer_hint,
        FailureAction.CHOOSE_PRINTER, null,
    )
    PrintFailure.NO_PERMISSION -> FailureCopy(
        R.string.ed_fail_no_permission_title, R.string.ed_fail_no_permission_hint,
        FailureAction.PRINTER, FailureAction.RETRY,
    )
    PrintFailure.BLUETOOTH_OFF -> FailureCopy(
        R.string.ed_fail_bluetooth_off_title, R.string.ed_fail_bluetooth_off_hint,
        FailureAction.BLUETOOTH, FailureAction.RETRY,
    )
    PrintFailure.NOT_BONDED -> FailureCopy(
        R.string.ed_fail_not_bonded_title, R.string.ed_fail_not_bonded_hint,
        FailureAction.BLUETOOTH, FailureAction.PRINTER,
    )
    PrintFailure.CONNECT_FAILED -> FailureCopy(
        R.string.ed_fail_connect_title, R.string.ed_fail_connect_hint,
        FailureAction.RETRY, FailureAction.PRINTER,
    )
    PrintFailure.WRITE_FAILED -> FailureCopy(
        R.string.ed_fail_write_title, R.string.ed_fail_write_hint,
        FailureAction.RETRY, FailureAction.PRINTER,
    )
    PrintFailure.BUSY -> FailureCopy(
        R.string.ed_fail_busy_title, R.string.ed_fail_busy_hint,
        FailureAction.RETRY, FailureAction.PRINTER,
    )
    // La stampante non c'entra: nessuna azione verso stampante o Bluetooth, solo riprovare.
    PrintFailure.RENDER_FAILED -> FailureCopy(
        R.string.ed_fail_render_title, R.string.ed_fail_render_hint,
        FailureAction.RETRY, null,
    )
}

@Composable
private fun FailureContent(
    outcome: PrintOutcome.Failure,
    onRetry: () -> Unit,
    onOpenPrinter: () -> Unit,
    onOpenBluetooth: () -> Unit,
) {
    val copy = failureCopy(outcome.failure)
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(outcome) { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }

    // Composizione fallita: la stampantina resta "accesa" e serena, il problema non e suo.
    val led = if (outcome.failure == PrintFailure.RENDER_FAILED) FfColors.Flash else FfColors.Coral
    PrinterIllustration(paper = 0.18f, led = led, badge = SheetBadge.ERROR)
    Spacer(Modifier.height(16.dp))
    Text(
        text = stringResource(copy.title),
        style = MaterialTheme.typography.headlineSmall,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
    Spacer(Modifier.height(6.dp))
    Text(
        text = stringResource(copy.hint),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
    if (outcome.message.isNotBlank()) {
        Spacer(Modifier.height(8.dp))
        // Il dettaglio tecnico resta visibile (piccolo): serve a chi ci aiuta a capire il problema.
        Text(
            text = stringResource(R.string.ed_sheet_detail, outcome.message),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            maxLines = 3,
        )
    }
    Spacer(Modifier.height(24.dp))

    val handlers = mapOf(
        FailureAction.RETRY to onRetry,
        FailureAction.PRINTER to onOpenPrinter,
        FailureAction.CHOOSE_PRINTER to onOpenPrinter,
        FailureAction.BLUETOOTH to onOpenBluetooth,
    )
    FlashButton(
        text = stringResource(actionLabel(copy.primary)),
        onClick = handlers.getValue(copy.primary),
        modifier = Modifier.fillMaxWidth(),
        icon = actionIcon(copy.primary),
    )
    val secondary = copy.secondary
    if (secondary != null) {
        Spacer(Modifier.height(8.dp))
        GhostButton(
            text = stringResource(actionLabel(secondary)),
            onClick = handlers.getValue(secondary),
            modifier = Modifier.fillMaxWidth(),
            icon = actionIcon(secondary),
        )
    }
}

@StringRes
private fun actionLabel(action: FailureAction): Int = when (action) {
    FailureAction.RETRY -> R.string.ed_sheet_retry
    FailureAction.PRINTER -> R.string.ed_sheet_printer
    FailureAction.CHOOSE_PRINTER -> R.string.ed_sheet_choose_printer
    FailureAction.BLUETOOTH -> R.string.ed_sheet_open_bluetooth
}

private fun actionIcon(action: FailureAction): ImageVector = when (action) {
    FailureAction.RETRY -> Icons.Rounded.Refresh
    FailureAction.PRINTER, FailureAction.CHOOSE_PRINTER -> Icons.Rounded.Print
    FailureAction.BLUETOOTH -> Icons.Rounded.Bluetooth
}

/** Impostazioni Bluetooth di sistema; su dispositivi che non le espongono, le impostazioni generali. */
private fun openBluetoothSettings(context: Context) {
    try {
        context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
    } catch (e: ActivityNotFoundException) {
        try {
            context.startActivity(Intent(Settings.ACTION_SETTINGS))
        } catch (ignored: ActivityNotFoundException) {
            // Nessuna schermata di impostazioni raggiungibile: il messaggio a video spiega gia cosa fare.
        }
    }
}

// ---------------------------------------------------------------- illustrazione

private enum class SheetBadge { SUCCESS, ERROR }

/**
 * Una stampantina stilizzata da cui esce il foglio: [paper] e la frazione di foglio uscita (0..1).
 * La carta resta color carta anche nel tema scuro, come in tutta l'app.
 */
@Composable
private fun PrinterIllustration(paper: Float, led: Color, badge: SheetBadge?) {
    val body = MaterialTheme.colorScheme.onSurface
    val slot = MaterialTheme.colorScheme.surface
    val edge = FfColors.Ink.copy(alpha = 0.22f)
    val ink = FfColors.Ink

    val badgeScale = remember(badge) { Animatable(0f) }
    LaunchedEffect(badge) {
        if (badge != null) {
            badgeScale.animateTo(
                targetValue = 1f,
                animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
            )
        }
    }

    Box(modifier = Modifier.size(width = 220.dp, height = 156.dp)) {
        if (badge == SheetBadge.SUCCESS) {
            // Il "lampo" del marchio visto a punti di retino, dietro la stampante.
            HalftoneBurst(color = FfColors.Flash, modifier = Modifier.matchParentSize())
        }
        Canvas(modifier = Modifier.matchParentSize()) {
            val bodyWidth = 150.dp.toPx()
            val bodyHeight = 46.dp.toPx()
            val bodyLeft = (size.width - bodyWidth) / 2f
            val bodyTop = 4.dp.toPx()
            val bodyBottom = bodyTop + bodyHeight

            val paperWidth = 104.dp.toPx()
            val paperLeft = (size.width - paperWidth) / 2f
            val maxLength = size.height - bodyBottom - 4.dp.toPx()
            val length = maxLength * paper.coerceIn(0f, 1f)

            if (length > 1f) {
                val paperTop = bodyBottom - 6.dp.toPx()
                val paperBottom = bodyBottom + length
                val tooth = 8.dp.toPx()
                val depth = 4.dp.toPx()
                val sheet = Path().apply {
                    moveTo(paperLeft, paperTop)
                    lineTo(paperLeft + paperWidth, paperTop)
                    lineTo(paperLeft + paperWidth, paperBottom - depth)
                    // Bordo strappato: denti da destra a sinistra.
                    var x = paperLeft + paperWidth
                    var down = true
                    while (x > paperLeft) {
                        x = (x - tooth / 2f).coerceAtLeast(paperLeft)
                        lineTo(x, if (down) paperBottom else paperBottom - depth)
                        down = !down
                    }
                    close()
                }
                drawPath(path = sheet, color = FfColors.Paper)
                clipPath(sheet) {
                    // La "foto" retinata: puntini su griglia sfalsata, come il retino vero.
                    val photoTop = bodyBottom + 8.dp.toPx()
                    val photoLeft = paperLeft + 12.dp.toPx()
                    val photoWidth = paperWidth - 24.dp.toPx()
                    val photoHeight = 46.dp.toPx()
                    val step = 4.dp.toPx()
                    var row = 0
                    var y = photoTop
                    while (y < photoTop + photoHeight) {
                        var dx = if (row % 2 == 0) 0f else step / 2f
                        while (dx < photoWidth) {
                            val radius = step * (0.18f + 0.22f * ((y - photoTop) / photoHeight))
                            drawCircle(color = ink, radius = radius, center = Offset(photoLeft + dx, y))
                            dx += step
                        }
                        y += step
                        row++
                    }
                    // Righe di testo sotto la foto.
                    val lineHeight = 3.dp.toPx()
                    val firstLine = photoTop + photoHeight + 10.dp.toPx()
                    drawRoundRect(
                        color = ink,
                        topLeft = Offset(paperLeft + paperWidth * 0.2f, firstLine),
                        size = Size(paperWidth * 0.6f, lineHeight),
                        cornerRadius = CornerRadius(lineHeight / 2f, lineHeight / 2f),
                    )
                    drawRoundRect(
                        color = ink,
                        topLeft = Offset(paperLeft + paperWidth * 0.3f, firstLine + 8.dp.toPx()),
                        size = Size(paperWidth * 0.4f, lineHeight),
                        cornerRadius = CornerRadius(lineHeight / 2f, lineHeight / 2f),
                    )
                }
                drawPath(path = sheet, color = edge, style = Stroke(width = 1.dp.toPx()))
            }

            // Corpo della stampante, sopra la carta: il foglio sembra uscire dalla fessura.
            drawRoundRect(
                color = body,
                topLeft = Offset(bodyLeft, bodyTop),
                size = Size(bodyWidth, bodyHeight),
                cornerRadius = CornerRadius(16.dp.toPx(), 16.dp.toPx()),
            )
            val slotWidth = paperWidth + 14.dp.toPx()
            drawRoundRect(
                color = slot,
                topLeft = Offset((size.width - slotWidth) / 2f, bodyBottom - 12.dp.toPx()),
                size = Size(slotWidth, 4.dp.toPx()),
                cornerRadius = CornerRadius(2.dp.toPx(), 2.dp.toPx()),
            )
            drawCircle(
                color = led,
                radius = 4.dp.toPx(),
                center = Offset(bodyLeft + bodyWidth - 18.dp.toPx(), bodyTop + 16.dp.toPx()),
            )
        }

        if (badge != null) {
            val (color, icon) = when (badge) {
                SheetBadge.SUCCESS -> FfColors.Mint to Icons.Rounded.Check
                SheetBadge.ERROR -> FfColors.Coral to Icons.Rounded.PriorityHigh
            }
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 30.dp, bottom = 8.dp)
                    .scale(badgeScale.value)
                    .size(48.dp)
                    .background(color = color, shape = CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = FfColors.Ink,
                    modifier = Modifier.size(28.dp),
                )
            }
        }
    }
}
