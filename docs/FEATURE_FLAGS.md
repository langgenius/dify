# Feature Flags

Use named feature flags or policies instead of comparing deployment editions.
This guide defines shared principles and API boundaries. Web code must also follow
its [Deployment Edition Policies] and [System Features frontend contract].

## Principles

- Define independent flags for capabilities, not editions. Editions select combinations
  of defaults; avoid generic `is_cloud` or `is_enterprise` switches.
- System Features describe deployment-wide policies; ordinary Features describe
  capabilities that may vary by workspace. Backend feature services resolve configuration
  and applicable overrides so business callers use the effective capability.
- Frontend feature policies may derive presentation capabilities in their designated
  modules. Hiding a control does not enforce availability or authorization; backend
  routes and operations must check both independently of UI visibility.

## Adding a public System Features field

Public System Features bootstrap login and initialization. Check every proposed field:

1. **Is it needed before authentication?** Name the production login or initialization
   consumer and what it must render or decide before authentication. Navigation,
   settings, plugin management, and editor-only data do not qualify.
2. **Is it safe to disclose anonymously?** Do not publish user permissions, workspace
   quotas, backend limits, or internal policy inputs merely to let the UI show a button.
3. **Does it directly drive login or initialization?** Return the effective capability
   or bootstrap value the page needs, such as password recovery availability, rather
   than raw mail configuration for the frontend to interpret.
4. **Does it belong on each surface that will receive it?** Console login methods
   and registration differ from WebApp authentication and public-access rules. Check
   consumers and meaning separately; sharing a response type does not justify exposing
   a value to both surfaces.
5. **Can it stay valid for the bootstrap snapshot's lifetime?** Values that need
   regular refresh, such as current permissions or quota usage, belong in an authenticated
   API with an appropriate refresh policy.

Add a field only when all five criteria are met; keep it out if any answer is unclear.
Existing fields are legacy inventory, not precedent for new ones.
The [Public System Features contract] defines the additional requirements and explicit
exceptions for the current shared API schema. These principles do not relax that contract.

## Choosing where a capability belongs

- Return post-login capabilities from the owning authenticated API. Group related
  capabilities there instead of creating an endpoint per flag or expanding public bootstrap.
- Keep feature availability distinct from user permissions, even when one response
  carries both. Do not add capability switches to permission keys.
- An authenticated shell response may carry navigation capabilities and the current
  workspace's default permission snapshot only when the shell itself needs them.
  Being used by a page under the common layout is insufficient.
- Keep page-specific capabilities and resource permission overrides in the corresponding
  feature or resource API. Keep backend enforcement inputs private unless a frontend
  consumer needs a safe, effective value.

## Fixing a lint error

Replace the raw edition import or decision with an existing capability. If none fits,
add a named flag or policy in the appropriate owner below, following that side's rules.
Rerun lint.

## Policy modules

### Backend

Resolve edition-dependent backend policies in:

- `api/services/feature_service.py`
- `api/services/system_feature_service.py`
- `api/services/knowledge_fs/feature_service.py`

### Web

Follow [Deployment Edition Policies] for the designated frontend modules and
[System Features frontend contract] for query ownership, bootstrap, and capability reads.

[Deployment Edition Policies]: ../packages/tooling/README.md#deployment-edition-policies
[Public System Features contract]: ../api/controllers/API_SCHEMA_GUIDE.md#public-system-features-contract
[System Features frontend contract]: ../web/features/system-features/README.md
