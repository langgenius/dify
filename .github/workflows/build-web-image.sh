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

echo "Pulling cache image ${WEB_REPO_NAME}:${CACHE_FROM_TAG}"
if docker pull "${WEB_REPO_NAME}:${CACHE_FROM_TAG}"; then
  WEB_CACHE_FROM_SCRIPT="--cache-from ${WEB_REPO_NAME}:${CACHE_FROM_TAG}"
else
  echo "WARNING: Failed to pull ${WEB_REPO_NAME}:${CACHE_FROM_TAG}, disable build image cache."
  WEB_CACHE_FROM_SCRIPT=""
fi


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
docker build \
  ${WEB_CACHE_FROM_SCRIPT} \
  --build-arg COMMIT_SHA=${SHA} \
  -t "${WEB_REPO_NAME}:${SHA}" \
  -t "${WEB_REPO_NAME}:${REFSPEC}" \
  -t "${WEB_REPO_NAME}:${LATEST_TAG}" \
  --label "sha=${SHA}" \
  --label "built_at=$(date)" \
  --label "build_actor=${GITHUB_ACTOR}" \
  .

docker push --all-tags "${WEB_REPO_NAME}"