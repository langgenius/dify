#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="${ROOT_DIR}/e2e"
WEB_DIR="${ROOT_DIR}/web"
WEB_ENV_LOCAL="${WEB_DIR}/.env.local"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"
API_URL="${E2E_API_URL:-http://127.0.0.1:5001}"

API_PID=""
WEB_MANAGER_PID=""
HEADED=0
START_MIDDLEWARE=0
RESET_STATE=0
FORWARD_ARGS=()
HAS_CUSTOM_TAGS=0
WEB_READY_FILE=""

stop_process() {
  local pid="$1"

  if [[ -z "${pid}" ]]; then
    return 0
  fi

  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
    wait "${pid}" 2>/dev/null || true
  fi
}

cleanup() {
  stop_process "${WEB_MANAGER_PID}"
  stop_process "${API_PID}"

  if [[ "${START_MIDDLEWARE}" == "1" ]]; then
    bash "${E2E_DIR}/scripts/stop-middleware.sh" || true
  fi
}

trap cleanup EXIT

while (($# > 0)); do
  case "$1" in
    --)
      shift
      FORWARD_ARGS+=("$@")
      break
      ;;
    --full)
      START_MIDDLEWARE=1
      RESET_STATE=1
      ;;
    --headed)
      HEADED=1
      ;;
    *)
      FORWARD_ARGS+=("$1")
      ;;
  esac
  shift
done

if ((${#FORWARD_ARGS[@]})); then
  for arg in "${FORWARD_ARGS[@]}"; do
    if [[ "${arg}" == "--tags" || "${arg}" == --tags=* ]]; then
      HAS_CUSTOM_TAGS=1
      break
    fi
  done
fi

if [[ ! -f "${WEB_ENV_LOCAL}" ]]; then
  cp "${WEB_DIR}/.env.example" "${WEB_ENV_LOCAL}"
fi

perl -0pi -e 's|http://localhost:5001|http://127.0.0.1:5001|g' "${WEB_ENV_LOCAL}"

if [[ "${RESET_STATE}" == "1" ]]; then
  bash "${E2E_DIR}/scripts/reset-state.sh"
fi

if [[ "${START_MIDDLEWARE}" == "1" ]]; then
  bash "${E2E_DIR}/scripts/start-middleware.sh"
fi

rm -rf "${E2E_DIR}/cucumber-report"
mkdir -p "${E2E_DIR}/.logs"
WEB_READY_FILE="${E2E_DIR}/.logs/web-server.ready.json"
rm -f "${WEB_READY_FILE}"

bash "${E2E_DIR}/scripts/start-api.sh" >"${E2E_DIR}/.logs/cucumber-api.log" 2>&1 &
API_PID="$!"

E2E_WEB_SERVER_READY_FILE="${WEB_READY_FILE}" \
E2E_WEB_SERVER_LOG_PATH="${E2E_DIR}/.logs/cucumber-web.log" \
pnpm exec node --import tsx ./support/cli/start-web-server.ts >"${E2E_DIR}/.logs/web-server-manager.log" 2>&1 &
WEB_MANAGER_PID="$!"

for _ in $(seq 1 180); do
  if curl -fsS "${API_URL}/health" >/dev/null 2>&1; then
    break
  fi

  sleep 1
done

if ! curl -fsS "${API_URL}/health" >/dev/null 2>&1; then
  echo "API did not become ready at ${API_URL}/health." >&2
  exit 1
fi

for _ in $(seq 1 300); do
  if [[ -f "${WEB_READY_FILE}" ]]; then
    if grep -q '"error"' "${WEB_READY_FILE}"; then
      cat "${WEB_READY_FILE}" >&2
      exit 1
    fi

    break
  fi

  if [[ -n "${WEB_MANAGER_PID}" ]] && ! kill -0 "${WEB_MANAGER_PID}" >/dev/null 2>&1; then
    echo "Web server manager exited before the web server became ready." >&2
    exit 1
  fi

  sleep 1
done

if [[ ! -f "${WEB_READY_FILE}" ]]; then
  echo "Web server did not become ready in time." >&2
  exit 1
fi

export CUCUMBER_HEADLESS=1
if [[ "${HEADED}" == "1" ]]; then
  export CUCUMBER_HEADLESS=0
fi

unset E2E_CUCUMBER_TAGS
if [[ "${START_MIDDLEWARE}" == "1" && "${HAS_CUSTOM_TAGS}" != "1" ]]; then
  export E2E_CUCUMBER_TAGS='not @skip'
fi

cd "${E2E_DIR}"

CUCUMBER_ARGS=(
  --config
  ./cucumber.config.js
)

if ((${#FORWARD_ARGS[@]})); then
  CUCUMBER_ARGS+=("${FORWARD_ARGS[@]}")
fi

pnpm exec cucumber-js "${CUCUMBER_ARGS[@]}"
