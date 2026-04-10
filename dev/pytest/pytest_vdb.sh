#!/bin/bash
set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-180}"

uv sync --project api --group dev 

uv run --project api pytest --timeout "${PYTEST_TIMEOUT}" \
  api/providers/vdb/*/tests/integration_tests \
