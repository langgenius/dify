## ADDED Requirements

### Requirement: IM Webhook route metadata MUST remain outside the encrypted credential envelope

The IM control plane MUST persist `webhook_id` as server-generated Integration routing metadata separate from `EncryptedCredentials`。The credential codec MUST seal only the complete validated Provider credential payload。It MUST NOT seal `webhook_id`、`callback_url`、deployment event transport mode or another Dify-owned routing value。

#### Scenario: Workspace Integration is created
- **WHEN** the IM owner persists a new Integration with one opaque credential envelope
- **THEN** the same row MUST persist an independently generated `webhook_id`
- **AND** credential recovery MUST NOT be required to route a callback to that row

#### Scenario: Integration credentials rotate
- **WHEN** the IM owner replaces the opaque credential envelope for the same Provider tenant
- **THEN** the configuration revision MUST advance
- **AND** the current Integration ID and `webhook_id` MUST remain unchanged

#### Scenario: Integration is replaced
- **WHEN** the IM owner atomically replaces a Provider or Provider tenant
- **THEN** the replacement MUST persist a new Integration ID and a newly generated `webhook_id`
- **AND** the old route MUST disappear in the same transaction that removes the old Integration

#### Scenario: Persisted callback URL is inspected
- **WHEN** the Integration schema is reviewed after this change
- **THEN** neither the ORM row nor the encrypted credential envelope MUST contain `callback_url`
