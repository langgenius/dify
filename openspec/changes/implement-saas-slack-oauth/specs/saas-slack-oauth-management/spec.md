## ADDED Requirements

### Requirement: Cloud Slack OAuth MUST depend on a deployment-owned official App

Cloud Slack OAuth MUST use one deployment-owned official Slack App. Its `client_id`, `client_secret`, `signing_secret` and expected App identity MUST come from trusted deployment configuration and MUST NOT be accepted from tenant commands or exposed through tenant-facing representations.

#### Scenario: Official App configuration is ready

- **WHEN** a Cloud workspace reads its Slack channel definition and all required official App configuration is valid
- **THEN** Slack MUST be available in `oauth` auth mode
- **AND** the definition MUST expose no App-level secret or raw configuration value

#### Scenario: Official App configuration is incomplete

- **WHEN** required official App configuration is missing, inconsistent or disabled for the workspace
- **THEN** the system MUST reject creation of a new Slack authorization state with a stable unavailable result
- **AND** it MUST NOT disrupt an existing OAuth runtime or legacy `self_managed` connection

#### Scenario: Non-Cloud deployment reads Slack

- **WHEN** a Community or Enterprise deployment reads its Slack channel definition
- **THEN** the official App configuration MUST NOT change its `self_managed` auth mode
- **AND** no Cloud App secret MUST be required

#### Scenario: App-level secret is observed

- **WHEN** the system serializes an API response, log, metric, trace or audit event for a Slack management operation
- **THEN** it MUST NOT include the official App client secret, signing secret, OAuth code, state, token or raw provider response

### Requirement: Slack OAuth authorization state MUST be single-use and context-bound

The authorize operation MUST create a cryptographically random, short-lived server-side state bound to the trusted workspace, administrator, operation intent, current complete Integration CAS token, expected provider tenant identity and popup correlation. The callback MUST consume that state atomically before accepting an OAuth result.

#### Scenario: Administrator starts a new connection

- **WHEN** an authorized Cloud administrator starts `connect` while no active IM Integration exists
- **THEN** the system MUST return an official Slack authorization URL containing a new one-time state
- **AND** the state MUST be bound to the current Dify workspace and `connect` intent

#### Scenario: Administrator starts reauthorization

- **WHEN** an authorized Cloud administrator starts `reauthorize` for an existing OAuth installation
- **THEN** the state MUST capture the current Integration ID, `config_version`, Slack workspace identity and `reauthorize` intent

#### Scenario: State is replayed

- **WHEN** an OAuth callback presents a state that was already consumed or expired
- **THEN** the callback MUST fail before mutating Integration, installation or workspace claim state
- **AND** it MUST return only a safe OAuth failure result

#### Scenario: Captured Integration revision is stale

- **WHEN** the Integration ID or `config_version` no longer matches the state at callback commit time
- **THEN** the callback MUST reject the local write as stale
- **AND** it MUST NOT retry against the newer Integration without a new administrator authorization

### Requirement: OAuth callback MUST validate and atomically install a standard Slack workspace

The OAuth callback MUST exchange the authorization code with the deployment-owned App, validate the returned App identity, standard workspace identity, token-rotation material and required granted scopes, then atomically persist the Integration configuration, OAuth installation and workspace claim.

#### Scenario: New workspace installation succeeds

- **WHEN** a valid `connect` callback returns the expected App identity, one standard Slack `team_id`, required scopes, bot token, refresh token and expiry
- **THEN** one Integration, one OAuth installation and one workspace claim MUST become visible in one database commit
- **AND** the resulting channel MUST identify the installation as `oauth_installation`

#### Scenario: Enterprise Grid org-wide installation is returned

- **WHEN** Slack returns an Enterprise Grid org-wide installation or omits the required standard workspace identity
- **THEN** the callback MUST reject the installation
- **AND** it MUST NOT create or replace any local Integration, installation or workspace claim

#### Scenario: Required scope is missing

- **WHEN** the OAuth result lacks any scope required by the versioned official App contract
- **THEN** the callback MUST reject the installation as insufficiently authorized
- **AND** runtime provider operations MUST NOT receive the returned token

