## MODIFIED Requirements

### Requirement: Channel capabilities MUST define valid management operations

Each channel view MUST advertise the management operations implemented for its provider and whether the current deployment supports complete directory synchronization for that provider. Capabilities are server-owned provider/deployment declarations; credential validity and current provider health belong to the separate status snapshot. Management MUST reject operations that the selected channel does not support, and clients MUST NOT infer directory-sync eligibility from provider names or local mock definitions.

#### Scenario: Email capabilities are returned

- **WHEN** the Resend Email channel is listed
- **THEN** its capabilities MUST describe configuration, test, delete and secret-retention support
- **AND** it MUST NOT advertise IM directory synchronization

#### Scenario: IM capabilities are returned

- **WHEN** an IM provider is listed
- **THEN** its capabilities MUST describe configuration, test, delete and provider-replacement support implemented by that provider
- **AND** it MUST NOT advertise secret retention until its concrete provider port implements existing-secret resolution and protected credential merging

#### Scenario: Complete directory sync is supported

- **WHEN** an IM provider has a production management path, complete-directory adapter and executable worker path in the current deployment
- **THEN** its safe channel view MUST advertise directory-sync capability independently from connection status
- **AND** a client MUST additionally require connected persisted status before enabling manual sync

#### Scenario: Directory sync is incomplete

- **WHEN** an IM provider lacks any required management, directory, worker or deployment support
- **THEN** its safe channel view MUST omit directory-sync capability or mark the provider safely unavailable
- **AND** a client MUST NOT enable sync by recognizing the provider value

#### Scenario: Unsupported operation is requested

- **WHEN** a caller requests an operation absent from the channel capabilities
- **THEN** management MUST return a stable unsupported-operation result before side effects

## ADDED Requirements

### Requirement: Successful IM configuration MUST persist verified connectivity

A concrete IM save path that validates credentials and provider tenant identity MUST persist the resulting safe connectivity diagnostic together with the accepted configuration. A separate candidate test MUST remain non-persistent.

#### Scenario: New Slack configuration validates successfully

- **WHEN** Slack accepts the candidate credentials, confirms required scopes, and returns the provider tenant identity during save
- **THEN** the persisted Integration MUST have connected status and a trusted `last_checked_at`
- **AND** the returned safe channel view MUST be immediately eligible for directory sync when it advertises that capability

#### Scenario: Existing Slack credentials rotate successfully

- **WHEN** a complete-revision save validates replacement credentials for the same provider tenant
- **THEN** the configuration transition MUST persist the connected diagnostic without an additional `config_version` increment beyond the configuration write
- **AND** existing identities and bindings MUST remain governed by the credential-rotation invariant

#### Scenario: Candidate validation fails

- **WHEN** provider authentication, required scope validation, or tenant identity resolution fails during save
- **THEN** no configuration or connectivity diagnostic MUST be created or replaced
- **AND** the response MUST contain only the stable safe provider failure

#### Scenario: Candidate is tested without save

- **WHEN** a candidate test succeeds for an unconfigured or configured IM channel
- **THEN** management MUST return a credential-free `ChannelTestResult`
- **AND** it MUST NOT persist credentials, status, `last_checked_at`, or a configuration revision
