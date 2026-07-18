## 1. Design Acceptance and Regression Baseline

- [x] 1.1 Open all eight referenced Studio nodes and record an acceptance matrix for node recipient states, recipient configuration/input, Debug Mode, Message Template, text, validation, disabled/read-only behavior, keyboard behavior, sizing, spacing and responsive constraints.
- [x] 1.2 Inventory every frontend registration and utility currently coupled to `BlockEnum.HumanInput` or `HumanInputNodeType`, including node/panel maps, catalog metadata, validation, outputs, branch layout, variable dependencies, copy/paste and edge cleanup.
- [x] 1.3 Add baseline tests that import, render, edit and export an original Human Input node and prove that v1 `delivery_methods`, defaults, UI routing and DSL remain unchanged.

## 2. Human Input v2 Types, Defaults and Routing

- [x] 2.1 Write failing unit tests for the exact discriminator rule: only `type: human-input` plus string `version: '2'` is v2; missing version, `'1'` and numeric `2` are not v2.
- [x] 2.2 Add frontend-local Human Input v2 TypeScript types that mirror `human_input_v2/entities.py`, including all four recipient unions, six debug channels, `message_template`, `debug_mode` and the exact wire key `recpients_spec`.
- [x] 2.3 Add the pure v2 type guard and a complete v2 default with `version: '2'`, empty recipients/template/channels/form/actions, `timeout: 36` and `timeout_unit: hour`.
- [x] 2.4 Register a UI-only Human Input v2 catalog identity, metadata and independent creation candidate while preserving the original Human Input candidate; normalize created v2 data to persisted `type: human-input`.
- [x] 2.5 Add version-aware node, panel, metadata and checklist routers that dispatch exact v2 data to the new implementation and all original Human Input data to v1.
- [x] 2.6 Add round-trip tests proving new and imported v2 nodes preserve `type: human-input`, string `version: '2'`, `recpients_spec`, nested objects and array order without requiring graphon changes.

## 3. Shared Human Input Form and Workflow Infrastructure

- [x] 3.1 Write regression tests for shared form content, inputs, user actions, timeout, outputs, action handles and `__timeout` behavior across v1 and v2 fixtures.
- [x] 3.2 Extract narrow shared types, components and hooks for `form_content`, `inputs`, `user_actions`, `timeout` and `timeout_unit` without making v2 depend on v1 `delivery_methods` or the full v1 node type.
- [x] 3.3 Update output derivation, branch sorting/layout, edge deletion and action-handle utilities to consume the shared minimum Human Input shape and preserve v1 behavior.
- [x] 3.4 Extend workflow variable dependency, rename/delete and copy/paste utilities to recognize Human Input v2 while preventing v2 data from entering v1 delivery-method update paths.
- [x] 3.5 Run and fix the existing Human Input node, panel, form, branch, output and variable utility tests before adding v2 UI sections.

## 4. Recipient Data Model, Mock Provider and Editor

- [x] 4.1 Write failing unit tests for recipient validation, canonical duplicate keys, ordered updates, imported duplicate preservation and pure node-card summary derivation.
- [x] 4.2 Implement recipient constructors, validators and immutable add/edit/delete helpers for `contact`, `dynamic_email`, `onetime_email` and `initiator`.
- [x] 4.3 Define a narrow typed Contact option-provider interface and deterministic mock adapter for search and id resolution; ensure components never import fixtures directly or call a real Contact API.
- [x] 4.4 Implement the Figma recipient input with typed drafts, type switching, required-field validation, duplicate prevention, cancel/confirm behavior and read-only handling.
- [x] 4.5 Implement the ordered recipient configuration list with local item editing, deletion, unresolved Contact fallback and repairable imported-invalid states.
- [x] 4.6 Integrate Dynamic Email with the workflow variable selector and add tests for dependency extraction, rename, deletion, node copy and paste remapping.
- [x] 4.7 Implement the pure recipient summary model and all four Figma node-card recipient states, including empty, configured, overflow and unresolved/invalid presentations.
- [x] 4.8 Add Testing Library coverage for Contact mock loading/search/empty/error states, all four recipient types, duplicate handling, keyboard interaction and DSL updates.

