## Context

The completed `add-human-input-v2-node-ui` change introduced a frontend-only Human Input v2 editor. Both generations persist with `type: human-input`; only an exact string `version: '2'` selects the v2 node and panel. The legacy editor stores `delivery_methods`, while v2 stores `recipients_spec`, `message_template`, and `debug_mode`. The frontend catalog currently exposes separate v1 and v2 candidates.

This change advances that rollout without removing the legacy renderer. Existing drafts can still contain v1 nodes and must remain editable, but users must migrate every legacy node before they can insert another Human Input. New drafts must expose one user-facing Human Input candidate backed by v2. The frontend integrates with the separately specified workspace console batch node-data migration helper and remains responsible for confirmation, graph mutation, draft synchronization, and rollback; conversion and validation are backend responsibilities. This change does not alter graphon or runtime execution.

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
- Submit all legacy nodes in the current draft as one backend conversion batch and apply only a complete successful response through one atomic frontend graph transaction.
- Preserve graph identity while treating each backend-returned v2 node definition as authoritative and applying it without frontend reinterpretation.
- Keep failure recoverable and leave the original draft unchanged when backend conversion, response validation, or draft synchronization fails.
- Match the supplied Figma states and provide English and Simplified Chinese copy only.

**Non-Goals:**

- Removing the legacy node, panel, or ability to open and edit an unmigrated draft.
- Automatically migrating a workflow on load, publish, import, copy, or paste.
- Implementing recipient resolution, delivery-method conversion, message/debug mapping, deduplication, or blocker validation in the frontend.
- Implementing the backend migration helper within this frontend change, or changing runtime execution, graphon, or database models.
- Migrating published/historical workflow versions or workflows other than the currently editable draft.

## Decisions

### 1. Centralize version classification and creation policy

The existing exact v2 guard remains authoritative:

```ts
isHumanInputV2 = data.type === BlockEnum.HumanInput && data.version === '2'
isLegacyRenderedHumanInput = data.type === BlockEnum.HumanInput && !isHumanInputV2
```

A pure workflow-level selector derives `{ hasLegacyHumanInput, canAddHumanInputV2 }` from the current nodes and edit permission. Every presentation and insertion boundary consumes that policy instead of repeating version checks. Missing `version`, `'1'`, numeric `2`, and unknown values remain on the legacy renderer and keep creation blocked. On confirmation, the frontend includes every legacy-rendered Human Input node in the backend conversion batch; the backend decides whether each submitted definition is convertible and returns node-scoped blockers for unsupported input.

This mirrors the current router and prevents a candidate, shortcut, paste, duplicate, or future insertion surface from bypassing the restriction. Treating only missing-version nodes as legacy was rejected because it would disagree with the established router and could allow a mixed graph.

### 2. Replace the two catalog choices with one v2-backed product candidate

The UI-only `BlockEnum.HumanInputV2` identity remains useful for metadata/default resolution, but users see one candidate named Human Input. Selecting it always creates persisted `type: human-input`, `version: '2'` data. The legacy default stays available only to import/render/edit existing node data and is no longer emitted as a creation candidate.

When `hasLegacyHumanInput` is false, the v2-backed candidate is enabled. When it is true, the same candidate remains visible and searchable but is rendered disabled with the Figma badge and preview guidance. A shared add guard rejects Human Input insertion from selector clicks, keyboard/quick-add actions, duplicate, and clipboard/template insertion while the block applies. Loading a complete existing workflow DSL remains allowed because that is restoration, not an in-editor insertion action.

### 3. Mount migration guidance at workflow and legacy-renderer boundaries

A small workflow-level migration controller owns banner/dialog state and reads the centralized policy. It renders the Figma banner only while at least one legacy-rendered Human Input exists. The existing legacy node and legacy panel receive a presentation-only `OLD VERSION` badge; their data and controls otherwise remain unchanged.

The banner Migrate action and selector-preview `Migrate now` action open the same dialog. Learn more uses the repository's existing documentation-link convention. Users without workflow edit permission can see the legacy explanation but cannot start migration. Dialog focus is trapped, Cancel/Escape preserve the graph, focus returns to the invoking control, and the confirm action is locked while migration is pending.

### 4. Treat backend conversion results as authoritative node definitions

