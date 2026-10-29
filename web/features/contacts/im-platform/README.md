# Contacts IM Platform

Organization-scoped IM platform binding and directory-sync UI for the Contacts domain.

## Mount Points

- CE / SaaS workspace management mounts this feature from `app/components/header/account-setting`.
- Centrally managed deployments do not expose this workspace binding entry. The Account Settings shell checks `im_centrally_managed` from `/features` before mounting the feature.
- `features/agent-v2/roster` is intentionally outside this feature boundary and must not import or mount Contacts IM platform UI.

The entry requires the dedicated `NEXT_PUBLIC_ENABLE_HITL_IM` release gate to be
`true` and `im_centrally_managed` to be `false`. The release gate defaults to
`false`, independently of `NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW`. Disabled or
unavailable entries also reject the IM platform settings deep link. Changing the
release gate requires restarting Web and reloading the page. Turning it off also
restores legacy V1 editing/form entry points and disables V2 editors, migration,
and approval entry points. Saved V2 data and channel credentials are preserved;
V2 tokens are never sent through legacy V1 transports.

## Internal Modules

- `types.ts` defines provider, connection, sync, command, pagination, and safe-error contracts.
- `repository.ts` defines the replaceable frontend data boundary.
- `__tests__/fixtures/scenarios.ts` owns named deterministic fixtures and consistency validation.
- `__tests__/fixtures/repository.ts` owns in-memory mutations and explicitly controlled sync transitions.
- `composition.tsx` injects Organization context and the runtime API repository adapter.
- `hooks.ts` is the only React Query access layer used by feature components.
- `management-surface.tsx` owns binding status, provider selection, diagnostics, and confirmations.
- `binding-dialog.tsx` and `provider-form-adapters.ts` own credential and mock OAuth flows.
- `sync-section.tsx` owns manual-trigger eligibility, active-run recovery, and summary presentation.
- `sync-details-dialog.tsx` owns the URL-addressable, filtered, paginated, read-only result view.
- `sync-run-url-state.ts` keeps the selected run in the `sync_run_id` query parameter.
- `account-setting-page.tsx` is the workspace-managed settings composition root.

## External Modules

- `app/components/header/account-setting`
- `config`
- `@tanstack/react-query`
