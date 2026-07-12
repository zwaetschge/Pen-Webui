# Couch-Play mit Fernseher und vier Handys

Plum Tabletop trennt den gemeinsamen Tisch vom persönlichen Companion:

- Der Fernseher zeigt Szene, Karte, Initiative und die gemeinsame Dramaturgie.
- Jedes Handy steuert genau eine Figur und sendet Aktionen oder Würfe.
- Nur der Gemeinschaftstisch spielt standardmässig Stimmen ab.

## Session vorbereiten

1. Lege in der Kampagne die gewünschten Spielerfiguren an. Vier Figuren sind
   ein guter Standard, aber keine feste Grenze.
2. Starte die Session und öffne den Gemeinschaftstisch.
3. Übertrage diesen Browser-Tab mit Chrome auf den Chromecast und aktiviere
   `Vollbild` im Tisch-Header.
4. Wähle `Spieler verbinden`. Für jede freie Figur erscheint ein eigener QR-Code.
5. Jede Person scannt den QR-Code ihrer Figur. Das Handy verbindet sich ohne
   Authelia-Login und bleibt an diese Figur gebunden.

## Während des Spiels

- Aktionen und Würfe werden serverseitig angenommen und an alle Ansichten
  gestreamt. Solange Codex einen Zug auswertet, sind weitere Aktionen gesperrt.
- Der Handy-Composer steht oben im Aktionsbereich; Vorschläge und Schnellwürfel
  sind optional darunter.
- Bei einem Verbindungsabbruch verbindet sich der Companion automatisch neu und
  lädt verpasste Ereignisse aus dem EventLog nach.

## Handy ersetzen oder neu koppeln

Öffne am Fernseher erneut `Spieler verbinden`, wähle bei der Figur
`Neu koppeln` und bestätige. Der alte Handy-Zugang wird sofort ungültig und ein
neuer QR-Code wird ausgestellt.

## Netzwerkhinweise

- Chromecast, Tisch-Browser und Handys müssen die öffentliche `APP_DOMAIN`
  erreichen können. Eine reine Docker-interne Adresse funktioniert für QR-Codes
  nicht.
- Die Invite-Route muss in Traefik eine höhere Priorität als die
  Authelia-geschützte Standardroute besitzen.
- Redis wird für sichere DM-Zug-Sperren und Live-Events benötigt. Fällt Redis
  aus, nimmt die App keinen neuen Codex-Zug an, statt zwei DMs parallel laufen zu
  lassen.
