# human-input-email-channel-management Specification

## Purpose

Defines the Resend Email Management owner and its persistence behavior behind the Console v2 transport projection.

## Requirements
### Requirement: Each Workspace MUST have at most one Human Input Email configuration

Email channel management MUST scope every read and write to one Workspace and MUST prevent more than one current provider configuration for that Workspace.

#### Scenario: Workspace has no configuration

- **WHEN** the current Human Input Email configuration is requested for a Workspace with no provider row
- **THEN** the result MUST explicitly report that Email is not configured

#### Scenario: Workspace has a configuration

- **WHEN** the current Human Input Email configuration is requested
- **THEN** the result MUST include provider, sender email, sender name and whether an API key is configured
- **AND** it MUST NOT include plaintext, encrypted or masked credential material

#### Scenario: Configuration is requested across Workspaces

- **WHEN** a configuration identifier belonging to another Workspace is used in a read or write
- **THEN** the operation MUST NOT expose or mutate that configuration

#### Scenario: First configuration is created concurrently

- **WHEN** two commands concurrently create the first Email configuration for one Workspace
- **THEN** exactly one configuration MUST be created and the other command MUST receive a stable conflict result

### Requirement: Management MUST support only the Resend provider in the first release

Candidate configurations MUST identify Resend as the provider. SMTP and other Email providers MUST be rejected before credential protection or persistence.

#### Scenario: Resend candidate is submitted

- **WHEN** a candidate identifies Resend and contains the required sender and credential inputs
- **THEN** management MUST allow the candidate to proceed to the requested save or test operation

#### Scenario: Unsupported provider is submitted

- **WHEN** an input identifies SMTP or another provider outside the Resend-only candidate union
- **THEN** command construction or input validation MUST reject it before management dispatch
- **AND** it MUST NOT invoke provider validation or persistence
- **AND** management MUST NOT define an unsupported provider, candidate or result variant solely to represent that input

### Requirement: Candidate configuration MUST be protected before persistence

Saving a configuration MUST protect the complete candidate credential before any current configuration is created or replaced. Save MUST NOT perform provider I/O; remote credential and sender validation belongs to the explicit connection test.

#### Scenario: New candidate is structurally valid

- **WHEN** the complete candidate passes request-boundary and domain-value validation
- **THEN** management MUST protect and persist the candidate without calling Resend
- **AND** the resulting Email Channel status MUST be `configured`

#### Scenario: Candidate input validation fails

- **WHEN** request-boundary or domain-value validation rejects the candidate
- **THEN** management MUST return the corresponding validation failure
- **AND** it MUST NOT create, replace or delete the current configuration

#### Scenario: Credential protection raises an unexpected failure

- **WHEN** credential protection fails before persistence
- **THEN** management MUST return a generic safe failure
- **AND** no credential material MUST escape the management boundary

### Requirement: Test connection MUST be non-persistent and sending-capability-targeted

Testing a candidate MUST send exactly one email to Resend's `delivered@resend.dev` test address through the submitted candidate without saving the configuration.

#### Scenario: Test connection succeeds

- **WHEN** Resend accepts the test message
- **THEN** management MUST return a credential-free candidate test result
- **AND** the result MUST NOT claim that the candidate is the persisted configuration or that its API key is persisted
- **AND** the current persisted configuration MUST remain unchanged

#### Scenario: Test connection fails

- **WHEN** Resend rejects the credential, sender or test delivery, or the provider request fails
- **THEN** management MUST return a safe classified failure
- **AND** it MUST NOT persist any part of the candidate

#### Scenario: System mail is configured

- **WHEN** a candidate connection is tested
- **THEN** the test MUST use the candidate Workspace provider settings
- **AND** it MUST NOT use Dify system mail as a fallback

### Requirement: Credentials MUST remain protected throughout management

Plaintext API keys MUST exist only for the minimum duration required to handle a command and MUST be protected before persistence.

#### Scenario: New API key is persisted

- **WHEN** a candidate contains a new API key
- **THEN** the key MUST be protected using Workspace-scoped credential protection before the repository write
- **AND** persistence MUST receive only the protected value

#### Scenario: Configuration is logged or diagnosed

