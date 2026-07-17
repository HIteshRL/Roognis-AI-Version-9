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
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

APP_DOMAIN="$(awk -F= '$1 == "APP_DOMAIN" {sub(/^[^=]*=/, ""); gsub(/^\"|\"$/, ""); print; exit}' "$ENV_FILE")"
: "${APP_DOMAIN:?APP_DOMAIN is required in $ENV_FILE}"

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" ps

unhealthy="$("${COMPOSE[@]}" ps --all --format json | jq -s '
  flatten
  | [.[]
      | select(.Service != "textbook-seed")
      | select(.State != "running" or (.Health != "" and .Health != "healthy"))]
  | length')"
if [[ "$unhealthy" != "0" ]]; then
  echo "One or more containers are unhealthy." >&2
  exit 1
fi

curl -fsS --max-time 15 "https://$APP_DOMAIN/" > /dev/null
auth_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$APP_DOMAIN/api/auth/me")"
if [[ "$auth_status" != "401" ]]; then
  echo "Expected unauthenticated /api/auth/me to return 401, got $auth_status" >&2
  exit 1
fi

echo "Production verification passed for https://$APP_DOMAIN"
