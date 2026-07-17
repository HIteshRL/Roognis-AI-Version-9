#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
if docker compose version >/dev/null 2>&1; then
  COMPOSE_COMMAND=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_COMMAND=(docker-compose)
else
  echo "Docker Compose is required." >&2
  exit 1
fi
COMPOSE=("${COMPOSE_COMMAND[@]}" --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.production.yml)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
umask 077
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$BACKUP_DIR/roognis-$timestamp.dump"
temporary="$backup.partial"

echo "Creating PostgreSQL backup: $backup"
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U postgres -d roognis --format=custom --no-owner --no-privileges > "$temporary"

test -s "$temporary"
mv "$temporary" "$backup"
sha256sum "$backup" > "$backup.sha256"
find "$BACKUP_DIR" -type f \( -name 'roognis-*.dump' -o -name 'roognis-*.dump.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

echo "Backup complete: $backup"
