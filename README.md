# Plum Tabletop — D&D WebUI with Codex DM

Self-hosted D&D 5e virtual tabletop where **Codex (GPT-5)** sits behind the
DM screen. Worldbuilding, NPC/location assets, combat, narrative, and SRD
lookups are driven by the model. Inspired by Roll20 + Foundry VTT + BG3.

> **Status:** Core WebUI production-hardening pass. The shipped surface covers
> campaign setup, SRD lookup, worldbuilding, asset monitoring, invites,
> character sheets, live cinematic play, tactical combat, dice, and DM settings.

---

## Architecture

```
┌─ Browser (Cinematic + PixiJS Tactical) ──┐
└───────────────┬──────────────────────────┘
                │ HTTPS via Traefik
                ▼
        ┌─ Authelia ForwardAuth ─┐  (DM + auth'd players)
        │  …or HMAC invite path  │  (guests via /play/invite/<token>)
        └───────────┬────────────┘
                    ▼
            ┌─ Next.js App ─┐
            │ ┌─ Tools API ─┤──► OpenAI (gpt-5 + function calls)
            │ ├─ Game state ┤──► Postgres + pgvector
            │ └─ Job queue ─┼──► Redis ──► BullMQ Worker ──► Codex CLI imagegen / gpt-image-2
            └───────┬───────┘                                       └─► MinIO
                    ▼
              Postgres / Redis / MinIO
```

## Tech stack

- **Frontend** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind · PixiJS · Framer Motion · Zustand
- **Backend** Next.js API routes + Server Actions · BullMQ worker
- **AI** Codex CLI or OpenAI SDK · `gpt-5` (DM) · `gpt-image-2` (cloud assets) · `text-embedding-3-large` (SRD)
- **Asset** pregenerated monster/NPC pack · Codex CLI imagegen / gpt-image-2
- **Data** Postgres 16 + pgvector + pg_trgm + citext · Redis 7 · MinIO (S3)
- **Infra** Docker Compose · existing Traefik + Authelia stack

---

## Setup (Unraid / Docker-Compose)

### Prerequisites

- Existing **Traefik** instance with `letsencrypt` certresolver
- Existing **Authelia** registered as `authelia@docker` middleware
- A docker network named `traefik_proxy` (`docker network create traefik_proxy` if not yet)
- An Authelia group whose members should be DMs (default: `dnd-dms`)
- DNS for two hostnames pointing at Traefik:
  - `dnd.example.tld` — the app
  - `assets.dnd.example.tld` — public asset bucket
  - _(optional)_ `minio.dnd.example.tld` — MinIO admin console

### 1. Configure environment

```bash
cp .env.example .env
# generate secrets
echo "SECRET_BOX_KEY=$(openssl rand -hex 32)"     >> .env
echo "INVITE_HMAC_SECRET=$(openssl rand -hex 32)" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"  >> .env
echo "MINIO_ROOT_USER=dndminio"                   >> .env
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "APP_DOMAIN=dnd.example.tld"                 >> .env
echo "ASSETS_DOMAIN=assets.dnd.example.tld"       >> .env
echo "MINIO_CONSOLE_DOMAIN=minio.dnd.example.tld" >> .env
echo "AUTHELIA_DM_GROUP=dnd-dms"                  >> .env
# if your existing Traefik stack uses different names:
echo "TRAEFIK_NETWORK=traefik_proxy"              >> .env
echo "TRAEFIK_CERTRESOLVER=letsencrypt"           >> .env
echo "TRAEFIK_AUTHELIA_MIDDLEWARE=authelia@docker" >> .env
```

`CODEX_MODEL_DM` and `CODEX_REASONING_EFFORT_DM` are installation defaults.
A DM's model and reasoning effort saved in `/dm/settings` override them on the
next Codex DM call without a restart. OpenAI fallback settings and asset image
generation remain separate.

### 2. Configure Authelia

