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
- Recipients and DebugMode write the affected DSL field immediately. MessageTemplate keeps a mounted dialog draft until Save or Save and test. All updates preserve unrelated node configuration.

## External modules

- Reuses only the narrow shared form/action/timeout types and components from `human-input/shared`.
- Uses existing workflow variable and edge utilities for selectors and action handles.
- Contact selection and node summaries use generated `contactOptions` queries. The publish checklist shares the authoritative batch lookup; loading or failed lookups are not proof that a contact was deleted.
- The picker paginates explicitly. Source filtering applies to loaded records because the current editor-safe endpoint does not expose a source filter. It never loops through all pages to find a match.
- Message-template tests save the current draft before sending through a configured channel; the dialog owns draft and mutation state for its mounted session.
- No graphon, backend, runtime or simulated execution dependency is introduced.
