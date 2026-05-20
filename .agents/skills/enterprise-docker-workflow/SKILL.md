---
name: enterprise-docker-workflow
description: Enterprise Docker development, validation, image rebuild, offline packaging, and project-scoped image cleanup workflow for this Dify repository.
---

# Enterprise Docker Workflow

## Current Source Truth

- Read `AGENTS.md`, `README.enterprise-maintenance.md`, `ENTERPRISE_REPLAY_PLAN.md`, and `docker/README.enterprise.md` before changing enterprise Docker or release behavior.
- Official stable tag/tree `1.15.0` is the current enterprise release baseline.
- `codex/enterprise-candidate-1.15.0-20260626` is the current clean enterprise candidate.
- `main` is not the enterprise release base.
- `codex/enterprise-candidate-20260424` and `D:\CodexSpace\dify-enterprise-candidate-20260424` are historical `1.13.3` references only.
- Do not copy old Docker hacks, runtime data, or broad route-2 changes unless they are documented and re-validated on the current candidate.

## Core Rules

- Use `docker/docker-compose.yaml` plus `docker/docker-compose.enterprise.yaml` as the enterprise runtime surface.
- Keep official `docker/docker-compose.yaml` intact; put enterprise behavior in the overlay.
- Validate enterprise changes against rebuilt images from the current source tree, not against already-running old containers.
- Never treat local tests alone as release validation after runtime code changed.
- For same-machine upgrade validation, migrate the previous stable worktree's `docker/.env` and `docker/volumes/**` into the new worktree unless the official upgrade is destructive or the user asks for a reset.
- Never copy populated `docker/volumes/**` to a fresh offline Linux deployment or release package.
- Final offline packaging must use `Mode=reuse` and export the same image IDs that passed compose runtime validation.
- For `1.15.0`, run `flask db upgrade` and then the mandatory `flask backfill-plugin-auto-upgrade`.
- For plugin offline installs, reuse official plugin daemon `PIP_MIRROR_AUTO_DETECT` / `PIP_MIRROR_URL` env support and preserve the official CVE-2026-41948 path traversal fix.

## Local Upgrade Preflight

Before compose validation for a new official version candidate:

- Confirm compose commands are run from the new worktree, not the previous version directory.
- Copy the previous stable `docker/.env` and `docker/volumes/**` into the new worktree for local validation, after stopping compose services and backing up any accidental new initialization data.
- After copying `docker/.env`, update version-bearing values such as `DIFY_ENTERPRISE_VERSION` to the new enterprise version before any compose start.
- Use a temporary root container to copy protected PostgreSQL `pgdata` when host permissions block normal copying; mount the old worktree read-only.
- Export `DIFY_ENTERPRISE_VERSION=<version>-enterprise` and `COMPOSE_PROFILES=weaviate,postgresql,collaboration` explicitly for compose commands.
- Run `docker compose ... config --images` and verify it resolves the new enterprise API/Web/API WebSocket images, not the previous enterprise tag and not official `langgenius/dify-api` or `langgenius/dify-web`.
- After `up --force-recreate`, inspect API, API WebSocket, Web, worker, plugin daemon, database, Redis, vector store, sandbox, and ssrf proxy containers. All bind mounts must point to the new worktree.
- Do not leave `api_websocket`, `weaviate`, `sandbox`, `ssrf_proxy`, `plugin_daemon`, or database services running from an old worktree while validating a new candidate.
- Verify migrated data with read-only checks before asking the user to log in: accounts, tenants, apps/workflows, datasets, installed plugins, enterprise marketplace assets, and `alembic_version`.

## Rebuild Decisions

- Backend runtime or API Docker input changed: rebuild `api`, then recreate `api`, `api_websocket`, `worker`, `worker_beat`, and `nginx`.
- Frontend runtime or web Docker input changed: rebuild `web`, then recreate `web` and `nginx`.
- Only Nginx config changed: recreate `nginx`.
- Formal release packaging must export the same enterprise image IDs that already passed compose runtime validation.

## Standard Commands

```powershell
$env:DIFY_ENTERPRISE_VERSION = "1.15.0-enterprise"
$env:COMPOSE_PROFILES = "weaviate,postgresql,collaboration"
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml config -q
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml build api
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml build web
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml up -d --force-recreate api api_websocket worker worker_beat web nginx
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml ps
.\scripts\build-enterprise-offline.ps1 -Version $env:DIFY_ENTERPRISE_VERSION -Mode reuse
```

Use `scripts/build-enterprise-offline.ps1` or `scripts/build-enterprise-offline.sh` only after the image batch has been validated.

## Cleanup Boundaries

- Project image cleanup may inspect/remove only confirmed unused `dify-api-enterprise:*`, `dify-web-enterprise:*`, and compose-owned helper layers for this repo.
- Do not touch unrelated local images from other projects.
- Do not delete `docker/volumes/**` unless the user explicitly asks to reset runtime data or approves after the impact is explained.
