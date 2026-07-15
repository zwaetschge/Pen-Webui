# Operations runbook

## Daily

- `docker compose ps` — every long-running service is up; `cast-agent`,
  `postgres` and `web` should report healthy, while `minio-init` exits after
  first run.
- `curl https://dnd.example.tld/api/health` — `{"status":"ok",...}` (Authelia-bypassed by Traefik label).
- `docker compose logs --tail=200 web worker` — scan for unhandled errors.

## Server-side Chromecast

`cast-agent` uses the host network for mDNS discovery and exposes only a Unix
socket in the `cast_runtime` volume. A failed Cast agent does not stop the game;
the Host-Konsole reports it as unavailable and keeps the local fullscreen
fallback usable.

```bash
docker compose ps cast-agent
docker compose logs --tail=200 cast-agent
docker compose restart cast-agent
```

For networks that block mDNS, set `CHROMECAST_HOSTS` to a comma-separated list
of fixed device IPs. The public `APP_DOMAIN` must resolve from the Chromecast
and present a trusted HTTPS certificate because the device loads the signed
`/display/sessions/...` page itself.

## Schema migrations

Run `npm run db:migrate:deploy` for every deployment that includes a committed
Prisma migration. In Compose, use:

```bash
docker compose run --rm worker npm run db:migrate:deploy
```

The per-DM Codex settings migration adds `codexModelDm` and
`codexReasoningEffort` to `User`. Values saved in `/dm/settings` override the
`CODEX_MODEL_DM` and `CODEX_REASONING_EFFORT_DM` installation defaults on the
next Codex DM call without a restart. Reasoning effort accepts exactly
`minimal|low|medium|high|xhigh`. OpenAI fallback settings and asset image
generation remain separate.

## SRD re-sync

```
docker compose run --rm worker npm run srd:sync
```

Re-clones the source repo, re-parses, and upserts anything changed. If
`OPENAI_API_KEY` is configured globally it also embeds records for semantic
search; without it the sync still imports exact/trigram lookup data.

## Asset retries

In the asset dashboard (`/campaigns/<id>/assets`), failed assets show a Retry button.
Behind the scenes that POSTs to `/api/dm/campaigns/<id>/retry-asset` which re-queues the BullMQ job.

If lots of jobs fail, retry from the queue with a one-liner:

```bash
docker compose exec redis redis-cli --raw eval "
  local keys = redis.call('KEYS', 'bull:assets:*')
  return #keys
" 0
```

## Backups

```
./scripts/backup.sh
```

Daily-cron suggestion (Unraid User Scripts):

```
0 4 * * *  cd /mnt/user/AI/plum-code/dnd-webui && ./scripts/backup.sh
```

Keeps the last 14 daily snapshots by default — override with `BACKUP_KEEP_DAYS=N`.

## Promote a user to DM

```bash
docker compose exec postgres psql -U dnd -d dnd \
  -c "UPDATE \"User\" SET \"isDM\" = TRUE WHERE username = 'yourname';"
```

…or add them to the `dnd-dms` Authelia group; the flag flips on next login.

## Cost monitoring

Token usage from the DM model is reported in the orchestrator return — wire to your
metrics stack via the worker logs, or query the EventLog:

```sql
SELECT date_trunc('day', ts) AS day,
       COUNT(*) FILTER (WHERE type = 'assistant_message') AS dm_turns,
       COUNT(*) FILTER (WHERE type = 'asset_ready')       AS images
  FROM "EventLog"
 GROUP BY 1
 ORDER BY 1 DESC
 LIMIT 30;
```

## Vocarium TTS

Set `VOCARIUM_API_URL` to the Vocarium gateway reachable from the `dnd-web`
container. The TTS integration always sends `Remote-User` as the campaign
host username, so host `zwaetschge` loads clone voices such as `Michael Scott`
and `Maurice Moss`; the default `api` tenant will not show those voices.

Voice catalog smoke:

```bash
VOCARIUM_USER=zwaetschge \
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py voices --source clone
```

Before any live generation smoke, check Vocarium resources:

```bash
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py health
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py preflight --kind tts
```

If preflight allows TTS, generate one short manual sample:

```bash
VOCARIUM_USER=zwaetschge \
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py \
  tts --source clone --voice 2abffe14 --text "Kurzer Test." --out /tmp/plum-tts-smoke.wav
```

The application does not run live Vocarium generation in CI.

## Common faults

| Symptom                               | Likely cause                                               | Fix                                                                                  |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/dm` redirects to `/`                | Authelia not in front, or `Remote-User` header missing     | Verify `authelia@docker` middleware on the `dnd-web` router                          |
| Guest invite shows Authelia login     | Routing priority on `dnd-web-invite` < `dnd-web`           | Ensure `priority=100` on the invite router                                           |
| Firefox shows no Chromecast           | Cast agent down, mDNS blocked, or TV on another VLAN       | Check `cast-agent` logs; set `CHROMECAST_HOSTS` as an IP fallback                    |
| Chromecast opens a blank/error page   | TV cannot resolve or reach the public `APP_DOMAIN`         | Verify LAN DNS, HTTPS certificate, and Traefik display route                         |
| Assets stuck in `generating`          | Worker dead, Codex imagegen failed, or API fallback failed | `docker compose restart worker`; check worker logs and Codex login in `/dm/settings` |
| `getSessionUser()` always null        | Authelia header name mismatch                              | Check `AUTHELIA_HEADER_USER` vs what Authelia sets                                   |
| DM says "no OpenAI API key available" | Per-user key not set AND no env fallback                   | Open `/dm/settings` and paste a key, or set `OPENAI_API_KEY` in `.env`               |
| Prisma engine fails to load on host   | Wrong `binaryTargets` for your distro                      | Add the target to `prisma/schema.prisma`, regenerate                                 |
