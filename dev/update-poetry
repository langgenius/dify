#!/bin/bash

# rely on `poetry` in path
if ! command -v poetry &> /dev/null; then
    echo "Installing Poetry ..."
    pip install poetry
fi

# refreshing lockfile, updating locked versions
poetry update -C api

# check poetry.lock in sync with pyproject.toml
poetry check -C api --lock
