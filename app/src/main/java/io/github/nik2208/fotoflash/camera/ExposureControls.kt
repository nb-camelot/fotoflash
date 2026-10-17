package io.github.nik2208.fotoflash.camera

import android.util.Log
import androidx.annotation.MainThread
import androidx.camera.core.CameraControl
import androidx.camera.core.ExposureState
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.MeteringPointFactory
import androidx.camera.view.CameraController
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executor
import kotlin.math.max
import kotlin.math.roundToInt

private const val TAG = "FotoFlashExposure"

/** Lato delle regioni di misura, in frazione del mirino: gli stessi valori del tap-to-focus di CameraX. */
private const val AF_POINT_SIZE = 1f / 6f
private const val AE_POINT_SIZE = 0.25f

/** Raggio dell'anello del tocco a riposo: il pannello dell'esposizione gli si mette accanto. */
internal val FocusRingRadius: Dp = 34.dp

private val PanelWidth = 64.dp
private val TrackHeight = 168.dp
private val ThumbSize = 32.dp
private val PanelShape = RoundedCornerShape(24.dp)

private val PanelLabelStyle = TextStyle(
    fontFamily = FfFonts.Mono,
    fontWeight = FontWeight.Bold,
    fontSize = 11.sp,
    lineHeight = 14.sp,
    letterSpacing = 0.6.sp,
    textAlign = TextAlign.Center,
)

// =========================================================================================
// Compensazione dell'esposizione
// =========================================================================================

/**
 * Compensazione dell'esposizione della fotocamera collegata: indici interi da [minIndex] a
 * [maxIndex], ognuno vale [stepEv] EV (di solito 1/3 o 1/6). Copia semplice dei valori di
 * CameraX, cosi lo stato dell'interfaccia non trattiene oggetti della fotocamera.
 */
data class ExposureRange(val minIndex: Int, val maxIndex: Int, val stepEv: Float) {
    fun clamp(index: Int): Int = index.coerceIn(minIndex, maxIndex)

    fun ev(index: Int): Float = index * stepEv
}

/** null se la fotocamera non permette di compensare l'esposizione (lo slider allora non compare). */
fun ExposureState.toExposureRange(): ExposureRange? {
    if (!isExposureCompensationSupported) return null
    val range = exposureCompensationRange
    val lower: Int = range.lower
    val upper: Int = range.upper
    val stepEv = exposureCompensationStep.toFloat()
    if (lower >= upper || !(stepEv > 0f) || stepEv.isInfinite()) return null
    return ExposureRange(minIndex = lower, maxIndex = upper, stepEv = stepEv)
}

/**
 * Porta la fotocamera collegata all'indice [index]. CameraX lo azzera da sola ogni volta che la
 * fotocamera resta senza casi d'uso (cambio fotocamera, app in background, mirino lasciato):
 * per questo la schermata lo riapplica a ogni apertura. Le richieste superate da una piu nuova
 * falliscono con OperationCanceledException: e normale durante il trascinamento dello slider.
 */
@MainThread
internal fun CameraController.applyExposureIndex(index: Int, callbackExecutor: Executor) {
    val control = cameraControl ?: return
    val future = try {
        control.setExposureCompensationIndex(index)
    } catch (e: RuntimeException) {
        Log.w(TAG, "compensazione $index non applicabile", e)
        return
    }
    future.addListener(
        {
            try {
                future.get()
            } catch (e: ExecutionException) {
                if (e.cause !is CameraControl.OperationCanceledException) {
                    Log.w(TAG, "compensazione $index rifiutata dalla fotocamera", e.cause)
                }
            } catch (e: Exception) {
                Log.w(TAG, "compensazione $index interrotta", e)
            }
        },
        callbackExecutor,
    )
}

// =========================================================================================
// Tocca per esporre
// =========================================================================================

