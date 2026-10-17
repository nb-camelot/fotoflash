# FotoFlash — guida del brand

> **Scatta. Stampa. Sorridi.** · *Snap. Print. Smile.*

FotoFlash è la fotocamera istantanea a carta termica nel telefono. Il marchio mette insieme tre
cose: il **lampo** del flash, il **foglietto di carta termica** con il bordo strappato a dente di
sega e la **gioia** della foto ricordo stampata al volo. Lo stile è piatto e geometrico: pochi
colori pieni, contorni Ink spessi e arrotondati, ombre piene spostate come un adesivo, il puntinato
del retino come motivo di sottofondo.

La versione visiva di questa guida, con palette, caratteri, schermate e i quattro modelli di stampa
resi come li vedrà la carta, è [`index.html`](index.html): si apre direttamente nel browser.

---

## 1. Principi

1. **La carta è il prodotto.** Tutto quello che disegniamo deve reggere la stampa a un solo
   inchiostro: forme nette, niente sfumature, niente dettagli più piccoli di un punto di testina.
2. **Giocoso, non infantile.** Colori allegri e forme tonde per i bambini, ordine e misura per gli
   adulti che organizzano la festa.
3. **Un'idea per volta.** Ogni schermata, illustrazione o stampa ha un solo protagonista.
4. **Il giallo è il flash.** Il Flash `#FFCC00` segna l'azione principale (otturatore, Stampa) e il
   marchio. Se tutto è giallo, niente è il flash.
5. **Onesti.** Il tono è caldo ma non nasconde i problemi: diciamo cosa è successo e cosa fare.

---

## 2. Il marchio

Il marchio è un **foglietto di carta termica** inclinato di −8°, con il bordo inferiore strappato a
dente di sega, una **finestra foto** Ink con dentro il **lampo** Flash e una riga di **didascalia**:
una polaroid nata da uno scontrino.

| Elemento | Misura (griglia 108, come l'icona adattiva) |
|---|---|
| Foglietto | 38 × 48, angoli superiori r 4, contorno Ink 3,5 con giunzioni tonde |
| Dente di sega | 5 denti, larghezza:profondità = 2:1 (come `TornPaperShape`, 12 × 6 dp) |
| Ombra | stessa sagoma spostata di 3 in basso a destra, tinta piena (mai sfumata) |
| Finestra foto | 29 × 29, r 2,5, Ink pieno |
| Lampo | 7 vertici, Flash pieno, alto 23 |
| Didascalia | tratto Ink 2,6 con estremi tondi |

**Varianti**

| Variante | Uso | File |
|---|---|---|
| Su Flash, ombra Flash Deep `#E0A800` | icona dell'app, splash | `icon.svg`, `ic_launcher_foreground.xml`, `ic_splash.xml` |
| Su fondo libero, ombra Flash | documenti, README, materiali | `logo.svg` |
| Monocromatica (sagoma, lampo traforato) | icone a tema di Android 13+ | `ic_launcher_monochrome.xml` |

**Area di rispetto:** attorno al marchio lasciare almeno metà della larghezza della finestra foto
(≈ 40 % del foglietto). **Misura minima:** 24 px di altezza a schermo, 8 mm in stampa.

---

## 3. Icona dell'app e splash

- **Icona adattiva** (`mipmap-anydpi-v26/ic_launcher.xml`): sfondo `@color/ic_launcher_background`
  (Flash), primo piano `ic_launcher_foreground`, livello `monochrome` per le icone a tema.
- **Zona sicura:** tutto il disegno sta nel cerchio centrale di **66 dp** del livello da 108 dp;
  il punto più lontano dal centro è a 32,2 dp (contorno compreso). Nessun elemento va oltre:
  le maschere dei launcher (cerchio, squircle, goccia) tagliano in modo diverso.
- **Monocromatica:** il sistema usa solo l'alfa e ricolora tutto. Per questo la carta è vuota (solo
  contorno) e il lampo è un foro nella finestra foto (`fillType="evenOdd"`).
- **Splash** (`ic_splash.xml`, su `windowSplashScreenBackground` = Flash): il marchio all'88 % con
  tre scintille Ink. Android ritaglia il cerchio centrale di 72 dp: il disegno arriva a 34,7 dp dal
  centro.
