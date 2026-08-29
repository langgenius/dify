## REMOVED Requirements

### Requirement: API key retention and replacement MUST be explicit

**Reason**: Resend create, update and connection test now use the same complete candidate. Every operation requires a newly submitted API key, so management no longer retains the current protected API key.

**Migration**: Console callers MUST submit the complete Resend candidate, including `api_key`, for every update and connection test.

## ADDED Requirements

### Requirement: Resend create, update and test MUST require the same complete candidate

Resend create、update and connection test MUST require the same complete candidate containing `sender_email`、`sender_name` and a newly submitted non-blank `api_key`。Management MUST NOT reveal or reuse the persisted API key to complete an update or connection test candidate。

#### Scenario: Resend configuration is updated

- **WHEN** an administrator updates an existing Resend configuration
- **THEN** the command MUST contain required `sender_email`、required `sender_name` and a newly submitted API key
- **AND** management MUST validate and protect that complete candidate before persistence

#### Scenario: Resend update omits the API key

- **WHEN** an update omits the API key, submits `null`, submits a blank value or submits a retention marker
- **THEN** management MUST reject the request before provider validation or persistence
- **AND** the current configuration MUST remain unchanged

#### Scenario: Resend connection test is requested

- **WHEN** an administrator tests a Resend candidate
- **THEN** the command MUST contain the same required sender email、sender name and newly submitted API key required for create and update
- **AND** management MUST NOT read or reuse the persisted API key
