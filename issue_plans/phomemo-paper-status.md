# Piano: stato della carta dalle Phomemo, letto dalle notifiche BLE

## Obiettivo

Mantenere il principio 4 della specifica («carta finita» detta chiaramente) anche sulle Phomemo.
Oggi una M02/M02 Pro senza carta riceve il lavoro, non stampa niente e FotoFlash mostra
«Stampato!». Prima di inviare il raster, FotoFlash chiede alla stampante lo stato della carta e
legge la risposta dalle **notifiche BLE**. Se la carta manca, si ferma con un errore chiaro e
l'azione per risolvere. Facoltativo: livello della batteria nella schermata Stampante.

## Contesto

- I driver Phomemo (`docs/DRIVERS.md`) chiudono già ogni lavoro con le interrogazioni `1F 11 08`,
  `1F 11 0E`, `1F 11 07` e `1F 11 09`, come l'app ufficiale. Le risposte arrivano come notifiche, e
  oggi nessuno le ascolta.
- **Formato delle risposte**: frame `1A TT VV…`, dove `TT` è il tipo e `VV` il valore. Fonti:
  [phomymo](https://github.com/transcriptionstream/phomymo) (`src/web/ble.js`, `handleNotification`),
  [sgrankin/phomemo](https://github.com/sgrankin/phomemo/blob/main/PROTOCOL.md) (§ *Status / sensor queries*)
  e [theacodes/phomemo_m02s](https://github.com/theacodes/phomemo_m02s) (`get_paper_state`).

| Domanda | Comando | Risposta | Significato | Accordo tra le fonti |
|---|---|---|---|---|
| Carta | `1F 11 11` | `1A 06 88` / `1A 06 89` | `88` = carta finita, `89` = carta presente | tre fonti concordi sul comando, due sui valori |
| Batteria | `1F 11 08` | `1A 04 NN` | livello: per phomymo è la batteria, con `A1`..`A4` tradotti in 10, 5, 3 e 0 e gli altri valori presi così come sono; sgrankin lo legge come percentuale solo nella tabella della M02X, mentre nella sezione della famiglia M02 chiama il comando «energy / heat», come theacodes («energia») | **significato e scala da verificare** sulla M02/M02 Pro |
| Coperchio | `1F 11 12` | `1A 05 98` / `1A 05 99` | **fonti opposte**: per phomymo `98` = aperto, per sgrankin `98` = chiuso | **da verificare** |
| Fine stampa | — | `1A 0F 0C` | lavoro stampato (osservato sulla M02X; phomymo lo tratta come stato di stampa) | da verificare su M02/M02 Pro |

- **Caratteristica delle notifiche**: anche qui le fonti non concordano. Per `docs/DRIVERS.md` e
  phomymo è `FF03`; per sgrankin le risposte arrivano su `FF01`, e `FF03` è «sconosciuta». Il
  trasporto si iscrive quindi a **tutte** le caratteristiche del servizio `FF00` che hanno la
  proprietà notify, e il parser accetta solo i frame che iniziano con `1A`. Quale caratteristica
  risponde davvero si annota in `docs/DRIVERS.md` dopo la prova.
- **Mai interrogazioni nuove.** Solo i comandi della tabella. Niente `1F 11 NN` con `NN` da `0x15` in
  su: una scansione di quei codici ha reso inutilizzabile una stampante (vedi `AGENTS.md`, § 3 ter).
  Anche `1F 11 13` va evitato: per theacodes legge il numero di serie, e sgrankin gli dà due
  significati secondo il modello, numero di serie nella famiglia M02 e temperatura nella tabella della
  M02X. Anche `1F 11 08` cambia significato, batteria sulla M02X ed energia/calore nella famiglia
  M02: per sgrankin i codici `1F 11` non sono intercambiabili tra un modello e l'altro.
- **Notifiche, API**:
  - web: `characteristic.startNotifications()` più l'evento `characteristicvaluechanged`. Il servizio
    `FF00` è già tra gli `optionalServices`;
  - Android: `gatt.setCharacteristicNotification(char, true)` e la scrittura del descrittore CCCD
    `00002902-0000-1000-8000-00805f9b34fb` con `BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE`.
    Su API 33+ `writeDescriptor(descriptor, value)`, sotto `descriptor.value` + `writeDescriptor(descriptor)`
    con `@Suppress("DEPRECATION")`. Vanno implementate entrambe le `onCharacteristicChanged`:
    quella con `value: ByteArray` (API 33+) e quella deprecata. La scrittura del descrittore è
    un'operazione GATT come le altre: va serializzata con le scritture.
- **Infrastruttura comune**: l'ascolto delle notifiche nei trasporti serve anche al controllo di
  flusso delle cat printer (`issue_plans/ble-cat-printer.md`) e alla fine stampa della M02X
  (`issue_plans/phomemo-m02x.md`). Chi arriva primo la scrive in modo generico, cioè un callback per
  le notifiche del profilo BLE corrente.

**Contratti toccati** (aggiorna `docs/DRIVERS.md`, `docs/ARCHITECTURE.md`, `docs/WEB.md` e tutti i
chiamanti nello stesso lavoro):
- `core-thermal`: `PhomemoStatus` (object) con le interrogazioni e
  `parse(notification: ByteArray): List<PrinterStatusEvent>`, dove `PrinterStatusEvent` è sealed:
  `Paper(present)`, `Battery(raw)`, `Cover(raw)`, `PrintDone`, `Unknown(type, value)`. Il gemello JS
  sta in `web/src/printer/drivers/`;
- `PrinterDriver` acquista, con implementazioni predefinite vuote, un controllo prima della stampa
  (i byte da inviare e il tempo massimo di attesa della risposta) e la lettura delle notifiche. Gli
  ESC/POS non cambiano;
- `PrintFailure` (Android, `model/Printing.kt`) e i failure del web acquistano **`PAPER_OUT`**. Ogni
  `when` esaustivo lo gestisce, e non è mai un errore di connessione.

## Task

1. `core-thermal`: `PhomemoStatus.kt` con interrogazioni, parser (più frame in una notifica, frame
   troncati e tipi sconosciuti senza eccezioni) e la decisione pura «stampare o fermarsi» data la
   lista di eventi ricevuti entro il tempo massimo; test.
2. JS: lo stesso modulo in `web/src/printer/drivers/` (registrato nella precache di `web/sw.js`), con
   test `web/tests/driver-phomemo-status.test.mjs` sugli stessi vettori.
3. Trasporti: `BleGattTransport` (Android) e `ble.js` (web) si iscrivono alle notifiche del servizio
   del profilo e le passano al chiamante. Un errore di iscrizione **non** blocca la stampa: si stampa
   come oggi.
4. `PrinterManager` (Android) e `manager.js` (web), solo per i driver che lo dichiarano: inviano
   `1F 11 11`, aspettano al massimo 1,5 s una risposta `1A 06`, e con `88` restituiscono
   `PAPER_OUT` senza inviare il raster. Senza risposta stampano lo stesso, perché un firmware che non
   risponde non deve bloccare nessuno.
5. UI: messaggio «Carta finita» con l'azione Riprova (Android `prn_`/`ed_`, web `printer.js`/`ed.js`);
   facoltativo, la batteria nella schermata Stampante, mostrata solo se il valore è una percentuale
   plausibile (0-100).
6. `docs/DRIVERS.md` (tabella delle risposte e caratteristica delle notifiche), `docs/SPEC.md`,
   `README.md` (sintomi in *Calibrazione*), `CHANGELOG.md`, `docs/ROADMAP.md`.

## File coinvolti

`core-thermal/src/main/kotlin/io/github/nik2208/fotoflash/thermal/PhomemoStatus.kt` (nuovo),
`core-thermal/src/main/kotlin/io/github/nik2208/fotoflash/thermal/Drivers.kt`,
`core-thermal/src/test/kotlin/io/github/nik2208/fotoflash/thermal/PhomemoStatusTest.kt` (nuovo),
`app/src/main/java/io/github/nik2208/fotoflash/model/Printing.kt`, `printer/BleGattTransport.kt`,
`printer/PrinterManager.kt`, `printer/PrinterScreen.kt`, `editor/*` (messaggio d'errore),
`res/values*/strings_printer.xml`, `res/values*/strings_editor.xml`,
`web/src/printer/drivers/*.js`, `web/src/printer/ble.js`, `web/src/printer/manager.js`, `web/sw.js`,
`web/src/i18n/strings/printer.js`, `web/src/i18n/strings/ed.js`, `web/tests/driver-phomemo-status.test.mjs` (nuovo),
`docs/DRIVERS.md`, `docs/ARCHITECTURE.md`, `docs/WEB.md`, `docs/SPEC.md`, `README.md`, `CHANGELOG.md`, `docs/ROADMAP.md`.

## Acceptance Criteria

- [ ] `parse` (Kotlin e JS, stessi vettori): `1A 06 88` → `Paper(false)`; `1A 06 89` → `Paper(true)`;
      `1A 04 3A` → `Battery(0x3A)`; `1A 0F 0C` → `PrintDone`; `1A 06 88 1A 04 3A` → due eventi;
      `1A 06` (troncato), `00 01 02` e una notifica vuota → nessun evento e nessuna eccezione;
      un tipo sconosciuto → `Unknown`.
- [ ] L'interrogazione della carta è esattamente `1F 11 11`. Nessun pacchetto prodotto da un driver
      Phomemo, nel lavoro o nel controllo, contiene `1F 11 NN` con `NN ≥ 0x15` o `1F 11 13` (test).
- [ ] La decisione pura: `Paper(false)` → fermati con `PAPER_OUT`; `Paper(true)` o nessuna
      risposta → stampa (test).
- [ ] Web: con un BLE finto che risponde `1A 06 88`, `PrinterManager.print` restituisce
      `{ ok: false, failure: 'PAPER_OUT' }` e non scrive il raster; senza risposta stampa come prima (test).
- [ ] `PrintFailure.PAPER_OUT` esiste ed è gestito in ogni `when` esaustivo; le stringhe nuove
      esistono con le stesse chiavi in IT/EN, su Android e sul web.
- [ ] I byte di `encode()` non cambiano: `drivers-golden.json` resta identico.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` e
      `node --test web/tests/*.test.mjs` sono verdi.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
node --test web/tests/*.test.mjs
git diff --exit-code web/tests/fixtures/drivers-golden.json
```

## Fuori dalla CI

Su una M02 e una M02 Pro vere, dall'app e dalla PWA, annota in `docs/DRIVERS.md`:
- quale caratteristica notifica (`FF01`, `FF03` o entrambe);
- i valori reali di carta presente e assente;
- coperchio aperto e chiuso (`98`/`99`);
- la scala della batteria;
- se arriva `1A 0F 0C` a fine stampa.

Poi prova a stampare senza rotolo: deve comparire «Carta finita» e non «Stampato!».

## Commit

feat(printer): stato della carta dalle stampanti Phomemo via notifiche BLE
