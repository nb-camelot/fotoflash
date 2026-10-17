package io.github.nik2208.fotoflash.onboarding

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bluetooth
import androidx.compose.material.icons.rounded.BluetoothDisabled
import androidx.compose.material.icons.rounded.BluetoothSearching
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.nik2208.fotoflash.R
import io.github.nik2208.fotoflash.di.appGraph
import io.github.nik2208.fotoflash.model.PrintFailure
import io.github.nik2208.fotoflash.model.PrinterDevice
import io.github.nik2208.fotoflash.model.PrinterState
import io.github.nik2208.fotoflash.ui.components.BrandWordmark
import io.github.nik2208.fotoflash.ui.components.FlashButton
import io.github.nik2208.fotoflash.ui.components.GhostButton
import io.github.nik2208.fotoflash.ui.components.PrinterStatusChip
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FfFonts
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val PAGE_SNAP = 0
private const val PAGE_PRINT = 1
private const val PAGE_KEEP = 2
private const val PAGE_PERMISSIONS = 3
private const val PAGE_PRINTER = 4
private const val PAGE_COUNT = 5
private const val PRINTER_POLL_MS = 3_000L

@Composable
fun OnboardingScreen(onFinished: () -> Unit) {
    // Sempre chiaro: l'onboarding e la "carta" del brand, anche con il telefono in tema scuro.
    FotoFlashTheme(darkTheme = false) {
        OnboardingContent(onFinished = onFinished)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun OnboardingContent(onFinished: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val vm = viewModel { OnboardingViewModel(graph) }
    val state by vm.state.collectAsStateWithLifecycle()
    val printerState by vm.printerState.collectAsStateWithLifecycle()
    val pagerState = rememberPagerState(pageCount = { PAGE_COUNT })
    val scope = rememberCoroutineScope()

    val bluetoothPermissions = remember { vm.bluetoothPermissions() }
    // Contatore che forza la rilettura dei permessi (dopo la richiesta o al ritorno dalle impostazioni).
    var permissionTick by remember { mutableIntStateOf(0) }
    var permissionsAsked by rememberSaveable { mutableStateOf(false) }
    val cameraGranted = remember(permissionTick) { isGranted(context, Manifest.permission.CAMERA) }
    val bluetoothGranted = remember(permissionTick) { bluetoothPermissions.all { isGranted(context, it) } }
    val allGranted = cameraGranted && bluetoothGranted

    fun goTo(page: Int) {
        scope.launch { pagerState.animateScrollToPage(page) }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { _ ->
        permissionsAsked = true
        permissionTick++
        vm.refresh()
        val granted = isGranted(context, Manifest.permission.CAMERA) &&
            bluetoothPermissions.all { isGranted(context, it) }
        if (granted) goTo(PAGE_PRINTER)
    }

    var resumed by remember { mutableStateOf(false) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        resumed = true
        permissionTick++
        vm.refresh()
    }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { resumed = false }
    // Sulla pagina stampante si ricontrolla ogni pochi secondi: il Bluetooth acceso dalla tendina
    // o una stampante appena accoppiata compaiono senza dover toccare "Aggiorna".
    LaunchedEffect(pagerState.currentPage, resumed) {
        if (pagerState.currentPage == PAGE_PRINTER && resumed) {
            while (true) {
                vm.refresh()
                delay(PRINTER_POLL_MS)
            }
        }
    }

    val finish: () -> Unit = { vm.finish(onFinished) }
    val page = pagerState.currentPage

    Surface(modifier = Modifier.fillMaxSize(), color = FfColors.Paper, contentColor = FfColors.Ink) {
        Column(modifier = Modifier.fillMaxSize().systemBarsPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 24.dp, top = 8.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrandWordmark(height = 28.dp)
                Spacer(modifier = Modifier.weight(1f))
                TextButton(onClick = finish, enabled = !state.finishing) {
                    Text(text = stringResource(R.string.onb_skip), color = FfColors.Graphite)
                }
            }

            HorizontalPager(
                state = pagerState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) { index ->
                when (index) {
                    PAGE_SNAP -> IntroPage(
                        image = R.drawable.ill_onboarding_snap,
                        title = stringResource(R.string.onb_snap_title),
                        text = stringResource(R.string.onb_snap_text),
                    )

                    PAGE_PRINT -> IntroPage(
                        image = R.drawable.ill_onboarding_print,
                        title = stringResource(R.string.onb_print_title),
                        text = stringResource(R.string.onb_print_text),
                    )

                    PAGE_KEEP -> IntroPage(
                        image = R.drawable.ill_onboarding_keep,
                        title = stringResource(R.string.onb_keep_title),
                        text = stringResource(R.string.onb_keep_text),
                    )

                    PAGE_PERMISSIONS -> PermissionsPage(
                        cameraGranted = cameraGranted,
                        bluetoothNeeded = bluetoothPermissions.isNotEmpty(),
                        bluetoothGranted = bluetoothGranted,
                        asked = permissionsAsked,
                        onOpenAppSettings = { openAppSettings(context) },
                    )

                    else -> PrinterPage(
                        state = state,
                        printerState = printerState,
                        onSelect = vm::select,
                        onOpenBluetoothSettings = { openBluetoothSettings(context) },
                        onRefresh = vm::refresh,
                        onTestPage = vm::printTestPage,
                    )
                }
            }

            PageDots(
                count = PAGE_COUNT,
                current = page,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(vertical = 16.dp),
            )

            // Dopo un rifiuto il sistema spesso non mostra piu la richiesta: rilanciarla sarebbe un
            // pulsante morto. Si va avanti; per riattivare c'e "Apri impostazioni dell'app".
            val askPermissions = page == PAGE_PERMISSIONS && !allGranted && !permissionsAsked
            val primaryText = when {
                page < PAGE_KEEP -> stringResource(R.string.onb_next)
                page == PAGE_KEEP -> stringResource(R.string.onb_start)
                askPermissions -> stringResource(R.string.onb_perm_allow)
                page == PAGE_PERMISSIONS -> stringResource(R.string.onb_next)
                else -> stringResource(R.string.onb_done)
            }
            val onPrimary: () -> Unit = {
                when {
                    page < PAGE_PERMISSIONS -> goTo(page + 1)
                    askPermissions -> permissionLauncher.launch(
                        (listOf(Manifest.permission.CAMERA) + bluetoothPermissions).distinct().toTypedArray(),
                    )
                    page == PAGE_PERMISSIONS -> goTo(PAGE_PRINTER)
                    else -> finish()
                }
            }
            FlashButton(
                text = primaryText,
                onClick = onPrimary,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
                enabled = !state.finishing,
                busy = state.finishing,
            )
            Spacer(modifier = Modifier.height(20.dp))
        }
    }
}

// --- Pagine ---------------------------------------------------------------------------------

@Composable
private fun IntroPage(@DrawableRes image: Int, title: String, text: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painter = painterResource(image),
            contentDescription = null,
            modifier = Modifier
                .weight(1f, fill = false)
                .widthIn(max = 320.dp)
                .fillMaxWidth()
                .aspectRatio(4f / 3f),
            contentScale = ContentScale.Fit,
        )
        Spacer(modifier = Modifier.height(28.dp))
        Text(
            text = title,
            fontFamily = FfFonts.Display,
            fontSize = 44.sp,
            lineHeight = 48.sp,
            textAlign = TextAlign.Center,
            color = FfColors.Ink,
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = FfColors.Graphite,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun PermissionsPage(
    cameraGranted: Boolean,
    bluetoothNeeded: Boolean,
    bluetoothGranted: Boolean,
    asked: Boolean,
    onOpenAppSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        StepTitle(text = stringResource(R.string.onb_perm_title))
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.onb_perm_text),
            style = MaterialTheme.typography.bodyLarge,
            color = FfColors.Graphite,
        )
        Spacer(modifier = Modifier.height(24.dp))
        PermissionCard(
            icon = Icons.Rounded.PhotoCamera,
            title = stringResource(R.string.onb_perm_camera),
            description = stringResource(R.string.onb_perm_camera_desc),
            status = permissionStatus(cameraGranted, asked),
        )
        if (bluetoothNeeded) {
            Spacer(modifier = Modifier.height(12.dp))
            PermissionCard(
                icon = Icons.Rounded.Bluetooth,
                title = stringResource(R.string.onb_perm_bluetooth),
                description = stringResource(R.string.onb_perm_bluetooth_desc),
                status = permissionStatus(bluetoothGranted, asked),
            )
        }
        if (asked && !(cameraGranted && bluetoothGranted)) {
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = stringResource(R.string.onb_perm_denied_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = FfColors.Graphite,
            )
            Spacer(modifier = Modifier.height(12.dp))
            GhostButton(
                text = stringResource(R.string.onb_perm_settings),
                onClick = onOpenAppSettings,
                icon = Icons.Rounded.Settings,
            )
        }
    }
}

