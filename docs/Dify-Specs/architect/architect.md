---
title: Master Architecture — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Master Architecture — Dify

> System-level structure, recovered from the deployment topology, the route table and the enforced import layers. This is a structural and behavioural view; deployment topology beyond the Compose file, quality-attribute targets and anything about people or process are not recoverable and appear below as questions.

## Deployed components

The reference deployment is Docker Compose [D: docker/docker-compose.yaml].

| Service | Role | Source |
| --- | --- | --- |
| `api` | Flask backend serving all 8 HTTP blueprints | `docker/docker-compose.yaml:227` |
| `api_websocket` | websocket surface for collaboration | `docker/docker-compose.yaml:275` |
| `worker` | Celery workers for background tasks | `docker/docker-compose.yaml:306` |
| `worker_beat` | Celery beat scheduler | `docker/docker-compose.yaml:353` |
| `web` | Next.js console and web app | `docker/docker-compose.yaml:387` |
| `db_postgres` / `db_mysql` | relational store | `docker/docker-compose.yaml:425` |
| `redis` | cache, locks, queues, pub/sub | `docker/docker-compose.yaml:492` |
| `sandbox` / `local_sandbox` | untrusted code execution | `docker/docker-compose.yaml:510` |
| `plugin_daemon` | plugin host | `docker/docker-compose.yaml:573` |
| `agent_backend` | standalone agent service | `docker/docker-compose.yaml:660` |
| `agent_ssrf_proxy` / `ssrf_proxy` | egress proxies | `docker/docker-compose.yaml:699` |
| `certbot` | TLS certificates | `docker/docker-compose.yaml:752` |

I: `sandbox` and the two `ssrf_proxy` services exist to contain code and network egress that the product lets users control — basis: they sit between the API and user-authored code, and the agent runtime ships its own `shellctl serve` container [D: dify-agent-runtime/docker/Dockerfile].

OPEN: what is the threat model these proxies implement? The containers are present; the policy they enforce is not written down in this repository.

## HTTP surface

One Flask application mounts eight blueprints, each with its own prefix and its own authentication model [D: api/extensions/ext_blueprints.py:45].

| Blueprint | Prefix | Operations | Audience |
| --- | --- | --- | --- |
| `console` | `/console/api` | 779 | first-party web console |
| `service_api` | `/v1` | 88 | customer API keys |
| `web` | `/api` | 43 | published web apps, passport token |
| `inner_api` | `/inner/api` | 37 | enterprise-internal callers |
| `openapi` | `/openapi/v1` | 36 | OAuth-scoped public API, used by `difyctl` |
| `trigger` | `/triggers` | 21 | inbound webhooks and plugin triggers |
| `files` | `/files` | 10 | file delivery |
| `mcp` | `/mcp` | 1 | MCP server endpoint |

The `/openapi/v1` blueprint is the only one registered conditionally, behind `OPENAPI_ENABLED`, with a default CORS allowlist that is empty — same-origin only until an operator widens it [D: api/extensions/ext_blueprints.py:47].

I: the public OAuth API is opt-in per deployment — basis: it is the single blueprint guarded by a config flag, while the other seven register unconditionally [D: api/extensions/ext_blueprints.py:45].

OPEN: `difyctl` talks to `/openapi/v1` [D: cli/src/api/apps.ts:5]. What does the CLI report when it is pointed at a deployment where `OPENAPI_ENABLED` is false — is that the compatibility check, or a separate failure?

1015 operations over 839 paths in total [D: api/controllers/]. Prefixes are declared once per blueprint [D: api/controllers/console/__init__.py:10] and never repeated in the route decorators, so a route literal read on its own is not the served path.

## Internal layers

Backend modules obey `controllers -> services -> core -> libs`, enforced in CI by import-linter with 31 contracts [D: api/.importlinter:21]. See `architect_common.md` for the contracts and the 93 grandfathered exceptions.

| layer | holds |
| --- | --- |
| `controllers` | HTTP transport: routing, auth guards, request validation, response shaping |
| `services` | application use cases |
| `core` | domain engine: workflow graph execution, RAG, model orchestration, agents, plugins |
| `libs` | shared primitives with no domain knowledge |

