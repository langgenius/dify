#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent_root="$(cd "$script_dir/../../../.." && pwd)"

bridge_host="127.0.0.1"
bridge_port="${DIFY_BYOA_CODEX_PORT:-8765}"
workspace_root="${DIFY_BYOA_CODEX_WORKSPACE_ROOT:-}"
keychain_service="${DIFY_BYOA_CODEX_KEYCHAIN_SERVICE:-dify-byoa-public-bridge}"
keychain_account="${DIFY_BYOA_CODEX_KEYCHAIN_ACCOUNT:-api-token}"
codex_bin="${DIFY_BYOA_CODEX_BIN:-codex}"
known_hosts="${DIFY_BYOA_CODEX_KNOWN_HOSTS_FILE:-${HOME:-}/.ssh/dify-byoa-localhost-run-known-hosts}"
tunnel_provider="${DIFY_BYOA_TUNNEL_PROVIDER:-cloudflare-quick}"
cloudflared_image="${DIFY_BYOA_CLOUDFLARED_IMAGE:-cloudflare/cloudflared:2026.7.3}"

if [[ -z "$workspace_root" ]]; then
  echo "DIFY_BYOA_CODEX_WORKSPACE_ROOT is required" >&2
  exit 2
fi
if [[ ! -d "$workspace_root" ]]; then
  echo "DIFY_BYOA_CODEX_WORKSPACE_ROOT must be an existing directory" >&2
  exit 2
fi
workspace_root="$(cd "$workspace_root" && pwd -P)"

if ! [[ "$bridge_port" =~ ^[0-9]+$ ]] || ((bridge_port < 1 || bridge_port > 65535)); then
  echo "DIFY_BYOA_CODEX_PORT must be between 1 and 65535" >&2
  exit 2
fi

for dependency in uv curl; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "$dependency is required" >&2
    exit 2
  fi
done
if ! command -v "$codex_bin" >/dev/null 2>&1; then
  echo "$codex_bin is required" >&2
  exit 2
fi

tunnel_runtime=""
case "$tunnel_provider" in
  cloudflare-quick)
    if command -v cloudflared >/dev/null 2>&1; then
      tunnel_runtime="cloudflared"
    elif command -v docker >/dev/null 2>&1; then
      tunnel_runtime="docker"
    else
      echo "cloudflared or docker is required for the Cloudflare Quick Tunnel" >&2
      exit 2
    fi
    # TryCloudflare buffers SSE. Advertising streaming=false makes Dify use
    # message:send, so discovery and real execution both work through this
    # development-only public boundary.
    export DIFY_BYOA_CODEX_STREAMING=false
    ;;
  localhost-run)
    if ! command -v ssh >/dev/null 2>&1; then
      echo "ssh is required for the localhost.run tunnel" >&2
      exit 2
    fi
    tunnel_runtime="ssh"
    ;;
  *)
    echo "DIFY_BYOA_TUNNEL_PROVIDER must be cloudflare-quick or localhost-run" >&2
    exit 2
    ;;
esac

# Fail before opening the reverse tunnel if another local service owns the
# requested port. The check cannot remove the OS-level bind race, but it avoids
# intentionally publishing an already-listening, unauthenticated service.
if ! (
  cd "$agent_root"
  DIFY_BYOA_PREFLIGHT_HOST="$bridge_host" \
    DIFY_BYOA_PREFLIGHT_PORT="$bridge_port" \
    uv run python -c \
      'import os, socket; sock = socket.socket(); sock.bind((os.environ["DIFY_BYOA_PREFLIGHT_HOST"], int(os.environ["DIFY_BYOA_PREFLIGHT_PORT"]))); sock.close()'
) >/dev/null 2>&1; then
  echo "Local port ${bridge_port} is already in use; refusing to publish it" >&2
  exit 2
fi

bridge_python="$(
  cd "$agent_root"
  uv run --extra server python -c 'import sys; print(sys.executable)'
)"
if [[ -z "$bridge_python" || ! -x "$bridge_python" ]]; then
  echo "Could not resolve the Dify Agent Python runtime" >&2
  exit 2
fi

