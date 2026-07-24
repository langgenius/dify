## 1. Establish IM Control-Plane Domain

- [ ] 1.1 Add the `im_integration` package with module docstrings documenting its dependency on Contact Directory facts and its independence from provider/ORM adapters.
- [ ] 1.2 Add import-boundary tests proving IM domain modules do not import provider clients, controllers, SQLAlchemy sessions, or ORM models.
- [ ] 1.3 Add red-first tests for `IntegrationRevisionToken`, first creation, complete CAS requirements, revision advancement, stale update/delete, and ABA protection.
- [ ] 1.4 Implement `IMIntegration`, revision values, provider-tenant identity, connection diagnostics, and stable stale-revision results.
- [ ] 1.5 Add failing tests for credential rotation preservation versus provider/provider-tenant replacement invalidation.
- [ ] 1.6 Implement explicit rotation/replacement decisions and current identity/binding invalidation plans.

## 2. Implement Sync And Binding Knowledge

- [ ] 2.1 Add failing tests for `IMSyncRun` revision capture, provider-user-ID-first matching, normalized-Email fallback, unmatched results, and no External Contact creation.
- [ ] 2.2 Implement `IMSyncRun`, pure `SyncReconciler`, immutable `ReconciliationPlan`, and sync result facts.
- [ ] 2.3 Add failing tests for stale reconciliation diagnostics, single active run, concurrent trigger behavior, and idempotent `sync_run_id` retries.
- [ ] 2.4 Define transaction-oriented IM ports for CAS writes, Integration-locked run creation, snapshot load, revision-guarded apply, and append-only results.
- [ ] 2.5 Add failing tests for effective binding priority, reset-to-global, Email fallback, and Integration/provider mismatch.
- [ ] 2.6 Implement effective binding resolution and consumer snapshots without credentials, raw provider payloads, or ORM identities.

## 3. Implement IM Persistence Slice

- [ ] 3.1 Review IM Integration, identity, binding, sync run/result ORM records and align docstrings, constraints, indexes, and structured values with the domain design.
- [ ] 3.2 Add red-first bidirectional mapper tests for all IM domain and persistence records.
- [ ] 3.3 Implement explicit IM mappers under `api/repositories/human_input_v2/im_integration/`.
- [ ] 3.4 Add repository contract tests for CAS, replacement cleanup, rotation preservation, active-run locking, idempotent retry, stale apply, rollback, and eager loading.
- [ ] 3.5 Implement the SQLAlchemy IM adapter with atomic configuration transitions and revision-guarded reconciliation.
- [ ] 3.6 Add the IM Alembic revision plus metadata, structured JSON, upgrade, and scoped downgrade tests.
- [ ] 3.7 Add CI-only PostgreSQL coverage for concurrent CAS writes, concurrent sync triggers, idempotent retry, and stale reconciliation.

## 4. Validate And Handoff

- [ ] 4.1 Run targeted IM domain, mapper, repository, migration, and Contact Directory regression tests; document CI-only suites not runnable locally.
- [ ] 4.2 Run targeted coverage for the new IM Control Plane modules and record the measured report.
- [ ] 4.3 Run backend formatting, linting, and type checking for affected files.
- [ ] 4.4 Re-read affected docstrings and validate `implement-human-input-v2-im-control-plane` with OpenSpec.