@Composable
private fun PrinterPage(
    state: OnboardingUiState,
    printerState: PrinterState,
    onSelect: (PrinterDevice) -> Unit,
    onOpenBluetoothSettings: () -> Unit,
    onRefresh: () -> Unit,
    onTestPage: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StepTitle(text = stringResource(R.string.onb_printer_title), modifier = Modifier.weight(1f))
            IconButton(onClick = onRefresh) {
                Icon(
                    imageVector = Icons.Rounded.Refresh,
                    contentDescription = stringResource(R.string.onb_refresh),
                    tint = FfColors.Graphite,
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.onb_printer_text),
            style = MaterialTheme.typography.bodyLarge,
            color = FfColors.Graphite,
        )
        Spacer(modifier = Modifier.height(20.dp))

        when {
            !state.checked -> Box(modifier = Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = FfColors.Ink)
            }

            !state.bluetoothAvailable -> Notice(
                icon = Icons.Rounded.BluetoothDisabled,
                text = stringResource(R.string.onb_printer_bt_unavailable),
            )

            !state.hasBluetoothPermission -> Notice(
                icon = Icons.Rounded.Bluetooth,
                text = stringResource(R.string.onb_printer_no_permission),
            )

            !state.bluetoothEnabled -> Notice(
                icon = Icons.Rounded.BluetoothDisabled,
                text = stringResource(R.string.onb_printer_bt_off),
            )

            state.printers.isEmpty() -> Notice(
                icon = Icons.Rounded.BluetoothSearching,
                text = stringResource(R.string.onb_printer_none),
            )

            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                state.printers.forEach { device ->
                    PrinterOption(
                        device = device,
                        selected = device.address == state.selectedAddress,
                        onClick = { onSelect(device) },
                    )
                }
            }
        }

        if (state.bluetoothAvailable) {
            Spacer(modifier = Modifier.height(16.dp))
            GhostButton(
                text = stringResource(R.string.onb_open_bt_settings),
                onClick = onOpenBluetoothSettings,
                icon = Icons.Rounded.Settings,
            )
        }

        if (state.selectedAddress != null && state.bluetoothAvailable) {
            Spacer(modifier = Modifier.height(24.dp))
            PrinterStatusChip(state = printerState, onClick = onRefresh)
            Spacer(modifier = Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                GhostButton(
                    text = stringResource(R.string.onb_test_page),
                    onClick = onTestPage,
                    icon = Icons.Rounded.Print,
                    enabled = !state.testing,
                )
                if (state.testing) {
                    Spacer(modifier = Modifier.width(12.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        color = FfColors.Ink,
                        strokeWidth = 2.dp,
                    )
                }
            }
            state.testResult?.let { result ->
                Spacer(modifier = Modifier.height(12.dp))
                TestResultLine(result = result)
            }
        }

        Spacer(modifier = Modifier.height(20.dp))
        Text(
            text = stringResource(R.string.onb_printer_later),
            style = MaterialTheme.typography.bodySmall,
            color = FfColors.Graphite,
        )
    }
}

