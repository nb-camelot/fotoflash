# Piano: QR code sullo scontrino con il link all'album dell'evento

## Obiettivo

Nel modello **Scontrino**, sotto la foto, un **QR code** che porta all'album condiviso dell'evento
(Google Foto, iCloud, Drive, un sito): chi riceve la stampa ritrova la foto a colori. Il link si
imposta una volta in Impostazioni → Evento.

## Contesto

- FotoFlash non ha un server: la foto non viene caricata da nessuna parte. Il QR punta a un **link
  scelto dall'organizzatore** (l'album dove caricherà le foto). Se il link è vuoto il QR non c'è.
- Nessuna libreria QR (niente dipendenze nuove): l'encoder si scrive in `core-thermal`, in Kotlin
  puro, limitato a ciò che serve: modalità byte (UTF-8), correzione d'errore **M**, versioni 1-10
  (fino a 213 byte), scelta della maschera con le quattro penalità standard (ISO/IEC 18004).
- Il QR si disegna come quadrati neri pieni, con modulo intero (almeno 4 punti a 58 mm) e quiet zone
  di 4 moduli: niente retino, niente scalature con filtro.
- Impaginazione: `TemplateGeometry.kt` (RECEIPT); testi in `TemplateTexts`; rendering in
  `print/PrintRenderer.kt`; impostazioni in `model/AppSettings.kt` e `data/SettingsRepository.kt`.
- **Contratti toccati** (aggiorna `docs/ARCHITECTURE.md` e i chiamanti): `TemplateTexts` acquista
  `qrPayload: String? = null`; `TemplateLayout` acquista `qr: Rect? = null`; `AppSettings` acquista
  `eventLink: String = ""`; nuovo `core-thermal/.../QrCode.kt` con
  `object QrCode { fun encode(text: String): QrMatrix }` e `class QrMatrix(val size: Int) { operator fun get(x: Int, y: Int): Boolean }`.

## Task

1. `core-thermal`: `QrCode.kt` — segmenti in byte mode, capacità per versione con livello M, codewords
   di riempimento `0xEC 0x11`, Reed-Solomon su GF(256) con polinomio `0x11D`, blocchi e interleaving
   per versione, posizionamento (finder, separatori, timing, allineamento, modulo scuro, aree di
   formato e versione), maschere 0-7 con penalità, informazioni di formato BCH.
2. `core-thermal`: `QrCodeTest.kt` (vedi criteri).
3. `TemplateGeometry.kt`: nel RECEIPT, se `qrPayload` non è vuoto, un'area quadrata centrata dopo la
   didascalia (lato = modulo intero più grande che sta in 160 punti a 58 mm, 240 a 80 mm), con una
   riga piccola "Scansiona per l'album" (`TextRole.FOOTER` o un ruolo nuovo documentato).
4. `PrintRenderer.kt`: disegna la matrice nell'area `layout.qr`, modulo per modulo, in nero pieno.
5. `PrintCoordinator.buildRequest()`: passa `eventLink` come `qrPayload` solo per il modello RECEIPT.
6. Impostazioni → Evento: campo "Link dell'album" con validazione leggera (`https://` o `http://`,
   massimo 200 caratteri) e testo di aiuto.
7. Stringhe `set_*` e `ed_*` in inglese e italiano.
8. `docs/ARCHITECTURE.md`, `docs/SPEC.md` (tabella dei modelli), `CHANGELOG.md`.

## File coinvolti

`core-thermal/.../thermal/QrCode.kt` (nuovo), `core-thermal/src/test/.../QrCodeTest.kt` (nuovo),
`Model.kt`, `TemplateGeometry.kt`, `TemplateGeometryTest.kt`, `app/.../print/PrintRenderer.kt`,
`app/.../print/PrintCoordinator.kt`, `app/.../model/AppSettings.kt`, `app/.../data/SettingsRepository.kt`,
`app/.../settings/SettingsScreen.kt`, `app/.../settings/SettingsViewModel.kt`,
`res/values*/strings_settings.xml`, `res/values*/strings_editor.xml`, `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] Reed-Solomon: per i 16 codewords di dati dell'esempio "HELLO WORLD" versione 1-M del tutorial di
      Thonky (`32 91 11 120 209 114 220 77 67 64 236 17 236 17 236 17`) i 10 codewords di correzione
      sono `196 35 39 119 235 215 231 226 93 23` (test; controlla i numeri sulla fonte prima di usarli).
- [ ] Informazioni di formato: livello M con maschera 0 produce la sequenza di 15 bit `101010000010010` (test).
- [ ] `encode("https://example.com")` dà una matrice 21x21 o 25x25 con i tre finder pattern 7x7 agli
      angoli giusti, i separatori bianchi, i timing pattern alternati sulla riga e colonna 6 e il modulo
      scuro in `(8, 4*versione+9)` (test).
- [ ] Testi di 1, 100 e 213 byte vengono codificati; un testo di 214 byte lancia un'eccezione chiara (test).
- [ ] RECEIPT con `qrPayload` ha `layout.qr` quadrato, centrato, dentro la larghezza della carta; senza
      `qrPayload` `layout.qr` è null e il layout è identico a prima (test, anche a 80 mm).
- [ ] `AppSettings.eventLink` è persistito; il campo è in Impostazioni → Evento con stringhe in `values/` e `values-it/`.
- [ ] `docs/ARCHITECTURE.md` riporta i contratti nuovi.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` è verde.

## Verifica

```bash
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
grep -n 'qrPayload\|eventLink\|QrCode' docs/ARCHITECTURE.md
```

## Fuori dalla CI

Stampa uno scontrino con un link vero e leggilo con due telefoni diversi (fotocamera di sistema e
Google Lens) a 58 mm, con intensità 0 e 2.

## Commit

feat(print): QR code con il link all'album sullo scontrino
