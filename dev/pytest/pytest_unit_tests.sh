#!/bin/bash
set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-20}"
PYTEST_XDIST_ARGS="${PYTEST_XDIST_ARGS:--n auto}"

# libs
pytest --timeout "${PYTEST_TIMEOUT}" ${PYTEST_XDIST_ARGS} api/tests/unit_tests
