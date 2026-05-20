# Dify Enterprise Overlay

This repository keeps the official `docker/docker-compose.yaml` intact and layers enterprise-specific behavior through `docker/docker-compose.enterprise.yaml`.

## Current enterprise source baseline

The enterprise overlay must follow the clean-candidate workflow described in `../README.enterprise-maintenance.md`.

- Official stable tag/tree `1.15.0` is the current enterprise release baseline.
- `codex/enterprise-candidate-1.15.0-20260626` is the current clean enterprise candidate.
- `main` is not the enterprise release base; it may only mirror or observe official development state.
- `codex/enterprise-candidate-20260424` and `D:\CodexSpace\dify-enterprise-candidate-20260424` are historical `1.13.3` references only.
- Do not bring Docker changes from old enterprise history unless they are deployment-safe, documented here, and validated against the current candidate source tree.
- Do not copy populated `docker/volumes/**` from a local machine to a fresh offline Linux deployment.

## Official 1.15.0 Docker and Env Notes

- Run `flask db upgrade`, then run the required `flask backfill-plugin-auto-upgrade` task after startup/migration.
- Review official env changes before reusing an older `.env`: `1.15.0` adds 19 env vars, removes 2, and changes `UV_CACHE_DIR` to `/tmp/uv_cache`.
- The plugin daemon has official `PIP_MIRROR_AUTO_DETECT` and `PIP_MIRROR_URL` support. Enterprise overlay should pass these through for offline/restricted-network deployments instead of replacing the official implementation.
- Preserve the official plugin-daemon path traversal fix from `1.15.0`; do not reuse older plugin-daemon forwarding behavior from enterprise history.

## What the enterprise overlay changes

- Replaces `api`, `api_websocket`, `worker`, and `worker_beat` with the self-built `dify-api-enterprise` image.
- Replaces `web` with the self-built `dify-web-enterprise` image.
- Injects enterprise defaults through environment variables:
  - `ENTERPRISE_ENABLED=false` by default, so the fork-local enterprise image does not call the official enterprise API unless a deployment explicitly supplies that service URL and secrets.
  - `PLATFORM_ADMIN_EMAILS`
  - `ALLOW_REGISTER=false`
  - `ALLOW_CREATE_WORKSPACE=false`

## Image version rule

Read the official version from `api/pyproject.toml` and `web/package.json`; both must match before validation or release packaging.

Current release:

- Official version: `1.15.0`
- Enterprise version: `1.15.0-enterprise`
- API image: `dify-api-enterprise:1.15.0-enterprise`
- Web image: `dify-web-enterprise:1.15.0-enterprise`

`docker/docker-compose.enterprise.yaml` should use `DIFY_ENTERPRISE_VERSION` so the version is supplied by environment rather than hardcoded into the compose file.

Example:

```powershell
$env:DIFY_ENTERPRISE_VERSION = "1.15.0-enterprise"
```

## Verified-image rule

For enterprise development, treat source verification, compose runtime verification, and offline packaging as one continuous chain. Do not switch validation targets in the middle.

Hard rules:

- Local regression checks such as `pytest`, `pnpm type-check`, and targeted frontend tests only prove the source tree is plausible. They do not prove that running enterprise containers or the final offline package contain that source tree.
- If runtime code changed in this round, rebuild the required enterprise images first, then recreate the affected compose services, then do browser clicks and log inspection against those rebuilt containers.
- Treat browser clicks, compose `logs`, compose `exec`, and smoke checks against older enterprise containers as invalid for release decisions once newer source changes exist locally.
- Offline packaging must export the same enterprise image IDs that already passed this round's compose-based runtime verification.
- `Mode=reuse` is the preferred final release mode after successful rebuild plus runtime verification, because it guarantees packaging reuses the exact verified images.
- `Mode=smart` is only acceptable before runtime verification when deciding whether a rebuild is needed, or in low-risk local convenience flows that are not being treated as release validation.

## Development validation and image rebuild rules

