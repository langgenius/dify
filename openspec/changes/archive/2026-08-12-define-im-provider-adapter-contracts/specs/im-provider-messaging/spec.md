## ADDED Requirements

### Requirement: Messaging MUST be exposed as adapter-bound capabilities
Every initial `IMProviderAdapter` MUST expose Basic Messaging bound to the adapter's immutable Provider credentials and namespace. Only Slack, Feishu/Lark and Microsoft Teams MUST additionally expose Dynamic Card Messaging in this release. Messaging operations MUST accept no credentials, Provider clients or generic integration context and MUST follow the adapter's root-context concurrency and lifecycle contract.

#### Scenario: Multiple Messaging operations use one adapter
- **WHEN** a caller sends multiple messages through the same adapter
- **THEN** the operations MUST use the same bound Provider namespace without receiving credentials again

#### Scenario: Provider has no Dynamic Card Messaging
- **WHEN** a caller inspects Dynamic Card Messaging on DingTalk or WeCom
- **THEN** the capability MUST be `None`

### Requirement: New-message operations MUST receive ProviderUserId
Every personal new-message operation MUST accept the nominal `ProviderUserId` returned by Directory. The value MUST be interpreted only within the `(provider, provider_tenant_id)` namespace and MUST NOT be globally comparable. The caller MUST NOT be required to supply a Provider-specific transport address or conversation state.

For Feishu/Lark, Messaging MUST interpret `ProviderUserId` as `union_id` and MUST NOT interpret it as application-scoped `open_id`.

#### Scenario: Feishu or Lark user is messaged
- **WHEN** Messaging receives a Feishu or Lark `ProviderUserId`
- **THEN** the caller MUST NOT need to choose a receive-ID type or provide an `open_id`

#### Scenario: Provider identity is not a direct transport address
- **WHEN** the Provider needs transport addressing in addition to `ProviderUserId`
- **THEN** the shared new-message operation MUST still require only `ProviderUserId` from the caller

### Requirement: Basic Messaging MUST expose send_text for every initial Provider
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams MUST expose `send_text(provider_user_id, body)`. The body MUST be fully rendered CommonMark without custom tags. Unsupported formatting MUST preserve the same content as plain text rather than cause rejection for formatting alone. Basic Messaging MUST NOT expose a separate recipient-reachability preflight operation. `MessageSendingError` MUST mean that the operation did not obtain confirmed Provider acceptance; callers MUST NOT infer from that result alone whether the Provider accepted a message.

#### Scenario: Provider accepts a text message
- **WHEN** `send_text` is accepted by the Provider
- **THEN** it MUST return `MessageAccepted` with an opaque `MessageLocator`
- **AND** the result MUST NOT claim end-user delivery

#### Scenario: Text send does not yield confirmed acceptance
- **WHEN** `send_text` does not obtain confirmed Provider acceptance
- **THEN** it MUST return `MessageSendingError` with an operator-safe diagnostic reason
- **AND** the result MUST NOT claim that the Provider definitely rejected or accepted the message

### Requirement: Connection testing MUST remain outside Messaging
Messaging MUST expose neither a dedicated connection-test operation nor a recipient-reachability preflight. An application test that requires delivery MUST use the normal `send_text` or `send_card` operation and interpret its normal result.

#### Scenario: Application tests message delivery
- **WHEN** application orchestration sends a connection or template test to a selected Provider user
- **THEN** it MUST invoke the applicable real send operation rather than a separate Messaging probe

### Requirement: Dynamic Card Messaging MUST assess complete normalized intents
Dynamic Card Messaging MUST expose side-effect-free `assess(intent)`. `ResolvedForm` MUST contain fully rendered CommonMark content and the complete immutable HITL form definition. Assessment MUST evaluate every ordered input, action, default value and presentation fact. It MUST return one whole-intent representability decision and MAY return an operator-safe diagnostic reason. The reason MUST NOT be parsed as a stable decision code.

#### Scenario: Provider can represent a card intent
- **WHEN** every control and semantic in the complete intent can be preserved
- **THEN** assessment MUST return representable without creating Provider state

#### Scenario: Provider cannot represent a card intent
- **WHEN** any control or semantic in the complete intent cannot be preserved
- **THEN** assessment MUST return not representable for the entire intent without creating Provider state

