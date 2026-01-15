## Configuration

- Import `configs.dify_config` for every runtime toggle. Do not read environment variables directly.
- Add new settings to the proper mixin inside `configs/` (deployment, feature, middleware, etc.) so they load through `DifyConfig`.
- Remote overrides come from the optional providers in `configs/remote_settings_sources`; keep defaults in code safe when the value is missing.
- Example: logging pulls targets from `extensions/ext_logging.py`, and model provider URLs are assembled in `services/entities/model_provider_entities.py`.

## Dependencies

- Runtime dependencies live in `[project].dependencies` inside `pyproject.toml`. Optional clients go into the `storage`, `tools`, or `vdb` groups under `[dependency-groups]`.
- Always pin versions and keep the list alphabetised. Shared tooling (lint, typing, pytest) belongs in the `dev` group.
- When code needs a new package, explain why in the PR and run `uv lock` so the lockfile stays current.

## Storage & Files

- Use `extensions.ext_storage.storage` for all blob IO; it already respects the configured backend.
- Convert files for workflows with helpers in `core/file/file_manager.py`; they handle signed URLs and multimodal payloads.
- When writing controller logic, delegate upload quotas and metadata to `services/file_service.py` instead of touching storage directly.
- All outbound HTTP fetches (webhooks, remote files) must go through the SSRF-safe client in `core/helper/ssrf_proxy.py`; it wraps `httpx` with the allow/deny rules configured for the platform.

## Redis & Shared State

- Access Redis through `extensions.ext_redis.redis_client`. For locking, reuse `redis_client.lock`.
- Prefer higher-level helpers when available: rate limits use `libs.helper.RateLimiter`, provider metadata uses caches in `core/helper/provider_cache.py`.

## Models

- SQLAlchemy models sit in `models/` and inherit from the shared declarative `Base` defined in `models/base.py` (metadata configured via `models/engine.py`).
- `models/__init__.py` exposes grouped aggregates: account/tenant models, app and conversation tables, datasets, providers, workflow runs, triggers, etc. Import from there to avoid deep path churn.
- Follow the DDD boundary: persistence objects live in `models/`, repositories under `repositories/` translate them into domain entities, and services consume those repositories.
- When adding a table, create the model class, register it in `models/__init__.py`, wire a repository if needed, and generate an Alembic migration as described below.

## Vector Stores

- Vector client implementations live in `core/rag/datasource/vdb/<provider>`, with a common factory in `core/rag/datasource/vdb/vector_factory.py` and enums in `core/rag/datasource/vdb/vector_type.py`.
- Retrieval pipelines call these providers through `core/rag/datasource/retrieval_service.py` and dataset ingestion flows in `services/dataset_service.py`.
- The CLI helper `flask vdb-migrate` orchestrates bulk migrations using routines in `commands.py`; reuse that pattern when adding new backend transitions.
- To add another store, mirror the provider layout, register it with the factory, and include any schema changes in Alembic migrations.

## Observability & OTEL

- OpenTelemetry settings live under the observability mixin in `configs/observability`. Toggle exporters and sampling via `dify_config`, not ad-hoc env reads.
- HTTP, Celery, Redis, SQLAlchemy, and httpx instrumentation is initialised in `extensions/ext_app_metrics.py` and `extensions/ext_request_logging.py`; reuse these hooks when adding new workers or entrypoints.
- When creating background tasks or external calls, propagate tracing context with helpers in the existing instrumented clients (e.g. use the shared `httpx` session from `core/helper/http_client_pooling.py`).
- If you add a new external integration, ensure spans and metrics are emitted by wiring the appropriate OTEL instrumentation package in `pyproject.toml` and configuring it in `extensions/`.

## Ops Integrations

- Langfuse support and other tracing bridges live under `core/ops/opik_trace`. Config toggles sit in `configs/observability`, while exporters are initialised in the OTEL extensions mentioned above.
- External monitoring services should follow this pattern: keep client code in `core/ops`, expose switches via `dify_config`, and hook initialisation in `extensions/ext_app_metrics.py` or sibling modules.
- Before instrumenting new code paths, check whether existing context helpers (e.g. `extensions/ext_request_logging.py`) already capture the necessary metadata.

