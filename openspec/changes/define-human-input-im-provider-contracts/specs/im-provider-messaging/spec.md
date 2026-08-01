## ADDED Requirements

### Requirement: New-message operations MUST receive an explicit Provider message destination
A Provider message destination MUST mean only the Provider-specific addressing facts required to attempt a new message to the selected bound identity. It MUST NOT be interpreted as a Dify Contact, Human Input business recipient, IM binding, Delivery Endpoint, Webhook endpoint or prior message reference, and the shared contract MUST NOT assume it is identical to provider user ID. Basic Messaging reachability/link operations and Dynamic Card Messaging `send_card` MUST receive Provider integration context and the applicable Provider message destination. Card representability assessment MUST remain destination-free, while card update MUST receive the exact stored prior message reference instead. None of these operations may invoke the Directory reader or perform Contact, binding, recipient or authorization resolution.

#### Scenario: Bound identity receives a notification
- **WHEN** Dify supplies the Provider-specific destination facts required to attempt a new message to the selected bound identity
- **THEN** Messaging MUST use that destination without refreshing or searching the Provider directory and MUST NOT treat it as business recipient state

### Requirement: Basic Messaging MUST be implemented by every initial Provider
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams MUST implement Basic Messaging containing destination-specific reachability testing and `send_text`. An identity reachability test MUST test one concrete Provider message destination and MUST NOT be implemented as an alias of Integration credential, tenant, permission or event transport diagnostics. `send_text` MUST remain available as the non-card fallback even when the Provider also implements Dynamic Card Messaging.

#### Scenario: Credentials are valid but one message destination is unreachable
- **WHEN** Integration diagnostics succeed but the selected Provider identity cannot receive a message
- **THEN** the reachability test MUST return a destination-specific failure without changing Integration health facts

#### Scenario: Card-capable Provider uses the text fallback
- **WHEN** Slack, Feishu/Lark or Microsoft Teams receives a non-card fallback Delivery Endpoint
- **THEN** its Basic Messaging implementation MUST invoke `send_text` without requiring Dynamic Card Messaging

### Requirement: Dynamic Card Messaging MUST group assessment, send and update
Slack, Feishu/Lark and Microsoft Teams MUST additionally implement Dynamic Card Messaging containing side-effect-free card representability assessment, `send_card` and card update. DingTalk and WeCom MUST NOT be required to implement dummy dynamic-card methods. The assessment MUST determine whether one normalized interactive-card intent can be represented without changing its form semantics. Its result MUST contain a boolean representability decision and an optional human-readable reason. Dify MUST branch only on the boolean; the reason MUST be used only for logging and MUST NOT be parsed as a stable error code or business decision input. The assessment MUST NOT accept a Delivery Endpoint or Provider message destination, send a Provider message, read the Directory or create a Delivery.

#### Scenario: Provider can represent the normalized card intent
- **WHEN** Dify assesses a normalized interactive-card intent whose controls and semantics the target Provider can represent
- **THEN** Messaging MUST return a true representability result without side effects so Dify can create a card Delivery Endpoint

#### Scenario: Provider cannot represent one form control
- **WHEN** Dify assesses a normalized interactive-card intent containing a control such as file upload that the target Provider cannot represent
- **THEN** Messaging MUST return false with a human-readable reason without sending a message, and Dify MUST create a text fallback Delivery Endpoint based only on the false result

### Requirement: Basic and Dynamic Card Messaging MUST expose distinct send operations
Basic Messaging MUST expose `send_text`; Dynamic Card Messaging MUST expose `send_card`. They MUST remain distinct operations rather than one send operation that selects a channel. `send_text` MUST receive a Provider message destination separately from one fully rendered CommonMark message body. The upstream renderer or notification application service MUST complete URL interpolation before `send_text` is called, MUST use CommonMark as the markdown definition, and MUST NOT emit custom tags. The Provider adapter MUST decide how to render that CommonMark on the target platform and, if the markdown formatting is not expressible there, MUST fall back to sending the same content as plain text instead of rejecting the send. `send_card` MUST receive a Provider message destination separately from normalized interactive-card intent, actions and opaque association metadata. The message content models MUST NOT contain the destination, and neither operation may accept Human Input task, grant or ORM objects.

