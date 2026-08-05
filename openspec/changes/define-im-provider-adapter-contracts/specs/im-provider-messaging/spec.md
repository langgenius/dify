## ADDED Requirements

### Requirement: Messaging MUST be exposed as adapter-bound capabilities
Every initial `IMProviderAdapter` MUST expose Basic Messaging bound to the adapter's immutable Provider configuration and namespace. Only Slack, Feishu/Lark and Microsoft Teams MUST additionally expose Dynamic Card Messaging in this release; DingTalk and WeCom MUST not expose it. Messaging operations MUST NOT accept credentials, SDK clients or a generic integration context. Messaging views MAY borrow the root-owned Provider API client context and MUST NOT close or replace that context. Messaging operations belong to the adapter's externally serialized root-context set and MUST NOT overlap another root, Directory, Messaging or Dynamic Card Messaging operation on the same adapter. A later call MAY execute on a different thread after a safe caller-managed handoff. Independent Webhook handling and STREAM factory calls MAY overlap Messaging operations.

#### Scenario: Multiple Messaging operations use one adapter
- **WHEN** a caller sends multiple messages through the same adapter
- **THEN** the operations MUST execute serially using the same bound Provider configuration and namespace without receiving credentials again
- **AND** when Messaging borrows a root-owned API client context, it MUST leave that context open for the root adapter to close

#### Scenario: Provider has no dynamic-card support
- **WHEN** a caller inspects Dynamic Card Messaging on DingTalk or WeCom
- **THEN** the capability MUST be absent and MUST NOT be represented by dummy unsupported methods

### Requirement: New-message operations MUST receive ProviderUserId
Every personal new-message operation MUST accept the same nominal `ProviderUserId` string type returned by Directory. The value MUST identify a user and be comparable only within the `(provider, provider_tenant_id)` namespace; it MUST NOT be globally comparable. For Feishu/Lark, Messaging MUST interpret the value as `union_id`, using the fixed `union_id` receive-ID type, and MUST NOT interpret it as application-scoped `open_id`. Messaging MUST NOT invoke Directory during send. The concrete Messaging capability MUST own any conversion from `ProviderUserId` to private transport addressing or conversation state.

#### Scenario: Feishu or Lark user is messaged
- **WHEN** Messaging sends to a Feishu or Lark `ProviderUserId` returned by Directory
- **THEN** the concrete adapter MUST use it as `union_id` without requiring the caller to select or supply a receive-ID type

#### Scenario: Provider user identity is not a direct transport address
- **WHEN** Microsoft Teams requires a personal conversation ID to send to one directory user
- **THEN** Messaging MUST acquire or recover that conversation internally from `ProviderUserId`, bound configuration and capability-local state without requiring the caller to supply conversation facts

### Requirement: Basic Messaging MUST be implemented by every initial Provider
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams MUST implement Basic Messaging containing `send_text`. It MUST accept `ProviderUserId`. Basic Messaging MUST NOT expose a separate recipient-reachability preflight operation.

#### Scenario: Provider user cannot receive a message
- **WHEN** `send_text` attempts to send to a Provider user that cannot receive the message
- **THEN** it MUST return a known rejection confirming that no message was accepted
- **AND** it MUST NOT invoke Directory or automatically retry message creation

### Requirement: Channel connection testing MUST remain outside Messaging
Channel Test connection MUST be owned by channel-management and application orchestration. The orchestration MAY compose root adapter credential testing, channel-level checks and, when test delivery is required, a real send operation. It MUST NOT be represented by a dedicated Basic or Dynamic Card Messaging operation. Message-template tests and Debug Mode deliveries MUST exercise a real send operation rather than a recipient-reachability preflight.

#### Scenario: Application tests an IM channel connection
- **WHEN** channel-management tests one candidate IM channel configuration
- **THEN** application orchestration MUST use the existing root and send operations required by its test policy
- **AND** Messaging MUST expose neither a connection-test operation nor a recipient-reachability preflight

#### Scenario: Application tests a configured message template
- **WHEN** application orchestration delivers a template test to a selected Provider user
- **THEN** the application MUST invoke the applicable real `send_text` or `send_card` operation and interpret its normal send result

### Requirement: Dynamic Card Messaging MUST group assessment, send and update
Dynamic Card Messaging MUST contain side-effect-free card representability assessment, `send_card` and exact-reference card update. Assessment MUST receive one complete normalized card intent whose form structure remains aligned with the HITL form presentation model, including rendered form content, complete ordered form inputs and actions. It MUST return a boolean representability decision plus an optional human-readable reason. The reason MUST be used only for diagnostics and MUST NOT be parsed as a stable decision code.