- **WHEN** management records logs, metrics, exceptions or repository diagnostics
- **THEN** those records MUST NOT contain plaintext, encrypted or masked API key material

#### Scenario: Configuration is read

- **WHEN** a caller reads a configured Email channel
- **THEN** the caller MUST receive only an `api_key_configured` state for the credential

### Requirement: Updates MUST not overwrite concurrent configuration changes

Management MUST compare the submitted configuration identity and version with the current persisted row before applying an update. This persistence snapshot MUST remain internal to the service and repository boundary.

#### Scenario: Current snapshot is updated

- **WHEN** the current configuration still matches the submitted identity and version
- **THEN** the replacement MUST be committed atomically
- **AND** its update timestamp MUST advance to a strictly later value

#### Scenario: Stale update is attempted

- **WHEN** the configuration identity or version changed before the write
- **THEN** the current configuration MUST remain unchanged
- **AND** management MUST return a stable stale-configuration result

#### Scenario: Deleted identity is recreated

- **WHEN** a configuration is deleted and another configuration is later created for the same Workspace
- **THEN** the captured identity for the deleted configuration MUST not match the recreated row

#### Scenario: Concurrent update occurs before persistence

- **WHEN** another command changes the current configuration after a candidate was loaded but before its write
- **THEN** the write MUST be rejected as stale
- **AND** it MUST NOT overwrite the newer configuration

#### Scenario: Application clock does not advance

- **WHEN** the supplied update time is not later than the current persisted update timestamp
- **THEN** persistence MUST assign a strictly later timestamp before committing the successful update

### Requirement: Deleting a configuration MUST be atomic and narrowly scoped

Deleting the current Email configuration MUST remove only that Workspace provider configuration and MUST not mutate Human Input workflow or delivery facts.

#### Scenario: Current configuration is deleted

- **WHEN** delete is requested for a Workspace with a current configuration
- **THEN** the provider configuration MUST be removed atomically
- **AND** a subsequent read MUST report Email as not configured

#### Scenario: Configuration is already absent

- **WHEN** delete is requested for a Workspace without a current configuration
- **THEN** management MUST return a stable not-configured result

#### Scenario: Configuration is deleted while Human Input nodes use Email

- **WHEN** the Workspace provider configuration is deleted
- **THEN** persisted Human Input node Email settings, forms, endpoints and delivery history MUST remain unchanged

### Requirement: Persistence MUST expose operation-scoped transactional results

Persistence operations MUST distinguish not-configured, created, updated, deleted, conflict and stale-configuration outcomes without leaking ORM records or credential values.

#### Scenario: Repository operation succeeds

- **WHEN** a create, update or delete transaction succeeds
- **THEN** persistence MUST return the corresponding typed outcome and safe configuration metadata

#### Scenario: Repository operation fails partway

- **WHEN** any write in a configuration transaction fails
- **THEN** the complete transaction MUST roll back
- **AND** no partial configuration or timestamp advance may remain

#### Scenario: Aggregate is loaded for mutation

- **WHEN** management loads the current configuration for a mutation
- **THEN** persistence MUST return a domain aggregate or immutable snapshot
- **AND** it MUST NOT expose a live ORM record outside the repository boundary

### Requirement: Resend create, update and test MUST require the same complete candidate

Resend create、update and connection test MUST require the same complete candidate containing `sender_email`、`sender_name` and a newly submitted non-blank `api_key`。Management MUST NOT reveal or reuse the persisted API key to complete an update or connection test candidate。

#### Scenario: Resend configuration is updated

- **WHEN** an administrator updates an existing Resend configuration
- **THEN** the command MUST contain required `sender_email`、required `sender_name` and a newly submitted API key
- **AND** management MUST protect that complete candidate before persistence

#### Scenario: Resend update omits the API key

- **WHEN** an update omits the API key, submits `null`, submits a blank value or submits a retention marker
- **THEN** management MUST reject the request before credential protection or persistence
- **AND** the current configuration MUST remain unchanged

#### Scenario: Resend connection test is requested

- **WHEN** an administrator tests a Resend candidate
- **THEN** the command MUST contain the same required sender email、sender name and newly submitted API key required for create and update
- **AND** management MUST NOT read or reuse the persisted API key
