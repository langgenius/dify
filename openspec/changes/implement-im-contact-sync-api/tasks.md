## 1. Freeze Reconciliation Contracts And Test Matrix

- [x] 1.1 Replace the current match-hint DTOs in `api/core/human_input_v2/im_integration/sync_reconciliation.py` with immutable input, blocker, new-identity reference, typed mutation, planned result, planned warning and composite plan values aligned with `reconciliation_api_stub.py`, using `DirectoryEntry`, `IMBinding` terminology and `ReconciliationRunRef` consistently.
- [x] 1.2 Add interface and import-boundary tests proving the planner contract contains no Flask, SQLAlchemy, repository, Provider adapter, credential, binding-scope, workspace or edition dependency.
- [x] 1.3 Write red-first planner tests for empty state, identity create/update/refresh/delete, unmatched identity persistence and deterministic `changed_fields` ordering.
- [x] 1.4 Write red-first IM binding decision-table tests for Provider-user-ID precedence, unique email match, missing/no-match email, the tolerated duplicate Contact-email input violation, competing Provider identities, protection of a binding to an identity still in the Directory, preservation when a bound Contact is absent from `contacts_for_email_matching` and unique replacement.
- [x] 1.5 Write red-first invariant tests for duplicate Provider user IDs, duplicate current natural keys, invalid `current_bindings`, invalid `reconciled_binding_ids`, deterministic blocker ordering and deterministic output.
- [x] 1.6 Add convergence tests that project a valid plan into logical state and prove a second reconciliation produces no IM binding mutation for the same Directory snapshot.
- [x] 1.7 Align Contact Directory governance, IM control-plane specs, application contracts and implementation names on `IMIdentity`, `IMBinding`, Organization binding and workspace override; do not introduce additional Contact-to-identity relationship synonyms.

## 2. Implement The Pure Composite Planner

- [x] 2.1 Consume shared immutable `DirectoryEntry` values directly, derive normalized emails in the pure planner, and build O(n) indexes without Provider raw payload, database access, clocks or random-ID generation.
- [x] 2.2 Implement complete input validation that returns all deterministically ordered `ReconciliationBlock` values for structural corruption while keeping business ambiguity as `Not Matched` decisions in a `ReconciliationPlan`.
- [x] 2.3 Implement identity upsert planning so every complete Directory entry produces exactly one `CREATE`, `UPDATE` or `REFRESH`, and every absent current identity is planned for phase-three deletion.
- [x] 2.4 Implement IM binding planning from `current_bindings` and `reconciled_binding_ids`, including Provider-ID binding preservation independent of `contacts_for_email_matching`, unique Contact match, protection of bindings to identities still in the Directory, ambiguity handling and absent-identity replacement.
- [x] 2.5 Implement deterministic operation/warning keys, `NewIMIdentityRef` resolution, dependency ordering, product results for `Added / Not Matched / Removed / Skipped`, and deterministically ordered warning data containing all affected identity refs and collision Contact IDs.
- [x] 2.6 Enforce at least 95% statement coverage and at least 95% branch coverage for the pure plan-generation module with an isolated coverage gate and document any excluded non-planner module outside that gate.

## 3. Add Reconciliation Change-Log Persistence

- [x] 3.1 Define immutable IM identity and IM binding before/after change-log snapshot models that exclude credentials, Provider raw payload, client state and transport material.
- [x] 3.2 Add the append-only reconciliation change-log ORM model and migration with subject kind, operation, reason, resolved identifiers, snapshots, commit time and a unique `(sync_run_id, operation_key)` constraint.
- [x] 3.3 Add deterministic operation-key support to product sync result persistence or an equivalent uniqueness guard that prevents duplicate run facts without changing the latest-run transport buckets.
- [x] 3.4 Add Testcontainers PostgreSQL migration tests for table shape, constraints, indexes, snapshot validation, upgrade preservation and downgrade isolation from unrelated tables.
- [x] 3.5 Add mapper tests proving change-log and sync result records round-trip through immutable domain/application values without leaking ORM records.

## 4. Implement Redis-Serialized Input Loading And Conditional Plan Execution

- [x] 4.1 Add a guarded Organization IM write unit of work that acquires the Organization-scoped Redis write lock before exposing protected repository mutations; use redis-py ownership tokens, bounded acquisition, finite TTL and explicit same-thread ownership checks/extensions, key it by workspace ownership in CE/SaaS and deployment ownership in EE, and do not reuse the migration-only `DbMigrationAutoRenewLock`.
- [x] 4.2 Inventory every application write path that can change Integration revision, active sync-run state, current IM identities, current IM bindings or Contact/Account/membership facts used by `contacts_for_email_matching`, and route each through the guarded write unit of work without blocking read-only queries.
- [x] 4.3 Implement CE/SaaS input projection for current workspace active Account-backed Contacts and EE input projection for deployment Organization active Account Contacts, excluding External, unavailable and cross-Organization Contacts before planner invocation.
- [x] 4.4 Load a complete unfiltered `current_identities` snapshot for the run's Integration namespace, including unbound identities, then load every binding that references those identities into `current_bindings` and only Organization binding IDs into `reconciled_binding_ids`, so workspace overrides never compete in automatic matching but are removed before an absent identity is deleted.
- [x] 4.5 Implement executor phase one identity create/update/refresh so each create allocates one UUIDv7 `IMIdentityId`, stores it in one execution-local `Mapping[NewIMIdentityRef, IMIdentityId]`, and resolves later plan operations and warning diagnostics through a local helper without introducing a second materialized-plan contract.
- [x] 4.6 Implement executor phase two IM binding create/replace/delete using exact conditional preconditions and affected-row checks, with no bulk row locking, repository-side email matching or result reclassification.
- [x] 4.7 Implement executor phase three identity deletion after every referencing binding has been deleted or replaced, including an identity-only change-log record and no product `Removed` record for an unbound identity.
- [x] 4.8 Atomically write change-log records, product sync results and terminal run counters with current-state mutations; return stable stale-revision, already-applied and precondition-failed outcomes.
- [x] 4.9 Add SQLite-backed repository unit tests for protected-write routing, portable rollback and idempotency behavior across each mutation/change-log/result/run phase, and reserve PostgreSQL-specific transaction and constraint behavior for Testcontainers integration tests.

