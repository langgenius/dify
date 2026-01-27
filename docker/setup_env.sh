#!/bin/bash
# Setup script to copy all .env.example files to .env files
# This simplifies the setup process for users

set -e

echo "Setting up environment files..."

# Copy .env.example to .env in docker directory
if [ -f ".env.example" ]; then
    if [ ! -f ".env" ]; then
        cp .env.example .env
        echo "Created .env from .env.example"
    else
        echo ".env already exists, skipping"
    fi
fi

# Copy all .env.example files to .env files recursively
find envs -name "*.env.example" -type f | while read -r example_file; do
    env_file="${example_file%.example}"
    if [ ! -f "$env_file" ]; then
        cp "$example_file" "$env_file"
        echo "Created $env_file from $example_file"
    fi
done

echo "Environment files setup complete!"
echo ""
echo "You can now run: docker compose up -d"
