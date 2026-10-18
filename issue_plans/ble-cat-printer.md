# Piano: driver per le stampanti BLE "cat printer" (GB01/MX05 e simili)

## Obiettivo

Far stampare FotoFlash, nell'app e nella PWA, anche sulle mini stampanti termiche **Bluetooth Low
Energy** a protocollo proprietario: famiglie GB01/GB02/GB03, MX05/MX06/MX10, YT01 e cloni, le più
diffuse tra le "fotocamere per bambini" e i regali economici. Diventano un **driver** in più
(`cat-ble`) dell'interfaccia di `docs/DRIVERS.md`: niente rami speciali nel resto dell'app.

## Contesto

- **Cosa c'è già** (lavoro dei driver, vedi `docs/DRIVERS.md`):
  - interfaccia `PrinterDriver` in Kotlin (`core-thermal/.../Drivers.kt`) e in JS
    (`web/src/printer/drivers/`), con i vettori golden condivisi in `web/tests/fixtures/drivers-golden.json`;
  - su Android `BleGattTransport` (MTU, scritture serializzate, con o senza conferma) e la ricerca BLE
    (`PrinterManager.startBleScan`, permessi `BLUETOOTH_SCAN`/posizione già nel manifest);
  - sul web `ble.js` riconosce il servizio `AE30` e **rifiuta** queste stampanti con l'`errorCode`
    `'cat-printer'` (`BLE_CAT_SERVICE`); `PrinterManager` lo traduce nel failure `CAT_PRINTER`.
  - Il vecchio contratto proposto da questo piano (`PrinterKind`, `AppSettings.printerKind`,
    `scanBlePrinters()`) è **superato**: il tipo di stampante è `printerDriver` più `printerLink`.
