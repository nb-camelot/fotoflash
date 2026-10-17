# Piano: landing page su GitHub Pages

## Obiettivo

Una pagina pubblica di FotoFlash, bella quanto l'app, costruita dal brand sheet: cosa fa, come si
usa in tre passi, quali stampanti vanno bene, pulsante grande **Scarica l'APK** verso l'ultima
release. In italiano con versione inglese. Servita da GitHub Pages senza workflow nuovi.

## Contesto

- Il brand è in `docs/brand/`: il brand sheet `index.html` (da cui riprendere sezioni, mockup e
  stile), la guida `BRAND.md` (tono di voce, da fare / da non fare) e `banner.svg`, `logo.svg`,
  `wordmark.svg`, `icon.svg`. Con Pages su `/docs` il brand sheet resta raggiungibile in `/brand/`. Palette
  Ink `#16130F`, Paper `#FBF8F1`, Flash `#FFCC00`, Coral `#FF5B45`, Mint `#22B89A`, Sky `#3D8BFF`,
  caratteri Righteous (titoli) e Space Mono (dati), motivi: bordo a dente di sega, puntinato Atkinson, lampo.
- GitHub Pages può pubblicare la cartella `/docs` di un branch **senza workflow**: niente modifiche a
  `.github/`. Con un file `docs/.nojekyll` i file vengono serviti così come sono.
- I font sono OFL: si possono ridistribuire con la loro licenza. Si copiano da `app/src/main/res/font/`
  in `docs/site/fonts/` insieme ai file di licenza; **nessuna risorsa da CDN di terze parti**, nessun
  tracciamento, nessun JavaScript obbligatorio.
- Testi coerenti con `README.md` e `docs/SPEC.md`; tono del brand: allegro, chiaro, adatto ai bambini
  ma curato.

## Task

1. `docs/index.html` (italiano) e `docs/en/index.html` (inglese): HTML5 statico con `lang`, `meta
   viewport`, `meta description`, Open Graph (`og:title`, `og:description`, `og:image`), favicon dal lampo.
2. `docs/site/style.css`: palette come variabili CSS, tema chiaro e scuro (`prefers-color-scheme`),
   layout responsive da 320 px in su, nessuno scroll orizzontale, contrasti AA.
3. Sezioni: hero con banner e payoff "Scatta. Stampa. Sorridi.", "Come funziona" in tre passi,
   modelli di stampa (Polaroid, Pieno, Striscia, Scontrino) mostrati come scontrini in SVG/CSS con il
   bordo a dente di sega, stampanti compatibili (stessa tabella del README), download, link al codice,
   piè di pagina con licenza MIT e crediti dei font.
4. `docs/site/fonts/`: copie di `righteous_regular.ttf`, `space_mono_regular.ttf`, `space_mono_bold.ttf`
   e le licenze OFL; `@font-face` con `font-display: swap`.
5. `docs/site/og.png` o `og.svg` (1200x630) dal banner; immagini con `alt`.
6. `docs/.nojekyll`.
7. `README.md`: link alla pagina (`https://nb-camelot.github.io/fotoflash/`); `CHANGELOG.md`.

## File coinvolti

`docs/index.html`, `docs/en/index.html`, `docs/site/style.css`, `docs/site/fonts/*`, `docs/site/og.*`,
`docs/.nojekyll` (nuovi), `README.md`, `CHANGELOG.md`.

## Acceptance Criteria

- [ ] Esistono `docs/index.html`, `docs/en/index.html`, `docs/site/style.css` e `docs/.nojekyll`.
- [ ] Le due pagine hanno `<html lang="it">` / `<html lang="en">`, `meta name="viewport"`, `<title>`,
      `meta name="description"` e `og:image`, e si collegano a vicenda.
- [ ] Il pulsante di download punta a `https://github.com/nb-camelot/fotoflash/releases/latest`.
- [ ] Nessun riferimento a script o font esterni: `grep -E 'src="https?://|@import url\(https?://|fonts.googleapis' docs/index.html docs/en/index.html docs/site/style.css` non trova nulla.
- [ ] I tre font e le due licenze OFL sono in `docs/site/fonts/`.
- [ ] Ogni `<img>` ha un attributo `alt`.
- [ ] `gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug` resta verde (nessun file dell'app toccato).

## Verifica

```bash
ls docs/index.html docs/en/index.html docs/site/style.css docs/.nojekyll docs/site/fonts/
grep -c '<img' docs/index.html; grep -c 'alt=' docs/index.html
grep -E 'src="https?://|fonts.googleapis' docs/index.html docs/en/index.html docs/site/style.css || echo "nessuna risorsa esterna"
gradle --no-daemon :core-thermal:test :app:testDebugUnitTest :app:assembleDebug
```

## Fuori dalla CI

Una persona attiva Pages: Settings → Pages → *Deploy from a branch* → `main`, cartella `/docs`
(la pagina pubblica segue i rilasci). Poi controlla la pagina su telefono e desktop, in tema chiaro e scuro.

## Commit

docs(site): landing page su GitHub Pages