- **`icon.svg`** (512 × 512) è il cerchio visibile di 72 dp riportato al quadrato pieno: per store,
  README e social. Gli angoli li arrotonda chi la mostra.

Solo tracciati con tinte piene: niente gradienti, niente `aapt:attr`, niente `clip-path`.

---

## 4. Il wordmark

**Lampo + «FotoFlash» in Righteous**, sempre con la F e la seconda F maiuscole, tutto attaccato.

- Proporzioni (le stesse di `BrandWordmark.kt`): lampo alto *h*, testo in corpo 0,86 *h*, stacco
  0,2 *h*, maiuscole centrate sul lampo.
- Il lampo (`ic_brand_bolt.xml`) è **giallo Flash con contorno Ink**: si legge sia su Paper sia sul
  Night del mirino, dove un lampo tutto Ink sparirebbe.
- Su fondo scuro il testo diventa Paper; il lampo non cambia.
- In `wordmark.svg` e `banner.svg` la scritta è **convertita in tracciati** direttamente da
  `app/src/main/res/font/righteous_regular.ttf`, con la crenatura del font: gli SVG si vedono
  uguali ovunque, anche dove Righteous non è installato (GitHub mostra gli SVG come immagini e non
  carica i font).

---

## 5. Colori

| Colore | Hex | Android | Compose | Ruolo |
|---|---|---|---|---|
| **Flash** | `#FFCC00` | `ff_flash` | `FfColors.Flash` | marchio, otturatore, azione primaria (Stampa), selezione |
| Flash Deep | `#E0A800` | `ff_flash_deep` | `FfColors.FlashDeep` | ombra del marchio sul giallo, bordo 3D dei pulsanti gialli |
| **Ink** | `#16130F` | `ff_ink` | `FfColors.Ink` | testi, contorni, il "nero" della stampa (mai nero puro in UI) |
| Night | `#0E0C0A` | `ff_night` | `FfColors.Night` | tema scuro e mirino |
| **Paper** | `#FBF8F1` | `ff_paper` | `FfColors.Paper` | fondo chiaro, ogni foglio di carta (anche nel tema scuro) |
| Fog | `#EDE8DE` | `ff_fog` | `FfColors.Fog` | superfici secondarie sul chiaro |
| Graphite | `#4A4640` | `ff_graphite` | `FfColors.Graphite` | testi secondari, stato "non connessa" |
| Coral | `#FF5B45` | `ff_coral` | `FfColors.Coral` | errori (come fondo o icona), cuori, accenti caldi |
| Mint | `#22B89A` | `ff_mint` | `FfColors.Mint` | stampante pronta, successo |
| Sky | `#3D8BFF` | `ff_sky` | `FfColors.Sky` | link, informazioni, accenti freddi |

Proporzioni d'uso indicative: **Paper/Night 60 %, Ink 25 %, Flash 10 %, accenti 5 %.**

### Contrasti (WCAG 2.1, calcolati)

| Testo su fondo | Rapporto | Esito |
|---|---|---|
| Ink su Flash | **12,25 : 1** | AAA: il testo dei pulsanti gialli è sempre Ink |
| Graphite su Paper | **8,83 : 1** | AAA: testi secondari |
| Ink su Paper | 17,46 : 1 | AAA |
| Graphite su Fog | 7,67 : 1 | AAA |
| Paper su Night | 18,41 : 1 | AAA |
| Flash su Night | 12,91 : 1 | AAA: accenti gialli nel mirino |
| Ink su Coral / Mint / Sky | 6,03 / 7,40 / 5,59 : 1 | AA: testo sui chip colorati è Ink |
| Errore `#C4321E` su Paper | 5,18 : 1 | AA: il rosso dei testi di errore (`FfTones.ErrorOnLight`) |
| Coral su Paper | 2,90 : 1 | **no testo**: solo icone grandi e fondi |
| Sky su Paper | 3,13 : 1 | **no testo corrente**: solo icone e testo ≥ 24 px grassetto |
| Mint su Paper | 2,36 : 1 | **no testo**: solo spie e fondi |
| Paper su Flash | 1,43 : 1 | **mai** |
| Graphite su Night | 2,08 : 1 | **mai** come testo nel tema scuro |

