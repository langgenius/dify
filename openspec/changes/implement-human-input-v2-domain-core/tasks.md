## 1. Establish Domain Boundaries And Test Harness

- [ ] 1.1 Add focused unit-test packages for `contact_directory`, `approval`, `im_integration`, and shared value objects under `api/tests/unit_tests/core/human_input_v2/`, with fixtures that do not create Flask applications or database engines.
- [ ] 1.2 Add the `api/core/human_input_v2/{shared,contact_directory,approval,im_integration}/` package structure with module docstrings defining responsibilities, dependency direction, and explicitly excluded transport/persistence concerns.
- [ ] 1.3 Add import-boundary tests or equivalent static assertions proving Human Input v2 domain modules do not import controllers, Flask, SQLAlchemy sessions, or `models.*` modules.
- [ ] 1.4 Define typed identifiers, normalized email, organization/workspace scope, timestamps, and immutable snapshot value objects in `shared/`, with red-first tests for normalization, equality, invalid values, and serialization boundaries.
- [ ] 1.5 Define transport-neutral domain error types and stable reason codes for Contact, recipient resolution, form state, authorization proof, OTP, and IM revision failures; keep compatibility re-exports for existing imports from `core.human_input_v2.entities`.

## 2. Model Contact Directory Semantics

- [ ] 2.1 Add failing tests for Contact identity ownership invariants covering EE Organization Account, CE/SaaS workspace member, External Contact, invalid owner combinations, and immutable identity source.
- [ ] 2.2 Implement the `Contact` entity, owner references, Contact snapshots, and factories without persisting workspace-relative Contact type on the entity.
- [ ] 2.3 Add failing table-driven tests for workspace resolution covering `WORKSPACE`, `PLATFORM`, `EXTERNAL`, and `ABSENT` across CE, SaaS, and EE membership/allow-list states.
- [ ] 2.4 Implement `ContactDirectoryPolicy.resolve_for_workspace(...)` and the request-scoped `ContactDirectorySnapshot` used by resolution and authorization flows.
- [ ] 2.5 Add failing tests for External Contact admission, normalized-email collision with internal contacts, cross-Organization rejection, hard deletion, same-email recreation with a new Contact ID, and disabled Account unavailability.
- [ ] 2.6 Implement Contact admission and lifecycle policies while keeping authorization, membership lookup, and persistence I/O outside the entity.
- [ ] 2.7 Define aggregate-oriented Contact directory ports for loading one tenant-scoped snapshot and committing Contact lifecycle or Platform allow-list mutations; avoid table-shaped generic CRUD interfaces.

## 3. Implement Canonical Recipient Resolution

- [ ] 3.1 Add failing tests for immutable Contact, one-time Email, dynamic Email, and current-initiator recipient specifications, including unsupported dynamic value types and invalid Email values.
- [ ] 3.2 Implement domain recipient specification value objects and explicit adapters from workflow node v2 configuration without importing controller DTOs.
- [ ] 3.3 Add failing tests proving static Contact, matching dynamic Email, and current initiator collapse into one canonical Contact approver while retaining every matched source.
- [ ] 3.4 Add failing tests proving unmatched valid Email becomes one EmailAddress approver, repeated normalized Email values deduplicate, and invalid values remain machine-readable rejected-recipient facts.
- [ ] 3.5 Add failing tests for endpoint planning: Contact with Email and effective IM binding gets parallel endpoints, Contact without IM gets Email only, and an approver without any usable endpoint causes the stable no-valid-recipients result when no other approver remains.
- [ ] 3.6 Add failing tests for debug recipient replacement and unavailable current initiator without mutating the saved recipient specifications.
- [ ] 3.7 Implement `RecipientResolver` as the only module responsible for validation, Contact upgrade, canonicalization, matched-source aggregation, debug override, and delivery endpoint planning.
- [ ] 3.8 Define immutable `ResolvedApprovalPlan`, canonical subject keys, approver snapshots, endpoint plans, and rejected-recipient facts; verify deterministic ordering for identical request-scoped snapshots.

## 4. Model Approval Form, Authorization, And OTP

- [ ] 4.1 Add failing tests that keep `ApproverGrant`, `DeliveryEndpoint`, `AuthorizationProof`, and `SubmissionActor` distinct and prevent endpoint tokens or historical snapshots from becoming submission authority.
- [ ] 4.2 Implement the `HumanInputForm` aggregate, approver grants, endpoint snapshots, active-state checks, action validation, and first successful state transition using immutable domain values.
- [ ] 4.3 Add failing tests for submitted, timed-out, expired, and globally expired forms, including stable domain results that contain no HTTP status knowledge.
- [ ] 4.4 Add failing authorization tests for current Account session, trusted EndUser, Email OTP, and IM identity proof, including correct resolution to Account, EndUser, or EmailAddress submission actors.
- [ ] 4.5 Add failing stale-proof tests for deleted External Contact, disabled Account, same-email Contact recreation, changed Contact email, removed workspace availability, and changed IM binding.
- [ ] 4.6 Implement `SubmissionAuthorizer` so verified proof identifies the current actor but authorization still revalidates form state, grant subject, Contact availability, email, and binding state.
- [ ] 4.7 Add failing OTP lifecycle tests for 10-minute expiry, 60-second resend cooldown, five-send limit, five-attempt limit, successful verification, resend invalidation, and plaintext-secret exclusion.
- [ ] 4.8 Implement the `OTPChallenge` proof-session aggregate and hashing/clock ports without giving the challenge authority to submit a form.
- [ ] 4.9 Define approval persistence ports for loading authorization context, replacing the current OTP challenge under the grant lock, appending rejection audit facts, and atomically committing one authorized submission.

