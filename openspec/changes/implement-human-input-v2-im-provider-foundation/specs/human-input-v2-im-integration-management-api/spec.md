## ADDED Requirements

### Requirement: Integration management MUST use one Dify application service

`IMIntegrationManagementService` MUST exclusively own Integration read、configure、delete 和 connection-test application operations。Sync and Card application services MUST consume current Integration state but MUST NOT own duplicate configuration commands. The service factory, command/query values, result projections, and typed errors MUST remain transport-neutral. Workspace/trusted internal routes、Pydantic DTO、authentication/scope/metadata mapping、HTTP error mapping 和 controller tests MUST remain owned by `human-input-v2-api-contracts`.

#### Scenario: Two transport consumers configure Integration
- **WHEN** workspace and trusted-internal consumers submit equivalent valid configuration commands
- **THEN** both MUST resolve the same local Dify management service and receive the same provider-neutral result semantics

#### Scenario: EE must not become a configuration owner
- **WHEN** a configuration command originates from the EE façade
- **THEN** the Dify service MUST remain the only persistence and decryption owner, and EE MUST NOT persist or decrypt the configuration locally

### Requirement: Integration writes MUST preserve complete CAS and secret operations

Updating or deleting an existing Integration MUST require the complete `integration_id + config_version` token. Secret-bearing fields MUST use explicit replace or preserve operations; application results MUST contain only masked values. Provider or provider-tenant replacement MUST remain distinct from credential rotation.

#### Scenario: Current configuration is updated
- **WHEN** a command supplies the current CAS token and valid replace/preserve operations
- **THEN** the management service MUST apply exactly one configuration transition and return the advanced revision

#### Scenario: Stale configuration is updated
- **WHEN** a command supplies an obsolete Integration ID or configuration version
- **THEN** the service MUST reject it with the stable stale-revision result without changing credentials, identities or bindings

#### Scenario: Credentials rotate within the same provider tenant
- **WHEN** provider and provider tenant remain confirmed unchanged
- **THEN** the service MUST preserve current identities and bindings while advancing configuration revision

### Requirement: Connection tests MUST not become configuration writes

Connection tests MUST validate credential syntax, authenticate the provider, confirm provider tenant and required Human Input baseline access, and return only safe diagnostics. A test MUST NOT persist submitted secrets, replace current configuration or advance configuration revision.

#### Scenario: Candidate credentials are tested
- **WHEN** an application consumer tests unsaved provider configuration
- **THEN** Foundation MUST use the candidate only for the bounded diagnostic operation and MUST discard plaintext material afterward

#### Scenario: Required provider baseline is unavailable
- **WHEN** directory, message send/update or tenant-confirmation access is missing
- **THEN** the service MUST return a stable permission or unsupported-provider diagnostic without creating an Integration

### Requirement: Management projections MUST include event transport configuration safely

The transport-neutral Integration management result MUST expose provider-neutral `DISABLED`, `WEBHOOK` or `STREAM` mode, supported event transport choices, derived webhook URL when applicable and safe operational health. It MUST NOT expose webhook verification material, stream credentials, lease owner or fencing token.

#### Scenario: Existing Integration is read after migration
- **WHEN** an Integration predates event transport configuration
- **THEN** it MUST project `DISABLED` and MUST continue supporting manual sync, binding and outbound messaging

#### Scenario: Stream health is read
- **WHEN** a `STREAM` Integration has an active or degraded connection
- **THEN** the projection MUST expose only safe status and timestamps without changing `config_version`
