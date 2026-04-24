#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
RESET_SCRIPT="$SCRIPT_DIR/reset-test-env.sh"
TMP_ROOT="$(mktemp -d)"

trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  case "$haystack" in
    *"$needle"*)
      ;;
    *)
      fail "expected output to contain: $needle"
      ;;
  esac
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  case "$haystack" in
    *"$needle"*)
      fail "expected output not to contain: $needle"
      ;;
    *)
      ;;
  esac
}

assert_no_exact_line() {
  local haystack="$1"
  local line="$2"
  if printf '%s\n' "$haystack" | grep -Fxq "$line"; then
    fail "expected output not to contain exact line: $line"
  fi
}

make_fixture() {
  local repo="$1"

  mkdir -p "$repo/docker/volumes/db/data"
  mkdir -p "$repo/docker/volumes/mysql/data"
  mkdir -p "$repo/docker/volumes/redis/data"
  mkdir -p "$repo/docker/volumes/app/storage"
  mkdir -p "$repo/docker/volumes/plugin_daemon"
  mkdir -p "$repo/docker/volumes/opensearch/data"
  mkdir -p "$repo/docker/volumes/opensearch"
  mkdir -p "$repo/docker/nginx"
  mkdir -p "$repo/docker/ssrf_proxy"
  mkdir -p "$repo/docker/volumes/certbot"
  mkdir -p "$repo/docker/nginx/ssl"

  printf 'data\n' > "$repo/docker/volumes/db/data/file"
  printf 'index\n' > "$repo/docker/volumes/opensearch/data/file"
  printf 'opensearch.hosts: [https://localhost:9200]\n' > "$repo/docker/volumes/opensearch/opensearch_dashboards.yml"
  printf 'DB_TYPE=postgresql\nVECTOR_STORE=elasticsearch\nEXPOSE_NGINX_PORT=8080\n' > "$repo/docker/.env"
  printf 'services: {}\nvolumes:\n  dify_es01_data:\n' > "$repo/docker/docker-compose.yaml"
  printf 'services: {}\n' > "$repo/docker/docker-compose.middleware.yaml"
  printf 'middleware\n' > "$repo/docker/middleware.env"
}

install_fake_tools() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'docker' >> "$FAKE_DOCKER_LOG"
for arg in "$@"; do
  printf ' %s' "$arg" >> "$FAKE_DOCKER_LOG"
done
printf '\n' >> "$FAKE_DOCKER_LOG"

if [ "${1:-}" = "compose" ]; then
  shift
  subcommand=""
  for arg in "$@"; do
    case "$arg" in
      version|down|up|run|ps)
        subcommand="$arg"
        break
        ;;
    esac
  done

  case "$subcommand" in
    version|down|run)
      exit 0
      ;;
    up)
      if [ "${FAKE_DOCKER_FAIL_UP:-}" = "true" ]; then
        exit 42
      fi
      exit 0
      ;;
    ps)
      last_arg=""
      for arg in "$@"; do
        last_arg="$arg"
      done
      if [ "$last_arg" = "plugin_daemon" ]; then
        exit 0
      fi
      printf 'container-%s\n' "$last_arg"
      exit 0
      ;;
  esac
fi

if [ "${1:-}" = "inspect" ]; then
  printf 'running\n'
  exit 0
fi

if [ "${1:-}" = "volume" ]; then
  case "${2:-}" in
    ls)
      if [ "${FAKE_VOLUME_PRESENT:-}" = "true" ]; then
        printf 'docker_dify_es01_data\n'
      fi
      exit 0
      ;;
    inspect)
      if [ "${3:-}" = "docker_dify_es01_data" ]; then
        exit 0
      fi
      exit 1
      ;;
    rm)
      exit 0
      ;;
  esac
fi

exit 0
EOF

  cat > "$bin_dir/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'curl' >> "$FAKE_DOCKER_LOG"
for arg in "$@"; do
  printf ' %s' "$arg" >> "$FAKE_DOCKER_LOG"
done
printf '\n' >> "$FAKE_DOCKER_LOG"
exit 0
EOF

  chmod +x "$bin_dir/docker" "$bin_dir/curl"
}

