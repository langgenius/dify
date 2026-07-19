# Human Input v2

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