## 5. Build Application Services And Worker Orchestration

- [x] 5.1 Add a transport-neutral `IMSyncService` for create-or-get active run, worker dispatch, latest-run summary and required single-bucket latest-result paging.
- [x] 5.2 Add `IMContactSyncCoordinator` orchestration that resolves the captured Integration, constructs the Provider adapter, reads a complete Directory before lock acquisition, acquires the Organization-scoped Redis write lock, then loads input, generates the plan and conditionally applies it in one database transaction before releasing the lock; for each resolved Contact email collision warning, emit structured logging with run/Integration correlation, collision group count, warning key, all affected `IMIdentityId` values and all colliding `ContactId` values, but no raw email or Contact profile.
- [x] 5.3 Map `DirectoryReadFailure`, lock unavailable/lost, blocked plan, stale revision, precondition failure and unexpected apply failure into stable retryable or terminal diagnostics without partial current-state mutation.
- [x] 5.4 Add an idempotent Celery worker entry point that logs run and Integration identifiers, closes Provider adapters, and returns the persisted terminal state on redelivery.
- [x] 5.5 Route `ContactIMBindingService`, Integration replacement and every Contact/Account/membership mutation that can change Contact email-match admission through the same guarded Organization IM write unit of work as reconciliation.
- [x] 5.6 Remove implicit normalized-email selection from effective runtime binding resolution so runtime consumers use only persisted Organization bindings and workspace overrides and never create an unlogged binding decision.

## 6. Add Queries, Composition And Workspace Flask API

- [x] 6.1 Implement synchronized identity search by display name, email and Provider user ID, including identities with no current IM binding and correct binding-status result.
- [x] 6.2 Implement latest-run and latest-result repository queries with stable `page / limit / total`, one required real bucket and no unfiltered all-results mode.
- [x] 6.3 Add a transport-neutral composition factory that wires Provider adapter construction, reconciliation unit of work, planner, executor, services, worker dispatch and queries without controller imports.
- [x] 6.4 Add SQLite-backed application-service and architecture tests proving CE/SaaS workspace scope resolution remains outside the planner, protected repository mutations are unavailable outside the guarded Organization IM write unit of work, and read-only queries do not acquire the write lock.
- [x] 6.5 Replace the reconciliation-backed 501 handlers in `api/controllers/console/workspace/human_input.py` for manual sync create/latest/latest-results, synchronized identity search, Organization binding create/delete and workspace override set/reset with thin service-backed Flask implementations.
- [x] 6.6 Reuse or minimally complete the existing Pydantic request/response contracts and add SQLite-backed controller tests for authorization, validation, latest-only paging, result-bucket filtering, identity search, binding/override behavior, stable domain-error mapping and proof that the in-scope routes no longer return the generic 501 response.
- [x] 6.7 Update the ownership handoff with `human-input-v2-api-contracts` so it does not duplicate these workspace handlers; defer the Dify EE trusted internal handler, EE Kratos handler and Protobuf contract to the EE transport changes while preserving the shared application-service contract.

## 7. Verify Concurrency, Compatibility And Quality Gates

- [x] 7.1 Add integration tests under `api/tests/test_containers_integration_tests` that start PostgreSQL and Redis through Testcontainers and prove reconciliation blocks every protected writer before SQL execution, releases waiting writers after commit/rollback, leaves read-only queries available, and covers acquisition timeout, TTL extension, ownership loss rollback, concurrent sync workers, Integration replacement, conditional Contact precondition changes, absence of bulk row locks and already-applied worker redelivery.
- [x] 7.2 Verify existing current IM identities, IM bindings and historical sync results remain readable without change-log backfill, and verify the first new run starts forward-only change history.
- [x] 7.3 Run the targeted pure planner coverage gate with branch measurement and fail unless statement coverage and branch coverage are each at least 95%; do not rely on the combined coverage percentage to prove both thresholds.
- [x] 7.4 Explicitly list every production module added or modified by this change as the project coverage scope, collect unit and integration coverage separately against that same scope, and prevent exclusions from silently shrinking the denominator.
- [x] 7.5 Run the SQLite-backed unit suite through `uv run --project api` and enforce at least 90% coverage for the project coverage scope without starting PostgreSQL or accessing a shared external database.
- [x] 7.6 Run the Testcontainers PostgreSQL integration suite in CI and enforce at least 80% coverage for the same project coverage scope; merged unit/integration coverage MAY be reported but MUST NOT replace either independent gate.
- [ ] 7.7 Run backend formatting, lint and type checks, validate this OpenSpec change, and confirm no inconsistent run-reference name, Provider raw payload, ORM type or edition branch remains in the planner public surface.
