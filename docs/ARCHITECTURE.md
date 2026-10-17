# FotoFlash — architettura e contratti

Documento di riferimento per chi sviluppa, persone e agenti. **I contratti qui sotto sono
vincolanti**: firme pubbliche, nomi di file e prefissi delle risorse. Se un contratto va
cambiato, si cambia qui e in tutti i chiamanti nello stesso commit.

## Moduli

| Modulo | Tipo | Contenuto |
|---|---|---|
| `:core-thermal` | Kotlin/JVM puro (nessuna dipendenza Android) | immagini in scala di grigi e a 1 bit, regolazioni tonali, retinatura, impaginazione dei modelli, comandi ESC/POS. **Tutto testato con JUnit.** |
| `:app` | Android, Jetpack Compose | fotocamera (CameraX), rendering Android dei modelli (Canvas + font), Bluetooth SPP, storico, impostazioni, UI |

Package radice: `io.github.nik2208.fotoflash`; il core sta in `io.github.nik2208.fotoflash.thermal`.
`applicationId` è `io.github.nik2208.fotoflash`. La build di debug ha il suffisso `.debug`, così convive con la release.

## Versioni (bloccate, verificate dalla CI)

| Componente | Versione |
|---|---|
| Gradle | 8.10.2 |
| AGP | 8.7.2 |
| Kotlin | 2.0.21, con il plugin `org.jetbrains.kotlin.plugin.compose` 2.0.21 |
| compileSdk / targetSdk / minSdk | 35 / 35 / 26 |
| Java | 17 |
| Compose BOM | 2024.12.01 (Material3 1.3.x) |
| CameraX | 1.4.1 |
| Navigation | 2.8.5 |
| Lifecycle | 2.8.7 |
| DataStore | 1.1.1 |
| Coroutines | 1.9.0 |

Il catalogo è `gradle/libs.versions.toml`. **Non aggiungere dipendenze** senza
aggiornare questo documento e senza un giro di CI verde.

## Flusso dei dati

```
CameraX / Photo Picker ──► Bitmap orientate ──► CaptureSession ──► EditorViewModel
                                                                      │ PrintCoordinator.buildRequest()
                                                                      ▼
                                   PrintRenderer (Android) ◄── TemplateGeometry (core)
                                   │  foto: crop → GrayImage → Tone → Ditherer → BitImage
                                   │  testi/decorazioni: Canvas su ARGB → soglia → BitImage
                                   ▼
                              RenderedPrint(bitImage, preview) ──► anteprima WYSIWYG
                                   │
                                   ▼ PrintCoordinator.printAndRecord()
                 PrinterManager ── ThermalJob.build() (core) ── BtSppTransport (blocchi + pause)
                                   │
                                   ▼
                      HistoryRepository (PNG 1 bit + JPEG originali + JSON)
```

## Contratti `:core-thermal`

Due file sono già presenti e congelati:
- `Model.kt`, con i tipi condivisi: `PaperWidth`, `DitherAlgorithm`, `ToneAdjustments`, `TemplateKind`, `TemplateTexts`, `Rect`, `TextAlign`, `FontRole`, `TextRole`, `TextBlock`, `Decoration`, `TemplateLayout`, `PrintJobOptions`, `HeatSettings`;
- `BitImage.kt`: si possono aggiungere estensioni in altri file, ma non cambiare l'API esistente.

