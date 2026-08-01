## ADDED Requirements

### Requirement: Directory MUST be an adapter-bound capability
Every initial `IMProviderAdapter` MUST expose a Directory capability backed by the adapter-owned client context. Directory operations MUST NOT accept credentials, SDK clients or a generic integration context, and obtaining the capability MUST NOT construct an independent Provider client.

#### Scenario: Directory is used after Messaging
- **WHEN** a caller obtains Directory after using Messaging from the same adapter
- **THEN** Directory MUST reuse the root adapter's client context without requiring credentials again

### Requirement: Directory MUST remain independent from Messaging and consumer processing
Directory MUST only read Provider identity facts. It MUST NOT send messages, test message-destination reachability or perform caller-owned matching, reconciliation, persistence or business processing.

#### Scenario: A consumer requests the Provider directory
- **WHEN** Directory reads the current Provider tenant
- **THEN** it MUST return Provider identity facts without invoking Messaging or a consumer-owned processor

### Requirement: Successful directory read MUST represent one complete in-memory snapshot
Directory MUST own all Provider-specific pagination, hierarchy traversal and rate-limit handling for one read. It MUST accumulate every required page or node in memory and MUST return one immutable snapshot only after the full read succeeds.

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
A common directory entry MUST contain provider user ID, display name, optional Email and availability. Missing Email MUST remain valid. Provider cursors, raw responses and topology-specific data MUST remain inside the concrete adapter.

#### Scenario: Provider user has no readable Email
- **WHEN** a Provider directory entry omits Email because of data or permission constraints
- **THEN** the snapshot MUST retain the identity by provider user ID and MUST NOT invent or require an Email value

### Requirement: Provider-specific directory topology MUST not leak through the capability
Slack cursor pagination, Feishu/Lark department traversal and the Provider-specific directory traversal used by DingTalk, WeCom and Microsoft Teams MUST produce the same snapshot-level success or failure semantics.

#### Scenario: Providers expose different traversal models
- **WHEN** the five initial Providers expose different pagination, department or organization traversal models
- **THEN** each concrete adapter MUST finish its own traversal without requiring callers to understand that protocol
