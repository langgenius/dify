#!/bin/bash
set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-180}"

pytest --timeout "${PYTEST_TIMEOUT}" \
  api/tests/integration_tests/workflow \
  api/tests/integration_tests/tools \
  api/tests/test_containers_integration_tests \
  api/tests/unit_tests
