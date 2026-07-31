## ADDED Requirements

### Requirement: Provider Messaging MUST consume a resolved delivery target without reading the directory
Messaging operations MUST accept Provider integration context and a provider-resolved delivery target. They MUST NOT invoke the Directory reader or perform Contact, binding, recipient or authorization resolution.

#### Scenario: Bound identity receives a notification
- **WHEN** Dify has resolved a current Provider delivery target from an effective IM binding
- **THEN** Messaging MUST use that target directly and MUST NOT refresh or search the Provider directory before sending

### Requirement: Integration diagnostics and identity reachability tests MUST remain separate
An identity reachability test MUST test one concrete Provider delivery target. It MUST NOT be implemented as an alias of Integration credential, tenant, permission or event transport diagnostics.

#### Scenario: Credentials are valid but one target is unreachable
- **WHEN** Integration diagnostics succeed but the selected Provider identity cannot receive a message
- **THEN** the reachability test MUST return a target-specific failure without changing Integration health facts

### Requirement: Provider Messaging MUST assess card representability before Delivery Endpoint creation
Slack, Feishu/Lark and Microsoft Teams Provider Messaging MUST expose a side-effect-free operation that assesses whether one normalized interactive-card intent can be represented without changing its form semantics. The result MUST contain a boolean representability decision and an optional human-readable reason. Dify MUST branch only on the boolean; the reason MUST be used only for logging and MUST NOT be parsed as a stable error code or business decision input. The assessment MUST NOT accept a Delivery Endpoint or delivery target, send a Provider message, read the Directory or create a Delivery.

#### Scenario: Provider can represent the normalized card intent
- **WHEN** Dify assesses a normalized interactive-card intent whose controls and semantics the target Provider can represent
- **THEN** Messaging MUST return a true representability result without side effects so Dify can create a card Delivery Endpoint

#### Scenario: Provider cannot represent one form control
- **WHEN** Dify assesses a normalized interactive-card intent containing a control such as file upload that the target Provider cannot represent
- **THEN** Messaging MUST return false with a human-readable reason without sending a message, and Dify MUST create a Request URL link Delivery Endpoint based only on the false result

### Requirement: Link-message and interactive-card sends MUST be distinct operations
Provider Messaging MUST expose distinct `send_link_message` and `send_card` operations rather than one send operation that selects a channel. Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams MUST support `send_link_message`. Slack, Feishu/Lark and Microsoft Teams MUST additionally support `send_card`. Link-message input MUST contain a resolved delivery target, rendered notification content and Request URL. Interactive-card input MUST contain a resolved delivery target, normalized interactive-card intent, actions and opaque interaction context. Neither operation may accept Human Input task, grant or ORM objects.

#### Scenario: DingTalk or WeCom notification is sent
- **WHEN** Human Input targets DingTalk or WeCom in the initial scope
- **THEN** the Request URL Delivery Endpoint MUST invoke `send_link_message` and MUST NOT require dynamic interactive-card rendering

#### Scenario: Card-compatible form targets Slack, Feishu/Lark or Teams
- **WHEN** card representability assessment returns true and Dify creates a card Delivery Endpoint for Slack, Feishu/Lark or Microsoft Teams
- **THEN** that endpoint MUST invoke `send_card` and MUST preserve the opaque interaction context required for a later card submission

#### Scenario: Form requires file upload
- **WHEN** card representability assessment returns false and Dify creates a Request URL link Delivery Endpoint
- **THEN** that endpoint MUST invoke `send_link_message` so the user can complete the form on the Dify web page

#### Scenario: Card renderer rejects the endpoint input
- **WHEN** `send_card` receives an intent that its concrete renderer cannot render despite the earlier endpoint selection
- **THEN** it MUST raise an explicit card-rendering exception before issuing any Provider send call and MUST NOT invoke `send_link_message` or silently change the Delivery Endpoint channel

### Requirement: Successful send MUST return Provider acceptance and an exact message reference
Messaging MUST distinguish Provider acceptance from end-user delivery. A successful `send_link_message` or `send_card` MUST return the available Provider acceptance facts and a Provider-discriminated message reference sufficient to target that exact message later. The shared contract MUST NOT assume one scalar `card_id` format.

#### Scenario: Slack and Feishu return different message locators
- **WHEN** Slack identifies a message by channel/timestamp and Feishu/Lark identifies it by message ID
- **THEN** Messaging MUST preserve the correct Provider-specific reference without coercing both into one misleading global identifier

#### Scenario: Provider accepts a send request
- **WHEN** a Provider API accepts a message but supplies no delivery receipt
- **THEN** the delivery attempt MUST record Provider acceptance and MUST NOT be marked delivered

### Requirement: One delivery attempt MUST make at most one side-effecting send call
Binding test, `send_link_message` and `send_card` MUST NOT automatically replay a side-effecting Provider call after timeout, connection reset, rate limit or ambiguous failure. One attempt MUST issue at most one such call.

#### Scenario: Send result is ambiguous
- **WHEN** Dify cannot determine whether a timed-out Provider request created the message
- **THEN** the attempt MUST preserve the ambiguous failure and MUST NOT automatically call the Provider again

#### Scenario: User requests Resend
- **WHEN** an authorized user explicitly requests Resend after a failed or ambiguous attempt
- **THEN** Dify MUST create a new delivery attempt using current credentials and target state rather than replaying the original attempt implicitly

### Requirement: Card update MUST target the exact prior Provider message reference
When a Provider supports card/message update, Messaging MUST update only the instance identified by the stored Provider message reference and MUST return a follow-up success or failure independent from the original task submission outcome.

#### Scenario: One task produced multiple cards
- **WHEN** a task has multiple IM delivery attempts and one card is handled
- **THEN** the update operation MUST receive and target only the reference from the corresponding delivery attempt

#### Scenario: Provider message reference is stale
- **WHEN** the Provider no longer accepts the stored reference
- **THEN** Messaging MUST return a typed update failure and MUST NOT reinterpret the reference as another message instance