---

## 6. Caratteri

| Carattere | Dove | Regole |
|---|---|---|
| **Righteous** (OFL) | marchio, titoli delle schermate (`FfTopBar`), pulsanti grandi, conto alla rovescia, titoli dell'evento e intestazione «FOTOFLASH» sulla carta | solo regular; mai sotto 18 sp a schermo; niente maiuscolo forzato in UI (sì in stampa per l'intestazione) |
| **Space Mono** (OFL, regular e bold) | etichette (`labelLarge/Medium/Small`), dati "da scontrino": date, numeri, stati tecnici, chip; sulla carta didascalie (bold), date, hashtag, numero, piede | niente spaziatura extra: è già larga (sotto i default Material: 0 su `labelLarge` e sulla carta, 0,2–0,3 sp solo su `labelMedium`/`labelSmall`); numeri sempre in Space Mono |
| **Roboto** (sistema) | testo corrente, paragrafi, descrizioni, campi | segue la scala dei caratteri di sistema |

I file stanno in `app/src/main/res/font/` (`righteous_regular`, `space_mono_regular`,
`space_mono_bold`); le licenze in `docs/licenses/`.

---

## 7. Motivi

- **Dente di sega** — il bordo della carta strappata. Denti 2:1 (12 × 6 dp in UI, `TornPaperShape`),
  sempre interi: il numero di denti si arrotonda alla larghezza. Sopra e/o sotto, mai sui lati.
- **Retino** — puntini Ink su griglia sfalsata (righe alterne spostate di mezzo passo, come i retini
  a 45°) che rimpiccioliscono verso il bordo (`HalftoneBurst`). È lo sguardo della testina sul
  lampo: decorativo, **mai dietro a un testo**.
- **Lampo** — solo nel marchio, nel pulsante del flash e nei momenti di festa (illustrazioni,
  "Stampato!"). Non è un motivo da ripetere.
- **Ombra piena** — la stessa sagoma spostata in basso a destra, in tinta piena (Ink, Flash o Flash
  Deep). Mai sfocata, mai trasparente.
- **Scintille** — stelline a quattro punte con i lati concavi, Ink o Flash con contorno Ink.

---

## 8. Illustrazioni

Le tre tavole dell'onboarding (`ill_onboarding_snap`, `ill_onboarding_print`,
`ill_onboarding_keep`, viewport 320 × 240) seguono lo stesso schema:

- un **disco di colore** dietro la scena (Flash per *Scatta*, Mint per *Stampa* — come la spia
  "pronta" —, Sky per *Ricorda*);
- un protagonista con **contorno Ink da 4**, tinte piene e **ombra piena**;
- il **retino** in un angolo, **scintille** e coriandoli attorno;
- le foto stampate sono a **un solo inchiostro**, come escono davvero dalla stampante: Ink su Paper,
  con il retino a puntini.

---

## 9. Tono di voce

Parliamo come un amico che sa usare la stampante: **caldo, breve, chiaro**. Diamo del *tu*
(*you*). Frasi corte, verbi all'imperativo gentile, niente gergo (si dice "stampante", non
"dispositivo ESC/POS"). Le esclamazioni sono per i momenti di gioia, non per gli errori.
Gli errori dicono **cosa è successo** e **cosa fare**, in quest'ordine.

| Momento | Italiano | English |
|---|---|---|
| Payoff | Scatta. Stampa. Sorridi. | Snap. Print. Smile. |
| Onboarding | Scatta. · Stampa. · Ricorda. | Snap. · Print. · Remember. |
| Pulsante principale | Stampa | Print |
| Fine stampa | **Stampato!** Strappa il foglio e goditi il ricordo. | **Printed!** Tear off the sheet and enjoy the memory. |
| Errore | **La stampante non risponde.** Controlla che sia accesa, carica e vicina. | **The printer isn't answering.** Check that it's switched on, charged and close by. |
| Errore | **Il Bluetooth è spento.** Accendi il Bluetooth, poi riprova. | **Bluetooth is off.** Turn on Bluetooth, then try again. |
| Sulla carta | Grazie per il sorriso! · RICORDO N. 0042 | Thanks for the smile! · MEMORY NO. 0042 |
| Didascalia vuota | Scrivi qualcosa da ricordare | Write something to remember |

