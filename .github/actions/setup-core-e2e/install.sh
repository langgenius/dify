#!/usr/bin/env bash
set -euo pipefail

case "${E2E_INSTALL_BROWSER:-}" in
  chromium|webkit) ;;
  *) echo "Expected chromium or webkit" >&2; exit 1 ;;
esac

# Keep both branches in this step so failures are collected before tests start.
started=$SECONDS
timing_dir=$(mktemp -d)
trap 'rm -rf "$timing_dir"' EXIT

time_command() {
  local phase=$1
  shift
  local phase_started=$SECONDS
  local status=0
  "$@" || status=$?
  local elapsed=$((SECONDS - phase_started))
  echo "$elapsed $status" > "$timing_dir/$phase"
  printf '[e2e:dependency-timing] phase=%s durationSeconds=%s exitCode=%s\n' "$phase" "$elapsed" "$status"
  return "$status"
}

(
  time_command api uv sync --project api --dev
) &
api_pid=$!

(
  time_command web vp install --frozen-lockfile
  cd e2e
  # Equivalent to install --with-deps, but separates apt/network latency from
  # the browser download. Keep this branch parallel with Python installation.
  time_command browser-system pnpm exec playwright install-deps "$E2E_INSTALL_BROWSER"
  time_command browser-download pnpm exec playwright install --only-shell "$E2E_INSTALL_BROWSER"
) &
web_pid=$!

api_status=0
web_status=0
wait "$api_pid" || api_status=$?
wait "$web_pid" || web_status=$?

{
  echo "### E2E dependency preparation ($E2E_INSTALL_BROWSER)"
  echo ""
  echo "Parallel install wall time: $((SECONDS - started))s"
  echo ""
  echo "| Phase | Seconds | Exit code |"
  echo "| --- | ---: | ---: |"
  for phase in api web browser-system browser-download; do
    if [[ -f "$timing_dir/$phase" ]]; then
      read -r elapsed status < "$timing_dir/$phase"
      echo "| $phase | $elapsed | $status |"
    fi
  done
  echo ""
  echo "API exit status: $api_status; Web/browser exit status: $web_status"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

if (( api_status != 0 || web_status != 0 )); then
  echo "E2E dependency installation failed (API: $api_status, Web/browser: $web_status)" >&2
  exit 1
fi
