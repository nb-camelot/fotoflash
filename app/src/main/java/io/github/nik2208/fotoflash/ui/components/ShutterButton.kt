package io.github.nik2208.fotoflash.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.ui.theme.CameraTheme
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts

private val ShutterSize = 84.dp
private val RingWidth = 4.dp
private val DiscSize = 68.dp

private val CountdownStyle = TextStyle(
    fontFamily = FfFonts.Display,
    fontWeight = FontWeight.Normal,
    fontSize = 34.sp,
    lineHeight = 36.sp,
)

/**
 * Otturatore: anello bianco e disco giallo che si schiaccia sotto il dito.
 *
 * - [busy]: spinner nel disco e tocchi ignorati (evita il doppio scatto mentre si salva).
 * - [countdown]: numero grande nel disco, con un piccolo "pop" a ogni secondo; TalkBack lo legge.
 * - [enabled] = false: attenuato e non cliccabile.
 */
@Composable
fun ShutterButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    countdown: Int? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val clickable = enabled && !busy
    val scale by animateFloatAsState(
        targetValue = if (pressed && clickable) 0.86f else 1f,
        animationSpec = spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMedium),
        label = "shutterPress",
    )

    val label = stringResource(R.string.common_shutter)
    val busyState = stringResource(R.string.common_shutter_busy)
    val countdownState = if (countdown != null) {
        stringResource(R.string.common_shutter_countdown, countdown)
    } else {
        null
    }
    val stateText = when {
        busy -> busyState
        countdownState != null -> countdownState
        else -> null
    }

    Box(
        modifier = modifier
            .size(ShutterSize)
            .alpha(if (enabled) 1f else 0.4f)
            .clickable(
                interactionSource = interaction,
                // Il feedback e la pressione del disco: un ripple rettangolare stonerebbe.
                indication = null,
                enabled = clickable,
                onClickLabel = label,
                role = Role.Button,
                onClick = onClick,
            )
            .semantics {
                contentDescription = label
                if (stateText != null) stateDescription = stateText
                if (countdown != null) liveRegion = LiveRegionMode.Polite
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(ShutterSize)
                .border(width = RingWidth, color = Color.White, shape = CircleShape),
        )
        Box(
            modifier = Modifier
                .size(DiscSize)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                }
                .background(
                    // Leggera bombatura: centro Flash, bordo FlashDeep, come un tasto vero.
                    brush = Brush.radialGradient(
                        colors = listOf(FfColors.Flash, FfColors.Flash, FfColors.FlashDeep),
                    ),
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            when {
                busy -> CircularProgressIndicator(
                    modifier = Modifier.size(34.dp),
                    color = FfColors.Ink,
                    strokeWidth = 3.dp,
                    trackColor = Color.Transparent,
                    strokeCap = StrokeCap.Round,
                )
                countdown != null -> CountdownNumber(countdown)
            }
        }
    }
}

@Composable
private fun CountdownNumber(value: Int) {
    // key: ogni nuovo numero riparte dall'animazione di ingresso.
    key(value) {
        val pop = remember { Animatable(1.5f) }
        LaunchedEffect(Unit) {
            pop.animateTo(
                targetValue = 1f,
                animationSpec = spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow),
            )
        }
        Text(
            text = value.toString(),
            style = CountdownStyle,
            color = FfColors.Ink,
            modifier = Modifier.graphicsLayer {
                scaleX = pop.value
                scaleY = pop.value
                alpha = (2.5f - pop.value * 1.5f).coerceIn(0f, 1f)
            },
        )
    }
}

@Preview(name = "Otturatore", showBackground = true, backgroundColor = 0xFF0E0C0A)
@Composable
private fun ShutterButtonPreview() {
    CameraTheme {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ShutterButton(onClick = {})
            ShutterButton(onClick = {}, busy = true)
            ShutterButton(onClick = {}, countdown = 3)
            ShutterButton(onClick = {}, enabled = false)
        }
    }
}