if [[ -z "${DIFY_BYOA_CODEX_API_TOKEN:-}" ]]; then
  if ! command -v security >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
    echo "DIFY_BYOA_CODEX_API_TOKEN is required when macOS Keychain and openssl are unavailable" >&2
    exit 2
  fi
  DIFY_BYOA_CODEX_API_TOKEN="$(openssl rand -hex 32)"
  # Put the current one-time tunnel token in Keychain without placing it in the
  # `security` process arguments. A new launch invalidates every prior token.
  if ! (
    cd "$agent_root"
    DIFY_BYOA_CODEX_API_TOKEN="$DIFY_BYOA_CODEX_API_TOKEN" \
      DIFY_BYOA_CODEX_KEYCHAIN_SERVICE="$keychain_service" \
      DIFY_BYOA_CODEX_KEYCHAIN_ACCOUNT="$keychain_account" \
      uv run python -c '
import os
import subprocess

token = os.environ["DIFY_BYOA_CODEX_API_TOKEN"]
result = subprocess.run(
    [
        "security",
        "add-generic-password",
        "-s",
        os.environ["DIFY_BYOA_CODEX_KEYCHAIN_SERVICE"],
        "-a",
        os.environ["DIFY_BYOA_CODEX_KEYCHAIN_ACCOUNT"],
        "-U",
        "-T",
        "",
        "-w",
    ],
    input=f"{token}\n{token}\n",
    text=True,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
    check=False,
)
raise SystemExit(result.returncode)
'
  ); then
    echo "Could not rotate the Bridge Bearer token in macOS Keychain" >&2
    exit 2
  fi
  echo "Rotated the Bridge Bearer token in macOS Keychain."
fi

if [[ -z "${DIFY_BYOA_CODEX_API_TOKEN:-}" ]]; then
  echo "DIFY_BYOA_CODEX_API_TOKEN must not be empty" >&2
  exit 2
fi
bridge_api_token="$DIFY_BYOA_CODEX_API_TOKEN"
unset DIFY_BYOA_CODEX_API_TOKEN
export DIFY_BYOA_CODEX_SANDBOX="${DIFY_BYOA_CODEX_SANDBOX:-read-only}"

if [[ "$tunnel_provider" == "localhost-run" ]]; then
  if [[ -z "$known_hosts" ]]; then
    echo "DIFY_BYOA_CODEX_KNOWN_HOSTS_FILE is required when HOME is unavailable" >&2
    exit 2
  fi
  mkdir -p "$(dirname "$known_hosts")"
  touch "$known_hosts"
  chmod 600 "$known_hosts"
fi

runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/dify-byoa-public.XXXXXX")"
tunnel_log="$runtime_dir/tunnel.log"
tunnel_pid=""
bridge_pid=""
tunnel_container_name=""

cleanup() {
  local child_pid
  if [[ -n "$tunnel_container_name" ]]; then
    docker rm --force "$tunnel_container_name" >/dev/null 2>&1 || true
  fi
  for child_pid in "$bridge_pid" "$tunnel_pid"; do
    if [[ -n "$child_pid" ]] && kill -0 "$child_pid" >/dev/null 2>&1; then
      kill "$child_pid" >/dev/null 2>&1 || true
    fi
  done
  for child_pid in "$bridge_pid" "$tunnel_pid"; do
    if [[ -n "$child_pid" ]]; then
      wait "$child_pid" >/dev/null 2>&1 || true
    fi
  done
  rm -rf -- "$runtime_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$tunnel_runtime" == "cloudflared" ]]; then
  cloudflared tunnel \
    --no-autoupdate \
    --url "http://${bridge_host}:${bridge_port}" \
    >"$tunnel_log" 2>&1 &
elif [[ "$tunnel_runtime" == "docker" ]]; then
  tunnel_container_name="dify-byoa-cloudflared-$$"
  docker run --rm \
    --name "$tunnel_container_name" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    "$cloudflared_image" \
    tunnel \
    --no-autoupdate \
    --url "http://host.docker.internal:${bridge_port}" \
    >"$tunnel_log" 2>&1 &
else
  ssh \
    -T \
    -R "80:localhost:${bridge_port}" \
    -o StrictHostKeyChecking=accept-new \
    -o "UserKnownHostsFile=${known_hosts}" \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    nokey@localhost.run \
    >"$tunnel_log" 2>&1 &
fi
tunnel_pid="$!"

public_url=""
for _attempt in $(seq 1 240); do
  if [[ "$tunnel_provider" == "cloudflare-quick" ]]; then
    public_url="$(sed -nE \
      's#.*(https://[[:alnum:]-]+\.trycloudflare\.com).*#\1#p' \
      "$tunnel_log" | head -n 1)"
  else
    public_url="$(sed -nE \
      's/.*tunneled with tls termination, (https:\/\/[^[:space:]]+).*/\1/p' \
      "$tunnel_log" | head -n 1)"
  fi
  if [[ -n "$public_url" ]]; then
    break
  fi
  if ! kill -0 "$tunnel_pid" >/dev/null 2>&1; then
    echo "The public tunnel stopped before publishing an HTTPS URL" >&2
    sed -n '1,20p' "$tunnel_log" >&2
    exit 1
  fi
  sleep 0.25
done

if [[ -z "$public_url" ]]; then
  echo "Timed out waiting for the public tunnel URL" >&2
  exit 1
fi

