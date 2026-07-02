# Auth: Traefik + Authelia integration

Two coexisting auth paths.

## Path A — Authelia (DM + authenticated players)

```
Browser ──► Traefik ──ForwardAuth──► Authelia
            │                         │
            │   Remote-User           │
            │   Remote-Email          │
            │   Remote-Groups   ◄─────┘
            │   Remote-Name
            ▼
        Next.js  (lib/auth.ts reads headers, upserts User row)
```

Traefik routers (in `docker-compose.yml`):

- `dnd-web` — `Host(APP_DOMAIN)` · priority 10 · middleware `authelia@docker`
- `dnd-web-invite` — `(PathPrefix(/play/) && !PathPrefix(/play/sessions/)) || PathPrefix(/api/invite/sessions/)` · priority 100 · **no** authelia middleware
- `dnd-web-health` — `Path(/api/health)` · priority 200 · **no** authelia middleware

Higher priority wins, so the invite/health routes are matched before the
catch-all `dnd-web` rule that has Authelia in front.

### Setting up Authelia

1. Create the `dnd-dms` group (or whatever you set `AUTHELIA_DM_GROUP` to).
2. Add yourself to it.
3. Add access-control rules (see README).
4. Confirm the `authelia@docker` middleware exists and is reachable.

### Verifying

```bash
# from a host that can reach Traefik internally
curl -H "Remote-User: testuser" -H "Remote-Groups: dnd-dms" \
     https://dnd.example.tld/dm
```

If the request reaches Next.js without going through Traefik (i.e. you
forge headers), the `src/middleware.ts` defence-in-depth check rejects
it on `/dm` and `/api/dm` paths because Traefik strips client-supplied
`Remote-*` headers when Authelia is enforcing.

### Header stripping caveat

**Important:** make sure your Traefik / Authelia config strips
client-supplied `Remote-*` headers on the entrypoint before
`ForwardAuth` injects fresh ones. Otherwise a malicious client could
just send `Remote-User: admin`. Authelia's official Traefik integration
does this correctly by default, but verify with:

```bash
curl -H "Remote-User: ghost" https://dnd.example.tld/api/health
# 'ghost' should NOT appear in app logs
```

## Path B — HMAC invite token (guests)

```
DM creates invite ──► token = `<id>.<exp>.<hmac>` ──► sent via Signal/email
                                                       │
Player ──► https://dnd.example.tld/play/invite/<token> ──►   ▼
                                                Traefik routes via
                                                `dnd-web-invite` (no Authelia)
                                                       │
                                                       ▼
                                                Next.js verifies token
                                                via lib/invite.ts
                                                (HMAC + DB check)
                                                       │
                                                       ▼
                                                Claim route consumes Invite
                                                and sets a session-scoped
                                                HttpOnly guest cookie
```

- Token format `<inviteId>.<unix-exp>.<base64url-hmac>`
- HMAC key: `INVITE_HMAC_SECRET`
- DB row in `Invite` table is canonical (revocation, single-use enforced
  via `usedAt`).
- After claim, live session access is authorized by the `plum_guest_<sessionId>`
  cookie. The original invite URL remains a route hint, not the long-lived
  bearer credential.

### Why DB + HMAC?

HMAC alone would make tokens uncopyable but uncancellable. DB alone
would require a DB lookup on every request even for invalid tokens.
Combined: fast reject on bad HMAC, real-time revocation via DB.

## Failure modes

| Symptom                                    | Likely cause                                         |
| ------------------------------------------ | ---------------------------------------------------- |
| `/dm` → blank 401                          | Authelia middleware not applied; check labels        |
| `/play/invite/<x>` → Authelia login screen | Route priority mis-set; invite route < 100           |
| Headers present but `isDM` false           | User not in `AUTHELIA_DM_GROUP`                      |
| `getSessionUser()` returns null            | Authelia header name mismatch (`Remote-User` casing) |
