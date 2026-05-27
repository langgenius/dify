#!/usr/bin/env bash
# scripts/release-validate-manifest.sh — validate cli/package.json release fields.

set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${_dir}/lib/common.sh"

cd "$(cli::root)"

SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'

version=$(node -p "require('./package.json').version")
channel=$(node -p "require('./package.json').difyctl.channel")
min_dify=$(node -p "require('./package.json').difyctl.compat.minDify")
max_dify=$(node -p "require('./package.json').difyctl.compat.maxDify")

[[ "$version" =~ $SEMVER_RE ]] || die "invalid version: ${version}"

case "$channel" in
    rc|stable) ;;
    *) die "invalid difyctl.channel: ${channel} (expected rc | stable)" ;;
esac

[[ "$min_dify" =~ $SEMVER_RE ]] || die "invalid difyctl.compat.minDify: ${min_dify}"
[[ "$max_dify" =~ $SEMVER_RE ]] || die "invalid difyctl.compat.maxDify: ${max_dify}"

case "$min_dify" in *[xX*]*) die "wildcards not allowed in minDify: ${min_dify}" ;; esac
case "$max_dify" in *[xX*]*) die "wildcards not allowed in maxDify: ${max_dify}" ;; esac

cmp=$(node -e "
const a = process.argv[1].split('-')[0].split('.').map(Number)
const b = process.argv[2].split('-')[0].split('.').map(Number)
for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) { console.log(a[i] < b[i] ? -1 : 1); process.exit(0) }
}
console.log(0)
" "$min_dify" "$max_dify")

[[ "$cmp" -le 0 ]] || die "minDify (${min_dify}) > maxDify (${max_dify})"

log::info "manifest valid: version=${version} channel=${channel} compat=${min_dify}..${max_dify}"
