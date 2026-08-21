#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$ROOT_DIR/docker-entrypoint.sh"
TEMPLATE="$ROOT_DIR/squid-common.conf.template"

expand_env() {
  awk '{
      while(match($0, /\${[A-Za-z_][A-Za-z_0-9]*}/)) {
          var = substr($0, RSTART+2, RLENGTH-3)
          val = ENVIRON[var]
          $0 = substr($0, 1, RSTART-1) val substr($0, RSTART+RLENGTH)
      }
      print
  }' "$1"
}

render_with_entrypoint_defaults() {
  export SSRF_PROXY_CONNECT_TIMEOUT="${SSRF_PROXY_CONNECT_TIMEOUT:-${HTTP_REQUEST_MAX_CONNECT_TIMEOUT:-30}}"
  export SSRF_PROXY_REQUEST_TIMEOUT="${SSRF_PROXY_REQUEST_TIMEOUT:-${HTTP_REQUEST_MAX_READ_TIMEOUT:-600}}"
  export SSRF_PROXY_READ_TIMEOUT="${SSRF_PROXY_READ_TIMEOUT:-${HTTP_REQUEST_MAX_READ_TIMEOUT:-600}}"
  expand_env "$TEMPLATE"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "Expected rendered config to contain: $needle"
    echo "$haystack"
    exit 1
  fi
}

# Explicit SSRF proxy overrides win.
unset HTTP_REQUEST_MAX_CONNECT_TIMEOUT HTTP_REQUEST_MAX_READ_TIMEOUT HTTP_REQUEST_MAX_WRITE_TIMEOUT
export SSRF_PROXY_CONNECT_TIMEOUT=45
export SSRF_PROXY_REQUEST_TIMEOUT=900
export SSRF_PROXY_READ_TIMEOUT=900
rendered="$(render_with_entrypoint_defaults)"
assert_contains "$rendered" "connect_timeout 45 seconds"
assert_contains "$rendered" "request_timeout 900 seconds"
assert_contains "$rendered" "read_timeout 900 seconds"

# HTTP request limits are used when SSRF proxy overrides are unset.
unset SSRF_PROXY_CONNECT_TIMEOUT SSRF_PROXY_REQUEST_TIMEOUT SSRF_PROXY_READ_TIMEOUT
export HTTP_REQUEST_MAX_CONNECT_TIMEOUT=300
export HTTP_REQUEST_MAX_READ_TIMEOUT=600
export HTTP_REQUEST_MAX_WRITE_TIMEOUT=600
rendered="$(render_with_entrypoint_defaults)"
assert_contains "$rendered" "connect_timeout 300 seconds"
assert_contains "$rendered" "request_timeout 600 seconds"
assert_contains "$rendered" "read_timeout 600 seconds"

echo "Squid timeout config tests passed."
