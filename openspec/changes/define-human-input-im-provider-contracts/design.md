## Context

Human Input 需要通过 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 完成 Integration 校验、通讯录身份读取、文本或卡片投递、卡片交互接入和卡片状态更新。现有 Dify specs 已经拥有 Contact matching、IM identity/binding、recipient resolution、submission authorization 与 workflow resume 语义；本设计只补齐这些业务能力依赖的 Provider-facing contract，不重新定义业务模型。

Explore 阶段确认了以下约束：

- 通讯录读取和消息发送是独立操作；共享凭据、SDK client、tenant 配置或 provider user ID 不构成合并接口的理由。
- Webhook 和长连接在认证、ACK、重试与部署生命周期上保持独立，最早通过 `AuthenticatedEvent` 汇合；卡片协议再通过 `CardSubmissionRequest` 汇合。
- 入站事件采用 inbox pattern，通过简单的 Dify-owned Inbox Repository 把 `AuthenticatedEvent` 写入 application database 的一张专用 inbox 表；先提交记录并尽快 ACK，再由 worker 从表中 claim 和处理。
- 只有 Provider 给出 event ID 时才去重；没有 event ID 时不生成 payload hash 或其他替代去重键。
- Directory reader 只有在读完所有 Provider pages/nodes 并构建完整内存快照后才能返回成功；失败时不进入 reconciliation。
- Delivery Endpoint 创建前由 Provider Messaging 对 normalized interactive-card intent 做无副作用的 representability assessment；endpoint 一旦选定，发送阶段不再重新选择链接或卡片渠道。
- Side-effecting send 本期不自动重试；ambiguous outcome 保留为一次 attempt 的失败事实，人工 Resend 仍是新的显式 attempt。
- 每个 concrete Provider 的每个 API 调用和事件处理入口都必须独立具备单元测试、集成测试、真实执行证据和脱敏后的真实 payload fixture。

`STREAM` 在本设计中指 Provider 通过长生命周期 WebSocket/stream connection 投递事件，不是另一个与长连接并列的模式。Provider transport 支持矩阵为：

| Provider | `WEBHOOK` | `STREAM` | Supported Human Input notification forms |
| --- | --- | --- | --- |
| Slack | Supported | Supported | Text fallback; interactive card |
| Feishu/Lark | Supported | Supported | Text fallback; interactive card |
| DingTalk | Supported | Supported | Text fallback |
| WeCom | Supported | Not supported | Text fallback |
| Microsoft Teams | Supported | Not supported | Text fallback; interactive card |

Deployment event transport mode 由部署配置注入，Integration 管理 API 只读展示 effective mode。具体 SaaS、CE、EE 到 mode 的映射不在当前材料中，本设计不自行补充。

## Goals / Non-Goals

**Goals:**

- 给 Dify application services 提供稳定、业务无关且按真实操作拆分的 Provider contract。
- 让 Directory、基础 Messaging、Dynamic Card Messaging、Integration diagnostics 与 Event ingestion adapters 可以独立实现、测试和替换。
- 明确 Provider-specific 数据停留在哪一层，以及何时可以转为 Provider-neutral facts。
- 保持 Human Input 的 Contact、binding、grant、authorization 和 workflow 语义在现有 Dify boundary 内。
- 为每个共享 contract 提供至少两个 Provider 的共同语义证据。
- 为所有适用的 `Provider × API operation / event handler` 组合建立可审计且不可由代表性测试替代的实现验证证据。

**Non-Goals:**

- 不构建动态插件系统、通用 Provider framework 或运行时 capability discovery framework。
- 不统一 Provider credentials、pagination、department topology、card JSON、message locator、签名或 ACK wire protocol。
- 不实现群聊通知、自动 directory sync、delivery receipt、自动发送重试或远端 Integration revoke/unsubscribe。
- 不设计连接配额、leader election、滚动部署、connection drain 或多连接负载策略。
- 不改变 Contact admission、recipient resolution、submission authorization、first-success 或 workflow resume 规则。
- 不实现 caller switch、Delivery Endpoint selection、Integration local deletion 或 Human Input business handoff；但 Dify-owned inbox table/repository、ACK-before-business-processing 与 inbox worker claim 保留在本 change 范围内。

