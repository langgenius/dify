#!/bin/bash
set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-120}"

pytest --timeout "${PYTEST_TIMEOUT}" api/tests/integration_tests/tools
