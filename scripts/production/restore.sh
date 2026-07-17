#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_FILE="${1:-}"
if docker compose version >/dev/null 2>&1; then
  COMPOSE_COMMAND=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_COMMAND=(docker-compose)
else
  echo "Docker Compose is required." >&2
  exit 1
fi
COMPOSE=("${COMPOSE_COMMAND[@]}" --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.production.yml)

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Usage: CONFIRM_RESTORE=roognis $0 /path/to/roognis.dump" >&2
  exit 1
fi
if [[ "${CONFIRM_RESTORE:-}" != "roognis" ]]; then
  echo "Restore refused. Set CONFIRM_RESTORE=roognis after confirming the target." >&2
  exit 1
fi

if [[ -f "$BACKUP_FILE.sha256" ]]; then
  sha256sum --check "$BACKUP_FILE.sha256"
fi

echo "Stopping services that write application data..."
"${COMPOSE[@]}" stop auth ai rag quiz analytics frontend textbook-seed

echo "Restoring $BACKUP_FILE..."
"${COMPOSE[@]}" exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'roognis' AND pid <> pg_backend_pid();"
"${COMPOSE[@]}" exec -T postgres \
  pg_restore -U postgres -d roognis --clean --if-exists --no-owner --no-privileges < "$BACKUP_FILE"

echo "Restarting the application..."
"${COMPOSE[@]}" up -d
"${COMPOSE[@]}" ps