```kotlin
// GrayImage.kt — luminanza 0 (nero) .. 255 (bianco), un byte per pixel (senza segno)
class GrayImage(val width: Int, val height: Int, val pixels: ByteArray = /* tutto bianco */) {
    operator fun get(x: Int, y: Int): Int
    operator fun set(x: Int, y: Int, value: Int)          // clamp 0..255
    fun copy(): GrayImage
    companion object {
        fun fromArgb(width: Int, height: Int, argb: IntArray): GrayImage  // alpha composto su bianco, luma Rec.601
        fun gradient(width: Int, height: Int): GrayImage                  // nero → bianco da sinistra a destra
    }
}

// Tone.kt — ordine: autoLevels → luminosità/contrasto → gamma → nitidezza. Restituisce una nuova immagine.
object Tone { fun apply(src: GrayImage, adj: ToneAdjustments): GrayImage }

// Ditherer.kt
object Ditherer { fun dither(src: GrayImage, algorithm: DitherAlgorithm, threshold: Int = 128): BitImage }

// BitImageOps.kt
fun BitImage.blit(src: BitImage, left: Int, top: Int)        // OR: i punti neri di src si sommano
fun BitImage.fillRect(rect: Rect, black: Boolean)
fun BitImage.toArgb(black: Int = 0xFF000000.toInt(), white: Int = 0xFFFFFFFF.toInt()): IntArray
fun bitImageFromArgb(width: Int, height: Int, argb: IntArray, threshold: Int = 128): BitImage // nero se luma<soglia e alpha>=128

// EscPos.kt — comandi ESC/POS. ATTENZIONE: la dimensione si fa con GS ! (0x1D 0x21), non ESC !
class EscPosBuilder {
    val size: Int
    fun init(): EscPosBuilder                                // ESC @
    fun codepage(n: Int): EscPosBuilder                      // ESC t n
    fun align(align: TextAlign): EscPosBuilder               // ESC a 0/1/2
    fun bold(on: Boolean): EscPosBuilder                     // ESC E n
    fun size(width: Int, height: Int): EscPosBuilder         // GS ! ((w-1)<<4)|(h-1), 1..8
    fun text(s: String, charset: java.nio.charset.Charset = Charsets.ISO_8859_1): EscPosBuilder
    fun line(s: String = ""): EscPosBuilder                  // testo + LF
    fun feed(lines: Int): EscPosBuilder                      // ESC d n
    fun cut(partial: Boolean = true): EscPosBuilder          // GS V 66 0 / GS V 65 0
    fun heat(heat: HeatSettings): EscPosBuilder              // ESC 7 n1 n2 n3
    fun raster(image: BitImage, bandHeight: Int = 24): EscPosBuilder
    fun raw(vararg bytes: Int): EscPosBuilder
    fun bytes(): ByteArray
}
object EscPosRaster { fun band(image: BitImage, fromRow: Int, rows: Int): ByteArray } // GS v 0 0 xL xH yL yH + dati

// ThermalJob.kt — pacchetti in ordine di invio: [ESC @ (+ ESC 7)], una banda per pacchetto, [avanzamento (+ taglio)]
object ThermalJob { fun build(image: BitImage, options: PrintJobOptions): List<ByteArray> }

// TemplateGeometry.kt — tutto in punti; si adatta alla larghezza della carta (384 o 576)
object TemplateGeometry {
    fun layout(kind: TemplateKind, paper: PaperWidth, photoCount: Int, texts: TemplateTexts): TemplateLayout
}
```

## Contratti `:app`

Il grafo delle dipendenze è `di/AppGraph.kt`, già scritto: le classi sotto **devono avere
esattamente questi costruttori**. Da un Composable il grafo si ottiene con `val graph = LocalContext.current.appGraph`.
I ViewModel si creano con `viewModel { XViewModel(graph) }` e si osservano con
`collectAsStateWithLifecycle()`.

I tipi condivisi sono già scritti e non vanno modificati senza aggiornare tutti i chiamanti:
- `model/AppSettings.kt`;
- `model/Printing.kt`: `PrinterDevice`, `PrinterState`, `PrintFailure`, `PrintOutcome`, `PrintRequest`, `RenderedPrint`, `CaptureSource`, `HistoryEntry`;
- `model/CaptureSession.kt`.

