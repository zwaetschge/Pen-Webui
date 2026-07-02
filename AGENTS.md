# AGENTS.md

Guide for AI coding agents working in this repo. Read before editing. Pairs
with `CLAUDE.md` (project-wide context) and `README.md` (human-facing).

## What this project is

**Plum Tabletop** — self-hosted D&D 5e VTT where the DM is Codex (GPT-5 via
OpenAI API). Single-player or multiplayer. Cinematic + tactical (PixiJS) hybrid
view. Asset generation via pregenerated packs or `gpt-image-2`. Front: Next.js 15 /
React 19 / Tailwind. Back: Postgres 16 + pgvector + Redis + MinIO. Deployed
behind existing Traefik + Authelia.

## Commands

```bash
npm install --include=dev      # full install (dev deps are needed for build)
npx prisma generate            # after schema.prisma changes
npm run db:migrate             # local migrate dev
npm run db:migrate:deploy      # in production
npm run dev                    # local dev (use DEV_AUTH_USER env to bypass Authelia)
npm run build
npm test                       # vitest, ~20 unit tests
npm run test:e2e               # Playwright browser tests
npm run lint
npm run typecheck
npm run srd:sync               # clone + parse + embed SRD into pgvector
npm run assets:pregen          # generate reusable monster/NPC pack via gpt-image-2
npm run worker                 # BullMQ asset worker
```

Locally vitest must be run via `./node_modules/.bin/vitest run` — `npx vitest`
pulls v4 from the npm cache and bypasses the pinned v2. CI uses `npm test` directly.

## Runtime tooling

- The shared Claude/Codex config lives in `CLAUDE.md` and in local files under
  `~/.claude/skills/<name>/SKILL.md` and `~/.claude/agents/<name>.md`. Load a
  full skill or agent file only when the task clearly calls for it; don't bulk
  paste the registry into context.
- System Chromium is already installed at `/usr/local/bin/plum-chromium`.
  Browser env vars (`CHROME_BIN`, `BROWSER`,
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `PUPPETEER_EXECUTABLE_PATH`) point
  there. Use that wrapper for Playwright/Puppeteer; it already includes the
  Docker-safe flags. Don't install Chromium inside a coding session.
- Prefer the repo-specific guidance in this file over generic skill guidance
  when they conflict. Use skills/agents/plugins as accelerators, not as a
  reason to change the architecture.

## Repo layout (just the load-bearing bits)

```
prisma/
  schema.prisma                # 16 models, 6 enums, pgvector + citext + pg_trgm
  migrations/20260526000000_init/migration.sql   # hand-authored, ships with repo
scripts/
  sync-srd.ts                  # orchestrator: clone → parse → embed → upsert
  srd/{parse,embed,classify}.ts
  db-init.sql                  # extensions for fresh DBs (also in migration)
  backup.sh                    # daily pg_dump + minio mirror
src/
  app/                         # Next App Router
    api/                       # all server endpoints
      sessions/[id]/{stream,turn,roll}    # realtime: SSE + player actions
      dm/...                              # DM-only routes
      srd/{search,[type]/[name]}          # SRD lookup
    play/sessions/[id]/        # the unified game room (DM + player)
    dm/...                     # campaign creation + settings
    campaigns/[id]/...         # detail, assets, invites, characters
  lib/
    auth.ts                    # Authelia header reader + DEV_AUTH_USER fallback
    invite.ts                  # DB-backed invite verify
    invite-token.ts            # pure HMAC build/parse — tests import this, not invite.ts
    crypto.ts                  # libsodium-wrappers-sumo secretbox for per-user API keys
    db.ts / redis.ts / env.ts  # singletons; env() is lazy + zod-validated
    dice.ts                    # 2d6+3, advantage, kh/dl notation
    openai.ts                  # client factory using per-user encrypted key
    dm/
      tools.ts                 # the 13 OpenAI function-call tools the DM may invoke
      prompts.ts               # system prompt + worldbuild prompt
      digest.ts                # builds the live world digest for the system prompt
      memory.ts                # conversation reconstruction + rolling summary
      orchestrator.ts          # the turn loop (tool-call → execute → loop)
      worldbuild.ts            # wizard → blueprint → DB rows → queued assets
    asset/
      queue.ts                 # BullMQ producer (parses REDIS_URL → host/port for type-safety)
      pregen-catalog.ts        # reusable monster/NPC asset prompts + matching
      pregenerated.ts          # server-side resolver for static pregen assets
      openai-image.ts          # gpt-image-2
      generate.ts              # OpenAI-only asset generation wrapper
      s3.ts                    # MinIO upload + public-read bucket policy
      dimensions.ts            # per-kind target dims
    game/
      bus.ts                   # Redis pub/sub event broadcaster
      access.ts                # resolve host | authed player | invite guest → SessionMember
      store.ts                 # Zustand client store; ingest() is the SSE reducer
      useGameStream.ts         # EventSource hook
    srd/
      search.ts                # hybrid vector + trigram + RRF
      format.ts                # render hit for tool returns
      tool.ts                  # OpenAI function definition + handler
  components/game/             # GameRoom, CinematicView, TacticalMap (PixiJS),
                               # ChatLog, ActionBar, InitiativeTracker, etc.
workers/
  asset-worker.ts              # BullMQ consumer; publishes asset_ready to active session
docs/
  auth-traefik-authelia.md     # the auth flow in detail
  ops.md                       # runbook
```

