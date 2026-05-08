#!/bin/bash
# Setup script to copy all .env.example files to .env files
# This simplifies the setup process for users

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Setting up environment files..."

# Copy .env.example to .env in docker directory
if [ -f "$SCRIPT_DIR/.env.example" ]; then
    if [ ! -f "$SCRIPT_DIR/.env" ]; then
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        echo "Created .env from .env.example"
    else
        echo ".env already exists, skipping"
    fi
fi

# Copy all .env.example files to .env files recursively
if [ -d "$SCRIPT_DIR/envs" ]; then
    while IFS= read -r -d '' example_file; do
        env_file="${example_file%.example}"
        if [ ! -f "$env_file" ]; then
            cp "$example_file" "$env_file"
            echo "Created $env_file from $example_file"
        fi
    done < <(find "$SCRIPT_DIR/envs" -name "*.env.example" -type f -print0)
else
    echo "No envs directory found, skipping split environment files"
fi

echo "Environment files setup complete!"
echo ""
echo "You can now run: docker compose up -d"