Add an access-control rule that protects the DM/players surface but lets
guest invite paths and health checks through:

```yaml
# authelia/configuration.yml
access_control:
  rules:
    - domain: dnd.example.tld
      resources:
        - "^/api/health$"
        - "^/play/[^/]+/?$" # legacy invite links
        - "^/play/invite/.*"
        - "^/api/invite/sessions/.*"
      policy: bypass
    - domain: dnd.example.tld
      policy: two_factor
      subject: "group:dnd-dms"
    - domain: dnd.example.tld
      policy: two_factor # other authenticated players
```

> _Adjust to your auth posture — `one_factor` is fine for trusted home setups._

The Traefik labels already wire Authelia's `Remote-User`, `Remote-Email`,
`Remote-Groups`, `Remote-Name` headers into upstream requests.

### 3. Boot

```bash
docker compose build
docker compose up -d
docker compose run --rm worker npx prisma migrate deploy
docker compose run --rm worker npm run srd:sync
```

`srd:sync` can run without `OPENAI_API_KEY`; in that mode it imports typed SRD
records for exact/trigram lookup and leaves embeddings empty. Re-run it with a
global `OPENAI_API_KEY` later to populate semantic embeddings.

The reusable pregenerated asset pack is shipped under `public/assets/pregen`
and is copied into the web image during build. Generate or refresh that pack on
the host before building the image.

Check health:

```bash
curl -s https://dnd.example.tld/api/health | jq
```

The pregenerated asset pack writes reusable monster tokens and NPC archetype
portraits/tokens under `public/assets/pregen`. Runtime campaign generation
reuses those files first and only queues bespoke assets when the pack has no
match.

### 4. Promote yourself to DM

Either add your Authelia user to the `dnd-dms` group, **or** flip the bit
directly in Postgres after first login:

```bash
docker compose exec postgres psql -U dnd -d dnd \
  -c "UPDATE \"User\" SET \"isDM\" = TRUE WHERE username = 'yourname';"
```

---

## Auth model

| Route                                            | Auth                                       |
| ------------------------------------------------ | ------------------------------------------ |
| `/`, `/dm/*`, `/campaigns/*`                     | **Authelia** ForwardAuth via Traefik       |
| `/play/invite/<token>`, `/api/invite/sessions/*` | **HMAC invite token** in URL (no Authelia) |
| `/api/health`                                    | Public (for monitoring)                    |
| `minio.<domain>` (console)                       | Authelia                                   |
| `assets.<domain>` (read bucket)                  | Public read                                |

DMs are Authelia users in the `dnd-dms` group. Players can either be
Authelia users _or_ anonymous guests joining via an invite link that the DM
generates from inside the app.

---

## Local development (without the full stack)

```bash
cp .env.example .env
docker compose up -d postgres redis minio minio-init
npm install
npx prisma migrate dev
npm run dev
```

In dev, Authelia isn't in front of the app — you can either set
`Remote-User: yourname` via your browser (e.g. `ModHeader`) or stub it
with a `.env.local` override.

---

## Roadmap

| Phase | Focus                                                                              |
| ----- | ---------------------------------------------------------------------------------- |
| 0     | Foundation: Next.js, Docker, Traefik/Authelia, Prisma                              |
| 1     | SRD ingest + pgvector RAG + SRD browser UI                                         |
| 2     | DM-engine MVP: tool loop, worldbuilding wizard, chat + dice                        |
| 3     | Asset pipeline: pregenerated pack, BullMQ worker, Codex CLI imagegen / gpt-image-2 |
| 4     | Cinematic view: backgrounds, NPC portraits, character sheet                        |
| 5     | Tactical view: PixiJS map, tokens, fog of war, combat                              |
| 6     | Production polish: mobile player, errors, backups, docs                            |
| 7     | Multiplayer: WebSocket sync, invite flow, spectator                                |
| 8     | Closed beta                                                                        |

---

## License

TBD — private project.
