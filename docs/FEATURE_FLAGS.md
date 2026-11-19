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

## Adding a public System Features field

Review a proposed field against each question below before adding it:

1. **Is it needed before authentication?** Name the production login or initialization
   consumer and explain what it must render or decide before authentication. A field used
   only in MainNav, settings, plugin management, or the Workflow editor does not qualify.
2. **Is it safe to disclose anonymously?** Do not publish user permissions, workspace
   quotas, backend limits, or internal policy inputs merely to let the UI show a button.
3. **Does it directly drive login or initialization?** Return the effective capability
   or bootstrap value the page needs. For example, report whether password recovery
   or verification-code delivery is available, rather than exposing raw mail setup
   or environment variables for the frontend to interpret.
4. **Do Console and WebApp need the same value with the same meaning?** Evaluate
   each endpoint and its consumers separately. A field used by only one surface must
   not be returned to both just because they share a response model.
5. **Can it remain in a long-lived browser snapshot?** The current System Features
   query uses `staleTime: Infinity`. Data that needs regular refresh, such as current
   workspace permissions or quota usage, does not belong in this snapshot.

Do not add the field if any of these questions cannot be answered concretely.
Existing fields are legacy inventory, not precedent for new ones.
The [Public System Features contract] defines the current schema requirements and
explicit exceptions.

## Choosing where a capability belongs

Console and WebApp bootstrap contracts serve different login flows. Sharing a small
type does not justify returning the same broad configuration object to both.

| Public endpoint                | Appropriate bootstrap data                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `/console/api/system-features` | Console login methods, registration availability, login-page branding, and the minimal license status needed before login |
| `/api/system-features`         | Public WebApp authentication methods, public-access rules, and WebApp login-page branding                                 |

Keep authenticated data with its owner:

- If the Console shell returns navigation capabilities and the current workspace's
  default permission snapshot together, use separate `capabilities` and `access` fields.
  Do not put feature switches inside permission keys or add an endpoint per flag.
- Admit only data that the shell itself needs to render or decide an entry. A field
  used by some page under the common layout is not automatically shell data.
- Load permissions overridden for a specific app or dataset from that resource's API.
  Page capabilities such as Workflow collaboration or account settings belong to the
  corresponding feature API, not the public bootstrap or a growing shell object.
- Keep backend-only enforcement inputs internal. Expose authenticated policy data only
  when a named frontend consumer needs it. For example, login may need minimal license
  status, while expiry details and seat usage belong to the authenticated license API.
- Determine ownership from the producer and consumers, not the field name. Workspace
  branding belongs to the workspace, Console deployment branding to the authenticated
  shell, and public WebApp branding to the app or site. Do not move an existing logo
  into the workspace response solely because its name contains `workspace`.

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

[Public System Features contract]: ../api/controllers/API_SCHEMA_GUIDE.md#public-system-features-contract
