#!/bin/sh
# install-cli.sh — one-line difyctl installer. difyctl ships as assets on Dify
# GitHub Releases; this installs the build matching your Dify version.
#
# usage:
#   curl -fsSL https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-cli.sh | sh
#
# env:
#   DIFY_VERSION     Dify release tag to install difyctl from (e.g. 1.14.2). Primary key.
#   DIFYCTL_VERSION  difyctl version pin (used only when DIFY_VERSION is unset).
#   DIFYCTL_PREFIX   install dir (default $HOME/.local); binary -> $PREFIX/bin/difyctl
#   DIFYCTL_REPO     release source repo (default langgenius/dify)
# requires: curl, uname, sort -V, and sha256sum or shasum.
set -eu

REPO="${DIFYCTL_REPO:-langgenius/dify}"
PREFIX="${DIFYCTL_PREFIX:-${HOME}/.local}"
DIFY_VERSION="${DIFY_VERSION:-}"
DIFYCTL_VERSION="${DIFYCTL_VERSION:-}"
API="https://api.github.com/repos/${REPO}"
DL="https://github.com/${REPO}/releases/download"

err() { printf '%s\n' "install-cli: $*" >&2; }
die() { err "$*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
re_escape() { printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|/]/\\&/g'; }

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

# list_asset_names  (reads release JSON on stdin) -> one difyctl asset name per line
list_asset_names() {
    grep -oE '"name"[[:space:]]*:[[:space:]]*"difyctl-v[^"]*"' \
        | sed -E 's#.*"name"[[:space:]]*:[[:space:]]*"([^"]*)".*#\1#'
}

# pick_asset TARGET  (reads release JSON on stdin) -> highest-semver matching asset name
pick_asset() {
    _target=$(re_escape "$1")
    list_asset_names \
        | grep -E -- "-${_target}(\\.exe)?\$" \
        | grep -vE -- '-checksums\.txt$' \
        | sort -V | tail -1
}

# asset_version ASSET_NAME TARGET -> difyctl version embedded in the name
asset_version() {
    _target=$(re_escape "$2")
    printf '%s' "$1" | sed -E "s#^difyctl-v(.*)-${_target}(\\.exe)?\$#\\1#"
}

# list_release_tags  (reads /releases array JSON on stdin) -> tag per line, newest first
list_release_tags() {
    grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | sed -E 's#.*:[[:space:]]*"([^"]*)".*#\1#'
}

fetch_json() {
    curl -fsSL -H "Accept: application/vnd.github+json" "$1"
}

# find_release_for_difyctl WANT TARGET -> newest Dify tag whose assets host that difyctl build
find_release_for_difyctl() {
    _want="$1"
    _target="$2"
    _raw=$(fetch_json "${API}/releases?per_page=100") \
        || die "failed to query ${REPO} releases (network error or GitHub API rate limit)"
    _tags=$(printf '%s' "$_raw" | list_release_tags)
    for _t in $_tags; do
        _rel=$(fetch_json "${API}/releases/tags/${_t}") \
            || { err "fetch failed for ${_t}, skipping"; continue; }
        _name=$(printf '%s' "$_rel" | pick_asset "$_target")
        [ -n "$_name" ] || continue
        if [ "$(asset_version "$_name" "$_target")" = "$_want" ]; then
            printf '%s' "$_t"
            return 0
        fi
    done
    return 1
}

resolve_release() {
    _target="$1"
    if [ -n "$DIFY_VERSION" ]; then
        REL=$(fetch_json "${API}/releases/tags/${DIFY_VERSION}") \
            || die "Dify release ${DIFY_VERSION} not found"
        DIFY_TAG="$DIFY_VERSION"
    elif [ -n "$DIFYCTL_VERSION" ]; then
        DIFY_TAG=$(find_release_for_difyctl "$DIFYCTL_VERSION" "$_target") \
            || die "difyctl ${DIFYCTL_VERSION} not found on any Dify release"
        REL=$(fetch_json "${API}/releases/tags/${DIFY_TAG}") \
            || die "failed to fetch Dify release ${DIFY_TAG}"
    else
        REL=$(fetch_json "${API}/releases/latest") \
            || die "failed to query latest Dify release (set DIFY_VERSION to pin one)"
        DIFY_TAG=$(printf '%s' "$REL" | list_release_tags | head -1)
        [ -n "$DIFY_TAG" ] || die "could not parse a tag from the latest Dify release"
    fi
}

main() {
    need curl
    need uname
    sort -V /dev/null >/dev/null 2>&1 || die "sort with -V support is required (install coreutils)"
    if command -v sha256sum >/dev/null 2>&1; then
        HASH="sha256sum"
    elif command -v shasum >/dev/null 2>&1; then
        HASH="shasum -a 256"
    else
        die "need sha256sum or shasum"
    fi

    target=$(detect_target)
    resolve_release "$target"

    asset=$(printf '%s' "$REL" | pick_asset "$target")
    [ -n "$asset" ] || die "no difyctl published for Dify ${DIFY_TAG} (target ${target}); set DIFY_VERSION to a release that has one"
    version=$(asset_version "$asset" "$target")
    checksums="difyctl-v${version}-checksums.txt"
    base="${DL}/${DIFY_TAG}"

    tmp=$(mktemp -d 2>/dev/null || mktemp -d -t difyctl-install)
    trap 'rm -rf "$tmp"' EXIT INT TERM

    printf 'downloading %s (Dify %s)...\n' "$asset" "$DIFY_TAG"
    curl -fsSL "${base}/${asset}" -o "${tmp}/${asset}" \
        || die "download failed: ${base}/${asset}"
    curl -fsSL "${base}/${checksums}" -o "${tmp}/${checksums}" \
        || die "checksum manifest download failed: ${base}/${checksums}"

    _pattern=$(re_escape "$asset")
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

    printf '\ndifyctl v%s installed (from Dify %s): %s\n' "$version" "$DIFY_TAG" "$target_bin"

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

if [ "${DIFYCTL_INSTALL_LIB:-0}" != "1" ]; then
    main "$@"
fi
