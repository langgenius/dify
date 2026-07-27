## 1. Complete Shared DTO And Application Boundaries

- [ ] 1.1 Complete the shared Pydantic request and response models for owner/admin Contact management, editor-safe Contact options, IM management projections, public OTP submit, authenticated Contact submit, trusted Service API submit, draft message testing, and Email provider configuration.
- [ ] 1.2 Reuse existing enums where semantics already match, including `DebugChannel`, `FormInputConfig`, `UserActionConfig`, and `HumanInputFormStatus`, instead of adding duplicate transport enums.
- [x] 1.3 Add Pydantic batch request and response models plus a stable node-scoped blocker taxonomy for the side-effect-free Human Input v1 to v2 node-data migration helper; default a missing legacy `version` to the string `"1"` and reject every other explicit version.
- [ ] 1.4 Document the migration ownership split so the backend remains an all-or-error converter and validator; explicitly retain `whole_workspace: true` as the only sanctioned lossy snapshot conversion.
- [ ] 1.5 Write red-first service-boundary tests for transport-to-command mapping, owner-scoped references, transaction ownership, typed error translation, and the prohibition on Flask/controller imports from Human Input v2 application services.
- [ ] 1.6 Add explicit Human Input v2 application service factories and composition roots that inject sessions, repositories, provider clients, clocks, hashers, and edition adapters without letting controllers coordinate repositories directly.

## 2. Wire Workspace Contact And Provider Configuration APIs

- [ ] 2.1 Write red-first application service tests for admin Contact list/detail, editor-safe option list/batch, admin batch reads, pagination, keyword search, `WORKSPACE / PLATFORM / EXTERNAL` projection, and `ABSENT` omit/404 behavior.
- [ ] 2.2 Implement a `ContactManagementService` that resolves deployment/Organization scope, loads coherent Contact Directory snapshots, and returns transport-neutral management and editor projections without leaking ORM records.
- [ ] 2.3 Replace the Contact list/detail/options/batch 501 handlers in `api/controllers/console/workspace/human_input.py` with thin service-backed handlers and stable domain-error-to-HTTP mapping.
- [ ] 2.4 Write red-first service tests for EE Platform candidate/add, External Contact create/update, merged Platform/External removal, normalized-email conflicts, workspace-contact removal rejection, and CE/SaaS edition-not-supported behavior.
- [ ] 2.5 Implement Contact mutation application services and wire the Platform, External, and merged removal handlers while preserving owner/admin authorization and complete owner predicates.
- [ ] 2.6 Write red-first tests for Email provider read/update, secret preserve-or-replace behavior, sender validation, connection diagnostics, response redaction, and tenant/Organization scope.
- [ ] 2.7 Implement `EmailProviderManagementService` over the existing provider configuration persistence boundary and replace the Email provider 501 handlers without logging or returning secret material.
- [ ] 2.8 Add controller tests for permissions, request validation, response DTOs, 204 empty-body behavior, not-found/conflict/error mapping, and proof that all Contact and Email provider routes in scope no longer return the generic stub response.

## 3. Integrate IM Management Wiring Without Duplicating Its Owner Change

- [ ] 3.1 Complete `implement-im-contact-sync-api` as the implementation owner for CE/SaaS provider adapters, `IMSyncManagementService`, `ContactIMBindingService`, the manual-sync worker, and the IM-related workspace handlers.
- [ ] 3.2 Align the landed IM handlers with this change's canonical DTO contract: `integration_id + config_version` CAS, latest-only reads, `page / limit / total`, one real result bucket, `finished_at`, provider-user-ID search, and stable error mapping.
- [ ] 3.3 Add cross-change contract tests proving the IM controllers contain no provider-specific branches, unmatched results never create Contacts, invalid Contact types cannot receive bindings, and effective resolution remains `workspace override > organization binding > Email fallback`.
- [ ] 3.4 Audit the shared workspace controller after the IM change lands and remove only the IM 501 stubs owned by that change; do not recreate reconciliation, provider SDK, worker, or repository orchestration in this umbrella change.

## 4. Wire Draft Debug And Node-Data Migration APIs