#### Scenario: DingTalk or WeCom notification is sent
- **WHEN** Human Input targets DingTalk or WeCom in the initial scope
- **THEN** the text fallback Delivery Endpoint MUST invoke `send_text` and MUST NOT require dynamic interactive-card rendering

#### Scenario: Card-compatible form targets Slack, Feishu/Lark or Teams
- **WHEN** card representability assessment returns true and Dify creates a card Delivery Endpoint for Slack, Feishu/Lark or Microsoft Teams
- **THEN** that endpoint MUST invoke `send_card` and MUST preserve the opaque association metadata required for a later card submission

#### Scenario: Form requires file upload
- **WHEN** card representability assessment returns false and Dify creates a text fallback Delivery Endpoint
- **THEN** that endpoint MUST invoke `send_text` with one fully rendered CommonMark body that already embeds the Request URL needed to complete the form on the Dify web page

#### Scenario: Provider cannot express markdown formatting
- **WHEN** `send_text` receives valid CommonMark content whose markdown formatting cannot be represented on the target Provider surface
- **THEN** the Provider adapter MUST still send the message by degrading that content to plain text instead of rejecting the operation

#### Scenario: Card renderer rejects the endpoint input
- **WHEN** `send_card` receives an intent that its concrete renderer cannot render despite the earlier endpoint selection
- **THEN** it MUST raise an explicit card-rendering exception before issuing any Provider send call and MUST NOT invoke `send_text` or silently change the Delivery Endpoint channel

### Requirement: Successful send MUST return Provider acceptance and an exact message reference
Messaging MUST distinguish Provider acceptance from end-user delivery. A successful `send_text` or `send_card` MUST return the available Provider acceptance facts and a Provider-discriminated message reference sufficient to target that exact message later. The shared contract MUST NOT assume one scalar `card_id` format.

#### Scenario: Slack and Feishu return different message locators
- **WHEN** Slack identifies a message by channel/timestamp and Feishu/Lark identifies it by message ID
- **THEN** Messaging MUST preserve the correct Provider-specific reference without coercing both into one misleading global identifier

#### Scenario: Provider accepts a send request
- **WHEN** a Provider API accepts a message but supplies no delivery receipt
- **THEN** the delivery attempt MUST record Provider acceptance and MUST NOT be marked delivered

### Requirement: One delivery attempt MUST make at most one side-effecting send call
Binding test, `send_text` and `send_card` MUST NOT automatically replay a side-effecting Provider call after timeout, connection reset, rate limit or ambiguous failure. One attempt MUST issue at most one such call.

#### Scenario: Send result is ambiguous
- **WHEN** Dify cannot determine whether a timed-out Provider request created the message
- **THEN** the attempt MUST preserve the ambiguous failure and MUST NOT automatically call the Provider again

#### Scenario: User requests Resend
- **WHEN** an authorized user explicitly requests Resend after a failed or ambiguous attempt
- **THEN** Dify MUST create a new delivery attempt using current credentials and the current Provider message destination rather than replaying the original attempt implicitly

### Requirement: Dynamic Card Messaging MUST update the exact prior Provider message reference
Slack, Feishu/Lark and Microsoft Teams Dynamic Card Messaging MUST update only the instance identified by the Provider message reference returned by the corresponding `send_card` attempt. The shared contract MUST preserve Slack `channel + ts`, Feishu/Lark `message_id`, and Microsoft Teams `activity_id + conversation context` as Provider-discriminated locators. Update MUST return its own success or typed failure without changing the recorded outcome of the earlier send. Card send and update MUST remain operations of the same optional Dynamic Card Messaging capability rather than separate capabilities.

#### Scenario: One exact prior card reference is updated
- **WHEN** the update operation receives a Provider message reference returned by an earlier `send_card` attempt
- **THEN** it MUST target that reference without inferring or selecting any additional message references

#### Scenario: Each card-capable Provider updates its own message locator
- **WHEN** Slack, Feishu/Lark or Microsoft Teams updates a card previously sent by the same Provider adapter
- **THEN** Dynamic Card Messaging MUST use that Provider's exact stored locator and MUST NOT coerce it into one global card ID

#### Scenario: Provider message reference is stale
- **WHEN** the Provider no longer accepts the stored reference
- **THEN** Messaging MUST return a typed update failure and MUST NOT reinterpret the reference as another message instance
