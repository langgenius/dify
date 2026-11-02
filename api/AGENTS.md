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
- [Repositories][repositories]
- [SQLAlchemy][sqlalchemy]
- [Database schema][db-schema]
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

## Billing And SaaS Calls

- Call billing and saas only through the generated functions in `services/billing_client`; do not hand-write paths or response types.
- Ruff's banned-api rule (TID251) enforces this: outside `services/billing_client`, reading the billing URL and secret settings or calling `transport.request` fails lint.
- To call a new endpoint, add it to `ALLOWED_OPERATIONS` in `dev/generate_billing_client.py` and rerun that script against a dify-saas checkout. Never edit the generated modules or snapshots by hand.

## Typing Best Practises

- Treat nullable types (`T | None`) strictly as union types; document the semantic meaning for each branch.
- Treat default parameter values as introducing distinct function overloads; verify that every added default has demonstrable practical utility and avoids masking unsafe runtime states.

## Invariants And Construction

- Start each design from explicit principles and domain invariants. An invariant is a condition that all valid states preserve.
- Derive implementation rules and memory documents from these principles. Explain the invariant that each rule protects.
- Document each invariant in the docstring of the module, class, or function that owns it. Use a comment for a local invariant.
- Use abstract interpretation to reason about possible values and state transitions. Check that each operation preserves the relevant invariants.
- Use dedicated types to distinguish domain values with different meanings. Use `NewType` for static distinctions between values with identical representations.
- `NewType` does not validate values at runtime. Use validated value objects when an invariant requires runtime checks.
- Model mutually exclusive alternatives (an OR relationship) with union types. Use a tagged union when variants need an explicit discriminator.
- Give each tagged variant a distinct `Literal` tag. Include only the fields that are valid for that variant.
- Prefer safe-by-construction functional idioms. Use immutable values, explicit result variants, and pure functions where practical.
- Validate external values at boundaries with Pydantic v2 models or `TypeAdapter`. Construct trusted domain values only after validation succeeds.

## Control Flow And Contracts

- Use structured control flow. Do not add `continue` or `break` statements.
- Express iteration with explicit conditions, comprehensions, or small functions that return a result.
- State preconditions and postconditions for each new or changed function in the code you produce.
- Put these contracts in the function docstring. Include accepted inputs, required state, results, side effects, and failure behavior as applicable.
- Specify which invariants remain true after success and failure. Use types and executable checks to enforce contracts where practical.
- Include preconditions and postconditions in the change report. State which checks support the claimed postconditions.

[architecture]: ../docs/BACKEND_ARCHITECTURE.md
[repositories]: ../docs/BACKEND_REPOSITORIES.md
[sqlalchemy]: ../docs/BACKEND_SQLALCHEMY.md
[db-schema]: ../docs/BACKEND_DATABASE_SCHEMA.md
[schema-guide]: controllers/API_SCHEMA_GUIDE.md
