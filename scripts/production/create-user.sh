#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

APP_DOMAIN="$(awk -F= '$1 == "APP_DOMAIN" {sub(/^[^=]*=/, ""); gsub(/^\"|\"$/, ""); print; exit}' "$ENV_FILE")"
: "${APP_DOMAIN:?APP_DOMAIN is required in $ENV_FILE}"

read -r -p "Production teacher email: " teacher_email
read -r -s -p "Production teacher password: " teacher_password
echo
read -r -p "New account name: " account_name
read -r -p "New account email: " account_email
read -r -p "Role (student/parent): " account_role
read -r -s -p "Temporary password (minimum 10 characters): " account_password
echo

cookie_file="$(mktemp)"
login_body="$(mktemp)"
create_body="$(mktemp)"
trap 'rm -f "$cookie_file" "$login_body" "$create_body"' EXIT
chmod 600 "$cookie_file" "$login_body" "$create_body"

login_payload="$(jq -n --arg email "$teacher_email" --arg password "$teacher_password" \
  '{email: $email, password: $password}')"
login_status="$(curl -sS -o "$login_body" -w '%{http_code}' -c "$cookie_file" \
  -H 'Content-Type: application/json' -d "$login_payload" \
  "https://$APP_DOMAIN/api/auth/login")"
unset teacher_password login_payload
if [[ "$login_status" != "200" ]]; then
  echo "Teacher login failed (HTTP $login_status): $(jq -r '.error // "Unknown error"' "$login_body")" >&2
  exit 1
fi

create_payload="$(jq -n \
  --arg name "$account_name" --arg email "$account_email" \
  --arg role "$account_role" --arg password "$account_password" \
  '{name: $name, email: $email, role: $role, password: $password}')"
create_status="$(curl -sS -o "$create_body" -w '%{http_code}' -b "$cookie_file" \
  -H 'Content-Type: application/json' -d "$create_payload" \
  "https://$APP_DOMAIN/api/auth/users")"
unset account_password create_payload
if [[ "$create_status" != "201" ]]; then
  echo "Account creation failed (HTTP $create_status): $(jq -r '.error // "Unknown error"' "$create_body")" >&2
  exit 1
fi

jq '{userId, name, email, role, schoolId}' "$create_body"
