#!/usr/bin/env bash
set -euo pipefail
umask 077

revision=${1:-}
run_number=${2:-}
if [[ ! $revision =~ ^[a-f0-9]{40}$ || ! $run_number =~ ^[1-9][0-9]{0,11}$ ]]; then
  echo "Expected a published commit SHA and a workflow run number." >&2
  exit 1
fi

config_dir=/opt/app-builder/config
cd /opt/app-builder/repo/docker
compose=(docker compose --project-name app-builder)
image_services=(api web agent_backend local_sandbox)
release_services=(api api_websocket worker worker_beat web agent_backend local_sandbox)
selected_release="$config_dir/selected-release"

exec 9>"$config_dir/deploy.lock"
flock -w 30 9
if [[ -f $selected_release ]]; then
  read -r selected_run selected_revision < "$selected_release"
  [[ $selected_run =~ ^[1-9][0-9]{0,11}$ && $selected_revision =~ ^[a-f0-9]{40}$ ]]
  if ((run_number < selected_run)); then
    echo "Run $run_number is older than the selected run $selected_run."
    exit 0
  fi
  if ((run_number == selected_run)) && [[ $revision != "$selected_revision" ]]; then
    echo "Run $run_number already selected a different revision." >&2
    exit 1
  fi
fi

[[ $(grep -c '^DIFY_BUILDER_DEPLOY_TAG=' .env) -eq 1 ]]
export DIFY_BUILDER_DEPLOY_TAG="$revision"

echo "Pulling App Builder images for $revision."
"${compose[@]}" pull "${image_services[@]}"
images=$(
  "${compose[@]}" config --format json "${image_services[@]}" | python3 -c '
import json
import sys

services = json.load(sys.stdin)["services"]
for name in sys.argv[1:]:
    print(services[name]["image"])
' "${image_services[@]}"
)
while IFS= read -r image; do
  image_revision=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
  if [[ $image_revision != "$revision" ]]; then
    echo "Unexpected image revision for $image." >&2
    exit 1
  fi
done <<< "$images"

write_release() {
  local path=$1 temporary
  temporary=$(mktemp "$config_dir/.release.XXXXXX")
  printf '%s %s\n' "$run_number" "$revision" > "$temporary"
  mv -T "$temporary" "$path"
}

# Once migration starts, an older build must not run against the resulting schema.
write_release "$selected_release"
echo "Applying database migrations."
migration_log="$config_dir/deploy-migration.log"
if ! "${compose[@]}" run -T --rm --no-deps --pull never \
  -e MODE=migration -e MIGRATION_ENABLED=true api > "$migration_log" 2>&1; then
  echo "Migration failed. See $migration_log on the App Builder instance." >&2
  exit 1
fi

updated_env=$(mktemp .env.deploy.XXXXXX)
sed "s/^DIFY_BUILDER_DEPLOY_TAG=.*/DIFY_BUILDER_DEPLOY_TAG=$revision/" .env > "$updated_env"
mv -T "$updated_env" .env

echo "Updating and checking application services."
"${compose[@]}" up -d --no-deps --wait --wait-timeout 260 "${release_services[@]}"
"${compose[@]}" exec -T api curl --silent --show-error --output /dev/null \
  --max-time 5 --retry 12 --retry-connrefused --retry-delay 2 http://agent_backend:5050/ </dev/null
curl --fail --silent --show-error --output /dev/null --max-time 10 \
  --retry 6 --retry-connrefused --retry-delay 5 \
  -H 'Host: app-builder.gpt5o.uk' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8080/console/api/setup

write_release "$config_dir/deployed-release"
echo "App Builder deployed $revision (run $run_number)."
