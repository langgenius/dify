## 1. Implement Authorization Domain

- [x] 1.1 Add red-first tests keeping grant, endpoint, raw credential, verified proof, and submission actor distinct.
- [x] 1.2 Define verified Account session, trusted EndUser, Email OTP, and IM identity proof values plus Account, EndUser, and EmailAddress actors.
- [x] 1.3 Add failing authorization tests for each proof type, raw credential rejection, Contact-backed IM-to-Account actor resolution, and grant mismatch.
- [x] 1.4 Add failing stale-proof tests for deleted External Contact, disabled Account, same-Email recreation, changed Contact Email, removed workspace availability, and changed IM binding.
- [x] 1.5 Implement immutable `AuthorizationContext`, pure `SubmissionAuthorizer`, authorized submission values, and stable transport-neutral rejection taxonomy.
- [x] 1.6 Add tests proving identity changes after coherent context load do not trigger a second Contact/Binding version check.

## 2. Implement Atomic Submission Persistence

- [x] 2.1 Define submission ports for coherent tenant-scoped context load, rejection audit append, and atomic `commit_authorized_submission_once`.
- [x] 2.2 Review submission and authorization audit ORM records and align docstrings, constraints, structured values, indexes, and logical references.
- [x] 2.3 Add red-first mapper tests for verified proof snapshots, actors, submissions, canonical values, and authorization audit payloads.
- [x] 2.4 Implement explicit submission/audit mappers under `api/repositories/human_input_v2/submission/`.
- [x] 2.5 Add repository contract tests for Form row locking, coherent context load, audit plus unique submission plus transition commit, full rollback, and conflict translation.
- [x] 2.6 Implement the SQLAlchemy Submission adapter without Contact/Binding versions or ORM leakage.
- [x] 2.7 Add the Submission/Audit Alembic revision plus metadata, structured JSON, upgrade, and scoped downgrade tests.
- [x] 2.8 Add CI-only PostgreSQL coverage for concurrent Email/IM submission and post-context identity changes.

## 3. Implement Post-Commit Orchestration

- [x] 3.1 Define the submit application handler and idempotent workflow resume port.
- [x] 3.2 Add failing handler tests proving commit precedes enqueue, persistence failure prevents enqueue, enqueue failure preserves submission, identifiers are logged, and duplicate resume dispatch is safe.
- [x] 3.3 Implement submit orchestration with actionable tenant/form/workflow logging and no transactional outbox.

## 4. Validate And Handoff

- [x] 4.1 Run targeted authorization, mapper, repository, migration, handler, OTP/Form/IM/Contact regressions, and existing Human Input v1 tests; document CI-only coverage not runnable locally.
- [x] 4.2 Run targeted coverage for Submission Runtime modules and record the measured report.
- [x] 4.3 Run backend formatting, linting, and type checking for affected files.
- [x] 4.4 Verify no controller, provider adapter, Celery task, EE protobuf, outbox, Contact/Binding versioning, or v1 migration implementation entered this change.
- [x] 4.5 Re-read affected docstrings and validate `implement-human-input-v2-submission-runtime` with OpenSpec.
