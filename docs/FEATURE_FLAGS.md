# Feature Flags

Use named feature flags or policies instead of comparing deployment editions.

## Fixing a lint error

Reuse an existing flag or policy. If none fits, add one in the appropriate module
below, then replace the raw edition import or decision with that capability.
Name it after the behavior it controls, rather than introducing generic
`is_cloud` or `is_enterprise` wrappers. Rerun lint after the change.

## Policy modules

Define edition-dependent feature policies in these modules:

### Backend

- `api/services/feature_service.py`
- `api/services/system_feature_service.py`
- `api/services/knowledge_fs/feature_service.py`

### Web

- `web/features/system-features/state.ts` for derived capability atoms.
- `web/features/agent-v2/feature-flag.ts`
- `web/features/agent-v2/agent-detail/configure/feature-flags.ts`
- `web/features/contacts/management/feature-flag.ts`
- `web/features/contacts/im-platform/feature-flag.ts`
