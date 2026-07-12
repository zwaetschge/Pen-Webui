# Plum Tabletop - D&D WebUI with Codex DM

Plum Tabletop is a self-hosted D&D 5e virtual tabletop where **Codex
(GPT-5)** acts as the Dungeon Master. It combines a cinematic game room,
PixiJS tactical combat, SRD lookup, campaign worldbuilding, AI-assisted asset
generation, dice, invites, character sheets, and optional Vocarium voice
playback.

> **Status:** The current app surface covers campaign setup, DM settings, SRD
> search, worldbuilding, asset monitoring, player invites, character creation,
> live cinematic play, tactical maps, combat actions, dice rolls, and TTS
> playback controls.

---

## What you can do

- Create a D&D campaign from a guided worldbuilding prompt.
- Let the Codex DM narrate scenes, call tools, roll dice, move encounters
  forward, and look up SRD mechanics instead of improvising rules from memory.
- Play in one room that blends cinematic narration, chat, scene art, NPC
  portraits, party state, tactical maps, tokens, initiative, dice, and combat
  actions.
- Invite authenticated players or guest players with campaign-scoped links.
- Generate or reuse campaign assets: monster tokens, NPC portraits, location
  backgrounds, tactical maps, and item icons.
- Assign Vocarium voices to NPCs or narration targets and play generated audio
  from the chat log.
- Keep the full game history in an append-only event log so clients can replay
  session state and reconnect safely.

## Main app surfaces

| Area | What it is for |
| --- | --- |
| `/dm` | DM campaign list and campaign creation |
| `/dm/settings` | DM model, API key, image, terminal, and runtime settings |
| `/campaigns/[id]` | Campaign overview, characters, invites, sessions, assets |
| `/campaigns/[id]/assets` | Asset queue and retry dashboard |
| `/play/sessions/[id]` | Authenticated live game room |
| `/play/invite/[token]` | Guest invite flow |
| `/srd` | Search and browse indexed D&D 5.1 SRD content |

## Game flow

1. The DM signs in and opens `/dm`.
2. The DM configures model and asset settings in `/dm/settings`.
3. The DM creates a campaign and uses the worldbuilding wizard to generate a
   world, NPCs, locations, items, encounters, scenes, and asset jobs.
4. Players create or claim characters from the campaign page.
5. The DM starts a session. The game room streams history, then live events.
6. Player input posts to the session turn endpoint. The server records the
   input, starts a DM turn, and the Codex DM may narrate, call tools, consult
   SRD, update scenes, move tokens, roll dice, or queue assets.
7. Clients never mutate authoritative game state directly; they ingest server
   events and reduce them into the visible game room.

## Architecture

```
Browser game room
  |  SSE replay + live events, player actions, dice, TTS playback
  v
Next.js app routes and API routes
  |-- Codex/OpenAI DM turn loop + SRD tool calls
  |-- Postgres event log, campaigns, characters, assets, voices
  |-- Redis pub/sub for active sessions
  |-- BullMQ asset worker
  |-- MinIO/S3 campaign asset storage
  `-- Vocarium gateway for optional speech generation
```

The important runtime rule is server-authoritative state: every meaningful
game change is persisted as an `EventLog` row and broadcast on a session
channel. The browser rebuilds chat, scene, combat, token, and audio state from
those events.

## Tech stack

- **Frontend:** Next.js 15 App Router, React 19, TypeScript, Tailwind, PixiJS,
  Framer Motion, Zustand
- **Backend:** Next.js API routes, Prisma, BullMQ worker, Redis pub/sub
- **AI:** Codex CLI or OpenAI API for the DM, `gpt-image-2` for cloud image
  assets, `text-embedding-3-large` for SRD embeddings
- **Game data:** Postgres 16, pgvector, pg_trgm, citext
- **Assets:** MinIO/S3, pregenerated monster/NPC pack, generated campaign art
- **Audio:** optional Vocarium TTS gateway
- **Packaging:** Docker Compose

## Quick start

Install dependencies:

```bash
npm install --include=dev
npx prisma generate
```

Create local configuration:

```bash
cp .env.example .env
```

Then replace the placeholder values in `.env`. These are the minimum secrets
that should be unique per install:

```bash
openssl rand -hex 32 # SECRET_BOX_KEY
openssl rand -hex 32 # INVITE_HMAC_SECRET
openssl rand -hex 24 # POSTGRES_PASSWORD
openssl rand -hex 24 # MINIO_ROOT_PASSWORD
```

Run the stack:

```bash
docker compose build
docker compose up -d
docker compose run --rm worker npm run db:migrate:deploy
docker compose run --rm worker npm run srd:sync
```

For local Next.js development, point `.env` at reachable Postgres, Redis, and
S3/MinIO services, then use the dev auth bypass:

```bash
DEV_AUTH_USER=dm DEV_AUTH_NAME="Dungeon Master" DEV_AUTH_GROUPS=dnd-dms npm run dev
```

The development server listens on `http://localhost:3000`.