#### Scenario: Provider can represent a card intent
- **WHEN** assessment receives a complete normalized card intent whose controls and semantics can all be preserved on the Provider
- **THEN** it MUST return true without sending a message or creating Provider state

#### Scenario: Provider cannot represent a card intent
- **WHEN** assessment receives a complete normalized card intent containing any control or semantic that the Provider cannot map to its Card Input Controls
- **THEN** it MUST return false for the entire intent with an optional reason and MUST NOT issue a Provider operation

### Requirement: Card assessment MUST evaluate every form input
The normalized card intent accepted by assessment MUST preserve every HITL form input, including `FILE` and `FILE_LIST`. Assessment MUST evaluate the complete intent, MUST NOT ignore an unsupported input to report partial representability and MUST NOT substitute a Provider attachment or upload control for a form input. The assessment operation MUST return only its representability result and MUST NOT create, modify or select a business `DeliveryEndpoint`.

#### Scenario: A form contains one file input
- **WHEN** Slack, Feishu/Lark or Microsoft Teams assessment receives a complete intent containing `FILE`
- **THEN** it MUST return false without issuing a Provider operation because no initial Dynamic Card implementation can express that input control

#### Scenario: A form contains a file-list input
- **WHEN** Slack, Feishu/Lark or Microsoft Teams assessment receives a complete intent containing `FILE_LIST`
- **THEN** it MUST return false without issuing a Provider operation because no initial Dynamic Card implementation can express that input control

#### Scenario: Only one input is unsupported
- **WHEN** every other form element is representable but one input cannot be mapped by the concrete Provider
- **THEN** assessment MUST return false for the complete intent instead of reporting a partial-card result

### Requirement: Basic and Dynamic Card Messaging MUST expose distinct send operations
Basic Messaging MUST expose `send_text`; Dynamic Card Messaging MUST expose `send_card`. `send_text` MUST receive one `ProviderUserId` and one fully rendered CommonMark body without custom tags. The concrete adapter MUST render supported formatting for its Provider and MUST fall back to the same content as plain text when formatting is not expressible. `send_card` MUST receive one `ProviderUserId`, one normalized card intent and opaque caller metadata.

#### Scenario: Provider cannot express CommonMark formatting
- **WHEN** `send_text` receives valid CommonMark whose formatting cannot be represented on the target Provider
- **THEN** the concrete adapter MUST send equivalent plain text instead of rejecting the operation

#### Scenario: Card renderer rejects its input
- **WHEN** `send_card` receives an intent the concrete renderer cannot render
- **THEN** it MUST return a typed rendering failure before issuing any Provider send call and MUST NOT invoke `send_text` implicitly

### Requirement: Successful send MUST return Provider acceptance and an exact message reference
A successful `send_text` or `send_card` MUST return available Provider acceptance facts and a Provider-discriminated message reference sufficient to target that exact message later. Provider acceptance MUST remain distinct from end-user delivery, and the shared contract MUST NOT assume one scalar message ID format.

#### Scenario: Providers return different message locators
- **WHEN** Slack identifies a message by channel and timestamp while Feishu/Lark identifies it by message ID
- **THEN** Messaging MUST preserve each Provider's exact reference without coercing both into one global identifier

### Requirement: One Messaging invocation MUST attempt each requested message mutation at most once
`send_text` and `send_card` MAY perform Provider-specific prerequisite operations such as Microsoft Teams conversation acquisition, but one invocation MUST attempt to create the requested message at most once. It MUST NOT automatically replay an ambiguous message-creation operation after timeout, connection reset, rate limit or ambiguous failure. Card update MUST likewise attempt the requested update at most once.

#### Scenario: Send result is ambiguous
- **WHEN** the adapter cannot determine whether a timed-out Provider request created a message
- **THEN** it MUST return an ambiguous outcome and MUST NOT call the Provider again

### Requirement: Dynamic Card Messaging MUST update the exact prior message reference
Card update MUST target only the Provider message reference returned by the corresponding `send_card` result. The shared contract MUST preserve Slack channel and timestamp, Feishu/Lark message ID, and Microsoft Teams activity and conversation context as Provider-discriminated locators. Update MUST return its own typed outcome without changing the earlier send result.

#### Scenario: Prior message reference is stale
- **WHEN** the Provider no longer accepts the stored message reference
- **THEN** card update MUST return a typed stale-reference failure and MUST NOT infer another message instance
