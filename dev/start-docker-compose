#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
ROOT="$(dirname "$SCRIPT_DIR")"

cd "$ROOT/docker"
docker compose -f docker-compose.middleware.yaml --profile postgresql --profile weaviate -p dify up -d
