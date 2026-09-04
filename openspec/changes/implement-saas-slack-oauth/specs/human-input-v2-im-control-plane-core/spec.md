## ADDED Requirements

### Requirement: OAuth installation credentials MUST have an independent compare-and-swap revision

An OAuth installation MUST have a positive monotonic `credential_revision` that protects automatic credential refresh independently from the Channel `config_version`.

#### Scenario: Automatic token refresh commits

- **WHEN** a refresh owner provides the current installation ID, credential revision and lease token
- **THEN** the credential update MUST apply atomically and advance `credential_revision` exactly once
- **AND** it MUST NOT advance Channel `config_version`

#### Scenario: Credential refresh is stale

- **WHEN** a refresh result provides an old credential revision or no longer owns the live lease
- **THEN** persistence MUST reject the update without changing tokens, expiry or Channel state

#### Scenario: Explicit OAuth reauthorization commits

- **WHEN** same-workspace reauthorization passes complete Channel CAS
- **THEN** persistence MUST advance the Channel configuration version and OAuth credential revision in the same transaction
- **AND** no intermediate revision combination MUST be visible

### Requirement: Slack OAuth workspace claims MUST enforce one-to-one ownership

The persistence boundary MUST provide a dedicated, credential-free Slack workspace claim with a global unique constraint on standard Slack `team_id` and a unique association to one OAuth installation and Channel.

#### Scenario: Unclaimed Slack workspace is installed

- **WHEN** OAuth callback creates a new installation for an unclaimed `team_id`
- **THEN** claim creation and Channel installation MUST commit atomically

#### Scenario: Slack workspace is claimed concurrently

- **WHEN** callbacks for different Dify workspaces concurrently attempt to claim the same `team_id`
- **THEN** exactly one claim MUST commit
- **AND** the losing transaction MUST not modify either Dify workspace's existing Channel

#### Scenario: Callback routes through a claim

- **WHEN** public ingress resolves an authenticated Slack `team_id`
- **THEN** the claim MUST identify exactly one current tenant, Channel and OAuth installation ownership chain
- **AND** it MUST expose no encrypted credential to ingress routing

#### Scenario: Legacy self-managed row exists

- **WHEN** an existing `self_managed` Slack Channel has no OAuth claim
- **THEN** migration MUST leave it unclaimed until an explicit OAuth migration transaction succeeds
- **AND** the global claim constraint MUST NOT retroactively reject the legacy row

### Requirement: OAuth lifecycle transitions MUST be persisted transactionally

OAuth installation and workspace claim lifecycle MUST use explicit legal transitions and transaction-oriented repository operations rather than independent generic CRUD.

#### Scenario: Active installation begins disconnect

- **WHEN** complete Channel CAS authorizes the transition from `active` to `disconnecting`
- **THEN** Channel configuration, installation lifecycle and claim lifecycle MUST change atomically
- **AND** the transition MUST return an immutable token required to finish deletion

#### Scenario: Disconnect deletion commits

- **WHEN** remote compensation succeeded and the current transition token is supplied
- **THEN** claim, installation and Channel MUST be deleted in one transaction
- **AND** current reads MUST NOT expose identities or bindings owned by the deleted Channel

#### Scenario: External revocation is persisted

- **WHEN** an idempotent lifecycle operation moves an active installation to `reauthorization_required`
- **THEN** the Channel, claim, identities and bindings MUST remain intact
- **AND** the safe diagnostic update MUST NOT advance `config_version`

#### Scenario: Stale lifecycle transition is applied

- **WHEN** a lifecycle command carries a stale Channel, claim or installation transition token
- **THEN** persistence MUST reject all state mutation

## MODIFIED Requirements

### Requirement: Provider replacement and credential rotation MUST have distinct Channel effects

The Channel application owner MUST distinguish provider or provider-tenant replacement, explicit administrator credential rotation, automatic OAuth credential refresh and connectivity diagnostics. Only administrator-authorized Channel configuration mutations MUST advance `config_version`.

#### Scenario: Credentials are rotated explicitly

- **WHEN** an administrator-authorized credential change or same-workspace OAuth reauthorization confirms provider and provider-tenant identity remain unchanged
- **THEN** Channel ID、current identities and bindings MUST be preserved while Channel configuration version advances

#### Scenario: OAuth credentials refresh automatically

- **WHEN** an OAuth installation rotates access and refresh tokens without changing provider, provider tenant, granted capability contract or administrator configuration
- **THEN** its credential revision MUST advance
- **AND** Channel configuration version, identities, bindings and captured business relationships MUST remain unchanged

#### Scenario: Provider tenant is replaced

- **WHEN** provider or provider-tenant identity changes
- **THEN** the current Channel MUST be replaced with a new Channel ID
- **AND** current reads bound to the replacement Channel MUST NOT expose identities or bindings owned by the previous Channel

#### Scenario: Connectivity diagnostic changes

- **WHEN** connection status, OAuth lifecycle diagnostic or diagnostic details change without a configuration mutation
- **THEN** the Channel configuration version MUST NOT advance