## Decisions

### 1. Use narrow Provider contracts instead of one umbrella interface

Dify 按已确认的操作定义独立 contract；concrete Provider composition 可以共享同一 credentials object、SDK client 或 token cache，但不得因此合并这些 contract。Messaging 按必备能力和可选动态卡片能力分组，而不是为每个 method 单独建立 capability。

| Contract | 承载的具体操作 | 至少两个 Provider 的共同语义 |
| --- | --- | --- |
| Integration diagnostics | 校验 credentials；识别 provider tenant；检查基础权限；检查 effective deployment transport compatibility | Slack、Feishu/Lark、DingTalk 都需要凭据、tenant 与接入方式校验 |
| Directory reader | 读取当前 provider tenant 的完整用户身份快照 | Slack 分页读取 workspace users；Feishu/Lark 分页/按部门读取 tenant users；DingTalk、WeCom 与 Microsoft Teams 读取各自组织内的 tenant users；五个 Provider 都在完成各自分页或组织层级遍历后产出完整快照 |
| Basic Messaging | 测试一个 Provider message destination；向该 destination 发送文本消息；返回 Provider acceptance 与精确 message reference | Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 都必须支持，且文本消息是动态卡片不可用时的基础 fallback |
| Dynamic Card Messaging | 无副作用地评估 normalized interactive-card intent；发送交互卡片；返回精确 card/message reference；更新同一张已发送卡片 | Slack、Feishu/Lark 与 Microsoft Teams 都共享 assessment、card send 和基于原消息 reference 的 card update 生命周期 |
| Event adapter | 认证一次 Provider delivery 并产出 `AuthenticatedEvent`；把卡片事件解码为 `CardSubmissionRequest` | Slack、Feishu/Lark 与 DingTalk 都同时支持 Webhook/stream 事件并在认证后产出相同 `AuthenticatedEvent` 语义；Slack、Feishu/Lark、Teams 都产生卡片 action submission |

Alternatives considered:

- One `IMProvider` interface containing every method. Rejected because it would make directory, transport and messaging lifecycle appear semantically coupled and force unsupported dynamic-card methods onto DingTalk and WeCom.
- One capability per Messaging method. Rejected because destination reachability and text fallback are jointly required for every Provider, while card assessment, send and update form one optional lifecycle shared by the three card-capable Providers.
- One generic `execute(operation, payload)` entry point. Rejected because it discards type safety and hides the exact operations this change is meant to stabilize.

### 2. Keep provider inputs business-independent

Provider contracts MUST NOT accept Contact, IM binding, ApproverGrant, Human Input task ORM records or workflow runtime objects. Application services resolve business state first and pass only Provider-facing facts:

- Integration diagnostics receives provider-specific candidate credentials and the deployment-owned effective transport mode.
- Directory reader receives current provider tenant/credentials and returns provider identities; it never receives Contacts.
- Basic Messaging receives Provider-specific message destination facts for reachability testing or link-message sending. Dynamic Card Messaging assessment receives only a normalized interactive-card intent; card send receives a Provider message destination plus the card intent, while card update receives the stored Provider message reference. Opaque association metadata may be embedded as opaque application data, but the Provider adapter MUST NOT interpret task authorization semantics.
- Event decoding returns provider identity, action, submitted values, message reference and opaque association metadata; the Human Input adapter maps that metadata to task/delivery/recipient facts afterwards.

This boundary permits the same Provider implementation to serve future Dify callers without introducing a generic plugin framework.

### 3. Directory read returns only a complete in-memory snapshot

