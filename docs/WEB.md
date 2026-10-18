# FotoFlash Web — PWA con stampa Bluetooth LE

La versione web di FotoFlash è una **PWA installabile** pubblicata su GitHub Pages
(`https://nb-camelot.github.io/fotoflash/`). Fa le stesse cose dell'app Android (scatto,
anteprima termica, modelli, regolazioni, storico, esportazione), ma stampa **dal browser via
Web Bluetooth (BLE)**. Non serve installare l'APK: basta Chrome su Android, oppure Chrome o Edge
su desktop.

> **Contratti vincolanti**, come in `docs/ARCHITECTURE.md`: le firme dei moduli qui sotto sono il
> punto d'incontro di parti scritte in parallelo. Se ne cambi una, aggiorna questo file e tutti i
> chiamanti nello stesso commit.

> **Driver di stampa**: la PWA usa gli stessi driver dell'app (`escpos-58`, `escpos-80`,
> `phomemo-m02`, `phomemo-m02pro`), con gli stessi byte. Interfaccia JS, sequenza Phomemo, trasporto
> e vettori golden condivisi con Kotlin sono in [`docs/DRIVERS.md`](DRIVERS.md), vincolante come
> questo file.

## Principi

1. **Stessa carta dell'app.** Il motore (`web/src/core/`) è il porting **fedele** di `:core-thermal`
   (Kotlin), verificato con gli stessi vettori di test. Una foto stampata dal web deve uscire uguale
   a quella stampata dall'app con le stesse impostazioni.
2. **Zero dipendenze, zero build per sviluppare.** Moduli ES moderni (ES2022), nessun bundler,
   nessun pacchetto npm: `node web/dev-server.mjs` e si apre `http://127.0.0.1:5173/`. I test girano
   con il runner di Node (`node --test web/tests/*.test.mjs`: da Node 21 una cartella non basta), senza librerie.
3. **Offline dopo il primo avvio.** Il service worker mette in cache l'app shell, i font e le icone.
4. **Onestà sul supporto.** Web Bluetooth c'è su Chrome/Edge per Android e desktop; manca su Safari
   iOS e su Firefox. Dove manca, l'app funziona lo stesso per scattare, salvare e condividere, e lo
   dice chiaramente: la stampa richiede Chrome oppure l'app Android.
5. **Stessi brand e tono dell'app**: colori `ff_*`, Righteous e Space Mono, testi IT/EN.

## Regole del codice web

- `web/package.json` contiene solo `{ "private": true, "type": "module" }`: niente dipendenze, serve a Node per trattare i `.js` come moduli ES.
- **Nessun accesso a `window`, `document`, `navigator` o `localStorage` al caricamento di un modulo**, solo dentro le funzioni. Così ogni modulo si importa anche in Node: `web/tests/imports.test.mjs` li importa tutti, e un modulo che si rompe all'import fa fallire la CI.
- Import relativi con l'estensione (`./gray.js`), mai percorsi assoluti (il sito vive sotto `/fotoflash/`).
- Niente `innerHTML` con testo che arriva dall'utente o dallo storico: si usa `textContent` o `h()`.
- Commenti in italiano, brevi, sul perché. Testi visibili solo nelle tabelle di `i18n/strings/`.

## Struttura

```
web/
  index.html                 app shell: meta, manifest, CSS, <script type="module" src="src/app.js">
  manifest.webmanifest       nome, colori, icone, start_url "./", scope "./", display "standalone"
  sw.js                      service worker: cache dell'app shell versionata, offline
  dev-server.mjs             server statico locale (mappa /fonts e /brand sui file del repo)
  styles/app.css             token del brand e stili dei componenti
  src/
    app.js                   avvio: contesto, router, registrazione del SW, invito all'installazione
    version.js               export const VERSION (la build di Pages lo riscrive da gradle.properties)
    core/                    motore puro (niente DOM, gira anche in Node)
      model.js  gray.js  bitimage.js  tone.js  clahe.js  backlight.js  dither.js
      textmetrics.js  template.js  escpos.js
      bitmapfont.js          font bitmap per le pagine di prova raster dei driver
    printer/                 ble.js (Web Bluetooth), manager.js (stati, coda, esiti), testpage.js
      drivers/               index.js (elenco, driverById, guessDriver, encodeCanvas), escpos.js, phomemo.js
    render/                  renderer.js (Canvas 2D → BitImage), bitmap.js, fonts.js
    camera/                  camera.js (getUserMedia), live.js (anteprima termica dal vivo)
    media/                   import.js, export.js (download/condivisione), zip.js (ZIP senza compressione)
    store/                   settings.js (localStorage), history.js (IndexedDB)
    i18n/                    i18n.js + strings/<area>.js
    ui/                      dom.js, icons.js, components.js, router.js, screens/*.js
  tests/                     *.test.mjs per node --test
    fixtures/drivers-golden.json   vettori di byte dei driver, generati dai test JS e letti dal test Kotlin
```

