#!/bin/sh
# install-r2.sh — one-line difyctl installer from Cloudflare R2.
# Reads a per-channel pointer manifest, sha256-verifies, installs to PATH.
# Usage:  curl -fsSL <BASE>/difyctl/install.sh | DIFYCTL_R2_BASE=<BASE> sh
# Env:
#   DIFYCTL_R2_BASE  (required)  R2 public base, e.g. https://pub-….r2.dev
#   DIFYCTL_CHANNEL  (default edge)
#   DIFYCTL_PREFIX   (default $HOME/.local)  install root; binary -> <prefix>/bin/difyctl
set -eu

# --- library functions (sourced for tests when DIFYCTL_INSTALL_LIB=1) ---
tmp_m="$(mktemp 2>/dev/null || echo /tmp/difyctl-manifest.$$)"

err() { printf '%s\n' "install-r2: $*" >&2; }
die() { err "$*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

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

# manifest_str <file> <key>  -> value of a top-level string field
manifest_str() {
  grep "\"$2\"[[:space:]]*:" "$1" | head -1 \
    | sed -E "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/"
}

# manifest_target_field <file> <target-id> <asset|sha256>  -> value on that target's line
manifest_target_field() {
  grep "\"$2\"[[:space:]]*:" "$1" | head -1 \
    | sed -E "s/.*\"$3\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/"
}

sha256_check() {
  # $1 = file, $2 = expected hex
  if command -v sha256sum >/dev/null 2>&1; then _a="$(sha256sum "$1" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then _a="$(shasum -a 256 "$1" | awk '{print $1}')"
  else die "no sha256 tool (need sha256sum or shasum)"; fi
  [ "$_a" = "$2" ] || die "checksum mismatch for $1"
}

install_main() {
  need curl
  [ -n "${DIFYCTL_R2_BASE:-}" ] || die "set DIFYCTL_R2_BASE to the R2 public base (e.g. https://pub-….r2.dev)"
  base="${DIFYCTL_R2_BASE%/}"
  channel="${DIFYCTL_CHANNEL:-edge}"
  prefix="${DIFYCTL_PREFIX:-${HOME}/.local}"
  target="$(detect_target)"

  murl="${base}/difyctl/${channel}/manifest.json"
  # branch on http status: 404 = unpublished channel; other = transient
  _code="$(curl -fsS -o "$tmp_m" -w '%{http_code}' "$murl" 2>/dev/null || true)"
  if [ ! -s "$tmp_m" ]; then
    case "$_code" in
      404) die "channel '${channel}' not published to R2. For rc/stable use the GitHub installer (install-cli.sh)." ;;
      *)   die "R2 unavailable (HTTP ${_code:-?}) fetching ${murl}; retry." ;;
    esac
  fi

  mchannel="$(manifest_str "$tmp_m" channel)"
  [ "$mchannel" = "$channel" ] || die "manifest channel '${mchannel}' != requested '${channel}'"
  version="$(manifest_str "$tmp_m" version)"
  baseUrl="$(manifest_str "$tmp_m" baseUrl)"
  asset="$(manifest_target_field "$tmp_m" "$target" asset)"
  sha="$(manifest_target_field "$tmp_m" "$target" sha256)"
  [ -n "$asset" ] && [ -n "$sha" ] || die "no build for ${target} in channel ${channel}"

  tmp_b="$(mktemp)"
  # NOTE: no --compressed — must hash the raw bytes
  curl -fsSL "${baseUrl}/${asset}" -o "$tmp_b" || die "download failed: ${baseUrl}/${asset}"
  sha256_check "$tmp_b" "$sha"

  bin_dir="${prefix}/bin"
  mkdir -p "$bin_dir"
  chmod +x "$tmp_b"
  mv "$tmp_b" "${bin_dir}/difyctl" 2>/dev/null || { cp "$tmp_b" "${bin_dir}/difyctl"; rm -f "$tmp_b"; }

  printf 'difyctl %s (channel %s) installed: %s\n' "$version" "$channel" "${bin_dir}/difyctl"
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *) printf 'note: add %s to your PATH\n' "$bin_dir" ;;
  esac
}

if [ "${DIFYCTL_INSTALL_LIB:-0}" != "1" ]; then
  install_main
fi
