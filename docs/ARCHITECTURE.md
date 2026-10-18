# FotoFlash — architettura e contratti

Documento di riferimento per chi sviluppa, persone e agenti. **I contratti qui sotto sono
vincolanti**: firme pubbliche, nomi di file e prefissi delle risorse. Se un contratto va
cambiato, si cambia qui e in tutti i chiamanti nello stesso commit.

> **Versione web (PWA, `web/`)**: struttura, regole e contratti dei moduli JavaScript sono in
> [`docs/WEB.md`](WEB.md), vincolanti allo stesso modo. Qui sotto c'è solo l'app Android; il motore
> web (`web/src/core/`) è il porting di `:core-thermal` e deve restare allineato ai suoi test.

> **Driver di stampa**: l'interfaccia `PrinterDriver`, i quattro driver (`escpos-58`, `escpos-80`,
> `phomemo-m02`, `phomemo-m02pro`), la sequenza esatta dei byte Phomemo, il trasporto BLE GATT e le
> aggiunte a `PrinterManager` sono in [`docs/DRIVERS.md`](DRIVERS.md), vincolante come questo
> documento e comune ad app e PWA. Qui sotto ci sono solo i punti in cui i driver toccano l'app.

## Moduli

| Modulo | Tipo | Contenuto |
|---|---|---|
| `:core-thermal` | Kotlin/JVM puro (nessuna dipendenza Android) | immagini in scala di grigi e a 1 bit, regolazioni tonali, retinatura, impaginazione dei modelli, comandi ESC/POS, **driver di stampa** (ESC/POS e Phomemo) con le loro pagine di prova raster. **Tutto testato con JUnit**, driver compresi: byte esatti e parità con la PWA. |
| `:app` | Android, Jetpack Compose | fotocamera (CameraX), rendering Android dei modelli (Canvas + font), Bluetooth classico SPP **e Bluetooth LE GATT** (con la ricerca dei dispositivi vicini), storico, impostazioni, UI |

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
                 PrinterManager ── PrinterDrivers.byId(settings.printerDriver) (core)
                                   │  driver.encode(bitImage, DriverOptions) → pacchetti
                                   │  (escpos-*: ThermalJob.build · phomemo-*: PhomemoEncoder)
                                   ├─ printerLink = CLASSIC ─► BtSppTransport (blocchi + pause delle impostazioni)
                                   ├─ printerLink = BLE ─────► BleGattTransport (TransportHints del driver,
                                   │                           sovrascritte dalla calibrazione BLE)
                                   ▼
                      HistoryRepository (PNG 1 bit + JPEG originali + JSON)
```

La carta (`AppSettings.paper`) **discende dal driver**: `escpos-58` → `MM58`, `escpos-80` → `MM80`,
`phomemo-m02` → `MM58`, `phomemo-m02pro` → `M02PRO`. L'impaginazione lavora in punti, quindi
`TemplateGeometry` e `PrintRenderer` non sanno quale stampante c'è dall'altra parte.

## Contratti `:core-thermal`

Due file sono già presenti e congelati:
- `Model.kt`, con i tipi condivisi: `PaperWidth` (`MM58`, `MM80` e `M02PRO(53, 576, 300)`, con il campo `dpi`), `PrinterLink` (`CLASSIC`, `BLE`), `DitherAlgorithm`, `ToneAdjustments`, `TemplateKind`, `TemplateTexts`, `Rect`, `TextAlign`, `FontRole`, `TextRole`, `TextBlock`, `Decoration`, `TemplateLayout`, `PrintJobOptions`, `HeatSettings`;
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

// Tone.kt — ordine: controluce automatico (Backlight.score alza ombre e contrasto locale) → CLAHE → curva delle ombre
//           → auto-livelli → luminosità/contrasto → gamma → nitidezza. Restituisce una nuova immagine.
//           Con shadows=0, localContrast=0, autoBacklight=false il risultato è identico alla versione senza controluce.
object Tone { fun apply(src: GrayImage, adj: ToneAdjustments): GrayImage }

// Clahe.kt — contrasto locale adattivo (tessere quadrate, clip, interpolazione bilineare), miscelato con l'originale
object Clahe { fun apply(src: GrayImage, strength: Float, tiles: Int = 8, clipLimit: Float = 2.5f): GrayImage }

// Backlight.kt — 0 = nessun controluce, 1 = soggetto scuro su bordo molto chiaro (formula nel KDoc)
object Backlight { fun score(src: GrayImage): Float }

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

// TemplateGeometry.kt — tutto in punti; si adatta alla larghezza della carta (384 punti, oppure 576 per MM80 e M02PRO)
object TemplateGeometry {
    fun layout(kind: TemplateKind, paper: PaperWidth, photoCount: Int, texts: TemplateTexts): TemplateLayout
    fun photoCount(kind: TemplateKind, requested: Int): Int   // foto usate davvero: STRIP 1..4, gli altri 1
    fun printNumberText(number: Int): String                  // "N. 0042" (l app lo sostituisce con il testo localizzato)
    const val BRAND_TEXT = "FOTOFLASH"
}

// Drivers.kt — interfaccia e driver di stampa: firme complete in docs/DRIVERS.md (§ Interfaccia comune)
interface PrinterDriver { /* id, paper, dpi, links, bleProfiles, defaultDither, defaultTransport, encode(), testPage() */ }
object PrinterDrivers { val all: List<PrinterDriver>; fun byId(id: String?): PrinterDriver; fun guess(name: String?): PrinterDriver? }
```

