# Piano: driver Phomemo M02X

## Obiettivo

Far stampare FotoFlash, nell'app e nella PWA, sulla **Phomemo M02X**. Oggi la stampante viene
riconosciuta dal nome e segnalata come non supportata, perché il suo protocollo somiglia a quello
della M02 ma **non è compatibile**. Diventa un driver nuovo, `phomemo-m02x`, dell'interfaccia di
`docs/DRIVERS.md`.

## Contesto

- **Stato attuale**: `PrinterDrivers.guess("M02X")` e `guessDriver("M02X")` restituiscono `null`, e
  la UI mostra l'avviso «non supportata». I driver `phomemo-m02`/`phomemo-m02pro` **non** vanno usati
  sulla M02X. Parte dei loro comandi viene ignorata: init `1F 11 02 04`, allineamento `1B 61`, coda
  `1F 11 08/0E/07/09`. Su quest'ultima la fonte non è coerente: la dice ignorata, ma `1F 11 08` compare
  anche nel suo preambolo e riceve una risposta (`1A 04`). Il driver M02X segue comunque la sequenza
  catturata, che dopo il raster non invia nulla. Ai driver M02 mancano poi il preambolo e l'attesa
  della fine stampa, e staccarsi prima della notifica di fine fa perdere le ultime righe.
