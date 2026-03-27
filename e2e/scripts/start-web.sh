#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
BUILD_ID_PATH="${WEB_DIR}/.next/BUILD_ID"

cd "${WEB_DIR}"

if [[ "${E2E_FORCE_WEB_BUILD:-0}" == "1" ]]; then
  pnpm run build
elif [[ -f "${BUILD_ID_PATH}" ]]; then
  echo "Reusing existing web build artifact."
else
  pnpm run build
fi

exec env PORT=3000 HOSTNAME=127.0.0.1 pnpm run start
