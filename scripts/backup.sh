#!/usr/bin/env bash
# Daily backup of Postgres + MinIO assets to a snapshot directory.
# Run via cron, e.g. on Unraid: 0 4 * * *  /path/to/dnd-webui/scripts/backup.sh

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR="${BACKUP_DIR:-./backups}/$STAMP"
mkdir -p "$OUT_DIR"

echo "[backup] postgres → $OUT_DIR/postgres.sql.gz"
docker compose exec -T postgres pg_dump -U dnd -d dnd --no-owner --no-privileges \
  | gzip > "$OUT_DIR/postgres.sql.gz"

echo "[backup] minio → $OUT_DIR/minio.tar.gz"
docker run --rm \
  --network "$(docker compose ps --format json minio | head -1 | python3 -c 'import sys,json;print(json.loads(sys.stdin.read())["Networks"])' 2>/dev/null || echo dnd-webui_internal)" \
  -v "$OUT_DIR":/dump \
  -e MC_HOST_local="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio:9000" \
  minio/mc:latest \
  mirror local/dnd-assets /dump/minio || true

echo "[backup] done → $OUT_DIR"

# Prune backups older than ${BACKUP_KEEP_DAYS:-14}
find "${BACKUP_DIR:-./backups}" -maxdepth 1 -type d -name "20*" -mtime +"${BACKUP_KEEP_DAYS:-14}" -exec rm -rf {} +