Nel sito pubblicato la build (`scripts/build-web.mjs`) aggiunge:
- `fonts/`, copiata da `app/src/main/res/font/`;
- `icons/`: PNG 192/512, maskable 512 e apple-touch 180, generati da `docs/brand/icon.svg`;
- `brand/`, cioè il brand sheet;
- `src/version.js` con la versione reale.

In locale `dev-server.mjs` serve `/fonts/` e `/brand/` direttamente dai file del repo. Le icone PNG
in locale possono mancare: il manifest le elenca, e il browser ripiega sull'SVG.

## Contratti `web/src/core/` (porting di `:core-thermal`)

Tutti i moduli esportano funzioni e classi pure, senza DOM. I tipi sono quelli di Kotlin con gli
stessi nomi di campo; gli enum sono stringhe uguali ai nomi Kotlin (`'ATKINSON'`, `'POLAROID'`, `'MM58'`…).

```js
// model.js
export const PaperWidth = { MM58: { mm: 58, dots: 384, dpi: 203 }, MM80: { mm: 80, dots: 576, dpi: 203 },
                           M02PRO: { mm: 53, dots: 576, dpi: 300 } };   // come PaperWidth.kt (oggetti congelati)
export const DitherAlgorithm = ['ATKINSON', 'FLOYD_STEINBERG', 'ORDERED_BAYER', 'THRESHOLD'];
export const TemplateKind = ['POLAROID', 'FULL', 'STRIP', 'RECEIPT'];
export function defaultTone()        // { brightness: 0, contrast: 0.15, gamma: 1.25, autoLevels: true, sharpen: 0.5,
                                      //   shadows: 0.25, localContrast: 0.35, autoBacklight: true }
export function defaultJobOptions()  // { bandHeight: 24, feedLinesAfter: 4, cut: false, heat: null }
// TextRole, FontRole, TextAlign: stringhe come in Kotlin.

// gray.js — luminanza 0 (nero) .. 255 (bianco), Uint8Array
export class GrayImage {
  constructor(width, height, pixels /* opzionale, default tutto bianco */)
  get(x, y); set(x, y, v /* clamp */); copy(); histogram(); mean()
  static fromRgba(width, height, rgba /* Uint8ClampedArray|Uint8Array, alpha composta su bianco, luma Rec.601 intera come Kotlin */)
  static gradient(width, height)
}
// bitimage.js — righe MSB-first come GS v 0
export class BitImage { constructor(width, height); width; height; bytesPerRow; data /* Uint8Array */;
  get(x, y); set(x, y, black); rowsSlice(fromRow, rows) }
export function blit(dst, src, left, top)            // OR con clip
export function fillRect(img, rect, black)
export function toRgba(img, black = [0,0,0,255], white = [255,255,255,255])   // Uint8ClampedArray
export function bitImageFromRgba(width, height, rgba, threshold = 128)
export function centeredOn(img, width)
export function countBlack(img)

// tone.js / clahe.js / backlight.js — stesso algoritmo e stesso ordine di Tone.kt
export function applyTone(src, adj)                      // nuova GrayImage
export function claheApply(src, strength, tiles = 8, clipLimit = 2.5)
export function backlightScore(src)                      // 0..1

// dither.js
export function dither(src, algorithm, threshold = 128)  // BitImage

// textmetrics.js + template.js — porting di TemplateGeometry (metriche dei TTF incluse)
export const BRAND_TEXT = 'FOTOFLASH';
export function photoCount(kind, requested);
export function printNumberText(n);                      // "N. 0042"
export function layoutTemplate(kind, paper /* 'MM58'|'MM80'|'M02PRO' */, photoCount, texts)
  // → { width, height, photos: [{left, top, width, height}], texts: [{role, text, rect, font, sizeDots, align}],
  //     decorations: [{type: 'dashed', y, from, to, dash, gap, thickness} | ...] }

// escpos.js — dimensione con GS ! (mai ESC !)
export class EscPosBuilder { init(); codepage(n); align(a); bold(on); size(w, h); text(s); line(s); feed(n);
  cut(partial = true); heat(h); raster(img, bandHeight = 24); raw(...bytes); append(u8); bytes(); get length() }
  // size(w, h) è il comando GS !; il numero di byte si legge da length (in JS un nome non può essere sia metodo sia getter)
export function rasterBand(img, fromRow, rows)           // Uint8Array GS v 0
export function buildThermalJob(img, options)           // Uint8Array[] nello stesso ordine di ThermalJob.kt
export function totalBytes(packets); export function concatPackets(packets)
```

