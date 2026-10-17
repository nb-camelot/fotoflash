package io.github.nik2208.fotoflash.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.ui.theme.CameraTheme
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfPillShape
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import kotlin.math.roundToInt

/** Come disegnare uno stato: colore del pallino, testo visibile, descrizione per TalkBack. */
private class ChipLook(
    val dot: Color,
    val label: String,
    val spoken: String,
    val pulsing: Boolean,
    val configured: Boolean,
)

/**
 * Stato della stampante in una pillola: pallino colorato + testo breve. Toccandola si apre la
 * schermata stampante. Lo sfondo e la superficie del tema resa traslucida: nel mirino
 * (CameraTheme) diventa un vetro scuro leggibile sopra la foto, altrove un vetro chiaro.
 *
 * Il testo e il nome della stampante quando c'e e funziona (e la cosa che l'utente riconosce),
 * altrimenti dice cosa sta succedendo o cosa non va.
 */
@Composable
fun PrinterStatusChip(state: PrinterState, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val look = chipLook(state)
    val onSurface = MaterialTheme.colorScheme.onSurface
    val container = MaterialTheme.colorScheme.surface.copy(alpha = 0.78f)
    val openLabel = stringResource(R.string.common_printer_open)

    val outline = if (look.configured) {
        Modifier.border(width = 1.dp, color = onSurface.copy(alpha = 0.14f), shape = FfPillShape)
    } else {
        // Contorno tratteggiato: "qui manca qualcosa", senza l'allarme del rosso.
        Modifier.drawBehind {
            val stroke = 1.5.dp.toPx()
            drawRoundRect(
                color = onSurface.copy(alpha = 0.55f),
                topLeft = Offset(stroke / 2f, stroke / 2f),
                size = Size(size.width - stroke, size.height - stroke),
                cornerRadius = CornerRadius(size.height / 2f, size.height / 2f),
                style = Stroke(
                    width = stroke,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()), 0f),
                ),
            )
        }
    }

    Row(
        modifier = modifier
            .heightIn(min = 36.dp)
            .widthIn(max = 220.dp)
            .clip(FfPillShape)
            .background(container)
            .then(outline)
            .clickable(onClickLabel = openLabel, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = look.spoken }
            .padding(start = 10.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(color = look.dot, pulsing = look.pulsing, hollow = !look.configured)
        Spacer(Modifier.width(8.dp))
        Text(
            text = look.label,
            style = MaterialTheme.typography.labelMedium,
            color = onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun chipLook(state: PrinterState): ChipLook {
    val notConfigured = stringResource(R.string.common_printer_not_configured)
    return when (state) {
        PrinterState.NotConfigured -> ChipLook(
            dot = FfColors.Graphite,
            label = notConfigured,
            spoken = stringResource(R.string.common_printer_cd, notConfigured),
            pulsing = false,
            configured = false,
        )
        is PrinterState.Disconnected -> ChipLook(
            dot = FfColors.Graphite,
            label = state.device.label(),
            spoken = stringResource(
                R.string.common_printer_cd_device,
                state.device.label(),
                stringResource(R.string.common_printer_state_idle),
            ),
            pulsing = false,
            configured = true,
        )
        is PrinterState.Connecting -> {
            val text = stringResource(R.string.common_printer_connecting)
            ChipLook(
                dot = FfColors.Flash,
                label = text,
                spoken = stringResource(R.string.common_printer_cd_device, state.device.label(), text),
                pulsing = true,
                configured = true,
            )
        }
        is PrinterState.Connected -> ChipLook(
            dot = FfColors.Mint,
            label = state.device.label(),
            spoken = stringResource(
                R.string.common_printer_cd_device,
                state.device.label(),
                stringResource(R.string.common_printer_state_ready),
            ),
            pulsing = false,
            configured = true,
        )
        is PrinterState.Printing -> {
            val percent = (state.progress.coerceIn(0f, 1f) * 100f).roundToInt()
            val text = stringResource(R.string.common_printer_printing, percent)
            ChipLook(
                dot = FfColors.Flash,
                label = text,
                spoken = stringResource(R.string.common_printer_cd_device, state.device.label(), text),
                pulsing = true,
                configured = true,
            )
        }
        is PrinterState.Error -> {
            val text = stringResource(failureLabel(state.failure))
            val device = state.device
            val detail = if (state.message.isNotBlank()) {
                stringResource(R.string.common_printer_failure_detail, text, state.message)
            } else {
                text
            }
            ChipLook(
                dot = FfColors.Coral,
                label = text,
                spoken = if (device != null) {
                    stringResource(R.string.common_printer_cd_device, device.label(), detail)
                } else {
                    stringResource(R.string.common_printer_cd, detail)
                },
                pulsing = false,
                configured = state.failure != PrintFailure.NO_PRINTER,
            )
        }
    }
}

/** Lo stack Bluetooth a volte non ha ancora il nome in cache: meglio l'indirizzo che una pillola vuota. */
private fun PrinterDevice.label(): String = name.ifBlank { address }

/** Etichette brevi per la pillola: il messaggio lungo resta alla schermata stampante. */
private fun failureLabel(failure: PrintFailure): Int = when (failure) {
    PrintFailure.NO_PRINTER -> R.string.common_printer_err_no_printer
    PrintFailure.NO_PERMISSION -> R.string.common_printer_err_no_permission
    PrintFailure.BLUETOOTH_OFF -> R.string.common_printer_err_bluetooth_off
    PrintFailure.NOT_BONDED -> R.string.common_printer_err_not_bonded
    PrintFailure.CONNECT_FAILED -> R.string.common_printer_err_connect
    PrintFailure.WRITE_FAILED -> R.string.common_printer_err_write
    PrintFailure.BUSY -> R.string.common_printer_err_busy
}

@Composable
private fun StatusDot(color: Color, pulsing: Boolean, hollow: Boolean) {
    // Alone che si allarga e svanisce: "sta lavorando", visibile anche con la coda dell'occhio.
    val halo = if (pulsing) {
        val transition = rememberInfiniteTransition(label = "printerPulse")
        val value by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 1100, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Restart,
            ),
            label = "printerPulseHalo",
        )
        value
    } else {
        0f
    }
    Canvas(modifier = Modifier.size(16.dp)) {
        val r = 4.5.dp.toPx()
        if (pulsing) {
            drawCircle(
                color = color,
                radius = r + (size.minDimension / 2f - r) * halo,
                alpha = 0.55f * (1f - halo),
            )
        }
        if (hollow) {
            drawCircle(color = color, radius = r - 0.75.dp.toPx(), style = Stroke(width = 1.5.dp.toPx()))
        } else {
            drawCircle(color = color, radius = r)
        }
    }
}

private val PreviewDevice = PrinterDevice(name = "PT-210", address = "00:11:22:33:44:55")

@Composable
private fun PrinterChipsPreviewContent() {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        PrinterStatusChip(state = PrinterState.NotConfigured, onClick = {})
        PrinterStatusChip(state = PrinterState.Disconnected(PreviewDevice), onClick = {})
        PrinterStatusChip(state = PrinterState.Connecting(PreviewDevice), onClick = {})
        PrinterStatusChip(state = PrinterState.Connected(PreviewDevice), onClick = {})
        PrinterStatusChip(state = PrinterState.Printing(PreviewDevice, 0.42f), onClick = {})
        PrinterStatusChip(
            state = PrinterState.Error(PreviewDevice, PrintFailure.BLUETOOTH_OFF, "Bluetooth is off"),
            onClick = {},
        )
    }
}

@Preview(name = "Chip stampante - mirino", showBackground = true, backgroundColor = 0xFF3A4A5A)
@Composable
private fun PrinterStatusChipCameraPreview() {
    CameraTheme { PrinterChipsPreviewContent() }
}

@Preview(name = "Chip stampante - chiaro", showBackground = true, backgroundColor = 0xFFFBF8F1)
@Composable
private fun PrinterStatusChipLightPreview() {
    FotoFlashTheme(darkTheme = false) { PrinterChipsPreviewContent() }
}
