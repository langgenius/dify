#!/usr/bin/env bash
# release-r2-publish.sh — direct-publish difyctl binaries + manifest + index to R2.
# Strict order so the pointer never references missing bytes:
#   sync binaries -> HEAD-verify -> list survivors -> put index.json -> put manifest.json.
# Binaries live under the bin prefix and expire via an R2 lifecycle (TTL) rule on
# that prefix; the ledger is reconciled to surviving dirs, not pruned here. The
# pointer JSONs (manifest.json/index.json) live under the (non-expiring) prefix.
# Installers (install-r2.sh/.ps1) are served from the GitHub repo, not R2.
# Usage: release-r2-publish.sh <channel> <version>
# Env: DIFYCTL_R2_S3_ENDPOINT DIFYCTL_R2_BUCKET DIFYCTL_R2_PUBLIC_BASE (+ AWS creds, AWS_REQUEST_CHECKSUM_CALCULATION).
#   DIFYCTL_R2_PREFIX      (default difyctl)        key root for pointer JSONs
#   DIFYCTL_R2_BIN_PREFIX  (default <prefix>/bin)   key root for binaries (TTL target)
set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${DIST_DIR:-${_dir}/../dist/bin}"

aws_s3() { aws --endpoint-url "$DIFYCTL_R2_S3_ENDPOINT" "$@"; }

publish_main() {
  local channel="$1" version="$2"
  local prefix="${DIFYCTL_R2_PREFIX:-difyctl}"
  local bin_prefix="${DIFYCTL_R2_BIN_PREFIX:-${prefix}/bin}"
  local key="${bin_prefix}/${channel}/${version}"
  local pointer_prefix="${prefix}/${channel}"
  local base_url="${DIFYCTL_R2_PUBLIC_BASE}/${key}"

  local current="" new_index="" existing_dirs="" manifest=""
  trap 'rm -f "$current" "$new_index" "$existing_dirs" "$manifest"' RETURN

  # 1. binaries (+ checksums) — immutable
  aws_s3 s3 sync "$DIST_DIR" "s3://${DIFYCTL_R2_BUCKET}/${key}/" \
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
    aws_s3 s3api head-object --bucket "$DIFYCTL_R2_BUCKET" --key "${key}/${asset}" >/dev/null
    verified=$((verified + 1))
  done <<< "$targets"
  [ "$verified" -gt 0 ] || { echo "release-r2-publish: verified zero targets" >&2; exit 1; }

  # 3. survivors: binary dirs still present under the bin prefix (lifecycle/TTL may
  #    have deleted old ones). aws CLI auto-paginates list-objects-v2, so --query
  #    aggregates CommonPrefixes across all pages. On a list failure, skip
  #    reconciliation (keep the ledger as-is) rather than wrongly drop builds.
  existing_dirs="$(mktemp)"
  local listed=0 raw
  raw="$(mktemp)"
  if aws_s3 s3api list-objects-v2 --bucket "$DIFYCTL_R2_BUCKET" \
       --prefix "${bin_prefix}/${channel}/" --delimiter / \
       --query 'CommonPrefixes[].Prefix' --output text > "$raw" 2>/dev/null; then
    # text rows are "<bin_prefix>/<channel>/<dir>/"; emit just <dir>. "None" = empty.
    tr '\t' '\n' < "$raw" | awk -F/ 'NF>1 && $0 != "None" { print $(NF-1) }' > "$existing_dirs"
    listed=1
  fi
  rm -f "$raw"

  # 4. index.json: fetch current, prepend, reconcile to survivors.
  current="$(mktemp)"
  curl -fsSL "${DIFYCTL_R2_PUBLIC_BASE}/${pointer_prefix}/index.json" -o "$current" 2>/dev/null || echo '-' > "$current"
  new_index="$(mktemp)"
  if [ "$listed" = "1" ]; then
    emit_index "$current" "$channel" "$version" --existing-dirs "$existing_dirs" >"$new_index"
  else
    emit_index "$current" "$channel" "$version" >"$new_index"
  fi
  aws_s3 s3 cp "$new_index" "s3://${DIFYCTL_R2_BUCKET}/${pointer_prefix}/index.json" \
    --content-type application/json --cache-control "public, max-age=60, must-revalidate"

  # 5. manifest.json — pointer; written last so it never references missing binaries
  manifest="$(mktemp)"
  node "${_dir}/release-r2-edge.mjs" manifest --channel "$channel" --version "$version" \
    --commit "${DIFYCTL_COMMIT:-unknown}" --build-date "${DIFYCTL_BUILD_DATE:-unknown}" \
    --base-url "$base_url" --checksums "${DIST_DIR}/difyctl-v${version}-checksums.txt" >"$manifest"
  aws_s3 s3 cp "$manifest" "s3://${DIFYCTL_R2_BUCKET}/${pointer_prefix}/manifest.json" \
    --content-type application/json --cache-control "public, max-age=60, must-revalidate"
}

# emit_index <current> <channel> <version> [extra args...] — wrapper so the
# survivor flag can be omitted without tripping `set -u` on empty arrays (bash 3.2).
emit_index() {
  local current="$1" channel="$2" version="$3"; shift 3
  node "${_dir}/release-r2-edge.mjs" index --current "$current" --channel "$channel" \
    --version "$version" --commit "${DIFYCTL_COMMIT:-unknown}" --build-date "${DIFYCTL_BUILD_DATE:-unknown}" "$@"
}

if [ "${RELEASE_PUBLISH_LIB:-0}" != "1" ]; then
  [ "$#" -eq 2 ] || { echo "usage: release-r2-publish.sh <channel> <version>" >&2; exit 2; }
  publish_main "$1" "$2"
fi
