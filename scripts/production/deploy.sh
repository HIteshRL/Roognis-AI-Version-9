#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
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
  echo "Missing $ENV_FILE. Copy .env.production.example and fill it first." >&2
  exit 1
fi

permissions="$(stat -c '%a' "$ENV_FILE")"
if [[ "$permissions" != "600" ]]; then
  echo "$ENV_FILE must have permission 600; currently $permissions. Run: chmod 600 $ENV_FILE" >&2
  exit 1
fi

echo "Validating production configuration..."
"${COMPOSE[@]}" config --quiet

if [[ "${BACKUP_BEFORE_DEPLOY:-true}" == "true" ]] && "${COMPOSE[@]}" ps --status running postgres | grep -q postgres; then
  ENV_FILE="$ENV_FILE" "$ROOT_DIR/scripts/production/backup.sh"
fi

echo "Building production images..."
"${COMPOSE[@]}" build --pull
echo "Starting Roognis..."
"${COMPOSE[@]}" up -d --remove-orphans
"${COMPOSE[@]}" ps
