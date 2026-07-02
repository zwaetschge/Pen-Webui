# Vocarium TTS Design

## Ziel

Plum Tabletop soll Nachrichten per Vocarium TTS vorlesen koennen. Stimmen
werden kampagnenweit zugewiesen und aus der Clone-Voice-Library des
Kampagnen-Hosts geladen. Fuer die aktuelle reale Kampagne bedeutet das:
Vocarium wird mit `Remote-User: zwaetschge` abgefragt, nicht mit dem
Standard-Tenant `api`.

Die Integration soll das Spielgefuehl verbessern, ohne den GameRoom wieder zu
einem Dashboard zu machen. TTS-Bedienung gehoert direkt an die RenPy-artige
Dialogbox und an vorlesbare Chat-Nachrichten.

## Nicht-Ziele

- Keine Voice-Cloning-Erstellung in Plum Tabletop.
- Keine direkte Vocarium-URL oder Tenant-Logik im Browser.
- Keine Pflicht-Autoplay-Funktion fuer alle Spieler.
- Keine Audio-Generierung im DM-Turn-Loop, damit Spielzuege nicht durch GPU
  oder Queue-Latenz blockieren.
- Keine CI-Abhaengigkeit von einer live verfuegbaren GPU.

## Architektur

Die D&D-App stellt eine serverseitige TTS-Fassade bereit:

1. Der Client fordert Voice-Listen, Voice-Zuweisungen und Nachrichtenaudio ueber
   Plum-Tabletop-Endpoints an.
2. Der Server ermittelt den Kampagnen-Host und nutzt dessen `username` als
   Vocarium-`Remote-User`.
3. Clone-Voices werden ueber Vocarium `/v1/voices?source=clone` geladen.
4. TTS wird ueber Vocarium `/v1/audio/speech` erzeugt. Gesendet wird die echte
   `voice_id`, nicht nur ein Anzeigename wie `Michael Scott`.
5. Erzeugte Audiodateien werden in der Datenbank gecacht und nur ueber
   zugriffsgeschuetzte D&D-Session-Endpoints ausgeliefert.

Dieses Muster passt zur bestehenden Architektur: Session-Zugriff laeuft ueber
`resolveAccess`, persistenter Zustand ueber Prisma, und der Browser darf nur
serverautorisierte Session-Ressourcen verwenden.

## Voice-Tenant-Regel

Voice-Kataloge und TTS-Aufrufe verwenden immer den Kampagnen-Host:

```text
vocariumUser = session.campaign.host.username
```

Beispiel: Fuer Host `zwaetschge` stehen Clone-Voices wie `Michael Scott`
(`83b59aca`) und `Maurice Moss` (`2abffe14`) zur Verfuegung. Der Tenant `api`
liefert diese Stimmen nicht.

## Datenmodell

### VoiceAssignment

Kampagnenweite Voice-Zuweisung fuer vorlesbare Sprecher.

Felder:

- `id`
- `campaignId`
- `targetType`: `narrator`, `npc`, `character`
- `targetId`: NPC-ID, Character-ID oder fester Wert fuer den Erzaehler
- `vocariumUser`: Host-Username zum Zeitpunkt der Zuweisung
- `voiceId`: echte Vocarium-Voice-ID
- `voiceName`: Anzeigename zur UI-Darstellung
- `voiceSource`: initial immer `clone`
- `createdAt`, `updatedAt`

Constraint:

- eindeutig pro `campaignId`, `targetType`, `targetId`

### TtsAudioCache

Cache fuer erzeugtes Audio einer konkreten Nachricht.

Felder:

- `id`
- `sessionId`
- `eventId`
- `voiceId`
- `textHash`
- `audio`: Audiodaten als Prisma `Bytes`
- `mimeType`: z.B. `audio/wav` oder `audio/mpeg`
- `byteLength`
- `status`: `ready` oder `failed`
- `error`: kurze Fehlermeldung fuer Diagnose ohne Secrets
- `createdAt`, `updatedAt`

Constraint:

- eindeutig pro `sessionId`, `eventId`, `voiceId`, `textHash`

## API

### `GET /api/campaigns/[id]/voices`

Listet Clone-Voices des Kampagnen-Hosts.

Antwort enthaelt:

- `voiceId`
- `name`
- `language`
- `source`
- `vocariumUser`

### `GET /api/campaigns/[id]/voice-assignments`

Liest alle Voice-Zuweisungen einer Kampagne. Zugriff nur fuer
Kampagnenmitglieder bzw. Session-Mitglieder ueber bestehende Auth-Regeln.

### `PUT /api/campaigns/[id]/voice-assignments`

