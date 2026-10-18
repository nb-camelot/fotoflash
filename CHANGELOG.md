# Changelog

Tutte le modifiche rilevanti a FotoFlash sono registrate qui.
Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e le versioni seguono
[Semantic Versioning](https://semver.org/lang/it/); il numero lo calcola `bump-version.yml` dai
commit (vedi README, *Rilasci e versioni*).

Ogni PR aggiunge le sue righe sotto `## [Unreleased]`. Prima della PR di rilascio `dev → main`,
rinomina quella sezione in `## [X.Y.Z] - AAAA-MM-GG` e aprine una nuova vuota: la release usa la
sezione della sua versione, oppure `[Unreleased]` se non la trova.

## [Unreleased]

## [0.2.0] - 2026-10-18

### Added

- **Versione web (PWA)** su GitHub Pages ([nb-camelot.github.io/fotoflash](https://nb-camelot.github.io/fotoflash/)): scatto, modelli, regolazioni e storico come nell'app, stampa dal browser via Web Bluetooth (BLE), installabile e offline; zero dipendenze, test `node --test web/tests/*.test.mjs` anche nella CI (job *Web (PWA)*), build e deploy con `scripts/build-web.mjs` e `pages.yml`.
- **Stampanti intercambiabili tramite driver**, nell'app e nella PWA: `escpos-58`, `escpos-80`, `phomemo-m02` e `phomemo-m02pro`, con la stessa interfaccia in Kotlin (`core-thermal`) e in JavaScript (`web/src/printer/drivers/`). Il driver è riconosciuto dal nome annunciato dalla stampante e si cambia a mano; la larghezza della carta discende dal driver. Contratti e byte in `docs/DRIVERS.md`.
- **Phomemo M02 e M02 Pro**: protocollo Phomemo (init, densità `1F 11 02`, blocchi raster da 255 righe al massimo, avanzamento, coda di stato come l'app ufficiale), 384 punti a 203 dpi per la M02 e 576 punti a 300 dpi per la M02 Pro, retino Floyd-Steinberg proposto, densità 1-15, larghezza 72/78 byte, velocità sperimentale spenta di default. La M02X, che ha un protocollo diverso, viene riconosciuta e segnalata come non supportata.
- **Bluetooth LE nell'app Android**: ricerca dei dispositivi vicini (10 s) accanto a quelli accoppiati in SPP, trasporto GATT con MTU negoziato (`requestMtu(247)`) e scritture serializzate, anche per le ESC/POS che hanno un canale BLE. Permessi `BLUETOOTH_SCAN` (`neverForLocation`) su Android 12+ e posizione fino ad Android 11.
- **Calibrazione dell'invio BLE** con i preset *Automatica* (predefiniti del driver), *Sicura* (20 byte, 15 ms), *Veloce* (60 byte, 20 ms) e *Massima* (128 byte, 20 ms), invio senza conferma per le Phomemo con ripiego su quello con conferma. Sul web 20 byte sono il default, perché Web Bluetooth non espone l'MTU. Nell'app c'è anche l'invio *con conferma* (100 byte), predefinito per le ESC/POS in BLE.
- **Pagina di prova raster** per i driver Phomemo: scritta FOTOFLASH, bande di gradiente per ciascun retino, scala di grigi e parametri correnti.
- **Vettori golden condivisi** `web/tests/fixtures/drivers-golden.json`: generati dai test JS e verificati in Kotlin da `DriversGoldenTest`, garantiscono gli stessi byte da app e PWA.
- Piani pronti in `issue_plans/`: `phomemo-m02x.md` (driver M02X) e `phomemo-paper-status.md` (stato di carta, coperchio e batteria letto dalle notifiche); `ble-cat-printer.md` riscritto come driver.

### Changed

- La larghezza della carta discende dal driver: per le Phomemo la decide il driver, per le ESC/POS resta la scelta 58/80 mm (`escpos-58` / `escpos-80`). Una stampante già configurata continua in Bluetooth classico con il driver ESC/POS.

## [0.1.0] - 2026-10-17

### Fixed

- Revisione dei bug di runtime (106 finding verificati, 95 correzioni):
  - errori di composizione distinti da quelli della stampante (`RENDER_FAILED`);
  - nessun crash per memoria esaurita in scatto, rendering, salvataggio e condivisione;
  - numerazione delle stampe senza salti né doppioni, e nessuna voce doppia nello storico;
  - stampa istantanea che aspetta la stampante occupata invece di fallire;
  - fotocamera ricollegata se il cambio frontale/posteriore fallisce;
  - stato della stampante coerente con Bluetooth spento o acceso, permessi su Android 8-15, risincronizzazione dopo un raster interrotto;
  - contrasti del tema chiaro e accessibilità di chip e intestazioni;
  - workflow agentici corretti prima della prima esecuzione.
- CI: ogni APK di debug viene verificato con il certificato di `signing/debug.p12`, così gli aggiornamenti si installano senza disinstallare; la release (non firmata) si compila già su `dev`.

### Added

- **Controluce**: il soggetto scuro davanti a uno sfondo luminoso non diventa più una macchia sulla carta. Nuove regolazioni *Ombre* (curva che solleva solo i toni scuri), *Contrasto locale* (CLAHE con interpolazione bilineare tra le tessere) e *Controluce automatico* (riconosce il centro scuro contro il bordo chiaro e rinforza le altre due solo quando serve), attive di default in stampa e nell'anteprima dal vivo; con ombre e contrasto locale a 0 e controluce spento la stampa resta identica a prima.
- **Esportazione delle foto** in Galleria › FotoFlash › Scatti: gli scatti si salvano anche in galleria (impostazione *Salva gli scatti in galleria*, attiva di default), il dettaglio dello storico ha *Salva foto* (gli originali a colori, distinto da *Salva stampa*) e lo storico ha *Esporta tutte le foto*, in background con avanzamento e annullabile; gli originali nello storico ora restano a 2048 px, JPEG 92.
- App Android **FotoFlash** (`io.github.nik2208.fotoflash`, Android 8.0+): il telefono diventa una
  fotocamera istantanea che stampa su stampanti termiche ESC/POS Bluetooth da 58 e 80 mm.
- Modulo **`core-thermal`** in Kotlin puro, coperto da test JUnit: immagini in grigio e a 1 bit,
  regolazioni tonali (auto-livelli, luminosità, contrasto, gamma, nitidezza), retinatura Atkinson,
  Floyd-Steinberg, Bayer 8x8 e soglia, impaginazione dei modelli, comandi ESC/POS e lavori raster a
  bande (`GS v 0`).
- **Fotocamera** CameraX con anteprima termica dal vivo, flash, timer 0/3/10 s, cambio fotocamera,
  import dalla galleria, modalità Striscia da 3 o 4 scatti con conto alla rovescia e lampo, stampa
  istantanea.
- **Editor** con anteprima WYSIWYG su foglio di carta, modelli Polaroid, Pieno, Striscia e Scontrino,
  didascalia, evento, hashtag, data, numerazione, regolazioni e retino, da 1 a 5 copie, foglio di
  avanzamento con errori chiari e azioni (Riprova, Scegli stampante, Apri Bluetooth).
- **Stampante**: Bluetooth classico SPP con invio a blocchi e pause configurabili, connessione tenuta
  aperta tra stampe vicine, riconnessione automatica, pagina di prova, calibrazione avanzata
  (intensità, blocco, pausa, banda, avanzamento, taglio).
- **Storico** delle stampe con ristampa, condivisione, salvataggio in galleria ed eliminazione.
- **Impostazioni** per stampante, carta, immagine, evento e scatto; **onboarding** in tre schede con
  permessi e scelta della stampante.
- Brand FotoFlash: palette Ink/Paper/Flash, caratteri Righteous e Space Mono (OFL), icona adattiva,
  temi chiaro e scuro, mirino sempre scuro. Testi in inglese e italiano.
- Repository pronto per lo sviluppo autonomo: CI di build e test con *FotoFlash build report*,
  flusso agentico `/oc` (piano, build, verifica Gradle, review, PR verso `dev`, merge solo con review
  PASS e CI verde), bump di versione da conventional commit con build e test prima del tag, release
  con APK firmato e verifica del certificato, modelli di issue e PR, `AGENTS.md`, piani pronti in
  `issue_plans/`.

### Security

- Il flusso agentico autorizza in base al ruolo di chi scrive il comando, rifiuta PR da fork e branch
  protetti, gira con token in sola lettura senza credenziali git, separa push e merge in un job che
  non esegue il codice dell'agente, legge il verdetto dall'ultima riga della review e blocca OpenCode
  a una versione con SHA-256 verificato.
