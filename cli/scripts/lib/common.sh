#!/usr/bin/env bash
# scripts/lib/common.sh — shared shell helpers for cli/ scripts.

[[ -n "${DIFYCTL_LIB_COMMON_SH:-}" ]] && return 0
readonly DIFYCTL_LIB_COMMON_SH=1

log::info() { printf '\033[36m[info]\033[0m %s\n' "$*" >&2; }
log::warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
log::err()  { printf '\033[31m[err ]\033[0m %s\n'  "$*" >&2; }

die() { log::err "$*"; exit 1; }

# Resolve the cli/ directory (parent of scripts/).
cli::root() {
    local dir
    dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    printf '%s' "$dir"
}

require() {
    command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1${2:+ — $2}"
}
