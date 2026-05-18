#!/usr/bin/env bash
set -euo pipefail

BASE_SHA=${BASE_SHA:-}
HEAD_SHA=${HEAD_SHA:-}
MAIN_REF=${MAIN_REF:-origin/main}
REMEDIATION_HINT="Changes should be made from the main branch using git cherry-pick -x."

error() {
  printf 'ERROR: %s\n' "$1" >&2
}

if [[ -z "$BASE_SHA" || -z "$HEAD_SHA" ]]; then
  error "BASE_SHA and HEAD_SHA are required. $REMEDIATION_HINT"
  exit 2
fi

if ! git rev-parse --verify "$BASE_SHA^{commit}" > /dev/null 2>&1; then
  error "Base commit '$BASE_SHA' is not available in the local git checkout."
  exit 2
fi

if ! git rev-parse --verify "$HEAD_SHA^{commit}" > /dev/null 2>&1; then
  error "Head commit '$HEAD_SHA' is not available in the local git checkout."
  exit 2
fi

if ! git rev-parse --verify "$MAIN_REF^{commit}" > /dev/null 2>&1; then
  error "Main ref '$MAIN_REF' is not available in the local git checkout. $REMEDIATION_HINT"
  exit 2
fi

failed=0
checked=0

while IFS= read -r commit_sha; do
  [[ -n "$commit_sha" ]] || continue

  checked=$((checked + 1))
  subject=$(git log -1 --format=%s "$commit_sha")
  source_sha=$(
    git log -1 --format=%B "$commit_sha" \
      | sed -nE 's/^\(cherry picked from commit ([0-9a-fA-F]{7,64})\)$/\1/p' \
      | tail -n 1
  )

  if [[ -z "$source_sha" ]]; then
    error "Commit $commit_sha ($subject) is missing cherry-pick provenance. $REMEDIATION_HINT"
    failed=1
    continue
  fi

  if ! git cat-file -e "$source_sha^{commit}" 2> /dev/null; then
    error "Commit $commit_sha ($subject) references source $source_sha, but that commit is not available locally. $REMEDIATION_HINT"
    failed=1
    continue
  fi

  if ! git merge-base --is-ancestor "$source_sha" "$MAIN_REF"; then
    error "Commit $commit_sha ($subject) references source $source_sha, but that source is not reachable from main ($MAIN_REF). $REMEDIATION_HINT"
    failed=1
  fi
done < <(git rev-list --reverse "$BASE_SHA..$HEAD_SHA")

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

if [[ "$checked" -eq 0 ]]; then
  echo "No PR commits to check."
else
  echo "Verified $checked PR commit(s) include cherry-pick provenance from main."
fi