```kotlin
// data/SettingsRepository.kt (DataStore Preferences, file "settings")
class SettingsRepository(context: Context) {
    val settings: Flow<AppSettings>
    suspend fun current(): AppSettings
    suspend fun update(transform: (AppSettings) -> AppSettings)
    suspend fun nextPrintNumber(): Int          // incrementa printCounter in modo atomico e restituisce il nuovo valore
}

// history/HistoryRepository.kt (file in filesDir/history/<id>/: print.png, photo_N.jpg, meta.json)
class HistoryRepository(context: Context, scope: CoroutineScope) {
    val entries: StateFlow<List<HistoryEntry>>  // più recenti per primi
    fun find(id: String): HistoryEntry?
    suspend fun add(rendered: RenderedPrint, originals: List<Bitmap>, template: TemplateKind,
                    caption: String, printNumber: Int?, printed: Boolean): HistoryEntry
    suspend fun markPrinted(id: String)
    suspend fun delete(id: String)
    suspend fun loadPreview(entry: HistoryEntry): Bitmap?
    suspend fun loadBitImage(entry: HistoryEntry): BitImage?
}

// printer/PrinterManager.kt
class PrinterManager(context: Context, settings: SettingsRepository, scope: CoroutineScope) {
    val state: StateFlow<PrinterState>
    fun requiredPermissions(): Array<String>    // permessi runtime da chiedere su questa versione di Android
    fun hasBluetoothPermission(): Boolean
    fun isBluetoothAvailable(): Boolean
    fun isBluetoothEnabled(): Boolean
    fun bondedPrinters(): List<PrinterDevice>   // vuota senza permesso
    suspend fun select(device: PrinterDevice)
    suspend fun forget()
    suspend fun print(image: BitImage, copies: Int = 1): PrintOutcome
    suspend fun printTestPage(): PrintOutcome
    suspend fun disconnect()
}
// printer/PrinterTransport.kt
interface PrinterTransport {
    val isConnected: Boolean
    suspend fun connect(address: String, timeoutMs: Long)
    suspend fun write(bytes: ByteArray)
    suspend fun close()
}

// print/BitmapBridge.kt — conversioni condivise (le usa anche la fotocamera)
fun Bitmap.toGrayImage(): GrayImage
fun Bitmap.toBitImage(threshold: Int = 128): BitImage
fun BitImage.toBitmap(): Bitmap                       // ARGB_8888 bianco/nero, 1 pixel = 1 punto
fun Bitmap.centerCrop(targetWidth: Int, targetHeight: Int): Bitmap   // crop al rapporto + scala con filtro

// print/PrintRenderer.kt — pesante: lavora su Dispatchers.Default
class PrintRenderer(context: Context) { suspend fun render(request: PrintRequest): RenderedPrint }

// print/Exporter.kt
class Exporter(context: Context) {
    suspend fun saveToGallery(bitmap: Bitmap, displayName: String): Uri?   // Pictures/FotoFlash, PNG
    suspend fun shareIntent(bitmap: Bitmap, displayName: String): Intent   // PNG in cacheDir/shared, authority "${applicationId}.files"
}

// print/PrintCoordinator.kt — unico punto che mette insieme impostazioni, rendering, stampa e storico
class PrintCoordinator(context: Context, settings: SettingsRepository, renderer: PrintRenderer,
                       printer: PrinterManager, history: HistoryRepository) {
    suspend fun buildRequest(photos: List<Bitmap>, template: TemplateKind? = null, caption: String = "",
                             tone: ToneAdjustments? = null, dither: DitherAlgorithm? = null): PrintRequest
    suspend fun render(request: PrintRequest): RenderedPrint
    suspend fun printAndRecord(request: PrintRequest, rendered: RenderedPrint, copies: Int = 1): PrintOutcome
    suspend fun saveOnly(request: PrintRequest, rendered: RenderedPrint): HistoryEntry
    suspend fun quickPrint(photos: List<Bitmap>, template: TemplateKind? = null): PrintOutcome  // stampa istantanea
}
```

### Schermate

Sono le firme usate dalla navigazione in `nav/FotoFlashNavHost.kt`.

```kotlin
@Composable fun OnboardingScreen(onFinished: () -> Unit)                                    // onboarding/
@Composable fun CameraScreen(onOpenEditor: () -> Unit, onOpenHistory: () -> Unit,
                             onOpenSettings: () -> Unit, onOpenPrinter: () -> Unit)         // camera/
@Composable fun EditorScreen(onBack: () -> Unit, onDone: () -> Unit, onOpenPrinter: () -> Unit) // editor/
@Composable fun HistoryScreen(onBack: () -> Unit, onOpenEntry: (String) -> Unit)            // history/
@Composable fun HistoryDetailScreen(entryId: String, onBack: () -> Unit)                     // history/
@Composable fun SettingsScreen(onBack: () -> Unit, onOpenPrinter: () -> Unit)                // settings/
@Composable fun PrinterScreen(onBack: () -> Unit)                                            // printer/
```

### Tema e componenti (`ui/theme`, `ui/components`)