**Parità**: `web/tests/core-parity.test.mjs` riprende i valori esatti dei test Kotlin, per esempio:
- `ToneTest`: 147/146, la nitidezza 81/168 e 90/159, le righe della curva delle ombre;
- `DithererTest`: le coperture;
- `EscPosTest`: i byte;
- `TemplateGeometryTest`: rettangoli e altezze, 464/592/1002/702 a 384 punti.

Se un valore non coincide, il porting è sbagliato: non si cambia il valore atteso.

Per i **driver** la parità va nell'altro senso. I test JS (`web/tests/driver-*.test.mjs`) generano
`web/tests/fixtures/drivers-golden.json` con i casi di `docs/DRIVERS.md` (§ Vettori di prova condivisi)
e controllano che il file committato coincida. `DriversGoldenTest` in `core-thermal` lo rilegge e
pretende gli stessi byte dai driver Kotlin. Un driver che cambia byte cambia il golden nello stesso
commit, e la CI Android lo verifica.

## Contratti `web/src/printer/`

```js
// ble.js — porting di RawBT.ble del bridge (nb-camelot/raw-bt-print-bridge, escpos.js ≥ 1.9),
// già provato sulla "BlueTooth Printer" (profilo 18F0/2AF1). localStorage 'fotoflash.ble'.
export const Ble = {
  profiles, optionalServices, filters /* BLE_FILTERS */,
  supported(), available() /* Promise<boolean|null> */, canRemember(), saved() /* stampante ricordata o null */,
  info() /* {status, name, paired, connected, profile, characteristic, writeMode, chunk, transfer,
            remembered, lastError, lastErrorCode}; transfer = piano d'invio in uso, lo stampa la pagina di prova */,
  on(fn) /* → unsubscribe */,
  pair(opts) /* DA CHIAMARE DIRETTAMENTE nel gestore di un tocco */, reconnect() /* null se serve un tocco */,
  print(bytes, { onProgress, chunkSize, chunkDelayMs, withoutResponse, finalDelayMs }) /* in coda; gli
    hint sono le TransportHints del driver per quel lavoro (jobTransport li normalizza): senza hint
    resta la strategia 'auto' del bridge, o la modalità scelta con setWriteMode */,
  disconnect(), forget(), describe(),
  useCharacteristic(serviceUuid, charUuid), setWriteMode('auto'|'response-100'|'response-20'|'noresponse-20'),
  preferProfiles(profiles /* bleProfiles del driver, provati per primi; null = nessuna preferenza */),
  manualDriver() /* id scelto a mano per la stampante ricordata, o null */, setManualDriver(id),
  jobTransport(opts) /* → { chunkSize, chunkDelayMs, withoutResponse, finalDelayMs } | null */,
  errorCode(e) /* 'cancelled'|'unsupported'|'cat-printer'|'no-channel'|'timeout'|'location'|'not-found'|'gesture'|'network'|'write'|'unknown' */
};
// status: 'idle'|'connecting'|'ready'|'printing'|'disconnected'|'error'
// Anche esportati: BLE_ALL_PROFILES (profili di tutti i driver), BLE_FILTERS e BLE_OPTIONAL (per requestDevice).

// drivers/index.js — interfaccia comune in docs/DRIVERS.md; in più, compatibili con quel contratto:
export const DEFAULT_DRIVER_ID = 'escpos-58'; export const DRIVER_IDS;
export function unsupportedModel(name)     // 'phomemo-m02x' per un modello riconosciuto ma senza driver, altrimenti null
export function driverForPaper(paper, currentId)  // driver che stampa su quella carta, restando sul corrente se va già bene
export function allBleProfiles()           // profili di tutti i driver senza doppioni, ESC/POS prima
export function encodeGray(driver, gray, options, algorithm = driver.defaultDither)
export { escpos58, escpos80, phomemoM02, phomemoM02Pro, DEFAULT_DRIVER_OPTIONS, normalizeOptions, classifyName };
// options (DriverOptions JS): { feedLines = 4, cut = false, heatLevel = 0, bandHeight = 24, speed = null,
//   widthBytes = null /* 72 | 78, solo M02 Pro */, density = null /* 1..15, solo Phomemo */ }
// Sono densityOverride e widthBytes del DriverOptions Kotlin: stesso significato, nome JS più corto
// (normalizeOptions accetta anche densityOverride). classifyName(name) → 'unsupported'|'phomemo-m02pro'|
// 'phomemo-m02'|'escpos'|null: le regole di DriverNames in Drivers.kt.
// Campi in più del driver, per schermate e pagine di prova: family ('escpos'|'phomemo'), links,
// rasterShape(options) → { dots, bytesPerRow, bandRows }, technicalLines(options) (le righe tecniche
// della pagina di prova, come DriverTestPage.technicalLines); Phomemo anche widthOptions e
// widthBytesFor(options). defaultTransport delle ESC/POS ha in più auto: true: senza valori
// dell'utente il manager lascia a ble.js la strategia automatica del bridge.

// manager.js — l'unico punto che stampa (come PrinterManager su Android)
export class PrinterManager {
  constructor(settings /* store/settings.js */, ble = Ble, options = {} /* per i test: idleDisconnectMs,
              navigator(), setTimeout, clearTimeout, now() */)
  get state()      // { kind: 'unsupported'|'not-paired'|'disconnected'|'connecting'|'ready'|'printing'|'error',
                   //   name, progress /* 0..1 */, failure, message, action /* 'pair' con NO_PRINTER, altrimenti null */,
                   //   driver /* id corrente */, unsupported /* 'phomemo-m02x' | null */ }
  subscribe(fn)    // → unsubscribe; chiamata subito con lo stato attuale
  pair()           // gesto utente
  reconnect()
  async print(bitImage, { copies = 1, onProgress } = {})   // → { ok: true, bytes, ms } | { ok: false, failure, message }
  async printTestPage()                                      // ESC/POS: testpage.js (come TestPage.kt); Phomemo: driver.testPage(), raster
  currentDriver()                                            // driver delle impostazioni
  setDriver(driverId, { manual = true } = {})                // allinea la carta e propone il retino del driver;
                                                             // → driver; id sconosciuto → RangeError
  forget(); disconnect()
  dispose()        // smette di ascoltare ble.js e le impostazioni, ferma il timer di inattività
}
// failure: 'UNSUPPORTED'|'NO_PRINTER'|'BLUETOOTH_OFF'|'CONNECT_FAILED'|'WRITE_FAILED'|'BUSY'|'RENDER_FAILED'|'CAT_PRINTER'|'NO_CHANNEL'
//   (elenco esportato come FAILURES)
// Funzioni pure esportate (testabili in Node): driverFor(settings), paperFor(settings),
// driverOptionsFor(settings), transportFor(settings, driver) /* null = strategia 'auto' */, jobOptionsFor(settings),
// buildJobBytes(bitImage, settings), failureFor(e, phase, name) → { failure, message, detail }, technicalMessage(e).
export const PrinterTuning   // come PrinterTuning.kt: limiti (intensità 0..4, avanzamento 0..10, banda 8..255,
                             // pezzi BLE 20..512, pausa BLE 0..100 ms, densità 1..15, velocità 1..5), clamp*(),
                             // heatFor(level) (delega alla tabella del driver ESC/POS), drainMillis(bytes)

// testpage.js — pagina di prova testuale ESC/POS, porting di TestPage.kt (solo ASCII sulla carta)
export function buildTestPage(paper, settings, extra /* { printerName, writeMode, transfer, now } */)  // → Uint8Array
export function testPagePackets(paper, settings, extra)                                              // → Uint8Array[]
export function rasterTestPageTexts(driver, settings, extra /* … + options */)
  // → { subtitle, lines, widthCheck, ditherTitle, ditherLabels, currentDither, footer }: i testi tradotti
  //   della pagina raster, da passare a driver.testPage({ ...options, ...testi })
```

