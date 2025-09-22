#!/bin/bash
set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

# ModelRuntime
dev/pytest/pytest_model_runtime.sh

# Tools
dev/pytest/pytest_tools.sh

# Workflow
dev/pytest/pytest_workflow.sh

# Unit tests
dev/pytest/pytest_unit_tests.sh

# TestContainers tests
dev/pytest/pytest_testcontainers.sh