export DIFY_BYOA_CODEX_PUBLIC_URL="$public_url"

cd "$agent_root"
# Bash variables are not visible through a process environment. Feed the
# bridge-only secret through a one-shot pipe instead, then close both copies so
# neither the supervisor, Bridge process metadata, nor Codex can recover it.
exec 9< <(printf '%s' "$bridge_api_token")
DIFY_BYOA_CODEX_API_TOKEN_FD=9 \
  PYTHONPATH=examples/dify_agent \
  "$bridge_python" -m dify_agent_examples.codex_a2a_bridge \
  --workspace-root "$workspace_root" \
  --host "$bridge_host" \
  --port "$bridge_port" 9<&9 &
bridge_pid="$!"
exec 9<&-
bridge_api_token=""
unset bridge_api_token

bridge_ready=false
for _attempt in $(seq 1 80); do
  if curl --fail --silent --output /dev/null \
    --noproxy '*' \
    --max-time 1 \
    "http://${bridge_host}:${bridge_port}/.well-known/agent-card.json"; then
    bridge_ready=true
    break
  fi
  if ! kill -0 "$bridge_pid" >/dev/null 2>&1; then
    echo "The Codex A2A bridge stopped during startup" >&2
    exit 1
  fi
  sleep 0.25
done

if [[ "$bridge_ready" != true ]]; then
  echo "Timed out waiting for the Codex A2A bridge" >&2
  exit 1
fi

public_ready=false
public_status="000"
public_host="${public_url#https://}"
public_ready_deadline=$((SECONDS + 120))
while ((SECONDS < public_ready_deadline)); do
  public_ip=""
  if [[ "$tunnel_provider" == "cloudflare-quick" ]] && command -v dig >/dev/null 2>&1; then
    # Quick Tunnel DNS can be live at Cloudflare before the workstation's
    # resolver clears an NXDOMAIN cache. Resolve against Cloudflare DNS for the
    # readiness probe while preserving hostname-based TLS verification.
    public_ip="$(dig @1.1.1.1 +short A "$public_host" 2>/dev/null \
      | sed -nE '/^[0-9]+(\.[0-9]+){3}$/{p;q;}' || true)"
  fi
  if [[ -n "$public_ip" ]]; then
    public_status="$(curl --silent --output /dev/null \
      --noproxy '*' \
      --max-time 3 \
      --resolve "${public_host}:443:${public_ip}" \
      --write-out '%{http_code}' \
      "$public_url/.well-known/agent-card.json" || true)"
  else
    public_status="$(curl --silent --output /dev/null \
      --noproxy '*' \
      --max-time 3 \
      --write-out '%{http_code}' \
      "$public_url/.well-known/agent-card.json" || true)"
  fi
  if [[ "$public_status" == "200" ]]; then
    public_ready=true
    break
  fi
  if ! kill -0 "$tunnel_pid" >/dev/null 2>&1; then
    echo "The public tunnel stopped during readiness verification" >&2
    sed -n '1,40p' "$tunnel_log" >&2
    exit 1
  fi
  sleep 0.5
done

if [[ "$public_ready" != true ]]; then
  echo "Timed out waiting for the public Agent Card (last HTTP status: ${public_status})" >&2
  sed -n '1,40p' "$tunnel_log" >&2
  exit 1
fi

echo "Public A2A endpoint: $public_url"
echo "Bridge origin: http://${bridge_host}:${bridge_port}"
echo "Authentication: Bearer token from environment or Keychain"
echo "Tunnel provider: $tunnel_provider"
if [[ "$tunnel_provider" == "cloudflare-quick" ]]; then
  echo "A2A execution mode: blocking message:send (Quick Tunnel buffers SSE)"
fi
echo "Codex sandbox: ${DIFY_BYOA_CODEX_SANDBOX}"
echo "Press Ctrl-C to stop both the bridge and the tunnel."

# Bash 3.2 (the macOS system Bash) has no `wait -n`, so supervise both
# processes with a short poll. If either side exits, the EXIT trap terminates
# and reaps the other side instead of leaving a misleading half-live setup.
while kill -0 "$tunnel_pid" >/dev/null 2>&1 && kill -0 "$bridge_pid" >/dev/null 2>&1; do
  sleep 1
done

exit_status=0
if ! kill -0 "$tunnel_pid" >/dev/null 2>&1; then
  set +e
  wait "$tunnel_pid"
  exit_status="$?"
  set -e
  if [[ "$exit_status" -eq 0 ]]; then
    exit_status=1
  fi
  echo "The public tunnel stopped; shutting down the Codex A2A bridge" >&2
else
  set +e
  wait "$bridge_pid"
  exit_status="$?"
  set -e
  echo "The Codex A2A bridge stopped; shutting down the public tunnel" >&2
fi

exit "$exit_status"