Il lavoro di stampa passa dal **driver corrente** (`driverFor(settings)`, cioè
`driverById(settings.printerDriver)`, contratto in [`docs/DRIVERS.md`](DRIVERS.md)):
`driver.encode(bitImage, options)` con le opzioni comuni (`bandHeight`, `feedLines`, `cutPaper`,
`heatLevel` → stessa tabella di `EscPosDriver.heatFor` in `Drivers.kt`, `printerSpeed`) e quelle
Phomemo (`phomemoDensity`, `phomemoWidthBytes`). Il driver centra o ritaglia sulla propria larghezza.
`escpos-*` produce gli stessi byte di `buildThermalJob`. I pacchetti vengono concatenati e passati a
`Ble.print` con le `TransportHints` del driver, sovrascritte da `bleChunkSize`, `bleChunkDelayMs` e
`bleWithoutResponse` quando non sono `null`. La pagina di prova è `testpage.js` per ESC/POS e
`driver.testPage()`, tutta raster, per i Phomemo.

Dopo l'abbinamento `guessDriver(device.name)` propone il driver, se l'utente non l'ha scelto a mano
per quella stampante (`Ble.manualDriver()`). Con `null` (nome che non dice nulla, oppure M02X) vale
il ripiego di `docs/DRIVERS.md` con l'eccezione dell'app (`docs/ARCHITECTURE.md`, § Note sui
contratti): resta il driver in uso se è ESC/POS, altrimenti `escpos-58`. Un nome ESC/POS tipico
mentre è attivo un driver ESC/POS non lo cambia: dal nome non si distingue la 58 mm dalla 80 mm.
Una **M02X** viene riconosciuta per nome e segnalata come non supportata: il suo protocollo è
diverso, vedi `issue_plans/phomemo-m02x.md`. Le cat printer (servizio `AE30`) restano rifiutate
con `errorCode` `'cat-printer'`. `requestDevice` riceve i filtri e gli `optionalServices` di
**tutti** i driver: se manca un servizio, Chrome nasconde la caratteristica anche dopo l'abbinamento.

