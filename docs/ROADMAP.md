# FotoFlash — roadmap

Dove vogliamo portare FotoFlash dopo la prima versione. Ogni voce ha un piano pronto in
[`issue_plans/`](../issue_plans/): per farla realizzare all'agente basta aprire un'issue che cita il
piano e scrivere `/oc` (vedi [`issue_plans/README.md`](../issue_plans/README.md)).

Legenda: **agente** = realizzabile interamente con `/oc`; **misto** = l'agente fa il codice, una
persona fa un passo fuori dal repository (impostazioni, account, CI).

## 0.x — la fotocamera istantanea (in corso)

Quello che c'è oggi: scatto con anteprima termica, quattro modelli di stampa, stampa ESC/POS
Bluetooth calibrabile, storico, impostazioni, onboarding, brand completo. Vedi `CHANGELOG.md`.

## Prossimi passi

### Più stampanti

| Voce | Piano | Tipo |
|---|---|---|
| Stampanti **BLE "cat printer"** (GB01/GB02/GB03, MX05/MX06/MX10): protocollo proprietario su Bluetooth Low Energy, il tipo più diffuso tra le mini stampanti per bambini | [`ble-cat-printer.md`](../issue_plans/ble-cat-printer.md) | agente (prova finale su stampante reale) |

### Più divertimento sulla carta

| Voce | Piano | Tipo |
|---|---|---|
| **Modalità adesivo**: soggetto con contorno spesso e bordo da ritagliare, per carta adesiva | [`sticker-mode.md`](../issue_plans/sticker-mode.md) | agente |
| **Scritte e disegni a mano** sulla foto prima di stampare | [`doodle-captions.md`](../issue_plans/doodle-captions.md) | agente |
| **Collage 2x2**: quattro scatti in una stampa quadrata | [`collage-2x2.md`](../issue_plans/collage-2x2.md) | agente |
| **Cornici stagionali** (Natale, Halloween, compleanno, estate) | [`seasonal-frames.md`](../issue_plans/seasonal-frames.md) | agente |
| **QR code sullo scontrino** con il link all'album dell'evento | [`receipt-qr.md`](../issue_plans/receipt-qr.md) | agente |

### Più veloce da usare

| Voce | Piano | Tipo |
|---|---|---|
| **Scorciatoia e tile "Scatta e stampa"**: dalla schermata home direttamente al mirino in stampa istantanea | [`quick-print-shortcut.md`](../issue_plans/quick-print-shortcut.md) | agente |

### Qualità e distribuzione

| Voce | Piano | Tipo |
|---|---|---|
| **Test strumentati del renderer** su emulatore (font, testi nitidi, WYSIWYG) | [`renderer-instrumented-tests.md`](../issue_plans/renderer-instrumented-tests.md) | misto (job CI con emulatore) |
| **Landing page** su GitHub Pages dal brand sheet | [`landing-page.md`](../issue_plans/landing-page.md) | misto (attivare Pages) |
| **Pubblicazione su Google Play** | [`play-store.md`](../issue_plans/play-store.md) | misto (account e console) |

## Idee da valutare

- Stampa da altre app: FotoFlash come destinazione di "Condividi" per le immagini.
- Modalità fotocabina a schermo intero per tablet, con pulsante grande e conto alla rovescia vocale.
- Retino "a mezzatinta" con puntini rotondi, per un effetto da giornale.
- Esportazione dello storico di un evento in un unico PDF.

Le idee diventano voci di roadmap quando hanno un piano con criteri di accettazione verificabili in CI.
