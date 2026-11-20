#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$DEPLOY_DIR"

LOG_FILE="${DEPLOY_LOG_FILE:-$DEPLOY_DIR/deploy.log}"
touch -- "$LOG_FILE"
exec > >(tee -a -- "$LOG_FILE") 2>&1
trap 'rc=$?; printf "DEPLOY FAILED exit=%s line=%s at=%s\n" "$rc" "$LINENO" "$(date -u +%FT%TZ)"; exit "$rc"' ERR

printf 'DEPLOY START at=%s\n' "$(date -u +%FT%TZ)"
for required in docker python3 flock; do
  command -v "$required" >/dev/null || { printf 'Missing executable: %s\n' "$required"; exit 1; }
done

# Keep the descriptor open for the complete deployment, including validation.
exec 9>>"$DEPLOY_DIR/.agent-dev-config-mutation.lock"
printf 'Waiting for agent deployment lock\n'
flock -w "${DEPLOY_LOCK_TIMEOUT:-1800}" 9

SERVICES=(api worker priority_worker worker_beat external_worker worker-plugin_autoupgrade agent_backend web)
STATE_FILE="$(mktemp "$DEPLOY_DIR/.agent-deploy-expected.XXXXXX")"
trap 'rm -f -- "$STATE_FILE"' EXIT

python3 "$DEPLOY_DIR/verify_deploy.py" preflight "$STATE_FILE"
docker compose pull "${SERVICES[@]}"
python3 "$DEPLOY_DIR/verify_deploy.py" prepare "$STATE_FILE"
python3 "$DEPLOY_DIR/verify_deploy.py" schema "$STATE_FILE"

# No shared infrastructure updates, local builds, orphan deletion, or global rm.
# Compose preserves existing scale when --scale is omitted; verify it below.
docker compose up -d --no-deps --no-build --pull never "${SERVICES[@]}"
python3 "$DEPLOY_DIR/verify_deploy.py" verify "$STATE_FILE"

printf 'DEPLOY SUCCESS at=%s\n' "$(date -u +%FT%TZ)"
