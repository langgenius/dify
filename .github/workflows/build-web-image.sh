#!/usr/bin/env bash

set -eo pipefail

SHA=$(git rev-parse HEAD)
REPO_NAME=langgenius/dify
WEB_REPO_NAME="${REPO_NAME}-web"

if [[ "${GITHUB_EVENT_NAME}" == "pull_request" ]]; then
  REFSPEC=$(echo "${GITHUB_HEAD_REF}" | sed 's/[^a-zA-Z0-9]/-/g' | head -c 40)
  PR_NUM=$(echo "${GITHUB_REF}" | sed 's:refs/pull/::' | sed 's:/merge::')
  LATEST_TAG="pr-${PR_NUM}"
  CACHE_FROM_TAG="latest"
elif [[ "${GITHUB_EVENT_NAME}" == "release" ]]; then
  REFSPEC=$(echo "${GITHUB_REF}" | sed 's:refs/tags/::' | head -c 40)
  LATEST_TAG="${REFSPEC}"
  CACHE_FROM_TAG="latest"
else
  REFSPEC=$(echo "${GITHUB_REF}" | sed 's:refs/heads/::' | sed 's/[^a-zA-Z0-9]/-/g' | head -c 40)
  LATEST_TAG="${REFSPEC}"
  CACHE_FROM_TAG="${REFSPEC}"
fi

if [[ "${REFSPEC}" == "main" ]]; then
  LATEST_TAG="latest"
  CACHE_FROM_TAG="latest"
fi

docker buildx create --use --driver=docker-container

cat<<EOF
  Rolling with tags:
  - ${WEB_REPO_NAME}:${SHA}
  - ${WEB_REPO_NAME}:${REFSPEC}
  - ${WEB_REPO_NAME}:${LATEST_TAG}
EOF

#
# Build image
#
cd web
docker buildx build \
  --cache-to type=gha,mode=max,scope=$CACHE_FROM_TAG-api-image \
  --cache-from type=gha,mode=max,scope=$CACHE_FROM_TAG-api-image \
  --build-arg COMMIT_SHA=${SHA} \
  --platform=linux/amd64,linux/arm64 \
  -t "${WEB_REPO_NAME}:${SHA}" \
  -t "${WEB_REPO_NAME}:${REFSPEC}" \
  -t "${WEB_REPO_NAME}:${LATEST_TAG}" \
  --label "sha=${SHA}" \
  --label "built_at=$(date)" \
  --label "build_actor=${GITHUB_ACTOR}" \
  --push \
  .