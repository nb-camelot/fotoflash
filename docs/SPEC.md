# FotoFlash — specifica di prodotto

> Scatta. Stampa. Sorridi.

FotoFlash trasforma il telefono in una **fotocamera istantanea a carta termica**: come le
fotocamere per bambini che stampano lo scatto su uno scontrino, ma con il telefono e una
stampante termica Bluetooth: una ESC/POS da 58 o 80 mm (Bluetooth classico SPP o Bluetooth LE)
oppure una Phomemo M02 o M02 Pro (Bluetooth LE). Ogni famiglia ha il suo **driver**
([`docs/DRIVERS.md`](DRIVERS.md)), scelto in automatico dal nome della stampante. Serve per foto
ricordo al volo: feste, matrimoni, gite, giochi con i bambini, banchetti e fotocabine fai da te.

## Principi

1. **La carta è il prodotto.** Ogni stampa deve essere bella su carta termica a 203 o 300 dpi:
   impaginazione curata, testi nitidi (mai retinati), foto retinata con algoritmi buoni.
2. **WYSIWYG.** L'anteprima mostra esattamente i punti che andranno sulla carta (stessa
   immagine a 1 bit, ingrandita senza filtri). Niente sorprese.
3. **Due tocchi.** Dall'apertura alla stampa: scatta, stampa. Tutto il resto è facoltativo.
4. **Onesta sugli errori.** Se la stampante non risponde lo diciamo subito e diciamo perché
   (Bluetooth spento, non accoppiata, occupata, carta finita), con l'azione per risolvere.
5. **Adatta ai bambini, curata per gli adulti.** Pulsanti grandi, feedback divertenti
   (flash, suono, vibrazione), ma un'estetica pulita.

## Flussi

### Primo avvio (onboarding)
1. Tre schede illustrate: *Scatta* → *Stampa* → *Ricorda*.
2. Permessi: fotocamera; Bluetooth (Android 12+: «Dispositivi nelle vicinanze»; fino ad Android 11
   la ricerca BLE chiede la posizione e la Localizzazione attiva).
3. Scelta della stampante in due elenchi: **Accoppiate** (SPP, con scorciatoia alle impostazioni
   Bluetooth per accoppiarla) e **Vicine (BLE)** (pulsante «Cerca», 10 s). Il driver viene
   riconosciuto dal nome e mostrato; si può cambiare. Poi **pagina di prova**.
4. Si può saltare: la stampante si sceglie anche dopo.

### Scatto
- Mirino a tutto schermo (sempre tema scuro).
- **Anteprima termica dal vivo** (attivabile): il mirino mostra in tempo reale come verrà
  la foto retinata in bianco e nero.
- Barra in alto: stato stampante (chip colorato, tocca → schermata stampante), flash
  (auto/on/off), timer (0/3/10 s), anteprima termica on/off.
- Barra in basso: galleria (import), **otturatore** grande, cambio fotocamera.
- **Tocca per esporre**: un tocco sul soggetto misura esposizione e messa a fuoco lì (anello animato) e
  apre lo slider **☀ ±EV** di compensazione dell'esposizione; si azzera cambiando fotocamera.
- **Salva gli scatti in galleria** (impostazione, attiva di default): ogni scatto della fotocamera viene
  copiato anche in Galleria › FotoFlash › Scatti, così le foto non si perdono.
- Selettore modalità sopra l'otturatore: **Foto** · **Striscia** (fotocabina).
- Striscia: un tocco avvia N scatti (3 o 4) con conto alla rovescia 3-2-1 e lampo bianco a
  ogni scatto; alla fine si apre l'editor con il modello *Striscia*.
- **Stampa istantanea** (impostazione): dopo lo scatto stampa subito con le impostazioni
  correnti, mostra un toast con l'esito e resta nel mirino (modalità "fotocamera per bambini").
- Accesso a Storico e Impostazioni.

