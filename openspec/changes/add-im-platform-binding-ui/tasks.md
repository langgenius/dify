## 1. Frontend Scope and Design Baseline

- [x] 1.1 Identify the CE / SaaS workspace-management mount point and existing enterprise-plan guard for Contacts, define the Organization context contract, and verify that no entry is added under `web/features/agent-v2/roster/`.
- [x] 1.2 Inspect the six referenced Figma nodes with authorized access and record a frontend acceptance matrix for layout, overlay type, fields, statuses, table columns, responsive behavior, and visible copy.
- [x] 1.3 Define the existing product feature gate used to expose the mock-backed Contacts IM platform entry and its rollback behavior.

## 2. Typed Mock Data Boundary

- [ ] 2.1 Update repository tests for one active IM Channel plus Email, ID-addressed replacement, opaque config versions, deterministic state transitions, summary/detail count agreement, and secret sanitization.
- [ ] 2.2 Align Contacts-owned view models and commands with `ChannelSummary`、the grouped available-provider catalog、complete credential mutations、sync runs and sync items。
- [ ] 2.3 Replace unavailable-provider and six-state fixtures with catalog omission plus `connected`、`invalid_credentials` and `connection_failure` scenarios；derive not-configured UI from collection absence。
- [ ] 2.4 Update the in-memory repository so every save/test requires complete configuration and immediately discards secret input without retaining a secret marker or secret value。
- [ ] 2.5 Update React Query hooks so create/update/replacement consume the returned summary directly、test remains non-persistent and no backend or provider network requests are made。

## 3. IM Platform Binding UI

- [ ] 3.1 Update component tests for the non-enterprise Contacts entry、enterprise-plan exclusion、CE / SaaS permission variants、initial loading/error/empty states、catalog omission and the canonical three configured status presentations。
- [x] 3.2 Implement the shared Contacts IM platform management surface, status summary, provider selection, diagnostics, recent-sync summary, and feature-gated mount points with `@langgenius/dify-ui/*` primitives.
- [ ] 3.3 Update component tests for complete credential and mock OAuth flows、required-field errors、pending-state duplicate prevention、mutation failure recovery、ID-addressed provider replacement confirmation and disconnect behavior。
- [ ] 3.4 Update the shared binding overlay and typed provider-specific form adapters to require all fields on Configure、consume mutation summaries and avoid a mandatory create-followed-by-list refresh。
- [ ] 3.5 Add security regression tests proving secrets and masked placeholders never appear in fixtures、DOM output、logs、snapshots or retained mutation payloads。

## 4. Manual Directory Sync and Details UI

- [x] 4.1 Write failing component and hook tests for sync eligibility, no-permission and unsupported-provider gates, duplicate-trigger prevention, active-run restoration, controlled polling, and polling termination at every terminal state.
- [x] 4.2 Implement the manual sync trigger, queued/running presentation, success/partial-success/failure summaries, latest completed result retention, and targeted query refresh behavior.
- [x] 4.3 Write failing component tests for `sync_run_id` URL restoration, result taxonomy and counts, missing-field placeholders, unmatched read-only behavior, filters, pagination, page retry, and sensitive-error sanitization.
- [x] 4.4 Implement the Figma-aligned sync details surface with run metadata, result summary, filter controls, incrementally loaded rows, per-item safe reasons, error recovery, and no Contact or IM Binding mutation actions.

## 5. Product Quality and Verification

- [x] 5.1 Add all user-facing copy to `web/i18n/en-US/` and `web/i18n/zh-Hans/`; per the confirmed implementation scope, other locales use the English Contacts namespace fallback.
- [x] 5.2 Match the authorized Figma acceptance matrix using dify-ui tokens, including loading and error states, responsive layouts, visible focus, keyboard submission, error associations, live status announcements, and focus restoration for overlays.
- [x] 5.3 Run the targeted Vitest / Testing Library suites and resolve all failures, including fake-timer cleanup and React Query cache isolation between scenarios.
- [x] 5.4 Run the repository-prescribed frontend formatting, lint, and type-check commands, then fix issues introduced by this change.
- [x] 5.5 Audit the final diff to confirm it changes only frontend and OpenSpec files, adds no backend/OpenAPI/generated-client/task-queue code, issues no real IM or backend requests, and leaves the future API repository adapter for a separate change.

## 6. Channels Increment

- [ ] 6.1 Align the Channels collection mock model with canonical `ChannelSummary`、one active IM binding plus Email and ID-addressed explicit IM replacement。
- [ ] 6.2 Update the Resend modal so sender email、sender name and API key are required for create、update and test；remove API-key retention and partial update behavior。
- [ ] 6.3 Render configured cards from safe `display_identifier`、carry opaque `config_version` through update/delete/replacement and consume the returned summary or deleted `channel_id` in focused tests。
- [x] 6.4 Add or update only `en-US` and `zh-Hans` translations, verify the four revised Figma nodes, run targeted Vitest plus scoped frontend checks, and audit that the increment remains frontend-only and mock-backed.
