#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.middleware.yaml"
ENV_FILE="${DOCKER_DIR}/middleware.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${DOCKER_DIR}/middleware.env.example" "${ENV_FILE}"
fi

if ! grep -q '^COMPOSE_PROFILES=' "${ENV_FILE}"; then
  printf '\nCOMPOSE_PROFILES=postgresql,weaviate\n' >> "${ENV_FILE}"
fi

echo "Starting middleware services..."
docker compose \
  -f "${COMPOSE_FILE}" \
  --profile postgresql \
  --profile weaviate \
  up -d \
  db_postgres \
  redis \
  weaviate \
  sandbox \
  ssrf_proxy \
  plugin_daemon

POSTGRES_CONTAINER_ID="$(docker compose -f "${COMPOSE_FILE}" ps -q db_postgres)"
REDIS_CONTAINER_ID="$(docker compose -f "${COMPOSE_FILE}" ps -q redis)"

echo "Waiting for PostgreSQL and Redis health checks..."
for _ in {1..120}; do
  POSTGRES_STATUS="$(docker inspect -f '{{.State.Health.Status}}' "${POSTGRES_CONTAINER_ID}")"
  REDIS_STATUS="$(docker inspect -f '{{.State.Health.Status}}' "${REDIS_CONTAINER_ID}")"

  if [[ "${POSTGRES_STATUS}" == "healthy" && "${REDIS_STATUS}" == "healthy" ]]; then
    break
  fi
  sleep 2
done

echo "Waiting for Weaviate readiness..."
for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8080/v1/.well-known/ready >/dev/null; then
    break
  fi
  sleep 2
done

echo "Waiting for sandbox health..."
for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8194/health >/dev/null; then
    break
  fi
  sleep 2
done

echo "Waiting for plugin daemon port..."
for _ in {1..60}; do
  if (echo > /dev/tcp/127.0.0.1/5002) >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS http://127.0.0.1:8080/v1/.well-known/ready >/dev/null; then
  echo "Weaviate did not become ready in time." >&2
  docker compose -f "${COMPOSE_FILE}" logs weaviate
  exit 1
fi

if ! curl -fsS http://127.0.0.1:8194/health >/dev/null; then
  echo "Sandbox did not become ready in time." >&2
  docker compose -f "${COMPOSE_FILE}" logs sandbox ssrf_proxy
  exit 1
fi

if ! (echo > /dev/tcp/127.0.0.1/5002) >/dev/null 2>&1; then
  echo "Plugin daemon did not become reachable in time." >&2
  docker compose -f "${COMPOSE_FILE}" logs plugin_daemon
  exit 1
fi

echo "Full middleware stack is ready."