```kotlin
@Composable fun FotoFlashTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit)
@Composable fun CameraTheme(content: @Composable () -> Unit)        // sempre scuro, per il mirino
object FfColors { val Ink; val Night; val Paper; val Fog; val Graphite; val Flash; val FlashDeep; val Coral; val Mint; val Sky }  // Color
object FfFonts { val Display: FontFamily; val Mono: FontFamily }    // Righteous, Space Mono (regular+bold)

@Composable fun ShutterButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
                              busy: Boolean = false, countdown: Int? = null)
@Composable fun PaperSheet(modifier: Modifier = Modifier, zigzagTop: Boolean = true, zigzagBottom: Boolean = true,
                           content: @Composable ColumnScope.() -> Unit)       // foglio di carta termica
@Composable fun ThermalImage(bitmap: Bitmap, contentDescription: String?, modifier: Modifier = Modifier) // nearest neighbour, larghezza piena
@Composable fun PrinterStatusChip(state: PrinterState, onClick: () -> Unit, modifier: Modifier = Modifier)
@Composable fun <T> ChoiceChipsRow(options: List<T>, selected: T, label: @Composable (T) -> String,
                                   onSelect: (T) -> Unit, modifier: Modifier = Modifier)
@Composable fun FlashButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
                            icon: ImageVector? = null, enabled: Boolean = true, busy: Boolean = false)  // primario giallo
@Composable fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
                            icon: ImageVector? = null, enabled: Boolean = true)                         // secondario
@Composable fun SectionHeader(text: String, modifier: Modifier = Modifier)
@Composable fun BrandWordmark(modifier: Modifier = Modifier, height: Dp = 28.dp, onDark: Boolean = false)
@Composable fun EmptyState(icon: ImageVector, title: String, message: String, modifier: Modifier = Modifier,
                           actionText: String? = null, onAction: (() -> Unit)? = null)
@Composable fun FfTopBar(title: String, onBack: (() -> Unit)?, modifier: Modifier = Modifier,
                         actions: @Composable RowScope.() -> Unit = {})
```

## Risorse: proprietà e prefissi

Più file `strings_*.xml` convivono in `res/values` (inglese, default) e `res/values-it`
(italiano). **Ogni area ha il suo file e il suo prefisso**: un nome duplicato rompe la build.

| Area | File stringhe | Prefisso |
|---|---|---|
| comuni, tema, componenti | `strings.xml` (`app_name`), `strings_common.xml` | `common_` |
| fotocamera | `strings_camera.xml` | `cam_` |
| editor e stampa | `strings_editor.xml` | `ed_` |
| stampante | `strings_printer.xml` | `prn_` |
| storico | `strings_history.xml` | `hist_` |
| impostazioni | `strings_settings.xml` | `set_` |
| onboarding | `strings_onboarding.xml` | `onb_` |

Risorse del brand:
- Drawable, in `res/drawable`: `ic_launcher_foreground`, `ic_launcher_monochrome`, `ic_splash`, `ic_brand_bolt`, `ill_onboarding_snap`, `ill_onboarding_print`, `ill_onboarding_keep`.
- Icona adattiva: `mipmap-anydpi-v26/ic_launcher.xml`, con il colore `ic_launcher_background` in `values/ic_launcher_colors.xml`.
- Colori del brand: `values/colors.xml` (`ff_*`).
- Font, in `res/font`: `righteous_regular`, `space_mono_regular`, `space_mono_bold`.

## Regole di scrittura del codice

- Solo API stabili delle versioni bloccate. I componenti Material3 sperimentali
  (`TopAppBar`, `ModalBottomSheet`, `SegmentedButton`, `TooltipBox`…) richiedono di annotare la funzione con
  `@OptIn(ExperimentalMaterial3Api::class)`.
- Import espliciti (niente `import x.*`), niente reflection, niente librerie nuove.
- Icone: `androidx.compose.material.icons.Icons.Rounded.*` (material-icons-extended); per le
  frecce, `Icons.AutoMirrored.Rounded.ArrowBack`.
- Il lavoro pesante (rendering, I/O, Bluetooth) non va mai sul main thread: usare `withContext(Dispatchers.Default/IO)`.
- Nessun testo visibile all'utente scritto nel codice: sempre `stringResource(R.string.…)`.
- Gli errori non si inghiottono: si gestiscono, oppure risalgono come `PrintOutcome.Failure` con un messaggio utile.
- Commenti in italiano, brevi, sul *perché*.
