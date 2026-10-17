# Piano: disegni e scritte a mano sulla foto

## Obiettivo

Nell'editor, una modalità **Disegna**: con il dito si tracciano linee sulla foto (baffi, cuori,
fumetti) e si possono appoggiare scritte grandi. Il disegno si stampa in **nero pieno**, mai retinato,
esattamente come appare nell'anteprima WYSIWYG.

## Contesto

- Editor: `app/.../editor/EditorScreen.kt` e `EditorViewModel.kt` (anteprima con debounce ~120 ms,
  `PrintCoordinator.buildRequest()` / `render()`). Rendering: `print/PrintRenderer.kt`.
- La rasterizzazione dei tratti è logica pura: va in `core-thermal`, testabile in JVM.
- Coordinate dei tratti **normalizzate** (0..1) rispetto al rettangolo della foto, così valgono per
  58 e 80 mm e per qualunque modello. Nella striscia e nel collage il disegno vale per la foto su cui
  è stato fatto (indice della foto).
- **Contratti toccati** (aggiorna `docs/ARCHITECTURE.md` e i chiamanti): nuovo file
  `core-thermal/.../Doodle.kt` con `data class DoodlePoint(val x: Float, val y: Float)`,
  `data class DoodleStroke(val photoIndex: Int, val points: List<DoodlePoint>, val widthDots: Int)`,
  `data class DoodleText(val photoIndex: Int, val text: String, val x: Float, val y: Float, val sizeDots: Int)`
  e `object DoodleRaster { fun draw(target: BitImage, photoRect: Rect, stroke: DoodleStroke) }`;
  `PrintRequest` acquista `doodles: List<DoodleStroke> = emptyList()` e
  `doodleTexts: List<DoodleText> = emptyList()` (`texts` esiste già: sono i `TemplateTexts`) con
  valori di default, quindi nessun chiamante esistente si rompe.

## Task

1. `core-thermal`: `Doodle.kt` con i tipi sopra e `DoodleRaster` (segmenti tra punti consecutivi con
   pennello circolare di diametro `widthDots`, clip al rettangolo della foto).
2. `core-thermal`: `DoodleRasterTest.kt`.
3. `model/Printing.kt`: campi nuovi di `PrintRequest` con default.
4. `PrintRenderer.kt`: dopo la retinatura della foto, applica tratti e scritte in nero pieno (le
   scritte con Space Mono Bold, come le didascalie, poi soglia).
5. Editor: pulsante "Disegna" che apre un pannello con tre spessori (S/M/L), Annulla, Cancella tutto,
   "Aa" per aggiungere una scritta (campo di testo, max 20 caratteri, trascinabile); i gesti con
   `pointerInput` e `detectDragGestures`; il disegno vive nello stato del ViewModel e sopravvive alla
   rotazione dello schermo.
6. Lo storico salva la stampa già disegnata (nessun cambio a `HistoryRepository`).
7. Stringhe `ed_doodle_*` in inglese e italiano; descrizioni di accessibilità per i pulsanti.
8. `docs/ARCHITECTURE.md`, `docs/SPEC.md` (sezione Editor), `CHANGELOG.md`.

## File coinvolti

`core-thermal/.../thermal/Doodle.kt` (nuovo), `core-thermal/src/test/.../DoodleRasterTest.kt` (nuovo),
`app/.../model/Printing.kt`, `app/.../print/PrintRenderer.kt`, `app/.../print/PrintCoordinator.kt`,
`app/.../editor/EditorScreen.kt`, `app/.../editor/EditorViewModel.kt`,
`res/values*/strings_editor.xml`, `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] Un tratto orizzontale da (0.1, 0.5) a (0.9, 0.5) con `widthDots = 4` su una foto 352x352 annerisce
      una banda alta 4±1 punti e lunga circa 282 punti, e niente fuori da essa (test).
- [ ] Un tratto che esce dalla foto viene tagliato al rettangolo della foto: nessun punto nero fuori (test).
- [ ] Un tratto di un solo punto disegna un disco di diametro `widthDots` (test).
- [ ] `PrintRequest` ha i nuovi campi con default vuoti: il codice esistente compila senza modifiche ai chiamanti che non disegnano.
- [ ] L'editor ha Disegna, tre spessori, Annulla, Cancella tutto e Scritta; tutte le etichette sono stringhe `ed_doodle_*` presenti in `values/` e `values-it/`.
- [ ] `docs/ARCHITECTURE.md` documenta i tipi e i contratti nuovi.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` è verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
grep -c 'ed_doodle_' app/src/main/res/values/strings_editor.xml app/src/main/res/values-it/strings_editor.xml
```

## Fuori dalla CI

Prova sul telefono: il tratto segue il dito senza ritardi, l'anteprima e la stampa coincidono.

## Commit

feat(editor): disegni e scritte a mano sulla foto
