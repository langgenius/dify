# Architecture review

The [API agent guide](../../../../api/AGENTS.md) owns package boundaries. In particular, `api/core/` is migration-only: do not propose new files or extracted implementations there.

## Transport and domain boundaries

Controllers own request parsing, service calls, and response serialization. Trace business decisions to their service or domain owner; flag controller policy when it duplicates or bypasses that owner. Move extracted behavior to an appropriate owner outside `core/`.

## Dependency direction

Transport layers may depend on services and domain contracts. Domain code must not import controller or request context. Pass validated actor, tenant, and resource data explicitly instead of reaching upward for it. Check existing owners and import-linter contracts before proposing a shared abstraction.

## Business-agnostic libraries

`api/libs/` must not own product policy or orchestration. Flag service/controller dependencies and domain-specific decisions in library helpers. Move that behavior to its existing service or domain owner outside `core/`; retain only reusable infrastructure in `libs/`.
