# FotoFlash Web — landing per schermi larghi e lingue

## Obiettivo

Chi apre `https://nb-camelot.github.io/fotoflash/` **da desktop o da uno schermo largo** non deve vedere
una colonna da telefono tagliata ai lati. Deve trovare una **pagina di presentazione animata e divertente**
che racconti i casi d'uso, faccia provare la "magia" della carta termica e porti all'app (nel browser, o
come APK Android). Sul telefono, e nell'app installata, si va dritti all'app come oggi.

Tutto in **cinque lingue**: inglese (riferimento), italiano, spagnolo, francese, tedesco.

## Direzione artistica

- **Il brand** (`docs/brand/BRAND.md`):
  - colori Ink `#16130F`, Paper `#FBF8F1`, Flash `#FFCC00`, Coral `#FF5B45`, Mint `#22B89A`, Sky `#3D8BFF`, Graphite `#4A4640`, Fog `#EDE8DE`, Night `#0E0C0A`;
  - **Righteous** per titoli e marchio, **Space Mono** per etichette, numeri e "scontrini", font di sistema per il testo corrente;
  - motivi: carta termica con bordo a dente di sega, puntinato del retino, lampo del flash, coriandoli.
- **Tono**: allegro, da festa, adatto alle famiglie ma curato. Illustrazioni piatte e geometriche con contorni Ink spessi e arrotondati, pochi colori pieni, ombre dure sfalsate (stile "sticker"). Niente foto stock, niente volti realistici: personaggi stilizzati e simpatici.
- **Il retino è la firma visiva.** Le foto delle illustrazioni sono **vere immagini retinate** prodotte dal motore (`web/src/core/`), mostrate "pixelate" su carta. La stampa si anima riga per riga, come esce dalla testina.
- **Animazioni**:
  - solo CSS e SVG, più `requestAnimationFrame` per l'effetto raster; nessuna libreria;
  - fluide a 60 fps, solo `transform`/`opacity` nelle animazioni CSS;
  - partono quando sono visibili (IntersectionObserver) e si fermano fuori schermo o con la scheda nascosta;
  - con `prefers-reduced-motion` diventano fotogrammi statici curati, mai pagine vuote.
- **Layout**: griglia centrata, larghezza massima ~1200 px, ritmo generoso. Bello a 1280, 1440 e 1920 px. Responsivo fino al telefono, perché la landing si può aprire anche lì da `#/landing`.

## Struttura della pagina

