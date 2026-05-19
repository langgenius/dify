#!/usr/bin/env bash
# scripts/release-write-checksums.sh — write sha256 manifest for release binaries.
#
# Required env: CLI_VERSION (e.g. 0.1.0-rc.1). Output:
#   cli/dist/bin/difyctl-v<CLI_VERSION>-checksums.txt

set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${_dir}/lib/common.sh"

: "${CLI_VERSION:?CLI_VERSION is required}"

cd "$(cli::root)/dist/bin"

manifest="difyctl-v${CLI_VERSION}-checksums.txt"
> "$manifest"

if command -v sha256sum >/dev/null 2>&1; then
    hash_cmd="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    hash_cmd="shasum -a 256"
else
    die "no sha256 hasher found (need sha256sum or shasum)"
fi

found=0
for bin in difyctl-v"${CLI_VERSION}"-*; do
    [[ -f "$bin" ]] || continue
    [[ "$bin" == "$manifest" ]] && continue
    $hash_cmd "$bin" >> "$manifest"
    found=$((found + 1))
done

[[ "$found" -gt 0 ]] || die "no binaries matching difyctl-v${CLI_VERSION}-* in dist/bin/"

log::info "wrote ${manifest} (${found} entries)"
