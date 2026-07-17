# Contacts IM Platform

Organization-scoped IM platform binding and directory-sync UI for the Contacts domain.

## Mount Points

- CE / SaaS workspace management mounts this feature from `app/components/header/account-setting`.
- Enterprise-plan workspaces do not expose this binding entry. The Account Settings shell checks `ProviderContext.plan.type` before mounting the feature.
- `features/agent-v2/roster` is intentionally outside this feature boundary and must not import or mount Contacts IM platform UI.

The entry requires both a non-enterprise workspace plan and the existing `NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW` product gate. Setting the flag to `false`, or changing the workspace to the enterprise plan, removes the mock-backed entry without deleting saved frontend code or affecting Contacts data.

## Internal Modules

- `types.ts` defines provider, connection, sync, command, pagination, and safe-error contracts.
- `repository.ts` defines the replaceable frontend data boundary.
- `mock/scenarios.ts` owns named deterministic fixtures and consistency validation.
- `mock/repository.ts` owns in-memory mutations and explicitly controlled sync transitions.
- `composition.tsx` injects Organization context and either a mock or future repository adapter.
- `hooks.ts` is the only React Query access layer used by feature components.
- `management-surface.tsx` owns binding status, provider selection, diagnostics, and confirmations.
- `binding-dialog.tsx` and `provider-form-adapters.ts` own credential and mock OAuth flows.
- `account-setting-page.tsx` is the non-enterprise workspace-settings composition root.

## External Modules

- `app/components/header/account-setting`
- `config`
- `@tanstack/react-query`
