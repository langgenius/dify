## 1. Frontend Scope and Design Baseline

- [x] 1.1 Identify the CE / SaaS workspace-management mount point and existing enterprise-plan guard for Contacts, define the Organization context contract, and verify that no entry is added under `web/features/agent-v2/roster/`.
- [x] 1.2 Inspect the six referenced Figma nodes with authorized access and record a frontend acceptance matrix for layout, overlay type, fields, statuses, table columns, responsive behavior, and visible copy.
- [x] 1.3 Define the existing product feature gate used to expose the mock-backed Contacts IM platform entry and its rollback behavior.

## 2. Typed Mock Data Boundary

- [ ] 2.1 Write failing unit tests for repository scenario consistency, single-active-provider behavior, deterministic state transitions, summary/detail count agreement, and secret sanitization.
- [ ] 2.2 Add Contacts-owned TypeScript view models, command types, repository interface, query keys, and typed result taxonomy for integration, provider definitions, sync runs, and sync items.
- [ ] 2.3 Implement named deterministic mock scenarios covering loading, load failure, no permission, provider unavailable, all six connection states, mutation failures, active sync, success, partial success, failure, detail failure, and paginated results.
- [ ] 2.4 Implement the in-memory mock repository so mutations update only mock state, queued/running transitions are controllable with fake timers or explicit advancement, and secret input is discarded after recording configuration state.
- [ ] 2.5 Add a feature composition boundary and React Query hooks that inject the repository, invalidate precise query keys after mutations, and make no backend or provider network requests.

## 3. IM Platform Binding UI

- [ ] 3.1 Write failing component tests for the non-enterprise Contacts entry, enterprise-plan exclusion, CE / SaaS permission variants, initial loading/error/empty states, provider availability, and the six connection-status presentations.
- [ ] 3.2 Implement the shared Contacts IM platform management surface, status summary, provider selection, diagnostics, recent-sync summary, and feature-gated mount points with `@langgenius/dify-ui/*` primitives.
- [ ] 3.3 Write failing component tests for credential and mock OAuth flows, required-field errors, pending-state duplicate prevention, mutation failure recovery, provider replacement confirmation, and disconnect behavior.
- [ ] 3.4 Implement the shared binding overlay and typed provider-specific form adapters, including mock authorization recovery, callback copy interaction, replacement/disconnect confirmation, and repository refresh after mutations.
- [ ] 3.5 Write and satisfy security regression tests proving that configured secrets are represented only by a boolean/state marker and never appear in fixtures, DOM output, logs, snapshots, or retained mutation payloads.

## 4. Manual Directory Sync and Details UI

- [ ] 4.1 Write failing component and hook tests for sync eligibility, no-permission and unsupported-provider gates, duplicate-trigger prevention, active-run restoration, controlled polling, and polling termination at every terminal state.
- [ ] 4.2 Implement the manual sync trigger, queued/running presentation, success/partial-success/failure summaries, latest completed result retention, and targeted query refresh behavior.
- [ ] 4.3 Write failing component tests for `sync_run_id` URL restoration, result taxonomy and counts, missing-field placeholders, unmatched read-only behavior, filters, pagination, page retry, and sensitive-error sanitization.
- [ ] 4.4 Implement the Figma-aligned sync details surface with run metadata, result summary, filter controls, incrementally loaded rows, per-item safe reasons, error recovery, and no Contact or IM Binding mutation actions.

## 5. Product Quality and Verification

- [ ] 5.1 Add all user-facing copy to `web/i18n/en-US/` and update every supported locale with correct localized values.
- [ ] 5.2 Match the authorized Figma acceptance matrix using dify-ui tokens, including loading and error states, responsive layouts, visible focus, keyboard submission, error associations, live status announcements, and focus restoration for overlays.
- [ ] 5.3 Run the targeted Vitest / Testing Library suites and resolve all failures, including fake-timer cleanup and React Query cache isolation between scenarios.
- [ ] 5.4 Run the repository-prescribed frontend formatting, lint, and type-check commands, then fix issues introduced by this change.
- [ ] 5.5 Audit the final diff to confirm it changes only frontend and OpenSpec files, adds no backend/OpenAPI/generated-client/task-queue code, issues no real IM or backend requests, and leaves the future API repository adapter for a separate change.