/**
 * Tocca per esporre: messa a fuoco ed esposizione misurate nel punto toccato del mirino.
 *
 * Il tap-to-focus del PreviewView e spento (vedi createCameraController): la sua azione si
 * annulla da sola dopo 5 secondi e in CameraX 1.4 quella durata non si cambia, quindi con il
 * timer da 10 s o durante una striscia il viso in controluce tornerebbe scuro prima dello
 * scatto. Qui l'azione non scade da sola: la rilascia [release], quando lo decide la schermata
 * (tocco nuovo, AUTO, fine della tenuta). Il tocco non deve nemmeno arrivare al PreviewView:
 * il punto si costruisce dal suo MeteringPointFactory, che conosce ritaglio e rotazione.
 */
internal class TapMetering(
    private val controller: CameraController,
    private val callbackExecutor: Executor,
) {
    /** Cambia a ogni tocco o rilascio: l'esito di una misura ormai superata non conta piu. */
    private var generation = 0

    /**
     * Misura in ([x], [y]), coordinate del PreviewView in pixel. [onResult] arriva sul main
     * thread: true se la fotocamera ha accettato il punto, false se non si puo misurare (mirino
     * non ancora pronto, nessuna regione AF/AE supportata, come su molte frontali).
     * Restituisce false se la fotocamera non e collegata.
     */
    @MainThread
    fun start(factory: MeteringPointFactory, x: Float, y: Float, onResult: (measured: Boolean) -> Unit): Boolean {
        val control = controller.cameraControl ?: return false
        val action = FocusMeteringAction.Builder(factory.createPoint(x, y, AF_POINT_SIZE), FocusMeteringAction.FLAG_AF)
            .addPoint(factory.createPoint(x, y, AE_POINT_SIZE), FocusMeteringAction.FLAG_AE)
            .disableAutoCancel()
            .build()
        generation += 1
        val current = generation
        val future = try {
            control.startFocusAndMetering(action)
        } catch (e: RuntimeException) {
            Log.w(TAG, "misura nel punto toccato non avviata", e)
            return false
        }
        future.addListener(
            {
                if (current != generation) return@addListener
                val measured = try {
                    future.get()
                    true
                } catch (e: ExecutionException) {
                    if (e.cause !is CameraControl.OperationCanceledException) {
                        Log.w(TAG, "misura nel punto toccato non riuscita", e.cause)
                    }
                    false
                } catch (e: Exception) {
                    Log.w(TAG, "misura nel punto toccato interrotta", e)
                    false
                }
                onResult(measured)
            },
            callbackExecutor,
        )
        return true
    }

    /** Torna a fuoco continuo ed esposizione automatica su tutta la scena. */
    @MainThread
    fun release() {
        generation += 1
        // L'esito non serve: fallisce solo se la fotocamera si e chiusa, e allora le regioni sono gia sparite.
        controller.cameraControl?.cancelFocusAndMetering()
    }

    /** La fotocamera ha gia dimenticato il punto (chiusa, cambiata): si ignora solo l'esito in arrivo. */
    @MainThread
    fun forget() {
        generation += 1
    }
}

/**
 * Tocchi che finiscono su un controllo disegnato sopra il mirino (pannello dell'esposizione,
 * avvisi): non devono spostare il punto di misura. Il mirino osserva i tocchi nel passaggio
 * Initial senza consumarli e azzera [claimed] all'appoggio; i controlli lo rialzano nel loro
 * passaggio Initial, che per lo stesso evento arriva subito dopo.
 */
internal class TapGuard {
    var claimed: Boolean = false
}

/** Segna come "del controllo" ogni tocco che comincia dentro questo elemento. */
internal fun Modifier.claimTaps(guard: TapGuard): Modifier = pointerInput(guard) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        guard.claimed = true
    }
}

/**
 * Posiziona il pannello dentro il mirino (i vincoli massimi sono le sue misure): accanto
 * all'anello del tocco, a destra se c'e posto altrimenti a sinistra; aperto dalla barra
 * ([anchor] null), sul bordo sinistro, lontano dalla striscia che si riempie a destra.
 */
