#!/bin/bash

set -x

# python style checks rely on `ruff` in path
if ! command -v ruff &> /dev/null; then
    echo "Installing Ruff ..."
    pip install ruff
fi

# run ruff linter
ruff check --fix --preview ./api

# env files linting relies on `dotenv-linter` in path
if ! command -v dotenv-linter &> /dev/null; then
    echo "Installing dotenv-linter ..."
    pip install dotenv-linter
fi

dotenv-linter ./api/.env.example ./web/.env.example
