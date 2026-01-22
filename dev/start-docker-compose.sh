#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"

cd "$ROOT/docker"
docker compose -f docker-compose.middleware.yaml --profile postgresql --profile weaviate -p dify up -d
