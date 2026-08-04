## ADDED Requirements

### Requirement: Directory MUST be an adapter-bound capability
Every initial `IMProviderAdapter` MUST expose a Directory capability backed by the adapter-owned client context. Directory operations MUST NOT accept credentials, SDK clients or a generic integration context, and obtaining the capability MUST NOT construct an independent Provider client.

#### Scenario: Directory is used after Messaging
- **WHEN** a caller obtains Directory after using Messaging from the same adapter
- **THEN** Directory MUST reuse the root adapter's client context without requiring credentials again

### Requirement: Directory MUST remain independent from Messaging and consumer processing
Directory MUST only read Provider identity facts. It MUST NOT send messages, test message-recipient reachability or perform caller-owned matching, reconciliation, persistence or business processing.

#### Scenario: A consumer requests the Provider directory
- **WHEN** Directory reads the current Provider tenant
- **THEN** it MUST return Provider identity facts without invoking Messaging or a consumer-owned processor

### Requirement: Successful directory read MUST represent one complete in-memory snapshot
Directory MUST own all Provider-specific pagination, hierarchy traversal, record-inclusion rules and rate-limit handling for one read. It MUST accumulate every required page or node in memory and MUST return one immutable snapshot only after the full read succeeds. Snapshot presence MUST mean that the Provider still exposes the identity within the verified configured directory scope; it MUST NOT claim message reachability.

#### Scenario: Every Provider page succeeds
- **WHEN** all pages or organization nodes for the configured directory scope are read successfully
- **THEN** Directory MUST return one snapshot containing the complete ordered identity entries for that read

#### Scenario: A late page fails
- **WHEN** one page or organization node fails after earlier entries were accumulated
- **THEN** Directory MUST return a typed failure and MUST NOT return a partial snapshot

### Requirement: Initial directory coverage MUST include all five IM Providers
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams adapters MUST each expose Directory with the same complete-snapshot semantics. Provider-specific endpoints, visibility scopes, pagination and organization traversal MUST remain inside the concrete adapter.

#### Scenario: Any initial Provider directory is read
- **WHEN** Directory runs for Slack, Feishu/Lark, DingTalk, WeCom or Microsoft Teams
- **THEN** the concrete adapter MUST complete every page or organization node required by its configured scope before returning success

### Requirement: Shared directory identity facts MUST remain minimal
A common directory entry MUST contain provider user ID and MAY contain display name and Email. Provider user ID MUST use the shared nominal `ProviderUserId` string type, MUST be stable and comparable only within the `(provider, provider_tenant_id)` namespace and MUST be sufficient for a bound adapter in that namespace to attempt personal messaging, although it need not equal the Provider's private transport address. For Feishu/Lark, Directory MUST use `union_id`, not application-scoped `open_id`; this contract assumes that applications configured for one `(provider, provider_tenant_id)` namespace share one Provider developer identity. Missing display name or Email MUST remain valid. Provider lifecycle status, cursors, raw responses and topology-specific data MUST remain inside the concrete adapter. The shared entry MUST NOT expose a normalized availability field or imply that snapshot presence guarantees message delivery.

#### Scenario: Provider user has no readable Email
- **WHEN** a Provider directory entry omits Email because of data or permission constraints
- **THEN** the snapshot MUST retain the identity by provider user ID and MUST NOT invent or require an Email value

#### Scenario: Feishu or Lark directory identity is normalized
- **WHEN** Feishu or Lark Directory normalizes one Provider user identity
- **THEN** it MUST expose the user's `union_id` as `ProviderUserId` and MUST NOT use application-scoped `open_id` as the canonical shared identity

#### Scenario: Provider returns a deleted identity tombstone
- **WHEN** authoritative Provider evidence confirms that a returned tombstone represents an identity that no longer exists in the current directory scope
- **THEN** the concrete adapter MUST omit that tombstone from the normalized snapshot and MUST NOT expose the Provider-specific deletion field

#### Scenario: Provider exposes an administrative user status
- **WHEN** a Provider still exposes an identity together with disabled, suspended, frozen or another Provider-specific status
- **THEN** Directory MUST retain the identity according to the configured scope and MUST NOT normalize that status into shared availability or infer message reachability

#### Scenario: Provider messaging requires private conversation state
- **WHEN** Microsoft Teams returns a directory user identity without a conversation ID
- **THEN** Directory MUST return that identity as `ProviderUserId` and MUST leave conversation acquisition to the bound Messaging adapter

### Requirement: Provider-specific directory topology MUST not leak through the capability
Slack cursor pagination, Feishu/Lark department traversal and the Provider-specific directory traversal used by DingTalk, WeCom and Microsoft Teams MUST produce the same snapshot-level success or failure semantics.

#### Scenario: Providers expose different traversal models
- **WHEN** the five initial Providers expose different pagination, department or organization traversal models
- **THEN** each concrete adapter MUST finish its own traversal without requiring callers to understand that protocol
