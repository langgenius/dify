#!/bin/bash

# Update dependencies in dify/api project using uv
set -e
set -o pipefail

SCRIPT_DIR="$(dirname "$0")"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"

# rely on `poetry` in path
if ! command -v uv &> /dev/null; then
    echo "Installing uv ..."
    pip install uv
fi

cd "${REPO_ROOT}"

# refreshing lockfile, updating locked versions
uv lock --project api --upgrade

# check uv.lock in sync with pyproject.toml
uv lock --project api --check