- **Protocollo**, noto solo da implementazioni open source. Verifica ogni valore su almeno **due**
  fonti, [rbaron/catprinter](https://github.com/rbaron/catprinter) e
  [NaitLee/Cat-Printer](https://github.com/NaitLee/Cat-Printer), e cita la fonte in un commento:
  - GATT: servizio `0000ae30-0000-1000-8000-00805f9b34fb`, scrittura `ae01` (senza conferma),
    notifiche `ae02`. Su macOS rbaron vede a volte `af30`: tienilo tra gli `optionalServices` del web.
  - Pacchetto: `0x51 0x78 CMD 0x00 LEN_LO LEN_HI DATI… CRC8 0xFF`. Il CRC-8 ha polinomio `0x07`,
    valore iniziale `0x00` ed è calcolato **solo sui DATI** (CRC-8/SMBUS: il check di `"123456789"`
    vale `0xF4`).
  - Comandi: riga di bitmap `0xA2` (48 byte per 384 punti), intensità `0xAF` (16 bit), applica
    l'intensità `0xBE`, qualità `0xA4`, inizio e fine "lattice" `0xA6`, stato `0xA3`.
  - **Fonti in disaccordo, da risolvere prima di scrivere i test**: l'avanzamento carta è `0xA1` con 2
    byte little endian per NaitLee, mentre rbaron chiama "feed" `0xBD`, che per NaitLee è la
    velocità. Anche l'ordine dei byte dell'intensità `0xAF` differisce: little endian per NaitLee, big
    endian per rbaron. Alcuni modelli recenti vogliono il prefisso `0x12` prima del primo comando
    (NaitLee, `start_printing_new`). Se le fonti contraddicono un valore di questo piano, vincono le
    fonti: correggi piano e criteri nello stesso lavoro e spiegalo nella PR.
  - Ordine dei bit: nelle righe di bitmap il punto più a **sinistra** è il bit **meno**
    significativo di ogni byte, l'opposto di ESC/POS e di `BitImage`.
  - rbaron usa anche una riga compressa a lunghezza di serie (`0xBF`) quando conviene: è facoltativa,
    in questo piano si usa solo `0xA2`.
  - **Controllo di flusso**: buffer piccoli. La stampante notifica su `ae02` quando è occupata e
    quando può riprendere. L'invio va sospeso e ripreso, oltre alle pause di `TransportHints`.
- Larghezza: 384 punti (58 mm, 203 dpi), `PaperWidth.MM58`. Per queste stampanti la carta da 80 mm
  non esiste.

**Contratti toccati** (aggiorna `docs/DRIVERS.md`, `docs/ARCHITECTURE.md`, `docs/WEB.md` e tutti i
chiamanti nello stesso lavoro):
- un driver nuovo `cat-ble` in `PrinterDrivers.all` e in `drivers`, con `links = {BLE}` e un
  `bleProfiles` con `AE30/AE01/AE02`;
- `guess()` / `guessDriver()` riconoscono i nomi `GB0`, `MX0`, `MX1`, `YT0` (prefissi);
- il controllo di flusso richiede che il trasporto ascolti le notifiche. Va aggiunto a
  `BleGattTransport` e a `ble.js` in modo generico (un callback per le notifiche del profilo), così
  lo riusa anche `issue_plans/phomemo-paper-status.md`.

## Task

1. `core-thermal`: `CatPrinterProtocol.kt` (object) con `crc8(data)`, `packet(cmd, data)`,
   `bitmapRow(image: BitImage, y: Int): ByteArray` (bit invertiti), `feed(dots)`, `energy(level)`;
   driver `CatBleDriver` (`cat-ble`) in `Drivers.kt` che usa il protocollo in `encode()` (preambolo,
   righe, avanzamento) e `testPage()` raster.
2. `core-thermal`: test `CatPrinterProtocolTest.kt` (vedi criteri) e casi `cat-ble` nel confronto golden.
3. `web/src/printer/drivers/cat.js`: lo stesso driver in JS, registrato in `drivers`; test
   `web/tests/driver-cat.test.mjs` con gli stessi valori; nuovi casi in `drivers-golden.json`
   (`cat-ble` con `checker8` 100×300 e con `solid`), rigenerati dai test.
4. `web/src/printer/ble.js`: il servizio `AE30` non è più un rifiuto ma il profilo del driver
   `cat-ble`. `errorCode` `'cat-printer'` e failure `CAT_PRINTER` restano solo se il driver non c'è.
   Notifiche di `ae02` → pausa e ripresa dell'invio.
5. Android `printer/BleGattTransport.kt`: abilitazione delle notifiche (`setCharacteristicNotification`
   + descrittore CCCD `00002902-…`) e sospensione dell'invio quando la stampante dice "occupata";
   `BleScanner` con il filtro sul servizio `AE30`.
6. Testi: messaggi nuovi in `strings_printer.xml` (IT/EN, `prn_`) e in `web/src/i18n/strings/printer.js`;
   tolto o riscritto il messaggio "cat printer non supportata".
7. `docs/DRIVERS.md` (riga della tabella, sezione del protocollo con le fonti), `README.md` (tabella
   *Stampanti compatibili*: da «Non ancora» a «sperimentale», e a supportata solo dopo la prova su
   carta, perché le fonti non concordano su tutto; `AGENTS.md`, § 3 ter), `CHANGELOG.md`, `docs/ROADMAP.md`.

## File coinvolti

`core-thermal/src/main/kotlin/io/github/nik2208/fotoflash/thermal/CatPrinterProtocol.kt` (nuovo),
`core-thermal/src/main/kotlin/io/github/nik2208/fotoflash/thermal/Drivers.kt`,
`core-thermal/src/test/kotlin/io/github/nik2208/fotoflash/thermal/CatPrinterProtocolTest.kt` (nuovo),
`web/src/printer/drivers/cat.js` (nuovo), `web/src/printer/drivers/index.js`, `web/src/printer/ble.js`,
`web/tests/driver-cat.test.mjs` (nuovo), `web/tests/fixtures/drivers-golden.json`,
`app/src/main/java/io/github/nik2208/fotoflash/printer/BleGattTransport.kt`, `printer/BleScanner.kt`,
`res/values*/strings_printer.xml`, `web/src/i18n/strings/printer.js`, `web/sw.js` (precache del modulo nuovo),
`docs/DRIVERS.md`, `docs/ARCHITECTURE.md`, `docs/WEB.md`, `README.md`, `CHANGELOG.md`, `docs/ROADMAP.md`.

## Acceptance Criteria

- [ ] `CatPrinterProtocol.crc8("123456789".toByteArray())` vale `0xF4` (test Kotlin e JS).
- [ ] `packet(cmd, data)` produce `0x51 0x78 cmd 0x00 lenLo lenHi data crc 0xFF`, con lunghezza in
      little endian, verificato per un payload vuoto, di 1 byte e di 300 byte (test).
- [ ] `bitmapRow` di un'immagine 384×1 con solo il punto x=0 nero dà un primo byte `0x01`; con solo
      x=7 nero dà `0x80`; la riga ha 48 byte (test).
- [ ] `encode()` su un'immagine 384×H contiene esattamente H pacchetti riga e un comando di
      avanzamento alla fine; un'immagine più larga o più stretta viene centrata su 384 punti (test).
- [ ] I livelli di intensità 0..4 delle impostazioni producono valori di energia crescenti e dentro
      l'intervallo documentato nel codice, con l'ordine dei byte scelto e motivato (test).
- [ ] `guess("GB01")`, `guess("MX05")` e `guessDriver` lato JS danno `cat-ble`; i nomi Phomemo ed
      ESC/POS non cambiano driver (test).
- [ ] `drivers-golden.json` contiene i casi `cat-ble` e `DriversGoldenTest` li ritrova uguali in Kotlin.
- [ ] Le stringhe nuove esistono con le stesse chiavi in `values/` e `values-it/`, e in `en`/`it` di `printer.js`.
- [ ] I driver esistenti non cambiano byte: i loro casi golden restano identici.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` e
      `node --test web/tests/*.test.mjs` sono verdi.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
node --test web/tests/*.test.mjs
git diff --stat web/tests/fixtures/drivers-golden.json   # solo casi aggiunti
```

## Fuori dalla CI

Prova su una stampante reale (GB01 o MX05), dall'app e dalla PWA: ricerca, scelta, pagina di prova,
foto Polaroid e Striscia, stampa lunga (per il controllo di flusso), interruzione del Bluetooth a
metà stampa. Annota modello e firmware nella PR.

## Commit

feat(printer): driver per le stampanti BLE "cat printer" (GB01/MX05)