internal fun Modifier.placeExposurePanel(anchor: Offset?): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
    val containerWidth = if (constraints.hasBoundedWidth) constraints.maxWidth else placeable.width
    val containerHeight = if (constraints.hasBoundedHeight) constraints.maxHeight else placeable.height
    val margin = 10.dp.roundToPx()
    val maxX = max(margin, containerWidth - placeable.width - margin)
    val maxY = max(margin, containerHeight - placeable.height - margin)
    val x: Int
    val y: Int
    if (anchor == null) {
        x = (margin * 3 / 2).coerceAtMost(maxX)
        y = ((containerHeight - placeable.height) / 2).coerceIn(margin, maxY)
    } else {
        val gap = (FocusRingRadius + 12.dp).toPx()
        val right = anchor.x + gap
        val left = anchor.x - gap - placeable.width
        val preferred = if (right + placeable.width + margin <= containerWidth) right else left
        x = preferred.roundToInt().coerceIn(margin, maxX)
        y = (anchor.y - placeable.height / 2f).roundToInt().coerceIn(margin, maxY)
    }
    layout(placeable.width, placeable.height) { placeable.place(x, y) }
}

// =========================================================================================
// Interfaccia
// =========================================================================================

/** Valore leggibile della compensazione: "+0.7 EV" (decimali secondo la lingua), "±0 EV" a zero. */
@Composable
internal fun exposureValueText(range: ExposureRange?, index: Int): String =
    if (range == null || index == 0) {
        stringResource(R.string.cam_exposure_value_zero)
    } else {
        stringResource(R.string.cam_exposure_value, range.ev(index))
    }

/**
 * Pannello "☀" della compensazione dell'esposizione: valore, slider verticale (su = piu luce),
 * pulsante AUTO che azzera la compensazione e il punto di misura. [onDraggingChange] serve alla
 * schermata per non nasconderlo mentre il dito e sullo slider.
 */
