#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

REPO_ROOT="${DIFY_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
YES=false
DRY_RUN=true
SKIP_SMOKE=false
SKIP_MIGRATION=false
TIMEOUT_SECONDS="${DIFY_RESET_TIMEOUT_SECONDS:-300}"
SMOKE_URL="${DIFY_RESET_SMOKE_URL:-}"
LOCK_DIR=""
CURRENT_PHASE="init"

DELETED_PATHS=()
SKIPPED_PATHS=()
DELETED_NAMED_VOLUMES=()
SKIPPED_NAMED_VOLUMES=()
PRESERVED_PATHS=()
HEALTH_RESULTS=()
SMOKE_RESULT="not-run"
START_TIME="$(date +%s)"

RUNTIME_PATHS=(
  "volumes/db/data"
  "volumes/mysql/data"
  "volumes/redis/data"
  "volumes/app/storage"
  "volumes/plugin_daemon"
  "volumes/weaviate"
  "volumes/qdrant"
  "volumes/pgvector"
  "volumes/pgvecto_rs"
  "volumes/chroma"
  "volumes/milvus"
  "volumes/opensearch/data"
)

NAMED_VOLUMES=(
  "dify_es01_data"
)

PRESERVE_PATHS=(
  ".env"
  "middleware.env"
  "docker-compose.yaml"
  "docker-compose.middleware.yaml"
  "nginx"
  "ssrf_proxy"
  "volumes/certbot"
  "volumes/opensearch/opensearch_dashboards.yml"
  "nginx/ssl"
)

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME [options]

Safely reset a Dify test environment in place. The command defaults to dry-run.

Options:
  --yes                  Perform destructive reset. Required to delete data.
  --dry-run              Print planned actions without changing services or data.
  --repo-root PATH       Repository root. Defaults to auto-detected Dify root.
  --smoke-url URL        Public URL to verify after restart.
  --skip-smoke           Skip public-domain smoke verification.
  --skip-migration       Skip explicit migration gate.
  --timeout SECONDS      Health-check timeout. Default: $TIMEOUT_SECONDS.
  -h, --help             Show this help.

Required for destructive reset:
  ALLOW_DIFY_TEST_RESET=true
  DIFY_ENV_NAME=test

Optional:
  DIFY_RESET_SMOKE_URL=https://test.example.com
  RESET_TARGET_DOMAIN=test.example.com
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  local message="$1"
  print_report "failure"
  printf 'ERROR: %s\n' "$message" >&2
  exit 1
}

run_cmd() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  if [ "$DRY_RUN" = false ]; then
    set +e
    "$@"
    local status=$?
    set -e
    if [ "$status" -ne 0 ]; then
      fail "Command failed with exit code $status: $(command_string "$@")"
    fi
  fi
}

command_string() {
  local arg
  local result=""
  for arg in "$@"; do
    result="$result $(printf '%q' "$arg")"
  done
  printf '%s' "${result# }"
}

read_env_value() {
  local key="$1"
  local default_value="$2"
  local env_file="$DOCKER_DIR/.env"
  local value=""

  if [ -f "$env_file" ]; then
    value="$(awk -F= -v key="$key" '
      $0 !~ /^[[:space:]]*#/ && $1 == key {
        sub(/^[^=]*=/, "")
        print
      }
    ' "$env_file" | tail -n 1)"
  fi

  if [ -z "$value" ]; then
    printf '%s' "$default_value"
    return
  fi

  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes)
        YES=true
        DRY_RUN=false
        ;;
      --dry-run)
        DRY_RUN=true
        ;;
      --repo-root)
        [ "$#" -ge 2 ] || fail "--repo-root requires a path"
        REPO_ROOT="$2"
        shift
        ;;
      --smoke-url)
        [ "$#" -ge 2 ] || fail "--smoke-url requires a URL"
        SMOKE_URL="$2"
        shift
        ;;
      --skip-smoke)
        SKIP_SMOKE=true
        ;;
      --skip-migration)
        SKIP_MIGRATION=true
        ;;
      --timeout)
        [ "$#" -ge 2 ] || fail "--timeout requires seconds"
        TIMEOUT_SECONDS="$2"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done
}