### Editor e stampa
- Anteprima WYSIWYG su un "foglio di carta" con bordi a dente di sega, scorrevole se lunga.
- Modelli: **Polaroid** · **Pieno** · **Striscia** · **Scontrino** (chip con miniatura).
- Didascalia (campo di testo, max 40 caratteri), evento/hashtag/data/numero dalle impostazioni.
- Regolazioni: Luminosità, Contrasto, Ombre, Contrasto locale, Nitidezza (slider), Retino (Atkinson ·
  Floyd-Steinberg · Bayer · Soglia), Auto-livelli e **Controluce automatico** on/off (con avviso
  "Controluce rilevato" quando la foto ha il soggetto scuro su sfondo chiaro). L'anteprima si aggiorna con debounce (~120 ms).
- Copie: 1-5.
- **Stampa** (pulsante grande giallo): foglio di avanzamento con stato reale della stampante
  e percentuale; a fine stampa "Stampato!" con animazione; errore → messaggio chiaro + azione
  (Riprova · Scegli stampante · Apri Bluetooth).
- Secondarie: **Salva** in galleria (PNG della stampa), **Condividi**.
- Ogni stampa (anche solo salvata) entra nello Storico.

### Storico
- Griglia delle stampe (miniature in bianco e nero), più recenti in alto.
- Dettaglio: anteprima, data, modello, didascalia; **Ristampa**, Condividi, Salva stampa, **Salva foto**
  (gli originali in Galleria › FotoFlash › Scatti), Elimina.
- **Esporta tutte le foto**: salva in galleria gli originali di tutto lo storico, con avanzamento.

### Impostazioni
- **Stampante**: scelta (accoppiate in SPP o vicine in BLE), **driver** (riconosciuto dal nome,
  modificabile), collegamento (SPP/BLE), stato, pagina di prova, dimentica. Una Phomemo **M02X** viene
  riconosciuta e segnalata come non supportata.
- **Carta e stampa**: larghezza (58/80 mm, solo per i driver ESC/POS: per i Phomemo la decide il
  driver), avanzamento dopo la stampa; per le ESC/POS anche taglio carta e intensità (riscaldamento
  testina); *avanzate*: dimensione blocco, pausa tra blocchi, altezza banda (calibrazione per
  stampanti con buffer piccolo). La schermata mostra solo le voci del driver scelto.
