# issue_plans — piani di lavoro per l'agente

Qui stanno i **piani**: documenti brevi che dicono a un agente (o a una persona) cosa fare, dove e
come verificare che è fatto. Ce ne sono di due tipi:

- **piani pronti**, scritti a mano per le voci della [roadmap](../docs/ROADMAP.md) (tabella sotto);
- **piani generati** dal flusso `/oc`: quando l'agente lavora su un'issue senza piano, il suo
  pianificatore scrive `issue_plans/opencode-issue-<n>.md` e lo committa sul branch. Restano qui come
  memoria del perché di ogni modifica.

## Usare un piano pronto

1. Apri un'issue con il modello **Funzionalità** e titolo conventional (es. `feat(editor): collage 2x2`).
2. Nel testo cita il piano, per esempio `Piano: issue_plans/collage-2x2.md`.
3. Nel campo *Affida all'agente* (o in un commento che comincia con `/oc`) scrivi `/oc`.

Il workflow riconosce il percorso `issue_plans/<nome>.md` nel comando, nel corpo dell'issue o in
quello della PR dell'agente (vale il primo trovato, in quest'ordine) e usa quel piano invece di
generarne uno; un `/oc` nudo in un commento basta. Si può anche partire a mano: Actions → OpenCode → *Run workflow* con la richiesta
`segui issue_plans/collage-2x2.md`.

| Piano | Cosa | Tipo |
|---|---|---|
| [`ble-cat-printer.md`](ble-cat-printer.md) | Driver per le stampanti BLE "cat printer" (GB01/MX05 e simili, servizio `AE30`) | agente + prova su stampante |
| [`phomemo-m02x.md`](phomemo-m02x.md) | Driver per la Phomemo M02X (protocollo diverso dalla M02) | agente + prova su stampante |
| [`phomemo-paper-status.md`](phomemo-paper-status.md) | Stato di carta e batteria delle Phomemo dalle notifiche BLE | agente + prova su stampante |
| [`sticker-mode.md`](sticker-mode.md) | Modalità adesivo con linea di taglio e retino "Contorni" | agente |
| [`doodle-captions.md`](doodle-captions.md) | Disegni e scritte a mano sulla foto | agente |
| [`receipt-qr.md`](receipt-qr.md) | QR code sullo scontrino con il link all'album dell'evento | agente |
| [`collage-2x2.md`](collage-2x2.md) | Modello Collage 2x2 e modalità di scatto da 4 foto | agente |
| [`seasonal-frames.md`](seasonal-frames.md) | Cornici stagionali con suggerimento automatico | agente |
| [`quick-print-shortcut.md`](quick-print-shortcut.md) | Scorciatoia, tile e widget "Scatta e stampa" | agente |
| [`renderer-instrumented-tests.md`](renderer-instrumented-tests.md) | Test strumentati del renderer su emulatore | misto: job CI a mano |
| [`landing-page.md`](landing-page.md) | Landing page su GitHub Pages dal brand sheet | misto: attivare Pages |
| [`play-store.md`](play-store.md) | Pubblicazione su Google Play (checklist) | misto: console Play |

## Formato

Lo stesso che usa il pianificatore del workflow, così piani pronti e generati si leggono allo stesso modo:

```markdown
# Piano: <titolo>
## Obiettivo          perché e cosa, in tre righe
## Contesto           cosa c'è già, vincoli tecnici, riferimenti
## Task               elenco numerato di passi atomici, ciascuno con i file
## File coinvolti     elenco dei file da creare o modificare
## Acceptance Criteria checklist "- [ ] ..." verificabile in CI
## Verifica           comandi da lanciare
## Fuori dalla CI     (facoltativa) cosa resta a una persona
## Commit             UNA riga: titolo conventional della PR
```

Regole per scrivere un buon piano:

- **Criteri verificabili in CI**: test JUnit in `core-thermal`, test JVM puri in `app`, build verde,
  file e risorse presenti (in inglese e in italiano). Niente criteri che richiedono un telefono o una
  stampante: quelli vanno in *Fuori dalla CI*.
- La logica va in `core-thermal` quando può: lì si testa senza Android.
- Un piano che tocca una stampante è un piano di **driver** (`docs/DRIVERS.md`): Kotlin, JavaScript e
  casi golden nello stesso lavoro (`AGENTS.md`, § 3 ter). Cita le fonti del protocollo e dichiara dove
  non concordano; la verifica sulla stampante vera va in *Fuori dalla CI*.
- Se il piano cambia un contratto di `docs/ARCHITECTURE.md`, lo dice esplicitamente e chiede di
  aggiornare il documento e tutti i chiamanti.
- Niente dipendenze nuove, salvo eccezione scritta e motivata nel piano stesso.
- La sezione **Commit** contiene solo il titolo: `feat(...)` per una funzione nuova (versione minore),
  `fix(...)` per una correzione (patch). Il workflow lo usa come titolo della PR e del commit di squash.
