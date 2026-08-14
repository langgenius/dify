## ADDED Requirements

### Requirement: OAuth management MUST extend only the canonical Channels facade

Cloud Slack OAuth authorize, callback, reauthorization, legacy migration and disconnect MUST extend the canonical Human Input Channels management boundary. The duplicate `im-integration` management surface MUST NOT gain equivalent OAuth operations.

#### Scenario: Administrator starts Slack OAuth

- **WHEN** a trusted administrator invokes a supported Slack OAuth operation
- **THEN** the Channels facade MUST derive workspace, actor and deployment context on the server
- **AND** it MUST dispatch through the Slack OAuth management port

#### Scenario: OAuth operation is requested on a duplicate route

- **WHEN** a caller addresses a deprecated or duplicate `im-integration` management route
- **THEN** that route MUST NOT create authorization state or mutate an OAuth installation

#### Scenario: Public OAuth callback completes

- **WHEN** Slack redirects to the public OAuth callback
- **THEN** callback authorization MUST come from the atomically consumed server-side state rather than an authenticated browser session
- **AND** the resulting write MUST still enforce the captured trusted Channels scope and CAS context

## MODIFIED Requirements

### Requirement: Common channel views MUST be credential-free persisted-state snapshots

Every configured or available channel MUST be represented by a common safe view of its persisted configuration state while provider-specific secrets and persistence records remain behind its handler. A candidate test outcome MUST NOT be represented as a `ChannelView` or mix candidate fields with current persisted fields. The view MUST expose only the deployment-aware auth mode, availability, lifecycle and operation capabilities needed to select a safe management flow.

#### Scenario: Configured Email is viewed

- **WHEN** the Resend Email channel is configured
- **THEN** the common view MUST expose Email kind, Resend provider, Workspace scope, configured state, safe sender summary and supported capabilities
- **AND** it MUST NOT expose plaintext, encrypted or masked API key material

#### Scenario: Configured IM is viewed

- **WHEN** an IM integration is configured
- **THEN** the common view MUST expose IM kind, provider, effective ownership scope, safe connection status and supported capabilities
- **AND** it MUST NOT expose credentials, provider raw payloads, identities, bindings or ORM records

#### Scenario: Cloud Slack OAuth installation is viewed

- **WHEN** a Cloud Slack channel is listed or read
- **THEN** the view MUST expose `oauth` auth mode, deployment availability, safe installation lifecycle, supported OAuth operations and credential mode
- **AND** it MUST NOT expose official App configuration, OAuth state, token fields, token presence flags, granted raw provider payload or refresh diagnostics

#### Scenario: Legacy Cloud Slack connection is viewed

- **WHEN** an existing Cloud Slack Integration remains `self_managed`
- **THEN** the view MUST identify it as legacy and advertise migration only when migration is available
- **AND** it MUST remain represented as the current configured channel until explicit migration or deletion

#### Scenario: Channel status is read

- **WHEN** a channel is listed or read
- **THEN** its status and last-check metadata MUST be treated as a non-live snapshot
- **AND** management MUST NOT perform provider I/O to refresh that snapshot
- **AND** management MUST NOT refresh it from delivery/send logs or a provider probe until a later capability explicitly defines that behavior

#### Scenario: A candidate connection is tested

- **WHEN** a provider accepts or evaluates candidate settings
- **THEN** management MUST return a credential-free `ChannelTestResult` describing only that candidate test
- **AND** it MUST NOT copy configured state, persisted integration identity or configuration revision into the test result
- **AND** it MUST NOT present candidate fields as the current persisted channel view

### Requirement: Management commands MUST preserve provider-specific configuration types

Save and test operations MUST use discriminated channel/provider commands rather than untyped configuration maps. Cloud Slack OAuth management MUST use operation-specific commands and MUST NOT synthesize or accept a Slack credential candidate.

#### Scenario: Resend candidate is submitted

- **WHEN** a command carries an Email/Resend discriminator
- **THEN** management MUST validate it as a complete Resend candidate before invoking the Email handler

#### Scenario: IM candidate is submitted

- **WHEN** a command carries an IM/provider discriminator in a deployment mode that supports credential candidates
- **THEN** management MUST validate the matching provider-specific integration command before invoking the IM handler
- **AND** IM secret fields MUST accept only explicit new secret values in this change
- **AND** management MUST NOT define an existing-secret retention directive for IM candidates

#### Scenario: Cloud Slack credential candidate is submitted

- **WHEN** a new Cloud Slack save or test request contains App ID, App secret, signing secret, bot token or app token candidate fields
- **THEN** management MUST reject it before provider or persistence work
- **AND** it MUST direct supported management through the declared OAuth operations

#### Scenario: Cloud Slack OAuth operation is submitted

- **WHEN** a command carries a Slack OAuth operation discriminator
- **THEN** management MUST validate only that operation's intent and complete Integration CAS fields
- **AND** it MUST NOT accept deployment App credentials or installation tokens in the command

#### Scenario: Discriminator and payload disagree

- **WHEN** the channel/provider discriminator does not match the candidate payload
- **THEN** management MUST reject the command before handler, provider or persistence work

#### Scenario: A test command succeeds

- **WHEN** a discriminated Email or self-managed IM candidate test succeeds
- **THEN** the operation envelope MUST contain exactly one test result
- **AND** it MUST contain neither a persisted-state view nor a failure

### Requirement: Channel capabilities MUST define valid management operations

Each channel view MUST advertise the management operations implemented for its provider, deployment auth mode and current persisted lifecycle. Credential validity and current provider health belong to the separate status snapshot. Management MUST reject operations that the selected channel view does not support.

#### Scenario: Email capabilities are returned

- **WHEN** the Resend Email channel is listed
- **THEN** its capabilities MUST describe configuration, test, delete and secret-retention support

#### Scenario: Self-managed IM capabilities are returned

- **WHEN** an IM provider is listed in `credentials` auth mode
- **THEN** its capabilities MUST describe the implemented configuration, test, delete and provider-replacement operations
- **AND** it MUST NOT advertise secret retention until its concrete provider port implements existing-secret resolution and protected credential merging

#### Scenario: Unconfigured Cloud Slack capabilities are returned

- **WHEN** Cloud Slack OAuth is available and no Slack Integration exists
- **THEN** capabilities MUST advertise `authorize`
- **AND** they MUST NOT advertise credential save, credential test, reauthorize or disconnect

#### Scenario: Active Slack OAuth capabilities are returned

- **WHEN** an active Cloud Slack OAuth installation exists
- **THEN** capabilities MUST advertise `reauthorize` and `disconnect`
- **AND** they MUST NOT advertise tenant credential save or candidate test

#### Scenario: Legacy Cloud Slack capabilities are returned

- **WHEN** a Cloud Slack `self_managed` Integration is eligible for migration
- **THEN** capabilities MUST advertise explicit `migrate_legacy` and the operations safe for the legacy state
- **AND** they MUST NOT describe the connection as a new OAuth installation

#### Scenario: Disconnecting Slack capabilities are returned

- **WHEN** an OAuth installation is `disconnecting`
- **THEN** capabilities MUST omit authorize, reauthorize and migration
- **AND** they MUST expose only idempotent recovery operations supported by the backend

#### Scenario: Unsupported operation is requested

- **WHEN** a caller requests an operation absent from the current channel capabilities
- **THEN** management MUST return a stable unsupported-operation result before side effects
