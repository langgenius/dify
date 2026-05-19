#!/usr/bin/env bash
# scripts/release-pack-tarballs.sh — build a distributable tarball for the
# current host target.
#
# Uses `pnpm deploy` to resolve workspace `catalog:` / `workspace:` refs from
# the monorepo lockfile and produce a self-contained directory. The deploy
# installs native optionalDependencies (e.g. @napi-rs/keyring) for the host
# OS/arch, so each target must be packed on its native runner.
#
# Required env: CLI_VERSION.
# Optional env: PACK_TARGET (override detected target, e.g. linux-x64).
# Output:        dist/difyctl-v<CLI_VERSION>-<target>.tar.xz

set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${_dir}/lib/common.sh"

require pnpm
require tar

: "${CLI_VERSION:?CLI_VERSION is required}"

detect_target() {
    local os arch
    case "$(uname -s)" in
        Linux)  os=linux ;;
        Darwin) os=darwin ;;
        *)      die "unsupported OS: $(uname -s)" ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64)  arch=x64 ;;
        arm64|aarch64) arch=arm64 ;;
        *)             die "unsupported arch: $(uname -m)" ;;
    esac
    printf '%s' "${os}-${arch}"
}

target="${PACK_TARGET:-$(detect_target)}"

cli_root="$(cli::root)"
workspace_root="$(cd "${cli_root}/.." && pwd)"

BUILD_DIR="${cli_root}/dist/release-staging"
STAGE="${BUILD_DIR}/difyctl"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

log::info "deploying difyctl@v${CLI_VERSION} (${target}) via pnpm deploy..."
(
    cd "$workspace_root"
    # --legacy: cli has no workspace:* prod deps; injection isn't needed. Avoids
    # requiring `inject-workspace-packages=true` on the whole monorepo (pnpm v10+).
    pnpm --filter @langgenius/difyctl deploy --prod --legacy "$STAGE"
)

# install-cli.sh expects bin/difyctl. Keep bin/run.js too so `node bin/run.js`
# from the extracted tree still works and the package.json bin field stays valid.
cp "$STAGE/bin/run.js" "$STAGE/bin/difyctl"
chmod +x "$STAGE/bin/difyctl"

mkdir -p "${cli_root}/dist"
tarball="${cli_root}/dist/difyctl-v${CLI_VERSION}-${target}.tar.xz"
log::info "packing ${target} -> $(basename "$tarball")..."
tar -C "$BUILD_DIR" -cJf "$tarball" difyctl

log::info "tarball created: $tarball"
ls -lh "$tarball" >&2
