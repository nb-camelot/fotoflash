# Piano: collage 2x2

## Obiettivo

Un modello **Collage**: quattro scatti in una griglia 2x2 su una stampa quasi quadrata, con titolo
dell'evento sopra e data sotto. In fotocamera una modalità **Collage** che scatta quattro foto di fila
(come la Striscia) e apre l'editor già sul modello giusto. Dalla galleria si possono scegliere fino a
quattro foto.

## Contesto

- Modelli in `core-thermal` (`TemplateKind` in `Model.kt`, impaginazione in `TemplateGeometry.kt`,
  `photoCount()`), rendering in `print/PrintRenderer.kt`, chip dei modelli nell'editor.
- La Striscia fa già la sequenza di scatti con conto alla rovescia: `camera/CameraViewModel.kt` e
  `CaptureSession.set(photos, source, suggestedTemplate)`. Il collage riusa lo stesso meccanismo con 4 scatti.
- Misure a 384 punti (scalate di 1.5 a 576): margini laterali 12, spazio tra le celle 8, celle
  quadrate da 176x176, titolo evento sopra (Righteous) e riga con data/hashtag sotto (Space Mono).
- Con meno di quattro foto le celle si riempiono ripetendo le foto in ordine (1 → quattro volte la
  stessa, 2 → A B / B A, 3 → A B / C A): il modello è sempre selezionabile.
- **Contratti toccati** (aggiorna `docs/ARCHITECTURE.md`, `docs/SPEC.md` e i `when` esaustivi):
  `TemplateKind.COLLAGE`; `TemplateGeometry.photoCount(COLLAGE, n)` restituisce 4.

## Task

1. `Model.kt`: `TemplateKind.COLLAGE` con KDoc.
2. `TemplateGeometry.kt`: layout COLLAGE (4 rettangoli foto, titolo e piede facoltativi), funzione pura
   `collageSources(available: Int): List<Int>` che dà l'indice della foto per ciascuna cella.
3. `TemplateGeometryTest.kt`: casi del collage.
4. `PrintRenderer.kt`: usa `collageSources` per assegnare le foto alle celle.
5. Fotocamera: modalità **Collage** nel selettore (Foto · Striscia · Collage), sequenza da 4 scatti,
   `suggestedTemplate = COLLAGE`; import dalla galleria fino a 4 foto quando la modalità è Collage.
6. Editor: chip "Collage" con miniatura; impostazioni: modello predefinito selezionabile.
7. Stringhe `cam_*`, `ed_*`, `set_*` in inglese e italiano.
8. `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `CHANGELOG.md`.

## File coinvolti

`core-thermal/.../thermal/Model.kt`, `TemplateGeometry.kt`, `core-thermal/src/test/.../TemplateGeometryTest.kt`,
`app/.../print/PrintRenderer.kt`, `app/.../camera/CameraViewModel.kt`, `app/.../camera/` (schermata del mirino),
`app/.../camera/GalleryImport.kt`, `app/.../editor/EditorScreen.kt`, `app/.../settings/SettingsScreen.kt`,
`res/values*/strings_camera.xml`, `strings_editor.xml`, `strings_settings.xml`,
`docs/ARCHITECTURE.md`, `docs/SPEC.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] `layout(COLLAGE, MM58, 4, texts)` ha larghezza 384 e quattro foto 176x176 disposte 2x2 con margini
      12 e spazio 8, senza sovrapposizioni e dentro la carta (test).
- [ ] A `MM80` la larghezza è 576 e le celle sono 264x264 (test).
- [ ] Senza titolo e senza data non ci sono blocchi di testo e l'altezza è minore (test).
- [ ] `collageSources(1) == [0,0,0,0]`, `collageSources(2) == [0,1,1,0]`, `collageSources(3) == [0,1,2,0]`,
      `collageSources(4) == [0,1,2,3]` (test).
- [ ] `photoCount(COLLAGE, n)` vale 4 per ogni n da 1 a 10 (test).
- [ ] Il selettore della fotocamera ha la modalità Collage e l'editor il chip Collage; stringhe in `values/` e `values-it/`.
- [ ] `docs/ARCHITECTURE.md` e `docs/SPEC.md` descrivono il modello.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` è verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
grep -n 'COLLAGE' docs/ARCHITECTURE.md docs/SPEC.md
```

## Commit

feat(editor): modello Collage 2x2 e modalità di scatto da quattro foto