Use `docker/docker-compose.yaml` plus `docker/docker-compose.enterprise.yaml` as the enterprise runtime surface.

Standard checks:

```powershell
$env:DEBUG = "false"
$env:ENTERPRISE_ENABLED = "false"
$env:COMPOSE_PROFILES = "weaviate,postgresql,collaboration"
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml config -q
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml build api
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml build web
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml ps
```

Recreate rules:

- After rebuilding `dify-api-enterprise:1.15.0-enterprise`, recreate `api`, `api_websocket`, `worker`, `worker_beat`, and `nginx`:

```powershell
$env:DEBUG = "false"
$env:ENTERPRISE_ENABLED = "false"
$env:COMPOSE_PROFILES = "weaviate,postgresql,collaboration"
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml up -d --force-recreate api api_websocket worker worker_beat plugin_daemon sandbox ssrf_proxy nginx weaviate
```

- After rebuilding `dify-web-enterprise:1.15.0-enterprise`, recreate `web` and `nginx`:

```powershell
$env:DEBUG = "false"
$env:ENTERPRISE_ENABLED = "false"
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml up -d --force-recreate web nginx
```

- If only Nginx templates, proxy rules, or HTTPS assets changed, recreate only `nginx`.

Do not default to restarting the entire compose stack after every enterprise build. Prefer the smallest compose-owned recreate set that matches the changed runtime surface.

Vector store note: `VECTOR_STORE=weaviate` requires the `weaviate` compose profile/service to be running. Do not rely on
`COMPOSE_PROFILES` inside `docker/.env` alone for CLI profile activation; export `COMPOSE_PROFILES=weaviate,postgresql,collaboration`
in the shell or include the `weaviate` and `api_websocket` services explicitly in `docker compose up` commands.
`api_websocket` is part of the 1.15.0 collaboration runtime and must be covered by the enterprise overlay so it uses the same enterprise API image as `api`.

## Local upgrade data migration

For same-machine enterprise upgrades, use the new source worktree and new enterprise images, but inherit the previous stable runtime data whenever possible. This keeps local validation close to a real deployment upgrade and avoids re-initializing accounts, workspaces, workflows, datasets, plugins, and enterprise marketplace data on every candidate.

Recommended order:

1. Stop compose services for the old and new worktrees before copying runtime data.
2. If the new worktree was already initialized, back up its temporary `docker/.env` and `docker/volumes/**` outside the source diff.
3. Copy the previous stable worktree's `docker/.env` into the new worktree, then review it against the new `docker/envs/**/*.env.example` layout and add any new required settings. Always update version-bearing values such as `DIFY_ENTERPRISE_VERSION`; a migrated `.env` must not keep the previous enterprise tag.
4. Copy the previous stable worktree's `docker/volumes/**` into the new worktree, preserving ownership and permissions.
5. Start compose only from the new worktree with explicit shell values for `DIFY_ENTERPRISE_VERSION` and `COMPOSE_PROFILES`.

Example Linux startup after migration:

```bash
export DIFY_ENTERPRISE_VERSION=1.15.0-enterprise
export COMPOSE_PROFILES=weaviate,postgresql,collaboration
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml config --images | sort -u
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml up -d --force-recreate --pull never
```

The `config --images` output must show the current enterprise tags for `api`, `api_websocket`, `worker`, `worker_beat`, and `web`. If it shows the previous enterprise tag or `langgenius/dify-api`, fix `docker/.env` or the enterprise overlay before starting containers.

If PostgreSQL `pgdata` cannot be copied by the host user, use a temporary container to copy as root without writing to the old worktree:

```bash
docker run --rm \
  -v /path/to/old-dify/docker/volumes:/old:ro \
  -v /path/to/new-dify/docker/volumes:/new \
  busybox:latest \
  sh -c 'rm -rf /new/db && mkdir -p /new && cp -a /old/db /new/db'
```

After startup, verify the runtime surface before browser validation:

