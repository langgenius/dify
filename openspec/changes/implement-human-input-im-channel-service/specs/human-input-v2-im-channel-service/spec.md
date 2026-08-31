## ADDED Requirements

### Requirement: IMChannelService MUST expose owner-bound management operations
`IMChannelService` MUST expose available-Provider read、current read、ID-addressed read、candidate test、create、ordinary update、explicit replacement and delete。`WorkspaceIMChannelService` MUST bind trusted Tenant、Account、Session factory and credential codec at construction，then initialize the separate owner-bound Reader and Writer internally。Operation methods MUST NOT receive owner、scope、edition、actor、raw `owner_key` or SQLAlchemy `Session`。

#### Scenario: Workspace Service is called
- **WHEN** Workspace composition invokes a Service operation
- **THEN** every Reader and Writer created by that Service MUST be bound to the trusted Tenant and Account captured by its constructor
- **AND** private Provider preparation MUST use the same Workspace credential context

### Requirement: Private Provider preparation MUST complete before write transaction creation
`IMChannelService` MUST privately own Provider adapter lifetime、authentication、permission checks、Provider tenant resolution、safe metadata extraction and credential protection。Create、update and replacement MUST complete those steps before opening their write transaction。Candidate test MUST use only submitted credentials and MUST NOT create a Reader、Writer or database Session。No separate Provider preparation Port or application Service MUST be introduced。

#### Scenario: Provider preparation fails
- **WHEN** credentials、permissions or Provider tenant resolution fail
- **THEN** Service MUST return the existing safe Provider failure
- **AND** it MUST NOT create a write Session or call Repository mutation

#### Scenario: Candidate test succeeds
- **WHEN** submitted credentials pass Provider checks
- **THEN** Service MUST return credential-free success
- **AND** it MUST NOT read or write Channel persistence

#### Scenario: Provider failure is unexpected
- **WHEN** Provider preparation raises an unclassified exception
- **THEN** the original exception MUST propagate unchanged to the generic internal-error boundary
- **AND** Service and controller MUST NOT wrap it in another application error or expose its details in a controlled HTTP response

### Requirement: Local address and version checks MUST precede avoidable Provider I/O
Create MUST reject an already configured owner before preparation when the pre-read observes a Channel。Update、replacement and delete MUST reject missing/mismatched Channel ID before Provider I/O。Update/replacement/delete MUST reject an already stale numeric expected version before Provider I/O。Final concurrent correctness MUST still come from Repository create/CAS。

#### Scenario: Update path ID is not current
- **WHEN** update supplies a Channel ID different from the owner-bound current Channel
- **THEN** Service MUST return `ChannelNotFoundError`
- **AND** it MUST NOT call Provider preparation

#### Scenario: Expected version is stale before preparation
- **WHEN** current Channel version differs from numeric expected version
- **THEN** Service MUST return `ProviderConfigurationUpdatedError`
- **AND** it MUST NOT call Provider preparation

#### Scenario: Concurrent create wins after pre-read
- **WHEN** pre-read observes no Channel but another create commits first
- **THEN** Repository conflict MUST be mapped to `ChannelAlreadyConfiguredError`

### Requirement: Service MUST construct complete Channel values
Service MUST use its private `_now()`、`_new_channel_id()` and `_new_webhook_id()` helpers to construct persistence values。Create and replacement MUST generate new Channel ID and `webhook_id`。Ordinary update MUST preserve current ID、`webhook_id` and created timestamp。Create/replacement MUST use initial version `1`；update MUST use expected version plus one。Each transition MUST call `_now()` once and reuse that value for all timestamps owned by the transition。

#### Scenario: Channel is created
- **WHEN** Provider preparation succeeds and owner slot remains empty
- **THEN** Service MUST persist a new connected Channel with `status_reason = null`
- **AND** created/updated timestamps MUST use the same clock value

#### Scenario: Channel is updated
- **WHEN** prepared Provider namespace matches current Channel
- **THEN** Service MUST preserve Channel ID and `webhook_id`
- **AND** it MUST update protected configuration、safe metadata、updated timestamp and numeric version

#### Scenario: Channel is explicitly replaced
- **WHEN** explicit replacement passes preparation and CAS
- **THEN** Service MUST persist a different Channel ID and new `webhook_id` at the initial version

### Requirement: Ordinary update MUST require the same Provider namespace
Ordinary update MUST compare both Provider and Provider tenant ID after successful preparation。A mismatch MUST return existing `ReplacementRequiredError` without calling Repository update。Explicit replacement MUST be the only ordinary management operation that persists a different Provider namespace。

#### Scenario: Provider discriminator changes
- **WHEN** update credentials select a Provider different from current Channel
- **THEN** Service MUST return `ReplacementRequiredError`
- **AND** current Channel MUST remain unchanged

#### Scenario: Provider tenant changes
- **WHEN** Provider preparation resolves a different Provider tenant ID
- **THEN** Service MUST return `ReplacementRequiredError`
- **AND** current Channel MUST remain unchanged

### Requirement: Delete MUST perform no Provider I/O
Delete MUST validate current Channel ID and numeric expected version and call Repository delete inside one write transaction。It MUST NOT call Provider test、prepare、disconnect or cleanup。Success MUST return the deleted Channel ID。

#### Scenario: Current Channel is deleted
- **WHEN** Repository delete succeeds
- **THEN** Service MUST return the addressed Channel ID after transaction commit

