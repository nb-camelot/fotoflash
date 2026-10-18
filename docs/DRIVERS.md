# Driver di stampa intercambiabili

FotoFlash stampa su più famiglie di stampanti termiche attraverso **driver** con un'interfaccia
comune, sia nell'app Android sia nella PWA. Il driver riceve la stampa già composta e restituisce
due cose: i byte da inviare e i parametri di trasporto. Il resto dell'app non sa con quale stampante
sta parlando.

| Driver (`id`) | Stampanti | Punti/riga | DPI | Trasporto | Retino predefinito |
|---|---|---|---|---|---|
| `escpos-58` | ESC/POS 58 mm, per esempio la "BlueTooth Printer" o le Netum | 384 | 203 | Android: SPP classico o BLE · Web: BLE | Atkinson |
| `escpos-80` | ESC/POS 80 mm | 576 | 203 | come sopra | Atkinson |
| `phomemo-m02` | **Phomemo M02** (non Pro) | 384 (48 byte) | 203 (come la Netum) | BLE (Android e Web) | Floyd-Steinberg |
| `phomemo-m02pro` | **Phomemo M02 Pro** (anche M02S) | **576** (72 byte) | **300** | BLE (Android e Web) | **Floyd-Steinberg** |

**Perché i modelli di stampa si riusano.** L'impaginazione (`TemplateGeometry`) lavora in punti e scala
con la larghezza. 576 punti a 300 dpi sono 48,8 mm, e i 384 punti a 203 dpi della 58 mm sono 48 mm: il
rapporto 576/384 = 1,50 è quasi uguale a 300/203 = 1,48. Quindi sulla M02 Pro corpi, margini e proporzioni
escono **fisicamente** quasi identici alla 58 mm.

## Interfaccia comune

### Kotlin (`core-thermal`, puro e testabile)

```kotlin
enum class PrinterLink { CLASSIC, BLE }

/** Profilo GATT di un canale di stampa BLE. */
data class BleProfile(val name: String, val service: String, val write: String, val notify: String? = null)

/** Come vanno spediti i byte: pezzi, pause, scrittura con o senza conferma. */
data class TransportHints(
    val chunkSize: Int,          // byte per scrittura (su Android: min(chunkSize, mtu - 3))
    val chunkDelayMs: Int,       // pausa tra due scritture
    val withoutResponse: Boolean,
    val finalDelayMs: Int = 300, // attesa prima di chiudere, per svuotare il buffer
)

/** Opzioni del lavoro, comuni a tutti i driver; ciascun driver ignora quelle che non usa. */
data class DriverOptions(
    val feedLines: Int = 4,
    val cut: Boolean = false,
    val heatLevel: Int = 0,      // 0 = predefinito della stampante, 1..4 più scuro
    val bandHeight: Int = 24,
    val speed: Int? = null,      // solo dove il protocollo lo prevede (sperimentale)
)

interface PrinterDriver {
    val id: String
    val displayName: String
    val paper: PaperWidth                 // punti per riga (MM58, MM80, M02PRO)
    val dpi: Int
    val links: Set<PrinterLink>           // trasporti supportati
    val bleProfiles: List<BleProfile>     // in ordine di preferenza
    val defaultDither: DitherAlgorithm
    val defaultTransport: TransportHints
    fun matchesName(name: String?): Boolean   // riconoscimento automatico dal nome annunciato
    fun encode(image: BitImage, options: DriverOptions): List<ByteArray>  // pacchetti in ordine di invio
    fun testPage(options: DriverOptions): List<ByteArray>
}

object PrinterDrivers {
    val all: List<PrinterDriver>          // escpos-58, escpos-80, phomemo-m02, phomemo-m02pro
    fun byId(id: String?): PrinterDriver  // id sconosciuto o null → escpos-58
    fun guess(name: String?): PrinterDriver?
}
```

Più un ingresso generico, per quando la sorgente è un'immagine qualunque e non una stampa già composta:

```kotlin
fun PrinterDriver.encodeGray(image: GrayImage, options: DriverOptions, dither: DitherAlgorithm = defaultDither): List<ByteArray>
```

Il driver centra o ritaglia sulla propria larghezza con `centeredOn(paper.dots)`.