Alongside these sit `models` (ORM), `repositories`, `tasks` (Celery), `extensions` (infrastructure wiring), `configs`, `factories`, `machinery` and `context` [D: api/.importlinter:2].

## Infrastructure wiring

32 `ext_*` modules initialise infrastructure at startup [D: api/extensions/]. The stores and cross-cutting concerns they attach are the system's real dependency list:

| Concern | Extension |
| --- | --- |
| Relational database | `ext_database`, `ext_session_factory`, `ext_migrate` |
| Redis | `ext_redis` |
| Background jobs | `ext_celery` |
| Object storage | `ext_storage` |
| Websockets | `ext_socketio` |
| Auth session | `ext_login`, `ext_oauth_bearer` |
| Mail | `ext_mail` |
| Tracing / metrics | `ext_otel`, `ext_sentry`, `ext_app_metrics` |
| Logging | `ext_logging`, `ext_logstore`, `ext_request_logging` |
| Plugins / extensions | `ext_code_based_extension`, `ext_hosting_provider` |
| Enterprise telemetry | `ext_enterprise_telemetry` |

## Pluggable providers

Three provider families are separate installable packages rather than in-tree branches:

- **43 vector databases** under `api/providers/vdb/`, each its own `pyproject.toml` [D: api/providers/vdb/]
- **8 tracing backends** under `api/providers/trace/` (Langfuse, LangSmith, Opik, Weave, MLflow, Arize Phoenix, Aliyun, Tencent) [D: api/providers/trace/]
- **model and tool plugins** hosted by the `plugin_daemon` service [D: docker/docker-compose.yaml:573]

I: the provider split exists so a deployment installs only the backends it uses — basis: each provider is a separately declared package with its own dependency list rather than an optional extra of the API package [D: api/providers/vdb/vdb-qdrant/pyproject.toml].

OPEN: how is a provider selected at runtime, and what happens when a configured provider package is not installed?

## Trust boundaries

I: the trust boundary sits at the blueprint, not at the service layer — basis: each blueprint carries a distinct authentication mechanism (console session, service API key, web passport, OAuth scope, inner-API secret) and those mechanisms are applied in `controllers`, which is the only layer allowed to import from every other one [D: api/.importlinter:21; api/controllers/web/wraps.py:166].

45 operations carry no guard at all. They are the public surface: webhook and trigger ingress authenticated by a secret in the URL, the web-app passport issuer, OAuth callbacks, feature-flag reads and invite activation [D: api/controllers/trigger/webhook.py:59; api/controllers/web/passport.py:37].

OPEN: is a webhook URL treated as a secret with a rotation story, or as a public identifier? `/triggers/webhook/<webhook_id>` accepts seven HTTP methods with no other check [D: api/controllers/trigger/webhook.py:59].

OPEN: why is the boundary drawn per blueprint rather than per resource? The shape is visible; the reasoning is not.

## Runtime topology beyond the process

`dify-agent/` is a standalone Python service (`uvicorn dify_agent.server.app:app --port 5050`) [D: dify-agent/Dockerfile] and `dify-agent-runtime/` is a Go binary serving on `:5004` [D: dify-agent-runtime/docker/Dockerfile]. The backend reaches the first through `api/clients/agent_backend/` [D: api/clients/agent_backend/errors.py:50].

OPEN: what is the failure policy when the agent backend is unreachable — does an agent app degrade or fail? An error type exists for unmappable state [D: api/clients/agent_backend/errors.py:50]; the surrounding policy is not stated.

## Open questions

- OPEN: what scale is this architecture sized for — request rate, tenant count, workflow concurrency? No target appears anywhere in the tree.
- OPEN: which components are expected to be horizontally scaled, and which are singletons? `worker_beat` is a scheduler and is presumably one; nothing states it.
- OPEN: why were Postgres and MySQL both made first-class? Two database services ship in the same Compose file [D: docker/docker-compose.yaml:425; docker/docker-compose.yaml:462] and the code retains no record of the choice.
- OPEN: team ownership per component. Not recoverable from code; the index reports an average bus factor of 2.3 across the repository, which ranks risk but names no owner.
