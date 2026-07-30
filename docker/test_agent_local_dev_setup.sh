#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$(mktemp)"
COMPOSE_CONFIG="$(mktemp)"
trap 'rm -f "$ENV_FILE" "$COMPOSE_CONFIG"' EXIT

cp "$ROOT_DIR/docker/envs/middleware.env.example" "$ENV_FILE"
docker compose \
  -f "$ROOT_DIR/docker/docker-compose.middleware.yaml" \
  --env-file "$ENV_FILE" \
  config --format json > "$COMPOSE_CONFIG"

python3 - "$COMPOSE_CONFIG" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    config = json.load(config_file)

services = config["services"]
sandbox = services["local_sandbox"]
proxy = services["agent_ssrf_proxy"]

assert set(sandbox["networks"]) == {"local_sandbox_proxy_network"}
assert config["networks"]["local_sandbox_proxy_network"]["internal"] is True
assert "ports" not in sandbox
assert any(
    port["target"] == 5004
    and port["published"] == "5004"
    and port.get("host_ip") == "127.0.0.1"
    for port in proxy["ports"]
)
assert proxy["environment"]["SSRF_AGENT_BACKEND_HOST"] == "host.docker.internal"
assert proxy["environment"]["SSRF_API_HOST"] == "host.docker.internal"
assert proxy["environment"]["SSRF_AGENT_BACKEND_UPSTREAM_HOST"] == "host.docker.internal"
assert proxy["environment"]["SSRF_API_UPSTREAM_HOST"] == "host.docker.internal"
assert "host.docker.internal=host-gateway" in proxy["extra_hosts"]
PY

grep -q '^DIFY_AGENT_REDIS_URL=redis://:difyai123456@localhost:6379/0$' "$ROOT_DIR/dify-agent/.example.env"

START_AGENT="$ROOT_DIR/dev/start-agent"
test -x "$START_AGENT"
grep -q -- "uvicorn dify_agent.server.app:app" "$START_AGENT"
grep -q -- "--host 127.0.0.1" "$START_AGENT"
grep -q -- "--port 5050" "$START_AGENT"
grep -q -- "--reload" "$START_AGENT"
grep -q -- "--env-file .env" "$START_AGENT"

DRY_RUN="$(make -C "$ROOT_DIR" -n dev-setup)"
grep -q -- "Setting up Dify Agent" <<<"$DRY_RUN"
grep -q -- "uv sync --group dev --extra server" <<<"$DRY_RUN"
if grep -q -- "dev/start-agent\|uvicorn dify_agent.server.app:app" <<<"$DRY_RUN"; then
  echo "dev-setup must not start the Dify Agent process" >&2
  exit 1
fi

echo "Agent local development setup checks passed."
