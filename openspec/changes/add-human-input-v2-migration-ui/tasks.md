## 1. Version Classification and Baseline Coverage

- [x] 1.1 Add failing unit tests for legacy classification: only persisted `type: human-input` plus exact string `version: '2'` is v2; missing/`'1'` is migration-eligible and malformed or unknown versions are migration blockers.
- [x] 1.2 Add failing policy tests for new, v2-only, legacy-only, mixed, migrated, removed-legacy, and read-only workflow states, including the expected Human Input candidate count and enabled state.
- [x] 1.3 Implement shared pure helpers for legacy detection, migration eligibility, and workflow-level Human Input creation policy, then route all new rollout logic through them.
- [x] 1.4 Preserve and extend golden import/render/edit/export tests proving an unmigrated legacy node stays on the v1 renderer and retains `delivery_methods` until explicit migration.

## 2. Pure Migration Planner

- [x] 2.1 Create typed legacy migration plan/result/blocker models and a narrow snapshotted member/contact resolver interface without adding API or generated-client code.
- [x] 2.2 Add failing converter tests for preserving IDs, positions, common node metadata, shared Human Input fields, compatible extension fields, branch handles, edges, variable references, and array order.
- [x] 2.3 Implement supported recipient conversion: enabled WebApp to initiator, external email to `onetime_email`, member to contact or verified-email fallback, and whole-workspace expansion from one stable resolver snapshot.
- [x] 2.4 Implement canonical recipient deduplication and deterministic first-occurrence ordering across delivery methods, email items, and whole-workspace expansion.
- [x] 2.5 Implement message-template and debug mapping, preserve subject/body verbatim, write exact `version: '2'` and `recpients_spec`, and remove `delivery_methods` only from a complete valid replacement.
- [x] 2.6 Add and satisfy blocker tests for malformed/unknown versions, invalid email, unresolved members, configured disabled methods, enabled unsupported/unknown delivery methods, conflicting email templates, and missing valid v2 recipients.
- [x] 2.7 Add idempotence and batch-preflight tests proving existing v2 nodes remain unchanged and one invalid legacy node prevents every replacement.

## 3. V2-Only Catalog and Central Insertion Guard

- [x] 3.1 Add failing catalog tests proving users see one candidate named Human Input, legacy defaults are not listed, and enabled creation always persists `type: human-input` with string `version: '2'`.
- [x] 3.2 Replace the two user-facing Human Input catalog entries with the single v2-backed candidate while retaining legacy metadata/defaults only for existing-node routing.
- [x] 3.3 Extend block-selector metadata/rendering to support a visible, searchable, per-candidate disabled state with the Figma `DISABLED` badge and accessible reason.
- [x] 3.4 Apply the centralized insertion guard to selector, keyboard/quick-add, duplicate, clipboard paste, and template/snippet insertion boundaries without blocking restoration of a complete saved legacy DSL.
- [x] 3.5 Add integration tests proving all insertion paths are blocked in legacy/mixed drafts and become available immediately after the last legacy node is migrated or removed.

## 4. Legacy Guidance Surfaces

- [x] 4.1 Add component tests for the `1333:5041` workflow banner: legacy-only visibility, v2-only absence, Learn more behavior, editable Migrate action, and read-only presentation.
- [x] 4.2 Implement the workflow-level migration controller/banner at the editor shell using derived graph state and the supplied Figma layout.
- [x] 4.3 Add the presentation-only `OLD VERSION` badge to the existing legacy canvas node and legacy panel without changing their data or controls, with v2 exclusion tests.
- [x] 4.4 Implement the `1333:5404` selector preview explanation and `Migrate now` action for the disabled candidate, sharing the workflow controller entry point and never inserting a node.
- [x] 4.5 Add visual-state/component coverage for the banner, legacy node, legacy panel, disabled selector row, hover/preview state, and both dialog entry points.

## 5. Confirmation and Migration Orchestration

