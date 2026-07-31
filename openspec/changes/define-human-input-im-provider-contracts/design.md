## Context

Human Input 需要通过 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 完成 Integration 校验、通讯录身份读取、链接或卡片投递、卡片交互接入和卡片状态更新。现有 Dify specs 已经拥有 Contact matching、IM identity/binding、recipient resolution、submission authorization 与 workflow resume 语义；本设计只补齐这些业务能力依赖的 Provider-facing contract，不重新定义业务模型。

Explore 阶段确认了以下约束：

- 通讯录读取和消息发送是独立操作；共享凭据、SDK client、tenant 配置或 provider user ID 不构成合并接口的理由。
- Webhook 和长连接在认证、ACK、重试与部署生命周期上保持独立，最早通过 `AuthenticatedEvent` 汇合；卡片协议再通过 `CardSubmissionRequest` 汇合。
- 入站事件采用 inbox pattern，通过简单的 Dify-owned Inbox Repository 把 `AuthenticatedEvent` 写入 application database 的一张专用 inbox 表；先提交记录并尽快 ACK，再由 worker 从表中 claim 和处理。
- 只有 Provider 给出 event ID 时才去重；没有 event ID 时不生成 payload hash 或其他替代去重键。
- Directory reader 只有在读完所有 Provider pages/nodes 并构建完整内存快照后才能返回成功；失败时不进入 reconciliation。
- Delivery Endpoint 创建前由 Provider Messaging 对 normalized interactive-card intent 做无副作用的 representability assessment；endpoint 一旦选定，发送阶段不再重新选择链接或卡片渠道。
- Side-effecting send 本期不自动重试；ambiguous outcome 保留为一次 attempt 的失败事实，人工 Resend 仍是新的显式 attempt。
- 删除 Integration 只清理本地凭据和 active bindings/overrides、停止本地 stream connection，并阻止新的 inbound event 进入业务处理；不撤销远端授权或修改 Provider 配置。

`STREAM` 在本设计中指 Provider 通过长生命周期 WebSocket/stream connection 投递事件，不是另一个与长连接并列的模式。Provider transport 支持矩阵为：

| Provider | `WEBHOOK` | `STREAM` | Supported Human Input notification forms |
| --- | --- | --- | --- |
| Slack | Supported | Supported | Request URL link message; interactive card |
| Feishu/Lark | Supported | Supported | Request URL link message; interactive card |
| DingTalk | Supported | Supported | Request URL link message |
| WeCom | Supported | Not supported | Request URL link message |
| Microsoft Teams | Supported | Not supported | Request URL link message; interactive card |

Deployment event transport mode 由部署配置注入，Integration 管理 API 只读展示 effective mode。具体 SaaS、CE、EE 到 mode 的映射不在当前材料中，本设计不自行补充。

## Goals / Non-Goals

**Goals:**

- 给 Dify application services 提供稳定、业务无关且按真实操作拆分的 Provider contract。
- 让 Directory、Messaging、Integration diagnostics 与 Event ingestion 可以独立实现、测试和替换。
- 明确 Provider-specific 数据停留在哪一层，以及何时可以转为 Provider-neutral facts。
- 保持 Human Input 的 Contact、binding、grant、authorization 和 workflow 语义在现有 Dify boundary 内。
- 为每个共享 contract 提供至少两个 Provider 的共同语义证据。

**Non-Goals:**

- 不构建动态插件系统、通用 Provider framework 或运行时 capability discovery framework。
- 不统一 Provider credentials、pagination、department topology、card JSON、message locator、签名或 ACK wire protocol。
- 不实现群聊通知、自动 directory sync、delivery receipt、自动发送重试或远端 Integration revoke/unsubscribe。
- 不设计连接配额、leader election、滚动部署、connection drain 或多连接负载策略。
- 不改变 Contact admission、recipient resolution、submission authorization、first-success 或 workflow resume 规则。

## Decisions

