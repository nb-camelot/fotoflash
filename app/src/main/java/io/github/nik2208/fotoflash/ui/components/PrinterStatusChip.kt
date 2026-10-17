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
import androidx.compose.runtime.State
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
import androidx.compose.ui.graphics.luminance
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
 *
 * [onClickLabel] e l'azione annunciata da TalkBack: di default "Impostazioni stampante", da
 * cambiare quando il tocco fa altro (nell'onboarding aggiorna lo stato).
 */
@Composable
fun PrinterStatusChip(
    state: PrinterState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onClickLabel: String? = null,
) {
    val look = chipLook(state)
    val onSurface = MaterialTheme.colorScheme.onSurface
    val surface = MaterialTheme.colorScheme.surface
    val container = surface.copy(alpha = 0.78f)
    val openLabel = onClickLabel ?: stringResource(R.string.common_printer_open)
    // Il giallo sulla carta chiara ha contrasto 1,4:1: un anello sottile tiene visibile il pallino.
    val ring = if (look.dot == FfColors.Flash && surface.luminance() > 0.5f) {
        onSurface.copy(alpha = 0.6f)
    } else {
        null
    }

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
        StatusDot(color = look.dot, pulsing = look.pulsing, hollow = !look.configured, ring = ring)
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

/** Nessuna stampante scelta. Pallino neutro del tema: Graphite sul chiaro, grigio chiaro sullo scuro. */
@Composable
private fun notConfiguredLook(): ChipLook {
    val notConfigured = stringResource(R.string.common_printer_not_configured)
    return ChipLook(
        dot = MaterialTheme.colorScheme.onSurfaceVariant,
        label = notConfigured,
        spoken = stringResource(R.string.common_printer_cd, notConfigured),
        pulsing = false,
        configured = false,
    )
}

/** Stampante scelta ma non collegata: si collega da sola quando si stampa. */
@Composable
private fun idleLook(device: PrinterDevice): ChipLook = ChipLook(
    dot = MaterialTheme.colorScheme.onSurfaceVariant,
    label = device.label(),
    spoken = stringResource(
        R.string.common_printer_cd_device,
        device.label(),
        stringResource(R.string.common_printer_state_idle),
    ),
    pulsing = false,
    configured = true,
)

@Composable
private fun chipLook(state: PrinterState): ChipLook {
    return when (state) {
        PrinterState.NotConfigured -> notConfiguredLook()
        is PrinterState.Disconnected -> idleLook(state.device)
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
        is PrinterState.Error -> if (state.failure == PrintFailure.RENDER_FAILED) {
            // Composizione fallita: la stampante non c'entra e la pillola continua a descrivere lei.
            val device = state.device
            if (device != null) idleLook(device) else notConfiguredLook()
        } else {
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
    PrintFailure.RENDER_FAILED -> R.string.common_printer_err_render
}

/** [ring]: contorno sottile attorno al pallino pieno, quando il suo colore non si stacca dallo sfondo. */
@Composable
private fun StatusDot(color: Color, pulsing: Boolean, hollow: Boolean, ring: Color?) {
    // Alone che si allarga e svanisce: "sta lavorando", visibile anche con la coda dell'occhio.
    // Lo State si legge solo nel disegno: a ogni frame si ridisegna il pallino, senza ricomporre.
    val halo: State<Float>? = if (pulsing) {
        rememberInfiniteTransition(label = "printerPulse").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 1100, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Restart,
            ),
            label = "printerPulseHalo",
        )
    } else {
        null
    }
    Canvas(modifier = Modifier.size(16.dp)) {
        val r = 4.5.dp.toPx()
        if (halo != null) {
            val h = halo.value
            drawCircle(
                color = color,
                radius = r + (size.minDimension / 2f - r) * h,
                alpha = 0.55f * (1f - h),
            )
        }
        if (hollow) {
            drawCircle(color = color, radius = r - 0.75.dp.toPx(), style = Stroke(width = 1.5.dp.toPx()))
        } else {
            drawCircle(color = color, radius = r)
            if (ring != null) {
                drawCircle(color = ring, radius = r, style = Stroke(width = 1.dp.toPx()))
            }
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
        PrinterStatusChip(
            state = PrinterState.Error(PreviewDevice, PrintFailure.RENDER_FAILED, "Out of memory"),
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
