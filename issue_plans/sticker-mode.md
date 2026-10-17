# Piano: modalità adesivo e retino "Contorni"

## Obiettivo

Stampare **adesivi** su rotoli termici adesivi da 57/58 mm: un modello `STICKER` con la foto dentro una
sagoma arrotondata, una **linea di taglio tratteggiata** attorno e la didascalia dentro la sagoma.
In più un quinto retino, **Contorni**, che trasforma la foto in un disegno a linee nere spesse: un
adesivo "da colorare", perfetto per i bambini.

## Contesto

- I modelli stanno in `core-thermal`: `TemplateKind` in `Model.kt`, impaginazione in
  `TemplateGeometry.kt` (tutto in punti, 384 a 58 mm e 576 a 80 mm), decorazioni in `Decoration`.
  Il rendering Android è `app/.../print/PrintRenderer.kt` (foto retinate a parte, testi e decorazioni
  in nero pieno, poi un'unica `BitImage`).
- I retini sono `DitherAlgorithm` in `Model.kt` e `Ditherer.kt`; l'editor li mostra come chip.
- **Contratti toccati** (aggiorna `docs/ARCHITECTURE.md` e tutti i `when` esaustivi nei chiamanti):
  `TemplateKind.STICKER`, `DitherAlgorithm.OUTLINE`, nuova decorazione
  `Decoration.DashedRoundRect(rect: Rect, radius: Int, dash: Int = 8, gap: Int = 6, thickness: Int = 2)`.
- Misure a 384 punti (scalate di 1.5 a 576 come gli altri modelli): margine esterno 8, linea di
  taglio a 8 dal bordo, sagoma con raggio 32, foto quadrata 320x320 centrata con 24 di respiro,
  didascalia sotto la foto dentro la sagoma, nessuna data.

## Task

1. `Model.kt`: aggiungi `TemplateKind.STICKER`, `DitherAlgorithm.OUTLINE` e `Decoration.DashedRoundRect`, con KDoc.
2. `Ditherer.kt`: `OUTLINE` = luminanza → sfocatura leggera 3x3 → gradiente di Sobel → soglia
   adattiva → linee ingrossate di 1 punto (dilatazione); le zone piatte restano bianche.
3. `TemplateGeometry.kt`: `STICKER` con una foto, il blocco `CAPTION` facoltativo e la decorazione
   `DashedRoundRect`; `photoCount(STICKER, n) == 1`.
4. `PrintRenderer.kt`: disegna `DashedRoundRect` (Path con archi, `DashPathEffect`) e ritaglia la foto
   alla sagoma arrotondata.
5. Editor: chip "Adesivo" tra i modelli e chip "Contorni" tra i retini; impostazioni: il nuovo retino
   è selezionabile come predefinito. Miniature e descrizioni coerenti con il brand.
6. Stringhe `ed_*` (e `set_*` se servono) in inglese e italiano.
7. Test, `docs/ARCHITECTURE.md`, `docs/SPEC.md` (tabella dei modelli), `CHANGELOG.md`.

## File coinvolti

`core-thermal/.../thermal/Model.kt`, `Ditherer.kt`, `TemplateGeometry.kt`,
`core-thermal/src/test/.../DithererTest.kt`, `TemplateGeometryTest.kt`,
`app/.../print/PrintRenderer.kt`, `app/.../editor/EditorScreen.kt`, `app/.../editor/EditorViewModel.kt`,
`app/.../settings/SettingsScreen.kt`, `res/values*/strings_editor.xml`, `res/values*/strings_settings.xml`,
`docs/ARCHITECTURE.md`, `docs/SPEC.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] `Ditherer.dither(img, OUTLINE)` su un'immagine uniforme (tutta grigia 128) è tutta bianca (test).
- [ ] Su un quadrato nero 40x40 al centro di un'immagine bianca 100x100, `OUTLINE` annerisce i punti
      del bordo del quadrato e lascia bianchi l'interno (a più di 4 punti dal bordo) e lo sfondo lontano (test).
- [ ] `TemplateGeometry.layout(STICKER, MM58, 1, texts)` ha larghezza 384, una foto quadrata interamente
      dentro il rettangolo della `DashedRoundRect`, e la didascalia (se presente) dentro la sagoma (test).
- [ ] Lo stesso layout a `MM80` ha larghezza 576 e le misure scalate (test).
- [ ] Didascalia vuota: nessun blocco di testo, altezza minore che con didascalia (test).
- [ ] Tutti i `when` su `TemplateKind`, `DitherAlgorithm` e `Decoration` gestiscono i valori nuovi (la build lo garantisce).
- [ ] Le stringhe nuove esistono con le stesse chiavi in `values/` e `values-it/`.
- [ ] `docs/ARCHITECTURE.md` e `docs/SPEC.md` descrivono modello, retino e decorazione nuovi.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` è verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
grep -n 'STICKER\|OUTLINE\|DashedRoundRect' docs/ARCHITECTURE.md
```

## Fuori dalla CI

Stampa su un rotolo adesivo reale: la linea di taglio deve essere visibile ma leggera, i contorni
spessi abbastanza da essere colorati con un pennarello.

## Commit

feat(editor): modalità adesivo con linea di taglio e retino Contorni
