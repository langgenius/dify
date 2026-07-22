## Why

Workflows that still contain legacy Human Input nodes need a clear, safe path to the version-2 node before the product can make v2 the only addable Human Input experience. Without migration guidance and gating, users can mix incompatible node generations or lose legacy delivery configuration while rebuilding nodes manually.

## What Changes

- Detect legacy Human Input nodes in the frontend using the persisted discriminator: a Human Input node is v2 only when `version` is the exact string `"2"`; existing non-v2 nodes continue to render and edit with the legacy implementation until migrated.
- Add the Figma-defined legacy guidance states: workflow banner, `OLD VERSION` labels on the legacy canvas node and panel, a disabled Human Input entry in the node selector, and a migration call to action in its preview.
- **BREAKING**: Remove legacy Human Input from creation choices. New apps expose only the v2-backed Human Input entry, while any workflow containing a legacy Human Input keeps that entry visible but disabled until all legacy nodes are migrated.
- Add a confirmation flow that submits every legacy Human Input node in the current draft to the backend batch node-data migration helper, then atomically replaces node data with the complete returned v2 definitions before using the existing draft synchronization path.
- Prevent partial migration: a backend conversion error or incomplete response leaves the graph unchanged and produces recoverable localized feedback; a draft-sync failure restores the original graph.
- Show the Figma-defined success toast after migration, remove legacy guidance, and immediately enable the v2 Human Input creation entry.
- Add focused frontend tests and user-facing translations in English and Simplified Chinese only.

## Capabilities

### New Capabilities

- `human-input-v2-migration`: Detect legacy nodes, request backend batch conversion, atomically apply the returned v2 node definitions, persist the draft, and recover from conversion or synchronization failure.
- `human-input-version-rollout-ui`: Present legacy migration guidance and enforce version-aware Human Input creation behavior across existing, mixed, migrated, and new workflows.

### Modified Capabilities

None. The repository currently has no matching main OpenSpec capability to modify.

## Impact

- Affects Human Input routing and presentation, workflow/node-selector surfaces, graph state/history and existing draft synchronization integration, plus focused frontend tests under `web/`.
- Adds localized copy only to `web/i18n/en-US/` and `web/i18n/zh-Hans/`.
- Consumes the separately specified workspace console batch node-data migration helper but does not implement backend conversion logic, runtime execution, published workflow migration, or changes to the legacy renderer used by unmigrated drafts.
- Recipient/contact resolution, delivery-method conversion, message/debug mapping, deduplication, and blocker validation are backend responsibilities. The frontend treats successful returned node data as authoritative and does not reinterpret it.