validate_number() {
  case "$TIMEOUT_SECONDS" in
    ''|*[!0-9]*)
      fail "--timeout must be a positive integer"
      ;;
  esac
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "docker command not found"
  docker compose version >/dev/null 2>&1 || fail "docker compose is not available"
}

validate_environment() {
  CURRENT_PHASE="validate"
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
  DOCKER_DIR="$REPO_ROOT/docker"

  [ -d "$DOCKER_DIR" ] || fail "Docker directory not found: $DOCKER_DIR"
  [ -f "$DOCKER_DIR/docker-compose.yaml" ] || fail "docker-compose.yaml not found in $DOCKER_DIR"
  [ -f "$DOCKER_DIR/.env" ] || fail ".env not found in $DOCKER_DIR"

  if [ "$DRY_RUN" = false ]; then
    [ "$YES" = true ] || fail "Destructive reset requires --yes"
    [ "${ALLOW_DIFY_TEST_RESET:-}" = "true" ] || fail "ALLOW_DIFY_TEST_RESET=true is required"
    [ "${DIFY_ENV_NAME:-}" = "test" ] || fail "DIFY_ENV_NAME=test is required"
    require_docker
  fi
}

acquire_lock() {
  CURRENT_PHASE="lock"
  local env_name="${DIFY_ENV_NAME:-dry-run}"
  LOCK_DIR="${TMPDIR:-/tmp}/dify-test-reset-${env_name}.lock"

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    fail "Reset lock is already held: $LOCK_DIR"
  fi

  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  trap cleanup EXIT
}

cleanup() {
  if [ -n "$LOCK_DIR" ] && [ -d "$LOCK_DIR" ]; then
    rm -rf "$LOCK_DIR"
  fi
}

compose() {
  local args=(compose --env-file "$DOCKER_DIR/.env" -f "$DOCKER_DIR/docker-compose.yaml")
  if [ -n "${DIFY_COMPOSE_PROJECT:-}" ]; then
    args+=(-p "$DIFY_COMPOSE_PROJECT")
  fi

  docker "${args[@]}" "$@"
}

compose_project_name() {
  if [ -n "${DIFY_COMPOSE_PROJECT:-}" ]; then
    printf '%s' "$DIFY_COMPOSE_PROJECT"
    return
  fi

  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    printf '%s' "$COMPOSE_PROJECT_NAME"
    return
  fi

  local env_project
  env_project="$(read_env_value COMPOSE_PROJECT_NAME "")"
  if [ -n "$env_project" ]; then
    printf '%s' "$env_project"
    return
  fi

  basename "$DOCKER_DIR"
}

active_db_service() {
  local db_type
  db_type="$(read_env_value DB_TYPE postgresql)"
  case "$db_type" in
    postgresql|'')
      printf '%s\n' "db_postgres"
      ;;
    mysql)
      printf '%s\n' "db_mysql"
      ;;
    oceanbase)
      printf '%s\n' "oceanbase"
      ;;
    *)
      printf '%s\n' "$db_type"
      ;;
  esac
}

active_vector_service() {
  local vector_store
  vector_store="$(read_env_value VECTOR_STORE weaviate)"
  case "$vector_store" in
    ''|none|external)
      return 0
      ;;
    pgvecto-rs|pgvecto_rs)
      printf '%s\n' "pgvecto-rs"
      ;;
    milvus)
      printf '%s\n' "milvus-standalone"
      ;;
    elasticsearch|opensearch|weaviate|qdrant|pgvector|chroma|oceanbase|seekdb|couchbase-server|iris)
      printf '%s\n' "$vector_store"
      ;;
    couchbase)
      printf '%s\n' "couchbase-server"
      ;;
    *)
      return 0
      ;;
  esac
}

