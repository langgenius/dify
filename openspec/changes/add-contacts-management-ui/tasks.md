## 1. Design Baseline and Frontend Boundaries

- [x] 1.1 Inspect all twelve referenced Figma nodes with authorized access and record an acceptance matrix for surfaces, fields, columns, actions, copy, responsive behavior, and the EE removal-retention default.
- [x] 1.2 Identify the Contacts route and CE / SaaS versus EE mount points, define the shared deployment and permission context, and confirm the UI remains separate from Agent Roster and workspace Members.
- [x] 1.3 Define the feature gate and composition boundary that enables mock-backed Contacts without changing the existing production member removal path when the gate is off.
- [x] 1.4 Map shared shell integration with `add-im-platform-binding-ui` so directory UI and IM integration UI reuse navigation context without sharing repository state.

## 2. Typed Mock Repository

- [x] 2.1 Write failing unit tests for Contact discriminated unions, scenario consistency, pagination deduplication, External contact conflict classification, and member-removal state transitions.
- [x] 2.2 Add Contacts-owned TypeScript view models, query types, command types, typed mutation results, repository interface, and query keys for directory, details, Organization candidates, External contacts, and member removal.
- [x] 2.3 Add deterministic named scenarios covering CE, SaaS, EE, all permission levels, empty and paginated directories, load failures, three Contact types, External contact conflicts, Organization search, and every removal outcome.
- [x] 2.4 Implement the in-memory mock repository with controllable delays, stable identifiers, lower-case full-Email matching, consistent list/detail state, and no random behavior.
- [x] 2.5 Add the feature provider and React Query hooks that inject the repository, preserve precise cache boundaries, and issue no backend, generated-client, or Organization directory requests.

## 3. Contacts Directory and EE Platform Contacts

- [x] 3.1 Write failing component tests for route visibility, view/manage permission variants, loading/error/empty/no-result states, the three Contact types, and CE / SaaS versus EE directory semantics.
- [x] 3.2 Implement the Figma-aligned Contacts page shell, list rows, type and status presentation, search, filters, pagination or incremental loading, retries, and URL-backed browsing context.
- [x] 3.3 Write failing tests for EE Organization candidate search, existing-Contact exclusion, multi-select, pending duplicate prevention, success, and recoverable failure.
- [x] 3.4 Implement the EE-only Organization picker and mock add-Platform-contact flow while keeping enterprise-wide candidates out of the normal Contacts list.

## 4. Contact Details

- [x] 4.1 Write failing component tests for `contact_id` restoration, common identity fields, workspace/platform/external type-specific sections, read-only permissions, missing values, load failure, and not-found states.
- [x] 4.2 Implement the Figma-aligned Contact detail page, drawer, or dialog selected by the acceptance matrix, including safe channel summaries and no out-of-scope management actions.
- [x] 4.3 Add tests and implementation for preserving list search/filter/pagination on return, refreshing list/detail together after mutations, and converting an EE removed member from workspace contact to Platform contact without changing its stable identity.

## 5. External Contact Creation

- [x] 5.1 Write failing component tests for entry permissions, required fields, Email format, duplicate External contact, workspace-contact match, Platform-contact match, pending state, mutation failure, success, cancel, and focus restoration.
- [x] 5.2 Implement the Figma-aligned External contact creation surface with local typed form state, accessible validation, conflict-specific feedback, duplicate-submit prevention, and mock repository submission.
- [x] 5.3 Implement success handling that refreshes the active directory query, clears the draft, and follows the acceptance matrix for closing the overlay or opening the new Contact detail.

## 6. Member Removal Contact Retention

- [x] 6.1 Write failing tests for protected members, pending invitation cancellation, CE / SaaS Contact removal warnings, both EE retention choices, duplicate confirmation prevention, failure recovery, and feature-gate fallback.
- [x] 6.2 Replace or extend the active-member confirmation path with one Contacts-aware dify-ui dialog while preserving the existing simple cancellation flow for pending invitations.
- [x] 6.3 Implement mock removal commands and targeted cache refresh so CE / SaaS removes the Contact, EE either removes or converts it to Platform contact, and failures leave member and Contact views unchanged.
- [x] 6.4 Add a regression test proving the mock-enabled path never calls `deleteMemberOrCancelInvitation` or any real member / Contact endpoint.

## 7. Product Quality and Verification

- [x] 7.1 Add all Contacts user-facing copy to `web/i18n/en-US/` and `web/i18n/zh-Hans/`; keep the existing English fallback for other locales.
- [x] 7.2 Match the Figma acceptance matrix using dify-ui tokens and primitives, including narrow layouts, empty/error states, keyboard navigation, visible focus, field error associations, live result updates, and overlay focus restoration.
- [x] 7.3 Run targeted Vitest and Testing Library suites and fix failures, including React Query cache isolation and fake-timer cleanup between mock scenarios.
- [x] 7.4 Run the repository-prescribed frontend formatting, lint, and type-check commands and resolve all issues introduced by the change.
- [x] 7.5 Audit the final diff to confirm it contains only frontend and OpenSpec changes, adds no backend/OpenAPI/generated-client code, makes no real Contact or member mutations, and leaves API adapter work to a later change.
