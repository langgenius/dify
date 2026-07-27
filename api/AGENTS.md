# API Agent Guide

Read surrounding module, class, and function docstrings plus non-obvious comments before changing backend behavior. They are local contracts; update them only when their owned behavior changes, and keep them aligned with the current code.

## Commands

Run backend checks from the repository root:

- Format and lint: `make lint`
- Type check: `make type-check`
- Unit tests: `make test`
- Targeted tests: `make test TARGET_TESTS=./api/tests/<path>`

Run direct Python commands through `uv run --project api`. Docker-backed integration suites are normally CI-owned. Do not start long-running services as part of routine agent work.

## Architecture And Boundaries

- Keep transport parsing and serialization in controllers, orchestration in services, and domain policy in `core/` or its domain owner. Keep `libs/` business-agnostic and reuse existing owners before adding abstractions.
- Before changing controller schemas, generated API contracts, or `SystemFeatureModel`, read `controllers/API_SCHEMA_GUIDE.md`. Treat `/system-features` as a minimal unauthenticated bootstrap allowlist, not a general configuration registry.
- Scope tenant-owned reads and writes by the complete owner chain, and propagate `tenant_id` across every affected layer. Reconstruct trusted internal references from validated database state after payload or async boundaries.
- Keep write transactions explicit and bounded. Do not perform external I/O inside an open transaction unless a documented consistency contract requires it.
- Read configuration through `configs.dify_config`, access storage through `extensions.ext_storage.storage`, and route outbound HTTP through the existing SSRF-safe owner in `core.helper.ssrf_proxy`.
- Use Pydantic v2 for request and response models. Reuse domain-specific exceptions and translate them at the controller boundary.
- Use existing Celery task and queue owners for asynchronous work; do not route unrelated jobs through workflow-specific services.
- Celery tasks that may be retried or redelivered must keep side effects idempotent and log affected resource identifiers.