The Directory reader internally owns Provider pagination, department traversal and rate-limit handling for one call. It accumulates entries in memory and returns one immutable snapshot only after every required page/node has succeeded.

Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 都在初始 Directory reader 范围内。各 Provider 使用不同的目录 API、分页协议、组织层级和可见范围，但这些差异只影响 concrete adapter 如何完成读取，不改变五个 Provider 都必须提供完整租户用户身份快照的共同语义。

The snapshot carries the provider, provider tenant, fetch time and complete ordered identity entries. Common identity facts are limited to provider user ID, display name, optional Email and availability. Provider-specific pagination cursors and raw responses do not cross the contract.

If any page/node fails, the reader returns a typed failure and no snapshot. The sync worker MUST NOT run matching, absence detection, removal or reconciliation on partial entries.

Alternatives considered:

- Stream pages directly into reconciliation. Rejected because a late page failure could make an incomplete directory appear authoritative and incorrectly remove bindings.
- Return `entries + is_complete=false`. Rejected because it permits callers to accidentally consume partial entries. Success itself proves completeness.

### 4. Messaging has one required base and one optional dynamic-card capability

`Provider message destination` 只表示向 selected bound identity 发起一条新 Provider message 所需的 Provider-specific 寻址事实。它不是 Dify Contact、Human Input business recipient、IM binding、Delivery Endpoint、Webhook endpoint 或 prior message reference，也不保证等同于 provider user ID。各 Provider destination 的字段形状与获取过程保持 Provider-specific；在调用 send operation 时，调用方必须提供该 Provider 尝试新消息所需的事实，但本设计不预设它们已经能从 binding 同步解析完成。Card representability assessment 不接收 message destination，card update 则接收 prior message reference。以上操作都不调用 Directory reader。

操作不同不意味着每个操作都需要独立 capability。Messaging 按支持义务和共同生命周期分成两组：

- Basic Messaging 是 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 的必备 contract，承载 destination-specific reachability test 与 `send_text`。没有这两个操作，Provider 不能完成基础接入和文本 fallback。
- Dynamic Card Messaging 是 Slack、Feishu/Lark 与 Microsoft Teams 额外实现的可选 contract，承载 card representability assessment、`send_card` 与 card update。DingTalk、WeCom 不实现该 contract，也不提供返回 unsupported 的 dummy methods。

各操作的具体输入与副作用仍保持清晰：

- Card representability assessment 在 Delivery Endpoint 创建前接收 normalized interactive-card intent，不接收 Provider message destination 或 Delivery Endpoint，也不发送消息、读取 Directory 或创建 Delivery。它只返回是否可表示以及可选的人类可读 reason；Dify 只根据 boolean 选择 endpoint，reason 仅用于日志，不是稳定错误码，也不得参与业务判断。
- `send_text` receives a Provider message destination separately from one fully rendered CommonMark message body and returns Provider acceptance plus an exact message reference when available. The upstream renderer or notification application service owns URL interpolation and produces CommonMark without custom tags. The Provider adapter owns Provider-specific markdown rendering and, when that rendering is not expressible on the target platform, MUST fall back to sending the same content as plain text rather than rejecting the operation.
- `send_card` receives a Provider message destination separately from normalized interactive-card intent, actions and opaque association metadata, and returns Provider acceptance plus an exact card/message reference.
- Card update receives the exact reference returned by the corresponding `send_card` attempt and replaces that same Provider message/card; stale reference、authorship 或 permission failure 作为 typed update failure 返回。
- Provider-specific representability and rendering rules stay inside the concrete adapter; the shared contract does not define a universal Provider card JSON or control matrix.

`send_card` 与 card update 不拆成两个 capability。三个初始 card-capable Provider 都支持基于发送结果更新原卡片：Slack 使用 `channel + ts` 调用 `chat.update`，Feishu/Lark 使用 `message_id` 更新已发送的消息卡片，Microsoft Teams 使用 `activity_id + conversation context` 更新 Adaptive Card activity。这一共同生命周期足以让两项操作属于同一个可选 Dynamic Card Messaging contract；它不保证每次 update 都成功，因此精确 reference 与独立 update outcome 仍然保留。