### Calibrazione dell'invio BLE: perché 20 byte

Web Bluetooth **non espone l'MTU** negoziato. Con l'MTU minimo dell'ATT (23 byte) il carico utile di
una scrittura senza conferma è 23 − 3 = **20 byte**. Oltre quel limite alcuni stack, Android in
testa, possono troncare il pacchetto **senza errore**: la stampa esce a metà o con righe sfasate, e
nessuno se ne accorge. Per questo i Phomemo partono da **20 byte con 15 ms** di pausa, senza
conferma (`writeValueWithoutResponse`), con ripiego su `writeValue` se la scrittura senza conferma
fallisce. I preset più veloci si scelgono nella schermata Stampante e si verificano con la pagina
di prova:

| Preset (`prn_preset_*`) | Byte per scrittura | Pausa | Scrittura |
|---|---|---|---|
| Automatica (`auto`): `bleChunkSize`/`bleChunkDelayMs` a `null` | quelli del driver: 20 | 15 ms | senza conferma |
| Sicura (`safe`) | 20 | 15 ms | senza conferma |
| Veloce (`fast`) | 60 | 20 ms | senza conferma |
| Massima (`max`) | 128 | 20 ms | senza conferma (come phomymo) |
| Personalizzata (`manual`) | valori che non corrispondono a un preset | | |
| ESC/POS (`escpos-*`) | 100, poi 20 se rifiutati | — | con conferma: strategia `auto` del bridge, scelta con `setWriteMode` |

L'app Android non ha questo limite: chiede `requestMtu(247)` e spezza in `min(chunkSize, mtu − 3)`.