### JavaScript (`web/src/printer/drivers/`), con lo stesso significato

```js
export const drivers = [escpos58, escpos80, phomemoM02, phomemoM02Pro];
export function driverById(id); export function guessDriver(name);
// driver = { id, displayName, paper: 'MM58'|'MM80'|'M02PRO', dots, dpi, bleProfiles, defaultDither,
//            defaultTransport: { chunkSize, chunkDelayMs, withoutResponse, finalDelayMs },
//            matchesName(name), encode(bitImage, options) → Uint8Array[], testPage(options) → Uint8Array[] }
// Ingresso comune "canvas": canvas (OffscreenCanvas o HTMLCanvasElement) → GrayImage → retino del driver → BitImage
export function encodeCanvas(driver, canvas, options, dither = driver.defaultDither);
```

## Driver ESC/POS

È quello di oggi: `ThermalJob.build` (init, `ESC 7` se c'è l'intensità, bande `GS v 0`, avanzamento,
taglio). Sul web il trasporto predefinito è la strategia del bridge, provata sulla stampante vera:
`auto` = con conferma a pezzi da 100 byte, che scende a 20 se la stampante li rifiuta. Su Android,
in SPP, restano blocchi e pause delle impostazioni.

## Driver Phomemo (M02 e M02 Pro)

I due driver condividono lo stesso protocollo, implementato una volta sola (`PhomemoEncoder` in Kotlin, `phomemo.js` sul web) e parametrizzato con:

