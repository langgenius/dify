#!/usr/bin/env bash
# Build difyctl image from local source using Dockerfile.dev.
# Context is the repo root so workspace deps (packages/tsconfig) are available.
#
# Usage:
#   scripts/docker-build-dev.sh [IMAGE_TAG]
#
# Examples:
#   scripts/docker-build-dev.sh                              # → ghcr.io/langgenius/difyctl:dev
#   scripts/docker-build-dev.sh ghcr.io/langgenius/difyctl:pr-123

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLI_DIR/.." && pwd)"

TAG="${1:-ghcr.io/langgenius/difyctl:dev}"

echo "→ Building difyctl from source"
echo "  context : $REPO_ROOT"
echo "  tag     : $TAG"

docker build \
  --file "$CLI_DIR/Dockerfile.dev" \
  --tag "$TAG" \
  "$REPO_ROOT"

echo "✓ Built $TAG"
