## 1. Dependency And Contract Baseline

- [ ] 1.1 Verify that the `OrganizationContactProjectionService.ensure_current(scope)` slice owned by `human-input-v2-api-contracts` has landed with bounded, idempotent and reconciliation-protected write semantics; stop implementation rather than adding an IM-owned backfill if it is absent.
- [ ] 1.2 Re-read `controllers/API_SCHEMA_GUIDE.md`, the canonical Channels generated contracts, and the archived `implement-im-contact-sync-api` ownership boundaries before changing API schemas or controllers.
- [ ] 1.3 Record the shared frontend ownership boundary with `implement-saas-slack-oauth`: this change owns base production Channels/Sync repositories, while OAuth extends only Channels operations and lifecycle state.
- [ ] 1.4 Add red-first backend tests for directory-sync capability projection, persisted Slack connectivity, server-side sync eligibility, projection-before-dispatch ordering and default worker queue coverage.
- [ ] 1.5 Add red-first frontend tests for generated DTO mapping, production composition selection, latest-only polling, canonical result variants, bucket pagination and secret absence.

## 2. Channel Capability And Slack Connectivity

- [ ] 2.1 Extend `ChannelCapability` and Channel response contracts with `directory_sync`, keeping it independent from persisted connection status.
- [ ] 2.2 Advertise `directory_sync` only from the complete Slack management handler in the initial release; keep Resend, Feishu and DingTalk ineligible until their end-to-end paths are complete.
- [ ] 2.3 Extend the confirmed IM configuration result with credential-free validation metadata and apply a trusted connected diagnostic to new and rotated Slack Integrations before configuration persistence.
- [ ] 2.4 Preserve standalone candidate-test non-persistence and prove failed save validation does not mutate credentials, diagnostics, revision, identities or bindings.
- [ ] 2.5 Add domain, manager, repository and controller tests covering new Slack save, same-tenant credential rotation, provider replacement, stale CAS and returned safe channel views.

## 3. Manual Sync Application Orchestration

- [ ] 3.1 Add `ManualIMSyncApplicationService` over the existing Contact projection and `IMSyncService` ports without importing Flask, ORM models or Celery types into the application boundary.
- [ ] 3.2 Ensure current Organization Contacts before create-or-get-active run, commit projection work before dispatch, and translate bounded projection failure to a stable retryable application error.
- [ ] 3.3 Add server-side create eligibility validation for connected Integration status and server-declared provider directory capability, returning `im_sync_not_allowed` before run creation or provider I/O.
- [ ] 3.4 Wire `WorkspaceIMSyncRunsApi` and production composition to the new manual-sync facade while leaving latest-run, latest-results and identity reads on their existing query services.
- [ ] 3.5 Add service and controller tests for trusted Workspace scope, ensure-before-dispatch ordering, projection failure, absent Integration, ineligible status/provider, existing queued/running run reuse, queued recovery dispatch and stable error mapping.

## 4. Worker Queue Readiness

- [ ] 4.1 Add `human_input_contact_sync` to both Cloud and self-hosted default worker queue lists in `api/docker/entrypoint.sh`.
- [ ] 4.2 Update `docker/.env.example` and repository-owned deployment guidance so custom `CELERY_QUEUES` and `CELERY_WORKER_QUEUES` examples include the sync queue when manual IM Contact sync is enabled.
- [ ] 4.3 Add configuration regression tests that assert task routing, both default queue lists and custom queue examples stay aligned.
- [ ] 4.4 Preserve stable run-ID idempotency and add worker tests proving terminal redelivery short-circuits while queued recovery never creates a second logical run.

## 5. API Contract Generation

- [ ] 5.1 Add or update Pydantic response/error models for `directory_sync`, `im_sync_not_allowed` and Contact projection unavailability without exposing credentials, provider payloads, queue details or lock details.
- [ ] 5.2 Regenerate OpenAPI and `packages/contracts/generated` Console bindings through the repository-owned generation workflow; do not hand-edit generated TypeScript.
- [ ] 5.3 Add generated-schema contract tests for Channel capabilities, sync lifecycle statuses, all five result variants, required result bucket and `page / limit / total` metadata.
- [ ] 5.4 Confirm the production design uses canonical Channels and latest sync routes and does not complete or depend on the legacy `im-integration` 501 handlers.

