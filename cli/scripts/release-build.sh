#!/usr/bin/env bash
# scripts/release-build.sh — cross-compile difyctl to standalone binaries
# for every release target via `bun build --compile`.
#
# Bun consumes bin/run.ts (which imports from src/) directly — no `pnpm build`
# / dist/ step needed.
#
# Prereqs:
#   - All @napi-rs/keyring native variants present in node_modules. Use
#     `NPM_CONFIG_USERCONFIG=cli/scripts/cross-arch.npmrc pnpm install --force`
#     to populate them.
#
# Required env: CLI_VERSION, DIFYCTL_CHANNEL, DIFYCTL_MIN_DIFY, DIFYCTL_MAX_DIFY,
#               DIFYCTL_COMMIT, DIFYCTL_BUILD_DATE.
# Output:        dist/bin/difyctl-v<CLI_VERSION>-<target>[.exe]

set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${_dir}/lib/common.sh"

require bun

: "${CLI_VERSION:?CLI_VERSION is required}"
: "${DIFYCTL_CHANNEL:?DIFYCTL_CHANNEL is required}"
: "${DIFYCTL_MIN_DIFY:?DIFYCTL_MIN_DIFY is required}"
: "${DIFYCTL_MAX_DIFY:?DIFYCTL_MAX_DIFY is required}"
: "${DIFYCTL_COMMIT:?DIFYCTL_COMMIT is required}"
: "${DIFYCTL_BUILD_DATE:?DIFYCTL_BUILD_DATE is required}"

cli_root="$(cli::root)"
entry="${cli_root}/bin/run.ts"
out_dir="${cli_root}/dist/bin"

[[ -f "$entry" ]] || die "entry not found: $entry"

rm -rf "$out_dir"
mkdir -p "$out_dir"

# Build-info globals (referenced as bare identifiers in src/version/info.ts).
# Each value must be a JS expression — wrap strings as JSON-quoted strings.
defines=(
    "--define" "__DIFYCTL_VERSION__=\"${CLI_VERSION}\""
    "--define" "__DIFYCTL_CHANNEL__=\"${DIFYCTL_CHANNEL}\""
    "--define" "__DIFYCTL_MIN_DIFY__=\"${DIFYCTL_MIN_DIFY}\""
    "--define" "__DIFYCTL_MAX_DIFY__=\"${DIFYCTL_MAX_DIFY}\""
    "--define" "__DIFYCTL_COMMIT__=\"${DIFYCTL_COMMIT}\""
    "--define" "__DIFYCTL_BUILD_DATE__=\"${DIFYCTL_BUILD_DATE}\""
)

# Bun --target  ->  release asset suffix (asset name omits the bun- prefix
# and uses Node-style platform names; .exe is appended for Windows).
targets=(
    "bun-linux-x64:linux-x64"
    "bun-linux-arm64:linux-arm64"
    "bun-darwin-x64:darwin-x64"
    "bun-darwin-arm64:darwin-arm64"
    "bun-windows-x64:windows-x64"
)

for spec in "${targets[@]}"; do
    bun_target="${spec%%:*}"
    asset_target="${spec##*:}"
    suffix=""
    case "$bun_target" in
        bun-windows-*) suffix=".exe" ;;
    esac

    out="${out_dir}/difyctl-v${CLI_VERSION}-${asset_target}${suffix}"
    log::info "compiling ${asset_target} -> $(basename "$out")..."
    bun build "$entry" \
        --target="$bun_target" \
        --compile \
        "${defines[@]}" \
        --outfile="$out" >/dev/null
done

log::info "built $(find "$out_dir" -type f | wc -l | tr -d ' ') binaries:"
ls -lh "$out_dir" >&2
