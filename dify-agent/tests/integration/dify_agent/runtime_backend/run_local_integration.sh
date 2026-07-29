#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/../../../.." && pwd)
container_name="dify-agent-runtime-backend-integration-$$"
image="${DIFY_AGENT_TEST_LOCAL_SANDBOX_IMAGE:-langgenius/dify-agent-local-sandbox:1.16.0}"
token="${DIFY_AGENT_TEST_LOCAL_SHELLCTL_AUTH_TOKEN:-runtime-backend-integration}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --detach --rm \
  --name "$container_name" \
  --env SHELLCTL_ENABLE_PATH_ISOLATION=true \
  --env SHELLCTL_AUTH_TOKEN="$token" \
  --publish 127.0.0.1::5004 \
  "$image" >/dev/null

published_address=$(docker port "$container_name" 5004/tcp | head -n 1)
endpoint="http://$published_address"
attempt=0
until curl --fail --silent "$endpoint/healthz" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    docker logs "$container_name"
    exit 1
  fi
  sleep 0.1
done

cd "$project_dir"
NO_PROXY=127.0.0.1,localhost \
  DIFY_AGENT_TEST_LOCAL_SHELLCTL_ENDPOINT="$endpoint" \
  DIFY_AGENT_TEST_LOCAL_SHELLCTL_AUTH_TOKEN="$token" \
  pdm run pytest --import-mode=importlib \
    tests/integration/dify_agent/runtime_backend/test_runtime_backend_lifecycle.py \
    -k local -q -rs "$@"
