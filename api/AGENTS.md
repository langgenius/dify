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

The backend uses layered application services with ports and adapters. Read the [backend architecture][architecture] before adding an endpoint or use case, or moving behavior out of legacy code.

- Organize each business capability as a slice: an application layer that owns its use cases and business rules, ports it declares for everything external, adapters that implement those ports, one registration in the composition root, and a thin transport handler.
- Point dependencies toward the application layer. Application code works only with plain values, the admitted caller identity, and its own ports. It never depends on the web framework, the ORM, persistence models, configuration, task queues, transport code, or concrete adapters.
- Transport handlers admit the caller, validate and map input, call one use case, translate application errors into the established protocol errors, and serialize the result. They hold no business rules and never reach persistence directly.
- Repositories implement persistence ports. Each operation owns a short session or one bounded write transaction, filters by the complete owner chain, and returns plain records. Sessions and persistence models never cross a port. Other adapters wrap caches, task queues, external services, the execution kernel, and legacy code.
- Each repository operation is its own transaction. When a business rule must hold under concurrency, such as uniqueness, enforce it inside the write or with a database constraint, not only with a check before the write.
- The composition root is the only place that chooses implementations and reads configuration. Everything else receives its dependencies.
- Encode each new or migrated slice's boundaries as import contracts in the same change. The legacy layering baseline only shrinks.
- Persistence models describe tables only, with no session access, queries, or application behavior; they never become the domain model. The next step moves business-model rules into aggregates that live next to their services and whose names end with the suffix Agg. See the [backend architecture][architecture], which records what the first slice settled, before introducing one.
- When a change touches legacy code that mixes these concerns, migrate the touched use cases into a slice, delete what the slice replaces, and preserve the public wire contract.
- Treat `api/core/` as a migration-only area: do not add files or move implementations into it. Move responsibilities out; limit changes to existing callers to the adaptations needed for that migration.
- Keep `libs/` business-agnostic and reuse existing owners before adding abstractions.
- Before changing controller schemas, generated API contracts, or `SystemFeatureModel`, read `controllers/API_SCHEMA_GUIDE.md`. Treat `/system-features` as a minimal unauthenticated bootstrap allowlist, not a general configuration registry.
- Scope tenant-owned reads and writes by the complete owner chain, and propagate `tenant_id` across every affected layer. Reconstruct trusted internal references from validated database state after payload or async boundaries.
- Keep write transactions explicit and bounded. Do not perform external I/O inside an open transaction unless a documented consistency contract requires it. Trigger side effects after the write commits.
- Read configuration through `configs.dify_config`, access storage through `extensions.ext_storage.storage`, and route outbound HTTP through the existing SSRF-safe owner in `core.helper.ssrf_proxy`. Do this in the composition root or adapters, never in application code.
- Use Pydantic v2 for request and response models. Reuse domain-specific exceptions and translate them at the controller boundary.
- Use existing Celery task and queue owners for asynchronous work; do not route unrelated jobs through workflow-specific services.
- Celery tasks that may be retried or redelivered must keep side effects idempotent and log affected resource identifiers.
- Test each slice at its seams with real objects: application services against in-memory port implementations, repositories against a real lightweight database, the composition root's wiring, and handlers' admission, error translation, and wire contract. Do not introduce mock doubles.

New SQLAlchemy models must inherit from `models.base.TypeBase`. The ast-grep
guard rejects new `Base` subclasses. Existing `Base` subclasses may be edited
or migrated without adding more legacy inheritance. `make lint` checks local
changes, and CI checks the PR against its target revision.

## Typing Best Practises

- Treat nullable types (`T | None`) strictly as union types; document the semantic meaning for each branch.
- Treat default parameter values as introducing distinct function overloads; verify that every added default has demonstrable practical utility and avoids masking unsafe runtime states.

[architecture]: ../.agents/skills/backend-code-review/references/architecture-rule.md
