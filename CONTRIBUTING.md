# Contribuire a FotoFlash

Grazie! FotoFlash è pensato per crescere anche con l'aiuto di un agente, quindi le regole sono
poche e scritte: valgono per persone e agenti allo stesso modo.

## Prima di cominciare

- Leggi [`AGENTS.md`](AGENTS.md): regole di codice, build, branch, cosa non fare, definizione di "fatto".
- I contratti di [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) sono vincolanti; la specifica di
  prodotto è [`docs/SPEC.md`](docs/SPEC.md).
- Cerca tra le [issue](https://github.com/nb-camelot/fotoflash/issues) e i piani pronti in
  [`issue_plans/`](issue_plans/): forse qualcuno ci ha già pensato.

## Segnalare un bug o proporre un'idea

Usa i modelli **Bug** e **Funzionalità**. Il titolo è in stile conventional commit (`fix: …`,
`feat: …`) e i criteri di accettazione sono verificabili in CI: così l'issue è pronta anche per
l'agente. Per i problemi di stampa indica sempre modello della stampante e impostazioni (Impostazioni
→ Carta e stampa), e se puoi allega una foto dello scontrino.

## Scrivere codice

1. Parti da `dev`: `git switch dev && git switch -c feat/<tema>` (oppure `fix/<tema>`).
2. Commit in conventional commit; logica nuova in `core-thermal` con i suoi test JUnit; testi in
   inglese e italiano con il prefisso dell'area.
3. Apri la PR **verso `dev`** e compila la checklist del modello di PR.
4. Aspetta il check **Build e test**. Se è rosso, il check *FotoFlash build report* ti dice file,
   riga e motivo.
5. Aggiungi una riga in `CHANGELOG.md`, sezione `[Unreleased]`.

Il repository non ha il wrapper Gradle: la build ufficiale è quella della CI (Gradle 8.10.2, JDK 17,
SDK 35). In locale va bene Android Studio Ladybug o successivo.

## Far lavorare l'agente

Su un'issue scrivi un commento che comincia con `/oc` (owner, collaboratori e utenti autorizzati).
L'agente scrive il piano, implementa, compila, si fa revisionare e apre la PR verso `dev`; se tutto è
verde la mergia. Per correggere il tiro commenta `/oc <cosa cambiare>` sulla sua PR. Dettagli nel
[README](README.md#sviluppo-agentico-con-oc).

## Rilasci

Li decide una persona con una PR `dev → main`: il resto (versione, tag, APK firmato, Release) è
automatico. Vedi [Rilasci e versioni](README.md#rilasci-e-versioni).

Contribuendo accetti che il tuo codice sia distribuito con la [licenza MIT](LICENSE) del progetto.