## Controllers, Services, Core

- Controllers only parse HTTP input and call a service method. Keep business rules in `services/`.
- Services enforce tenant rules, quotas, and orchestration, then call into `core/` engines (workflow execution, tools, LLMs).
- When adding a new endpoint, search for an existing service to extend before introducing a new layer. Example: workflow APIs pipe through `services/workflow_service.py` into `core/workflow`.

## Plugins, Tools, Providers

- In Dify a plugin is a tenant-installable bundle that declares one or more providers (tool, model, datasource, trigger, endpoint, agent strategy) plus its resource needs and version metadata. The manifest (`core/plugin/entities/plugin.py`) mirrors what you see in the marketplace documentation.
- Installation, upgrades, and migrations are orchestrated by `services/plugin/plugin_service.py` together with helpers such as `services/plugin/plugin_migration.py`.
- Runtime loading happens through the implementations under `core/plugin/impl/*` (tool/model/datasource/trigger/endpoint/agent). These modules normalise plugin providers so that downstream systems (`core/tools/tool_manager.py`, `services/model_provider_service.py`, `services/trigger/*`) can treat builtin and plugin capabilities the same way.
- For remote execution, plugin daemons (`core/plugin/entities/plugin_daemon.py`, `core/plugin/impl/plugin.py`) manage lifecycle hooks, credential forwarding, and background workers that keep plugin processes in sync with the main application.
- Acquire tool implementations through `core/tools/tool_manager.py`; it resolves builtin, plugin, and workflow-as-tool providers uniformly, injecting the right context (tenant, credentials, runtime config).
- To add a new plugin capability, extend the relevant `core/plugin/entities` schema and register the implementation in the matching `core/plugin/impl` module rather than importing the provider directly.

## Async Workloads

see `agent_skills/trigger.md` for more detailed documentation.

- Enqueue background work through `services/async_workflow_service.py`. It routes jobs to the tiered Celery queues defined in `tasks/`.
- Workers boot from `celery_entrypoint.py` and execute functions in `tasks/workflow_execution_tasks.py`, `tasks/trigger_processing_tasks.py`, etc.
- Scheduled workflows poll from `schedule/workflow_schedule_tasks.py`. Follow the same pattern if you need new periodic jobs.

## Database & Migrations

- SQLAlchemy models live under `models/` and map directly to migration files in `migrations/versions`.
- Generate migrations with `uv run --project api flask db revision --autogenerate -m "<summary>"`, then review the diff; never hand-edit the database outside Alembic.
- Apply migrations locally using `uv run --project api flask db upgrade`; production deploys expect the same history.
- If you add tenant-scoped data, confirm the upgrade includes tenant filters or defaults consistent with the service logic touching those tables.

## CLI Commands

- Maintenance commands from `commands.py` are registered on the Flask CLI. Run them via `uv run --project api flask <command>`.
- Use the built-in `db` commands from Flask-Migrate for schema operations (`flask db upgrade`, `flask db stamp`, etc.). Only fall back to custom helpers if you need their extra behaviour.
- Custom entries such as `flask reset-password`, `flask reset-email`, and `flask vdb-migrate` handle self-hosted account recovery and vector database migrations.
- Before adding a new command, check whether an existing service can be reused and ensure the command guards edition-specific behaviour (many enforce `SELF_HOSTED`). Document any additions in the PR.
- Ruff helpers are run directly with `uv`: `uv run --project api --dev ruff format ./api` for formatting and `uv run --project api --dev ruff check ./api` (add `--fix` if you want automatic fixes).

## When You Add Features

- Check for an existing helper or service before writing a new util.
- Uphold tenancy: every service method should receive the tenant ID from controller wrappers such as `controllers/console/wraps.py`.
- Update or create tests alongside behaviour changes (`tests/unit_tests` for fast coverage, `tests/integration_tests` when touching orchestrations).
- Run `uv run --project api --dev ruff check ./api`, `uv run --directory api --dev basedpyright`, and `uv run --project api --dev dev/pytest/pytest_unit_tests.sh` before submitting changes.
