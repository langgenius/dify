#!/bin/bash

# rely on `poetry` in path
if ! command -v poetry &> /dev/null; then
    echo "Installing Poetry ..."
    pip install poetry
fi

# check poetry.lock in sync with pyproject.toml
poetry check -C api --lock
if [ $? -ne 0 ]; then
    # update poetry.lock
    # refreshing lockfile only without updating locked versions
    echo "poetry.lock is outdated, refreshing without updating locked versions ..."
    poetry lock -C api --no-update
else
  echo "poetry.lock is ready."
fi