Slack、Feishu/Lark 与 Microsoft Teams 支持交互卡片并不意味着所有 Human Input Form Content 都必须渲染成卡片。Human Input notification application service 先从 Form Content 生成 normalized interactive-card intent，再调用目标 Provider 的 card representability assessment：结果为 true 时创建 card Delivery Endpoint，结果为 false 时创建文本 fallback Delivery Endpoint。发送阶段根据已创建 endpoint 直接调用对应的 `send_card` 或 `send_text`，不再次选择渠道。

`send_card` 不要求调用方在发送时重复执行 assessment。Concrete renderer 收到无法渲染或与 card Delivery Endpoint 不一致的 intent 时，必须在任何 Provider send call 之前抛出明确的 card-rendering exception，且不得自行改调 `send_text`；是否改用文本 fallback 必须通过创建新的相应 Delivery Endpoint 表达。该 exception 表示调用契约被破坏，不是 assessment 的正常 false 结果，也不是 ambiguous send outcome。Provider adapter 不负责读取 Human Input task 或决定 endpoint 类型。

A Provider message reference is a discriminated Provider-owned locator, not one assumed global `card_id`. Dify persists it without reinterpreting Slack channel/timestamp, Feishu message ID or Teams conversation/activity identity as interchangeable scalars.

Human Input 在 Dify application layer 额外施加 recipient isolation，但该规则不是 Provider contract 的通用语义。一个 Provider user identity 可以同时绑定多个 Dify Contacts，因此 Provider 的 user-specific view 仍不足以区分提交者对应的 Contact。Dify MUST 为每个 card Delivery Endpoint 创建或寻址一个独立可更新的 card instance，并在 opaque association metadata 中绑定且只绑定该 endpoint 的 handle / access token；即使多个 Contacts 映射到同一个 Provider user identity 和同一个 Provider message destination，也不得通过一个 Provider card publication 共享 association metadata。回调中的 Provider user identity 与 endpoint-scoped handle 仍需通过当前 binding、Delivery Endpoint 与授权上下文重新校验，handle 本身不构成授权。

当一个 Human Input task 被处理后，选择哪些 card Delivery Endpoints / card instances 需要更新以及如何 fan out 属于 Dify application service。Application service 从各 Delivery 读取精确 Provider message reference，逐个调用单实例 card update，并按 Delivery 记录结果；Provider contract 不接收 task、Contact collection 或 batch-level business context，也不提供为了该业务 fan-out 而设计的 shared batch abstraction。受控并发由 Dify worker 编排，Provider adapter 继续在单实例调用内隐藏 credentials、SDK client、rendering 与 Provider-specific error translation。

Microsoft Teams may require a conversation reference or app installation state in addition to a directory user ID. The acquisition and persistence of that Provider message destination is not established by current materials and remains an open question; the common Messaging contract MUST NOT assume that every provider user ID is directly sendable.

### 5. One outbound attempt makes at most one side-effecting send call

For binding test, `send_text` and `send_card`, one Dify delivery attempt invokes the side-effecting Provider operation at most once. Timeout, connection reset, 429 or other ambiguous failure MUST NOT trigger automatic replay.

The attempt records the returned safe Provider diagnostic and whether the result is known or ambiguous. A user-triggered Resend creates a new delivery attempt using then-current credentials and binding; it is not an automatic retry of the original attempt.

This decision does not add or change a card-status-update retry policy. Card update remains a follow-up operation of the optional Dynamic Card Messaging contract and is owned by its existing task-handling flow.

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
- opaque association metadata embedded at send time.

It excludes raw signatures, verification tokens, encrypted bodies, HTTP headers, stream envelope IDs used only for ACK, SDK client objects and connection state.

The Provider decoder does not resolve Contact, binding, grant or task authorization. The Human Input interaction application service consumes `CardSubmissionRequest`, resolves the opaque context, loads current identity/binding state and applies the existing first-success submission contract.