@Composable
internal fun ExposurePanel(
    range: ExposureRange,
    index: Int,
    canReset: Boolean,
    onIndexChange: (Int) -> Unit,
    onReset: () -> Unit,
    onDraggingChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val valueText = exposureValueText(range, index)
    Column(
        modifier = modifier
            .width(PanelWidth)
            .clip(PanelShape)
            .background(Color.Black.copy(alpha = 0.55f))
            .padding(top = 10.dp, bottom = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = valueText,
            style = PanelLabelStyle,
            color = if (index != 0) FfColors.Flash else Color.White,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        ExposureSlider(
            range = range,
            index = index,
            valueText = valueText,
            onIndexChange = onIndexChange,
            onDraggingChange = onDraggingChange,
            modifier = Modifier
                .fillMaxWidth()
                .height(TrackHeight),
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .clip(PanelShape)
                .clickable(
                    enabled = canReset,
                    role = Role.Button,
                    onClickLabel = stringResource(R.string.cam_cd_exposure_auto),
                    onClick = onReset,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = stringResource(R.string.cam_exposure_auto),
                style = PanelLabelStyle,
                color = if (canReset) Color.White else Color.White.copy(alpha = 0.35f),
            )
        }
    }
}

/**
 * Slider verticale disegnato a mano (quello di Material e solo orizzontale): binario sottile,
 * tacca sullo zero, tratto giallo dallo zero al cursore e cursore a sole. Il trascinamento e
 * relativo: il cursore segue il dito senza saltare dove lo si appoggia. Con TalkBack si regola
 * con i gesti di scorrimento (progressBarRangeInfo + setProgress).
 */
@Composable
private fun ExposureSlider(
    range: ExposureRange,
    index: Int,
    valueText: String,
    onIndexChange: (Int) -> Unit,
    onDraggingChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val currentRange by rememberUpdatedState(range)
    val currentIndex by rememberUpdatedState(index)
    val currentOnIndexChange by rememberUpdatedState(onIndexChange)
    val currentOnDraggingChange by rememberUpdatedState(onDraggingChange)
    val description = stringResource(R.string.cam_exposure_slider)
    val sun = rememberVectorPainter(Icons.Rounded.WbSunny)
    val span = range.maxIndex - range.minIndex
    // Se il pannello sparisce col dito ancora sopra, onDragCancel non arriva: lo si dice qui.
    DisposableEffect(Unit) {
        onDispose { currentOnDraggingChange(false) }
    }

    Canvas(
        modifier = modifier
            .semantics {
                contentDescription = description
                stateDescription = valueText
                progressBarRangeInfo = ProgressBarRangeInfo(
                    current = index.toFloat(),
                    range = range.minIndex.toFloat()..range.maxIndex.toFloat(),
                    steps = (span - 1).coerceAtLeast(0),
                )
                setProgress { target ->
                    val next = currentRange.clamp(target.roundToInt())
                    if (next != currentIndex) currentOnIndexChange(next)
                    true
                }
            }
            .pointerInput(Unit) {
                var startIndex = 0
                var travel = 0f
                detectVerticalDragGestures(
                    onDragStart = {
                        startIndex = currentIndex
                        travel = 0f
                        currentOnDraggingChange(true)
                    },
                    onDragEnd = { currentOnDraggingChange(false) },
                    onDragCancel = { currentOnDraggingChange(false) },
                ) { change, dragAmount ->
                    change.consume()
                    // Verso l'alto = piu luce, come il sole che sale.
                    travel -= dragAmount
                    val r = currentRange
                    val steps = (r.maxIndex - r.minIndex).coerceAtLeast(1)
                    val usable = (size.height - ThumbSize.toPx()).coerceAtLeast(1f)
                    val next = r.clamp(startIndex + (travel / (usable / steps)).roundToInt())
                    if (next != currentIndex) {
                        // Un piccolo scatto sullo zero: si ritrova la misura automatica senza guardare.
                        if (next == 0) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        currentOnIndexChange(next)
                    }
                }
            },
    ) {
        val thumb = ThumbSize.toPx()
        val usable = (size.height - thumb).coerceAtLeast(1f)
        val steps = span.coerceAtLeast(1).toFloat()
        val centerX = size.width / 2f
        fun yOf(i: Int): Float = thumb / 2f + (range.maxIndex - i) / steps * usable

        val zeroY = yOf(0.coerceIn(range.minIndex, range.maxIndex))
        val thumbY = yOf(index)
        val stroke = 2.dp.toPx()
        drawLine(
            color = Color.White.copy(alpha = 0.45f),
            start = Offset(centerX, thumb / 2f),
            end = Offset(centerX, size.height - thumb / 2f),
            strokeWidth = stroke,
            cap = StrokeCap.Round,
        )
        val tick = 7.dp.toPx()
        drawLine(
            color = Color.White.copy(alpha = 0.8f),
            start = Offset(centerX - tick, zeroY),
            end = Offset(centerX + tick, zeroY),
            strokeWidth = stroke,
            cap = StrokeCap.Round,
        )
        if (index != 0) {
            drawLine(
                color = FfColors.Flash,
                start = Offset(centerX, zeroY),
                end = Offset(centerX, thumbY),
                strokeWidth = stroke * 1.5f,
                cap = StrokeCap.Round,
            )
        }
        drawCircle(color = FfColors.Flash, radius = thumb / 2f, center = Offset(centerX, thumbY))
        val icon = thumb * 0.62f
        translate(left = centerX - icon / 2f, top = thumbY - icon / 2f) {
            with(sun) { draw(size = Size(icon, icon), colorFilter = ColorFilter.tint(FfColors.Ink)) }
        }
    }
}

/**
 * Punto in cui esposizione e messa a fuoco restano misurate: un piccolo anello fermo, cosi si
 * capisce perche la luce non segue piu il resto della scena. Sparisce quando si torna in automatico.
 */
@Composable
internal fun MeteringMarker(position: Offset) {
    Canvas(modifier = Modifier.fillMaxSize()) {
        drawCircle(
            color = FfColors.Flash,
            radius = 10.dp.toPx(),
            center = position,
            alpha = 0.8f,
            style = Stroke(width = 1.5.dp.toPx()),
        )
        drawCircle(color = FfColors.Flash, radius = 2.dp.toPx(), center = position, alpha = 0.8f)
    }
}