Aggiunta compatibile al contratto di `docs/DRIVERS.md`: `DriverOptions` ha anche `densityOverride: Int?`
(densità Phomemo 1..15, vince su `heatLevel`) e `widthBytes: Int?` (72 o 78 per la M02 Pro). Le riempie
`PrinterTuning.driverOptions(settings)`, che `PrinterManager` usa per ogni lavoro e per la pagina di
prova, da `phomemoDensity` e `phomemoWidthBytes`. Entrambi valgono `null` per default, e ogni driver
ignora le opzioni che non usa. Sul web gli stessi due campi si chiamano `density` e `widthBytes`
(`docs/WEB.md`).

Altre aggiunte compatibili in `Drivers.kt`, elencate anche nel suo commento di testa:
- `PrinterDrivers.DEFAULT_ID`, `ids`, `bleServices` (i servizi di tutti i profili, per i filtri della
  ricerca BLE) e `isUnsupported(name)`, vero per la M02X: riconosciuta, ma senza driver;
- `EscPosDriver.heatFor(level)`, la tabella `ESC 7` dell'intensità: è la fonte unica, e
  `PrinterTuning.heatFor` dell'app vi delega;
- `BleProfiles` (profili GATT noti) e `PhomemoEncoder`, il protocollo Phomemo scritto una volta sola;
- `PrinterDriver.rasterWidth(options)`, `testPageImage(options, labels)`, `encodeTestPage(options, labels)`
  e `TestPageLabels`: la pagina di prova raster, con testi che l'app può localizzare;
- `BitmapFont.kt` (`object BitmapFont`): font bitmap 5×7 per l'ASCII stampabile, con cui la pagina di
  prova raster disegna i testi punto per punto. Accenti e caratteri fuori dall'ASCII vengono ricondotti
  (`normalize`). Il gemello sul web è `web/src/core/bitmapfont.js`.

I byte dei driver sono verificati due volte: dai test JVM (`DriversTest`) e dal confronto con i
vettori della PWA (`DriversGoldenTest` legge `web/tests/fixtures/drivers-golden.json`). Se un byte
non coincide, è sbagliato un porting: il file golden non si ritocca a mano.

## Contratti `:app`

Il grafo delle dipendenze è `di/AppGraph.kt`, già scritto: le classi sotto **devono avere
esattamente questi costruttori**. Da un Composable il grafo si ottiene con `val graph = LocalContext.current.appGraph`.
I ViewModel si creano con `viewModel { XViewModel(graph) }` e si osservano con
`collectAsStateWithLifecycle()`.

I tipi condivisi sono già scritti e non vanno modificati senza aggiornare tutti i chiamanti:
- `model/AppSettings.kt`, con i campi dei driver: `printerDriver`, `printerLink`, `bleChunkSize`, `bleChunkDelayMs`, `bleWithoutResponse`, `phomemoDensity`, `phomemoWidthBytes`, `printerSpeed` (significato in `docs/DRIVERS.md`, § Impostazioni nuove);
- `model/Printing.kt`: `PrinterDevice(name, address, link = CLASSIC)`, `PrinterState`, `PrintFailure`, `PrintOutcome`, `PrintRequest`, `RenderedPrint`, `CaptureSource`, `HistoryEntry`;
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
    val loaded: StateFlow<Boolean>              // true quando l indice iniziale è stato letto dal disco
    fun find(id: String): HistoryEntry?
    suspend fun add(rendered: RenderedPrint, originals: List<Bitmap>, template: TemplateKind,
                    caption: String, printNumber: Int?, printed: Boolean): HistoryEntry
    suspend fun markPrinted(id: String)
    suspend fun delete(id: String)
    suspend fun loadPreview(entry: HistoryEntry): Bitmap?
    suspend fun loadBitImage(entry: HistoryEntry): BitImage?
    fun originalFiles(entry: HistoryEntry): List<File>   // JPEG originali esistenti su disco (lato lungo fino a 2048 px)
}