#### Scenario: Delete is stale
- **WHEN** Repository raises `StaleIMChannelWriteError`
- **THEN** Service MUST return `ProviderConfigurationUpdatedError`
- **AND** it MUST NOT retry against newer state

### Requirement: Service MUST own short database transaction spans
Read operations MUST use short read Sessions。Write operations MUST open `session.begin()` only after Provider preparation and value construction complete。The Service MUST create the owner-bound Repository with that Session、invoke one Repository mutation and leave commit/rollback to context exit。It MUST NOT perform Provider I/O、task dispatch or unrelated work while the write transaction is open。

#### Scenario: Repository mutation fails
- **WHEN** Repository raises before transaction exit
- **THEN** Service transaction MUST roll back
- **AND** no partial Channel mutation MUST commit

#### Scenario: Provider preparation is slow
- **WHEN** remote Provider I/O takes time
- **THEN** no write Session/transaction MUST remain open during that I/O

### Requirement: Service MUST return credential-free Channel views
Current read、ID-addressed read、create、update and replacement MUST return `IMChannelView` rather than Repository `IMChannel`。The view MUST exclude encrypted credentials、raw `owner_key`、configuring actor、Provider raw payload and ORM record。It MUST contain the safe facts required by existing `ChannelSummary` and opaque `ConfigVersion` projection。

`IMProvider.supports_webhook()` MUST be the sole Provider-level capability source。It MUST return `True` for Slack、Feishu、Lark and Microsoft Teams，and `False` for DingTalk and WeCom，matching the current adapter implementations。The method MUST NOT read credentials、construct an adapter or decide whether one concrete credential set can create a handler。

`IMEventTransportMode` MUST contain only `WEBHOOK` and `STREAM`。`dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE` MUST be a required typed deployment configuration value。Missing or invalid configuration MUST fail during configuration loading without an implicit default or third mode。Channel Management and ingress MUST read that shared global value directly rather than introducing a resolver abstraction。Console requests MUST NOT select or override mode，and mode MUST NOT enter Channel persistence or encrypted credentials。

Private `im_channel_service._generate_im_provider_webhook_url(webhook_id)` MUST use current `TRIGGER_URL`、the fixed `/callbacks/human-input/v2/im/<webhook_id>` path and URL-safe joining/escaping。It MUST NOT live under `core.trigger.utils`、reuse or produce the Workflow Trigger `/triggers/webhook/<webhook_id>` path。Changing `TRIGGER_URL` MUST affect subsequent projection without updating Channel persistence。

`IMChannelService._to_view()` MUST be the sole application projection that constructs `IMChannelView`。Only when effective mode is `WEBHOOK` and `IMProvider.supports_webhook()` returns `True` MUST it derive `webhook_url` from persisted `webhook_id` through the private Service-module helper；otherwise `webhook_url` MUST be `null`。The projection MUST NOT duplicate Provider capability、expose raw `webhook_id` or introduce a callback URL resolver or Webhook ingress。

#### Scenario: Webhook-capable Channel is projected
- **WHEN** effective mode is `WEBHOOK` and a persisted Slack、Feishu、Lark or Microsoft Teams Channel is mapped to `IMChannelView`
- **THEN** `webhook_url` MUST use the configured `TRIGGER_URL`、the fixed Human Input callback path and the Channel's persisted `webhook_id`
- **AND** the view MUST NOT expose raw `webhook_id`

#### Scenario: Stream-only Channel is projected
- **WHEN** effective mode is `STREAM` or a persisted DingTalk or WeCom Channel is mapped to `IMChannelView`
- **THEN** `webhook_url` MUST be `null`

#### Scenario: Current Channel is read
- **WHEN** Service loads a persisted Channel
- **THEN** it MUST project safe metadata without decrypting credentials or calling Provider

#### Scenario: Mutation succeeds
- **WHEN** create、update or replacement commits
- **THEN** Service MUST return a view of the committed Channel ID/version
- **AND** controller MUST NOT need a follow-up persistence read

### Requirement: Service MUST map persistence failures to existing application failures
`IMChannelAlreadyConfiguredError` MUST map to `ChannelAlreadyConfiguredError`。`StaleIMChannelWriteError` MUST map to `ProviderConfigurationUpdatedError`。Missing/mismatched ID MUST map to `ChannelNotFoundError`。All other persistence failures MUST remain unclassified and propagate to the generic internal-error boundary；the Service MUST NOT catch them through a broad persistence wrapper or expose owner key、SQL、constraint name or credentials in controlled responses。

#### Scenario: Repository reports owner conflict
- **WHEN** concurrent create raises `IMChannelAlreadyConfiguredError`
- **THEN** Service MUST return the existing already-configured application failure

#### Scenario: Repository reports stale write
- **WHEN** update、replacement or delete raises `StaleIMChannelWriteError`
- **THEN** Service MUST return the existing provider-configuration-updated failure

### Requirement: Service MUST not orchestrate dependent domains
`IMChannelService` MUST NOT query、mutate or delete Identity、Binding、Sync/Reconciliation、Contact、Inbox、delivery or historical records。It MUST NOT define Webhook ingress、OAuth installation or remote cleanup behavior。

#### Scenario: Channel is replaced
- **WHEN** Service invokes Repository replacement
- **THEN** it MUST invoke no dependent Repository or task

#### Scenario: Channel is deleted
- **WHEN** Service invokes Repository delete
- **THEN** it MUST not wait for another domain's cleanup