// --- Elementi -------------------------------------------------------------------------------

@Composable
private fun StepTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        fontFamily = FfFonts.Display,
        fontSize = 34.sp,
        lineHeight = 38.sp,
        color = FfColors.Ink,
    )
}

private enum class PermissionStatus { GRANTED, DENIED, PENDING }

private fun permissionStatus(granted: Boolean, asked: Boolean): PermissionStatus = when {
    granted -> PermissionStatus.GRANTED
    asked -> PermissionStatus.DENIED
    else -> PermissionStatus.PENDING
}

@Composable
private fun PermissionCard(icon: ImageVector, title: String, description: String, status: PermissionStatus) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(FfColors.Fog)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(44.dp).clip(CircleShape).background(FfColors.Flash),
            contentAlignment = Alignment.Center,
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = FfColors.Ink)
        }
        Spacer(modifier = Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.titleMedium, color = FfColors.Ink)
            Text(text = description, style = MaterialTheme.typography.bodySmall, color = FfColors.Graphite)
        }
        Spacer(modifier = Modifier.width(8.dp))
        val (label, color) = when (status) {
            PermissionStatus.GRANTED -> stringResource(R.string.onb_perm_granted) to FfColors.Mint
            PermissionStatus.DENIED -> stringResource(R.string.onb_perm_denied) to FfColors.Coral
            PermissionStatus.PENDING -> stringResource(R.string.onb_perm_pending) to FfColors.Graphite
        }
        StatusPill(text = label, color = color)
    }
}