### 1. Use four narrow Provider contracts instead of one umbrella interface

Dify 只定义四个独立 contract；concrete Provider composition 可以共享同一 credentials object、SDK client 或 token cache，但不得因此合并这些 contract。

| Contract | 承载的具体操作 | 至少两个 Provider 的共同语义 |
| --- | --- | --- |
| Integration diagnostics | 校验 credentials；识别 provider tenant；检查基础权限；检查 effective deployment transport compatibility | Slack、Feishu/Lark、DingTalk 都需要凭据、tenant 与接入方式校验 |
| Directory reader | 读取当前 provider tenant 的完整用户身份快照 | Slack 分页读取 workspace users；Feishu/Lark 分页/按部门读取 tenant users；DingTalk、WeCom 与 Microsoft Teams 读取各自组织内的 tenant users；五个 Provider 都在完成各自分页或组织层级遍历后产出完整快照 |
| Messaging | 测试一个 delivery target；评估 normalized interactive-card intent 是否可表示；分别发送链接消息与交互卡片；返回精确 message reference；按 capability 更新原消息 | 五个 Provider 都共享 Request URL 链接消息；Slack、Feishu/Lark、Teams 共享无副作用的 card representability assessment、交互卡片发送及按原消息 reference 更新 |
| Event adapter | 认证一次 Provider delivery 并产出 `AuthenticatedEvent`；把卡片事件解码为 `CardSubmissionRequest` | Slack、Feishu/Lark 与 DingTalk 都同时支持 Webhook/stream 事件并在认证后产出相同 `AuthenticatedEvent` 语义；Slack、Feishu/Lark、Teams 都产生卡片 action submission |

Alternatives considered:

- One `IMProvider` interface containing every method. Rejected because it would make directory, transport and messaging lifecycle appear semantically coupled and force unsupported methods onto providers.
- One generic `execute(operation, payload)` entry point. Rejected because it discards type safety and hides the exact operations this change is meant to stabilize.

### 2. Keep provider inputs business-independent

Provider contracts MUST NOT accept Contact, IM binding, ApproverGrant, Human Input task ORM records or workflow runtime objects. Application services resolve business state first and pass only Provider-facing facts:

- Integration diagnostics receives provider-specific candidate credentials and the deployment-owned effective transport mode.
- Directory reader receives current provider tenant/credentials and returns provider identities; it never receives Contacts.
- Messaging card assessment receives only a normalized interactive-card intent. Messaging send operations receive a provider delivery target plus either link-message content or an interactive-card intent. An interaction context may be embedded as opaque application data, but the Provider adapter MUST NOT interpret task authorization semantics.
- Event decoding returns provider identity, action, submitted values, message reference and opaque interaction context; the Human Input adapter maps that context to task/delivery/recipient facts afterwards.

This boundary permits the same Provider implementation to serve future Dify callers without introducing a generic plugin framework.

### 3. Directory read returns only a complete in-memory snapshot

The Directory reader internally owns Provider pagination, department traversal and rate-limit handling for one call. It accumulates entries in memory and returns one immutable snapshot only after every required page/node has succeeded.

Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 都在初始 Directory reader 范围内。各 Provider 使用不同的目录 API、分页协议、组织层级和可见范围，但这些差异只影响 concrete adapter 如何完成读取，不改变五个 Provider 都必须提供完整租户用户身份快照的共同语义。

The snapshot carries the provider, provider tenant, fetch time and complete ordered identity entries. Common identity facts are limited to provider user ID, display name, optional Email and availability. Provider-specific pagination cursors and raw responses do not cross the contract.

If any page/node fails, the reader returns a typed failure and no snapshot. The sync worker MUST NOT run matching, absence detection, removal or reconciliation on partial entries.

Alternatives considered:

- Stream pages directly into reconciliation. Rejected because a late page failure could make an incomplete directory appear authoritative and incorrectly remove bindings.
- Return `entries + is_complete=false`. Rejected because it permits callers to accidentally consume partial entries. Success itself proves completeness.