// printer/PrinterManager.kt
class PrinterManager(context: Context, settings: SettingsRepository, scope: CoroutineScope) {
    val state: StateFlow<PrinterState>
    fun requiredPermissions(): Array<String>    // permessi runtime da chiedere su questa versione di Android
    fun hasBluetoothPermission(): Boolean
    fun isBluetoothAvailable(): Boolean
    fun isBluetoothEnabled(): Boolean
    fun bondedPrinters(): List<PrinterDevice>   // accoppiate in SPP (link = CLASSIC); vuota senza permesso
    suspend fun select(device: PrinterDevice, driverId: String? = null)  // null → guess(name); vedi § Note sui contratti
    suspend fun forget()
    suspend fun print(image: BitImage, copies: Int = 1): PrintOutcome
    suspend fun printTestPage(): PrintOutcome   // escpos-*: TestPage testuale; phomemo-*: driver.encodeTestPage(options, labels)
                                                // raster, con testi localizzati
    suspend fun disconnect()
    // Aggiunte dei driver (firme e commenti in docs/DRIVERS.md, § Contratti aggiuntivi dell'app Android):
    // discovered, scanning, scanPermissions(), isLocationNeededForScan(), startBleScan(), stopBleScan(),
    // currentDriver(), setDriver(driverId)
    // Aggiunte compatibili, per le schermate:
    val selectedDriver: StateFlow<PrinterDriver>    // il driver corrente, osservabile (currentDriver() ne è la lettura)
    val scanIssue: StateFlow<BleScanIssue?>         // perché la ricerca BLE non parte o si è fermata; null = nessun problema
    fun hasScanPermission(): Boolean
    fun isLocationEnabled(): Boolean                // conta solo dove isLocationNeededForScan()
}
// printer/BleScanner.kt
enum class BleScanIssue { UNAVAILABLE, NO_PERMISSION, BLUETOOTH_OFF, LOCATION_OFF, FAILED }

// printer/PrinterTuning.kt — limiti e conversioni impostazioni → driver, condivisi da schermate e PrinterManager
object PrinterTuning {
    fun driverOptions(s: AppSettings): DriverOptions                      // opzioni del lavoro, nei limiti della schermata
    fun bleHints(driver: PrinterDriver, s: AppSettings): TransportHints   // TransportHints del driver + bleChunkSize/…
    enum class BlePreset(val chunkSize: Int?, val chunkDelayMs: Int?, val withoutResponse: Boolean?) {
        DRIVER /* null, null, null */, SAFE /* 20, 15, true */, FAST /* 60, 20, true */,
        MAX /* 128, 20, true */, CONFIRMED /* 100, 0, false */
    }                                                                     // preset di invio BLE della schermata
    fun blePresetOf(s: AppSettings): BlePreset?                           // null = valori personalizzati
}
// printer/PrinterTransport.kt — due implementazioni: BtSppTransport (SPP) e BleGattTransport (BLE GATT)
interface PrinterTransport {
    val isConnected: Boolean
    suspend fun connect(address: String, timeoutMs: Long)
    suspend fun write(bytes: ByteArray)
    // aggiunta compatibile, con implementazione predefinita: onProgress riceve i byte di ogni pezzo accettato
    suspend fun write(bytes: ByteArray, onProgress: ((Int) -> Unit)?)
    suspend fun close()
}
// errori: PrinterTransportException (sealed) e sottoclassi, tra cui BleNoChannelException(address, services)
// quando la stampante BLE non espone un canale di scrittura noto

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
    suspend fun savePhotoToGallery(bitmap: Bitmap, displayName: String): Uri?    // JPEG 92 in Pictures/FotoFlash/Scatti
    suspend fun savePhotoFileToGallery(file: File, displayName: String): Uri?     // copia un JPEG già su disco (originali dello storico)
    fun needsLegacyWritePermission(): Boolean   // true su API 26-28 se WRITE_EXTERNAL_STORAGE non è concesso: chiederlo prima di salvare
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
@Composable fun HistoryDetailScreen(entryId: String, onBack: () -> Unit, onOpenPrinter: (() -> Unit)? = null) // history/
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
- **Bluetooth LE**: su API 33+ `writeCharacteristic(characteristic, value, writeType)`, che restituisce un codice di stato; sotto, `setValue` + `writeType` + `writeCharacteristic(characteristic)`, annotati `@Suppress("DEPRECATION")`. Una scrittura GATT alla volta: la successiva parte dopo `onCharacteristicWrite`. Le chiamate che richiedono `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN` gestiscono `SecurityException`.
- Nessun testo visibile all'utente scritto nel codice: sempre `stringResource(R.string.…)`.
- Gli errori non si inghiottono: si gestiscono, oppure risalgono come `PrintOutcome.Failure` con un messaggio utile.
- Commenti in italiano, brevi, sul *perché*.

