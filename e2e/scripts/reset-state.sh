#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="${ROOT_DIR}/e2e"
DOCKER_DIR="${ROOT_DIR}/docker"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.middleware.yaml"

echo "Stopping middleware services..."
bash "${E2E_DIR}/scripts/stop-middleware.sh" || true

echo "Removing persisted middleware data..."
rm -rf \
  "${DOCKER_DIR}/volumes/db/data" \
  "${DOCKER_DIR}/volumes/plugin_daemon" \
  "${DOCKER_DIR}/volumes/redis/data" \
  "${DOCKER_DIR}/volumes/weaviate"

mkdir -p \
  "${DOCKER_DIR}/volumes/db/data" \
  "${DOCKER_DIR}/volumes/plugin_daemon" \
  "${DOCKER_DIR}/volumes/redis/data" \
  "${DOCKER_DIR}/volumes/weaviate"

echo "Removing E2E local state..."
rm -rf \
  "${E2E_DIR}/.auth" \
  "${E2E_DIR}/cucumber-report" \
  "${E2E_DIR}/.logs" \
  "${E2E_DIR}/playwright-report" \
  "${E2E_DIR}/test-results"

echo "E2E state reset complete."
