## 1. Implement Form Aggregate Semantics

- [x] 1.1 Add red-first tests for grant, subject snapshot, endpoint, endpoint token, delivery attempt, frozen definition, and upload capability distinctions.
- [x] 1.2 Add failing tests for waiting, submitted, timed-out, status-expired, globally expired, invalid grant, and invalid selected-action transitions.
- [x] 1.3 Implement rich `HumanInputForm` lifecycle behavior and stable form-state results without a separate `FormLifecycle` object.
- [x] 1.4 Add failing tests for deterministic form creation from `ResolvedApprovalPlan`, one grant per canonical approver, multiple endpoints, and frozen matched-source snapshots.
- [x] 1.5 Implement form creation, `ApproverGrant`, endpoint plans, delivery facts, frozen definitions, and historical subject snapshots.
- [x] 1.6 Define operation-oriented Form ports for atomic creation, lifecycle load, delivery append, and dedicated read projections.

## 2. Align Form Persistence Records

- [x] 2.1 Review Email provider, form, grant, endpoint, delivery attempt, upload token/file ORM records and align docstrings, constraints, indexes, and logical-reference comments.
- [x] 2.2 Add red-first mapper tests for frozen definitions, matched sources, subject snapshots, endpoints, attempts, provider configuration, and upload values.
- [x] 2.3 Implement explicit form domain-to-record and record-to-domain mappers under `api/repositories/human_input_v2/form/`.
- [x] 2.4 Add repository contract tests for atomic form/grant/endpoint creation, rollback, append-only delivery facts, upload scoping, and read projections.
- [x] 2.5 Implement the SQLAlchemy Form adapter with operation-specific eager loading and no ORM leakage.
- [x] 2.6 Add query-count assertions proving `lazy="raise"` relationships cannot create hidden N+1 queries.
- [x] 2.7 Add the Form Core Alembic revision plus metadata, structured JSON, upgrade, and scoped downgrade tests.

## 3. Validate And Handoff

- [x] 3.1 Run targeted Form Core domain, mapper, repository, migration, recipient resolution, and Human Input v1 regression tests.
- [x] 3.2 Run targeted coverage for the new Form Core modules and record the measured report.
- [x] 3.3 Run backend formatting, linting, and type checking for affected files.
- [x] 3.4 Re-read affected docstrings and validate `implement-human-input-v2-form-core` with OpenSpec.