- **Phomemo**, al posto di intensità e taglio: densità 1-15 (predefinita: quella che discende
  dall'intensità), larghezza di stampa 72 o 78 byte (solo M02 Pro), velocità di stampa sperimentale
  (spenta di default).
- **Velocità di invio BLE**: *Automatica* (i predefiniti del driver, consigliata), *Sicura* (20 byte,
  15 ms), *Veloce* (60 byte, 20 ms), *Massima* (128 byte, 20 ms), con una riga che spiega perché la
  prudenza è il default. Sul web vale per le Phomemo; le ESC/POS hanno la modalità d'invio del bridge.
  Nell'app vale per ogni stampante BLE: la prima voce si chiama «Predefinita del driver», e ce n'è una
  in più, «Con conferma» (100 byte, ognuno confermato), che coincide con il predefinito delle ESC/POS
  in BLE; lì ogni cambio di driver riporta la scelta ai predefiniti.
- **Immagine**: retino predefinito, regolazioni predefinite.
- **Evento**: titolo, hashtag, data sì/no, numerazione sì/no, azzera contatore.
- **Scatto**: stampa istantanea, timer predefinito, scatti per striscia (3/4), suono
  otturatore, anteprima termica.
- **Informazioni**: versione, licenze (font OFL), link al progetto.

## I modelli di stampa (58 mm = 384 punti)

| Modello | Contenuto |
|---|---|
| Polaroid | Margini 16 pt, foto quadrata 352×352, fascia bassa ~96 pt con didascalia (Space Mono Bold) e data piccola |
| Pieno | Foto 384×512 (3:4) a filo; sotto, se presenti, didascalia e data |
| Striscia | Titolo evento (Righteous), 3-4 foto 4:3 da 352×264 con 12 pt di stacco, piede con data e hashtag |
| Scontrino | Intestazione "FOTOFLASH" (Righteous) + titolo evento, riga tratteggiata, foto 352×352, didascalia, righe tratteggiate, "RICORDO N. 0042", data, "Grazie per il sorriso!" |

Regole: i testi si disegnano in nero pieno (soglia, niente retino); le foto si retinano a parte
e poi si compone tutto in un'unica immagine a 1 bit.

Le misure sono in punti e scalano con la larghezza del driver. A 576 punti, cioè ESC/POS 80 mm e
Phomemo M02 Pro, tutto cresce di 1,5 volte. Sulla M02 Pro (300 dpi) la stampa esce fisicamente quasi
identica a quella da 58 mm: 576 punti a 300 dpi sono 48,8 mm, 384 punti a 203 dpi sono 48 mm.

## Stampante e trasmissione

Ogni stampa passa da un **driver** (contratti e byte in [`docs/DRIVERS.md`](DRIVERS.md)), che
trasforma l'immagine a 1 bit nei comandi della sua stampante e dice come spedirli:

| Driver | Stampanti | Punti/dpi | Collegamento | Retino predefinito |
|---|---|---|---|---|
| `escpos-58` | ESC/POS 58 mm ("BlueTooth Printer", Netum…) | 384 / 203 | App: SPP o BLE · Web: BLE | Atkinson |
| `escpos-80` | ESC/POS 80 mm | 576 / 203 | App: SPP o BLE · Web: BLE | Atkinson |
| `phomemo-m02` | Phomemo M02 | 384 / 203 | BLE (app e web) | Floyd-Steinberg |
| `phomemo-m02pro` | Phomemo M02 Pro (la M02S è riconosciuta, ma la sua larghezza è da verificare) | 576 / 300 | BLE (app e web) | Floyd-Steinberg |

- **ESC/POS su SPP** (UUID 00001101-…, dispositivi già accoppiati): immagini con `GS v 0` **a
  bande** (default 24 righe), scritte a **blocchi** (default 256 byte) con **pausa** configurabile
  (default 15 ms). Una foto vale circa 10 volte uno scontrino, e le stampanti economiche non hanno
  controllo di flusso.
- **BLE** (GATT; sul web Web Bluetooth): stessi byte del driver, spezzati secondo il driver. ESC/POS
  scrive con conferma, Phomemo senza conferma, a pezzi piccoli con pausa. Su Android i pezzi stanno
  nell'MTU negoziato. Sul web, che non conosce l'MTU, partono da 20 byte. Si regola con i preset di
  invio BLE.
- **Phomemo**: inizializzazione, densità, blocchi raster da 255 righe al massimo, avanzamento e coda
  di interrogazioni di stato, come l'app ufficiale. La M02X ha un protocollo diverso e non è
  supportata.
- Prima della chiusura: attesa per lo svuotamento del buffer (in SPP proporzionale ai byte inviati).
- Connessione tenuta aperta tra stampe vicine (timeout di inattività 45 s), riconnessione
  automatica una volta in caso di errore, con entrambi i collegamenti.
- La carta segue il driver: scegliere una M02 Pro imposta 576 punti a 300 dpi e propone il retino
  Floyd-Steinberg.

## Brand (sintesi — dettagli in docs/brand/BRAND.md)

- Nome: **FotoFlash** · payoff: *Scatta. Stampa. Sorridi.* (EN: *Snap. Print. Smile.*)
- Colori: Ink `#16130F` · Paper `#FBF8F1` · Flash `#FFCC00` · Coral `#FF5B45` · Mint `#22B89A`
  · Sky `#3D8BFF` · Graphite `#4A4640` · Fog `#EDE8DE` · Night `#0E0C0A`.
- Caratteri: **Righteous** (marchio, titoli), **Space Mono** (dati da scontrino, didascalie,
  etichette tecniche), Roboto di sistema (testo corrente).
- Motivi: bordo a dente di sega della carta strappata, puntinato del retino Atkinson, lampo.
- Lingue: inglese (default) e italiano.