## First DM checklist

`CODEX_MODEL_DM` and `CODEX_REASONING_EFFORT_DM` are installation defaults.
A DM's model and reasoning effort saved in `/dm/settings` override them on the
next Codex DM call without a restart. OpenAI fallback settings and asset image
generation remain separate.

1. Open `/dm/settings`.
2. Choose the DM runtime:
   - `codex-cli` uses the Codex/ChatGPT login available inside the container.
   - `openai-api` uses an OpenAI-compatible API key and model settings.
3. Add an OpenAI key only if you want API fallback, embeddings, or API-billed
   image generation. User keys are encrypted at rest.
4. Run `npm run srd:sync` once so the DM and SRD browser can search D&D 5.1
   rules content.
5. Optionally refresh the reusable asset pack:

```bash
npm run assets:pregen -- --quality medium
```

6. Create a campaign, run worldbuilding, wait for assets, add characters, and
   start a session.

Für eine Runde zuhause mit Chromecast und persönlichen Handy-Companions siehe
[Couch-Play mit Fernseher und vier Handys](docs/couch-play.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the local Next.js dev server |
| `npm run build` | Build the production app |
| `npm start` | Start the built app |
| `npm run lint` | ESLint with zero warnings |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright browser tests |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Local Prisma migration dev flow |
| `npm run db:migrate:deploy` | Apply committed migrations |
| `npm run srd:sync` | Clone, parse, classify, embed, and upsert SRD data |
| `npm run assets:pregen` | Generate reusable monster/NPC assets |
| `npm run worker` | Run the BullMQ asset worker |

Locally, run Vitest with the pinned binary when needed:

```bash
./node_modules/.bin/vitest run
```

## AI, SRD, and assets

The DM loop is tool-driven. Player turns are saved first, then `runDmTurn`
calls the model with a system prompt and a live campaign digest. Tool calls
emit events, and those events are what update the clients.

SRD lookup is intentionally first-class. The DM is prompted to call
`lookup_srd` for D&D mechanics instead of reciting rules from memory. `srd:sync`
works without `OPENAI_API_KEY` for lexical search; add a key when you want
semantic embeddings.

Campaign art prefers reusable pregenerated assets first. Missing bespoke
portraits, backgrounds, tactical maps, and item icons are queued through
BullMQ and stored in MinIO/S3 when complete.

## Voice playback

Vocarium support is optional. When `VOCARIUM_API_URL` points at a reachable
Vocarium gateway, the DM can assign voices to NPCs or narration targets, and
players can play generated lines from the game room. Audio is cached per
session event, voice, and text hash so repeated playback does not regenerate
the same line.

## Production notes

The compose file is built for a self-hosted deployment behind an existing
reverse proxy and identity boundary. Keep those details out of the main game
flow unless you are deploying:

- `APP_DOMAIN` is the web app host.
- `ASSETS_DOMAIN` is the public read host for generated assets.
- Guest invite routes must reach the app without forcing an interactive login.
- Authenticated DM/player routes must provide the expected `Remote-*` headers.

See [docs/auth-traefik-authelia.md](docs/auth-traefik-authelia.md) for the
full proxy/auth setup and [docs/ops.md](docs/ops.md) for operations notes.

## Roadmap

| Phase | Focus |
| --- | --- |
| 0 | Foundation: Next.js, Docker, Prisma, auth boundary |
| 1 | SRD ingest, hybrid search, SRD browser UI |
| 2 | DM-engine MVP: tool loop, worldbuilding, chat, dice |
| 3 | Asset pipeline: pregenerated pack, worker, generated art |
| 4 | Cinematic view: scenes, backgrounds, NPC portraits |
| 5 | Tactical view: PixiJS map, tokens, combat |
| 6 | Voice playback, player UX, errors, backups, docs |
| 7 | Multiplayer polish, spectators, stronger session tooling |
| 8 | Closed beta |

## License

TBD - private project.
