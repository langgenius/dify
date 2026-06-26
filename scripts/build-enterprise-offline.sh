#!/usr/bin/env bash

set -euo pipefail

VERSION="enterprise-local"
OUTPUT_DIR="dist/offline"
MODE="smart"

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
    -Mode|--Mode)
      MODE="${2:?missing value for $1}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: ./scripts/build-enterprise-offline.sh [-Version <version>] [-OutputDir <dir>] [-Mode <smart|rebuild|reuse>]" >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  smart|rebuild|reuse)
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$REPO_ROOT/docker"
ENV_FILE="$DOCKER_DIR/.env"
OUTPUT_PATH="$REPO_ROOT/$OUTPUT_DIR"
WEB_BUILD_CONTEXT=""

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing docker/.env. Copy docker/.env.example to docker/.env and fill in deployment settings first." >&2
  exit 1
fi

API_IMAGE="dify-api-enterprise:$VERSION"
WEB_IMAGE="dify-web-enterprise:$VERSION"
PREVIOUS_DIFY_ENTERPRISE_VERSION="${DIFY_ENTERPRISE_VERSION-__UNSET__}"
PREVIOUS_DEBUG="${DEBUG-__UNSET__}"
PREVIOUS_ENTERPRISE_ENABLED="${ENTERPRISE_ENABLED-__UNSET__}"
PREVIOUS_COMPOSE_PROFILES="${COMPOSE_PROFILES-__UNSET__}"
export DIFY_ENTERPRISE_VERSION="$VERSION"
export DEBUG="${DEBUG:-false}"
export ENTERPRISE_ENABLED="${ENTERPRISE_ENABLED:-false}"
if [[ -z "${COMPOSE_PROFILES:-}" ]]; then
  ENV_VECTOR_STORE="$(awk -F= '/^VECTOR_STORE=/{print $2; exit}' "$ENV_FILE")"
  ENV_DB_TYPE="$(awk -F= '/^DB_TYPE=/{print $2; exit}' "$ENV_FILE")"
  export COMPOSE_PROFILES="${ENV_VECTOR_STORE:-weaviate},${ENV_DB_TYPE:-postgresql}"
fi

mkdir -p "$OUTPUT_PATH"

cleanup() {
  if [[ -n "$WEB_BUILD_CONTEXT" ]]; then
    rm -rf "$WEB_BUILD_CONTEXT"
  fi

  if [[ "$PREVIOUS_DIFY_ENTERPRISE_VERSION" == "__UNSET__" ]]; then
    unset DIFY_ENTERPRISE_VERSION
  else
    export DIFY_ENTERPRISE_VERSION="$PREVIOUS_DIFY_ENTERPRISE_VERSION"
  fi
  if [[ "$PREVIOUS_DEBUG" == "__UNSET__" ]]; then
    unset DEBUG
  else
    export DEBUG="$PREVIOUS_DEBUG"
  fi
  if [[ "$PREVIOUS_ENTERPRISE_ENABLED" == "__UNSET__" ]]; then
    unset ENTERPRISE_ENABLED
  else
    export ENTERPRISE_ENABLED="$PREVIOUS_ENTERPRISE_ENABLED"
  fi
  if [[ "$PREVIOUS_COMPOSE_PROFILES" == "__UNSET__" ]]; then
    unset COMPOSE_PROFILES
  else
    export COMPOSE_PROFILES="$PREVIOUS_COMPOSE_PROFILES"
  fi
}

trap cleanup EXIT

get_image_commit_sha() {
  local image="$1"
  docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | awk -F= '/^COMMIT_SHA=/{print $2; exit}'
}

is_reusable_image() {
  local image="$1"
  local expected="$2"
  local actual
  actual="$(get_image_commit_sha "$image" || true)"
  [[ -n "$actual" && "$actual" == "$expected" ]]
}

