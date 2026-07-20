## Context

The completed `add-human-input-v2-node-ui` change introduced a frontend-only Human Input v2 editor. Both generations persist with `type: human-input`; only an exact string `version: '2'` selects the v2 node and panel. The legacy editor stores `delivery_methods`, while v2 stores `recpients_spec`, `message_template`, and `debug_mode`. The frontend catalog currently exposes separate v1 and v2 candidates.

This change advances that rollout without removing the legacy renderer. Existing drafts can still contain v1 nodes and must remain editable, but users must migrate every legacy node before they can insert another Human Input. New drafts must expose one user-facing Human Input candidate backed by v2. The migration is constrained to `web/`, existing workflow draft mutation/synchronization infrastructure, and current frontend data or mocks; there is no backend migration endpoint or graphon update.

The target visual states are:

| Surface                            | Figma node       | Required state                                                                                   |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| Legacy workflow guidance           | `HITL 1333:5041` | Top banner with Learn more/Migrate actions; legacy canvas node and open panel show `OLD VERSION` |
| Block selector                     | `HITL 1333:5414` | Human Input remains discoverable but disabled, carries `DISABLED`, and cannot be inserted        |
| Selector preview / migration entry | `HITL 1333:5404` | Preview explains that old nodes must be migrated and offers `Migrate now`                        |
| Confirmation                       | `HITL 1333:5522` | Batch-migration confirmation dialog with preservation and review messaging                       |
| Completion                         | `HITL 1333:5532` | Success toast: `Human Input nodes migrated successfully`                                         |

## Goals / Non-Goals

**Goals:**

- Provide one consistent frontend classification for exact v2 data, legacy-rendered data, and migration eligibility.
- Make v2 the only creation candidate while blocking every Human Input insertion path in drafts that still contain legacy nodes.
- Convert all eligible legacy nodes in the current draft through a deterministic, preflighted, atomic migration.
- Preserve graph identity, shared Human Input configuration, active recipient semantics, message content, and supported debug behavior without silent loss.
- Keep failure recoverable and leave the original draft unchanged when preflight or synchronization fails.
- Match the supplied Figma states and provide English and Simplified Chinese copy only.

**Non-Goals:**

- Removing the legacy node, panel, or ability to open and edit an unmigrated draft.
- Automatically migrating a workflow on load, publish, import, copy, or paste.
- Adding a backend migration API, changing runtime execution, graphon, database models, or generated clients.
- Migrating published/historical workflow versions or workflows other than the currently editable draft.
- Inventing v2 semantics for unsupported legacy delivery methods or replacing the future Contacts/backend integration.

## Decisions

### 1. Centralize version classification and creation policy

The existing exact v2 guard remains authoritative:

```ts
isHumanInputV2 = data.type === BlockEnum.HumanInput && data.version === '2'
isLegacyRenderedHumanInput = data.type === BlockEnum.HumanInput && !isHumanInputV2
```

A pure workflow-level selector derives `{ hasLegacyHumanInput, canAddHumanInputV2 }` from the current nodes and edit permission. Every presentation and insertion boundary consumes that policy instead of repeating version checks. Missing `version`, `'1'`, numeric `2`, and unknown values remain on the legacy renderer and keep creation blocked. The migration planner accepts the known legacy shapes (missing version or `'1'`); malformed or unknown explicit versions become preflight blockers instead of being coerced.

This mirrors the current router and prevents a candidate, shortcut, paste, duplicate, or future insertion surface from bypassing the restriction. Treating only missing-version nodes as legacy was rejected because it would disagree with the established router and could allow a mixed graph.

### 2. Replace the two catalog choices with one v2-backed product candidate

The UI-only `BlockEnum.HumanInputV2` identity remains useful for metadata/default resolution, but users see one candidate named Human Input. Selecting it always creates persisted `type: human-input`, `version: '2'` data. The legacy default stays available only to import/render/edit existing node data and is no longer emitted as a creation candidate.

When `hasLegacyHumanInput` is false, the v2-backed candidate is enabled. When it is true, the same candidate remains visible and searchable but is rendered disabled with the Figma badge and preview guidance. A shared add guard rejects Human Input insertion from selector clicks, keyboard/quick-add actions, duplicate, and clipboard/template insertion while the block applies. Loading a complete existing workflow DSL remains allowed because that is restoration, not an in-editor insertion action.

### 3. Mount migration guidance at workflow and legacy-renderer boundaries

A small workflow-level migration controller owns banner/dialog state and reads the centralized policy. It renders the Figma banner only while at least one legacy-rendered Human Input exists. The existing legacy node and legacy panel receive a presentation-only `OLD VERSION` badge; their data and controls otherwise remain unchanged.

The banner Migrate action and selector-preview `Migrate now` action open the same dialog. Learn more uses the repository's existing documentation-link convention. Users without workflow edit permission can see the legacy explanation but cannot start migration. Dialog focus is trapped, Cancel/Escape preserve the graph, focus returns to the invoking control, and the confirm action is locked while migration is pending.

### 4. Use a pure migration planner with an injected recipient resolver

