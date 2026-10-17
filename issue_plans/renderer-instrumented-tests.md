# Piano: test strumentati del renderer

## Obiettivo

Proteggere la promessa più importante del prodotto, **"la carta è il prodotto" e WYSIWYG**, con test
che girano su un emulatore Android vero: il `PrintRenderer` usa Canvas, font e Bitmap, che i test JVM
non possono eseguire. Oggi la CI copre solo `core-thermal` e la logica pura dell'app.

## Contesto

- `print/PrintRenderer.kt` (`render(request): RenderedPrint`) compone foto retinate e testi in nero
  pieno; `RenderedPrint.preview` deve essere esattamente `bitImage` (1 pixel = 1 punto).
- `print/BitmapBridge.kt` converte tra `Bitmap`, `GrayImage` e `BitImage`.
- **Eccezione alla regola "nessuna dipendenza nuova", autorizzata da questo piano**: dipendenze di
  solo test strumentato (`androidTestImplementation`), da aggiungere al catalogo
  `gradle/libs.versions.toml` e a `docs/ARCHITECTURE.md`:
  `androidx.test:runner` 1.6.2, `androidx.test:core` 1.6.1, `androidx.test.ext:junit` 1.2.1
  (verifica su maven.google.com che le versioni esistano e siano compatibili con AGP 8.7.2 e compileSdk 35).
- Gli asserti si basano su **invarianti**, non su immagini di riferimento pixel per pixel (fragili tra
  versioni dell'emulatore).
- La CI non ha un emulatore e l'agente non può modificare `.github/`: il job va aggiunto da una
  persona (sezione *Fuori dalla CI*). In CI l'agente verifica che i test **compilino**.

## Task

1. Catalogo e `app/build.gradle.kts`: dipendenze sopra come `androidTestImplementation`,
   `testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"` in `defaultConfig`.
2. `app/src/androidTest/java/io/github/nik2208/fotoflash/print/PrintRendererTest.kt` con foto sintetiche
   (gradiente, scacchiera, foto a tinta unita) generate nel test, per ogni `TemplateKind` a 58 e 80 mm:
   - larghezza di `bitImage` = 384 o 576 e altezza = altezza del layout di `TemplateGeometry`;
   - `preview` ha le stesse dimensioni e ogni pixel è nero o bianco puro e coincide con `bitImage`;
   - dentro i rettangoli dei testi non ci sono pixel isolati da retino (ogni pixel nero ha almeno un
     vicino nero): i testi sono in nero pieno;
   - con didascalia vuota l'immagine è più bassa che con didascalia (dove il modello lo prevede);
   - i font del brand sono caricati: la larghezza misurata di "FOTOFLASH" con Righteous è diversa da
     quella con il font di sistema.
3. `BitmapBridgeTest.kt` strumentato: `toBitImage()` → `toBitmap()` → `toBitImage()` è l'identità.
4. `docs/ARCHITECTURE.md` (dipendenze di test e come lanciare i test), `README.md` (sezione Sviluppo:
   comando dei test strumentati), `CHANGELOG.md`.

## File coinvolti

`gradle/libs.versions.toml`, `app/build.gradle.kts`, `app/src/androidTest/java/io/github/nik2208/fotoflash/print/*.kt` (nuovi),
`docs/ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] Le tre dipendenze sono nel catalogo con versione esplicita e usate solo come `androidTestImplementation`.
- [ ] `gradle --no-daemon :app:assembleDebugAndroidTest` è verde (i test compilano).
- [ ] Esistono test per tutti i valori di `TemplateKind` a 58 e 80 mm e per il round trip di `BitmapBridge`.
- [ ] Nessun test usa immagini di riferimento binarie: solo invarianti.
- [ ] `docs/ARCHITECTURE.md` elenca le dipendenze di test e il comando `connectedDebugAndroidTest`.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` resta verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
gradle --no-daemon :app:assembleDebugAndroidTest
```

## Fuori dalla CI

Una persona aggiunge a `.github/workflows/ci.yml` un job su emulatore, per esempio con
`reactivecircus/android-emulator-runner` (versione bloccata), API 34, `x86_64`, profilo `pixel_6`,
che esegue `gradle --no-daemon :app:connectedDebugAndroidTest` (con KVM abilitato sul runner
Ubuntu), e lo rende un check richiesto su `dev` quando è stabile.

## Commit

test(app): test strumentati del renderer su emulatore
