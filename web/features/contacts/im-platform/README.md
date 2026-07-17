# Contacts IM Platform

Organization-scoped IM platform binding and directory-sync UI for the Contacts domain.

## Mount Points

- CE / SaaS workspace management mounts this feature from `app/components/header/account-setting`.
- The open-source web tree does not contain a separate EE enterprise-management shell. The feature therefore exposes an Organization context boundary with an `enterprise` scope so that the EE shell can mount the same surface without importing workspace UI.
- `features/agent-v2/roster` is intentionally outside this feature boundary and must not import or mount Contacts IM platform UI.

The entry is guarded by the existing `NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW` product gate. Setting the flag to `false` removes the mock-backed entry without deleting saved frontend code or affecting Contacts data.

## Internal Modules

None.

## External Modules

- `app/components/header/account-setting`
- `config`
