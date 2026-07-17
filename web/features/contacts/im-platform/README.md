# Contacts IM Platform

Organization-scoped IM platform binding and directory-sync UI for the Contacts domain.

## Mount Points

- CE / SaaS workspace management mounts this feature from `app/components/header/account-setting`.
- Enterprise-plan workspaces do not expose this binding entry. The Account Settings shell checks `ProviderContext.plan.type` before mounting the feature.
- `features/agent-v2/roster` is intentionally outside this feature boundary and must not import or mount Contacts IM platform UI.

The entry requires both a non-enterprise workspace plan and the existing `NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW` product gate. Setting the flag to `false`, or changing the workspace to the enterprise plan, removes the mock-backed entry without deleting saved frontend code or affecting Contacts data.

## Internal Modules

None.

## External Modules

- `app/components/header/account-setting`
- `config`
