# Piano: cornici stagionali

## Obiettivo

Cornici decorative da festa attorno alla foto: **Natale**, **Halloween**, **Compleanno**, **Estate**
(più "Nessuna"). Disegnate a linee nere pulite, pensate per la carta termica, con un suggerimento
automatico in base alla data (a dicembre propone Natale). Si scelgono nell'editor e, come predefinita,
in Impostazioni → Evento.

## Contesto

- Rendering: `print/PrintRenderer.kt` disegna testi e decorazioni su un Canvas ARGB, poi soglia;
  le foto si retinano a parte. Le cornici sono grafica: vanno nel livello "testi e decorazioni"
  (nero pieno), mai retinate.
- La geometria (dove vanno gli ornamenti) e la scelta per data sono logica pura: in `core-thermal`.
- Gli ornamenti sono **vector drawable** in `res/drawable/frame_<tema>_*.xml` (angolo, motivo ripetuto
  lungo i lati), disegnati nello stile del brand (vedi `docs/brand/BRAND.md`): tratto spesso almeno 3
  punti a 58 mm, niente grigi, niente aree nere grandi (scaldano troppo la testina).
- Le cornici valgono per POLAROID, FULL e RECEIPT; la STRIP ha solo testata e piede decorati.
- **Contratti toccati** (aggiorna `docs/ARCHITECTURE.md` e i chiamanti): nuovo enum
  `FrameTheme { NONE, CHRISTMAS, HALLOWEEN, BIRTHDAY, SUMMER }` in `Model.kt`;
  `object FrameGeometry { fun ornaments(layout: TemplateLayout, theme: FrameTheme): List<Ornament> }`
  e `fun suggestFrame(month: Int, day: Int): FrameTheme` in `core-thermal`;
  `PrintRequest` acquista `frame: FrameTheme = FrameTheme.NONE`; `AppSettings` acquista
  `frame: FrameTheme = FrameTheme.NONE` e `autoFrame: Boolean = true`.

## Task

1. `core-thermal`: `FrameTheme`, `Ornament(kind, rect, rotation)` e `FrameGeometry` (quattro angoli
   + motivi ripetuti sui lati della foto, senza mai coprire la foto né i testi), `suggestFrame`.
2. `core-thermal`: `FrameGeometryTest.kt`.
3. `res/drawable/`: per ogni tema un ornamento d'angolo e un motivo da lato (8 file), in nero su trasparente.
4. `PrintRenderer.kt`: disegna gli ornamenti con `ContextCompat.getDrawable` → `setBounds` → `draw`,
   ruotati per gli angoli, nel livello in nero pieno.
5. Editor: riga di chip "Cornice" (Nessuna, Natale, Halloween, Compleanno, Estate) con miniature;
   preselezione con `suggestFrame` se `autoFrame` è attivo.
6. Impostazioni → Evento: cornice predefinita e interruttore "Suggerisci in base alla data".
7. Stringhe `ed_frame_*` e `set_frame_*` in inglese e italiano.
8. `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `CHANGELOG.md`.

## File coinvolti

`core-thermal/.../thermal/Model.kt`, `core-thermal/.../thermal/FrameGeometry.kt` (nuovo),
`core-thermal/src/test/.../FrameGeometryTest.kt` (nuovo), `app/src/main/res/drawable/frame_*.xml` (nuovi),
`app/.../print/PrintRenderer.kt`, `app/.../print/PrintCoordinator.kt`, `app/.../model/Printing.kt`,
`app/.../model/AppSettings.kt`, `app/.../data/SettingsRepository.kt`, `app/.../editor/*`,
`app/.../settings/*`, `res/values*/strings_editor.xml`, `strings_settings.xml`,
`docs/ARCHITECTURE.md`, `docs/SPEC.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] `suggestFrame(12, 10) == CHRISTMAS`, `suggestFrame(1, 5) == CHRISTMAS`, `suggestFrame(10, 31) == HALLOWEEN`,
      `suggestFrame(7, 15) == SUMMER`, `suggestFrame(3, 3) == NONE` (test; finestre di date documentate nel KDoc).
- [ ] Per ogni tema diverso da NONE e per POLAROID, FULL e RECEIPT a 58 e 80 mm, nessun ornamento
      interseca i rettangoli delle foto o dei testi e tutti stanno dentro la carta (test).
- [ ] `ornaments(layout, NONE)` è vuoto (test).
- [ ] Esistono i drawable `frame_christmas_*`, `frame_halloween_*`, `frame_birthday_*`, `frame_summer_*`
      (angolo e lato) referenziati dal renderer: la build fallisce se ne manca uno.
- [ ] `PrintRequest.frame` e le nuove impostazioni hanno default che lasciano invariate le stampe attuali.
- [ ] Le stringhe nuove esistono con le stesse chiavi in `values/` e `values-it/`.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` è verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
ls app/src/main/res/drawable/frame_*.xml
```

## Fuori dalla CI

Stampa una Polaroid per tema: gli ornamenti devono essere nitidi, senza puntinatura, e non
rallentare la stampa in modo evidente.

## Commit

feat(editor): cornici stagionali con suggerimento in base alla data
