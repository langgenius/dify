## ADDED Requirements

### Requirement: Workspace Contact binding reads MUST use current application projections

Workspace Contact detail、contact-options list/batch 和 synchronized IM identity search MUST be implemented through transport-neutral Dify application services. Contact reads MUST consume the lifecycle owner's current workspace-scoped resolution and MUST NOT initialize, backfill or repair Contact state. Identity candidates MUST come from persisted synchronized identities and MUST support provider user ID search rather than free-text binding targets.

#### Scenario: An administrator reads a current Contact

- **WHEN** a Workspace administrator requests a Contact that currently resolves as `WORKSPACE`, `PLATFORM` or `EXTERNAL`
- **THEN** the controller MUST return the current admin-safe Contact projection from the shared query service

#### Scenario: An unavailable Contact is read

- **WHEN** a requested Contact is `ABSENT`, hard-deleted or otherwise unavailable in the current workspace
- **THEN** detail MUST return not found and list/options queries MUST omit it
- **AND** no read path MAY invoke initialization or lifecycle repair

#### Scenario: A workflow editor searches contact options

- **WHEN** an authorized workflow editor searches current Contact options
- **THEN** the application service MUST return only `id`, `type`, `name`, `avatar_url` and nullable `email`
- **AND** it MUST NOT expose IM binding or Contact management metadata

#### Scenario: An administrator searches synchronized identities

- **WHEN** an authorized administrator searches by display name, Email or provider user ID
- **THEN** the shared identity query MUST return persisted synchronized identities including identities without a current binding
- **AND** the binding command MUST require a persisted identity reference rather than a free-text provider user ID

### Requirement: Workspace binding mutations MUST converge in ContactIMBindingService

Workspace Organization binding create/delete and workspace override set/reset controllers MUST call the shared `ContactIMBindingService`. Controllers MUST restrict themselves to authentication/authorization、trusted scope/actor construction、DTO mapping and stable error translation, and MUST NOT directly orchestrate repositories、locks、owner predicates or binding persistence.

#### Scenario: An Organization binding is created

- **WHEN** an authorized Workspace administrator binds a current Contact to a synchronized identity at Organization scope
- **THEN** the controller MUST call `ContactIMBindingService` with trusted scope, Contact and identity references
- **AND** the service MUST own the guarded transaction and return the effective binding projection

#### Scenario: An Organization binding is deleted

- **WHEN** an authorized administrator deletes the current Organization binding
- **THEN** the controller MUST delegate owner validation and mutation to `ContactIMBindingService`
- **AND** it MUST NOT delete an unrelated workspace override outside the service policy

#### Scenario: A workspace override is reset

- **WHEN** an authorized administrator resets a Contact's workspace override
- **THEN** the service MUST remove only the workspace override and restore the Organization binding as the effective binding when one exists
- **AND** it MUST NOT delete the underlying Organization binding

#### Scenario: The same identity is reused across scopes

- **WHEN** one synchronized identity is referenced by an Organization binding and an allowed workspace override
- **THEN** the service MUST evaluate scope-aware owner predicates and MUST NOT reject the mutation solely as a global identity uniqueness conflict

#### Scenario: A controller observes a stable application failure

- **WHEN** the service reports contact/identity not found、binding conflict、invalid scope or write unavailable
- **THEN** the controller MUST translate the typed outcome to a stable safe response
- **AND** it MUST NOT expose repository、lock or raw exception details
