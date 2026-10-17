# Piano: scorciatoia, tile e widget "Scatta e stampa"

## Obiettivo

Arrivare al mirino in modalità **stampa istantanea** con un tocco, senza cercare l'app: una
**scorciatoia** dell'icona (pressione lunga sull'icona → "Scatta e stampa"), una **tile** nelle
Impostazioni rapide e un **widget** 1x1 con il lampo del brand. La modalità vale solo per quella
sessione: non cambia l'impostazione "Stampa istantanea" salvata.

## Contesto

- Navigazione in `nav/FotoFlashNavHost.kt` (rotte `Routes.*`), avvio in `MainActivity.kt`
  (`launchMode` standard, tema di avvio con splash). Fotocamera in `camera/` (`CameraViewModel`).
- Stampa istantanea già esistente: `AppSettings.instantPrint` e `PrintCoordinator.quickPrint()`.
- Tutto senza dipendenze nuove: scorciatoie statiche (`res/xml/shortcuts.xml` + `meta-data`
  `android.app.shortcuts` sull'activity di avvio), `TileService` (API 24+, minSdk 26 va bene),
  `AppWidgetProvider` con `RemoteViews`.
- L'azione d'avvio è una stringa: `io.github.nik2208.fotoflash.action.QUICK_SNAP`.
- Attenzione al pacchetto: in `res/xml/shortcuts.xml` l'intent vuole `android:targetPackage` letterale
  (i segnaposto `${applicationId}` non funzionano nelle risorse), ma la build di debug ha il suffisso
  `.debug`. Serve una copia in `app/src/debug/res/xml/shortcuts.xml` con `io.github.nik2208.fotoflash.debug`;
  `android:targetClass` resta `io.github.nik2208.fotoflash.MainActivity` in entrambe.
- **Contratti toccati** (aggiorna `docs/ARCHITECTURE.md`): nuovo `LaunchMode { NORMAL, QUICK_SNAP }`
  con `fun launchModeFor(action: String?): LaunchMode` in Kotlin puro (file senza import `android.*`,
  così è testabile in JVM); `CaptureSession` (o un nuovo oggetto in `AppGraph`, documentato) porta il
  flag di sessione "stampa istantanea forzata".

## Task

1. `app/.../launch/LaunchMode.kt` (Kotlin puro) e il suo test in `app/src/test/...`.
2. `MainActivity.kt`: legge l'azione da `intent` in `onCreate` e `onNewIntent`, salta onboarding solo
   se già completato, apre il mirino con la stampa istantanea forzata per la sessione.
3. `res/xml/shortcuts.xml`: scorciatoia statica con `shortcutShortLabel`/`shortcutLongLabel` da
   stringhe, icona `ic_shortcut_quick_snap` (vector, adattiva) e intent con l'azione sopra.
4. `QuickSnapTileService.kt`: `onClick` avvia l'activity (su API 34+ con `startActivityAndCollapse`
   e `PendingIntent`, sotto con l'`Intent`), icona monocromatica del lampo.
5. `QuickSnapWidget.kt` + `res/xml/quick_snap_widget_info.xml` + layout `RemoteViews` 1x1 con
   anteprima (`previewImage`/`previewLayout`), colori del brand.
6. `AndroidManifest.xml`: `meta-data` delle scorciatoie, `service` della tile con
   `android.permission.BIND_QUICK_SETTINGS_TILE` ed `exported="true"`, `receiver` del widget.
7. Mirino: un piccolo badge "Stampa istantanea" quando la modalità è forzata, con un tocco per spegnerla.
8. Stringhe `cam_quick_*` in inglese e italiano; `README.md` (Funzionalità) e `CHANGELOG.md`.

## File coinvolti

`app/src/main/java/io/github/nik2208/fotoflash/launch/LaunchMode.kt` (nuovo),
`app/src/test/java/io/github/nik2208/fotoflash/launch/LaunchModeTest.kt` (nuovo),
`MainActivity.kt`, `nav/FotoFlashNavHost.kt`, `model/CaptureSession.kt`, `camera/*`,
`app/.../launch/QuickSnapTileService.kt`, `app/.../launch/QuickSnapWidget.kt` (nuovi),
`res/xml/shortcuts.xml`, `res/xml/quick_snap_widget_info.xml`, `res/layout/widget_quick_snap.xml`,
`res/drawable/ic_shortcut_quick_snap.xml` (nuovi), `AndroidManifest.xml`, `res/values*/strings_camera.xml`,
`docs/ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] `launchModeFor("io.github.nik2208.fotoflash.action.QUICK_SNAP") == QUICK_SNAP`,
      `launchModeFor(null) == NORMAL`, `launchModeFor("android.intent.action.MAIN") == NORMAL` (test JVM in `app`).
- [ ] `res/xml/shortcuts.xml` esiste, usa solo etichette `@string/cam_quick_*` e l'azione QUICK_SNAP.
- [ ] Il manifest dichiara la tile con `BIND_QUICK_SETTINGS_TILE`, il widget con
      `android.appwidget.action.APPWIDGET_UPDATE` e la `meta-data` `android.app.shortcuts`.
- [ ] L'impostazione salvata `instantPrint` non viene modificata dall'avvio rapido (il codice scrive solo lo stato di sessione).
- [ ] Le stringhe nuove esistono con le stesse chiavi in `values/` e `values-it/`.
- [ ] `docs/ARCHITECTURE.md` documenta `LaunchMode` e dove vive lo stato di sessione.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` è verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
grep -n 'QUICK_SNAP\|BIND_QUICK_SETTINGS_TILE\|android.app.shortcuts' app/src/main/AndroidManifest.xml app/src/main/res/xml/shortcuts.xml
```

## Fuori dalla CI

Sul telefono: pressione lunga sull'icona, tile aggiunta alle Impostazioni rapide, widget sulla home;
da app chiusa e da app aperta in un'altra schermata.

## Commit

feat(camera): scorciatoia, tile e widget "Scatta e stampa"
