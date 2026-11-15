#!/bin/sh
# uninstall-local.sh — remove a locally installed difyctl.
# Run via: pnpm uninstall:local
set -eu

PREFIX="${DIFYCTL_PREFIX:-${HOME}/.local}"
SHARE_DIR="${PREFIX}/share/difyctl"
BIN_LINK="${PREFIX}/bin/difyctl"

rm -rf "$SHARE_DIR"
rm -f  "$BIN_LINK"
echo "removed ${SHARE_DIR} and ${BIN_LINK}"
