#!/bin/bash

# rely on `uv` in path
if ! command -v uv &> /dev/null; then
    echo "Installing uv ..."
    pip install uv
fi

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/.."

# check uv.lock in sync with pyproject.toml
uv lock --project api