| | `phomemo-m02` | `phomemo-m02pro` |
|---|---|---|
| Larghezza | 384 punti = **48 byte** (`30 00` nell'header del raster) | 576 punti = **72 byte** (`48 00`); opzione 78 byte |
| DPI | 203 | 300 |
| Carta (`PaperWidth`) | MM58: stessa impaginazione della Netum | M02PRO |
| Nomi riconosciuti | `M02` da solo, o seguito da cifre/spazi (non S, X, Pro) | `M02 Pro`, `M02PRO`, `M02S` |

La **M02X** usa un protocollo diverso e incompatibile ([sgrankin/phomemo](https://pkg.go.dev/github.com/sgrankin/phomemo)). `guess()` la riconosce e non le assegna un driver Phomemo: la UI avvisa che non è supportata.

Di seguito i byte sono quelli della M02 Pro. Per la M02 cambiano solo i byte della larghezza: `1D 76 30 00 30 00 hh 00`, con righe da 48 byte.

Fonti, tutte di reverse engineering: non esiste una documentazione ufficiale.
- [ryo-endo/phomemo-printer](https://github.com/ryo-endo/phomemo-printer): M02 Pro via BLE, 576 punti, `FF02`, init `1B 40 1F 11 02 04`, `GS v 0`.
- [vivier/phomemo-tools](https://github.com/vivier/phomemo-tools): M02, blocchi da 255 righe al massimo, coda `1F 11 08/0E/07/09`.
- [theacodes/phomemo_m02s](https://github.com/theacodes/phomemo_m02s): M02S a 300 dpi, larghezza massima 576, comandi `1F 11` di stato.
- [phomymo](https://github.com/transcriptionstream/phomymo): Web Bluetooth, `FF00/FF02/FF03`, pezzi da 128 byte senza conferma con 20 ms di pausa, densità.

Sequenza del lavoro (`encode`):

| # | Byte | Significato |
|---|---|---|
| 1 | `1B 40` | ESC @, inizializza |
| 2 | `1B 61 01` | allineamento al centro |
| 3 | `1F 11 02 dd` | densità di stampa: `dd` = 1..15, predefinito 4. Da `heatLevel`: 0→4, 1→2, 2→4, 3→6, 4→8 |
| 4 | `1B 4E 0D ss` | **solo se** `speed != null`: velocità, comando delle M110, **non verificato** sulla M02 Pro, quindi spento di default |
| 5 | `1D 76 30 00 48 00 hh 00` + `hh × 72` byte | un blocco raster per ogni gruppo di ≤ 255 righe; righe MSB-first, 1 = nero |
| 6 | `1B 64 nn` | avanzamento di `feedLines` righe (predefinito 4, poi `1B 64 02`) |
| 7 | `1F 11 08` `1F 11 0E` `1F 11 07` `1F 11 09` | chiusura come l'app ufficiale (interrogazioni di stato: energia, timer, firmware, stato; il significato di 09 non è confermato) |

- **Larghezza**: 576 punti. Le immagini più strette vengono centrate, quelle più larghe ritagliate al centro. Un'opzione avanzata `phomemoWidthBytes` (72 o 78) copre le unità che stampano 624 punti, come dice phomymo.
- **Retino**: Floyd-Steinberg come predefinito di questo driver. Quando si sceglie la M02 Pro l'app propone di passare a FS. I testi restano neri pieni, mai retinati, come per tutti i driver.
- **BLE**: servizio `0000ff00-…`, scrittura `0000ff02-…`, notifiche `0000ff03-…`. Nomi annunciati: `M02 Pro`, `M02PRO`, `M02S`, `M02`.
- **Trasporto**: `writeValueWithoutResponse`.
  - Sul **web** Web Bluetooth non espone l'MTU, quindi il **predefinito sicuro è 20 byte con 15 ms** di pausa. Con l'MTU minimo il carico utile di una scrittura senza conferma è 20 byte, e oltre Android può troncare in silenzio. I preset "Veloce" (60 byte e 20 ms) e "Massima" (128 byte e 20 ms) si scelgono in calibrazione e si verificano con la pagina di prova. Se una scrittura senza conferma fallisce si ripiega su `writeValue`, con conferma.
  - Su **Android** l'app chiede l'MTU (`requestMtu(247)`) e usa pezzi da `min(chunkSize, mtu - 3)`. Ogni scrittura parte solo dopo `onCharacteristicWrite` della precedente, più la pausa configurata.
- **Pagina di prova**: "FOTOFLASH" disegnato a raster (la M02 Pro non ha font ESC/POS affidabili), una banda di gradiente per ciascun retino, una scala di grigi e i parametri correnti stampati come testo raster.

## Android: trasporto BLE GATT

- `BleGattTransport : PrinterTransport`:
  - collegamento con `connectGatt(context, false, callback, TRANSPORT_LE)`, poi `discoverServices()` e `requestMtu(247)`;
  - scelta del canale con la stessa logica del web: profili del driver, poi la prima caratteristica scrivibile del servizio;
  - scritture serializzate. Su API 33+ con `writeCharacteristic(char, value, type)`, sotto con `setValue` e `writeType`, annotati `@Suppress("DEPRECATION")`;
  - timeout su ogni fase; chiusura con `gatt.close()`.
- **Ricerca**: `BluetoothLeScanner` per 10 s, con filtri sui servizi dei profili e sui nomi tipici, più un ripiego senza filtri. I risultati compaiono nella schermata Stampante insieme ai dispositivi accoppiati in SPP.
- **Permessi**:
  - API 31+: `BLUETOOTH_SCAN` con `usesPermissionFlags="neverForLocation"` e `BLUETOOTH_CONNECT`;
  - API ≤ 30: `ACCESS_FINE_LOCATION` (con `maxSdkVersion="30"`) e la Localizzazione attiva per la ricerca BLE.
- `PrinterDevice` acquisisce `link: PrinterLink`. Le impostazioni salvano `printerLink` e `printerDriver`.

## Impostazioni nuove (Android e Web)

- `printerDriver`: id del driver. Predefinito `escpos-58`; con la scelta di una stampante si usa `guess(name)`.
- `printerLink`: `CLASSIC` o `BLE` (solo Android).
- `bleChunkSize` e `bleChunkDelayMs` (`null` = predefiniti del driver), più `bleWithoutResponse`.
- `phomemoDensity` (1..15, `null` = da `heatLevel`), `phomemoWidthBytes` (72 o 78), `printerSpeed` (`null` = non inviata).
- La larghezza della carta discende dal driver: `escpos-58` → MM58, `escpos-80` → MM80, `phomemo-m02pro` → M02PRO, cioè 576 punti.

## Verifica

- **Test JVM** (`core-thermal`) e **test Node** (web), con gli stessi vettori, sui byte esatti di `encode`: header, densità, blocchi da 255 righe con l'ultimo più corto, larghezza 72/78, coda, centratura di un'immagine da 384 punti a 576.
- **Parità Kotlin↔JS**: lo stesso BitImage di prova deve produrre gli stessi byte nei due driver.
- Sulla carta: la pagina di prova di ciascun driver, sulla stampante vera.

## Contratti aggiuntivi dell'app Android

Tipi già scritti, non vanno modificati senza aggiornare tutti i chiamanti:
- `PaperWidth.M02PRO(53, 576, 300)` e `PrinterLink { CLASSIC, BLE }` in `core-thermal/.../Model.kt`;
- `PrinterDevice(name, address, link = CLASSIC)` in `model/Printing.kt`;
- i campi `printerDriver`, `printerLink`, `bleChunkSize`, `bleChunkDelayMs`, `bleWithoutResponse`, `phomemoDensity`, `phomemoWidthBytes` e `printerSpeed` in `model/AppSettings.kt`.

```kotlin
// printer/PrinterManager.kt — aggiunte, le firme esistenti restano
val discovered: StateFlow<List<PrinterDevice>>  // dispositivi BLE trovati dall'ultima ricerca (link = BLE)
val scanning: StateFlow<Boolean>
fun scanPermissions(): Array<String>            // API 31+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT; ≤ 30: ACCESS_FINE_LOCATION
fun isLocationNeededForScan(): Boolean          // API ≤ 30: la Localizzazione deve essere attiva
fun startBleScan(timeoutMs: Long = 10_000)      // silenziosa se mancano i permessi (lo stato lo dice)
fun stopBleScan()
fun currentDriver(): PrinterDriver
suspend fun select(device: PrinterDevice, driverId: String? = null)  // vedi «Scelta del driver» qui sotto; allinea paper e retino
suspend fun setDriver(driverId: String)
```

`bondedPrinters()` resta: sono i dispositivi accoppiati in SPP (`link = CLASSIC`). La schermata Stampante
e l'onboarding mostrano due elenchi: «Accoppiate» (SPP) e «Vicine (BLE)», con il pulsante «Cerca».

## Vettori di prova condivisi Kotlin ↔ JS

`web/tests/fixtures/drivers-golden.json` è generato dai test JS e committato. Il test Kotlin
`DriversGoldenTest` lo legge (`File("../web/tests/fixtures/drivers-golden.json")`, relativo a
`core-thermal/`) e verifica che i driver Kotlin producano **gli stessi byte**. Struttura:

```json
{ "cases": [ { "driver": "phomemo-m02pro",
               "image": { "width": 100, "height": 300, "pattern": "checker8" },
               "options": { "feedLines": 4, "cut": false, "heatLevel": 0, "bandHeight": 24, "speed": null, "widthBytes": 72 },
               "packetsHex": ["1b40", "1b6101", "..."] } ] }
```

Pattern, nell'immagine `width × height`:
- `checker8`: nero se `((x >> 3) + (y >> 3)) % 2 == 0`;
- `diag`: nero se `x % 64 == y % 64`;
- `solid`: tutto nero;
- `empty`: tutto bianco.

Casi minimi: ogni driver con `checker8` 100×300, che per i Phomemo copre più blocchi da 255 righe e la centratura; `phomemo-m02pro` anche con `widthBytes` 78 e con `heatLevel` 3; `escpos-58` con `cut = true`.

## Scelta del driver dopo l'abbinamento (stessa regola su Android e PWA)

1. C'è un driver scelto a mano: si usa quello. Su Android è `driverId`; sulla PWA è la scelta salvata per quella stampante.
2. La stampante è la stessa (stesso indirizzo e stesso collegamento): il driver non cambia.
3. `guess(nome)` riconosce un driver:
   - se è ESC/POS e anche quello attuale è ESC/POS, resta quello attuale, perché il nome non distingue la 58 mm dalla 80 mm;
   - altrimenti si passa a quello riconosciuto.
4. Nome sconosciuto (compresa la M02X, non supportata): un driver ESC/POS resta com'è, un Phomemo torna a `escpos-58`.

**Al cambio di driver:**
- la carta si allinea al driver;
- il retino passa a quello del nuovo driver, ma solo se era ancora il predefinito del driver precedente;
- la taratura BLE (`bleChunkSize`, `bleChunkDelayMs`, `bleWithoutResponse`) si azzera **solo cambiando famiglia** (ESC/POS ↔ Phomemo).