## Architecture in 5 sentences

1. Every game event lives on `EventLog` (append-only) **and** broadcasts on a Redis pub/sub channel `session:<id>`.
2. The SSE endpoint at `/api/sessions/[id]/stream` replays history then forwards live events to the browser, where `useGame` (Zustand) reduces them into chat/scene/combat/tokens.
3. Player input POSTs to `/api/sessions/[id]/turn`; that endpoint persists the input event, then kicks `runDmTurn(...)` async — which calls OpenAI with the 13 DM tools, executes each tool call (every tool emits its own event into the bus), loops until the model yields.
4. The worldbuilding wizard calls GPT-5 with `WORLDBUILD_PROMPT`, parses a strict JSON blueprint with zod, persists Campaign/World/NPCs/Locations/Items/Encounters/Scenes, reuses pregenerated NPC assets where available, and enqueues BullMQ jobs for missing portraits, location backgrounds, tactical maps, and item icons.
5. Auth is two-track: Authelia ForwardAuth for DM + authenticated players (header → JIT user upsert in `lib/auth.ts`), HMAC invite tokens for guests (URL routes around Authelia via Traefik priority labels; verified in `lib/invite.ts`).

## Conventions

- **Tools that emit events**: every DM tool in `lib/dm/tools.ts` calls `ctx.emit({ type, payload })`. The orchestrator wraps `emit` so events also flow to the Redis bus + EventLog. New tools should follow the same pattern — never write directly to EventLog from a tool.
- **Server-authoritative state**: the client never mutates anything via the store unless an event came back from the server. The store's `ingest()` is the only legal entry point for state changes from network input.
- **No NextAuth.js**: auth is purely Authelia-via-header. Don't add a competing session layer.
- **API key handling**: per-user OpenAI keys are encrypted at rest with libsodium secretbox. Always go through `openaiForUser(userId)` — never read `encOpenAIKey` directly.
- **SRD discipline**: the DM model is system-prompted to call `lookup_srd` rather than recite mechanics. Eval tests will be added; do not weaken this constraint.
- **`force-dynamic` everywhere**: all routes that touch session/auth state explicitly set `dynamic = "force-dynamic"` and `runtime = "nodejs"`. Don't make API routes edge-runtime without a strong reason.
- **No emoji in UI strings**: the visual language is brass+parchment+ink, not emoji. Use SVG/glyph if needed.

## Pitfalls (we've already hit these)

