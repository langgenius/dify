## ADDED Requirements

### Requirement: Channel application orchestration MUST be owned by IMChannelService
`IMChannelService` MUST be the only Dify application owner for IM Channel candidate test、read、create、ordinary update、explicit replacement and delete。`IMChannelReader` and `IMChannelWriter` MUST remain persistence-only。Identity、Binding、Sync/Reconciliation and runtime owners MUST NOT inherit or re-export Channel management operations。

#### Scenario: Channel configuration is created
- **WHEN** application accepts a Provider-confirmed Channel candidate
- **THEN** `IMChannelService` MUST construct the Channel and select Repository create
- **AND** no control-plane dependent Repository MUST participate

#### Scenario: Channel configuration is replaced
- **WHEN** explicit replacement is authorized
- **THEN** `IMChannelService` MUST select Repository replacement
- **AND** Identity、Binding and Sync owners MUST remain unchanged

### Requirement: Old Integration application transitions MUST be removed
`HumanInputIMIntegrationManagementService` and its composition are already removed。After Channel API migration，production code MUST remove their residual callers、application-only Integration management contracts、exports、credential envelope and revision usage。The change MUST NOT delete or modify dependent Domain/ORM/Repository/service modules merely because they retain `IntegrationId`、`integration_id`、imports or historical references。

#### Scenario: Old management owner is scanned
- **WHEN** import-linter and one-time migration verification inspect production Channel application code
- **THEN** `HumanInputIMIntegrationManagementService` and old management composition MUST be absent
- **AND** `IMChannelService` MUST own confirmed Channel API orchestration

#### Scenario: Dependent module retains Integration reference
- **WHEN** Identity、Binding、Sync、Inbox、authorization、delivery or historical code still references Integration identity
- **THEN** that module MUST remain byte-for-behavior unchanged
- **AND** its migration MUST belong to a later independent change

### Requirement: Webhook routing configuration MUST remain outside Channel credentials
`webhook_id` MUST remain Dify-owned routing metadata stored separately from `IMEncryptedCredentials`。Deployment event transport mode and full `webhook_url` MUST NOT be persisted in `IMChannel`、`HumanInputIMChannel` or the credential envelope。Credential rotation MUST preserve `webhook_id`；replacement and delete/recreate MUST use a new value。

#### Scenario: Channel credentials rotate
- **WHEN** ordinary update preserves Channel identity
- **THEN** it MUST also preserve `webhook_id`
- **AND** the encrypted credential payload MUST NOT contain deployment mode or callback URL