safe_runtime_path() {
  local rel_path="$1"
  case "$rel_path" in
    ""|"/"| "." | ".." | *".."* | /*)
      return 1
      ;;
  esac

  case "$rel_path" in
    volumes/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

safe_named_volume() {
  local volume="$1"
  case "$volume" in
    ""|*"/"*|*" "*|*$'\t'*|*$'\n'*|*$'\r'*)
      return 1
      ;;
    *[!a-zA-Z0-9_.-]*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

volume_exists() {
  docker volume inspect "$1" >/dev/null 2>&1
}

append_unique_volume() {
  local candidate="$1"
  local existing
  [ -n "$candidate" ] || return 0

  for existing in "${RESOLVED_VOLUME_NAMES[@]}"; do
    if [ "$existing" = "$candidate" ]; then
      return
    fi
  done

  RESOLVED_VOLUME_NAMES+=("$candidate")
}

resolve_named_volume_names() {
  local logical_name="$1"
  local project_name
  local candidate
  local volume_list
  local status
  RESOLVED_VOLUME_NAMES=()

  project_name="$(compose_project_name)"

  set +e
  volume_list="$(docker volume ls -q \
    --filter "label=com.docker.compose.project=$project_name" \
    --filter "label=com.docker.compose.volume=$logical_name" 2>/dev/null)"
  status=$?
  set -e

  if [ "$status" -ne 0 ]; then
    fail "Failed to list Docker volumes for Compose project $project_name"
  fi

  while IFS= read -r candidate; do
    append_unique_volume "$candidate"
  done <<< "$volume_list"

  for candidate in "${project_name}_${logical_name}" "$logical_name"; do
    if volume_exists "$candidate"; then
      append_unique_volume "$candidate"
    fi
  done
}

collect_preserved_paths() {
  PRESERVED_PATHS=()
  local rel_path
  for rel_path in "${PRESERVE_PATHS[@]}"; do
    if [ -e "$DOCKER_DIR/$rel_path" ]; then
      PRESERVED_PATHS+=("$rel_path")
    fi
  done
}

print_plan() {
  CURRENT_PHASE="plan"
  local db_service
  local vector_service
  db_service="$(active_db_service)"
  vector_service="$(active_vector_service || true)"

  collect_preserved_paths

  log "Reset mode: $([ "$DRY_RUN" = true ] && printf dry-run || printf destructive)"
  log "Repository root: $REPO_ROOT"
  log "Docker directory: $DOCKER_DIR"
  log "Compose project: $(compose_project_name)"
  log "Database service: $db_service"
  log "Vector service: ${vector_service:-<external-or-none>}"
  log "Timeout: ${TIMEOUT_SECONDS}s"

  printf '\nPlanned runtime path deletions:\n'
  local rel_path
  for rel_path in "${RUNTIME_PATHS[@]}"; do
    printf '  - %s\n' "$rel_path"
  done

  printf '\nPlanned named volume deletions:\n'
  local volume
  for volume in "${NAMED_VOLUMES[@]}"; do
    printf '  - %s (Compose project: %s)\n' "$volume" "$(compose_project_name)"
  done

  printf '\nPreserved configuration paths found:\n'
  for rel_path in "${PRESERVED_PATHS[@]}"; do
    printf '  - %s\n' "$rel_path"
  done

  printf '\nCommands:\n'
  printf '  - docker compose down --remove-orphans\n'
  printf '  - delete allowlisted runtime paths and named volumes\n'
  printf '  - docker compose up -d %s redis%s\n' "$db_service" "${vector_service:+ $vector_service}"
  printf '  - docker compose run --rm -e MIGRATION_ENABLED=true -e MODE=migration api\n'
  printf '  - docker compose up -d\n'
  printf '  - health checks and smoke check\n\n'
}

delete_runtime_paths() {
  CURRENT_PHASE="delete-runtime-data"
  local rel_path
  local abs_path

  for rel_path in "${RUNTIME_PATHS[@]}"; do
    safe_runtime_path "$rel_path" || fail "Unsafe runtime path in allowlist: $rel_path"
    abs_path="$DOCKER_DIR/$rel_path"

    if [ ! -e "$abs_path" ]; then
      SKIPPED_PATHS+=("$rel_path (absent)")
      continue
    fi

    DELETED_PATHS+=("$rel_path")
    run_cmd rm -rf -- "$abs_path"
  done
}

delete_named_volumes() {
  CURRENT_PHASE="delete-runtime-volumes"
  local logical_name
  local actual_name

  for logical_name in "${NAMED_VOLUMES[@]}"; do
    safe_named_volume "$logical_name" || fail "Unsafe named volume in allowlist: $logical_name"
    resolve_named_volume_names "$logical_name"

    if [ "${#RESOLVED_VOLUME_NAMES[@]}" -eq 0 ]; then
      SKIPPED_NAMED_VOLUMES+=("$logical_name (absent)")
      continue
    fi

    for actual_name in "${RESOLVED_VOLUME_NAMES[@]}"; do
      DELETED_NAMED_VOLUMES+=("$actual_name")
      run_cmd docker volume rm "$actual_name"
    done
  done
}

stop_stack() {
  CURRENT_PHASE="stop-stack"
  run_cmd compose down --remove-orphans
}

start_middleware() {
  CURRENT_PHASE="start-middleware"
  local db_service
  local vector_service
  local services=()

  db_service="$(active_db_service)"
  vector_service="$(active_vector_service || true)"
  services+=("$db_service" "redis")

  if [ -n "$vector_service" ]; then
    services+=("$vector_service")
  fi

  run_cmd compose up -d "${services[@]}"
  if [ "$DRY_RUN" = false ]; then
    wait_for_services "${services[@]}"
  fi
}

run_migration() {
  CURRENT_PHASE="migration"
  if [ "$SKIP_MIGRATION" = true ]; then
    HEALTH_RESULTS+=("migration:skipped")
    return
  fi

  run_cmd compose run --rm -e MIGRATION_ENABLED=true -e MODE=migration api
  HEALTH_RESULTS+=("migration:ok")
}

start_full_stack() {
  CURRENT_PHASE="start-full-stack"
  run_cmd compose up -d

  if [ "$DRY_RUN" = false ]; then
    wait_for_services api web worker nginx
    wait_if_service_exists plugin_daemon
  fi
}

container_status() {
  local service="$1"
  local container_id
  container_id="$(compose ps -q "$service" 2>/dev/null || true)"
  [ -n "$container_id" ] || return 1

  local health
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  printf '%s' "$health"
}

wait_if_service_exists() {
  local service="$1"
  if [ -n "$(compose ps -q "$service" 2>/dev/null || true)" ]; then
    wait_for_services "$service"
  fi
}

wait_for_services() {
  local service
  for service in "$@"; do
    wait_for_service "$service"
  done
}

wait_for_service() {
  local service="$1"
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  local status=""

  log "Waiting for service: $service"
  while [ "$(date +%s)" -le "$deadline" ]; do
    status="$(container_status "$service" || true)"
    case "$status" in
      healthy|running)
        HEALTH_RESULTS+=("$service:$status")
        return 0
        ;;
      unhealthy|exited|dead)
        HEALTH_RESULTS+=("$service:$status")
        fail "Service $service reached failure status: $status"
        ;;
    esac
    sleep 3
  done

  HEALTH_RESULTS+=("$service:timeout")
  fail "Timed out waiting for service: $service"
}

default_smoke_url() {
  if [ -n "$SMOKE_URL" ]; then
    printf '%s' "$SMOKE_URL"
    return
  fi

  if [ -n "${RESET_TARGET_DOMAIN:-}" ]; then
    local https_enabled
    https_enabled="$(read_env_value NGINX_HTTPS_ENABLED false)"
    if [ "$https_enabled" = "true" ]; then
      printf 'https://%s' "$RESET_TARGET_DOMAIN"
    else
      printf 'http://%s' "$RESET_TARGET_DOMAIN"
    fi
    return
  fi

  local port
  port="$(read_env_value EXPOSE_NGINX_PORT 80)"
  printf 'http://localhost:%s' "$port"
}

run_smoke_check() {
  CURRENT_PHASE="smoke"
  if [ "$SKIP_SMOKE" = true ]; then
    SMOKE_RESULT="skipped"
    return
  fi

  local url
  url="$(default_smoke_url)"
  if [ "$DRY_RUN" = true ]; then
    SMOKE_RESULT="planned:$url"
    printf '+ curl -fsS --max-time 10 %q\n' "$url"
    return
  fi

  curl -fsS --max-time 10 "$url" >/dev/null || fail "Smoke check failed: $url"
  SMOKE_RESULT="ok:$url"
}

print_report() {
  local status="${1:-success}"
  local end_time
  end_time="$(date +%s)"

  printf '\nReset report\n'
  printf '============\n'
  printf 'status: %s\n' "$status"
  printf 'environment: %s\n' "${DIFY_ENV_NAME:-<unset>}"
  printf 'repo_root: %s\n' "${REPO_ROOT:-<unset>}"
  printf 'phase: %s\n' "$CURRENT_PHASE"
  printf 'duration_seconds: %s\n' "$(( end_time - START_TIME ))"
  printf 'mode: %s\n' "$([ "$DRY_RUN" = true ] && printf dry-run || printf destructive)"

  printf '\ndeleted_runtime_paths:\n'
  if [ "${#DELETED_PATHS[@]}" -eq 0 ]; then
    printf '  - <none>\n'
  else
    printf '  - %s\n' "${DELETED_PATHS[@]}"
  fi

  printf '\nskipped_runtime_paths:\n'
  if [ "${#SKIPPED_PATHS[@]}" -eq 0 ]; then
    printf '  - <none>\n'
  else
    printf '  - %s\n' "${SKIPPED_PATHS[@]}"
  fi

  printf '\ndeleted_named_volumes:\n'
  if [ "${#DELETED_NAMED_VOLUMES[@]}" -eq 0 ]; then
    printf '  - <none>\n'
  else
    printf '  - %s\n' "${DELETED_NAMED_VOLUMES[@]}"
  fi

  printf '\nskipped_named_volumes:\n'
  if [ "${#SKIPPED_NAMED_VOLUMES[@]}" -eq 0 ]; then
    printf '  - <none>\n'
  else
    printf '  - %s\n' "${SKIPPED_NAMED_VOLUMES[@]}"
  fi

  printf '\npreserved_paths:\n'
  if [ "${#PRESERVED_PATHS[@]}" -eq 0 ]; then
    printf '  - <none found>\n'
  else
    printf '  - %s\n' "${PRESERVED_PATHS[@]}"
  fi

  printf '\nhealth_results:\n'
  if [ "${#HEALTH_RESULTS[@]}" -eq 0 ]; then
    printf '  - <not run>\n'
  else
    printf '  - %s\n' "${HEALTH_RESULTS[@]}"
  fi

  printf '\nsmoke_result: %s\n' "$SMOKE_RESULT"
}

main() {
  parse_args "$@"
  validate_number
  validate_environment
  acquire_lock
  print_plan

  if [ "$DRY_RUN" = true ]; then
    run_smoke_check
    print_report "dry-run"
    return 0
  fi

  stop_stack
  delete_runtime_paths
  delete_named_volumes
  start_middleware
  run_migration
  start_full_stack
  run_smoke_check
  CURRENT_PHASE="complete"
  print_report "success"
}

main "$@"
