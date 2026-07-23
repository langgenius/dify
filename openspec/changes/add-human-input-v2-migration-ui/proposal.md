## Why

Workflows that still contain legacy Human Input nodes need a clear, safe path to the version-2 node before the product can make v2 the only addable Human Input experience. Without migration guidance and gating, users can mix incompatible node generations or lose legacy delivery configuration while rebuilding nodes manually.

## What Changes

- Detect legacy Human Input nodes in the frontend using the persisted discriminator: a Human Input node is v2 only when `version` is the exact string `"2"`; existing non-v2 nodes continue to render and edit with the legacy implementation until migrated.
- Add the Figma-defined legacy guidance states: workflow banner, `OLD VERSION` labels on the legacy canvas node and panel, a disabled Human Input entry in the node selector, and a migration call to action in its preview.
- **BREAKING**: Remove legacy Human Input from creation choices. New apps expose only the v2-backed Human Input entry, while any workflow containing a legacy Human Input keeps that entry visible but disabled until all legacy nodes are migrated.
- Add a confirmation flow that sends every eligible legacy Human Input node in the current draft through one batch `node-data-migration` adapter call, validates the complete response, and applies one atomic graph transaction before using the existing draft synchronization path. The adapter is mock-backed until the backend client is available.
- Prevent partial or lossy migration: unresolved recipients or unsupported legacy delivery configuration block the mutation and produce recoverable localized feedback; a draft-sync failure restores the original graph.
- Show the Figma-defined success toast after migration, remove legacy guidance, and immediately enable the v2 Human Input creation entry.
- Add focused frontend tests and user-facing translations in English and Simplified Chinese only.

## Capabilities

### New Capabilities

- `human-input-v2-migration`: Detect, batch-convert through an API-shaped migration boundary, validate, atomically apply, persist, and recover migration of legacy Human Input nodes to the v2 DSL shape.
- `human-input-version-rollout-ui`: Present legacy migration guidance and enforce version-aware Human Input creation behavior across existing, mixed, migrated, and new workflows.

### Modified Capabilities

None. The repository currently has no matching main OpenSpec capability to modify.

## Impact

- Affects only OpenSpec and frontend code under `web/`: Human Input routing and presentation, the temporary batch migration mock adapter, workflow/node-selector surfaces, graph state/history, existing draft synchronization integration, and focused tests.
- Adds localized copy only to `web/i18n/en-US/` and `web/i18n/zh-Hans/`.
- The backend `node-data-migration` API is the final authoritative conversion source and will accept/return the complete legacy-node batch in one request. Until its generated client is available, the frontend uses an isolated API-shaped mock adapter; production orchestration MUST NOT depend directly on its local conversion internals.
- Does not modify backend API contracts or generated clients in this change.
- Does not implement backend migration business logic, change runtime execution, published workflow versions, or the legacy renderer used by unmigrated drafts.
