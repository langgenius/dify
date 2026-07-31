## ADDED Requirements

### Requirement: Provider integration diagnostics MUST expose one stable business-independent operation
Dify MUST validate candidate Provider credentials without passing Contact, binding, recipient, task or workflow objects into the Provider adapter. A successful diagnostic MUST return the provider, stable provider tenant ID, baseline permission result and compatibility with the deployment-owned effective event transport mode. The diagnostic MUST NOT persist candidate credentials or Integration state.

#### Scenario: Candidate credentials are valid
- **WHEN** an administrator tests credentials that identify one provider tenant and satisfy the required permissions and effective transport mode
- **THEN** diagnostics MUST return that provider tenant and safe compatibility facts without mutating Integration state

#### Scenario: Provider tenant cannot be confirmed
- **WHEN** credentials authenticate but diagnostics cannot determine a stable provider tenant ID
- **THEN** diagnostics MUST fail with a typed tenant-identification result and MUST NOT treat the credentials as a safe rotation of an existing Integration

### Requirement: Provider credential and verification material MUST remain provider-specific
The shared Integration contract MUST NOT flatten Provider credentials into one generic key/value map. Each Provider adapter MUST validate its own credential, verification and encryption material while returning the same diagnostic facts.

#### Scenario: Slack and Feishu credentials are validated
- **WHEN** Slack requires OAuth/bot/signing material and Feishu/Lark requires app credentials plus transport-specific verification material
- **THEN** each adapter MUST validate its own typed credential shape without forcing the other Provider to accept irrelevant fields

### Requirement: Effective event transport mode MUST be deployment-owned
Integration create, update and test operations MUST consume the effective `WEBHOOK` or `STREAM` mode from deployment configuration and MUST NOT accept a tenant- or administrator-selected override.

#### Scenario: Administrator attempts to select transport mode
- **WHEN** an Integration management request contains an event transport override
- **THEN** the request MUST be rejected before Provider diagnostics or credential persistence

#### Scenario: Deployment selects a supported mode
- **WHEN** deployment configuration selects a mode supported by the candidate Provider
- **THEN** Provider diagnostics MUST validate the candidate against that mode without persisting the mode in Integration credentials

### Requirement: Provider transport compatibility MUST follow the explicit initial matrix
Slack, Feishu/Lark and DingTalk MUST be compatible with both `WEBHOOK` and `STREAM`. WeCom and Microsoft Teams MUST be compatible with `WEBHOOK` and MUST be rejected for `STREAM`. The implementation MUST NOT infer new combinations from a generic extension registry.

#### Scenario: Microsoft Teams is tested under STREAM
- **WHEN** the effective deployment mode is `STREAM` and the candidate Provider is Microsoft Teams
- **THEN** diagnostics MUST return a typed unsupported-transport result before saving credentials

#### Scenario: DingTalk is tested under either supported mode
- **WHEN** the candidate Provider is DingTalk and the effective deployment mode is `WEBHOOK` or `STREAM`
- **THEN** diagnostics MUST continue with Provider-specific credential and permission validation

### Requirement: Integration deletion MUST be local-only
Deleting an Integration MUST make it unavailable to new sends and inbound business processing, stop any locally maintained stream connection, delete locally stored credentials, remove current organization bindings and workspace overrides, and preserve historical task, delivery and audit facts. Deletion MUST NOT call the Provider to revoke grants, uninstall the app, deregister a Webhook or modify remote event settings.

#### Scenario: STREAM Integration is deleted
- **WHEN** an active STREAM Integration is deleted
- **THEN** Dify MUST stop maintaining its local connection, remove local credentials and active bindings/overrides, and MUST perform no remote cleanup call

#### Scenario: Historical delivery exists during deletion
- **WHEN** an Integration with historical tasks and delivery records is deleted
- **THEN** current Provider access MUST be removed while historical display and audit facts remain readable