Speichert eine oder mehrere Voice-Zuweisungen.

Berechtigung:

- Host/DM darf `narrator`, `npc` und alle `character`-Ziele setzen.
- Ein Spieler darf nur die eigene Figur setzen, wenn die Figur der Session
  eindeutig zugeordnet ist.

### `POST /api/sessions/[id]/tts`

Erzeugt oder findet Audio fuer eine Nachricht.

Request:

- `eventId`

Serverlogik:

1. Zugriff ueber `resolveAccess` pruefen.
2. `EventLog`-Eintrag laden.
3. Sprecher und Text aus dem Event ableiten.
4. Voice-Zuweisung in dieser Reihenfolge aufloesen:
   - passender NPC
   - passende Spielerfigur
   - Erzaehler-Zuweisung
   - Vocarium `default`
5. Cache-Key aus `sessionId`, `eventId`, `voiceId`, `textHash` bilden.
6. Cache-Hit sofort zurueckgeben.
7. Bei Cache-Miss Vocarium `/v1/audio/speech` mit Host-`Remote-User` aufrufen.
8. Audio-Bytes speichern und Cache-Datensatz als `ready` markieren.

### `GET /api/sessions/[id]/tts/[cacheId]`

Streamt gecachtes Audio nach erneuter Session-Zugriffspruefung.

## UI und Bedienung

### Cinematic/RenPy-Dialog

Die Dialogbox erhaelt einen kleinen Play/Stop-Button an der Sprecherplakette.
Ein Klick liest genau die sichtbare Zeile mit der aufgeloesten Stimme vor.

Optional gibt es eine lokale `Auto`-Umschaltung fuer neue DM-/NPC-Zeilen. Diese
Einstellung wird im Browser gespeichert und ist standardmaessig aus.

### ChatLog

Vorlesbare Nachrichten erhalten denselben kompakten Play/Stop-Button. Beim
Laden wird ein klarer Pending-Zustand gezeigt; bei Fehlern bleibt der Text
lesbar und der Button kehrt in einen sicheren Zustand zurueck.

### Voice-Auswahl

Die Voice-Auswahl sitzt in einem In-Game-Menue `Stimmen`, nicht als grosses
Dashboard. Gruppen:

- Erzaehler
- Spielerfiguren
- NPCs am aktuellen Schauplatz

Die UI zeigt Anzeigenamen wie `Michael Scott`, `Maurice Moss` oder `Rufus Beck`,
speichert aber intern die echte `voiceId`.

## Fehlerverhalten

- Vocarium nicht erreichbar: UI zeigt Fehler am Play-Button, Spiel bleibt
  bedienbar.
- GPU/Queue blockiert: keine Blockade des DM-Turns; der Nutzer kann spaeter
  erneut abspielen.
- Keine Zuweisung vorhanden: Fallback auf Erzaehler-Voice, danach auf
  Vocarium `default`.
- Voice geaendert: neuer Cache-Key durch andere `voiceId`; alte Audios bleiben
  gueltig fuer alte Wiedergaben, werden aber nicht fuer neue Voice-Zuordnungen
  wiederverwendet.
- Fehlerhafte Cache-Eintraege erhalten `failed`, damit nicht endlos identische
  Generierungsversuche laufen.

## Tests und Verifikation

Automatisiert:

- Unit-Tests fuer Voice-Resolution: NPC, Charakter, Erzaehler, Fallback.
- API-Tests mit gemocktem Vocarium-Fetch fuer Voice-Liste, Assignment und
  TTS-Cache.
- UI-Tests fuer Play/Stop, Loading/Error und responsive Voice-Auswahl.
- Typecheck, Lint, Vitest und Build.

Manuell:

- Vocarium-Voice-Liste mit `Remote-User: zwaetschge` pruefen.
- Kurze TTS-Smoke-Zeile mit einer Clone-Voice erzeugen, sofern GPU/Preflight
  es erlaubt.
- GameRoom in Desktop und Mobile pruefen: kein Layout-Overflow, Play-Button
  bedienbar, Fehlerzustand sichtbar.

## Speicherentscheidung

Die bestehende MinIO-Hilfsfunktion erstellt den Asset-Bucket mit public-read
Policy, was fuer sessiongebundenes Chat-/Story-Audio nicht passend ist. Die
erste TTS-Version speichert Audio deshalb als Prisma `Bytes` in
`TtsAudioCache` und streamt es ausschliesslich ueber
`GET /api/sessions/[id]/tts/[cacheId]` nach `resolveAccess`.

Live-TTS wird nicht Teil der CI, weil GPU-Zustand und Vocarium-Queue nicht
deterministisch sind.
