#!/usr/bin/env bash
set -euo pipefail

REGISTRY="${REGISTRY:-crpi-2e30x3ttfmqmx83q.cn-chengdu.personal.cr.aliyuncs.com}"
NAMESPACE="${NAMESPACE:-dify-vision}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

api_image="$REGISTRY/$NAMESPACE/dify-api:$TAG"
web_image="$REGISTRY/$NAMESPACE/dify-web:$TAG"

cd "$root_dir"

docker buildx build \
  --platform "$PLATFORM" \
  --build-arg "COMMIT_SHA=$(git rev-parse HEAD)" \
  -t "$api_image" \
  --push \
  api

docker buildx build \
  --platform "$PLATFORM" \
  --build-arg "COMMIT_SHA=$(git rev-parse HEAD)" \
  -t "$web_image" \
  --push \
  web
