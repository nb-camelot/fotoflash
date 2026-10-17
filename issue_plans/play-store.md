# Piano: pubblicazione su Google Play (checklist)

## Obiettivo

Preparare tutto ciò che serve per pubblicare FotoFlash su Google Play, dentro il repository: testi
della scheda in italiano e inglese, informativa sulla privacy, risposte per la sezione *Sicurezza dei
dati*, motivazione dei permessi e una checklist per la persona che farà i passi nella Play Console.

## Contesto

- FotoFlash non ha server, account, pubblicità né analytics: le foto restano sul telefono (storico in
  `filesDir`, salvataggio in `Pictures/FotoFlash` solo su richiesta, condivisione solo su richiesta).
  Verifica queste affermazioni sul codice prima di scriverle (`history/`, `print/Exporter.kt`, manifest).
- Permessi dichiarati: `CAMERA`, `BLUETOOTH_CONNECT` (e `BLUETOOTH`/`BLUETOOTH_ADMIN` fino ad
  Android 11), `VIBRATE`, `WRITE_EXTERNAL_STORAGE` fino ad Android 9.
- `targetSdk` 35 soddisfa il requisito attuale di Play; `applicationId` `io.github.nik2208.fotoflash`.
- Formato dei metadati: struttura di `fastlane supply` (solo i file di testo, **senza** aggiungere
  fastlane al progetto), così un domani si può automatizzare il caricamento.
- Limiti di Play: titolo 30 caratteri, descrizione breve 80, descrizione completa 4000, note di
  versione 500 per lingua.
- Play richiede un **Android App Bundle** (`bundleRelease`). La release su GitHub oggi produce un APK
  e `release.yml` non si tocca dall'agente: la modifica la fa una persona (sezione *Fuori dalla CI*).

## Task

1. `fastlane/metadata/android/it-IT/` e `fastlane/metadata/android/en-US/`: `title.txt`,
   `short_description.txt`, `full_description.txt`, `changelogs/default.txt`; testi coerenti con il
   brand e con `README.md` (niente promesse non vere: stampanti BLE solo quando supportate).
2. `docs/privacy.md` (italiano) e `docs/privacy.en.md`: titolare (Nicola Brecciaroli), cosa tratta l'app,
   cosa non raccoglie, permessi e perché, conservazione locale, contatti tramite issue GitHub, data.
3. `docs/play/data-safety.md`: risposte proposte alla sezione *Sicurezza dei dati* (nessun dato
   raccolto né condiviso), con il riferimento al codice che le giustifica.
4. `docs/play/permissions.md`: motivazione di ogni permesso, pronta da incollare nella Console.
5. `docs/play/CHECKLIST.md`: passi nella Console, in ordine (account sviluppatore, creazione app,
   Play App Signing con la chiave attuale come chiave di caricamento, scheda, classificazione dei
   contenuti, pubblico di destinazione e app per famiglie, sicurezza dei dati, test interno →
   chiuso → produzione), ciascuno con il file del repo da cui copiare.
6. `README.md` (sezione Installazione: "presto su Google Play" solo come nota) e `CHANGELOG.md`.

## File coinvolti

`fastlane/metadata/android/it-IT/*`, `fastlane/metadata/android/en-US/*`, `docs/privacy.md`,
`docs/privacy.en.md`, `docs/play/data-safety.md`, `docs/play/permissions.md`, `docs/play/CHECKLIST.md`
(nuovi), `README.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] Per entrambe le lingue esistono `title.txt`, `short_description.txt`, `full_description.txt` e `changelogs/default.txt`.
- [ ] Limiti rispettati (`wc -m`, senza il ritorno a capo finale): titolo ≤ 30, descrizione breve ≤ 80,
      descrizione completa ≤ 4000, note ≤ 500.
- [ ] `docs/privacy.md` e `docs/privacy.en.md` citano ogni permesso del manifest e dicono che non ci
      sono raccolta, condivisione, pubblicità o analytics; ogni affermazione è coerente con il codice.
- [ ] `docs/play/CHECKLIST.md` copre: account, creazione app, Play App Signing, AAB, scheda, privacy,
      sicurezza dei dati, classificazione, pubblico e famiglie, tracce di test, produzione.
- [ ] Nessun file dell'app, del build o di `.github/` è modificato; nessuna dipendenza nuova.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` resta verde.

## Verifica

```bash
for l in it-IT en-US; do d=fastlane/metadata/android/$l
  printf '%s title=%s short=%s full=%s\n' "$l" "$(tr -d '\n' < $d/title.txt | wc -m)" \
    "$(tr -d '\n' < $d/short_description.txt | wc -m)" "$(wc -m < $d/full_description.txt)"; done
grep -n 'CAMERA\|BLUETOOTH' docs/privacy.md docs/privacy.en.md
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
```

## Fuori dalla CI

- Aggiungere a `release.yml` la build `:app:bundleRelease` firmata e l'allegato `.aab` alla Release.
- Account sviluppatore Google Play, compilazione della Console seguendo `docs/play/CHECKLIST.md`,
  screenshot dal telefono (mirino, editor, stampa reale), pubblicazione dell'informativa (per esempio
  con la landing page su GitHub Pages).

## Commit

docs(play): scheda, informativa privacy e checklist per Google Play
