#!/usr/bin/env bash
# scripts/release-smoke.sh <bin> — run a built binary on this runner and check that
# `install skills` writes exactly the skill tree in skills/difyctl.

set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${_dir}/lib/common.sh"

bin="${1:?usage: release-smoke.sh <bin>}"
skill_dir="$(cd "$(cli::root)/.." && pwd)/skills/difyctl"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

"$bin" version
"$bin" install skills "$out"
diff -r "${out}/difyctl" "$skill_dir"