### 9. Transport support is deployment-owned and statically validated

The effective mode is supplied by deployment configuration. Integration upsert/test cannot select or override it. Integration diagnostics rejects a Provider that does not support the effective mode before persisting credentials.

The implementation uses the explicit matrix in Context rather than a runtime extension registry. Adding or changing a Provider/mode combination requires a future spec change with Provider evidence.

STREAM connections are replica-local, while accepted events converge through the shared inbox. The initial Providers expose the following multi-connection semantics:

| Provider | Confirmed multi-connection semantics | ACK and redelivery-relevant facts | Dify consequence |
| --- | --- | --- | --- |
| Slack Socket Mode | One app may maintain up to 10 active WebSocket connections; Slack may deliver each payload through any active connection and explicitly supports multiple connections for load distribution and graceful restart | The receiving connection ACKs the delivery by `envelope_id`; connection refresh and disconnect are normal lifecycle events | Multiple Dify replicas are a supported topology; Dify MUST NOT assume connection affinity or distribution order |
| Feishu/Lark long connection | Provider documentation defines cluster mode rather than broadcast: when the same app has multiple clients, one client is selected for a delivery; one app may maintain up to 50 connections | The selected SDK handler must complete successfully within the Provider deadline; handler failure or timeout triggers Provider retry | Multiple Dify replicas are a supported topology; every replica for the same Integration MUST register the same handlers |
| DingTalk Stream | Each ticket establishes one connection, while the official SDK exposes a configurable multi-session connection pool for one app | The receiving connection echoes `messageId` in its protocol response; event ACK data distinguishes `SUCCESS` from `LATER`; `ping` and `disconnect` remain connection-local | Multiple Dify replicas are not prohibited, but cross-connection distribution, ordering, fairness and connection quota are not sufficiently documented and MUST NOT be assumed |

For the same active Integration, every STREAM replica registers the same subscriptions and supported handlers. The replica that receives a business delivery authenticates it, commits `AuthenticatedEvent` through the shared Inbox Repository, and only then sends the Provider-specific ACK through that same connection. ACK ownership is never transferred to an inbox worker or another replica. A later worker may claim the committed record from any replica.

Provider transport identifiers used only to ACK one delivery, including Slack `envelope_id` and DingTalk `messageId`, MUST NOT be promoted to `provider event ID` unless Provider evidence confirms that the identifier names the business event and remains stable across redelivery. Duplicate deliveries that reach different replicas therefore follow the same inbox rules as single-replica delivery: deduplicate only a real Provider event ID, otherwise retain independent inbox records and rely on downstream first-success semantics.

Dify does not elect a singleton STREAM owner, constrain replica count, coordinate rolling deployment or implement a cross-replica connection pool. Integration deletion marks the shared Integration state inactive to prevent new business-processable inbox records; each replica remains responsible for closing its own local connection. Provider connection quotas and temporary overlap during deployment remain operational constraints rather than behavior normalized by a Provider contract.

### 10. Integration deletion is local-only

Deletion first makes the Integration unavailable to new sends and inbound business ingestion, then stops any locally maintained stream connection, deletes stored credentials, removes active organization bindings and workspace overrides, and preserves historical task/delivery/audit records.

Webhook routes may remain deployed, but a delivery for a deleted Integration MUST NOT produce a new business-processable `AuthenticatedEvent`. The exact Provider-specific terminal HTTP/ACK response is not established and remains adapter-specific.

Deletion performs no Provider API call to revoke OAuth grants, uninstall applications, deregister Webhooks or mutate remote event settings.

An inbox event committed before deletion but processed afterwards will encounter removed current binding state and therefore cannot bypass the existing submission-time revalidation.

### 11. Provider verification is exhaustive and evidence-backed

共享 contract 的测试只能证明公共抽象成立，不能证明每个 concrete Provider 的 wire contract 正确。实现阶段必须维护一张可审计的 `Provider × API operation / event handler` 覆盖矩阵，并对矩阵中的每个适用项同时满足以下验收条件：