| # | Sezione | Contenuto |
|---|---|---|
| 1 | Barra in alto (fissa, discreta) | marchio, ancore (Idee · Come funziona · Prova il retino · Stampanti · Scarica), **selettore lingua**, CTA «Apri l'app» |
| 2 | **Hero** | titolo «Scatta. Stampa. Sorridi.» e sottotitolo; CTA «Apri FotoFlash nel browser» e «Scarica l'app Android»; nota «gratis · open source · senza account». A destra l'**animazione hero**: telefono che fa flash, stampantina da cui esce la foto retinata riga per riga, coriandoli |
| 3 | **Idee: i casi d'uso animati** | 5 scene a carosello, avanzamento automatico, pausa al passaggio o al focus, puntini e frecce da tastiera |
| 4 | **Come funziona** | 3 passi (Scatta → Scegli il modello → Stampa) con micro-animazioni in loop |
| 5 | **Prova il retino** (interattivo) | la foto di esempio (o una **foto dell'utente**, che resta nel browser) con chip dei 4 retini, slider luminosità/contrasto/ombre e anteprima termica dal vivo **col motore vero**. Testo: «quella è la carta, punto per punto» |
| 6 | **I modelli di stampa** | Polaroid, Pieno, Striscia e Scontrino resi davvero con `renderPrint` sulla foto di esempio, su "carta" con bordi a dente di sega, leggermente inclinati come appesi |
| 7 | **Stampanti compatibili** | schede dei driver (ESC/POS 58/80, Phomemo M02/M02 Pro), BLE e browser supportati, stato «da provare su carta» onesto per le Phomemo |
| 8 | **Installa o scarica** | installazione PWA (`ctx.install`), APK dall'ultima release, «aprilo sul telefono» con l'URL e un pulsante Copia/Condividi |
| 9 | **Open source** | GitHub, sviluppo agentico con `/oc`, licenza MIT |
| 10 | Piè di pagina | crediti (font OFL), lingua, versione |

### Le 5 scene dei casi d'uso (sezione 3)

Ogni scena è un'illustrazione SVG animata che racconta una piccola storia in 5-7 s, in loop, con titolo e
una riga di testo:
1. **Festa di compleanno, fotocabina**: tre flash, la stampantina sforna una striscia da 3 scatti, i bambini se la passano, coriandoli.
2. **Matrimonio, guestbook**: uno scontrino ricordo con l'hashtag degli sposi si stacca e finisce attaccato al libro degli ospiti.
3. **Fotocamera per bambini**: un bambino scatta al cane, la foto esce subito e va sul frigo con una calamita.
4. **Gita o viaggio**: polaroid termiche che entrano una dopo l'altra in un diario di viaggio, con un timbro.
5. **Evento o negozio**: uno scontrino con logo e «RICORDO N. 0042» per ogni ospite, la fila che sorride.

## Comportamento (gating)

```js
// web/src/landing/gate.js — funzione pura, testata in Node
export function shouldShowLanding({ width, standalone, hash }) // true se:
//   - hash === '#/landing', anche su telefono; oppure
//   - !standalone && width >= 960 && (hash vuoto | '#' | '#/')
```

- `app.js`:
  - se `shouldShowLanding` è vera, monta la landing con `import()` dinamico, così sul telefono non si scarica nulla;
  - altrimenti monta l'app;
  - «Apri l'app» porta a `#/camera`, oppure a `#/onboarding` se l'onboarding non è fatto.
- **Palcoscenico desktop.** Quando l'app gira su uno schermo largo e non installata, la colonna sta dentro una **cornice di telefono** stilizzata, su uno sfondo del brand (puntinato, stampe che fluttuano piano), con un piccolo pannello laterale: ritorno alla presentazione, lingua, «aprilo sul telefono». Sul telefono e nell'app installata nessuna cornice.
- **Impostazioni** dell'app: selettore della lingua con le 5 lingue più «Automatica», e la voce «Presentazione» che apre `#/landing`.

## Lingue

- `web/src/i18n/i18n.js`:
  - `LANGS = ['en', 'it', 'es', 'fr', 'de']`, con riconoscimento da `navigator.languages`, scelta salvata in `fotoflash.lang` e ripiego chiave per chiave sull'inglese;
  - `setLang` aggiorna anche `document.documentElement.lang` e il titolo della pagina.
- **Tabelle:**
  - `strings/<area>.js` restano `{ en, it }`;
  - le lingue nuove stanno in `locales/es.js`, `locales/fr.js` e `locales/de.js`: ciascuno con `export default { chiave: 'testo', … }` e **tutte** le chiavi inglesi di tutte le aree, compresa la landing (`land_`) e le scene (`scene_`);
  - stessi segnaposto (`%1$s`, `%1$d`, `%1$04d`, `%%`).
- **Test** (`web/tests/i18n-locales.test.mjs`): ogni lingua ha esattamente le chiavi inglesi, con gli stessi segnaposto, nessuna stringa vuota e nessun testo inglese lasciato uguale (con una lista ristretta di eccezioni: marchi, sigle come ESC/POS, BLE, PWA, APK).
- **Qualità**: traduzioni naturali e idiomatiche, come scritte da un madrelingua per un'app per famiglie. Vanno mantenuti il tono, la lunghezza (i bottoni restano corti) e i termini tecnici corretti: retino → *tramado / tramage / Rasterung*, carta termica → *papel térmico / papier thermique / Thermopapier*.

## File e proprietà

| Area | File |
|---|---|
| Landing (struttura, sezioni, interattivi) | `web/src/landing/landing.js`, `web/src/landing/gate.js`, `web/src/landing/sections/*.js`, `web/styles/landing.css`, `web/src/i18n/strings/land.js` (en/it) |
| Scene e hero animati | `web/src/landing/scenes.js`, `web/src/landing/hero.js`, `web/src/landing/art/*.js` (SVG come stringhe o funzioni), `web/styles/scenes.css`, `web/src/i18n/strings/scene.js` (en/it) |
| Shell, lingue e palcoscenico | `web/src/i18n/i18n.js`, `web/src/i18n/locales/{es,fr,de}.js` (inizialmente vuoti), `web/src/app.js`, `web/index.html`, `web/styles/app.css`, `web/src/ui/screens/settings.js`, `web/sw.js`, `scripts/build-web.mjs` (og:image PNG da `docs/brand/banner.svg`), test |
| Traduzioni | `web/src/i18n/locales/es.js`, `fr.js`, `de.js` |

**Contratto tra landing e scene:**

```js
// hero.js / scenes.js
export function mountHero(container, { t, reducedMotion }) // → { destroy() }
export function mountScenes(container, { t, reducedMotion }) // → { destroy() } (carosello compreso)
// landing.js
export async function mountLanding(root, ctx) // → unmount(); ctx come nell'app (t, settings, install, router...)
```