#### Scenario: Slack workspace is already claimed

- **WHEN** the returned Slack `team_id` is claimed by another Dify workspace
- **THEN** the callback transaction MUST fail with a stable ownership-conflict result that does not identify the owner
- **AND** the service MUST attempt to revoke or uninstall the newly issued credential without changing the existing claim

#### Scenario: Local commit fails after code exchange

- **WHEN** token exchange succeeds but local validation, CAS or persistence fails
- **THEN** the previous local Integration state MUST remain unchanged
- **AND** the service MUST perform best-effort credential compensation and emit a secret-free compensation audit result

### Requirement: OAuth installation credentials MUST preserve secret ownership boundaries

Tenant persistence MUST contain only encrypted workspace installation tokens and the safe metadata required for runtime, refresh and lifecycle management. App-level credentials MUST remain deployment-owned, and tenant APIs MUST expose only credential-free installation state.

#### Scenario: OAuth installation is persisted

- **WHEN** the system stores a Slack OAuth installation
- **THEN** bot access token and refresh token MUST be encrypted with the installation owner's encryption boundary
- **AND** expiry, granted scopes, credential revision and safe Slack identity metadata MUST remain queryable without decrypting tokens

#### Scenario: OAuth runtime is composed

- **WHEN** a send, sync or other authorized provider operation loads an active OAuth installation
- **THEN** it MUST receive the latest bot token required for that operation
- **AND** it MUST NOT receive an App client secret, signing secret or Socket Mode app token

#### Scenario: OAuth channel is tested

- **WHEN** management evaluates an existing OAuth installation
- **THEN** it MUST test the persisted installation through an OAuth-compatible Web API probe
- **AND** it MUST NOT call `apps.connections.open` or require an `app_token`

#### Scenario: Installation is returned to a client

- **WHEN** a client lists or reads a Slack OAuth channel
- **THEN** the response MUST contain no plaintext, encrypted, masked or presence-revealing token field
- **AND** it MUST expose only safe workspace display metadata and lifecycle state

### Requirement: Same-workspace reauthorization and legacy migration MUST preserve Integration identity

Reauthorization and legacy migration MUST update an existing Integration only when Slack confirms the same provider tenant identity. A different Slack workspace MUST require explicit disconnect followed by a new connect.

#### Scenario: OAuth installation is reauthorized for the same workspace

- **WHEN** a valid `reauthorize` callback returns the Integration's current Slack `team_id`
- **THEN** the system MUST rotate installation credentials and advance the explicit Integration configuration revision exactly once
- **AND** it MUST preserve the Integration ID, identities and bindings

#### Scenario: Reauthorization returns another Slack workspace

- **WHEN** a `reauthorize` callback returns a `team_id` different from the captured Integration identity
- **THEN** the system MUST reject the update and preserve the current installation
- **AND** it MUST require explicit disconnect before that other workspace can be connected

#### Scenario: Legacy connection migrates to OAuth for the same workspace

- **WHEN** a valid `migrate_legacy` callback returns the same Slack `team_id` as the legacy `self_managed` Integration and the claim is available
- **THEN** the system MUST change the credential mode to `oauth_installation` in one CAS transaction
- **AND** it MUST preserve the Integration ID, identities and bindings

#### Scenario: Legacy workspace is already claimed

- **WHEN** legacy migration returns a Slack `team_id` already claimed by another Dify workspace
- **THEN** migration MUST fail without modifying the legacy connection
- **AND** the ownership-conflict response MUST NOT disclose the other Dify workspace

### Requirement: Slack token rotation MUST use leases and credential CAS

The system MUST refresh active OAuth installations before expiry by using a queryable expiry, a finite distributed database lease and the installation's `credential_revision`. Automatic refresh MUST NOT change the Integration `config_version`.

#### Scenario: Installation approaches expiry

- **WHEN** an active installation enters the configured refresh horizon and has no live refresh lease
- **THEN** exactly one worker MUST acquire a finite lease and attempt Slack token refresh from the captured credential revision

