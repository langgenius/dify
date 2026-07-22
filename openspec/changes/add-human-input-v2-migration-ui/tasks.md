## 1. Version Classification and Baseline Coverage

- [x] 1.1 Add failing unit tests for legacy classification: only persisted `type: human-input` plus exact string `version: '2'` is v2; every other Human Input shape stays on the legacy renderer without frontend coercion.
- [x] 1.2 Add failing policy tests for new, v2-only, legacy-only, mixed, migrated, removed-legacy, and read-only workflow states, including the expected Human Input candidate count and enabled state.
- [x] 1.3 Implement shared pure helpers for legacy detection, migration eligibility, and workflow-level Human Input creation policy, then route all new rollout logic through them.
- [x] 1.4 Preserve and extend golden import/render/edit/export tests proving an unmigrated legacy node stays on the v1 renderer and retains `delivery_methods` until explicit migration.

## 2. Backend Migration Helper Integration

- [ ] 2.1 Add typed frontend request, success-response, and error-response models for `POST /console/api/workspaces/current/human-input/node-data-migration`.
- [ ] 2.2 Add failing orchestration tests proving one confirmation submits `{ node_id, data }` for every legacy-rendered Human Input node in the editable draft and excludes existing exact v2 nodes.
- [ ] 2.3 Add response-correlation tests for complete ordered success, missing results, duplicate `node_id`, unexpected `node_id`, malformed response data, and backend transport or decoding failure.
- [ ] 2.4 Implement authoritative node-data handling: associate each returned result by `node_id` and pass the complete returned `data` object to the graph transaction without merging or rewriting nested fields.
- [ ] 2.5 Remove or bypass the frontend converter and member/contact resolver from the migration path; add tests proving the frontend does not resolve Contacts, expand workspace membership, map delivery methods, deduplicate recipients, or recompute message/debug configuration.
- [ ] 2.6 Add backend-error tests proving node-scoped blockers and all other conversion failures leave every node and edge unchanged and keep migration retryable.

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
- [ ] 5.3 Add controller tests proving confirmation snapshots graph data, submits the complete legacy-node batch, reports backend node-scoped blockers, and leaves history/synchronization untouched on Cancel, request failure, or invalid response.
- [ ] 5.4 Implement the controller's pending lock and backend request orchestration so exactly one batch request is active per confirmation and every legacy-rendered Human Input remains covered by guidance/gating until successful replacement.

## 6. Atomic Graph Mutation, Persistence, and Recovery

- [ ] 6.1 Add failing workflow-state tests proving a complete backend success response produces one atomic replacement/history transaction with unchanged node IDs and topology and no partially migrated observer state.
- [ ] 6.2 Apply each authoritative returned node definition through the existing graph/history boundary and invoke the existing workflow draft synchronization path exactly once.
- [ ] 6.3 Add recovery tests for backend request failure, invalid or incomplete success response, draft-sync rejection, full snapshot restoration, retained retry action, suppressed success feedback, and duplicate confirmation during the in-flight operation.
- [ ] 6.4 Implement rollback through the same workflow state boundary and verify collaboration/history consumers converge on either the complete original graph or the graph containing the complete backend-returned batch.
- [ ] 6.5 Add successful end-to-end component coverage with a mocked backend batch response proving derived state closes the dialog, removes banner/legacy badges, and enables v2 insertion without an editor reload.

## 7. Feedback and Localization

- [x] 7.1 Add all banner, badge, disabled reason, preview, dialog, success, blocker, and synchronization-error keys to `web/i18n/en-US/workflow.json` and `web/i18n/zh-Hans/workflow.json` only.
- [ ] 7.2 Implement the `1333:5532` success toast only after durable draft synchronization and localized recoverable feedback for backend conversion, protocol-validation, and synchronization failures.
- [x] 7.3 Add locale/component tests proving English and Simplified Chinese resolve every new string without hardcoded UI copy or English fallback in `zh-Hans`.
- [x] 7.4 Audit locale changes and prove no Human Input migration keys were generated or modified for any other language.

## 8. Verification and Scope Audit

- [ ] 8.1 Run the focused Human Input, backend migration client/orchestration, block-selector, workflow-state/history, clipboard/duplicate, dialog, and localization Vitest suites and resolve failures.
- [ ] 8.2 Run frontend formatting, Oxlint/ESLint checks, and TypeScript checking through the repository's `pnpm check` workflow; document any unrelated pre-existing failure.
- [x] 8.3 Compare implemented banner, badges, disabled selector/preview, confirmation dialog, and success toast against Figma nodes `1333:5041`, `1333:5414`, `1333:5404`, `1333:5522`, and `1333:5532`, including keyboard and read-only states.
- [ ] 8.4 Audit the final diff to prove the frontend consumes the backend migration helper, applies returned node definitions without semantic conversion, preserves the legacy renderer and graph identity, and adds no frontend recipient-resolution or conversion rules.
