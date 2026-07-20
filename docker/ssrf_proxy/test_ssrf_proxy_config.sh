#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${SSRF_PROXY_TEST_IMAGE:-ubuntu/squid:latest}"
CLIENT_IMAGE="${SSRF_PROXY_TEST_CLIENT_IMAGE:-busybox:latest}"
CONTAINER_NAME="${SSRF_PROXY_TEST_CONTAINER:-dify-ssrf-proxy-test-$$}"
SANDBOX_CONTAINER_NAME="${CONTAINER_NAME}-sandbox"
NETWORK_NAME="${SSRF_PROXY_TEST_NETWORK:-dify-ssrf-proxy-test-$$}"
RUN_PUBLIC_CHECK="${SSRF_PROXY_TEST_PUBLIC_CHECK:-true}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm -f "$SANDBOX_CONTAINER_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
}

http_code_for() {
  local proxy_url="$1"
  local target_url="$2"
  local output

  output="$(
    docker run \
      --rm \
      --network "$NETWORK_NAME" \
      --env "http_proxy=$proxy_url" \
      --env "https_proxy=$proxy_url" \
      "$CLIENT_IMAGE" \
      wget -S -O /dev/null -T 10 "$target_url" 2>&1 || true
  )"

  printf '%s\n' "$output" | awk '$1 ~ /^HTTP\// { code = $2 } END { print code }'
}

direct_http_code_for() {
  local target_url="$1"
  local output

  output="$(
    docker run \
      --rm \
      --network "$NETWORK_NAME" \
      "$CLIENT_IMAGE" \
      wget -S -O /dev/null -T 10 "$target_url" 2>&1 || true
  )"

  printf '%s\n' "$output" | awk '$1 ~ /^HTTP\// { code = $2 } END { print code }'
}

assert_private_target_blocked() {
  local proxy_url="$1"
  local target_url="$2"
  local status_code

  status_code="$(http_code_for "$proxy_url" "$target_url")"
  if [[ "$status_code" != "403" ]]; then
    echo "Expected $target_url to be blocked with HTTP 403, got ${status_code:-no response}."
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  fi
}

assert_public_target_allowed() {
  local proxy_url="$1"
  local target_url="$2"
  local status_code

  status_code="$(http_code_for "$proxy_url" "$target_url")"
  if [[ ! "$status_code" =~ ^[234][0-9][0-9]$ || "$status_code" == "403" ]]; then
    echo "Expected $target_url to remain reachable, got ${status_code:-no response}."
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  fi
}

assert_sandbox_bridge_allowed() {
  local target_url="$1"
  local status_code

  status_code="$(direct_http_code_for "$target_url")"
  if [[ ! "$status_code" =~ ^2[0-9][0-9]$ ]]; then
    echo "Expected sandbox host bridge $target_url to remain reachable, got ${status_code:-no response}."
    docker logs "$CONTAINER_NAME" >&2 || true
    docker logs "$SANDBOX_CONTAINER_NAME" >&2 || true
    exit 1
  fi
}

trap cleanup EXIT
cleanup
docker network create "$NETWORK_NAME" >/dev/null

docker run \
  --detach \
  --name "$SANDBOX_CONTAINER_NAME" \
  --network "$NETWORK_NAME" \
  --network-alias sandbox \
  "$CLIENT_IMAGE" \
  sh -c "mkdir -p /www && echo ok > /www/health && httpd -f -p 8194 -h /www" \
  >/dev/null

docker run \
  --detach \
  --name "$CONTAINER_NAME" \
  --entrypoint sh \
  --network "$NETWORK_NAME" \
  --volume "$ROOT_DIR/docker/ssrf_proxy/squid.conf.template:/etc/squid/squid.conf.template:ro" \
  --volume "$ROOT_DIR/docker/ssrf_proxy/docker-entrypoint.sh:/docker-entrypoint-mount.sh:ro" \
  --env HTTP_PORT=3128 \
  --env COREDUMP_DIR=/var/spool/squid \
  --env SSRF_SANDBOX_PROXY_PORT=8194 \
  --env SSRF_SANDBOX_PROXY_HOST=sandbox \
  --env "SSRF_PROXY_ALLOW_PRIVATE_IPS=${SSRF_PROXY_ALLOW_PRIVATE_IPS:-}" \
  --env "SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=${SSRF_PROXY_ALLOW_PRIVATE_DOMAINS:-}" \
  "$IMAGE" \
  -c "cp /docker-entrypoint-mount.sh /docker-entrypoint.sh && sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh && /docker-entrypoint.sh" \
  >/dev/null

proxy_url="http://$CONTAINER_NAME:3128"
for _ in {1..30}; do
  probe_status="$(http_code_for "$proxy_url" "http://127.0.0.1:80/")"
  if [[ -n "$probe_status" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${probe_status:-}" ]]; then
  echo "Squid proxy did not respond to probes."
  docker logs "$CONTAINER_NAME" >&2 || true
  exit 1
fi

assert_private_target_blocked "$proxy_url" "http://127.0.0.1:80/"
assert_private_target_blocked "$proxy_url" "http://0.1.2.3:80/"
assert_private_target_blocked "$proxy_url" "http://169.254.169.254/latest/meta-data/"

if [[ "$RUN_PUBLIC_CHECK" == "true" ]]; then
  assert_public_target_allowed "$proxy_url" "http://example.com/"
fi

assert_sandbox_bridge_allowed "http://$CONTAINER_NAME:8194/health"
