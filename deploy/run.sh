#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAMESPACE="${NAMESPACE:-acedatacloud}"

require_resource() {
  kind="$1"
  name="$2"
  if ! kubectl -n "${NAMESPACE}" get "${kind}" "${name}" >/dev/null 2>&1; then
    echo "Missing required ${kind}: ${name} (namespace: ${NAMESPACE})"
    return 1
  fi
  return 0
}

if [ "${APPLY_SECRETS:-false}" = "true" ]; then
  kubectl apply -f "${SCRIPT_DIR}/production/secret"
fi

if ! require_resource secret dify; then
  echo "Create it manually, or set APPLY_SECRETS=true after replacing placeholders in deploy/production/secret/dify.yml"
  exit 1
fi

if ! require_resource pvc dify; then
  echo "Create a RWX PVC named 'dify' first (recommended: Tencent CFS), then re-run."
  exit 1
fi

if [ "${SKIP_EXTERNAL_SECRET_CHECK:-false}" != "true" ]; then
  require_resource secret pgsql-qcloud || exit 1
  require_resource secret redis-qcloud || exit 1
  require_resource secret vdb-qcloud || exit 1
fi

if [ "${SKIP_IMAGE_PULL_SECRET_CHECK:-false}" != "true" ]; then
  require_resource secret docker-registry || exit 1
fi

if [ -z "${BUILD_NUMBER:-}" ] && [ "${ALLOW_LATEST_IMAGES:-false}" != "true" ]; then
  echo "BUILD_NUMBER is required (your cluster is currently trying to pull ghcr.io/acedatacloud/dify-api:latest which doesn't exist)."
  echo "Example: BUILD_NUMBER=2026.01.02 sh ${SCRIPT_DIR}/run.sh"
  echo "If you really want to deploy :latest, set ALLOW_LATEST_IMAGES=true."
  exit 1
fi

kubectl apply -f "${SCRIPT_DIR}/production/configmap"
kubectl apply -f "${SCRIPT_DIR}/production/service"
kubectl apply -f "${SCRIPT_DIR}/production/statefulset"
kubectl apply -f "${SCRIPT_DIR}/production/deployment"

if [ -n "${BUILD_NUMBER:-}" ]; then
  kubectl -n "${NAMESPACE}" set image statefulset/dify-api \
    dify-api="ghcr.io/acedatacloud/dify-api:${BUILD_NUMBER}"

  kubectl -n "${NAMESPACE}" set image statefulset/dify-worker \
    dify-worker="ghcr.io/acedatacloud/dify-api:${BUILD_NUMBER}"

  kubectl -n "${NAMESPACE}" set image deployment/dify-worker-beat \
    dify-worker-beat="ghcr.io/acedatacloud/dify-api:${BUILD_NUMBER}"

  kubectl -n "${NAMESPACE}" set image deployment/dify-web \
    dify-web="ghcr.io/acedatacloud/dify-web:${BUILD_NUMBER}"
fi
