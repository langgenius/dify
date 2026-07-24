## 1. Establish Contact Directory Boundaries

- [x] 1.1 Add `shared` and `contact_directory` package structure with module docstrings documenting dependency direction and excluded transport/persistence concerns.
- [x] 1.2 Add import-boundary tests proving Contact Directory modules do not import Flask, controllers, SQLAlchemy sessions, or `models.*`.
- [x] 1.3 Add red-first tests for typed IDs, `NormalizedEmail`, owner scopes, timestamps, equality, invalid values, and serialization boundaries.
- [x] 1.4 Implement the shared value objects needed by Contact Directory and keep compatibility re-exports from `core.human_input_v2.entities`.
- [x] 1.5 Define transport-neutral Contact rejection types and stable reason codes with focused tests.

## 2. Implement Contact Identity And Resolution

- [x] 2.1 Add failing tests for EE Organization Account, CE/SaaS workspace member, External Contact, invalid owner combinations, and immutable identity source.
- [x] 2.2 Implement `Contact`, owner references, Contact snapshots, and factories without persisting workspace-relative Contact type.
- [x] 2.3 Add table-driven failing tests for `WORKSPACE`, `PLATFORM`, `EXTERNAL`, and `ABSENT` resolution across membership and allow-list states.
- [x] 2.4 Implement `ContactDirectoryPolicy` and immutable request-scoped `ContactDirectorySnapshot`.
- [x] 2.5 Add failing tests for External Contact admission, normalized Email collisions, cross-Organization rejection, hard deletion, same-Email recreation, and disabled Account availability.
- [x] 2.6 Implement Contact admission and lifecycle policies while keeping membership lookup and persistence I/O outside domain entities.
- [x] 2.7 Define aggregate-oriented Contact Directory ports for coherent snapshot load, lifecycle mutation, Platform allow-list mutation, and hard deletion.

## 3. Implement Contact Persistence Slice

- [x] 3.1 Review Contact and Platform allow-list records in `api/models/human_input_v2.py`, update docstrings/constraints, and replace the IM Integration lock suggestion with the `DifySetup` lock invariant.
- [x] 3.2 Add red-first mapper tests for Contact values, identity source, owner references, normalized Email, and Platform entries.
- [x] 3.3 Implement explicit Contact domain-to-record and record-to-domain mappers under `api/repositories/human_input_v2/contact_directory/`.
- [x] 3.4 Add repository contract tests for owner-scoped snapshots, admission, Platform mutations, hard deletion, rollback, eager loading, and hidden-query prevention.
- [x] 3.5 Implement the SQLAlchemy Contact Directory adapter with complete owner predicates and shared `DifySetup` row locking for EE Organization/External Email claims.
- [x] 3.6 Add the Contact/Platform Alembic revision plus metadata, structured-value, upgrade, and scoped downgrade tests.
- [x] 3.7 Add CI-only PostgreSQL coverage for concurrent EE Organization writes and Organization/External Email claims using the stable setup-row lock.

## 4. Validate And Handoff

- [x] 4.1 Run targeted Contact Directory domain, mapper, repository, migration, and existing Human Input v1 regression tests; document CI-only coverage not runnable locally.
- [x] 4.2 Run targeted coverage for the new Contact Directory modules and record the measured report.
- [x] 4.3 Run backend formatting, linting, and type checking for affected files.
- [x] 4.4 Re-read affected docstrings and validate `implement-human-input-v2-contact-directory` with OpenSpec.
