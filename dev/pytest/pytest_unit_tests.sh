#!/bin/bash
set -euxo pipefail

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-20}"
PYTEST_XDIST_ARGS="${PYTEST_XDIST_ARGS:--n auto}"

# Run most tests in parallel (excluding controllers which have import conflicts with xdist)
# Controller tests have module-level side effects (Flask route registration) that cause
# race conditions when imported concurrently by multiple pytest-xdist workers.
pytest --timeout "${PYTEST_TIMEOUT}" ${PYTEST_XDIST_ARGS} api/tests/unit_tests --ignore=api/tests/unit_tests/controllers

# Run controller tests sequentially to avoid import race conditions
pytest --timeout "${PYTEST_TIMEOUT}" api/tests/unit_tests/controllers
