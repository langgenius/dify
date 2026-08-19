#!/bin/sh
# install-r2.sh — one-line difyctl installer from Cloudflare R2.
# Reads a per-channel pointer manifest, sha256-verifies, installs to PATH.
# Usage:  curl -fsSL https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-r2.sh | DIFYCTL_R2_BASE=<BASE> sh
# Env:
#   DIFYCTL_R2_BASE  (required)  R2 public base, e.g. https://pub-….r2.dev
#   DIFYCTL_CHANNEL  (default edge)
#   DIFYCTL_INSTALL_DIR  (default $HOME/.local/bin)  directory the binary is written to as <dir>/difyctl
#   DIFYCTL_VERSION  pin an exact published version (e.g. 0.1.0-edge.ce4af868)
#   DIFYCTL_COMMIT   pin by git commit (short or full sha); resolved via index.json
#   DIFYCTL_R2_PREFIX      (default difyctl)       key root for pointer JSONs
#   DIFYCTL_R2_BIN_PREFIX  (default <prefix>/bin)  key root for binaries
# With no pin the channel pointer (latest) is installed. A pin resolves through
# <prefix>/<channel>/index.json -> the build's immutable dir under the bin prefix.
set -eu

# --- library functions (sourced for tests when DIFYCTL_INSTALL_LIB=1) ---
tmp_m="$(mktemp 2>/dev/null || echo /tmp/difyctl-manifest.$$)"
trap 'rm -f "$tmp_m" "${tmp_c:-}" "${tmp_b:-}"' EXIT INT TERM

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

# grep/sed (no jq). Correct only because release-r2-edge.mjs renders one key per line.
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

# Resolve a pinned build from index.json (no jq). Correct only because
# release-r2-edge.mjs renders each build's fields one per line, dir last.
# Prints "<version>\t<dir>" of the first match, nothing if none.
# index_resolve <index-file> <kind:version|commit> <value>   (commit = prefix match)
index_resolve() {
  awk -v kind="$2" -v want="$3" '
    function val(s) { sub(/^[^:]*:[[:space:]]*"/, "", s); sub(/".*$/, "", s); return s }
    /"version"[[:space:]]*:/ { v = val($0) }
    /"commit"[[:space:]]*:/  { c = val($0) }
    /"dir"[[:space:]]*:/ {
      d = val($0)
      sel = (kind == "commit") ? c : v
      if (kind == "commit") { if (index(sel, want) == 1) { print v "\t" d; exit } }
      else if (sel == want) { print v "\t" d; exit }
    }
  ' "$1"
}

# checksums_target <checksums-file> <target-id>  -> "<sha256>\t<asset>"
# checksums lines are "<sha>  <asset>"; match asset ending -<target> or -<target>.exe.
checksums_target() {
  grep -E "[[:space:]]difyctl-v.*-$2(\.exe)?\$" "$1" | head -1 \
    | awk '{ print $1 "\t" $NF }'
}

sha256_check() {
  # $1 = file, $2 = expected hex
  if command -v sha256sum >/dev/null 2>&1; then _a="$(sha256sum "$1" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then _a="$(shasum -a 256 "$1" | awk '{print $1}')"
  else die "no sha256 tool (need sha256sum or shasum)"; fi
  [ "$_a" = "$2" ] || die "checksum mismatch for $1"
}

# fetch_verify_install <download-url> <expected-sha> <version> <channel>
fetch_verify_install() {
  tmp_b="$(mktemp)"
  # NOTE: no --compressed — must hash the raw bytes
  curl -fsSL "$1" -o "$tmp_b" || die "download failed: $1"
  sha256_check "$tmp_b" "$2"

  mkdir -p "$install_dir"
  chmod +x "$tmp_b"
  mv "$tmp_b" "${install_dir}/difyctl" 2>/dev/null || { cp "$tmp_b" "${install_dir}/difyctl"; rm -f "$tmp_b"; }

  printf 'difyctl %s (channel %s) installed: %s\n' "$3" "$4" "${install_dir}/difyctl"
  case ":${PATH}:" in
    *":${install_dir}:"*) ;;
    *) printf 'note: add %s to your PATH\n' "$install_dir" ;;
  esac
}

# Resolve a pinned build into download url + sha. Sets: version, dl_url, dl_sha.
resolve_pinned() {
  iurl="${base}/${prefix}/${channel}/index.json"
  curl -fsSL "$iurl" -o "$tmp_m" || die "R2 unavailable fetching ${iurl}; retry."
  if [ -n "${DIFYCTL_VERSION:-}" ]; then res="$(index_resolve "$tmp_m" version "$DIFYCTL_VERSION")"
  else res="$(index_resolve "$tmp_m" commit "$DIFYCTL_COMMIT")"; fi
  [ -n "$res" ] || die "no build matching ${DIFYCTL_VERSION:-$DIFYCTL_COMMIT} in channel ${channel}"
  version="$(printf '%s' "$res" | cut -f1)"
  dir="$(printf '%s' "$res" | cut -f2)"

  vbase="${base}/${bin_prefix}/${channel}/${dir}"
  tmp_c="$(mktemp)"
  curl -fsSL "${vbase}/difyctl-v${version}-checksums.txt" -o "$tmp_c" \
    || die "checksums missing for ${version} (channel ${channel})"
  line="$(checksums_target "$tmp_c" "$target")"
  [ -n "$line" ] || die "no build for ${target} at ${version}"
  dl_sha="$(printf '%s' "$line" | cut -f1)"
  dl_url="${vbase}/$(printf '%s' "$line" | cut -f2)"
}

# Resolve the channel pointer (latest) into download url + sha. Sets the same.
resolve_pointer() {
  murl="${base}/${prefix}/${channel}/manifest.json"
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
  dl_sha="$(manifest_target_field "$tmp_m" "$target" sha256)"
  [ -n "$asset" ] && [ -n "$dl_sha" ] || die "no build for ${target} in channel ${channel}"
  dl_url="${baseUrl}/${asset}"
}

install_main() {
  need curl
  [ -n "${DIFYCTL_R2_BASE:-}" ] || die "set DIFYCTL_R2_BASE to the R2 public base (e.g. https://pub-….r2.dev)"
  base="${DIFYCTL_R2_BASE%/}"
  channel="${DIFYCTL_CHANNEL:-edge}"
  prefix="${DIFYCTL_R2_PREFIX:-difyctl}"
  bin_prefix="${DIFYCTL_R2_BIN_PREFIX:-${prefix}/bin}"
  install_dir="${DIFYCTL_INSTALL_DIR:-${HOME}/.local/bin}"
  target="$(detect_target)"

  if [ -n "${DIFYCTL_VERSION:-}" ] || [ -n "${DIFYCTL_COMMIT:-}" ]; then
    resolve_pinned
  else
    resolve_pointer
  fi

  fetch_verify_install "$dl_url" "$dl_sha" "$version" "$channel"
}

if [ "${DIFYCTL_INSTALL_LIB:-0}" != "1" ]; then
  install_main
fi