ensure_enterprise_image() {
  local image="$1"
  local dockerfile="$2"
  local context_path="$3"
  local expected="$4"
  local mode="$5"

  if [[ "$mode" == "reuse" ]]; then
    if ! is_reusable_image "$image" "$expected"; then
      echo "Image $image is not reusable. Expected COMMIT_SHA=$expected." >&2
      exit 1
    fi
    echo "Reusing enterprise image: $image"
    return
  fi

  if [[ "$mode" == "smart" ]] && is_reusable_image "$image" "$expected"; then
    echo "Reusing enterprise image: $image"
    return
  fi

  echo "Building enterprise image: $image"
  docker build \
    --build-arg "COMMIT_SHA=$expected" \
    -f "$dockerfile" \
    -t "$image" \
    "$context_path"
}

build_enterprise_web_image() {
  local image="$1"
  local expected="$2"
  local mode="$3"

  if [[ "$mode" == "reuse" ]]; then
    if ! is_reusable_image "$image" "$expected"; then
      echo "Image $image is not reusable. Expected COMMIT_SHA=$expected." >&2
      exit 1
    fi
    echo "Reusing enterprise image: $image"
    return
  fi

  if [[ "$mode" == "smart" ]] && is_reusable_image "$image" "$expected"; then
    echo "Reusing enterprise image: $image"
    return
  fi

  local temp_context
  temp_context="$(mktemp -d)"
  WEB_BUILD_CONTEXT="$temp_context"

  echo "Building enterprise image: $image"
  cp "$REPO_ROOT/package.json" "$REPO_ROOT/pnpm-lock.yaml" "$REPO_ROOT/pnpm-workspace.yaml" "$temp_context/"
  [[ -f "$REPO_ROOT/.nvmrc" ]] && cp "$REPO_ROOT/.nvmrc" "$temp_context/"
  cp -R "$REPO_ROOT/web" "$REPO_ROOT/e2e" "$REPO_ROOT/packages" "$REPO_ROOT/sdks" "$temp_context/"
  find "$temp_context" \
    \( -path '*/node_modules' -o -path '*/.next' -o -path '*/dist' -o -path '*/build' -o -path '*/coverage' -o -path '*/.pnpm-store' \) \
    -prune -exec rm -rf {} +

  docker build \
    --build-arg "COMMIT_SHA=$expected" \
    -f "$temp_context/web/Dockerfile" \
    -t "$image" \
    "$temp_context"
}

ensure_enterprise_image "$API_IMAGE" "$REPO_ROOT/api/Dockerfile" "$REPO_ROOT/api" "$VERSION" "$MODE"
build_enterprise_web_image "$WEB_IMAGE" "$VERSION" "$MODE"

echo "Resolving compose image list"
mapfile -t IMAGES < <(
  docker compose --env-file "$ENV_FILE" \
    -f "$DOCKER_DIR/docker-compose.yaml" \
    -f "$DOCKER_DIR/docker-compose.enterprise.yaml" \
    config --images | sed '/^[[:space:]]*$/d' | sort -u
)

if [[ ${#IMAGES[@]} -eq 0 ]]; then
  echo "Unable to resolve images from docker compose configuration." >&2
  exit 1
fi

for image in "${IMAGES[@]}"; do
  if [[ "$image" != "$API_IMAGE" && "$image" != "$WEB_IMAGE" ]]; then
    if docker image inspect "$image" >/dev/null 2>&1; then
      echo "Reusing local dependency image: $image"
    else
      echo "Pulling dependency image: $image"
      docker pull "$image"
    fi
  fi
done

MANIFEST_PATH="$OUTPUT_PATH/manifest-$VERSION.json"
IMAGES_PATH="$OUTPUT_PATH/images-$VERSION.txt"
ARCHIVE_PATH="$OUTPUT_PATH/dify-enterprise-offline-$VERSION.tar"

printf '%s\n' "${IMAGES[@]}" > "$IMAGES_PATH"

python3 - <<PY
from datetime import datetime, timezone
from pathlib import Path
import json

manifest_path = Path(r"$MANIFEST_PATH")
images = Path(r"$IMAGES_PATH").read_text(encoding="utf-8").splitlines()
manifest = {
    "version": r"$VERSION",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "images": images,
}
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY

echo "Saving offline image bundle to $ARCHIVE_PATH"
docker save -o "$ARCHIVE_PATH" "${IMAGES[@]}"

echo "Offline bundle ready."
echo "Manifest: $MANIFEST_PATH"
echo "Images : $IMAGES_PATH"
echo "Archive: $ARCHIVE_PATH"