- **Prisma engine** — Alpine 3.20+ has openssl 3 only. Schema includes `binaryTargets = ["native", "linux-musl-openssl-3.0.x", "linux-musl", "debian-openssl-3.0.x"]`. On hosts with only openssl 3, the query engine is auto-resolved at runtime; for local builds you may need `PRISMA_QUERY_ENGINE_LIBRARY=$(pwd)/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node`. `prisma migrate diff` won't run locally — that's why the initial migration is hand-authored.
- **libsodium** — `libsodium-wrappers` ships a broken ESM build; we use `libsodium-wrappers-sumo`. It is listed in `next.config.mjs` `serverExternalPackages` so webpack doesn't try to bundle the WASM. Don't switch back.
- **BullMQ + ioredis types** — BullMQ bundles its own ioredis copy and TS sees them as different types. `lib/asset/queue.ts` exports `bullConnection` (parsed host/port/etc.) and the worker uses that. Don't pass a constructed `IORedis` instance to BullMQ — type fights you.
- **Authelia headers** — verify your Traefik entrypoint strips client-supplied `Remote-*` headers before Authelia injects fresh ones, otherwise the app trusts forged identity. See `docs/auth-traefik-authelia.md`.
- **Route priority for guest invites** — `dnd-web-invite` must outrank `dnd-web` in Traefik (priority 100 vs 10). If guests get Authelia's login screen, that ordering is wrong.
- **Test isolation** — invite tests must import from `lib/invite-token.ts`, **not** `lib/invite.ts`. The latter pulls Prisma which tries to load the native engine and fails in test envs without libssl.
- **DM model attribution** — players don't supply their own OpenAI key. The DM turn always runs under the **campaign host's** API key (`session.campaign.hostId`), so the host's account pays for the game.
- **Compaction is async** — `runDmTurn` triggers `maybeCompact` with `void` so the turn returns immediately. If you await it, you slow every turn by the full summarisation latency.
- **EventLog "archived" type** — `memory.maybeCompact` rewrites archived events' `type` to `"archived"` so they're excluded from future conversation reconstruction. Don't filter on `type IN (...)` without remembering this.

## Where to start for common changes

| Goal                              | Touch these files                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a DM tool                     | `src/lib/dm/tools.ts` (schema + handler + registry entry); add an event-type case in `src/lib/game/store.ts` if it needs UI reaction                                                         |
| Add an SRD entity type            | `scripts/srd/types.ts`, `classify.ts`, then re-run `npm run srd:sync`                                                                                                                        |
| Change asset generation behaviour | `src/lib/asset/generate.ts` for orchestration; `openai-image.ts` for endpoint specifics                                                                                                      |
| Change cinematic visuals          | `src/components/game/CinematicView.tsx` and `src/lib/game/store.ts` scene reducer                                                                                                            |
| Change tactical map               | `src/components/game/TacticalMap.tsx` (PixiJS) and `src/lib/game/store.ts` token reducer                                                                                                     |
| Change worldbuild output schema   | `src/lib/dm/worldbuild.ts` (`blueprintSchema` + `commitBlueprint`) and `src/lib/dm/prompts.ts` (`WORLDBUILD_PROMPT`) — keep them in sync                                                     |
| Add a new session-scoped API      | mirror `src/app/api/sessions/[id]/roll/route.ts`: resolve via `resolveAccess`, then `publishEvent`                                                                                           |
| Change persisted shape            | edit `prisma/schema.prisma`, then write a new migration in `prisma/migrations/<ts>_<name>/` (Prisma migrate diff is unreliable on Alpine — hand-author SQL, validate locally with `psql -f`) |

## Things to **not** do

- Don't add NextAuth / OAuth — Authelia is the auth boundary.
- Don't move auth checks into `src/middleware.ts` as primary defense; it's only the defense-in-depth check that the Authelia header is present.
- Don't store API keys, secrets, or session tokens in EventLog payloads.
- Don't bundle the asset backend client-side. `openai-image.ts` is server-only.
- Don't introduce a new global state store. The Zustand `useGame` is the only one.
- Don't broaden `force-dynamic` routes back to default — half of them depend on per-request headers (Authelia) or per-session state.
- Don't run `prisma db push` in production — only `prisma migrate deploy` against a committed migration directory.

## Testing checklist before declaring a feature done

1. `npm run lint` — 0 warnings, 0 errors.
2. `npm run typecheck` — 0 errors.
3. `npm test` — 20/20 pass.
4. `npm run build` — completes; check the route list for new routes.
5. If you touched the DM/realtime loop: manually run an `/api/sessions/<id>/turn` POST against a real session and watch the SSE stream emit `narrate` + your new events.

## Useful one-liners

```bash
# Promote yourself to DM after first Authelia login
docker compose exec postgres psql -U dnd -d dnd \
  -c "UPDATE \"User\" SET \"isDM\" = TRUE WHERE username = 'yourname';"

# Tail DM tool calls for an active session
docker compose exec postgres psql -U dnd -d dnd \
  -c "SELECT ts, type, payload->>'name' FROM \"EventLog\" WHERE \"sessionId\" = 'X' AND type = 'tool_result' ORDER BY ts DESC LIMIT 20;"

# Reset stuck asset jobs
docker compose exec postgres psql -U dnd -d dnd \
  -c "UPDATE \"Asset\" SET status = 'pending' WHERE status = 'generating' AND \"createdAt\" < NOW() - INTERVAL '10 minutes';"
```
