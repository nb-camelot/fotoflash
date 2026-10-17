package io.github.nik2208.fotoflash.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.ui.theme.FfButtonTextStyle
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfPillShape
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import kotlin.math.roundToInt

/** Spessore del "gradino" sotto i pulsanti: il tasto sembra fisico e si abbassa quando lo premi. */
private val KeyDepth = 4.dp
private val ButtonHeight = 56.dp
private val ButtonPadding = PaddingValues(horizontal = 28.dp, vertical = 12.dp)
private val ButtonIconSize = 22.dp

/**
 * Pulsante primario giallo, a pillola alta 56 dp. Sotto ha un bordo 3D color FlashDeep
 * (altri 4 dp riservati nel layout) su cui la pillola scende quando viene premuta.
 *
 * Con [busy] resta giallo ma non risponde ai tocchi e mostra uno spinner: e un'attesa, non un divieto.
 */
@Composable
fun FlashButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val active = enabled && !busy
    val showKey = enabled || busy
    val press by animateFloatAsState(
        targetValue = if (pressed && active) 1f else 0f,
        animationSpec = tween(durationMillis = 70),
        label = "flashButtonPress",
    )
    val disabledContainer = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)
    val disabledContent = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
    val busyText = stringResource(R.string.common_loading)

    Button(
        onClick = onClick,
        modifier = modifier
            .padding(bottom = KeyDepth)
            .drawBehind {
                if (showKey) {
                    drawRoundRect(
                        color = FfColors.FlashDeep,
                        topLeft = Offset(0f, KeyDepth.toPx()),
                        size = size,
                        cornerRadius = CornerRadius(size.height / 2f, size.height / 2f),
                    )
                }
            }
            .offset { IntOffset(0, (KeyDepth.toPx() * press).roundToInt()) }
            .heightIn(min = ButtonHeight)
            .semantics { if (busy) stateDescription = busyText },
        enabled = active,
        shape = FfPillShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = FfColors.Flash,
            contentColor = FfColors.Ink,
            disabledContainerColor = if (busy) FfColors.Flash else disabledContainer,
            disabledContentColor = if (busy) FfColors.Ink else disabledContent,
        ),
        elevation = null,
        contentPadding = ButtonPadding,
        interactionSource = interaction,
    ) {
        when {
            busy -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = FfColors.Ink,
                    strokeWidth = 2.5.dp,
                    trackColor = Color.Transparent,
                    strokeCap = StrokeCap.Round,
                )
                Spacer(Modifier.width(12.dp))
            }
            icon != null -> {
                Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(ButtonIconSize))
                Spacer(Modifier.width(10.dp))
            }
        }
        ButtonLabel(text)
    }
}

/**
 * Pulsante secondario a contorno: Ink sul chiaro, Paper sullo scuro (segue onSurface).
 * Riserva gli stessi 4 dp sotto di [FlashButton], cosi affiancati restano allineati.
 */
@Composable
fun GhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val ink = MaterialTheme.colorScheme.onSurface
    val faded = ink.copy(alpha = 0.38f)
    OutlinedButton(
        onClick = onClick,
        modifier = modifier
            .padding(bottom = KeyDepth)
            .heightIn(min = ButtonHeight),
        enabled = enabled,
        shape = FfPillShape,
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Color.Transparent,
            contentColor = ink,
            disabledContainerColor = Color.Transparent,
            disabledContentColor = faded,
        ),
        border = BorderStroke(2.dp, if (enabled) ink else ink.copy(alpha = 0.16f)),
        contentPadding = ButtonPadding,
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(ButtonIconSize))
            Spacer(Modifier.width(10.dp))
        }
        ButtonLabel(text)
    }
}

@Composable
private fun RowScope.ButtonLabel(text: String) {
    Text(
        text = text,
        style = FfButtonTextStyle,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Preview(name = "Pulsanti - chiaro", showBackground = true, backgroundColor = 0xFFFBF8F1)
@Composable
private fun ButtonsPreviewLight() {
    FotoFlashTheme(darkTheme = false) {
        ButtonsPreviewContent()
    }
}

@Preview(name = "Pulsanti - scuro", showBackground = true, backgroundColor = 0xFF0E0C0A)
@Composable
private fun ButtonsPreviewDark() {
    FotoFlashTheme(darkTheme = true) {
        ButtonsPreviewContent()
    }
}

@Composable
private fun ButtonsPreviewContent() {
    Column(
        modifier = Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FlashButton(text = "Print", onClick = {}, icon = Icons.Rounded.Print, modifier = Modifier.fillMaxWidth())
        FlashButton(text = "Printing", onClick = {}, busy = true, modifier = Modifier.fillMaxWidth())
        FlashButton(text = "Print", onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GhostButton(text = "Share", onClick = {}, icon = Icons.Rounded.Share)
            GhostButton(text = "Save", onClick = {}, enabled = false)
        }
    }
}
