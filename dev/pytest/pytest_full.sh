#!/bin/bash
set -euo pipefail
set -ex

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-180}"

# Ensure OpenDAL local storage works even if .env isn't loaded
export STORAGE_TYPE=${STORAGE_TYPE:-opendal}
export OPENDAL_SCHEME=${OPENDAL_SCHEME:-fs}
export OPENDAL_FS_ROOT=${OPENDAL_FS_ROOT:-/tmp/dify-storage}
mkdir -p "${OPENDAL_FS_ROOT}"

# Prepare env files like CI
cp -n docker/.env.example docker/.env || true
cp -n docker/middleware.env.example docker/middleware.env || true
cp -n api/tests/integration_tests/.env.example api/tests/integration_tests/.env || true

# Expose service ports (same as CI) without leaving the repo dirty
EXPOSE_BACKUPS=()
for f in docker/docker-compose.yaml docker/tidb/docker-compose.yaml; do
  if [[ -f "$f" ]]; then
    cp "$f" "$f.ci.bak"
    EXPOSE_BACKUPS+=("$f")
  fi
done
if command -v yq >/dev/null 2>&1; then
  sh .github/workflows/expose_service_ports.sh || true
else
  echo "skip expose_service_ports (yq not installed)" >&2
fi

# Optionally start middleware stack (db, redis, sandbox, ssrf proxy) to mirror CI
STARTED_MIDDLEWARE=0
if [[ "${SKIP_MIDDLEWARE:-0}" != "1" ]]; then
  docker compose -f docker/docker-compose.middleware.yaml --env-file docker/middleware.env up -d db_postgres redis sandbox ssrf_proxy
  STARTED_MIDDLEWARE=1
  # Give services a moment to come up
  sleep 5
fi

cleanup() {
  if [[ $STARTED_MIDDLEWARE -eq 1 ]]; then
    docker compose -f docker/docker-compose.middleware.yaml --env-file docker/middleware.env down
  fi
  for f in "${EXPOSE_BACKUPS[@]}"; do
    mv "$f.ci.bak" "$f"
  done
}
trap cleanup EXIT

pytest --timeout "${PYTEST_TIMEOUT}" \
  api/tests/integration_tests/workflow \
  api/tests/integration_tests/tools \
  api/tests/test_containers_integration_tests \
  api/tests/unit_tests
