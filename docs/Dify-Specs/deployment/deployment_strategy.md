---
title: Deployment Strategy — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Deployment Strategy — Dify

> Derived from the Compose assets, Dockerfiles and CI workflows. Every command below is marked `I:` unless this
> session ran it, and none was run here.

## Reference deployment

Docker Compose. The documented quickstart is `docker compose up -d` from `docker/`, after which the instance is
initialised through the browser at `/install` [D: README.md:80].

`docker/docker-compose.yaml` defines the full stack; `docker-compose-template.yaml` is the source it is generated
from, and `docker/envs/` holds the per-concern environment files [D: docker/].

| File | Purpose |
| --- | --- |
| `docker/docker-compose.yaml` | full stack |
| `docker/docker-compose-template.yaml` | template the full stack is generated from |
| `docker/docker-compose.middleware.yaml` | datastores only, for local backend development |
| `docker/docker-compose.e2b.yaml` | E2B sandbox variant |
| `docker/docker-compose.pytest.ports.yaml` | port overrides for the test suite |

Environment layering is a stated project rule: `docker/.env.example` carries only what a default deployment needs to
start, provider-specific settings live in `docker/envs/*.env.example`, and `docker/.env` overrides them
[D: AGENTS.md].

## Images

| Image | Entrypoint | Source |
| --- | --- | --- |
| api | `/entrypoint.sh` | `api/Dockerfile` |
| web | `./entrypoint.sh` | `web/Dockerfile` |
| agent backend | `uvicorn dify_agent.server.app:app --host 0.0.0.0 --port 5050` | `dify-agent/Dockerfile` |
| agent runtime | `shellctl serve --listen 0.0.0.0:5004` | `dify-agent-runtime/docker/Dockerfile` |

`docker-build.yml` and `build-push.yml` build and publish images in CI [D: .github/workflows/].

## Environments

`deploy-dev.yml`, `deploy-saas.yml`, `deploy-enterprise.yml`, `deploy-knowledge.yml`, `deploy-agent.yml` and
`deploy-hitl-im-dev.yml` exist as workflows [D: .github/workflows/].

I: the product is deployed as several separately released services rather than one unit — basis: six deployment
workflows target different surfaces and the repository publishes four distinct images [D: .github/workflows/].

OPEN: which environments do those workflows target, in what order, and who approves a promotion? The workflow names
imply a pipeline; the policy is not in this repository.

## Database migrations

Alembic revisions under `api/migrations/versions/`, with a dedicated CI job [D: .github/workflows/db-migration-test.yml].

OPEN: are migrations applied automatically on container start, or as a separate operator step? The entrypoint script
decides this and no document states the intent.

OPEN: what is the rollback procedure for a bad migration? `downgrade()` functions exist; nothing states they are
exercised.

## Open questions

- OPEN: what are the supported deployment topologies besides Compose — is there a supported Kubernetes path? No Helm
  chart or manifest is in this repository.
- OPEN: which components may be scaled horizontally? `worker_beat` is a scheduler and is presumably a singleton;
  nothing states it.
- OPEN: what is the backup and restore procedure for Postgres, Redis and object storage?
- OPEN: how is a deployment rolled back? No rollback workflow is present.
