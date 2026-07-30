## ADDED Requirements

### Requirement: IM Integration MUST not own deployment event transport mode
`DISABLED`, `WEBHOOK` or `STREAM` MUST be selected by Dify deployment runtime configuration and MUST NOT be stored as IM Integration configuration, accepted by Integration management commands or participate in Integration compare-and-swap transitions. A webhook callback URL derived from deployment public configuration and non-secret Integration route identity MUST likewise remain a read-only runtime projection rather than mutable Integration configuration. Provider-specific credential and webhook verification/encryption material MAY remain encrypted Integration secrets and MUST continue to use explicit replace/preserve CAS semantics without making transport mode tenant-selectable.

#### Scenario: Deployment event transport mode changes
- **WHEN** a deployment rollout changes event transport mode between `DISABLED`, `WEBHOOK` and `STREAM`
- **THEN** existing Integration IDs, configuration revisions, provider tenants, credentials, identities and bindings MUST remain unchanged

#### Scenario: Integration verification material changes
- **WHEN** a current CAS command replaces provider-specific verification or encryption material
- **THEN** the Integration MUST advance configuration revision exactly once and old verification contexts MUST become stale without changing the deployment-selected mode

### Requirement: Event transport operational state MUST not mutate configuration revision
Webhook diagnostics, stream desired/connected state, lease ownership, fencing token, heartbeat, reconnect count and last-event time MUST be operational facts separate from Integration configuration. Updating those facts MUST NOT advance `config_version` or invalidate identities and bindings.

#### Scenario: Stream heartbeat is renewed
- **WHEN** the current lease holder renews heartbeat or reports connection health
- **THEN** operational state MUST update without changing the Integration revision

#### Scenario: Webhook diagnostic changes
- **WHEN** verification succeeds or fails without configuration mutation
- **THEN** safe status MUST reflect the latest allow-listed diagnostic while `config_version` remains unchanged

### Requirement: Provider event runtime MUST remain Dify-owned
Webhook verification, stream supervision, credential access and authenticated event routing MUST execute in Dify. EE MUST forward Integration management commands and MUST NOT own an event consumer, provider credential store or stream lease.

#### Scenario: Deployment enables stream transport
- **WHEN** Dify starts with deployment event transport mode `STREAM`
- **THEN** only the Dify persistent connection runtime MUST acquire Integration leases and create provider SDK sessions, while workspace and EE management APIs MUST expose the mode as read-only
