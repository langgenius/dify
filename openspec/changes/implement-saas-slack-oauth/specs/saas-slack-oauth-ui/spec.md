## ADDED Requirements

### Requirement: Contacts Channels production UI MUST use the canonical generated client

The production Contacts Channels repository MUST map the canonical Console Channels API through generated `consoleClient` / `consoleQuery` bindings. Mock persistence MUST remain limited to tests, stories or explicit development fixtures.

#### Scenario: Channels page loads in production

- **WHEN** an administrator opens Contacts Channels in a production composition
- **THEN** the UI MUST list and read channel definitions from the canonical Channels API
- **AND** it MUST NOT instantiate the in-memory mock repository

#### Scenario: OAuth operation completes

- **WHEN** connect, reauthorize, migration or disconnect completes
- **THEN** the repository MUST invalidate or refetch the canonical Channels query
- **AND** rendered state MUST come from the server's current safe view rather than optimistic credential assumptions

#### Scenario: API returns a classified failure

- **WHEN** the generated client receives a stable channel failure category and safe provider code
- **THEN** the repository MUST preserve that classification for the management surface
- **AND** it MUST NOT expose raw transport or provider payload details

### Requirement: Slack management UI MUST follow server-declared auth mode and capabilities

The Contacts Channels UI MUST render Slack operations from the server-provided deployment-aware `auth_mode`, `availability`, lifecycle and capabilities. It MUST NOT infer Cloud, Community or Enterprise behavior from browser-owned flags.

#### Scenario: Cloud Slack is unconfigured and available

- **WHEN** the server returns Slack in `oauth` mode with `authorize` capability and no installation
- **THEN** the UI MUST display a Connect action
- **AND** it MUST NOT render App ID, App secret, signing secret, bot token or app token fields

#### Scenario: Cloud official App is unavailable

- **WHEN** the server marks Slack OAuth unavailable with a safe reason
- **THEN** the UI MUST disable Connect and display an administrator-actionable safe message
- **AND** it MUST NOT ask the tenant to supply official App credentials

#### Scenario: Community or Enterprise uses self-managed Slack

- **WHEN** the server returns Slack in `credentials` mode
- **THEN** the existing self-managed credential form and supported test/save/delete actions MUST remain available
- **AND** the OAuth popup flow MUST NOT replace those operations

#### Scenario: Unsupported operation is absent

- **WHEN** a channel view does not advertise an OAuth or credential operation
- **THEN** the UI MUST NOT render or invoke that operation

### Requirement: Cloud Slack OAuth UI MUST support connect, recovery and explicit migration

The UI MUST provide Connect, same-workspace Reauthorize, Disconnect and legacy migration flows according to the current server lifecycle, while treating the backend callback and subsequent channel refetch as authoritative.

#### Scenario: Connect succeeds

- **WHEN** the popup reports a valid same-origin successful Slack callback
- **THEN** the UI MUST close the pending flow, refetch the Slack channel and render the persisted workspace installation
- **AND** it MUST NOT persist OAuth state or token in browser storage

#### Scenario: Installation requires reauthorization

- **WHEN** the channel lifecycle is `reauthorization_required`
- **THEN** the UI MUST retain safe workspace identity and display Reauthorize plus Disconnect recovery actions
- **AND** it MUST not present the installation as able to send, sync or process interactions

#### Scenario: Legacy Cloud connection is shown

- **WHEN** the server returns a Cloud Slack connection in legacy `self_managed` mode with `migrate_legacy` capability
- **THEN** the UI MUST keep the current connection visible and offer an explicit OAuth migration action
- **AND** it MUST explain that migration requires the same Slack workspace

#### Scenario: Disconnect is pending

- **WHEN** the server returns `disconnecting`
- **THEN** the UI MUST disable connect, reauthorize and repeated destructive actions
- **AND** it MUST show retryable progress or safe failure state until the server completes deletion

#### Scenario: Workspace ownership conflicts

- **WHEN** connect or migration returns a workspace ownership conflict
- **THEN** the UI MUST display a safe recovery message without naming another Dify workspace or administrator

### Requirement: OAuth popup messaging MUST enforce opener and origin integrity

The OAuth popup helper and callback page MUST exchange only schema-validated, credential-free completion messages and MUST verify both the exact same origin and the popup window identity.

#### Scenario: Valid popup message arrives

- **WHEN** `event.origin` equals `window.location.origin`, `event.source` is the popup created for the current attempt, and the message matches the OAuth completion schema
- **THEN** the helper MUST settle the attempt exactly once and remove its message listener, interval and timeout

#### Scenario: Message comes from another origin

- **WHEN** a window sends an OAuth-shaped message from a different origin
- **THEN** the helper MUST ignore it without settling or mutating channel state

#### Scenario: Message comes from another same-origin window

- **WHEN** a same-origin window other than the tracked popup sends an OAuth-shaped message
- **THEN** the helper MUST ignore it

#### Scenario: Popup closes without completion

- **WHEN** the tracked popup closes or times out before a valid completion message
- **THEN** the helper MUST settle once with a cancelled or incomplete result and clean up all resources

#### Scenario: Callback page posts completion

- **WHEN** the backend redirects a completed Slack callback to the same-origin callback page with a safe result ticket
- **THEN** the page MUST post only provider, correlation and classified completion state to its opener using the exact origin
- **AND** it MUST NOT post OAuth code, server state, token, tenant identity or raw provider error

### Requirement: OAuth UI MUST handle concurrent and stale management state safely

The UI MUST serialize one local OAuth attempt per Slack channel and defer concurrency authority to backend state and Channel CAS.

#### Scenario: OAuth action is already pending

- **WHEN** Connect, Reauthorize or migration is pending in the current page
- **THEN** the UI MUST prevent another local OAuth attempt for that channel

#### Scenario: Server rejects stale state

- **WHEN** callback or disconnect fails because the captured Channel revision is stale
- **THEN** the UI MUST refetch the channel before enabling another action
- **AND** it MUST NOT silently retry with the newer revision

#### Scenario: Page reloads during OAuth

- **WHEN** the opener reloads or loses its in-memory popup correlation
- **THEN** an old callback message MUST NOT mutate the new page state
- **AND** the administrator MUST be able to read the authoritative persisted channel state
