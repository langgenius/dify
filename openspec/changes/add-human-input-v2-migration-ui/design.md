## Context

The completed `add-human-input-v2-node-ui` change introduced a frontend-only Human Input v2 editor. Both generations persist with `type: human-input`; only an exact string `version: '2'` selects the v2 node and panel. The legacy editor stores `delivery_methods`, while v2 stores `recipients_spec`, `message_template`, and `debug_mode`. The frontend catalog currently exposes separate v1 and v2 candidates.

This change advances that rollout without removing the legacy renderer. Existing drafts can still contain v1 nodes and must remain editable, but users must migrate every legacy node before they can insert another Human Input. New drafts must expose one user-facing Human Input candidate backed by v2. The backend batch `node-data-migration` API is the final authoritative converter; until its generated client is available, the frontend uses an isolated API-shaped mock adapter. The frontend owns eligibility, one-request batch orchestration, response validation, graph preservation, draft synchronization, and UI recovery. There is no backend contract, generated-client, graphon, or runtime update in this change.

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
- Convert all eligible legacy nodes in the current draft through one batch migration adapter call followed by a validated, atomic frontend graph update.
- Preserve graph identity, shared Human Input configuration, active recipient semantics, message content, and supported debug behavior without silent loss.
- Keep failure recoverable and leave the original draft unchanged when preflight or synchronization fails.
- Match the supplied Figma states and provide English and Simplified Chinese copy only.

**Non-Goals:**

- Removing the legacy node, panel, or ability to open and edit an unmigrated draft.
- Automatically migrating a workflow on load, publish, import, copy, or paste.
- Implementing backend migration business logic or changing runtime execution, graphon, or database models.
- Migrating published/historical workflow versions or workflows other than the currently editable draft.
- Defining or generating the backend API contract/client in this change.
- Treating the temporary mock converter as the final migration source or coupling production orchestration to its member/contact resolver.

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

### 4. Target the backend batch migration API through a replaceable adapter

The frontend classifies the current draft, collects every eligible legacy Human Input node, and invokes one `node-data-migration` adapter call. Each request and response item carries `node_id` plus `node_data`, so correlation does not depend on array order. The executor only knows this batch interface and never performs recipient/contact conversion itself.

The current adapter is explicitly named and isolated as a mock. It may delegate to the existing local planner and resolver solely to keep the frontend flow operable while the backend endpoint/client is blocked. The final adapter will call the backend batch operation, which becomes the sole semantic conversion source; replacing the mock MUST NOT change the executor, graph application, or UI. This change does not edit backend contracts or generated files.

The authoritative conversion preserves the following product mapping:

| Legacy input                                 | Human Input v2 output                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Enabled `webapp` method                      | One `{ type: 'initiator' }` recipient                                                                                              |
| Enabled email external recipient             | `{ type: 'onetime_email', email }` after trim/validation                                                                           |
| Enabled email member recipient               | Resolve `user_id` to a current contact; fall back to the member's current email as `onetime_email`; block if neither is resolvable |
| Enabled email `whole_workspace`              | Expand the resolver snapshot in stable workspace order to contact recipients, with resolvable member-email fallback                |
| Enabled email subject/body                   | Preserve verbatim in `message_template`                                                                                            |
| Email `debug_mode: true`                     | `{ enabled: true, channels: ['email'] }`                                                                                           |
| Email `debug_mode: false` or no email method | `{ enabled: false, channels: [] }`                                                                                                 |

Recipients are deduplicated by canonical identity while preserving first occurrence, and initiator appears at most once. Each response node receives exact `version: '2'` and the literal wire key `recipients_spec`; the legacy misspelling `recpients_spec` is not emitted. The frontend validates that the response contains exactly one item for every requested `node_id`, no unknown or duplicate IDs, and exact v2 discriminators before touching graph state.

The API returns DSL node data, not a graph node wrapper. The frontend therefore retains IDs, positions, dimensions, branch handles, edges, selection-independent metadata and compatible frontend extension fields from the latest graph, removes `delivery_methods`, and overlays the returned v2 DSL fields. Missing, duplicate, malformed, or stale-correlated response items abort the whole operation.

