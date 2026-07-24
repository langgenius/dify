## 1. Establish IM Control-Plane Domain

- [x] 1.1 Add the `im_integration` package with module docstrings documenting its dependency on Contact Directory facts and its independence from provider/ORM adapters.
- [x] 1.2 Add import-boundary tests proving IM domain modules do not import provider clients, controllers, SQLAlchemy sessions, or ORM models.
- [x] 1.3 Add red-first tests for `IntegrationRevisionToken`, first creation, complete CAS requirements, revision advancement, stale update/delete, and ABA protection.
- [x] 1.4 Implement `IMIntegration`, revision values, provider-tenant identity, connection diagnostics, and stable stale-revision results.
- [x] 1.5 Add failing tests for credential rotation preservation versus provider/provider-tenant replacement invalidation.
- [x] 1.6 Implement explicit rotation/replacement decisions and current identity/binding invalidation plans.

## 2. Implement Sync And Binding Knowledge

- [x] 2.1 Add failing tests for `IMSyncRun` revision capture, provider-user-ID-first matching, normalized-Email fallback, unmatched results, and no External Contact creation.
- [x] 2.2 Implement `IMSyncRun`, pure `SyncReconciler`, immutable `ReconciliationPlan`, and sync result facts.
- [x] 2.3 Add failing tests for stale reconciliation diagnostics, single active run, concurrent trigger behavior, and idempotent `sync_run_id` retries.
- [x] 2.4 Define transaction-oriented IM ports for CAS writes, Integration-locked run creation, snapshot load, revision-guarded apply, and append-only results.
- [x] 2.5 Add failing tests for effective binding priority, reset-to-global, Email fallback, and Integration/provider mismatch.
- [x] 2.6 Implement effective binding resolution and consumer snapshots without credentials, raw provider payloads, or ORM identities.

## 3. Implement IM Persistence Slice

- [x] 3.1 Review IM Integration, identity, binding, sync run/result ORM records and align docstrings, constraints, indexes, and structured values with the domain design.
- [x] 3.2 Add red-first bidirectional mapper tests for all IM domain and persistence records.
- [x] 3.3 Implement explicit IM mappers under `api/repositories/human_input_v2/im_integration/`.
- [x] 3.4 Add repository contract tests for CAS, replacement cleanup, rotation preservation, active-run locking, idempotent retry, stale apply, rollback, and eager loading.
- [x] 3.5 Implement the SQLAlchemy IM adapter with atomic configuration transitions and revision-guarded reconciliation.
- [x] 3.6 Add the IM Alembic revision plus metadata, structured JSON, upgrade, and scoped downgrade tests.
- [x] 3.7 Add CI-only PostgreSQL coverage for concurrent CAS writes, concurrent sync triggers, idempotent retry, and stale reconciliation.

## 4. Validate And Handoff

- [x] 4.1 Run targeted IM domain, mapper, repository, migration, and Contact Directory regression tests; document CI-only suites not runnable locally.
- [x] 4.2 Run targeted coverage for the new IM Control Plane modules and record the measured report.
- [x] 4.3 Run backend formatting, linting, and type checking for affected files.
- [x] 4.4 Re-read affected docstrings and validate `implement-human-input-v2-im-control-plane` with OpenSpec.

## Validation Evidence

- Targeted IM and Contact Directory regression suite: `118 passed`.
- Focused IM domain/repository coverage: `92.43%`, above the explicit `90%` threshold; reports are `coverage.xml` and `coverage.json`.
- Affected-file Ruff formatting/lint, Pyrefly, and Mypy checks passed.
- PostgreSQL concurrency coverage is defined in `api/tests/integration_tests/repositories/human_input_v2/test_im_control_plane_concurrency.py`; it is CI-only and was not run locally.
