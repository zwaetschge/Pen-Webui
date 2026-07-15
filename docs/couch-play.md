# Couch-Play mit Chromecast und vier Handys

Plum Tabletop funktioniert zuhause wie eine kleine Koop-Konsole:

- Firefox ist die Host-Konsole für TV, Spielerplätze, Journal und Stimmen.
- Der Chromecast zeigt nur die gemeinsame, lesbare 16:9-Bühne.
- Jedes Handy steuert genau eine Figur und sendet Aktionen oder Würfe.
- Codex bleibt der gemeinsame DM; die Handys benötigen keinen Authelia-Login.

## Einmalige Einrichtung

Der Dienst `cast-agent` läuft im Host-Netzwerk, damit er Google-Cast-Geräte per
mDNS im Heimnetz findet. Next.js spricht mit ihm nur über den gemeinsamen
Unix-Socket; es wird kein zusätzlicher TCP-Port geöffnet.

```bash
docker compose up -d --build cast-agent web
docker compose ps cast-agent web
```

Falls das WLAN Multicast zwischen Docker-Host und Chromecast blockiert, trage
eine oder mehrere feste Geräte-IP-Adressen in `.env` ein und starte den Agenten
neu:

```dotenv
CHROMECAST_HOSTS=192.168.1.52,192.168.1.53
```

```bash
docker compose up -d --force-recreate cast-agent
```

## Eine Runde starten

1. Lege in der Kampagne die vier gewünschten Spielerfiguren an.
2. Starte die Session und öffne die Host-Konsole in Firefox.
3. Wähle `TV-Ausgabe`. Die Konsole listet die im Heimnetz gefundenen
   Chromecasts auf.
4. Wähle beim Wohnzimmer-TV `Auf diesem TV starten`. Der Server öffnet dort
   automatisch eine signierte, nur lesbare Bühne; Tab-Spiegelung ist nicht
   nötig.
5. Wähle `Spieler`. Für jede Figur erscheint ein eigener QR-Code.
6. Jede Person scannt den Code ihrer Figur. Nach der Zuweisung wird der Code
   gesperrt, damit zwei Geräte nicht dieselbe Figur übernehmen.

Wenn kein Chromecast erreichbar ist, öffnet `Dieses Gerät als Bildschirm` die
Host-Ansicht im Vollbild. Das ist auch der einfachste Fallback für einen per HDMI
angeschlossenen Fernseher.

## Während des Spiels

- Der Fernseher zeigt Ort, Dialog, Auftakt, Karte und Kampfzustand ohne
  Host-Schaltflächen. Stimmen werden dort automatisch abgespielt.
- Die Handys zeigen Figur, aktuelle Szene, vorgeschlagene Aktionen, Composer und
  Würfel. Die TV-Fläche bleibt dadurch frei.
- Während Codex eine Aktion auswertet, können die anderen Personen ihre nächste
  Aktion bereits vormerken. Der Server verarbeitet diese Exploration-Aktionen
  in Eingangsreihenfolge. Im Kampf gilt weiterhin strikt die Initiative.
- Bei einem Verbindungsabbruch verbindet sich jede Ansicht automatisch neu. Ein
  aktueller Bühnen-Bootstrap wird auch nach langen Sessions mit vielen Events
  erneut geliefert.

## Handy ersetzen oder Zugriff entziehen

Öffne `Spieler`, wähle bei der Figur `Zuweisung zurücksetzen` und bestätige. Der
alte Handy-Zugang wird sofort ungültig und ein neuer QR-Code wird ausgestellt.
`Zugewiesen` bedeutet bewusst nur, dass ein Gerät den Platz beansprucht hat; die
App behauptet nicht, dass dieses Gerät gerade online ist.

## Netzwerk und Sicherheit

- Chromecast, Host und Handys müssen die öffentliche HTTPS-`APP_DOMAIN`
  erreichen können. Eine Docker-interne Adresse funktioniert weder im QR-Code
  noch im Cast-WebView.
- Die Traefik-Routen für `/play/invite/...` und `/display/sessions/...` umgehen
  Authelia nur deshalb, weil sie eigene signierte Fähigkeiten prüfen. Die
  normale Host-Konsole bleibt Authelia-geschützt.
- Eine TV-Fähigkeit ist an genau eine Session gebunden, läuft nach 16 Stunden ab
  und sieht nur den spielersicheren Event-Stream. Verdeckte Würfe und DM-interne
  Ereignisse werden nicht an den Fernseher übertragen.
- Redis schützt den einzelnen Codex-DM-Turn und hält die begrenzte Warteschlange
  für gleichzeitige Exploration-Aktionen. Fällt Redis aus, lehnt die App neue
  Aktionen kontrolliert ab, statt zwei DM-Läufe parallel zu starten.

## Fehlerdiagnose

```bash
docker compose logs --tail=200 cast-agent
docker compose restart cast-agent
```

| Anzeige                            | Prüfen                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Cast-Dienst ist nicht erreichbar` | Läuft `cast-agent`, ist der Socket-Volume gemountet, stimmen `INVITE_HMAC_SECRET` und `APP_DOMAIN`? |
| Kein Gerät gefunden                | Gleiches LAN/VLAN, mDNS-Freigabe und optional `CHROMECAST_HOSTS` prüfen.                            |
| TV öffnet die Seite nicht          | Der Chromecast muss `https://APP_DOMAIN/display/...` inklusive Zertifikat und DNS erreichen.        |
| Spieler sieht Authelia             | Traefik-Priorität der Invite-Route muss über der Standardroute liegen.                              |
