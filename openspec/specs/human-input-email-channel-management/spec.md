# human-input-email-channel-management Specification

## Purpose

Defines the Resend-specific handler and persistence behavior behind the common Human Input Channel Management facade.

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
- **THEN** management MUST allow the candidate to proceed to validation

#### Scenario: Unsupported provider is submitted

- **WHEN** an input identifies SMTP or another provider outside the Resend-only candidate union
- **THEN** command construction or input validation MUST reject it before management dispatch
- **AND** it MUST NOT invoke provider validation or persistence
- **AND** management MUST NOT define an unsupported provider, candidate or result variant solely to represent that input

### Requirement: Candidate configuration MUST validate before persistence

Saving a configuration MUST validate the complete candidate provider settings before any current configuration is created or replaced.

#### Scenario: New candidate validates successfully

- **WHEN** the API key is valid, has sending permission and the sender domain is usable
- **THEN** the complete candidate MUST be eligible for persistence
- **AND** save validation MUST NOT send a test email

#### Scenario: Candidate validation fails

- **WHEN** provider validation reports an invalid API key, missing sending permission, unusable sender domain, invalid sender, rate limit or provider failure
- **THEN** management MUST return the corresponding safe failure code
- **AND** it MUST NOT create, replace or delete the current configuration

#### Scenario: Provider validation raises an unexpected failure

- **WHEN** provider validation cannot classify an unexpected provider or transport failure
- **THEN** management MUST return a generic safe provider failure
- **AND** no raw provider response or credential material MUST escape the validation boundary

### Requirement: Test connection MUST be non-persistent and operator-targeted

Testing a candidate MUST validate the complete candidate and send exactly one test email to the authenticated operator account email without saving the configuration.

#### Scenario: Test connection succeeds

- **WHEN** the candidate validates and the provider accepts the test message
- **THEN** management MUST return a credential-free candidate test result containing the operator account email and candidate sender identity
- **AND** the result MUST NOT claim that the candidate is the persisted configuration or that its API key is persisted
- **AND** the current persisted configuration MUST remain unchanged

#### Scenario: Test connection fails

- **WHEN** candidate validation or test delivery fails
- **THEN** management MUST return a safe classified failure
- **AND** it MUST NOT persist any part of the candidate

#### Scenario: System mail is configured

- **WHEN** a candidate connection is tested
- **THEN** the test MUST use the candidate Workspace provider settings
- **AND** it MUST NOT use Dify system mail as a fallback

### Requirement: API key retention and replacement MUST be explicit

An update MUST distinguish retaining the current protected API key from supplying a replacement plaintext key.

#### Scenario: Existing API key is retained

- **WHEN** an update explicitly requests retention and a current configuration exists
- **THEN** validation MUST use the existing API key with the candidate sender settings
- **AND** a successful update MUST preserve the protected credential while updating the sender configuration atomically

#### Scenario: API key retention is requested without a configuration

- **WHEN** a create command requests retention but no current configuration exists
- **THEN** management MUST reject the command before provider validation or persistence

#### Scenario: Replacement API key validates successfully

- **WHEN** an update supplies a new API key and the complete candidate validates
- **THEN** management MUST protect the new key and atomically replace the previous protected credential

#### Scenario: Replacement API key fails validation

- **WHEN** an update supplies a new API key that fails validation
- **THEN** the previous configuration and protected credential MUST remain unchanged

### Requirement: Credentials MUST remain protected throughout management

Plaintext API keys MUST exist only for the minimum duration required to validate a command and MUST be protected before persistence.

#### Scenario: New API key is persisted

- **WHEN** a validated candidate contains a new API key
- **THEN** the key MUST be protected using Workspace-scoped credential protection before the repository write
- **AND** persistence MUST receive only the protected value

#### Scenario: Configuration is logged or diagnosed

- **WHEN** management records logs, metrics, exceptions or repository diagnostics
- **THEN** those records MUST NOT contain plaintext, encrypted or masked API key material

#### Scenario: Configuration is read

- **WHEN** a caller reads a configured Email channel
- **THEN** the caller MUST receive only an `api_key_configured` state for the credential

### Requirement: Validated updates MUST not overwrite concurrent configuration changes

Management MUST compare the configuration identity and update timestamp captured before provider validation with the current persisted row before applying a validated update. This persistence snapshot MUST remain internal to the service and repository boundary.

#### Scenario: Current snapshot is updated

- **WHEN** provider validation completes and the current configuration still matches the captured identity and update timestamp
- **THEN** the validated replacement MUST be committed atomically
- **AND** its update timestamp MUST advance to a strictly later value

#### Scenario: Stale update is attempted

- **WHEN** the configuration identity or update timestamp changed during provider validation
- **THEN** the current configuration MUST remain unchanged
- **AND** management MUST return a stable stale-configuration result

#### Scenario: Deleted identity is recreated

- **WHEN** a configuration is deleted and another configuration is later created for the same Workspace
- **THEN** the captured identity for the deleted configuration MUST not match the recreated row

#### Scenario: Concurrent update occurs during provider validation

- **WHEN** another command changes the current configuration after a candidate was loaded but before its validated write
- **THEN** the validated write MUST be rejected as stale
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
