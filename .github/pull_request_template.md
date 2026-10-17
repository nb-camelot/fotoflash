## Cosa cambia

<!-- Due righe: cosa fa questa PR e perche. Il titolo resta in stile conventional commit
     (feat:, fix:, perf:, docs:, refactor:, test:, chore:): decide il bump di versione. -->

<!-- La parola chiave va in inglese ("Closes", "Fixes"): "Chiude" non chiude nulla. Chiude l'issue
     solo il merge nel branch di default; con le PR verso dev serve dev come branch di default. -->
Closes #

## Come l'ho verificato

<!-- Test aggiunti o aggiornati, build della CI, prova su telefono e stampante (modello). -->

## Checklist

- [ ] Ho letto `AGENTS.md`; i contratti di `docs/ARCHITECTURE.md` sono invariati, oppure li ho aggiornati insieme a tutti i chiamanti
- [ ] Testi solo in risorse: stesse chiavi in `res/values` (inglese) e `res/values-it` (italiano), con il prefisso dell'area
- [ ] Nessuna dipendenza nuova (o, se proprio serve, catalogo e `docs/ARCHITECTURE.md` aggiornati e motivati qui sopra)
- [ ] Il check **Build e test** e verde (`:core-thermal:test :app:testDebugUnitTest :app:assembleDebug`)
- [ ] Logica nuova in `core-thermal` coperta da test JUnit
- [ ] Niente modifiche a `.github/`, `signing/` o alle righe `VERSION_*` di `gradle.properties`
- [ ] `CHANGELOG.md` aggiornato nella sezione `[Unreleased]`
- [ ] Per la UI: provata in tema chiaro e scuro, testi lunghi in italiano compresi
