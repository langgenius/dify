#!/usr/bin/env bash
# release-r2-publish.sh — direct-publish difyctl binaries + manifest + index to R2.
# Strict order so the pointer never references missing bytes (spec §8):
#   sync binaries -> HEAD-verify -> put index.json -> put manifest.json -> put installers -> prune.
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

  # 1. binaries (+ checksums) — immutable
  aws_s3 s3 sync "$DIST_DIR" "s3://${R2_BUCKET}/${key}/" \
    --content-type application/octet-stream \
    --cache-control "public, max-age=31536000, immutable"

  # 2. HEAD-verify each expected target asset exists on R2
  local id exe asset
  while IFS=$'\t' read -r _bun id exe; do
    [ "$exe" = "1" ] && asset="difyctl-v${version}-${id}.exe" || asset="difyctl-v${version}-${id}"
    aws_s3 s3api head-object --bucket "$R2_BUCKET" --key "${key}/${asset}" >/dev/null
  done < <(node "${_dir}/release-naming.mjs" targets)

  # 3. index.json: fetch current, prepend, truncate; capture prune dirs on stderr.
  #    release-r2-edge.mjs treats an empty/"-"/missing file as "no ledger yet".
  local current; current="$(mktemp)"
  curl -fsSL "${R2_PUBLIC_BASE}/${pointer_prefix}/index.json" -o "$current" 2>/dev/null || echo '-' > "$current"
  local new_index prune_list; new_index="$(mktemp)"; prune_list="$(mktemp)"
  node "${_dir}/release-r2-edge.mjs" index --current "$current" --channel "$channel" \
    --version "$version" --commit "${DIFYCTL_COMMIT:-unknown}" --build-date "${DIFYCTL_BUILD_DATE:-unknown}" \
    >"$new_index" 2>"$prune_list"
  aws_s3 s3 cp "$new_index" "s3://${R2_BUCKET}/${pointer_prefix}/index.json" \
    --content-type application/json --cache-control "public, max-age=60, must-revalidate"

  # 4. manifest.json — THE COMMIT POINT (pointer flips last)
  local manifest; manifest="$(mktemp)"
  node "${_dir}/release-r2-edge.mjs" manifest --channel "$channel" --version "$version" \
    --commit "${DIFYCTL_COMMIT:-unknown}" --build-date "${DIFYCTL_BUILD_DATE:-unknown}" \
    --base-url "$base_url" --checksums "${DIST_DIR}/difyctl-v${version}-checksums.txt" >"$manifest"
  aws_s3 s3 cp "$manifest" "s3://${R2_BUCKET}/${pointer_prefix}/manifest.json" \
    --content-type application/json --cache-control "public, max-age=60, must-revalidate"

  # 5. installers (committed sources next to this script)
  aws_s3 s3 cp "${_dir}/install-r2.sh" "s3://${R2_BUCKET}/difyctl/install.sh" \
    --content-type "text/x-shellscript" --cache-control "public, max-age=60, must-revalidate"
  aws_s3 s3 cp "${_dir}/install-r2.ps1" "s3://${R2_BUCKET}/difyctl/install.ps1" \
    --content-type "text/plain" --cache-control "public, max-age=60, must-revalidate"

  # 6. prune stale dirs (each line from release-r2-edge stderr)
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
