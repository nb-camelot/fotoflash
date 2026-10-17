# Piano: stampanti BLE "cat printer" (GB01/MX05 e simili)

## Obiettivo

Far stampare FotoFlash anche sulle mini stampanti termiche **Bluetooth Low Energy** a protocollo
proprietario (famiglie GB01/GB02/GB03, MX05/MX06/MX10, YT01 e cloni), le più diffuse tra le
"fotocamere per bambini" e i regali economici. Oggi FotoFlash parla solo ESC/POS su Bluetooth classico
SPP; queste stampanti non si accoppiano dalle impostazioni di Android e non capiscono ESC/POS.

## Contesto

- Trasporto attuale: `printer/PrinterTransport.kt` (interfaccia), `printer/BtSppTransport.kt`,
  `printer/PrinterManager.kt` che costruisce i pacchetti con `ThermalJob.build()` di `core-thermal`.
- Protocollo noto dalle implementazioni open source (verifica ogni valore su almeno **due** di esse,
  per esempio `rbaron/catprinter` e `NaitLee/Cat-Printer` su GitHub, e cita la fonte in un commento):
  - GATT: servizio `0000ae30-0000-1000-8000-00805f9b34fb`, caratteristica di scrittura `ae01`
    (write without response), notifiche su `ae02`.
  - Pacchetto: `0x51 0x78 CMD 0x00 LEN_LO LEN_HI DATI... CRC8 0xFF`; il CRC-8 è polinomio `0x07`,
    valore iniziale `0x00`, calcolato **solo sui DATI** (è il CRC-8/SMBUS: il check di `"123456789"`
    vale `0xF4`).
  - Comandi principali: riga di bitmap (`0xA2`, 48 byte per 384 punti), avanzamento carta (`0xA1`),
    energia/intensità (`0xAF`), velocità (`0xBD`), modalità di disegno (`0xBE`), qualità (`0xA4`),
    inizio/fine "lattice" (`0xA6`), stato (`0xA3`).
  - Ordine dei bit: nelle righe di bitmap il punto più a **sinistra** è il bit **meno** significativo
    di ogni byte (l'opposto di ESC/POS e di `BitImage`).
  - Le stampanti hanno buffer piccoli: si scrive riga per riga rispettando l'MTU negoziato e si
    rallenta quando la stampante notifica di essere occupata.
- Se le due fonti contraddicono un valore di questo piano (codici, ordine dei bit, CRC), vincono le
  fonti: correggi il piano e il criterio corrispondente nello stesso lavoro e spiegalo nella PR.
- Larghezza: 384 punti (58 mm). La carta da 80 mm non esiste per queste stampanti.
- Scoperta: non sono accoppiate, quindi serve una scansione BLE: permesso `BLUETOOTH_SCAN` con
  `android:usesPermissionFlags="neverForLocation"` su Android 12+, `ACCESS_FINE_LOCATION` fino ad Android 11.

**Contratti toccati** (aggiorna `docs/ARCHITECTURE.md` e tutti i chiamanti nello stesso lavoro):
`PrinterDevice` acquista un campo `kind: PrinterKind = PrinterKind.ESC_POS_SPP` (nuovo enum in
`model/Printing.kt`: `ESC_POS_SPP`, `CAT_BLE`); `AppSettings` acquista `printerKind`;
`PrinterManager` espone `fun scanBlePrinters(): Flow<PrinterDevice>` (o equivalente documentato).

## Task

1. `core-thermal`: nuovo `CatPrinterProtocol.kt` (object) con `crc8(data)`, `packet(cmd, data)`,
   `bitmapRow(image: BitImage, y: Int): ByteArray` (bit invertiti), `feed(lines)`, `energy(level)` e
   `job(image: BitImage, options: CatJobOptions): List<ByteArray>` (preambolo, righe, avanzamento).
2. `core-thermal`: test `CatPrinterProtocolTest.kt` (vedi criteri).
3. `model/Printing.kt`, `model/AppSettings.kt`, `data/SettingsRepository.kt`: tipo di stampante
   persistito; i dispositivi già salvati restano `ESC_POS_SPP`.
4. `printer/BleCatTransport.kt`: implementa `PrinterTransport` con `BluetoothGatt` (connessione con
   timeout, scoperta del servizio, richiesta MTU, coda di scritture serializzata sui callback,
   chiusura pulita); errori tradotti nelle eccezioni tipizzate di `PrinterTransport.kt`.
5. `printer/PrinterManager.kt`: sceglie trasporto e costruzione del lavoro in base a `kind`;
   `requiredPermissions()` include i permessi di scansione; scansione con timeout (10 s) che filtra
   per servizio `ae30` o per nome (`GB0`, `MX0`, `MX1`, `YT0`).
6. `printer/PrinterScreen.kt` e `onboarding/`: sezione "Stampanti BLE vicine" con pulsante di
   scansione, elenco e scelta; badge del tipo nella stampante selezionata.
7. `AndroidManifest.xml`: `BLUETOOTH_SCAN` (neverForLocation), `ACCESS_FINE_LOCATION`
   con `android:maxSdkVersion="30"`, `uses-feature android.hardware.bluetooth_le` non obbligatoria.
8. Stringhe `prn_*` (e `onb_*` se servono) in `values/strings_printer.xml` e `values-it/strings_printer.xml`.
9. `docs/ARCHITECTURE.md`, `README.md` (tabella delle stampanti compatibili), `CHANGELOG.md`.

## File coinvolti

`core-thermal/src/main/kotlin/io/github/nik2208/fotoflash/thermal/CatPrinterProtocol.kt` (nuovo),
`core-thermal/src/test/kotlin/io/github/nik2208/fotoflash/thermal/CatPrinterProtocolTest.kt` (nuovo),
`app/src/main/java/io/github/nik2208/fotoflash/printer/BleCatTransport.kt` (nuovo),
`printer/PrinterManager.kt`, `printer/PrinterScreen.kt`, `printer/PrinterViewModel.kt`,
`model/Printing.kt`, `model/AppSettings.kt`, `data/SettingsRepository.kt`, `onboarding/*`,
`AndroidManifest.xml`, `res/values*/strings_printer.xml`, `docs/ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] `CatPrinterProtocol.crc8("123456789".toByteArray())` vale `0xF4` (test).
- [ ] `packet(cmd, data)` produce `0x51 0x78 cmd 0x00 lenLo lenHi data crc 0xFF`, con lunghezza in
      little endian, verificato per un payload vuoto, di 1 byte e di 300 byte (test).
- [ ] `bitmapRow` di un'immagine 384x1 con solo il punto x=0 nero dà un primo byte `0x01`; con solo
      x=7 nero dà `0x80`; la riga ha 48 byte (test).
- [ ] `job()` su un'immagine 384xH contiene esattamente H pacchetti riga, un comando di avanzamento
      alla fine, e nessun pacchetto supera la dimensione massima dichiarata (test).
- [ ] I livelli di intensità 0..4 delle impostazioni producono valori di energia crescenti e dentro
      l'intervallo documentato nel codice (test).
- [ ] `PrinterDevice` e `AppSettings` hanno il tipo di stampante con default `ESC_POS_SPP`;
      `docs/ARCHITECTURE.md` riporta i contratti nuovi.
- [ ] Il manifest dichiara `BLUETOOTH_SCAN` con `neverForLocation` e `ACCESS_FINE_LOCATION` con `maxSdkVersion="30"`.
- [ ] Tutte le stringhe nuove esistono con le stesse chiavi in `values/` e `values-it/`.
- [ ] Il percorso ESC/POS SPP non cambia comportamento: i test esistenti di `core-thermal` passano invariati.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` è verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
grep -n 'BLUETOOTH_SCAN' app/src/main/AndroidManifest.xml
grep -c '<string name="prn_' app/src/main/res/values/strings_printer.xml app/src/main/res/values-it/strings_printer.xml
```

## Fuori dalla CI

Prova su una stampante reale (GB01 o MX05): scansione, scelta, pagina di prova, foto Polaroid e
Striscia, interruzione del Bluetooth a metà stampa. Annota modello e firmware nella PR.

## Commit

feat(printer): supporto alle stampanti BLE "cat printer" (GB01/MX05)