- [x] 5.1 Add failing dialog tests for the `1333:5522` title/body/review copy, Cancel, Escape, focus trap/restore, accessible names, pending state, and duplicate-submit prevention.
- [x] 5.2 Implement the shared migration confirmation dialog and connect both banner and selector-preview triggers.
- [x] 5.3 Add controller tests proving confirmation snapshots resolver/graph data, completes full preflight before mutation, reports node-specific blockers, and leaves history/synchronization untouched on Cancel or preflight failure.
- [x] 5.4 Implement the controller's pending lock and preflight orchestration so all eligible nodes are planned together and malformed legacy versions keep guidance/gating active.

## 6. Atomic Graph Mutation, Persistence, and Recovery

- [x] 6.1 Add failing workflow-state tests for one atomic replacement/history transaction, unchanged node IDs and topology, one existing draft synchronization, and no partially migrated observer state.
- [x] 6.2 Apply the complete plan through the existing graph/history boundary and invoke the existing workflow draft synchronization path exactly once without introducing a migration endpoint.
- [x] 6.3 Add failing recovery tests for draft-sync rejection, full snapshot restoration, retained retry action, suppressed success feedback, and duplicate confirmation during the in-flight operation.
- [x] 6.4 Implement rollback through the same workflow state boundary and verify collaboration/history consumers converge on either the complete original graph or complete migrated graph.
- [x] 6.5 Add successful end-to-end component coverage proving derived state closes the dialog, removes banner/legacy badges, and enables v2 insertion without an editor reload.

## 7. Feedback and Localization

- [x] 7.1 Add all banner, badge, disabled reason, preview, dialog, success, blocker, and synchronization-error keys to `web/i18n/en-US/workflow.json` and `web/i18n/zh-Hans/workflow.json` only.
- [x] 7.2 Implement the `1333:5532` success toast only after durable draft synchronization and localized recoverable feedback for preflight/synchronization failures.
- [x] 7.3 Add locale/component tests proving English and Simplified Chinese resolve every new string without hardcoded UI copy or English fallback in `zh-Hans`.
- [x] 7.4 Audit locale changes and prove no Human Input migration keys were generated or modified for any other language.

## 8. Verification and Scope Audit

- [x] 8.1 Run the focused Human Input, block-selector, workflow-state/history, clipboard/duplicate, migration planner, dialog, and localization Vitest suites and resolve failures.
- [x] 8.2 Run frontend formatting, Oxlint/ESLint checks, and TypeScript checking through the repository's `pnpm check` workflow; document any unrelated pre-existing failure.
- [x] 8.3 Compare implemented banner, badges, disabled selector/preview, confirmation dialog, and success toast against Figma nodes `1333:5041`, `1333:5414`, `1333:5404`, `1333:5522`, and `1333:5532`, including keyboard and read-only states.
- [x] 8.4 Audit the final diff to prove it is limited to `web/` and this OpenSpec change, preserves the legacy renderer and exact v2 wire keys, and adds no backend, graphon, runtime, database, API, or generated-client changes.

## Verification Notes

- Focused Human Input, migration, selector, insertion, history, and locale suites pass: 26 files and 174 tests.
- `pnpm check` reaches pre-existing Markdown formatting failures under `openspec/changes/hitl-im-contact-domain-discovery/` and `openspec/changes/human-input-v2-api-contracts/`. The complete `web/` Vite+ formatting, lint, and type check passes with zero errors, and the repository ESLint fallback passes.
- The rollout surfaces match the captured Figma states and copy for nodes `1333:5041`, `1333:5414`, `1333:5404`, `1333:5522`, and `1333:5532`; component tests cover keyboard focus, Escape/Cancel, pending submission, and read-only behavior.
- The implementation commits touch only `web/` and this change's `tasks.md`; locale changes are limited to `en-US` and `zh-Hans`. Exact string `version: '2'`, literal `recpients_spec`, legacy `delivery_methods` routing, and frontend-only scope are preserved.