```bash
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml ps
docker inspect docker-api-1 docker-web-1 docker-worker-1 docker-worker_beat-1 docker-plugin_daemon-1 docker-db_postgres-1 docker-redis-1 docker-weaviate-1 docker-sandbox-1 docker-ssrf_proxy-1 \
  --format '{{.Name}} image={{.Config.Image}} id={{.Image}} mounts={{range .Mounts}}{{.Source}}=>{{.Destination}};{{end}}'
docker exec docker-db_postgres-1 psql -U postgres -d dify -c 'select version_num from alembic_version;'
```

The expected result is that API/Web/worker containers use the current enterprise image tag and image IDs, every bind mount points to the new worktree, and the migrated database reaches the current enterprise Alembic head. Old enterprise images may remain on disk as cache, but no running container may reference an old enterprise tag or old worktree mount.

## Final packaging commands

After source checks, rebuilt-image compose validation, browser-click validation, and log inspection pass, export the exact verified images:

```powershell
python docker/dify-env-sync.py --dir docker --no-backup
$env:DIFY_ENTERPRISE_VERSION = "1.15.0-enterprise"
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml config -q
.\scripts\build-enterprise-offline.ps1 -Version $env:DIFY_ENTERPRISE_VERSION -Mode reuse
```

Linux equivalent:

```bash
python3 docker/dify-env-sync.py --dir docker --no-backup
export DIFY_ENTERPRISE_VERSION=1.15.0-enterprise
export COMPOSE_PROFILES=weaviate,postgresql,collaboration
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml config -q
./scripts/build-enterprise-offline.sh -Version "$DIFY_ENTERPRISE_VERSION" -Mode reuse
```

Do not rebuild during final packaging after runtime validation. `Mode=reuse` should fail if `dify-api-enterprise:1.15.0-enterprise` or `dify-web-enterprise:1.15.0-enterprise` is missing or inconsistent.

## Minimal offline package rule

Use two artifacts:

- Image bundle: a single `docker save` archive generated by the enterprise offline script with `Mode=reuse`.
- Configuration bundle: a small archive containing only deployment configuration files and `docker/ENTERPRISE_DEPLOY_STARTUP.md`, which tells operators how to start and verify the enterprise compose stack.

Build the configuration bundle only after the `Mode=reuse` image bundle has produced the manifest and image list:

```bash
./scripts/build-enterprise-config-package.sh -Version "$DIFY_ENTERPRISE_VERSION"
```

```powershell
.\scripts\build-enterprise-config-package.ps1 -Version $env:DIFY_ENTERPRISE_VERSION
```

For privately supplied offline `.difypkg` packages that are not signed by the configured verifier, set
`FORCE_VERIFYING_SIGNATURE=false` in the deployment `.env` and force recreate `plugin_daemon` before running the
local package install flow.

Minimal configuration bundle contents:

- `docker/docker-compose.yaml`
- `docker/docker-compose.enterprise.yaml`
- `docker/.env.example`
- `docker/envs/**/*.env.example`
- `docker/dify-env-sync.py`
- `docker/dify-env-sync.sh`
- `docker/README.enterprise.md`
- `docker/nginx/**`
- `docker/ssrf_proxy/**`
- `dist/offline/manifest-<version>.json`
- `dist/offline/images-<version>.txt`

Exclude all local runtime and build artifacts:

- `docker/volumes/**`
- `docker/.build/**`
- `node_modules/**`
- `web/.next/**`
- `api/.venv/**`
- `.git/**`
- local logs, caches, and temporary test data

## Runtime data protection

Do not delete active runtime data under `docker/volumes/**` as part of routine development, image rebuilds, or compose recreates. These directories can hold the local database, uploaded files, Redis state, plugin state, and vector-store state.

Only remove them when the user explicitly asks to reset the environment, or after proposing the deletion and getting approval.

Runtime data may be copied between local enterprise worktrees for same-machine upgrade validation, but it must never be included in source commits, image build contexts, offline image bundles, or minimal configuration packages.
