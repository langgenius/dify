#!/usr/bin/env bash
# scripts/release-pack-tarballs.sh — build distributable tarballs.
#
# Required env: CLI_VERSION. Output:
#   dist/difyctl-v<CLI_VERSION>-<os>-<arch>.tar.xz

set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${_dir}/lib/common.sh"

require pnpm
require tar

: "${CLI_VERSION:?CLI_VERSION is required}"

cd "$(cli::root)"

BUILD_DIR="dist/release-staging"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/difyctl/bin"

log::info "staging files for v${CLI_VERSION}..."

# Copy built code, manifests, and the binary entrypoint
cp -r dist/ "$BUILD_DIR/difyctl/dist"
cp bin/run.js "$BUILD_DIR/difyctl/bin/difyctl"
chmod +x "$BUILD_DIR/difyctl/bin/difyctl"
cp package.json README.md pnpm-lock.yaml "$BUILD_DIR/difyctl/"

# Install production dependencies into the staging folder
(
    cd "$BUILD_DIR/difyctl"
    pnpm install --prod --frozen-lockfile
)

# Create tarballs for each target platform
# The contents are the same for all, but naming them per-platform simplifies
# the installer and allows for platform-specific native deps later.
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
    log::info "packing ${target}..."
    tar -C "$BUILD_DIR" -cJf "dist/difyctl-v${CLI_VERSION}-${target}.tar.xz" difyctl
done

log::info "tarballs created in dist/"
ls -lh dist/difyctl-v${CLI_VERSION}-*.tar.xz >&2
