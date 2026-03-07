#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
ROOT="$(dirname "$SCRIPT_DIR")"

API_ENV_EXAMPLE="$ROOT/api/.env.example"
API_ENV="$ROOT/api/.env"
WEB_ENV_EXAMPLE="$ROOT/web/.env.example"
WEB_ENV="$ROOT/web/.env.local"
MIDDLEWARE_ENV_EXAMPLE="$ROOT/docker/middleware.env.example"
MIDDLEWARE_ENV="$ROOT/docker/middleware.env"

# 1) Copy api/.env.example -> api/.env
cp "$API_ENV_EXAMPLE" "$API_ENV"

# 2) Copy web/.env.example -> web/.env.local
cp "$WEB_ENV_EXAMPLE" "$WEB_ENV"

# 3) Copy docker/middleware.env.example -> docker/middleware.env
cp "$MIDDLEWARE_ENV_EXAMPLE" "$MIDDLEWARE_ENV"

# 4) Install deps
cd "$ROOT/api"
uv sync --group dev

cd "$ROOT/web"
pnpm install
