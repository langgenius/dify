#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="${ROOT_DIR}/e2e"
WEB_DIR="${ROOT_DIR}/web"
WEB_ENV_LOCAL="${WEB_DIR}/.env.local"

cleanup() {
  bash "${E2E_DIR}/scripts/stop-middleware.sh" || true
}

trap cleanup EXIT

if [[ ! -f "${WEB_ENV_LOCAL}" ]]; then
  cp "${WEB_DIR}/.env.example" "${WEB_ENV_LOCAL}"
fi

perl -0pi -e 's|http://localhost:5001|http://127.0.0.1:5001|g' "${WEB_ENV_LOCAL}"

bash "${E2E_DIR}/scripts/reset-state.sh"
bash "${E2E_DIR}/scripts/start-middleware.sh"

cd "${E2E_DIR}"
pnpm exec playwright test "$@"