Migration is separated into a pure converter plus a narrow frontend resolver. The resolver snapshots current workspace members/contacts from already-available frontend providers (mock data where that is all the UI currently has) before conversion. It does not call a new endpoint.

For each eligible node, the planner clones shared and extension data, replaces only the version-specific shape, and applies this mapping:

| Legacy input                                 | Human Input v2 output                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Enabled `webapp` method                      | One `{ type: 'initiator' }` recipient                                                                                              |
| Enabled email external recipient             | `{ type: 'onetime_email', email }` after trim/validation                                                                           |
| Enabled email member recipient               | Resolve `user_id` to a current contact; fall back to the member's current email as `onetime_email`; block if neither is resolvable |
| Enabled email `whole_workspace`              | Expand the resolver snapshot in stable workspace order to contact recipients, with resolvable member-email fallback                |
| Enabled email subject/body                   | Preserve verbatim in `message_template`                                                                                            |
| Email `debug_mode: true`                     | `{ enabled: true, channels: ['email'] }`                                                                                           |
| Email `debug_mode: false` or no email method | `{ enabled: false, channels: [] }`                                                                                                 |

Recipients are deduplicated by canonical identity while preserving first occurrence, and initiator appears at most once. The node receives exact `version: '2'` and the literal wire key `recpients_spec`. IDs, positions, title/description, `form_content`, `inputs`, `user_actions`, timeout fields, branch handles, edges, variable references, and unrelated compatible extension fields are preserved. `delivery_methods` is removed only from a successfully converted replacement.

V2 has no lossless representation for a disabled method that retains material configuration, conflicting multiple email templates, an enabled Slack/Teams/Discord method, an invalid external email, or an unresolvable member/workspace recipient. Those cases are blockers. Blocking the entire migration was chosen over silently dropping data or activating previously disabled configuration, both of which would contradict the dialog's preservation promise.

### 5. Apply and persist one atomic graph transaction

On confirmation, the controller snapshots the affected nodes, creates the complete plan without mutating graph state, and proceeds only when every legacy node has a valid replacement. It then replaces all affected node data in one workflow-state/history transaction, without recreating nodes or edges, and invokes the existing draft synchronization path once.

An in-flight lock prevents duplicate submission. A preflight failure leaves the graph untouched and presents localized actionable feedback. A synchronization failure restores the snapshot through the same state boundary, keeps migration available, and shows an error rather than the success toast. Success closes the dialog, emits one localized success toast, and lets derived state remove the banner/old labels and enable Human Input creation. Re-running the planner on an all-v2 graph is a no-op.

This keeps frontend and collaborative/history state convergent and avoids a sequence of per-node autosaves. A mutation that migrates nodes independently was rejected because another observer could see a partially migrated graph and because rollback would be ambiguous.

### 6. Keep visual copy and tests local to the frontend

All new strings live in the workflow locale namespace for `en-US` and `zh-Hans`; other locale files are not generated or modified. Component tests cover the Figma states, keyboard/accessibility behavior, and permission variants. Pure tests cover classification, catalog policy, conversion mapping/blockers, deduplication/order, idempotence, graph preservation, atomicity, single-sync behavior, and rollback. Integration tests cover new, legacy-only, mixed, migrated, imported, duplicate, and clipboard flows.

## Risks / Trade-offs

- [Mock contact/member data may not resolve a real legacy recipient] → The resolver preserves a verified email fallback and otherwise blocks before mutation; replacing the resolver with a backend-backed adapter is deferred.
- [Legacy imported DSL can contain shapes the current UI never created] → Unknown versions, unsupported delivery methods, conflicting templates, and invalid recipients produce explicit blockers instead of best-effort loss.
- [Insertion gating can drift across entry points] → Keep policy and guard pure and centralized, then test selector, shortcuts, duplicate, paste, and template insertion against the same function.
- [Draft synchronization can fail after optimistic graph replacement] → Keep an immutable snapshot, prevent concurrent migration, and restore the complete batch on failure.
- [Large whole-workspace recipient sets can expand the DSL] → Resolve once from a stable snapshot, deduplicate deterministically, and avoid repeated provider reads during conversion.
- [The v1 editor remains in the bundle] → Retention is intentional for backward-compatible rendering; catalog tests ensure it is not user-creatable.

## Migration Plan

1. Add classification, creation-policy, and pure migration-planner tests before changing catalog behavior.
2. Implement the resolver boundary and lossless conversion/preflight rules behind unit tests.
3. Change the catalog to a single v2-backed candidate and centralize insertion guards while retaining v1 routing.
4. Add the workflow banner, legacy badges, disabled selector preview, confirmation dialog, success/error feedback, and two locales.
5. Connect the atomic graph transaction and existing draft synchronization with rollback and history/collaboration coverage.
6. Run focused tests, type/lint checks, and a frontend-only diff audit. Rollback consists of reverting the frontend rollout; no stored data is migrated until a user confirms, and failed attempts restore their original graph snapshot.

## Open Questions

None for this frontend-only proposal. A future backend/contact contract can replace the resolver implementation without changing the planner or UI policy.
