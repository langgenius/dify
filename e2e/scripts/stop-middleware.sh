#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.middleware.yaml"

docker compose \
  -f "${COMPOSE_FILE}" \
  --profile postgresql \
  --profile weaviate \
  down --remove-orphans