### 4. Messaging never performs a live directory read

Target-specific Messaging tests and send operations consume a delivery target already resolved from current Dify IM identity and binding state. Card representability assessment does not consume a target. None of these operations calls the Directory reader.

Card representability assessment、link-message send 与 interactive-card send 是三个独立操作，因为它们的输入、时机和副作用不同：

- Card representability assessment 在 Delivery Endpoint 创建前接收 normalized interactive-card intent，不接收 delivery target 或 Delivery Endpoint，也不发送消息、读取 Directory 或创建 Delivery。它只返回是否可表示以及可选的人类可读 reason；Dify 只根据 boolean 选择 endpoint，reason 仅用于日志，不是稳定错误码，也不得参与业务判断。
- `send_link_message` is required for Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams. It receives a resolved delivery target, rendered notification text and Request URL, and returns Provider acceptance plus an exact message reference when available.
- `send_card` receives a resolved delivery target, normalized interactive-card intent, actions and opaque interaction context, and returns Provider acceptance plus an exact card/message reference.
- Provider-specific representability and rendering rules stay inside the concrete adapter; the shared contract does not define a universal Provider card JSON or control matrix.

Slack、Feishu/Lark 与 Microsoft Teams 支持交互卡片并不意味着所有 Human Input Form Content 都必须渲染成卡片。Human Input notification application service 先从 Form Content 生成 normalized interactive-card intent，再调用目标 Provider 的 card representability assessment：结果为 true 时创建 card Delivery Endpoint，结果为 false 时创建 Request URL link Delivery Endpoint。发送阶段根据已创建 endpoint 直接调用对应的 `send_card` 或 `send_link_message`，不再次选择渠道。

`send_card` 不要求调用方在发送时重复执行 assessment。Concrete renderer 收到无法渲染或与 card Delivery Endpoint 不一致的 intent 时，必须在任何 Provider send call 之前抛出明确的 card-rendering exception，且不得自行改调 `send_link_message`；是否改用链接必须通过创建新的相应 Delivery Endpoint 表达。该 exception 表示调用契约被破坏，不是 assessment 的正常 false 结果，也不是 ambiguous send outcome。Provider adapter 不负责读取 Human Input task 或决定 endpoint 类型。

A Provider message reference is a discriminated Provider-owned locator, not one assumed global `card_id`. Dify persists it without reinterpreting Slack channel/timestamp, Feishu message ID or Teams conversation/activity identity as interchangeable scalars.

Microsoft Teams may require a conversation reference or app installation state in addition to a directory user ID. The acquisition and persistence of that target is not established by current materials and remains an open question; the common Messaging contract MUST NOT assume that every provider user ID is directly sendable.

### 5. One outbound attempt makes at most one side-effecting send call

For binding test, `send_link_message` and `send_card`, one Dify delivery attempt invokes the side-effecting Provider operation at most once. Timeout, connection reset, 429 or other ambiguous failure MUST NOT trigger automatic replay.

The attempt records the returned safe Provider diagnostic and whether the result is known or ambiguous. A user-triggered Resend creates a new delivery attempt using then-current credentials and binding; it is not an automatic retry of the original attempt.

This decision does not add or change a card-status-update retry policy. Card update remains a capability-gated follow-up operation owned by its existing task-handling contract.

Alternatives considered:

- Retry timeout and 5xx automatically. Rejected for this phase because the providers do not share a confirmed idempotency mechanism and replay can duplicate user-visible messages.

### 6. Webhook and stream converge at `AuthenticatedEvent`

Before convergence, every provider/transport adapter owns its wire protocol:

- Webhook owns URL challenge, HTTP request validation, signature/timestamp/replay checks, decryption and HTTP ACK encoding.
- Stream owns connection authentication, control frames, reconnect protocol, envelope validation and protocol/SDK ACK.

After successful authentication, both produce an immutable `AuthenticatedEvent` containing:

- provider;
- provider tenant ID;
- optional provider event ID;
- provider event time and Dify receive time;
- immutable Provider-native payload after any required decryption.

The payload intentionally remains Provider-specific. `AuthenticatedEvent` proves origin and transport authentication; it does not claim that the payload is a card action or an authorized Human Input submission.

Alternatives considered:

- Normalize directly from HTTP/WebSocket input into a Human Input submission. Rejected because it conflates transport authentication with Provider card-protocol decoding and prevents reuse for other authenticated Provider events.
- Introduce one generic transport interface before authentication. Rejected because URL challenge, signature verification, connection lifecycle and ACK do not share stable semantics.

### 7. Inbox commit precedes ACK and business processing

Webhook and stream receivers use a simple Dify-owned Inbox Repository to persist `AuthenticatedEvent` directly into one dedicated `im_provider_event_inbox` table in the application database before sending a successful ACK. The table is the durable source of truth for accepted inbound events; a broker enqueue, if used to reduce worker latency, does not replace the table commit. After commit:

- Webhook returns the Provider-specific success response promptly.
- Stream returns the Provider-specific envelope ACK or allows the SDK handler to complete successfully.
- A worker later claims and processes the pending inbox record from the table.

If inbox persistence fails, the receiver MUST NOT acknowledge successful durable receipt. Submission authorization, current binding lookup and workflow resume never run on the receiver path.

The table stores an internal record ID, local Integration ID, provider, provider tenant ID, nullable provider event ID, provider event time, Dify receive time, immutable serialized Provider-native payload, and minimal processing status/outcome metadata. The local Integration ID is persistence routing metadata supplied by the receiver; it is not added to `AuthenticatedEvent` and does not change the Provider-neutral convergence boundary.

The Inbox Repository carries only three concrete responsibilities:

- atomically insert one authenticated delivery or resolve the existing record for an identified duplicate;
- allow a worker to claim pending records;
- record the terminal processing outcome needed to prevent an already completed record from being processed again.

It does not decode cards or load Contact, binding, grant, task or workflow state. It is not a general event bus, transport abstraction or Provider plugin framework.

When `provider event ID` is present, `(provider, provider tenant ID, provider event ID)` is the table's deduplication key. A duplicate delivery reuses the existing inbox outcome and is ACKed without scheduling a second processing attempt. When the Provider omits event ID, the repository stores `NULL` and every delivery creates a separate inbox record; Dify does not hash payloads or synthesize an external event ID.

Task-level first-success and current-binding validation remain the final protection if no Provider event ID is available and equivalent actions are delivered more than once.

### 8. Card protocol converges at `CardSubmissionRequest`

The inbox worker passes an `AuthenticatedEvent` to the concrete Provider card decoder. A successfully decoded `CardSubmissionRequest` contains only the Provider-neutral card submission facts:

- provider and provider tenant ID;
- provider user ID;
- optional source event ID and event time;
- exact provider message/card reference;
- action identifier;
- submitted form values;
- opaque interaction context embedded at send time.

It excludes raw signatures, verification tokens, encrypted bodies, HTTP headers, stream envelope IDs used only for ACK, SDK client objects and connection state.

The Provider decoder does not resolve Contact, binding, grant or task authorization. The Human Input interaction application service consumes `CardSubmissionRequest`, resolves the opaque context, loads current identity/binding state and applies the existing first-success submission contract.

### 9. Transport support is deployment-owned and statically validated

The effective mode is supplied by deployment configuration. Integration upsert/test cannot select or override it. Integration diagnostics rejects a Provider that does not support the effective mode before persisting credentials.

The implementation uses the explicit matrix in Context rather than a runtime extension registry. Adding or changing a Provider/mode combination requires a future spec change with Provider evidence.

Connection quotas, replica coordination and rolling deployment are intentionally not modeled. A STREAM implementation only needs the minimum lifecycle required to start and stop the configured connection in the current deployment.

