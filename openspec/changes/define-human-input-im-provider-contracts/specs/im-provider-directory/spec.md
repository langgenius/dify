## ADDED Requirements

### Requirement: Provider directory read MUST remain independent from messaging and Contact rules
The Directory reader MUST accept only Provider integration context and MUST return Provider identity facts. It MUST NOT send messages, test delivery reachability, load Dify Contacts, match Emails, create bindings or perform reconciliation.

#### Scenario: Manual sync reads provider identities
- **WHEN** a manual sync requests the current provider tenant directory
- **THEN** the Directory reader MUST return Provider identity facts without invoking Messaging or Contact services

### Requirement: Successful directory read MUST represent one complete in-memory snapshot
The Directory reader MUST own all Provider-specific pagination and hierarchy traversal for one read. It MUST accumulate every required page or node in memory and MUST return an immutable snapshot only after the full read succeeds.

#### Scenario: Every Provider page succeeds
- **WHEN** all pages or department nodes for the configured directory scope are read successfully
- **THEN** the reader MUST return one snapshot containing the complete ordered identity entries for that read

#### Scenario: A late page fails
- **WHEN** one page or department node fails after earlier entries were accumulated
- **THEN** the reader MUST return a typed failure and MUST NOT return a partial snapshot or entries that reconciliation can consume

### Requirement: Initial directory coverage MUST include all five IM Providers
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams MUST each provide a Directory reader that returns the same complete-snapshot semantic result. Provider-specific directory endpoints, visibility scopes, pagination and organization traversal MUST remain inside the concrete adapter and MUST NOT make directory synchronization optional for any of the five Providers.

#### Scenario: Manual sync targets any initial Provider
- **WHEN** manual directory sync runs for Slack, Feishu/Lark, DingTalk, WeCom or Microsoft Teams
- **THEN** the corresponding adapter MUST read every page or organization node required by its configured scope before returning a successful complete snapshot

### Requirement: Shared directory identity facts MUST remain minimal
A common directory entry MUST contain provider user ID, display name, optional Email and availability. Missing Email MUST remain a valid Provider identity fact. Provider cursors, raw responses and topology-specific data MUST remain inside the concrete adapter unless a separately specified Provider operation requires them.

#### Scenario: Provider user has no readable Email
- **WHEN** a Slack or Feishu/Lark directory entry omits Email because of data or permission constraints
- **THEN** the complete snapshot MUST retain the identity by provider user ID and MUST NOT invent or require an Email value

### Requirement: Provider-specific directory topology MUST not leak into the shared contract
Slack cursor pagination, Feishu/Lark department traversal and the Provider-specific directory traversal used by DingTalk, WeCom and Microsoft Teams MUST produce the same complete-snapshot semantic result without requiring callers to understand any traversal protocol.

#### Scenario: Providers expose different traversal models
- **WHEN** the five initial Providers expose different pagination, department or organization traversal models
- **THEN** each adapter MUST finish its own traversal and return the same snapshot-level success or failure semantics