test_dry_run_plan() {
  local repo="$TMP_ROOT/dry-run/repo"
  local output
  make_fixture "$repo"

  output="$("$RESET_SCRIPT" --repo-root "$repo" --dry-run --smoke-url http://localhost:8080 2>&1)"

  assert_contains "$output" "Compose project: docker"
  assert_contains "$output" "volumes/opensearch/data"
  assert_contains "$output" "dify_es01_data (Compose project: docker)"
  assert_contains "$output" "volumes/opensearch/opensearch_dashboards.yml"
  assert_no_exact_line "$output" "  - volumes/opensearch"
  assert_no_exact_line "$output" "  - volumes/elasticsearch"
}

test_destructive_uses_existing_project_and_named_volume() {
  local root="$TMP_ROOT/destructive"
  local repo="$root/repo"
  local bin_dir="$root/bin"
  local log_file="$root/docker.log"
  local output
  local docker_log
  local repo_real

  make_fixture "$repo"
  repo_real="$(cd "$repo" && pwd -P)"
  install_fake_tools "$bin_dir"
  : > "$log_file"

  output="$(PATH="$bin_dir:$PATH" FAKE_DOCKER_LOG="$log_file" FAKE_VOLUME_PRESENT=true ALLOW_DIFY_TEST_RESET=true DIFY_ENV_NAME=test "$RESET_SCRIPT" --repo-root "$repo" --yes --smoke-url http://localhost:8080 2>&1)"
  docker_log="$(cat "$log_file")"

  assert_contains "$output" "status: success"
  assert_contains "$output" "deleted_named_volumes:"
  assert_contains "$output" "docker_dify_es01_data"
  assert_contains "$docker_log" "docker compose --env-file $repo_real/docker/.env -f $repo_real/docker/docker-compose.yaml down --remove-orphans"
  assert_contains "$docker_log" "docker volume rm docker_dify_es01_data"
  assert_not_contains "$docker_log" "-p dify"

  [ ! -e "$repo/docker/volumes/db/data" ] || fail "expected database data directory to be deleted"
  [ ! -e "$repo/docker/volumes/opensearch/data" ] || fail "expected OpenSearch data directory to be deleted"
  [ -f "$repo/docker/volumes/opensearch/opensearch_dashboards.yml" ] || fail "expected OpenSearch dashboards config to be preserved"
}

test_command_failure_reports_phase() {
  local root="$TMP_ROOT/failure"
  local repo="$root/repo"
  local bin_dir="$root/bin"
  local log_file="$root/docker.log"
  local output
  local status

  make_fixture "$repo"
  install_fake_tools "$bin_dir"
  : > "$log_file"

  set +e
  output="$(PATH="$bin_dir:$PATH" FAKE_DOCKER_LOG="$log_file" FAKE_VOLUME_PRESENT=true FAKE_DOCKER_FAIL_UP=true ALLOW_DIFY_TEST_RESET=true DIFY_ENV_NAME=test "$RESET_SCRIPT" --repo-root "$repo" --yes --smoke-url http://localhost:8080 2>&1)"
  status=$?
  set -e

  [ "$status" -ne 0 ] || fail "expected command failure to return non-zero"
  assert_contains "$output" "Reset report"
  assert_contains "$output" "status: failure"
  assert_contains "$output" "phase: start-middleware"
  assert_contains "$output" "Command failed with exit code 42"
}

test_guard_before_destructive() {
  local repo="$TMP_ROOT/guard/repo"
  local output
  local status

  make_fixture "$repo"

  set +e
  output="$("$RESET_SCRIPT" --repo-root "$repo" --yes 2>&1)"
  status=$?
  set -e

  [ "$status" -ne 0 ] || fail "expected missing guard to return non-zero"
  assert_contains "$output" "ALLOW_DIFY_TEST_RESET=true is required"
}

test_dry_run_plan
test_destructive_uses_existing_project_and_named_volume
test_command_failure_reports_phase
test_guard_before_destructive

printf 'reset-test-env validation passed\n'
