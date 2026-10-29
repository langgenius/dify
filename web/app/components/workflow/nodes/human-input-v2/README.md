# Human Input v2

## Release rollback

`NEXT_PUBLIC_ENABLE_HITL_IM` defaults to `false`. When disabled, creation uses
legacy V1 Human Input nodes and migration/insertion of V2 nodes is unavailable.
Saved V2 nodes retain their version, recipients and edges, but their editors and
contact providers do not mount and validation prevents V2 runs or publishing.
New standalone V2 approval routes are closed; legacy V1 forms remain available.
Changing the flag requires restarting Web and reloading the page.

The flag controls frontend availability. It does not roll back persisted data or
stop server-side runs and notifications that are already in progress.

## Internal modules

- `types.ts` owns the exact frontend wire contract and version guard.
- `default.ts` owns catalog metadata, creation defaults, validation and outputs.
- `recipient-utils.ts` owns pure recipient validation and immutable list operations.
- UI components edit local drafts and write the complete affected DSL field atomically.

## External modules

- Reuses only the narrow shared form/action/timeout types and components from `human-input/shared`.
- Uses existing workflow variable and edge utilities for selectors and action handles.
- Contact options come through the local typed provider boundary; this feature does not call a Contact API.
- No graphon, backend, runtime or simulated execution dependency is introduced.