## 6. Frontend Production Repository Boundary

- [ ] 6.1 Split the frontend data boundary into `ContactChannelsRepository` and `ContactImSyncRepository`, and update query keys/contexts without changing component ownership outside `web/features/contacts/im-platform/`.
- [ ] 6.2 Replace mock-only provider aliases and sync types with canonical generated provider values, `queued / running / succeeded / failed`, and `added / not_matched / failed / removed / skipped` presentation models.
- [ ] 6.3 Implement `ConsoleContactChannelsRepository` with generated collection/read/test/save/delete bindings, complete CAS propagation, Resend mapping, Slack safe summaries and classified unavailable-provider failures.
- [ ] 6.4 Implement the complete self-managed Slack form mapping for `client_id`, `client_secret`, `signing_secret`, `bot_token` and `app_token`, including server-supported preserve directives and no masked-value submission.
- [ ] 6.5 Implement `ConsoleContactImSyncRepository` with generated create, latest-run and required-bucket latest-results bindings plus stable empty/error translation.
- [ ] 6.6 Add `ContactsImPlatformProductionProvider` to the account-settings composition root, retaining mock providers only for tests, Stories and explicit development fixtures.
- [ ] 6.7 Keep Cloud new-connect rollout disabled until server-owned OAuth auth mode/availability is available, while allowing the shared sync repository to consume an already authoritative connected channel.

## 7. Latest-Only Sync UI

- [ ] 7.1 Refactor React Query hooks to restore and poll only the latest run, stop at every terminal status, prevent duplicate local triggers and refetch latest before retrying an ambiguous create failure.
- [ ] 7.2 Update the sync summary to omit `started_by`, derive duration only from trusted timestamps, and derive partial-success attention only from non-zero `not_matched` or item-level `failed` counts.
- [ ] 7.3 Update sync details to render all canonical result variants, including added Contact/entry snapshots and removed last-known identity/removal reason, without guessing missing data.
- [ ] 7.4 Replace cursor and `All` result loading with one required bucket and `page / limit / total`; retain prior pages on later-page failure and reset pagination on bucket changes.
- [ ] 7.5 Keep `sync_run_id` only as latest-dialog URL identity, detect mismatch with the authoritative latest ID, clear stale state and explain that historical details are unavailable.
- [ ] 7.6 Map permission, not-allowed, stale revision, projection/dispatch unavailable, no-run and page-load errors to distinct safe UI states while preserving the last completed summary.
- [ ] 7.7 Update `en-US` and `zh-Hans` Contacts copy for canonical buckets, latest-only stale context, safe retry states and complete self-managed Slack fields; keep all other locales on the established fallback policy.
- [ ] 7.8 Add security regression tests proving credentials, masked placeholders, raw provider errors and internal infrastructure details never enter DOM output, query cache snapshots, logs or telemetry.

## 8. End-To-End Verification And Rollout

- [ ] 8.1 Add PostgreSQL/Redis container integration with an injected complete-directory adapter covering authenticated HTTP trigger, Contact ensure, durable dispatch, worker terminal persistence, result counts, latest summary and paginated bucket reads.
- [ ] 8.2 Add a browser-level controlled-backend scenario covering connected Slack view, manual trigger, queued/running polling, terminal attention state and latest result details through generated clients.
- [ ] 8.3 Run focused backend unit suites through `uv run --project api`, frontend Vitest/React Testing Library suites, generated-contract checks, scoped lint/type checks and the repository formatter; enforce at least 85% aggregate unit-test line coverage across production modules added or changed by this change, require the CI-owned PostgreSQL/Redis container suite to enforce at least 80% aggregate integration-test line coverage across backend production modules added or changed by this change, and resolve all failures introduced by this change.
- [ ] 8.4 Keep real Slack coverage opt-in and add a staging smoke checklist for required `chat:write`, `users:read` and `users:read.email` scopes, multi-page directory read and credential-free diagnostics.
- [ ] 8.5 Audit the final diff to prove production composition makes no mock requests, no history endpoint was added, Contact lifecycle was not duplicated in IM code, default workers consume the dedicated queue, and only Slack passes the initial provider release gate.
- [ ] 8.6 Enable the Community slice behind the existing rollout gate, observe queue age/run duration/result/error metrics, and leave Cloud new-connect plus Enterprise management disabled until their owning changes are complete.
