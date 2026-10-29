# API Agent Guide

Read surrounding module, class, and function docstrings plus non-obvious comments before changing backend behavior. They are local contracts; update them only when their owned behavior changes, and keep them aligned with the current code.

## Commands

Run backend checks from the repository root:

- Format and lint: `make lint`
- Type check: `make type-check`
- Unit tests: `make test`
- Targeted tests: `make test TARGET_TESTS=./api/tests/<path>`

Run direct Python commands through `uv run --project api`. Docker-backed integration suites are normally CI-owned. Do not start long-running services as part of routine agent work.

Follow the backend developer guide's [test layout and naming requirements](README.md#testing) when adding or moving unit tests.

## Architecture And Boundaries

Read all backend architecture documentation before modifying backend code:

- [Backend architecture][architecture]
- [Repositories rule][repositories]
- [SQLAlchemy rule][sqlalchemy]
- [Database schema rule][db-schema]
- [API schema guide][schema-guide]

## Additional Backend Rules

- Reconstruct trusted internal references from validated database state after payload or async boundaries.
- Read configuration through `configs.dify_config`, access storage through `extensions.ext_storage.storage`, and route outbound HTTP through the existing SSRF-safe owner in `core.helper.ssrf_proxy`.
- Use existing Celery task and queue owners for asynchronous work; do not route unrelated jobs through workflow-specific services.
- Celery tasks that may be retried or redelivered must keep side effects idempotent and log affected resource identifiers.

New SQLAlchemy models must inherit from `models.base.TypeBase`. The ast-grep
guard rejects new `Base` subclasses. Existing `Base` subclasses may be edited
or migrated without adding more legacy inheritance. `make lint` checks local
changes, and CI checks the PR against its target revision.

## Typing Best Practises

- Treat nullable types (`T | None`) strictly as union types; document the semantic meaning for each branch.
- Treat default parameter values as introducing distinct function overloads; verify that every added default has demonstrable practical utility and avoids masking unsafe runtime states.

[architecture]: ../.agents/skills/backend-code-review/references/architecture-rule.md
[repositories]: ../.agents/skills/backend-code-review/references/repositories-rule.md
[sqlalchemy]: ../.agents/skills/backend-code-review/references/sqlalchemy-rule.md
[db-schema]: ../.agents/skills/backend-code-review/references/db-schema-rule.md
[schema-guide]: controllers/API_SCHEMA_GUIDE.md