## Contratti `web/src/render/`, `camera/`, `media/`

```js
// fonts.js
export async function ensureFonts()          // FontFace: 'Righteous', 'Space Mono' 400/700 da ./fonts/*.ttf
// bitmap.js
export function drawCover(ctx, source, rect) // centerCrop come Bitmap.centerCrop
export function grayFromSource(source, width, height)   // GrayImage della sorgente ritagliata
export function bitImageToCanvas(img, scale = 1)        // canvas bianco/nero, nearest neighbour
export function canvasToBlob(canvas, type = 'image/png', quality)
// renderer.js — porting di PrintRenderer.kt (stessi font, soglia, adattamento dei testi, decorazioni)
export async function renderPrint(request)
  // request: { photos: ImageBitmap[]|HTMLCanvasElement[], template, paper, dither, tone, texts, labels: { footer, printNumber(n) } }
  // → { bitImage, canvas /* 1 px = 1 punto */ }

// camera.js
export class CameraController {
  constructor(videoEl)
  async start({ facing = 'environment' } = {}); stop(); async switchFacing()
  get facing(); get capabilities()  // { torch, exposure: {min, max, step} | null, pointsOfInterest }
  async setTorch(on); async setExposure(ev); async focusAt(nx, ny /* 0..1 */)
  async capture({ maxSide = 2048 } = {})   // ImageBitmap dritto, specchiato se frontale
}
// live.js
export function startThermalPreview(videoEl, canvasEl, { getTone, getDither, mirror }) // → stop()

// import.js / export.js / zip.js
export async function loadImageFile(file, maxSide = 2048)      // ImageBitmap con orientamento EXIF
export function downloadBlob(blob, filename)
export async function shareFiles(files /* File[] */, { title, text }) // Web Share se c'è, altrimenti download
export function makeZip(entries /* [{ name, data: Uint8Array|Blob, date }] */) // Promise<Blob>, "store" + CRC-32
```

## Contratti `web/src/store/`

```js
// settings.js — localStorage 'fotoflash.settings'; campi come AppSettings, tranne quelli specifici di Android
export const settings = { get(), update(patchOrFn), subscribe(fn), async nextPrintNumber(), reset() }
// campi: onboardingDone, paper, feedLines, cutPaper, heatLevel, bandHeight, dither, tone, template, eventTitle,
//        hashtag, showDate, showPrintNumber, printCounter, instantPrint, timerSeconds, stripShots, shutterSound,
//        livePreview, copies, autoDownloadCaptures (false: sul web il "salva in galleria" è un download),
//        printerDriver ('escpos-58'), bleChunkSize, bleChunkDelayMs, bleWithoutResponse (null = del driver),
//        phomemoDensity (null = da heatLevel), phomemoWidthBytes (72), printerSpeed (null = non inviata).
//        paper resta allineata al driver (docs/DRIVERS.md); printerLink non c'è: sul web è sempre BLE.
// history.js — IndexedDB 'fotoflash' v1, store 'entries' e 'blobs'; massimo 200 voci
export const history = { async list(), async get(id), async add({ printPng, originals /* Blob[] */, template,
  caption, printNumber, printed }), async markPrinted(id), async remove(id), async printBlob(id),
  async originals(id) /* Blob[] */, subscribe(fn) }
```

## Contratti `web/src/ui/` e `i18n/`

