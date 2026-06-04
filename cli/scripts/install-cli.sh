#!/bin/sh
# install-cli.sh — one-line difyctl installer from public GitHub Releases.
#
# usage:
#   curl -fsSL https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-cli.sh | sh
#
# env:
#   DIFYCTL_CHANNEL  track to install: stable (default) | rc
#   DIFYCTL_VERSION  exact version pin (e.g. 0.2.0); overrides DIFYCTL_CHANNEL
#   DIFYCTL_PREFIX   install dir (default $HOME/.local); binary -> $PREFIX/bin/difyctl
#   DIFYCTL_REPO     release source repo (default langgenius/dify)
# requires: curl, uname, sort -V, and sha256sum or shasum.
set -eu

REPO="${DIFYCTL_REPO:-langgenius/dify}"
PREFIX="${DIFYCTL_PREFIX:-${HOME}/.local}"
CHANNEL="${DIFYCTL_CHANNEL:-stable}"
VERSION="${DIFYCTL_VERSION:-}"
TAG_PREFIX="difyctl-v"

err() { printf '%s\n' "install-cli: $*" >&2; }
die() { err "$*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

# select_version CHANNEL  (reads git/matching-refs JSON on stdin) -> highest matching version
select_version() {
    _channel="$1"
    _versions=$(grep -oE '"ref"[[:space:]]*:[[:space:]]*"refs/tags/difyctl-v[^"]*"' \
        | sed -E 's#.*"refs/tags/difyctl-v([^"]*)".*#\1#')
    case "$_channel" in
        rc)     _versions=$(printf '%s\n' "$_versions" | grep -E -- '-rc\.[0-9]+$' || true) ;;
        stable) _versions=$(printf '%s\n' "$_versions" | grep -vE -- '-' || true) ;;
        *)      die "invalid DIFYCTL_CHANNEL: ${_channel} (expected stable | rc)" ;;
    esac
    printf '%s\n' "$_versions" | sed '/^$/d' | sort -V | tail -1
}

detect_target() {
    case "$(uname -s)" in
        Linux*)  _os=linux ;;
        Darwin*) _os=darwin ;;
        *)       die "unsupported OS: $(uname -s) (use install.ps1 on Windows)" ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64)  _arch=x64 ;;
        arm64|aarch64) _arch=arm64 ;;
        *)             die "unsupported arch: $(uname -m)" ;;
    esac
    printf '%s-%s' "$_os" "$_arch"
}

resolve_version() {
    if [ -n "$VERSION" ]; then
        printf '%s' "$VERSION"
        return 0
    fi
    _api="https://api.github.com/repos/${REPO}/git/matching-refs/tags/difyctl-v"
    if ! _refs=$(curl -fsSL -H "Accept: application/vnd.github+json" "$_api"); then
        die "failed to query ${REPO} releases (network error or GitHub API rate limit); set DIFYCTL_VERSION to pin a version"
    fi
    _resolved=$(printf '%s' "$_refs" | select_version "$CHANNEL")
    [ -n "$_resolved" ] || die "no ${CHANNEL} difyctl release found in ${REPO}"
    printf '%s' "$_resolved"
}

main() {
    need curl
    need uname
    need sort
    if command -v sha256sum >/dev/null 2>&1; then
        HASH="sha256sum"
    elif command -v shasum >/dev/null 2>&1; then
        HASH="shasum -a 256"
    else
        die "need sha256sum or shasum"
    fi

    target=$(detect_target)
    version=$(resolve_version)
    tag="${TAG_PREFIX}${version}"
    asset="difyctl-v${version}-${target}"
    checksums="difyctl-v${version}-checksums.txt"
    base="https://github.com/${REPO}/releases/download/${tag}"

    tmp=$(mktemp -d 2>/dev/null || mktemp -d -t difyctl-install)
    trap 'rm -rf "$tmp"' EXIT INT TERM

    printf 'downloading %s (%s)...\n' "$asset" "$tag"
    curl -fsSL "${base}/${asset}" -o "${tmp}/${asset}" \
        || die "download failed: ${base}/${asset}"
    curl -fsSL "${base}/${checksums}" -o "${tmp}/${checksums}" \
        || die "checksum manifest download failed: ${base}/${checksums}"

    # exact, end-anchored, regex-safe match of the asset's checksum line; fail-closed on no match
    _pattern=$(printf '%s' "$asset" | sed 's/[][\\.^$*+?(){}|/]/\\&/g')
    _sumline=$(grep -E -- "[[:space:]]${_pattern}\$" "${tmp}/${checksums}") || true
    [ -n "$_sumline" ] || die "no checksum entry for ${asset}"
    (
        cd "$tmp"
        printf '%s\n' "$_sumline" | $HASH -c -
    ) || die "checksum mismatch for ${asset}"

    bin_dir="${PREFIX}/bin"
    mkdir -p "$bin_dir"
    target_bin="${bin_dir}/difyctl"
    cp "${tmp}/${asset}" "$target_bin"
    chmod +x "$target_bin"

    printf '\ndifyctl v%s installed: %s\n' "$version" "$target_bin"

    case ":${PATH}:" in
        *":${bin_dir}:"*)
            "$target_bin" version >/dev/null 2>&1 \
                && printf 'verify: run "difyctl version"\n' \
                || err "binary present but failed to execute; check ${target_bin}"
            ;;
        *)
            printf '\n%s is not on your PATH. Add this to your shell profile:\n' "$bin_dir"
            printf '  export PATH="%s:$PATH"\n' "$bin_dir"
            ;;
    esac
}

# Run main unless sourced as a library (tests set DIFYCTL_INSTALL_LIB=1).
if [ "${DIFYCTL_INSTALL_LIB:-0}" != "1" ]; then
    main "$@"
fi
