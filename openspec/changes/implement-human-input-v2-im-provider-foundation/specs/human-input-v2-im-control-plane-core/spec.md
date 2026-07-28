## ADDED Requirements

### Requirement: IM Integration MUST own provider-neutral event transport configuration
An IM Integration MUST retain `DISABLED`, `WEBHOOK` or `STREAM` as provider-neutral configuration. Event transport mode, webhook verification/encryption material and stream authentication configuration MUST participate in the complete Integration compare-and-swap transition.

#### Scenario: Event transport mode changes
- **WHEN** a current CAS token changes event transport mode or its authentication material
- **THEN** the Integration MUST advance configuration revision exactly once and old webhook/stream verification contexts MUST become stale

#### Scenario: Existing Integration is migrated
- **WHEN** an Integration has no previous event transport configuration
- **THEN** migration MUST set `DISABLED` without changing provider tenant, credentials, identities or bindings

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

#### Scenario: EE administrator enables stream transport
- **WHEN** EE forwards a valid `STREAM` configuration to Dify
- **THEN** only the Dify stream runtime MUST acquire the Integration lease and create the provider SDK session
