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
# Env (all optional; defaults derived from cli/package.json + git):
#   CLI_VERSION        — package.json `version`
#   DIFYCTL_CHANNEL    — package.json `difyctl.channel`
#   DIFYCTL_MIN_DIFY   — package.json `difyctl.compat.minDify`
#   DIFYCTL_MAX_DIFY   — package.json `difyctl.compat.maxDify`
#   DIFYCTL_COMMIT     — `git rev-parse HEAD` (or "unknown")
#   DIFYCTL_BUILD_DATE — current UTC time
#
# Output: dist/bin/difyctl-v<CLI_VERSION>-<target>[.exe]

set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${_dir}/lib/common.sh"

require bun

cli_root="$(cli::root)"
entry="${cli_root}/bin/run.ts"
out_dir="${cli_root}/dist/bin"

read_pkg() { node -p "require('${cli_root}/package.json').$1" 2>/dev/null; }

CLI_VERSION="${CLI_VERSION:-$(read_pkg version)}"
DIFYCTL_CHANNEL="${DIFYCTL_CHANNEL:-$(read_pkg difyctl.channel)}"
DIFYCTL_MIN_DIFY="${DIFYCTL_MIN_DIFY:-$(read_pkg difyctl.compat.minDify)}"
DIFYCTL_MAX_DIFY="${DIFYCTL_MAX_DIFY:-$(read_pkg difyctl.compat.maxDify)}"
DIFYCTL_COMMIT="${DIFYCTL_COMMIT:-$(git -C "$cli_root" rev-parse HEAD 2>/dev/null || echo unknown)}"
DIFYCTL_BUILD_DATE="${DIFYCTL_BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

[[ "$CLI_VERSION" != "undefined" ]] || die "CLI_VERSION could not be derived from package.json"

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
        --minify \
        "${defines[@]}" \
        --outfile="$out" >/dev/null
done

log::info "built $(find "$out_dir" -type f | wc -l | tr -d ' ') binaries:"
ls -lh "$out_dir" >&2
