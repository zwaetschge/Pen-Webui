# Console Casting Design

## Product outcome

Plum Tabletop behaves like a couch console instead of a browser tab:

- The host uses Firefox as the control center.
- The Chromecast renders a dedicated, read-only 16:9 stage.
- Players scan per-character QR codes and use their phones as controllers.
- Codex remains the authoritative DM and all screens follow the same event log.

The host must not need Chrome, Google Home screen mirroring, or a second login on
the Chromecast.

## Experience model

### Host console

`/table/sessions/:id` remains the host entry point. Its top bar becomes a compact
console command rail with three primary actions: connect the TV, connect players,
and open the journal. Secondary controls such as view, voices, and fullscreen are
grouped separately. The local stage remains useful before a TV is connected, but
audio is silenced while an active TV output is known to avoid double playback.

### TV stage

`/display/sessions/:id/:token` is a public-by-capability, read-only receiver page.
It contains only the cinematic/tactical stage, intro playback, connection state,
and TV-safe spacing. It has no roll, turn, movement, pairing, voice, journal, or
cast controls. Its event projection is the existing player-safe projection, so DM
events, hidden rolls, world state, and private character fields never reach it.

### Phone controller

The existing per-character pairing flow remains the authority for seats. Its UI
is restyled as controller slots, and the companion view emphasizes the character
status, current prompt, suggested actions, and large touch targets. The phone is
the only place where a player submits actions during normal couch play.

## Server-side Chromecast path

A small Python service runs PyChromecast on the Docker host network so mDNS can
discover devices on the home LAN. The service does not expose a TCP port. Next.js
talks to it over a shared Unix socket using authenticated JSON requests. Device
discovery is automatic, with optional known IPs for networks where multicast is
blocked.

The agent API is intentionally small:

- `GET /v1/health`
- `GET /v1/devices`
- `POST /v1/casts` with `{ "deviceId": "...", "url": "..." }`
- `DELETE /v1/casts/:deviceId`

The browser-facing host API is:

- `GET /api/sessions/:id/cast`
- `POST /api/sessions/:id/cast` with `{ "deviceId": "..." }`
- `DELETE /api/sessions/:id/cast` with `{ "deviceId": "..." }`

Only the campaign host may use these routes. The browser never supplies the URL
that the agent opens. Next.js creates it from `APP_URL` and a signed display
capability.

## Display capability

The display token is a versioned, HMAC-signed payload containing only session id,
expiry, and scope. It is domain-separated from invite tokens while reusing the
deployment HMAC secret. Tokens last 16 hours, are bound to one session, and are
accepted only by display page/stream routes. They are never passed into
`resolveAccess`, so no mutation endpoint can accidentally recognise a TV as a
player.

Traefik bypasses Authelia only for `/display/sessions/` and
`/api/display/sessions/`. Token validation remains the application-level access
boundary.

## State and recovery

The TV stream always receives the latest session bootstrap plus the recent event
tail, even when the session has produced more than the ordinary replay limit.
Expired or invalid receiver tokens show a stable unavailable screen instead of an
endless reconnect loop. If the cast agent is offline, the host console clearly
reports that server casting is unavailable and keeps local fullscreen as a
fallback.

## Opening text repair

The player-facing filter rejects both direct imperatives and prefixed DM/staging
directions. Bootstrap is advanced to a new version so already-running sessions
archive their stale intro events and rebuild the opening. The scene title is
German, three valid generated beats are not padded with generic filler, and
fallback titles are deterministic and distinct.

## Deployment

`cast-agent` uses `network_mode: host` only for LAN discovery and shares a named
runtime volume with `web` for its Unix socket. The image pins PyChromecast. The
service starts with the normal Compose stack and can be disabled gracefully by
not mounting/reaching its socket in development.

## Verification

- Unit tests cover token tampering/expiry/session binding, host-only cast routes,
  agent request validation, player-safe display projection, and intro migration.
- Python tests cover agent authentication, URL allow-listing, discovery payloads,
  and start/stop with mocked Cast devices.
- Browser QA covers the host cast dialog, 1280x720 TV stage, and a phone viewport.
- Docker validation confirms Compose rendering, agent health, and LAN discovery.