```js
// i18n.js
export function t(key, ...args)   // %1$s, %1$d come Android; chiave mancante → la chiave stessa (e un warn)
export function lang()            // 'it' | 'en' da navigator.language, forzabile con setLang
export function setLang(l)
// strings/<area>.js: export default { en: {...}, it: {...} }, prefisso dell'area, stesse chiavi:
// common_ cam_ ed_ hist_ set_ prn_ onb_ app_. Le prn_ stanno in strings/printer.js, non in prn.js:
// PRN è un nome di dispositivo riservato su Windows e un file con quel nome non si può creare.

// dom.js
export function h(tag, props, ...children)  // props: class, style, on* (eventi), attrs, ref(el)
export function clear(el)
// icons.js
export function icon(name, { size = 24 } = {})   // SVG inline: camera, bolt, timer, gallery, history, settings,
// print, share, download, back, bluetooth, check, close, sun, switch, trash, plus, minus, sparkles, info, install
// components.js (stile del brand, accessibili, touch target ≥ 48 px)
export function topBar({ title, onBack, actions = [] })
export function flashButton(text, { icon, onClick, busy = false, disabled = false })
export function ghostButton(text, { icon, onClick, disabled = false })
export function iconButton(name, { label, onClick, active = false })
export function shutterButton({ onClick, busy = false, countdown = null })  // → { el, set({busy, countdown}) }
export function paperSheet(...children)          // carta con bordi a dente di sega
export function thermalImage(canvas)             // image-rendering: pixelated, larghezza piena
export function chipsRow(options, selected, label, onSelect)  // → { el, set(selected) }
export function slider({ label, min, max, step, value, format, onInput })  // → { el, set(v) }
export function toggle({ label, desc, checked, onChange })                // → { el, set(v) }
export function sectionHeader(text)
export function printerPill(state, onClick)      // → { el, set(state) }
export function emptyState({ icon, title, message, actionText, onAction })
export function toast(message, { actionText, onAction, duration = 4000 } = {})
export function sheet({ title, content, onClose }) // → { close(), setContent(el) }
export function confirmDialog({ title, message, confirmText, cancelText }) // Promise<boolean>
// router.js — hash: #/onboarding #/camera #/editor #/history #/history/<id> #/settings #/printer
export function createRouter(root, routes, ctx)   // → { go(path), back(), current() }
// screens/<name>.js
export function mount(root, ctx, params) // → unmount()
// ctx = { settings, history, printer /* PrinterManager */, session, router, t, install /* {available(), prompt()} */ }
// session = { photos: ImageBitmap[], source: 'camera'|'gallery', suggestedTemplate: string|null, set(...), clear() }
```

## Pubblicazione

`.github/workflows/pages.yml`, dopo ogni «Bump version» riuscito su `main` (quindi con la versione nuova) e a mano:
1. `node --test web/tests/*.test.mjs`;
2. `node scripts/build-web.mjs dist`: copia `web/`, i font e il brand sheet, genera le icone PNG con
   `rsvg-convert`, scrive `src/version.js` e il nome della cache del SW con la versione di `gradle.properties`;
3. `actions/upload-pages-artifact` e `actions/deploy-pages`.

La CI di ogni push (`ci.yml`, job «Web (PWA)») esegue anche `node --test web/tests/*.test.mjs`. Pages pubblica solo da `main`.

## Note sui contratti (dopo la prima implementazione)

- `layoutTemplate` restituisce istanze di `Rect` (`left/top/width/height` più `right/bottom`), non oggetti semplici.
- `ui/print-sheet.js` (foglio di stampa) e `ui/sample-photo.js` (foto di esempio per provare senza fotocamera) fanno parte di `ui/`.
- **Storico**: `history.clear()` svuota tutto in una sola transazione. Una voce ha la forma `{ id, createdAt, seq, template, caption, printNumber, printed, photoCount }`. `history.add` rifiuta la promessa se non riesce a scrivere, quindi va avvolta in try/catch. `subscribe(fn)` di settings e history chiama `fn` solo ai cambiamenti: prima si legge lo stato con `get()`/`list()`. Al contrario, `PrinterManager.subscribe` chiama subito.
- **PrinterManager**:
  - `pair(opts)` accetta `{ all }` e `{ sameName }`;
  - `reconnect()` risolve con un booleano e non rifiuta mai;
  - `printTestPage({ onProgress })` riceve `onProgress(frazione, inviati, totali)`;
  - lo stato ha anche `detail`, `paired`, `remembered`, `connected`, `profile`, `writeMode` e `chunk`.
- **Componenti**, opzioni in più usate dalle schermate: `busy` e `small` su flashButton/ghostButton, `setTitle` su topBar, `{ ariaLabel }` su chipsRow, `{ label }` su thermalImage, `danger` su confirmDialog. Icone in più: `grain`, `image`, `warning`.
- **Esportazioni in più**: `exportFileName` (media/export.js), `releaseCanvas` (render/bitmap.js), `CameraController.cameraCount`, l'opzione `getPrintAspect` di `startThermalPreview`.
