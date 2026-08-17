## ADDED Requirements

### Requirement: Workspace Contact read endpoints MUST filter unavailable Contacts before pagination

`GET /console/api/workspaces/current/human-input/contacts/<contact_id>` MUST return a Contact only when it resolves as `WORKSPACE`、`PLATFORM` or `EXTERNAL` in the requested workspace. Otherwise，the endpoint MUST return `404 Not Found`. `GET /console/api/workspaces/current/human-input/contact-options` MUST restrict candidates to those three resolution states and apply `keyword` before calculating `total`. It MUST apply `page / limit` to that same filtered result set. `GET /console/api/workspaces/current/human-input/contact-options/batch` MUST evaluate only the requested `contact_ids` and omit missing or unavailable Contacts. These endpoints MUST NOT create、update or delete a Contact. They MUST NOT invoke Contact initialization or periodic reconciliation.

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

#### Scenario: Contact option pagination excludes unavailable matches

- **WHEN** `keyword` matches both available and unavailable Contacts
- **THEN** the endpoint MUST exclude unavailable Contacts before calculating `total`
- **AND** the requested `page / limit` MUST select rows from the filtered result set

#### Scenario: A workflow editor reloads saved Contact IDs

- **WHEN** contact-options batch receives available、missing and unavailable `contact_ids`
- **THEN** it MUST query only those IDs and return only the available Contacts in request order

### Requirement: Binding identity candidates MUST come from IMSyncService

Synchronized IM identity search MUST call `IMSyncService.search_identities`. The query MUST return persisted synchronized identities. Binding commands MUST identify the target by persisted identity ID. They MUST NOT accept a free-text provider user ID.

#### Scenario: An administrator searches synchronized identities

- **WHEN** an authorized administrator searches by display name, Email or provider user ID
- **THEN** the shared identity query MUST return persisted synchronized identities including identities without a current binding
- **AND** the binding command MUST require a persisted identity reference rather than a free-text provider user ID

### Requirement: Workspace binding mutations MUST converge in ContactIMBindingService

On CE and SaaS deployments, where the current workspace is the complete Organization, Workspace Organization binding create/delete and workspace override set/reset controllers MUST call the shared `ContactIMBindingService`. On EE deployments, Workspace controllers MUST NOT create or delete Organization bindings; that authorization belongs to the enterprise-administrator transport outside this change. Every permitted controller MUST restrict itself to authentication/authorization、trusted scope/actor construction、DTO mapping and stable error translation, and MUST NOT directly orchestrate repositories、locks、owner predicates or binding persistence.

#### Scenario: A CE or SaaS Organization binding is created

- **WHEN** the deployment shape is CE or SaaS and an authorized workspace owner or administrator binds a current Contact to a synchronized identity using the current workspace as the Organization scope
- **THEN** the controller MUST call `ContactIMBindingService` with trusted scope, Contact and identity references
- **AND** the service MUST own the guarded transaction and return the effective binding projection

#### Scenario: An EE Workspace administrator attempts an Organization binding mutation

- **WHEN** the deployment shape is EE and a Workspace administrator requests creation or deletion of an Organization binding through a Workspace controller
- **THEN** the controller MUST reject the request before calling a binding mutation
- **AND** the request MUST NOT be treated as authorized enterprise-administrator transport traffic

#### Scenario: A CE or SaaS Organization binding is deleted

- **WHEN** the deployment shape is CE or SaaS and an authorized workspace owner or administrator deletes the current Organization binding through a Workspace controller
- **THEN** the controller MUST delegate owner validation and mutation to `ContactIMBindingService`
- **AND** it MUST NOT delete an unrelated workspace override outside the service policy

#### Scenario: A workspace override is reset

- **WHEN** an authorized administrator resets a Contact's workspace override
- **THEN** the service MUST remove only the workspace override and restore the Organization binding as the effective binding when one exists
- **AND** it MUST NOT delete the underlying Organization binding

#### Scenario: The same identity is reused across scopes

- **WHEN** one synchronized identity is referenced by an Organization binding and an allowed workspace override
- **THEN** the service MUST validate Contact and identity ownership and binding uniqueness within the requested Organization or Workspace scope
- **AND** it MUST NOT reject an otherwise valid workspace override merely because the identity is referenced by a binding in another allowed scope

#### Scenario: A controller observes a stable application failure

- **WHEN** the service reports contact/identity not found、binding conflict、invalid scope or write unavailable
- **THEN** the controller MUST translate the typed outcome to a stable safe response
- **AND** it MUST NOT expose repository、lock or raw exception details