#### Scenario: A form contains FILE or FILE_LIST
- **WHEN** assessment for an initial Dynamic Card Provider receives a complete intent containing `FILE` or `FILE_LIST`
- **THEN** it MUST return not representable without filtering out that input

### Requirement: Dynamic Card Messaging MUST send one complete card
Dynamic Card Messaging MUST expose `send_card(provider_user_id, intent, correlation_token)`. The operation MUST receive the same complete `ResolvedForm` used by assessment. The caller MUST NOT invoke `send_card` when `assess(intent)` returns `representable=False`. If an unrepresentable intent is nevertheless passed, `send_card` MUST raise `DynamicCardMessagingError` before creating a Provider message. `CorrelationToken` MUST be a caller-issued opaque string used only for later interaction correlation. Every interaction callback originating from the card MUST expose the supplied token unchanged, and the adapter MUST NOT interpret it. A card send failure MUST NOT implicitly send a text fallback or create a partial card.

#### Scenario: Provider accepts a dynamic card
- **WHEN** `send_card` is accepted by the Provider
- **THEN** it MUST return `MessageAccepted` with an opaque `MessageLocator`

#### Scenario: A dynamic card contains multiple callback-capable actions
- **WHEN** different callback-capable actions on a card are invoked
- **THEN** every resulting callback MUST expose the same `CorrelationToken` supplied to `send_card`
- **AND** each callback MUST preserve the identity of the invoked action

#### Scenario: Card intent cannot be represented
- **WHEN** `send_card` cannot preserve the complete input intent
- **THEN** it MUST raise `DynamicCardMessagingError` without creating a Provider message

### Requirement: MessageLocator MUST be an opaque persistent round-trip value
`MessageLocator` MUST identify the exact Provider message accepted by `send_text` or `send_card`. A caller MAY persist, compare, and return the exact value to a compatible adapter, including after adapter recreation or process restart. A caller MUST NOT interpret, alter or synthesize a locator. The common interface MUST NOT expose Provider locator fields or assume one Provider-wide scalar message ID format.

#### Scenario: A message locator crosses a process boundary
- **WHEN** a caller persists a successful send locator and later rehydrates it unchanged
- **THEN** a compatible adapter MUST be able to consume the locator without access to the original adapter instance

#### Scenario: Providers use different message locators
- **WHEN** Providers require different facts to identify an exact message
- **THEN** those differences MUST remain opaque behind `MessageLocator`

### Requirement: Messaging MUST NOT automatically repeat a requested mutation
One `send_text` or `send_card` invocation MUST attempt the requested message creation at most once. One `replace_with_static` invocation MUST attempt the requested replacement at most once. An invocation MUST NOT automatically repeat a requested mutation whose outcome is uncertain.

#### Scenario: Message creation outcome is uncertain
- **WHEN** Messaging cannot determine whether the Provider accepted a requested creation
- **THEN** it MUST NOT attempt that creation again within the same invocation

### Requirement: Dynamic Card Messaging MUST replace the exact accepted card with a static presentation
Dynamic Card Messaging MUST expose `replace_with_static(locator, intent)`. The `locator` argument MUST be an unmodified `MessageLocator` returned by `send_card` from a compatible adapter bound to the same Provider and tenant. `StaticCardIntent` MUST contain the caller-rendered static CommonMark presentation and MUST contain no interactive inputs, actions or callback metadata. The operation MUST replace only the exact card identified by the supplied `MessageLocator`. A successful operation MUST return `None`. A failure MUST return `ReplacementError`; its `kind` MUST be a `ReplacementErrorKind` distinguishing `INVALID_REFERENCE`, `STALE_REFERENCE` and `UNKNOWN`.

#### Scenario: A committed submission is reflected on the Provider
- **WHEN** the caller passes the exact accepted card locator and a static intent after the business submission commits
- **THEN** `replace_with_static` MUST replace that card with the supplied static presentation

#### Scenario: Message locator is invalid or incompatible
- **WHEN** `replace_with_static` receives a malformed, altered or incompatible locator
- **THEN** it MUST return `INVALID_REFERENCE` without mutating a Provider message

#### Scenario: Referenced card is stale
- **WHEN** the Provider no longer accepts the referenced card for replacement
- **THEN** `replace_with_static` MUST return `STALE_REFERENCE` without selecting another message
