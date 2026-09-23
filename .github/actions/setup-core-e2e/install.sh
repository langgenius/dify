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

(
  api_started=$SECONDS
  uv sync --project api --dev
  echo "$((SECONDS - api_started))" > "$timing_dir/api"
) &
api_pid=$!

(
  web_started=$SECONDS
  vp install --frozen-lockfile
  echo "$((SECONDS - web_started))" > "$timing_dir/web"
  browser_started=$SECONDS
  cd e2e
  vp run "e2e:install:ci:$E2E_INSTALL_BROWSER"
  echo "$((SECONDS - browser_started))" > "$timing_dir/browser"
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
  echo "| Phase | Seconds |"
  echo "| --- | ---: |"
  for phase in api web browser; do
    if [[ -f "$timing_dir/$phase" ]]; then
      echo "| $phase | $(cat "$timing_dir/$phase") |"
    fi
  done
  echo ""
  echo "API exit status: $api_status; Web/browser exit status: $web_status"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

if (( api_status != 0 || web_status != 0 )); then
  echo "E2E dependency installation failed (API: $api_status, Web/browser: $web_status)" >&2
  exit 1
fi