- [ ] 4.1 Write red-first migration service tests for ordered batch conversion, duplicate node IDs, explicit non-v1 versions, request-scoped tenant snapshots, `whole_workspace` expansion, deterministic retries, multiple node-scoped blockers, and all-or-error results without persistence.
- [ ] 4.2 Implement a side-effect-free `HumanInputNodeDataMigrationService` over the existing recipient-resolution and node conversion boundaries, then replace the workspace node-data-migration 501 handler.
- [ ] 4.3 Write red-first tests for v2 message-template rendering, `DebugChannel` selection, current-editor recipient resolution, provider failure mapping, send logging/rate-limit hooks, and v1 `delivery-test` compatibility.
- [ ] 4.4 Implement `MessageTemplateTestService` over the existing delivery-provider boundary and replace the draft v2 message-template/test 501 handlers without aliasing the v1 request contract.
- [ ] 4.5 Add version-dispatch tests and implementation for draft form preview/run so v1 and v2 node payloads use independent logic and cannot be cross-submitted.

## 5. Wire Runtime Form APIs

- [ ] 5.1 Write red-first application service tests for v2 endpoint-token lookup, v1/v2 token isolation, frozen form-definition projection, task lifecycle states, and owner-scoped upload capabilities.
- [ ] 5.2 Implement the public Email form read service and wire `GET /api/form/human-input/<form_token>` without treating token-based read as submit authorization.
- [ ] 5.3 Implement public Email access-request, upload-token, and OTP-guarded submit services over the existing OTP, form, and submission repositories; preserve submit-time identity revalidation and atomic first-success-wins behavior.
- [ ] 5.4 Implement the authenticated Contact form read/submit service and console handlers using Dify session proof, current Contact-backed grant resolution, and rejection of public OTP fields or Email-proof tokens.
- [ ] 5.5 Implement the trusted Service API v2 form GET/POST handlers with explicit `user` on both surfaces, request-scoped `end_user` materialization, and rejection of public OTP proof fields.
- [ ] 5.6 Add controller and service tests for public Email, authenticated Contact, and Service API success/error paths, stale OTP after identity changes, expired/submitted forms, cross-surface proof rejection, cross-version tokens, and rollback on audit/submission failure.
- [ ] 5.7 Preserve all existing underscored v1 routes, request models, token lookup, delivery-test behavior, and regression coverage while landing the independent hyphenated v2 controllers.

## 6. Wire The EE Workspace Adapter

- [ ] 6.1 Complete `implement-ee-human-input-admin-api` as the implementation owner for the Enterprise Human Input admin Protobuf/HTTP service, Organization Contact projection, IM control-plane, and Organization binding persistence.
- [ ] 6.2 Add a narrow Dify-side enterprise Human Input admin client interface and adapter for Organization Contact, IM integration, manual sync, identity search, and Organization binding operations; keep provider and Go business types behind the client boundary.
- [ ] 6.3 Implement edition-aware application service routing so CE/SaaS uses local Python services while EE Organization-level operations call the enterprise control-plane; keep Platform/External Contact lifecycle, workspace override, migration, and Email provider local to Dify.
- [ ] 6.4 Wire EE workspace console handlers through the edition router, including stable unavailable/timeout/error translation and no fallback to direct writes against deployment-wide rows.
- [ ] 6.5 Add cross-repository contract tests for Protobuf field/enum/HTTP-path compatibility, CAS tokens, latest-only result pagination, Contact/binding ownership, workspace-local override behavior, and failure when the EE control-plane is unavailable.

## 7. Verify, Document, And Remove Stubs

- [ ] 7.1 Update generated or manual API documentation so v2 examples use `human-input` paths and `form` nouns while v1 examples retain existing `human_input` paths; keep the root API summary aligned with landed Flask and enterprise contracts.
- [ ] 7.2 Run targeted service and controller unit suites for Contact, Email provider, migration, draft debug, runtime form, IM integration, and edition routing; record the reproducible commands and measured coverage for new modules.
- [ ] 7.3 Add CI-only integration coverage for transaction/concurrency boundaries, provider/worker integration, and Dify-to-enterprise contract behavior that cannot run in the local environment.
- [ ] 7.4 Run backend formatting, linting, and type checking for affected Python files and resolve all introduced issues without weakening types or adding `Any`-based transport glue.
- [ ] 7.5 Audit all Human Input v2 routes in scope and prove none returns the generic HTTP 501 stub response; document any deliberately deferred route with its owning change instead of silently leaving a stub.
- [ ] 7.6 Validate `human-input-v2-api-contracts`, `implement-im-contact-sync-api`, and `implement-ee-human-input-admin-api`; re-read their proposal/design/spec/task ownership boundaries before implementation review.
