## ADDED Requirements

### Requirement: Messaging MUST be exposed as adapter-bound capabilities
Every initial `IMProviderAdapter` MUST expose Basic Messaging backed by the adapter-owned client context. Only Slack, Feishu/Lark and Microsoft Teams MUST additionally expose Dynamic Card Messaging in this release; DingTalk and WeCom MUST not expose it. Messaging operations MUST NOT accept credentials, SDK clients or a generic integration context, and obtaining either capability MUST NOT construct an independent Provider client.

#### Scenario: Multiple Messaging operations use one adapter
- **WHEN** a caller tests a destination and then sends a message through the same adapter
- **THEN** both operations MUST reuse the adapter-owned client context without receiving credentials again

#### Scenario: Provider has no dynamic-card support
- **WHEN** a caller inspects Dynamic Card Messaging on DingTalk or WeCom
- **THEN** the capability MUST be absent and MUST NOT be represented by dummy unsupported methods

### Requirement: New-message operations MUST receive an explicit Provider message destination
A Provider message destination MUST contain only the Provider-specific addressing facts required to attempt a new message. It MUST remain distinct from a directory identity, Webhook endpoint and prior message reference, and the shared contract MUST NOT assume it is identical to provider user ID. Messaging MUST use the supplied destination without invoking Directory.

#### Scenario: Directory identity is not directly sendable
- **WHEN** a Provider requires addressing facts beyond provider user ID
- **THEN** Messaging MUST require those facts in the concrete Provider message destination and MUST NOT search Directory during send

### Requirement: Basic Messaging MUST be implemented by every initial Provider
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams MUST implement Basic Messaging containing `test_destination` and `send_text`. Destination reachability MUST remain independent from adapter credential testing.

#### Scenario: Credentials are valid but one destination is unreachable
- **WHEN** adapter credential testing succeeds but one Provider message destination cannot receive a message
- **THEN** `test_destination` MUST return a destination-specific failure without changing credential-test facts

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
Basic Messaging MUST expose `send_text`; Dynamic Card Messaging MUST expose `send_card`. `send_text` MUST receive one Provider message destination and one fully rendered CommonMark body without custom tags. The concrete adapter MUST render supported formatting for its Provider and MUST fall back to the same content as plain text when formatting is not expressible. `send_card` MUST receive one Provider message destination, one normalized card intent and opaque caller metadata.

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

### Requirement: One side-effecting Messaging invocation MUST call the Provider at most once
`test_destination`, `send_text` and `send_card` MUST NOT automatically replay a side-effecting Provider call after timeout, connection reset, rate limit or ambiguous failure. One method invocation MUST issue at most one such call and MUST return a typed known or ambiguous outcome.

#### Scenario: Send result is ambiguous
- **WHEN** the adapter cannot determine whether a timed-out Provider request created a message
- **THEN** it MUST return an ambiguous outcome and MUST NOT call the Provider again

### Requirement: Dynamic Card Messaging MUST update the exact prior message reference
Card update MUST target only the Provider message reference returned by the corresponding `send_card` result. The shared contract MUST preserve Slack channel and timestamp, Feishu/Lark message ID, and Microsoft Teams activity and conversation context as Provider-discriminated locators. Update MUST return its own typed outcome without changing the earlier send result.

#### Scenario: Prior message reference is stale
- **WHEN** the Provider no longer accepts the stored message reference
- **THEN** card update MUST return a typed stale-reference failure and MUST NOT infer another message instance
