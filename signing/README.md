# Firma

- `debug.p12`: keystore di **debug** del progetto (PKCS12, alias `androiddebugkey`, password `android`).
  È committato apposta: tutti gli APK di debug prodotti dalla CI hanno la stessa firma, quindi si
  installano uno sopra l'altro senza disinstallare. Non serve a nulla per le release.
- La firma di **release** non sta mai nel repo: arriva dai secret della CI
  (`SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`, `SIGNING_KEY_PASSWORD`).
  Senza secret il workflow di release fallisce con un errore esplicito.

- `debug-cert.sha256`: impronta SHA-256 del certificato di debug. La CI (step «Firma di debug invariata») fallisce se un APK di debug viene firmato con un altro certificato: gli aggiornamenti devono installarsi sopra senza disinstallare, e quindi senza perdere foto e storico.
