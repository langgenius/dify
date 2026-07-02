#!/usr/bin/env bash

set -euo pipefail

VERSION="enterprise-local"
OUTPUT_DIR="dist/offline"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -Version|--Version)
      VERSION="${2:?missing value for $1}"
      shift 2
      ;;
    -OutputDir|--OutputDir)
      OUTPUT_DIR="${2:?missing value for $1}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: ./scripts/build-enterprise-config-package.sh [-Version <version>] [-OutputDir <dir>]" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_PATH="$REPO_ROOT/$OUTPUT_DIR"
MANIFEST_PATH="$OUTPUT_PATH/manifest-$VERSION.json"
IMAGES_PATH="$OUTPUT_PATH/images-$VERSION.txt"
ARCHIVE_PATH="$OUTPUT_PATH/dify-enterprise-config-$VERSION.tar.gz"

required_files=(
  "docker/docker-compose.yaml"
  "docker/docker-compose.enterprise.yaml"
  "docker/.env.example"
  "docker/ENTERPRISE_DEPLOY_STARTUP.md"
  "docker/UPGRADE_1.14.2_TO_1.15.0_ENTERPRISE.md"
  "docker/dify-env-sync.py"
  "docker/dify-env-sync.sh"
  "docker/README.enterprise.md"
  "scripts/check-enterprise-vector-indexes.sh"
  "$OUTPUT_DIR/manifest-$VERSION.json"
  "$OUTPUT_DIR/images-$VERSION.txt"
)

mapfile -d '' env_example_files < <(find "$REPO_ROOT/docker/envs" -type f -name "*.env.example" -printf "docker/envs/%P\0" | sort -z)
if [[ ${#env_example_files[@]} -eq 0 ]]; then
  echo "Missing required docker/envs/*.env.example files." >&2
  exit 1
fi
required_files+=("${env_example_files[@]}")

required_dirs=(
  "docker/nginx"
  "docker/ssrf_proxy"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$REPO_ROOT/$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

for path in "${required_dirs[@]}"; do
  if [[ ! -d "$REPO_ROOT/$path" ]]; then
    echo "Missing required directory: $path" >&2
    exit 1
  fi
done

if [[ ! -f "$MANIFEST_PATH" || ! -f "$IMAGES_PATH" ]]; then
  echo "Missing offline manifest or image list for version $VERSION." >&2
  echo "Run build-enterprise-offline with Mode=reuse after image validation first." >&2
  exit 1
fi

mkdir -p "$OUTPUT_PATH"

tar \
  --create \
  --gzip \
  --file "$ARCHIVE_PATH" \
  --directory "$REPO_ROOT" \
  "${required_files[@]}" \
  "${required_dirs[@]}"

echo "Enterprise configuration bundle ready."
echo "Archive: $ARCHIVE_PATH"
