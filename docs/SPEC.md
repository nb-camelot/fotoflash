# FotoFlash — specifica di prodotto

> Scatta. Stampa. Sorridi.

FotoFlash trasforma il telefono in una **fotocamera istantanea a carta termica**: come le
fotocamere per bambini che stampano lo scatto su uno scontrino, ma con il telefono e una
stampante termica Bluetooth da 58 mm (ESC/POS, Bluetooth classico SPP). Serve per foto
ricordo al volo: feste, matrimoni, gite, giochi con i bambini, banchetti e fotocabine fai da te.

## Principi

1. **La carta è il prodotto.** Ogni stampa deve essere bella su carta termica a 203 dpi:
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
2. Permessi: fotocamera; Bluetooth (Android 12+: «Dispositivi nelle vicinanze»).
3. Scelta della stampante tra i dispositivi accoppiati (con scorciatoia alle impostazioni
   Bluetooth per accoppiarla) e **pagina di prova**.
4. Si può saltare: la stampante si sceglie anche dopo.

### Scatto
- Mirino a tutto schermo (sempre tema scuro).
- **Anteprima termica dal vivo** (attivabile): il mirino mostra in tempo reale come verrà
  la foto retinata in bianco e nero.
- Barra in alto: stato stampante (chip colorato, tocca → schermata stampante), flash
  (auto/on/off), timer (0/3/10 s), anteprima termica on/off.
- Barra in basso: galleria (import), **otturatore** grande, cambio fotocamera.
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
- Regolazioni: Luminosità, Contrasto, Nitidezza (slider), Retino (Atkinson · Floyd-Steinberg ·
  Bayer · Soglia), Auto-livelli on/off. L'anteprima si aggiorna con debounce (~120 ms).
- Copie: 1-5.
- **Stampa** (pulsante grande giallo): foglio di avanzamento con stato reale della stampante
  e percentuale; a fine stampa "Stampato!" con animazione; errore → messaggio chiaro + azione
  (Riprova · Scegli stampante · Apri Bluetooth).
- Secondarie: **Salva** in galleria (PNG della stampa), **Condividi**.
- Ogni stampa (anche solo salvata) entra nello Storico.

### Storico
- Griglia delle stampe (miniature in bianco e nero), più recenti in alto.
- Dettaglio: anteprima, data, modello, didascalia; **Ristampa**, Condividi, Salva, Elimina.

### Impostazioni
- **Stampante**: scelta, stato, pagina di prova, dimentica.
- **Carta e stampa**: larghezza (58/80 mm), avanzamento dopo la stampa, taglio carta,
  intensità (riscaldamento testina), *avanzate*: dimensione blocco, pausa tra blocchi,
  altezza banda (calibrazione per stampanti con buffer piccolo).
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

## Stampante e trasmissione

- ESC/POS su Bluetooth classico SPP (UUID 00001101-…), dispositivi già accoppiati.
- Immagini con `GS v 0` **a bande** (default 24 righe), scritte a **blocchi** (default 256
  byte) con **pausa** configurabile (default 15 ms): una foto vale ~10 volte uno scontrino e le
  stampanti economiche non hanno controllo di flusso.
- Prima della chiusura del socket: attesa proporzionale ai byte inviati (svuotamento buffer).
- Connessione tenuta aperta tra stampe vicine (timeout di inattività 45 s), riconnessione
  automatica una volta in caso di errore.

## Brand (sintesi — dettagli in docs/brand/BRAND.md)

- Nome: **FotoFlash** · payoff: *Scatta. Stampa. Sorridi.* (EN: *Snap. Print. Smile.*)
- Colori: Ink `#16130F` · Paper `#FBF8F1` · Flash `#FFCC00` · Coral `#FF5B45` · Mint `#22B89A`
  · Sky `#3D8BFF` · Graphite `#4A4640` · Fog `#EDE8DE` · Night `#0E0C0A`.
- Caratteri: **Righteous** (marchio, titoli), **Space Mono** (dati da scontrino, didascalie,
  etichette tecniche), Roboto di sistema (testo corrente).
- Motivi: bordo a dente di sega della carta strappata, puntinato del retino Atkinson, lampo.
- Lingue: inglese (default) e italiano.