### 10. Integration deletion is local-only

Deletion first makes the Integration unavailable to new sends and inbound business ingestion, then stops any locally maintained stream connection, deletes stored credentials, removes active organization bindings and workspace overrides, and preserves historical task/delivery/audit records.

Webhook routes may remain deployed, but a delivery for a deleted Integration MUST NOT produce a new business-processable `AuthenticatedEvent`. The exact Provider-specific terminal HTTP/ACK response is not established and remains adapter-specific.

Deletion performs no Provider API call to revoke OAuth grants, uninstall applications, deregister Webhooks or mutate remote event settings.

An inbox event committed before deletion but processed afterwards will encounter removed current binding state and therefore cannot bypass the existing submission-time revalidation.

## Risks / Trade-offs

- [No deduplication without provider event ID] → Duplicate inbox processing is possible; retain task-level first-success and binding revalidation, and expose duplicate operational evidence instead of inventing an unsafe hash key.
- [No automatic send retry] → Transient failures reduce delivery success; preserve the ambiguous outcome and allow explicit Resend as a new attempt.
- [Full in-memory directory snapshot can consume significant memory] → Keep this accepted for the current manual-sync scope; introduce external staging only through a future measured change.
- [Webhook ACK after database commit depends on inbox latency] → Keep the single-table Inbox Repository transaction limited to insert-or-resolve-duplicate and move claim, decoding and all business work to the worker.
- [STREAM lifecycle is under-specified for multi-replica deployment] → Limit the first implementation to current deployment composition; connection quota and rolling deployment remain explicit non-goals.
- [Provider-neutral card intent may expose unsupported controls] → Human Input application service uses the Provider's side-effect-free representability result before creating the Delivery Endpoint; a false result selects Request URL, while an unexpected renderer mismatch raises before any Provider send call and never silently changes operations.
- [Local-only deletion leaves remote configuration active] → Mark the Integration deleted locally, drop new business ingestion, and document that remote cleanup is an administrator responsibility for this phase.

## Migration Plan

1. Add the four Provider contracts and shared semantic values without switching existing runtime call sites.
2. Implement explicit adapters for the Provider/operation combinations required by the transport and notification matrices; keep unsupported combinations rejected.
3. Move manual sync to complete-snapshot reads before reconciliation.
4. Route Delivery Endpoint selection through card representability assessment, then route outbound binding tests and notifications through the endpoint-selected Messaging operation with one-call-per-attempt behavior.
5. Add the dedicated `im_provider_event_inbox` table and simple Inbox Repository, then switch Webhook and STREAM receivers to persist `AuthenticatedEvent` through it and ACK after commit.
6. Move card decoding to inbox workers and pass `CardSubmissionRequest` into the existing Human Input interaction service.
7. Switch Integration deletion to local deactivation, stream stop, credential removal and binding/override cleanup.
8. Roll back by disabling the new composition and receivers while preserving inbox, delivery and historical audit records; do not attempt remote rollback.

## Open Questions

- What exact deployment configuration maps SaaS, CE and EE instances to `WEBHOOK` or `STREAM`? This change only requires that the result is deployment-owned and read-only to Integration management.
- DingTalk、WeCom 与 Microsoft Teams 的具体权威目录 endpoint、分页/组织遍历方式和 configured visibility scope 需要在各 adapter 实现时确认并记录；这不是 Directory sync 是否支持的未决问题，五个初始 Provider 都必须实现完整快照读取。
- How is a Microsoft Teams proactive delivery target acquired, installed and refreshed when a directory user ID alone is insufficient?
- What is the exact normalized interactive-card intent consumed by Slack, Feishu/Lark and Teams renderers? The common operation is confirmed, but a field-complete cross-provider card document requires a separate review of existing Form Content controls.
- What terminal Webhook/stream ACK should be returned for an event received after local Integration deletion? The only confirmed business rule is that it must not enter new business processing.