- 为具体 Provider 的具体 API 调用或事件处理入口添加单元测试
- 为同一个具体调用或事件处理入口添加集成测试
- 在实现过程中对授权的非生产 Provider 环境完成至少一次真实 API 调用，或让 Provider 实际产生的事件通过对应 Webhook/STREAM 入口完成至少一次真实处理
- 保存该次真实 API 调用的 request/response payload，或真实事件处理所接收的 Provider payload，作为对应单元测试的 fixture

真实执行证据与自动化测试是相互独立的验收项。重放 fixture 不能替代真实 Provider 调用或真实事件处理；一次真实调用也不能替代单元测试或集成测试。无法取得某个适用矩阵项的真实证据时，该实现必须保持 blocked 或 incomplete，不能通过手工构造 payload、另一个 Provider 的证据或仅测试共享 contract 来关闭任务。

所有提交到仓库的真实 payload fixture 都必须先完成脱敏。脱敏范围包括 credential、secret、token、signature、authorization material，以及 payload 中可识别个人、租户、会话、消息、事件或业务内容的敏感值。脱敏必须使用稳定占位值保持跨字段引用关系，并保留字段名、嵌套结构、数据类型、可选字段、discriminator 和测试所依赖的协议语义。fixture 还必须记录不含敏感信息的 provenance，至少标明 Provider、operation/event type、Provider API 或事件版本以及采集日期，以便后续判断 contract drift。

验签或解密测试不能直接使用被改写过的原始签名、密文或 authenticated bytes，因为任何脱敏修改都可能破坏 Provider 要求的 byte canonicalization、signature input 或 encryption envelope。对于每个 Provider 的每条适用 Webhook/STREAM 认证路径，必须额外建立 cryptographically valid wire fixture：先脱敏真实明文和相关 metadata，再使用仓库内测试专用的 signing/verification 或 encryption/decryption material 重新生成签名、MAC、密文、nonce/IV 和关联 header。测试密钥不得复用真实 Provider credential；fixture 生成必须使用 Provider 官方 SDK、独立 reference implementation 或测试辅助工具，不能调用被测 verifier/decrypter 自己生成期望值。

每条适用路径必须独立覆盖合法签名或密文成功、payload/header/ciphertext 篡改失败、错误 secret/key 失败，以及 Provider 支持时的 timestamp window、replay protection、nonce/IV 和 sign/decrypt ordering。任何验签或解密失败都不得产生 `AuthenticatedEvent` 或 business-processable inbox record。Provider 不具备签名或加密能力的路径必须在覆盖矩阵中显式标记为不适用，不能静默缺少测试。

Alternatives considered:

- 只对共享 contract 和代表性 Provider 添加完整测试。
  Rejected because Provider SDK、payload、认证、分页、ACK 和错误语义均可能独立漂移。
- 只保留手工构造或根据文档生成的 fixture。
  Rejected because 这不能证明实现与 Provider 的真实 wire contract 一致。
- 只执行真实环境验证而不保留确定性测试 fixture。
  Rejected because 这无法提供可重复的回归测试，也会让日常测试依赖外部 Provider 可用性。
- 直接脱敏已签名或已加密的 wire payload，并继续把原签名或密文作为有效测试向量。
  Rejected because 脱敏会改变 authenticated bytes，使 fixture 无法验证真实的 signature/decryption path。

## Risks / Trade-offs

