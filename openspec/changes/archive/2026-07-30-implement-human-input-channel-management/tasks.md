## 1. Establish Common Channel Management Contracts

- [x] 1.1 Add `api/core/human_input_v2/channel_management/` with import-boundary tests proving common contracts do not import controllers, provider clients, SQLAlchemy or ORM records.
- [x] 1.2 Add red-first tests for channel/provider discriminators, trusted management context, safe `ChannelView`, capability sets and safe common failure envelopes.
- [x] 1.3 Implement common channel kinds, providers, scope projections, capabilities, discriminated commands and safe results.
- [x] 1.4 Define a one-ref-per-handler protocol and registry keyed by complete channel/provider references, with duplicate-registration and unsupported-channel tests.

## 2. Implement Channel Management Facade

- [x] 2.1 Add deterministic per-ref Email and IM handler fakes for facade tests without database, Flask or network access.
- [x] 2.2 Add red-first tests for combined Email/IM listing, safe single-channel lookup, handler dispatch and unsupported channel/operation rejection.
- [x] 2.3 Add red-first tests proving one Email configuration and one active IM integration coexist while mutations remain isolated by channel.
- [x] 2.4 Add red-first tests for trusted scope propagation, safe failure mapping, credential-free logs/results and one safe list result per registered ref.
- [x] 2.5 Implement `HumanInputChannelManagementService` and handler orchestration until the focused facade suite passes.

## 3. Adapt Existing IM Control Plane

- [x] 3.1 Define per-provider IM channel adapter mapping between common commands/views and existing IM Control Plane application ports without importing IM ORM records.
- [x] 3.2 Add contract tests proving credential rotation, provider replacement, complete CAS rejection and delete effects remain owned by the IM aggregate.
- [x] 3.3 Add tests proving Email is excluded from the active IM integration limit and IM mutations cannot change Email state.
- [x] 3.4 Add capability-mapping tests for provider replacement and absence of unimplemented IM secret retention.
- [x] 3.5 Implement independently registered IM provider handlers with shared Control Plane dependencies and safe error/status mapping, without introducing a second IM repository or synchronization engine.

## 4. Establish Resend Email Channel Domain And Service

- [x] 4.1 Add `api/core/human_input_v2/email_channel/` with import-boundary tests proving Email management does not import controllers, concrete Resend clients, SQLAlchemy, ORM records or system mail.
- [x] 4.2 Add red-first tests for Resend-only candidates, normalized sender values, safe projections, protected credential values and internal `configuration_id + updated_at` snapshots.
- [x] 4.3 Implement Email candidate commands, safe projections and typed conflict, stale-configuration, validation and not-configured results.
- [x] 4.4 Define provider-validation and credential-protection ports with deterministic fakes covering classified and unexpected failures.
- [x] 4.5 Add red-first Email handler tests proving save validates before persistence, never sends a test message and preserves current configuration on failure.
- [x] 4.6 Add red-first tests proving Test connection uses candidate settings, targets only the authenticated operator email, never persists and never falls back to system mail.
- [x] 4.7 Add red-first tests for explicit retained-key validation, successful protected replacement and credential absence from logs, exceptions and results.
- [x] 4.8 Implement the Resend Email channel handler, map persisted safe state into `ChannelView` and map candidate tests into `ChannelTestResult`.

## 5. Implement Email Channel Persistence

- [x] 5.1 Move Email provider mapping ownership from the form persistence slice to `api/repositories/human_input_v2/email_channel/`, with red-first bidirectional mapper tests and temporary compatibility imports.
- [x] 5.2 Add repository contract tests for safe load, cross-tenant isolation, serialized first creation, unique-conflict normalization, conditional update, delete, recreated-row identity rejection, rollback and no live ORM leakage.
- [x] 5.3 Add tests proving every successful update advances `updated_at` strictly, including equal or earlier application-clock inputs.
- [x] 5.4 Implement the SQLAlchemy Email repository with stable Tenant-row locking for first creation, `id + updated_at` conditional updates and row-locked delete operations.
- [x] 5.5 Add query-count assertions proving operation-specific loads do not introduce hidden lazy loading or N+1 behavior.
- [x] 5.6 Add CI-only PostgreSQL tests for concurrent first creation, concurrent conditional updates, update-versus-delete races and delete/recreate identity protection.
- [x] 5.7 Implement tenant-scoped credential protection through the existing Dify encryption boundary, with round-trip, wrong-tenant and sanitized-failure tests.

## 6. Validate And Handoff

- [x] 6.1 Record future-facing controller rewiring as follow-up change `implement-human-input-channel-management-api` and preserve compatibility imports until that change lands.
- [x] 6.2 Audit the implementation to confirm no schema migration, generic Channel repository, concrete provider client, frontend, controller or runtime delivery change entered this change.
- [x] 6.3 Run focused common-channel, Email domain/handler, Email repository, encryption and IM delegation tests; document PostgreSQL suites that remain CI-only.
- [x] 6.4 Run backend formatting, linting and type checking for every affected file and resolve introduced failures.
- [x] 6.5 Re-read public results and module docstrings for scope ambiguity, credential leakage and accidental IM invariant duplication.
- [x] 6.6 Validate `implement-human-input-channel-management` with strict OpenSpec validation and record final evidence.