#### Scenario: Concurrent workers refresh one installation

- **WHEN** multiple workers select the same due installation
- **THEN** at most one worker MUST own the live lease
- **AND** a stale refresh response MUST NOT overwrite a newer credential revision

#### Scenario: Refresh succeeds

- **WHEN** Slack returns a valid rotated access token, refresh token and expiry
- **THEN** the owner MUST atomically persist the encrypted tokens, expiry and next credential revision and release the lease
- **AND** the Integration `config_version`, identities, bindings and sync state MUST remain unchanged

#### Scenario: Refresh fails transiently

- **WHEN** Slack or the network returns a classified transient failure before the safe expiry horizon
- **THEN** the system MUST retain the current active credential and schedule a bounded retry
- **AND** it MUST record only safe failure classification and expiry metadata

#### Scenario: Refresh can no longer recover authorization

- **WHEN** Slack returns `invalid_grant`, the refresh credential is revoked, required scopes disappear, or the access token expires without a valid refresh
- **THEN** the installation MUST enter `reauthorization_required`
- **AND** new send, sync and provider business operations MUST fail closed without advancing Integration `config_version`

#### Scenario: Refresh worker loses its lease

- **WHEN** a worker attempts to commit after its lease or captured credential revision is no longer current
- **THEN** its update MUST be rejected without changing the active credential

### Requirement: OAuth disconnect MUST be compensatable and race-safe

Active disconnect MUST first persist a `disconnecting` transition through complete Integration CAS, then revoke or uninstall remotely, and only then delete local ownership through a transition CAS. Refresh, reauthorization and provider business work MUST reject a disconnecting installation.

#### Scenario: Administrator starts disconnect

- **WHEN** an authorized administrator submits the current Integration ID and `config_version` for an active OAuth installation
- **THEN** the system MUST atomically enter `disconnecting`, advance `config_version` exactly once and retain the claim and encrypted credential for compensation

#### Scenario: Remote uninstall succeeds

- **WHEN** Slack confirms uninstall or credential revocation for the current disconnect transition
- **THEN** the system MUST atomically delete the workspace claim, OAuth installation and Integration
- **AND** it MUST apply the existing Integration delete invalidation rules to identities and bindings

#### Scenario: Remote uninstall fails

- **WHEN** the remote uninstall or revoke call fails transiently
- **THEN** the local state MUST remain `disconnecting` with a safe retry diagnostic
- **AND** an idempotent retry MUST be able to continue without reviving provider business work

#### Scenario: Reauthorization races with disconnect

- **WHEN** a callback attempts reauthorization after the disconnect transition was persisted
- **THEN** the callback MUST fail its transition CAS
- **AND** it MUST NOT restore the installation to active

#### Scenario: Disconnect request is stale

- **WHEN** a disconnect command carries a stale Integration ID or `config_version`
- **THEN** no local lifecycle or remote Slack mutation MUST occur

### Requirement: Invalid external authorization MUST retain a recoverable fail-closed Integration

External uninstall, token revocation and deterministic authentication failure MUST move the matching active OAuth installation to `reauthorization_required` while preserving its Integration and ownership needed for same-workspace recovery.

#### Scenario: Slack uninstalls the App externally

- **WHEN** a verified durable lifecycle event confirms `app_uninstalled` for an active claimed workspace
- **THEN** the installation MUST enter `reauthorization_required`
- **AND** its Integration, claim, identities and bindings MUST remain available for administrator diagnosis and recovery

#### Scenario: Runtime sees invalid authorization

- **WHEN** an active installation receives a deterministic token-revoked or missing-scope result
- **THEN** the system MUST persist a safe `reauthorization_required` diagnostic idempotently
- **AND** it MUST stop new provider I/O that depends on the invalid authorization

#### Scenario: Same workspace is reauthorized

- **WHEN** a valid reauthorization returns the retained claim's Slack `team_id`
- **THEN** the system MUST reactivate the installation with new credentials
- **AND** it MUST preserve existing identities and bindings