- [No deduplication without provider event ID] → Duplicate inbox processing is possible; retain task-level first-success and binding revalidation, and expose duplicate operational evidence instead of inventing an unsafe hash key.
- [No automatic send retry] → Transient failures reduce delivery success; preserve the ambiguous outcome and allow explicit Resend as a new attempt.
- [Full in-memory directory snapshot can consume significant memory] → Keep this accepted for the current manual-sync scope; introduce external staging only through a future measured change.
- [Webhook ACK after database commit depends on inbox latency] → Keep the single-table Inbox Repository transaction limited to insert-or-resolve-duplicate and move claim, decoding and all business work to the worker.
- [Provider-managed distribution across replica-local STREAM connections] → Do not elect a singleton owner or constrain replica count. Require identical subscriptions/handlers, shared-inbox commit before receiver-local ACK, and no assumptions about affinity, ordering or fairness. DingTalk cross-connection distribution remains explicitly undocumented; connection quota and rolling-deployment coordination remain non-goals.
- [Provider-neutral card intent may expose unsupported controls] → Human Input application service uses the Provider's side-effect-free representability result before creating the Delivery Endpoint; a false result selects Request URL, while an unexpected renderer mismatch raises before any Provider send call and never silently changes operations.
- [Local-only deletion leaves remote configuration active] → Mark the Integration deleted locally, drop new business ingestion, and document that remote cleanup is an administrator responsibility for this phase.
- [Shared-contract tests can hide concrete Provider wire-contract gaps] → Track unit tests, integration tests, real execution evidence and fixture paths independently for every applicable matrix cell; no cell is complete while any evidence column is missing.
- [Real Provider payloads can leak secrets, personal data or business content] → Fully sanitize fixtures before commit, preserve protocol structure with stable placeholders, and require sensitive-data scanning plus human review.
- [Recorded fixtures can drift from later Provider API or event versions] → Record minimal fixture provenance and recapture the real call or event whenever the relevant Provider contract or version changes.
- [Sanitization invalidates captured signatures or encrypted envelopes] → Sanitize plaintext first, regenerate cryptographic wire fixtures with test-only material and an independent generator, and test verification/decryption separately from business-payload decoding.

## Migration Plan

1. Add the narrow Provider contracts and shared semantic values, including required Basic Messaging and optional Dynamic Card Messaging, without switching existing runtime call sites.
2. Implement explicit adapters for the Provider/operation combinations required by the transport and notification matrices; keep unsupported combinations rejected.
3. Move manual sync to complete-snapshot reads before reconciliation.
4. Route Delivery Endpoint selection through card representability assessment, then route outbound binding tests and notifications through the endpoint-selected Messaging operation with one-call-per-attempt behavior.
5. Add the dedicated `im_provider_event_inbox` table and simple Inbox Repository, then switch Webhook and STREAM receivers to persist `AuthenticatedEvent` through it and ACK after commit.
6. Move card decoding to inbox workers and pass `CardSubmissionRequest` into the existing Human Input interaction service.
7. Switch Integration deletion to local deactivation, stream stop, credential removal and binding/override cleanup.
8. Before completing any Provider implementation, close every applicable coverage-matrix cell with its unit test, integration test, real API call or real event-processing evidence, sanitized real-payload fixture, and all applicable signature-verification/decryption tests.
9. Roll back by disabling the new composition and receivers while preserving inbox, delivery and historical audit records; do not attempt remote rollback.

## Open Questions

- What exact deployment configuration maps SaaS, CE and EE instances to `WEBHOOK` or `STREAM`? This change only requires that the result is deployment-owned and read-only to Integration management.
- DingTalk、WeCom 与 Microsoft Teams 的具体权威目录 endpoint、分页/组织遍历方式和 configured visibility scope 需要在各 adapter 实现时确认并记录；这不是 Directory sync 是否支持的未决问题，五个初始 Provider 都必须实现完整快照读取。
- How is a Microsoft Teams Provider message destination acquired, installed, persisted and refreshed when a directory user ID alone is insufficient for proactive delivery?
- What is the exact normalized interactive-card intent consumed by Slack, Feishu/Lark and Teams renderers? The common operation is confirmed, but a field-complete cross-provider card document requires a separate review of existing Form Content controls.
- What terminal Webhook/stream ACK should be returned for an event received after local Integration deletion? The only confirmed business rule is that it must not enter new business processing.
