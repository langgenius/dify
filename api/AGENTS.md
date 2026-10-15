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

The backend follows a strict domain-driven slice pattern. Read the [backend architecture][architecture] before adding an endpoint or use case, or moving behavior out of a legacy service. It owns the slice anatomy, the reference slices to copy, and the boundary contract template.

- Put every use case in a slice: an application service in `services/<domain>/` (or only a query port for a read with no policy beyond owner scoping), the ports it declares, adapters that implement them, one registration in the composition root, and a thin controller. Copy a reference slice, not a legacy static service.
- Application services own invariants and domain policy. They declare consumer-owned `Protocol` ports, immutable records, and framework-neutral errors. They take the admitted `RequestContext` from `machinery.context` and receive ports and plain values through a keyword-only constructor. They must not import `flask`, `werkzeug`, `sqlalchemy`, `models`, `repositories`, `controllers`, `extensions`, `configs`, or `tasks`.
- Controllers declare admission, validate payloads with Pydantic v2, map them to application inputs, call `application_services().<slice>`, translate slice errors into HTTP errors, and serialize the returned records. They must not import `models`, `repositories`, `sqlalchemy`, or `extensions.ext_database`, query tables, or decide business policy.
- Repositories in `repositories/<domain>/` implement store and query ports. Each method owns its session, filters by the full owner chain, and returns records. Sessions, ORM rows, and lazy relationships never cross a port. `*_adapters.py` and `*_gateway.py` modules implement the remaining ports over Redis, Celery, Enterprise, `core`, or legacy services.
- `extensions/ext_application_services.py` and `extensions/application_services/<domain>.py` are the only composition root. Construct adapters, read `configs.dify_config`, and inject plain values there.
- Add the service and controller boundary contracts to `api/.importlinter` in the same change as each new or migrated slice. Never add an `ignore_imports` entry; delete the entry for each import a migration removes.
- Keep ORM models as table mappings, with no session loading, queries, or application operations.
- When a change touches a legacy static service or a controller that queries models, migrate the touched use cases into a slice. Delete the replaced code and its tests, and preserve the public wire contract.
- Treat `api/core/` as a migration-only area: do not add files or move implementations into it. Move responsibilities out; limit changes to existing callers to the adaptations needed for that migration.
- Keep `libs/` business-agnostic. Reuse existing repositories and ports before adding abstractions.
- Before changing controller schemas, generated API contracts, or `SystemFeatureModel`, read `controllers/API_SCHEMA_GUIDE.md`. Treat `/system-features` as a minimal unauthenticated bootstrap allowlist, not a general configuration registry.
- Scope tenant-owned reads and writes by the complete owner chain, and pass owner ids explicitly through every port. Reconstruct trusted internal references from validated database state after payload or async boundaries.
- Keep write transactions explicit and bounded. Do not perform external I/O inside an open transaction unless a documented consistency contract requires it; dispatch side effects after the write commits.
- Access storage through `extensions.ext_storage.storage` and route outbound HTTP through the existing SSRF-safe owner in `core.helper.ssrf_proxy`, both from adapters.
- Use existing Celery task and queue owners for asynchronous work; do not route unrelated jobs through workflow-specific services.
- Celery tasks that may be retried or redelivered must keep side effects idempotent and log affected resource identifiers.
- Test each slice at its seams: application services with in-memory Protocol implementations, repositories against `sqlite_session_factory`, wiring in `tests/unit_tests/extensions/test_ext_application_services.py`, and controllers for admission, error translation, and the wire contract. CI rejects new `Mock`, `MagicMock`, and `SimpleNamespace` constructors.

New SQLAlchemy models must inherit from `models.base.TypeBase`. The ast-grep
guard rejects new `Base` subclasses. Existing `Base` subclasses may be edited
or migrated without adding more legacy inheritance. `make lint` checks local
changes, and CI checks the PR against its target revision.

## Typing Best Practises

- Treat nullable types (`T | None`) strictly as union types; document the semantic meaning for each branch.
- Treat default parameter values as introducing distinct function overloads; verify that every added default has demonstrable practical utility and avoids masking unsafe runtime states.

[architecture]: ../.agents/skills/backend-code-review/references/architecture-rule.md
