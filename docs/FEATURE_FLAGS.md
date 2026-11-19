# Feature Flags

Use named feature flags or policies instead of comparing deployment editions.

## Principles

- Define independent flags for capabilities, not editions. Editions select combinations
  of defaults; avoid generic `is_cloud` or `is_enterprise` switches.
- Resolve deployment configuration and workspace capabilities in their respective backend
  feature modules. Callers use the effective flags from configuration and applicable
  overrides instead of repeating edition decisions.
- Frontend code uses capabilities to control presentation. Backend routes and operations
  enforce availability and user authorization independently of UI visibility.
- Keep public System Features small and safe for login and initialization. Evaluate
  Console and WebApp bootstrap needs separately; do not turn their responses into a
  shared configuration registry.
- Keep permissions, quotas, and workspace/page capabilities out of public bootstrap.
  When needed by the frontend, return them from their owning authenticated API. Availability
  and user permissions stay distinct even in one response; avoid an endpoint per flag.

## Fixing a lint error

Reuse an existing flag or policy. If none fits, add one in the appropriate module
below, then replace the raw edition import or decision with that capability.
Rerun lint after the change.

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
