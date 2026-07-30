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

#### Scenario: Provider is incompatible with deployment event transport
- **WHEN** candidate credentials target a provider that does not support the deployment-selected `WEBHOOK` or `STREAM` mode
- **THEN** the service MUST return a stable transport incompatibility without accepting a per-Integration mode override or changing persisted configuration

### Requirement: Management projections MUST expose deployment event transport as read-only

The transport-neutral Integration management result MUST expose the effective deployment-selected `DISABLED`, `WEBHOOK` or `STREAM` mode as read-only runtime context, a derived webhook URL only in `WEBHOOK` deployments, and safe per-Integration operational health. It MUST NOT expose tenant-selectable transport choices, accept mode updates, or expose webhook verification material, stream credentials, lease owner or fencing token.

#### Scenario: Integration is read in a disabled deployment
- **WHEN** an existing Integration is read while deployment event transport mode is `DISABLED`
- **THEN** the projection MUST report effective mode `DISABLED` without changing the Integration revision and manual sync, binding and outbound messaging MUST remain available

#### Scenario: Stream health is read
- **WHEN** deployment mode is `STREAM` and an Integration has an active or degraded persistent connection
- **THEN** the projection MUST expose only safe status and timestamps without changing `config_version`

#### Scenario: Deployment public webhook URL changes
- **WHEN** deployment public base URL or routing configuration changes while Integration secrets remain unchanged
- **THEN** a `WEBHOOK` projection MUST derive the new callback URL without writing the Integration or advancing `config_version`

#### Scenario: Caller attempts to update transport mode
- **WHEN** a workspace or trusted-internal command includes an Integration-level event transport mode
- **THEN** the application boundary MUST reject the field instead of persisting it or shadowing deployment configuration