## 5. Model IM Integration, Sync, And Effective Binding

- [ ] 5.1 Add failing tests for first IM Integration creation, complete CAS token requirements, successful revision advancement, stale update/delete rejection, and ABA protection through integration ID plus config version.
- [ ] 5.2 Implement the `IMIntegration` aggregate with provider-specific tenant identity, configuration revision, connection diagnostics that do not advance revision, and explicit credential rotation versus provider-tenant replacement decisions.
- [ ] 5.3 Add failing tests proving provider or provider-tenant replacement invalidates current identities/bindings while confirmed credential rotation preserves them.
- [ ] 5.4 Add failing tests for `IMSyncRun` revision capture, stale reconciliation rejection, provider-user-ID-first matching, normalized-email fallback, unmatched results, and no automatic External Contact creation.
- [ ] 5.5 Implement `IMSyncRun`, reconciliation decisions, immutable sync result facts, and ports that separate provider directory reads from current-state persistence.
- [ ] 5.6 Add failing tests for effective binding priority `workspace override > organization binding > Email fallback`, reset-to-global behavior, and mismatched integration/provider rejection.
- [ ] 5.7 Implement effective IM binding resolution and binding invariants without exposing provider credentials or ORM identity records to recipient resolution.
- [ ] 5.8 Define IM persistence ports for CAS configuration writes, revision-guarded reconciliation, current identity/binding snapshots, and append-only sync results.

## 6. Align Persistence Schema And Domain Mapping

- [ ] 6.1 Review every class and field in `api/models/human_input_v2.py` against the domain design, record any invariant mismatch in the nearest model docstring, and remove persistence fields that would encode workspace-relative projections or duplicate domain concepts.
- [ ] 6.2 Add red-first mapping tests for Contact, IM Integration, IM identity/binding, sync run/result, approver grant, delivery endpoint, OTP challenge, submission, and authorization audit structured values.
- [ ] 6.3 Implement explicit domain-to-record and record-to-domain mappers under `api/repositories/human_input_v2/`; do not return ORM instances from repository ports.
- [ ] 6.4 Add an Alembic migration for the reviewed Human Input v2 tables, indexes, checks, unique constraints, structured JSON columns, and logical-reference comments, preserving existing Human Input v1 schema and routes.
- [ ] 6.5 Add migration/model metadata tests that verify all new ORM tables are registered, structured Pydantic JSON columns round-trip, and downgrade removes only Human Input v2 objects introduced by this change.
- [ ] 6.6 Resolve and document the stable lock owner used to serialize EE Organization Contact uniqueness when `tenant_id IS NULL`, then encode the decision in the Contact persistence adapter tests and implementation.

## 7. Implement Aggregate-Oriented SQLAlchemy Adapters

- [ ] 7.1 Add repository contract tests for tenant/Organization-scoped Contact snapshots, External Contact admission, Platform allow-list mutations, hard deletion, and rollback on invariant failure.
- [ ] 7.2 Implement the SQLAlchemy Contact directory adapter with explicit owner predicates, eager loading, stable locking, and domain mapping.
- [ ] 7.3 Add repository contract tests for atomic OTP replacement under one form/grant scope, send/attempt counters, stale email invalidation, and rollback on hash or audit write failure.
- [ ] 7.4 Implement the SQLAlchemy OTP proof-session adapter using a grant-scoped lock so only one pending challenge remains usable.
- [ ] 7.5 Add repository contract tests for authorized submission transactionality: authorization audit, unique submission insert, form status transition, full rollback, and no resume dispatch before commit.
- [ ] 7.6 Implement the SQLAlchemy approval adapter with one atomic `commit_authorized_submission_once` operation and stable translation of unique-conflict races into the already-completed domain result.
- [ ] 7.7 Add repository contract tests for IM Integration CAS, configuration revision capture, provider replacement cleanup, credential rotation preservation, and revision-guarded sync reconciliation.
- [ ] 7.8 Implement the SQLAlchemy IM adapter and ensure stale reconciliation can append diagnostic results without mutating current identities or bindings.
- [ ] 7.9 Add query-count and eager-loading assertions for aggregate loads so logical relationships with `lazy="raise"` cannot trigger hidden N+1 queries in application services.

## 8. Verify Concurrency, Compatibility, And Handoff

- [ ] 8.1 Add CI-only PostgreSQL integration coverage for concurrent Email/IM submission and prove exactly one submission, one authorized audit event, and one form transition commit.
- [ ] 8.2 Add CI-only PostgreSQL integration coverage for concurrent OTP resend and prove exactly one replacement challenge remains usable.
- [ ] 8.3 Add CI-only PostgreSQL integration coverage for concurrent IM Integration CAS writes and stale sync reconciliation.
- [ ] 8.4 Add CI-only PostgreSQL integration coverage for EE Organization Contact uniqueness with nullable tenant ownership and the selected stable lock strategy.
- [ ] 8.5 Run targeted Human Input v2 domain, mapper, repository, migration, and existing Human Input v1 regression tests; document any CI-only suites that cannot run locally.
- [ ] 8.6 Run backend formatting, linting, and type checking, then remove compatibility shims that are no longer referenced while preserving existing API stub imports.
- [ ] 8.7 Re-read and update all affected module, class, and method docstrings so they describe final responsibilities, invariants, transaction boundaries, raised domain errors, and excluded concerns.
- [ ] 8.8 Verify no controller stub, provider adapter, Celery task, EE protobuf, or node-data migration implementation entered this change, and record discovered follow-up work in the appropriate downstream OpenSpec change.
- [ ] 8.9 Validate `implement-human-input-v2-domain-core` with OpenSpec and confirm every requirement scenario is mapped to at least one domain, repository, or PostgreSQL integration test.