@Composable
private fun StatusPill(text: String, color: Color) {
    // Testo Ink su fondo tinto: Mint e Coral puri su carta non sono leggibili come testo.
    Text(
        text = text,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.28f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        color = FfColors.Ink,
        fontFamily = FfFonts.Mono,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        maxLines = 1,
    )
}

@Composable
private fun Notice(icon: ImageVector, text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(FfColors.Fog)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = FfColors.Graphite)
        Spacer(modifier = Modifier.width(12.dp))
        Text(text = text, style = MaterialTheme.typography.bodyMedium, color = FfColors.Ink)
    }
}

@Composable
private fun PrinterOption(device: PrinterDevice, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) FfColors.Flash.copy(alpha = 0.22f) else FfColors.Fog)
            .border(width = 2.dp, color = if (selected) FfColors.Ink else Color.Transparent, shape = shape)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = Icons.Rounded.Print, contentDescription = null, tint = FfColors.Ink)
        Spacer(modifier = Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = device.name,
                style = MaterialTheme.typography.titleMedium,
                color = FfColors.Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = device.address,
                fontFamily = FfFonts.Mono,
                fontSize = 12.sp,
                color = FfColors.Graphite,
            )
        }
        Icon(
            imageVector = if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
            contentDescription = if (selected) stringResource(R.string.onb_selected) else null,
            tint = if (selected) FfColors.Ink else FfColors.Graphite.copy(alpha = 0.5f),
        )
    }
}

@Composable
private fun TestResultLine(result: TestPageResult) {
    val (icon, color, text) = when (result) {
        TestPageResult.Success -> Triple(Icons.Rounded.CheckCircle, FfColors.Mint, stringResource(R.string.onb_test_ok))
        is TestPageResult.Failure -> Triple(Icons.Rounded.ErrorOutline, FfColors.Coral, failureText(result.failure))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = text, style = MaterialTheme.typography.bodyMedium, color = FfColors.Ink)
    }
}

@Composable
private fun PageDots(count: Int, current: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val selected = index == current
            val width by animateDpAsState(targetValue = if (selected) 24.dp else 8.dp, label = "onboardingDot")
            Box(
                modifier = Modifier
                    .height(8.dp)
                    .width(width)
                    .clip(CircleShape)
                    .background(if (selected) FfColors.FlashDeep else FfColors.Ink.copy(alpha = 0.16f)),
            )
        }
    }
}

@Composable
private fun failureText(failure: PrintFailure): String = stringResource(
    when (failure) {
        PrintFailure.NO_PRINTER -> R.string.onb_fail_no_printer
        PrintFailure.NO_PERMISSION -> R.string.onb_fail_no_permission
        PrintFailure.BLUETOOTH_OFF -> R.string.onb_fail_bluetooth_off
        PrintFailure.NOT_BONDED -> R.string.onb_fail_not_bonded
        PrintFailure.CONNECT_FAILED -> R.string.onb_fail_connect
        PrintFailure.WRITE_FAILED -> R.string.onb_fail_write
        PrintFailure.BUSY -> R.string.onb_fail_busy
    },
)

// --- Intent di sistema ----------------------------------------------------------------------

private fun isGranted(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

// android.provider.Settings resta qualificato: il nome Settings e gia l'icona importata sopra.
private fun openBluetoothSettings(context: Context) {
    try {
        context.startActivity(Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS))
    } catch (e: ActivityNotFoundException) {
        // Alcune ROM non espongono la pagina Bluetooth: ripieghiamo sulle impostazioni generali.
        try {
            context.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
        } catch (ignored: ActivityNotFoundException) {
            // Nessuna app impostazioni: non c'e altro da fare.
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
