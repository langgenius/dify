#!/bin/sh
# install-local.sh — install difyctl from a locally built tarball.
# Run via: pnpm install:local
set -eu

PREFIX="${DIFYCTL_PREFIX:-${HOME}/.local}"
SHARE_DIR="${PREFIX}/share/difyctl"
BIN_DIR="${PREFIX}/bin"

case "$(uname -s)" in
  Linux*)  os=linux ;;
  Darwin*) os=darwin ;;
  *)       echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *)             echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

# Accept an optional directory path as the first argument.
# Default to the cli/dist directory if not provided.
ARTIFACT_DIR="${1:-$(cd "$(dirname "$0")/../dist" && pwd)}"
TARBALL="$(ls "${ARTIFACT_DIR}"/difyctl-*-${os}-${arch}.tar.xz 2>/dev/null | head -1)"

if [ -z "$TARBALL" ]; then
  echo "no tarball found for ${os}-${arch} in ${ARTIFACT_DIR}" >&2
  echo "run: pnpm pack:tarballs" >&2
  exit 1
fi

echo "installing from $(basename "$TARBALL") ..."
rm -rf "$SHARE_DIR"
mkdir -p "$SHARE_DIR" "$BIN_DIR"
tar -xJf "$TARBALL" -C "$SHARE_DIR" --strip-components=1
ln -sf "${SHARE_DIR}/bin/difyctl" "${BIN_DIR}/difyctl"
echo "installed: ${BIN_DIR}/difyctl"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) echo "note: add ${BIN_DIR} to your PATH" ;;
esac