After explicit user confirmation, the frontend submits one ordered batch containing `{ node_id, data }` for every legacy-rendered Human Input node in the editable draft to `POST /console/api/workspaces/current/human-input/node-data-migration`. The backend helper owns request-shape validation, tenant-scoped recipient resolution, delivery-method conversion, message/debug mapping, deduplication, controlled-loss policy, and blocker generation.

The helper is all-or-error. A success response must contain exactly one complete v2 node definition for every submitted `node_id`; an error response contains node-scoped blockers and no partial converted node data. Before graph mutation, the frontend validates only the response envelope and correlation invariants: no missing, duplicate, or unexpected `node_id`, and one result per submitted node in request order.

The frontend MUST treat each returned `data` object as the canonical replacement. It does not resolve contacts, expand workspace membership, map delivery methods, filter or deduplicate recipients, rewrite templates/debug configuration, or otherwise reinterpret the returned node definition. Any malformed or incomplete success response is treated as a protocol failure and leaves the graph unchanged.

### 5. Apply and persist one atomic graph transaction

On confirmation, the controller snapshots the affected nodes, sends the complete batch to the backend helper without mutating graph state, and proceeds only after receiving and validating a complete success response. It then replaces each affected node's data with the corresponding returned definition in one workflow-state/history transaction, without recreating nodes or edges, and invokes the existing draft synchronization path once.

An in-flight lock prevents duplicate submission. A backend conversion error or invalid response leaves the graph untouched and presents localized actionable feedback. A synchronization failure restores the snapshot through the same state boundary, keeps migration available, and shows an error rather than the success toast. Success closes the dialog, emits one localized success toast, and lets derived state remove the banner/old labels and enable Human Input creation. An all-v2 graph produces no migration request.

This keeps frontend and collaborative/history state convergent and avoids a sequence of per-node autosaves. A mutation that migrates nodes independently was rejected because another observer could see a partially migrated graph and because rollback would be ambiguous.

### 6. Keep visual copy and tests local to the frontend

All new strings live in the workflow locale namespace for `en-US` and `zh-Hans`; other locale files are not generated or modified. Component tests cover the Figma states, keyboard/accessibility behavior, and permission variants. Focused tests cover classification, catalog policy, batch request construction, response correlation, backend error handling, authoritative node-data replacement, graph preservation, atomicity, single-sync behavior, and rollback. Integration tests cover new, legacy-only, mixed, migrated, imported, duplicate, and clipboard flows.

## Risks / Trade-offs

- [Backend conversion is unavailable or rejects imported legacy data] → Leave the graph unchanged, surface the backend error or node-scoped blockers, and keep migration retryable.
- [Frontend and backend batch contracts drift] → Validate response correlation and completeness before mutation, use shared generated or explicitly typed DTOs, and treat any protocol mismatch as an all-batch failure.
- [Insertion gating can drift across entry points] → Keep policy and guard pure and centralized, then test selector, shortcuts, duplicate, paste, and template insertion against the same function.
- [Draft synchronization can fail after optimistic graph replacement] → Keep an immutable snapshot, prevent concurrent migration, and restore the complete batch on failure.
- [Returned node definitions can be large] → Apply them as opaque authoritative data and avoid cloning or transforming recipient structures outside the existing immutable graph transaction boundary.
- [The v1 editor remains in the bundle] → Retention is intentional for backward-compatible rendering; catalog tests ensure it is not user-creatable.

## Migration Plan

1. Add classification and creation-policy tests before changing catalog behavior.
2. Add the backend batch migration client, request/response DTOs, correlation validation, and all-or-error orchestration tests.
3. Change the catalog to a single v2-backed candidate and centralize insertion guards while retaining v1 routing.
4. Add the workflow banner, legacy badges, disabled selector preview, confirmation dialog, success/error feedback, and two locales.
5. Connect the atomic graph transaction and existing draft synchronization with rollback and history/collaboration coverage.
6. Run focused tests, type/lint checks, and a frontend/backend ownership audit. Rollback consists of reverting the frontend rollout; no stored data is migrated until a user confirms and the backend returns a complete batch, and failed attempts restore their original graph snapshot.

## Open Questions

None. The backend batch conversion and blocker semantics are specified by `human-input-v2-api-contracts`; this change owns only the frontend confirmation, request orchestration, authoritative node-data replacement, draft synchronization, rollback, and rollout UI.
