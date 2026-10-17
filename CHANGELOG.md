# Changelog

Tutte le modifiche rilevanti a FotoFlash sono registrate qui.
Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e le versioni seguono
[Semantic Versioning](https://semver.org/lang/it/); il numero lo calcola `bump-version.yml` dai
commit (vedi README, *Rilasci e versioni*).

Ogni PR aggiunge le sue righe sotto `## [Unreleased]`. Prima della PR di rilascio `dev → main`,
rinomina quella sezione in `## [X.Y.Z] - AAAA-MM-GG` e aprine una nuova vuota: la release usa la
sezione della sua versione, oppure `[Unreleased]` se non la trova.

## [Unreleased]

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