**Glossario:** stampa / print · stampante / printer · carta termica / thermal paper · striscia /
strip · scontrino / receipt · ricordo / memory · didascalia / caption · retino / dithering.
Da evitare: "errore sconosciuto", "operazione fallita", "dispositivo", punti esclamativi negli
errori, maiuscolo urlato in UI.

---

## 10. Stampe su carta termica

La testina stampa a **203 dpi = 8 punti per mm**: **384 punti** sulla carta da 58 mm, **576** su
quella da 80 mm. Ogni punto è nero o carta: non esistono grigi.

1. **Il testo non si retina mai.** Si disegna in nero pieno e si passa a soglia (150), poi si
   compone con la foto già retinata in un'unica immagine a 1 bit.
2. **Corpo minimo 20 punti = 2,5 mm** (la data). Didascalia 28, hashtag e piede 22, titolo evento
   40 (Righteous), intestazione 48. Il motore d'impaginazione rimpicciolisce un testo solo per
   farlo stare (fino al 60 %, mai sotto 14 punti): quando si progetta un modello si parte dai corpi
   nominali.
3. **Margini 16 punti = 2 mm**, stacchi 12, fascia della polaroid almeno 96, righe tratteggiate
   6/4 con spessore 2. Linee e contorni mai sotto 2 punti.
4. **Foto:** si regolano prima (livelli automatici, contrasto +0,15, gamma 1,25, nitidezza 0,5) e si
   retinano con **Atkinson** di default: luci pulite, neri pieni dove servono.
5. **Niente grandi campiture nere:** scaldano la testina, rallentano la stampa e fanno arricciare
   la carta. Il nero pieno va su forme piccole (testo, contorni, dettagli).
6. **Righteous solo nei titoli** (≥ 40 punti): a corpi piccoli si impasta. Il resto è Space Mono.
7. **L'anteprima è la stampa:** l'editor mostra la stessa immagine a 1 bit ingrandita senza filtri.

---

## 11. Da fare / da non fare

**Da fare**

- Usare il Flash per una sola azione principale per schermata.
- Mettere testo Ink sul giallo e sui chip colorati.
- Tenere il marchio inclinato di −8° e il wordmark sempre su una riga.
- Disegnare ombre piene e contorni tondi, Ink.
- Provare ogni modello di stampa sulla carta vera prima di pubblicarlo.

**Da non fare**

- Testo Paper su Flash, testo Coral/Mint su Paper, testo Graphite sul Night.
- Raddrizzare, deformare, ricolorare o mettere un contorno al marchio.
- Gradienti, ombre sfocate, trasparenze nelle icone e nelle illustrazioni.
- Retinare i testi o stampare grigi "finti" con l'antialias.
- Usare il lampo come decorazione ripetuta o il retino dietro a un testo.
- Scrivere "FOTOFLASH" in maiuscolo nell'interfaccia (sì solo sulla carta, nell'intestazione).

---

## 12. File

| File | Contenuto |
|---|---|
| `docs/brand/logo.svg` | marchio su fondo libero |
| `docs/brand/wordmark.svg` | lampo + «FotoFlash» (testo in tracciati) |
| `docs/brand/icon.svg` | icona dell'app 512 × 512 su Flash |
| `docs/brand/banner.svg` | hero del README 1280 × 640 |
| `docs/brand/index.html` | brand sheet interattivo (palette, caratteri, schermate, stampe) |
| `app/src/main/res/drawable/ic_launcher_foreground.xml` | icona adattiva, primo piano |
| `app/src/main/res/drawable/ic_launcher_monochrome.xml` | icona a tema |
| `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` | icona adattiva |
| `app/src/main/res/values/ic_launcher_colors.xml` | `ic_launcher_background` (Flash) |
| `app/src/main/res/drawable/ic_splash.xml` | splash di Android 12+ |
| `app/src/main/res/drawable/ic_brand_bolt.xml` | lampo del wordmark |
| `app/src/main/res/drawable/ill_onboarding_*.xml` | le tre illustrazioni dell'onboarding |
| `app/src/main/res/values/colors.xml` | token colore `ff_*` |
