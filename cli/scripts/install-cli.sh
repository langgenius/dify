#!/bin/sh
# install-cli.sh — one-line difyctl installer from the latest GitHub Actions build.
#
# usage:
#   GH_TOKEN=<pat> curl -fsSL https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-cli.sh | sh
#
# env: DIFYCTL_PREFIX (default $HOME/.local), DIFYCTL_REPO (default langgenius/dify),
#      DIFYCTL_BRANCH (default main),
#      GH_TOKEN/GITHUB_TOKEN (required — workflow artifact zip downloads need
#                             auth even on public repos; minimum scope: actions:read).
# requires: curl, uname, jq, unzip, sha256sum or shasum.

set -eu

REPO="${DIFYCTL_REPO:-langgenius/dify}"
BRANCH="${DIFYCTL_BRANCH:-main}"
PREFIX="${DIFYCTL_PREFIX:-${HOME}/.local}"
WORKFLOW_FILE="cli-release.yml"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

err() { printf '%s\n' "install-cli: $*" >&2; }
die() { err "$*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

need curl
need uname
need jq
need unzip

[ -n "$TOKEN" ] || die "GH_TOKEN (or GITHUB_TOKEN) is required — workflow artifact downloads need auth"

gh_curl() { curl -fsSL -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github.v3+json" "$@"; }

if command -v sha256sum >/dev/null 2>&1; then
    HASH="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    HASH="shasum -a 256"
else
    die "need sha256sum or shasum"
fi

case "$(uname -s)" in
    Linux*)  os=linux ;;
    Darwin*) os=darwin ;;
    *)       die "unsupported OS: $(uname -s) (use the Windows .exe directly)" ;;
esac

case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *)             die "unsupported arch: $(uname -m)" ;;
esac

target="${os}-${arch}"

# 1. Find the latest successful workflow run on the branch
api_url="https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?branch=${BRANCH}&status=success&per_page=1"
run_id=$(gh_curl "$api_url" | jq -r '.workflow_runs[0].id')

if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
    die "could not find a successful workflow run for ${WORKFLOW_FILE} on branch ${BRANCH}"
fi

# 2. Find the artifact from that run
artifacts_url="https://api.github.com/repos/${REPO}/actions/runs/${run_id}/artifacts"
artifact_info=$(gh_curl "$artifacts_url" | jq '.artifacts[0]')
artifact_id=$(printf '%s' "$artifact_info" | jq -r '.id')
artifact_name=$(printf '%s' "$artifact_info" | jq -r '.name')

if [ -z "$artifact_id" ] || [ "$artifact_id" = "null" ]; then
    die "could not find any artifacts for workflow run ${run_id}"
fi

# 3. Download and unzip the artifact (one zip with all platform binaries + checksums)
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t difyctl-install)
trap 'rm -rf "$tmp"' EXIT INT TERM

download_url="https://api.github.com/repos/${REPO}/actions/artifacts/${artifact_id}/zip"
printf 'downloading artifact %s (run %s)...\n' "$artifact_name" "$run_id"
gh_curl -L "$download_url" -o "${tmp}/artifact.zip"
unzip -q "${tmp}/artifact.zip" -d "${tmp}/artifact"

# 4. Locate the binary for this host + the checksum manifest
asset_path=$(ls "${tmp}/artifact"/difyctl-v*-"${target}" 2>/dev/null | head -1)
[ -n "$asset_path" ] || die "no binary matching target ${target} in artifact"
asset=$(basename "$asset_path")
cli_version=${asset#difyctl-v}
cli_version=${cli_version%-${target}}
checksums="difyctl-v${cli_version}-checksums.txt"

[ -f "${tmp}/artifact/${checksums}" ] || die "checksum file ${checksums} not found in artifact"

# 5. Verify checksum
(
    cd "${tmp}/artifact"
    grep " ${asset}\$" "$checksums" | $HASH -c -
) || die "checksum mismatch for ${asset}"

# 6. Install: copy binary to <prefix>/bin/difyctl and chmod +x
bin_dir="${PREFIX}/bin"
mkdir -p "$bin_dir"
target_bin="${bin_dir}/difyctl"
cp "${tmp}/artifact/${asset}" "$target_bin"
chmod +x "$target_bin"

printf '\ndifyctl v%s installed: %s\n' "$cli_version" "$target_bin"

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