## Note sui contratti (aggiornate dopo la prima implementazione)

- **Testi dei modelli.** `TemplateGeometry.layout` può emettere più `TextBlock` consecutivi con lo stesso ruolo, uno per riga, quando titolo o didascalia vanno a capo. Lascia vuoto `FOOTER`, che l'app riempie con la frase localizzata. Precompila `BRAND` ("FOTOFLASH") e `PRINT_NUMBER` ("N. 0042"), che l'app può sostituire. Le larghezze sono stimate con le metriche reali dei TTF: il renderer deve usare `Paint.textSize = sizeDots`.
- **`PrintFailure.RENDER_FAILED`.** Indica che la stampa non si è potuta comporre (memoria, immagine non valida). Non va mai mostrato come errore della stampante. Ogni `when` esaustivo su `PrintFailure` deve gestirlo.
- **Reflection, unica eccezione ammessa.** `BtSppTransport` usa come ultimo ripiego `BluetoothDevice.createRfcommSocket(1)`, che serve per molte stampanti economiche. Se la piattaforma lo blocca, il tentativo viene saltato.
- **Ristampa dallo storico.** Passa da `PrinterManager.print` + `HistoryRepository.markPrinted` senza `PrintCoordinator`, perché il `BitImage` è già pronto: non si ricompone né si consuma un nuovo numero.
- **Componenti in più, non elencati sopra.** `HalftoneBurst(color, modifier, spacing)` in `ui/components/Motifs.kt`, motivo decorativo a puntini. `ThermalImage` applica `fillMaxWidth().aspectRatio(...)` dopo il modifier del chiamante: per ritagliare una miniatura, avvolgerla in un contenitore.
- **Aggiunte compatibili nel core.** `GrayImage.histogram()/mean()`, `BitImage.copy()/countBlack()`, `EscPosBuilder.append(ByteArray)`, `ThermalJob.totalBytes(packets)`.
- **576 punti non vuol dire sempre 80 mm.** Con `PaperWidth.M02PRO` anche la carta da 53 mm della Phomemo M02 Pro ha 576 punti, a 300 dpi. Ogni conversione punti → millimetri (messaggi «carta troppo stretta», storico, ristampa) parte dal driver corrente (`PrinterManager.currentDriver().paper`), non dalla sola larghezza in punti.
- **Driver proposto dal nome.** `select(device, driverId = null)` usa `PrinterDrivers.guess(name)`.
  Quando `guess` dà `null` (nome che non dice nulla, oppure M02X) resta il driver in uso se è ESC/POS,
  così chi aveva scelto la 80 mm la ritrova; altrimenti si passa a `escpos-58`. È il ripiego di
  `docs/DRIVERS.md` (`guess(name) ?: escpos-58`) con questa sola eccezione. Riscegliere la stessa
  stampante (stesso indirizzo e collegamento) non tocca il driver, così una scelta fatta a mano resta.
  Ogni cambio di driver riporta ai predefiniti `bleChunkSize`, `bleChunkDelayMs` e `bleWithoutResponse`,
  perché erano tarati sul driver precedente.
- **Due trasporti, una sola logica.** Mutex, chiusura per inattività, riconnessione automatica e stati di `PrinterManager` valgono per SPP e per BLE. Cambia solo come si spezzano i byte: in SPP blocchi e pause delle impostazioni (`chunkSize`, `chunkDelayMs`), in BLE le `TransportHints` del driver, sovrascritte da `bleChunkSize`, `bleChunkDelayMs` e `bleWithoutResponse` quando non sono `null`.