V2 has no lossless representation for a disabled method that retains material configuration, conflicting multiple email templates, an enabled Slack/Teams/Discord method, an invalid external email, or an unresolvable member/workspace recipient. The batch adapter rejects those cases as migration failures. The frontend keeps the graph untouched and associates the failure with the pending migration rather than attempting best-effort conversion in the executor.

### 5. Apply and persist one atomic graph transaction

On confirmation, the controller snapshots the affected node data, submits one complete batch request, validates the response and re-reads the current graph before mutation. If any target legacy node changed while the request was pending, migration aborts instead of overwriting newer local or collaborative edits. Otherwise it overlays all returned v2 node data in one workflow-state/history transaction, without recreating nodes or edges, and invokes the existing draft synchronization path once.

An in-flight lock prevents duplicate submission. Request, contract-validation or stale-graph failure leaves the graph untouched and presents localized actionable feedback. A synchronization failure restores only the nodes changed by this migration through the same state boundary, keeps migration available, and shows an error rather than the success toast. Success closes the dialog, emits one localized success toast, and lets derived state remove the banner/old labels and enable Human Input creation. An all-v2 graph remains a no-op and does not call the migration API.

This keeps frontend and collaborative/history state convergent and avoids per-node API calls or autosaves. A per-node migration contract was rejected because it duplicates orchestration and permits partial conversion observations.

### 6. Keep visual copy and tests local to the frontend

All new strings live in the workflow locale namespace for `en-US` and `zh-Hans`; other locale files are not generated or modified. Component tests cover the Figma states, keyboard/accessibility behavior, and permission variants. Contract/adapter tests cover one-request batching, request/response correlation, malformed responses, graph preservation, stale-graph rejection, atomicity, single-sync behavior and rollback. Integration tests cover new, legacy-only, mixed, migrated, imported, duplicate, and clipboard flows.

## Risks / Trade-offs

- [Batch response is incomplete, duplicated or malformed] → Validate the full `node_id` set and exact v2 discriminator before graph mutation; the executor never falls back to local conversion.
- [Legacy imported DSL can contain shapes the current UI never created] → Unknown versions, unsupported delivery methods, conflicting templates, and invalid recipients produce explicit blockers instead of best-effort loss.
- [Insertion gating can drift across entry points] → Keep policy and guard pure and centralized, then test selector, shortcuts, duplicate, paste, and template insertion against the same function.
- [Draft synchronization can fail after optimistic graph replacement] → Keep affected-node snapshots, prevent concurrent migration, and conditionally restore the migrated batch on failure.
- [Graph changes while the batch request is pending] → Compare current target node data with the submitted snapshot and abort before mutation when they differ.
- [Temporary mock still contains legacy conversion logic] → Keep it isolated behind `HumanInputMigrationApi`; replace only that adapter when the backend client is available and do not expose its resolver to orchestration/UI code.
- [Large whole-workspace recipient sets can expand the DSL] → The final backend adapter owns resolution and deduplication; the temporary mock exists only to unblock frontend behavior.
- [The v1 editor remains in the bundle] → Retention is intentional for backward-compatible rendering; catalog tests ensure it is not user-creatable.

## Migration Plan

1. Add classification and creation-policy tests before changing catalog behavior.
2. Define a frontend-only `HumanInputMigrationApi` batch boundary and an API-shaped mock adapter with correlation and response validation tests; do not modify backend contracts or generated clients.
3. Change the catalog to a single v2-backed candidate and centralize insertion guards while retaining v1 routing.
4. Add the workflow banner, legacy badges, disabled selector preview, confirmation dialog, success/error feedback, and two locales.
5. Connect the validated batch response to the atomic graph transaction and existing draft synchronization with rollback and history/collaboration coverage.
6. Run focused frontend adapter tests and type/lint checks. Rollback consists of reverting the frontend integration; the migration adapter does not persist workflow DSL, and failed draft synchronization restores the affected frontend nodes.

## Open Questions

None. The backend batch `node-data-migration` API is the final conversion source. The current local converter is permitted only inside the temporary mock adapter and will be removed when the generated client is ready.