## 5. Debug Mode

- [x] 5.1 Write failing component tests for the Debug Mode switch, all six channel values, enabled-without-channel validation, read-only state and preservation of selected channels while disabled.
- [x] 5.2 Implement the Figma Debug Mode component using dify-ui controls and localized labels for `email`, `feishu`, `slack`, `ding_talk`, `ms_teams` and `we_com`.
- [x] 5.3 Use localized field updates so unrelated edits preserve unsupported imported channel values; surface an explicit compatibility error instead of silently dropping data.
- [x] 5.4 Verify Debug Mode interactions only mutate node DSL and do not invoke Email, IM, Contact or Human Input runtime requests.

## 6. Message Template

- [x] 6.1 Write failing component tests for opening from node data, local subject/body drafts, v2 validation, cancel/Escape discard, atomic confirm, duplicate-submit prevention, read-only behavior and focus restoration.
- [x] 6.2 Implement the Figma Message Template overlay with dify-ui primitives, localized fields/actions/errors and the acceptance-matrix sizing and layout.
- [x] 6.3 Implement unsaved-change close behavior and v2-specific template validation without inheriting the v1 Email delivery requirement for `{{#url#}}`.
- [x] 6.4 Integrate supported subject/body variable insertion with existing prompt/variable primitives and add dependency rename/delete/copy/paste regression tests.

## 7. V2 Panel, Validation and Node Integration

- [x] 7.1 Compose the Human Input v2 panel from Recipients, Message Template, Debug Mode and the extracted shared form/action/timeout/output sections without rendering Delivery Method.
- [x] 7.2 Implement v2 validation for exact version, at least one valid recipient, recipient required fields and duplicates, Figma-required template fields, Debug Mode channels and shared form/action rules.
- [x] 7.3 Connect validation errors to the node checklist and the corresponding panel sections, preserving repairable imported data rather than normalizing it on render.
- [x] 7.4 Complete the v2 node card with shared action and timeout handles, recipient summary and all Figma visual/interaction states.
- [x] 7.5 Add integration tests that create v1 and v2 from their separate catalog candidates, reopen each panel, edit data, copy/paste and export without cross-version field leakage.
- [x] 7.6 Add scope tests or assertions proving this change introduces no graphon adapter, runtime request, simulated executor or simulated v2 execution result.

## 8. Localization, Accessibility and Visual QA

- [x] 8.1 Add all Human Input v2 user-facing strings to `web/i18n/en-US/` and `web/i18n/zh-Hans/` only; remove hardcoded product text from components and validation without modifying other locale files.
- [x] 8.2 Verify recipient controls, Debug Mode and Message Template have accessible names, semantic errors, visible focus, logical keyboard order, focus restoration and read-only semantics.
- [x] 8.3 Compare implemented node, panel and overlay states against all eight Figma references at relevant widths and resolve documented visual or interaction differences.
- [x] 8.4 Add deterministic fixtures and test harness states for every Figma acceptance state without introducing real backend or graphon dependencies.

## 9. Verification and Scope Audit

- [x] 9.1 Run targeted Vitest suites for Human Input v1/v2 components, guards, defaults, recipients, template, Debug Mode, workflow variables, branches and DSL round-trip.
- [x] 9.2 Run frontend formatting, lint and type checks required by `web/AGENTS.md`, and fix all issues introduced by this change.
- [x] 9.3 Run `openspec validate add-human-input-v2-node-ui --strict` and resolve every proposal, design, spec and task consistency error.
- [x] 9.4 Audit the final diff to prove it contains only frontend implementation (`web/` plus the directly related `oxlint-suppressions.json` cleanup) and this OpenSpec change, preserves the literal `recpients_spec`, writes version as string `'2'`, keeps the original Human Input implementation and adds no API, backend, graphon, database or runtime change.
