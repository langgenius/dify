#!/usr/bin/env bash
# release-r2-publish.sh — direct-publish difyctl binaries + manifest + index to R2.
# Strict order so the pointer never references missing bytes:
#   sync binaries -> HEAD-verify -> put index.json -> put manifest.json -> prune.
# Installers (install-r2.sh/.ps1) are served from the GitHub repo, not R2.
# Usage: release-r2-publish.sh <channel> <version>
# Env: R2_S3_ENDPOINT R2_BUCKET R2_PUBLIC_BASE (+ AWS creds, AWS_REQUEST_CHECKSUM_CALCULATION).
set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${DIST_DIR:-${_dir}/../dist/bin}"

aws_s3() { aws --endpoint-url "$R2_S3_ENDPOINT" "$@"; }

publish_main() {
  local channel="$1" version="$2"
  local key="difyctl/${channel}/${version}"
  local pointer_prefix="difyctl/${channel}"
  local base_url="${R2_PUBLIC_BASE}/${key}"

  local current="" new_index="" prune_list="" manifest=""
  trap 'rm -f "$current" "$new_index" "$prune_list" "$manifest"' RETURN

  # 1. binaries (+ checksums) — immutable
  aws_s3 s3 sync "$DIST_DIR" "s3://${R2_BUCKET}/${key}/" \
    --content-type application/octet-stream \
    --cache-control "public, max-age=31536000, immutable"

  # 2. HEAD-verify each expected target asset exists on R2. Capture targets into
  #    a variable first; a process-substitution producer failure bypasses set -e.
  local targets
  targets="$(node "${_dir}/release-naming.mjs" targets)"
  [ -n "$targets" ] || { echo "release-r2-publish: no release targets resolved" >&2; exit 1; }
  local verified=0 _bun id _exe asset
  while IFS=$'\t' read -r _bun id _exe; do
    asset="$(node "${_dir}/release-naming.mjs" asset "$version" "$id")"
    aws_s3 s3api head-object --bucket "$R2_BUCKET" --key "${key}/${asset}" >/dev/null
    verified=$((verified + 1))
  done <<< "$targets"
  [ "$verified" -gt 0 ] || { echo "release-r2-publish: verified zero targets" >&2; exit 1; }

  # 3. index.json: fetch current, prepend, truncate; capture prune dirs on stderr.
  current="$(mktemp)"
  curl -fsSL "${R2_PUBLIC_BASE}/${pointer_prefix}/index.json" -o "$current" 2>/dev/null || echo '-' > "$current"
  new_index="$(mktemp)"; prune_list="$(mktemp)"
  node "${_dir}/release-r2-edge.mjs" index --current "$current" --channel "$channel" \
    --version "$version" --commit "${DIFYCTL_COMMIT:-unknown}" --build-date "${DIFYCTL_BUILD_DATE:-unknown}" \
    >"$new_index" 2>"$prune_list"
  aws_s3 s3 cp "$new_index" "s3://${R2_BUCKET}/${pointer_prefix}/index.json" \
    --content-type application/json --cache-control "public, max-age=60, must-revalidate"

  # 4. manifest.json — pointer; written last so it never references missing binaries
  manifest="$(mktemp)"
  node "${_dir}/release-r2-edge.mjs" manifest --channel "$channel" --version "$version" \
    --commit "${DIFYCTL_COMMIT:-unknown}" --build-date "${DIFYCTL_BUILD_DATE:-unknown}" \
    --base-url "$base_url" --checksums "${DIST_DIR}/difyctl-v${version}-checksums.txt" >"$manifest"
  aws_s3 s3 cp "$manifest" "s3://${R2_BUCKET}/${pointer_prefix}/manifest.json" \
    --content-type application/json --cache-control "public, max-age=60, must-revalidate"

  # 5. prune stale dirs (each line from release-r2-edge stderr)
  local dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    aws_s3 s3 rm "s3://${R2_BUCKET}/${pointer_prefix}/${dir}/" --recursive
  done < "$prune_list"
}

if [ "${RELEASE_PUBLISH_LIB:-0}" != "1" ]; then
  [ "$#" -eq 2 ] || { echo "usage: release-r2-publish.sh <channel> <version>" >&2; exit 2; }
  publish_main "$1" "$2"
fi