- **Fonte unica**: [sgrankin/phomemo, PROTOCOL.md](https://github.com/sgrankin/phomemo/blob/main/PROTOCOL.md),
  § *M02X protocol*. È ricavata da una cattura del traffico dell'app iOS ufficiale e verificata
  stampando. Con una sola fonte, ogni scelta del driver cita quel paragrafo in un commento, e ciò che
  la fonte non dice resta fuori.
- **Riconoscimento**: la M02X espone lo stesso servizio `FF00` (`FF01`/`FF02`/`FF03`) delle altre
  Phomemo e annuncia il nome `M02X`. Solo il nome la distingue.
- **Differenze dalla famiglia M02**, secondo la fonte:

| | `phomemo-m02` (oggi) | M02X |
|---|---|---|
| Preambolo | — | pacchetti separati, a ~50 ms l'uno dall'altro: `1F 11 08`, `1F 11 37 64`, `AA AB AC 02`, `1F 11 0B` |
| Init e densità | `1B 40`, `1B 61 01`, `1F 11 02 dd` (predefinito 4) | `1B 40`, `1F 11 02 02`: **sempre `02`**, il valore dell'app iOS. Per la fonte `1F 11 02 04` viene ignorato, e non documenta altri valori |
| Allineamento `1B 61` | inviato | ignorato: non va inviato |
| Raster | `GS v 0` a blocchi di ≤ 255 righe | **un solo** `GS v 0` con l'altezza intera: `1D 76 30 00 30 00 lL lH` + dati |
| Larghezza | 384 punti = 48 byte, 203 dpi | uguale |
| Coda | `1B 64 nn` + `1F 11 08/0E/07/09` | **nessuna**: la stampante avanza da sola |
| Fine lavoro | `finalDelayMs` | aspettare la notifica **`1A 0F 0C`** (circa 2 s dopo l'ultimo byte), con un timeout di almeno 30 s. Staccarsi prima fa perdere le ultime righe |
| Invio | 20 B / 15 ms senza conferma (web) | senza conferma, pezzi ≤ 182 B, pausa 30-60 ms (l'app iOS usa ~30 ms) |

- **Comandi pericolosi**, da non inviare mai sulla M02X:
  - `1B 4E 04 nn`, la densità in stile M110: blocca la stampante fino al riavvio. Quindi il driver
    ignora `printerSpeed` e non invia comandi `1B 4E`;
  - `1F 11 NN` con `NN` da `0x15` in su, salvo i comandi del preambolo catturati dall'app ufficiale.
    Una scansione di quei codici ha reso inutilizzabile la stampante dell'autore della fonte (vedi
    `AGENTS.md`, § 3 ter).
- **Velocità sul web.** Web Bluetooth non espone l'MTU, quindi 20 byte restano il default sicuro
  anche qui. La pausa va tarata perché la velocità media resti in quella della fonte, cioè 182 byte
  ogni 30-60 ms, circa 3-6 KB/s. Una pausa da 60 ms ogni 20 byte sarebbe sicura, ma una foto
  impiegherebbe minuti.

**Contratti toccati** (aggiorna `docs/DRIVERS.md`, `docs/ARCHITECTURE.md`, `docs/WEB.md` e tutti i
chiamanti nello stesso lavoro):
- un driver nuovo `phomemo-m02x` in `PrinterDrivers.all` e in `drivers`;
- `guess("M02X")` → `phomemo-m02x`, e la UI non mostra più l'avviso;
- **confini dei pacchetti**: oggi sul web i pacchetti di `encode()` vengono concatenati prima di
  `Ble.print`, quindi le pause del preambolo andrebbero perse. Serve un campo di `TransportHints`
  (per esempio `packetDelayMs`) rispettato da `BleGattTransport` e da `ble.js` tra un pacchetto e
  l'altro;
- **attesa della fine stampa**: `TransportHints` acquista un modo per dire «aspetta questa notifica
  prima di chiudere» (per esempio `completeOn: ByteArray?` e `completeTimeoutMs`). Il trasporto deve
  quindi ascoltare le notifiche. È la stessa infrastruttura di `issue_plans/phomemo-paper-status.md`
  e del controllo di flusso di `issue_plans/ble-cat-printer.md`: va fatta una volta sola.

## Task

1. `core-thermal/Drivers.kt`: `phomemo-m02x` (`PaperWidth.MM58`, 203 dpi, `links = {BLE}`, profilo
   `FF00/FF02`, retino Floyd-Steinberg), con `encode()` nella sequenza della tabella: preambolo in
   pacchetti separati, poi un pacchetto `1B 40` + `1F 11 02 02` + un unico `GS v 0`. La densità è
   fissa: `phomemoDensity`, `heatLevel` e `printerSpeed` non cambiano i byte della M02X, perché la
   fonte non documenta altri valori (vedi *Contesto*). La schermata Stampante nasconde densità, intensità
   e velocità, o dice che sulla M02X non hanno effetto. `testPage()` raster, come le altre Phomemo.
2. `core-thermal`: `TransportHints` con i campi nuovi e i loro default, che non cambiano nulla per
   i driver esistenti; funzione pura `isPrintComplete(notification: ByteArray): Boolean`.
3. `web/src/printer/drivers/phomemo.js` (o `phomemo-m02x.js`): lo stesso driver in JS, registrato in
   `drivers`, con la stessa `isPrintComplete`.
4. Trasporti: `BleGattTransport` (Android) e `ble.js` (web) rispettano `packetDelayMs` e, se c'è
   `completeOn`, si iscrivono alle notifiche del servizio `FF00` e chiudono solo all'arrivo della
   notifica o allo scadere del timeout. Il timeout dà un esito chiaro, non un successo silenzioso.
5. Test: Kotlin (`DriversTest` o un test nuovo) e JS (`web/tests/driver-*.test.mjs`) con i byte
   esatti; casi `phomemo-m02x` nel golden.
6. Testi: via l'avviso «M02X non supportata» (chiavi `prn_` Android e web); un messaggio per il
   timeout della notifica di fine stampa.
7. `docs/DRIVERS.md`, `README.md`, `docs/SPEC.md`, `CHANGELOG.md`, `docs/ROADMAP.md`. In *Stampanti
   compatibili* la M02X passa da «No» a «sperimentale». Diventa supportata solo dopo la prova su carta,
   perché la fonte è una sola (`AGENTS.md`, § 3 ter).

## File coinvolti

`core-thermal/src/main/kotlin/io/github/nik2208/fotoflash/thermal/Drivers.kt`,
`core-thermal/src/test/kotlin/io/github/nik2208/fotoflash/thermal/DriversTest.kt`,
`web/src/printer/drivers/*.js`, `web/src/printer/ble.js`, `web/src/printer/manager.js`,
`web/tests/driver-*.test.mjs`, `web/tests/fixtures/drivers-golden.json`,
`app/src/main/java/io/github/nik2208/fotoflash/printer/BleGattTransport.kt`, `printer/PrinterManager.kt`,
`printer/PrinterScreen.kt`, `res/values*/strings_printer.xml`, `web/src/i18n/strings/printer.js`,
`web/src/ui/screens/printer.js`, `docs/DRIVERS.md`, `docs/ARCHITECTURE.md`, `docs/WEB.md`, `README.md`,
`docs/SPEC.md`, `CHANGELOG.md`, `docs/ROADMAP.md`.

## Acceptance Criteria

- [ ] `guess("M02X")` e `guessDriver("M02X")` danno `phomemo-m02x`; `M02`, `M02 Pro`, `M02PRO` e
      `M02S` non cambiano driver (test Kotlin e JS).
- [ ] `encode()` di un'immagine 384×300 `checker8` produce, in ordine, i pacchetti `1F 11 08`,
      `1F 11 37 64`, `AA AB AC 02`, `1F 11 0B` e poi un pacchetto che inizia con
      `1B 40 1F 11 02 02 1D 76 30 00 30 00 2C 01`, seguito da 300 × 48 byte di dati (test).
- [ ] Con `heatLevel` 4, `densityOverride`/`density` 8 e `speed` 3 i pacchetti sono identici a quelli
      con le opzioni predefinite: la densità resta `1F 11 02 02` (test Kotlin e JS).
- [ ] Fuori dai dati raster nessun pacchetto contiene `1B 61`, `1B 64` o `1B 4E`. Dopo il raster non
      c'è nessun `1F 11`. Gli unici `1F 11 NN` sono quelli della tabella. Il test scorre tutti i
      pacchetti, con e senza `printerSpeed`, saltando i byte dei dati.
- [ ] Un'immagine più larga o più stretta di 384 punti viene centrata o ritagliata come negli altri driver (test).
- [ ] `isPrintComplete` riconosce `1A 0F 0C` e rifiuta `1A 0F`, `1A 06 88` e una notifica vuota
      (test Kotlin e JS, stessi vettori).
- [ ] I driver esistenti producono gli stessi byte: i loro casi golden non cambiano.
      `drivers-golden.json` contiene i casi `phomemo-m02x`, e `DriversGoldenTest` li ritrova uguali.
- [ ] Con un trasporto finto, il lavoro non si chiude prima della notifica `1A 0F 0C`; senza
      notifica, finisce allo scadere del timeout con un esito di errore (test JS con un BLE finto).
- [ ] Stringhe con le stesse chiavi in IT/EN (Android e web).
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` e
      `node --test web/tests/*.test.mjs` sono verdi.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
node --test web/tests/*.test.mjs
```

## Fuori dalla CI

Serve una M02X vera, dall'app e dalla PWA: pagina di prova, foto lunga (oltre 255 righe, per
verificare il blocco unico), attesa della notifica di fine stampa e taratura della pausa sul web,
partendo da 20 byte con 30 ms e scendendo finché la stampa resta intera. Annota firmware e valori
nella PR e in `docs/DRIVERS.md`. **Non** provare comandi diversi da quelli della tabella.

## Commit

feat(printer): driver per la Phomemo M02X
