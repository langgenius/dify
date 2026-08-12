## Context

Dify 需要面向多个 IM Provider 提供 credential testing、Directory、Messaging 与 inbound events。各 Provider 的 configuration、identity namespace、message locator 和 event transport 不同，但 capability consumer 只需要稳定的公共接口和明确的行为语义。

`IMProviderAdapter` 是 infrastructure-level interface composition root，不是 DDD aggregate。它把一份 Provider-specific configuration 关联到一组 capability views。共享 contract 只约束调用者能够观察到的行为，不定义 concrete adapter 的内部对象关系或资源组织方式。

Webhook 与 STREAM 具有不同控制流：Webhook 由调用方提交 request 并接收 response；STREAM 是由 lifecycle owner 通过同步 `start()`/`stop()` 管理的 resource，并在实现内部拥有的执行上下文中向 application-supplied `IMEventConsumer` 推送 event。两者在 transport authentication 后通过 `AuthenticatedIMEvent` 和 `IMEventConsumer` 汇合，但不共享假的 request、connection 或 ACK interface。

## Goals / Non-Goals

**Goals:**

- 定义 `IMProviderAdapter` 及其 capability interfaces。
- 定义 Provider configuration binding、capability presence、输入输出、失败、并发与 lifecycle semantics。
- 隐藏 Provider-specific configuration、transport addressing、wire authentication 和 ACK protocol。
- 让 Directory 与 Messaging 共享同一 Provider identity namespace。
- 让 authenticated inbound events 通过 Provider-neutral `IMEventConsumer` boundary 进入下游。
- 为后续 concrete Provider implementations 提供可执行的 black-box conformance contract。
- 用逐 Provider 的真实 API 或 event evidence 验证 contract assumptions，避免接口建立在未经证实的 Provider 行为上。

**Non-Goals:**

- 不定义 concrete adapter 使用多少 SDK client，是否共享 session，是否缓存 token，或者如何组织、同步和关闭内部资源。
- 不规定 eager/lazy initialization、locking、atomic primitive、callback registration、connection pool、rate limiter 或 retry implementation。
- 不实现任何 concrete Provider adapter、Provider endpoint traversal、message renderer、authentication algorithm 或 STREAM connection loop。
- 不规定 concrete Provider implementation 的 production test structure；真实环境 evidence 只验证 contract assumptions 和 Provider protocol facts。
- 不定义 credential persistence、configuration rollout orchestration、adapter cache、plugin discovery 或 runtime registry。
- 不定义 inbox、queue、persistence、routing、business event decoding、recipient resolution 或 delivery orchestration。

## Decisions

### 1. The contract describes observable behavior, not internal resource organization

一条要求只有在 caller、Provider 或下游 consumer 能够观察并依赖其结果时，才进入共享 contract。Concrete adapter 可以自由选择内部 client、session、cache、resource ownership 与 synchronization strategy，只要其公共行为满足本 change 的 concurrency、lifecycle 和 result semantics。

因此，`close()` 只规定 caller 可观察的 lifecycle boundary；内部 cleanup mechanism 由 concrete implementation 决定。

### 2. IMProviderAdapter exposes narrow capability views

`IMProviderAdapter` 绑定一份 immutable Provider-specific typed configuration。Construction 只验证本地 configuration shape，不执行远端 credential test。需要使用新的 credentials 或 transport material 时，caller 构造新 adapter；该动作不改变现有 adapter 的配置或 lifecycle。

参考 provider_api_stub.py

| Capability | Initial availability |
| --- | --- |
| Credential testing | All five Providers |
| Directory | All five Providers |
| Basic Messaging | All five Providers |
| Dynamic Card Messaging | Slack, Feishu/Lark, Microsoft Teams |
| Webhook Events | Slack, Feishu/Lark, Microsoft Teams |
| STREAM Events | Slack, Feishu/Lark |

Required capabilities 始终存在。Optional Dynamic Card Messaging 通过 view absence 表达不支持；optional event transport 通过对应 factory 返回 `None` 表达不支持。不增加第二套 support flags，也不提供只能返回 unsupported error 的 dummy capability。

### 3. Concurrency and lifecycle are public contracts

`IMProviderAdapter` 不是 thread-safe。Capability access、event transport creation、credential testing、Directory、Messaging、Dynamic Card Messaging 和 root `close()` 在同一 adapter 上不得 overlap 或 re-enter；caller 必须 externally serialize 这些 calls。共享 contract 不承诺 adapter 可以在线程之间安全 handoff。

Capability access 和 event transport creation 不执行远端 I/O，也不启动 STREAM connection。`IMWebhookHandler.handle()` 与 `IMEventConsumer.accept()` 明确定义为 thread-safe，因为它们需要在并发 request 或 SDK callback lifecycle 中使用。`create_webhook_handler(consumer)` 与 `create_stream_handler(consumer)` 仍受 root adapter 的 external-serialization 约束。

Root `close()` 幂等，并终止 root operation lifecycle。Close 返回后，caller 不再调用 root、Directory 或 Messaging operations。已经创建的 `IMWebhookHandler` 与 `IMEventStream` 具有独立的公共 lifecycle，不因 root close 自动失效。Contract 只规定这些结果，不规定 concrete adapter 如何实现隔离或 cleanup。

### 4. Directory exposes a complete Provider identity snapshot

Directory 不再次接收 credentials、Provider client 或 generic integration context。一次成功读取返回 configured Provider directory scope 的完整 immutable snapshot；失败不返回 partial snapshot。

共享 entry 只包含 `ProviderUserId`、optional display name 和 optional Email。Provider-specific cursors、directory topology、raw response 和 administrative status 不进入共享 model。Snapshot membership 表示 Provider 仍在 configured scope 中暴露该 identity，不保证消息可达。

`ProviderUserId` 只在 `(provider, provider_tenant_id)` namespace 内可比较，并作为 Messaging 的 personal-recipient identity。对 Feishu/Lark，该共享 identity 使用 `union_id`；caller 不负责将 identity 转换为 Provider-specific transport address。

### 5. Messaging exposes send semantics rather than transport mechanics

Basic Messaging 定义 `send_text`。Dynamic Card Messaging 定义 side-effect-free `assess`、`send_card` 和 exact-message `replace_with_static`。Messaging 接收 `ProviderUserId`，不向 caller 暴露 destination ID、conversation state 或其他 Provider transport addressing。

`send_card` 接收 Dify 侧预先生成的 nominal `CorrelationToken`。该 token 是 caller-owned opaque string；任一卡片交互 callback 都必须原样暴露同一个 token，使其可关联到 Dify interaction，adapter 不解释其内容。Provider-native action identity 继续区分具体按钮，`CorrelationToken` 不承担 action identity、Provider configuration 或 message location；后者仍由 `MessageLocator` 表达。共享 contract 不规定 concrete adapter 使用 card-level metadata、action-level data、encoding 或 external lookup 实现该语义。

Card assessment 对完整 `ResolvedForm` 做整体 representability judgment。它不能忽略不支持的 input 并报告 partial success。初始 card-capable Providers 对包含 `FILE` 或 `FILE_LIST` 的 intent 返回 not representable。Caller 不得把 assessment 判定为不可表示的 intent 传给 `send_card`；如果仍然传入，`send_card` 必须在创建 Provider message 之前抛出 `DynamicCardMessagingError`。

一次 send invocation 对目标 message creation 至多尝试一次；一次 `replace_with_static` invocation 对目标 replacement 至多尝试一次。只有获得 confirmed Provider acceptance 才返回 success；明确拒绝或无法确认 acceptance 都返回统一的 `MessageSendingError`，caller 不能据此推断 Provider 是否接受了消息。结果不确定时不自动 replay。成功只表示 Provider acceptance，并返回能够定位该 Provider message 的 discriminated exact locator，不表示 end-user delivery。`replace_with_static` 成功返回 `None`；失败返回携带 `ReplacementErrorKind` 的 `ReplacementError`。

### 6. Webhook and STREAM converge through IMEventConsumer

`IMEventConsumer.accept()` 返回 `ACCEPTED` 或 `NOT_ACCEPTED`。当 Provider protocol 暴露由 adapter 控制的 acknowledgement decision 时，`ACCEPTED` 必须映射为 successful ACK，`NOT_ACCEPTED` 则不得映射为 successful ACK。同一个 consumer 可以被多个 Webhook calls 或 STREAM instances 并发调用，因此必须 thread-safe；其 processing、persistence、queueing 和 duplicate handling 不属于 Provider contract。

Webhook framework input 与 STREAM SDK callback value 在调用 consumer 前都由 concrete adapter 转换为 serialized Provider payload，但两种 transport 分别定义其 payload 来源。

`IMWebhookHandler.handle()` 使用 framework-neutral request/response values，支持同一 handler 上的 concurrent calls，也可以与 root operations 或 root close overlap。Root close 不使已经创建的 Webhook handler 失效。

每个 `IMEventStream` instance 是由 caller-owned lifecycle owner 管理的一次性 resource。`start()` 同步完成 initialization、connection establishment 和必要的 readiness，随后立即返回；运行期 event receiving 由 concrete implementation 的内部执行上下文负责。`stop()` 同步关闭 event acceptance，以明确的线性化顺序排空已经接纳的 consumer calls 和 Provider acknowledgement，再释放该 instance 拥有的 connection、task 与其他 resource。`stop()` 返回后不得再调用 consumer，也不得留有未完成的 protocol response 或 implementation-owned background task。

Lifecycle owner 必须串行、非重入地调用 `start()` 与 `stop()`；这两个方法不承诺 concurrent-safe，也不得从 consumer callback 内调用。一个 instance 只能成功启动一次，停止后不得重启；串行重复 `stop()` 是 no-op，且 `start()` 失败后也可安全调用 `stop()`。同步启动失败统一为 `IMStreamStartError`，无法满足停止后保证统一为 `IMStreamStopError`。单个 event conversion、consumer 或 protocol response failure 不传播到 lifecycle owner，也不自动停止 stream；运行期不可恢复故障通过 implementation observability 或独立 supervisor 观察，不向核心接口加入 failure signal。每次 `create_stream_handler(consumer)` 返回独立 instance，root close 不替代 instance 自身的 lifecycle management。Contract 不规定内部 state representation、atomic primitive、callback model、thread、Greenlet、reconnect algorithm 或其他 resource-ownership mechanism。

### 7. AuthenticatedIMEvent carries Provider evidence, not business state

`AuthenticatedIMEvent` 包含 Provider、stable Provider tenant ID、optional real Provider event ID、optional Provider event time、local receive time、transport-specific Provider payload 的 immutable JSON-encoded snapshot，以及 optional Provider event-type discriminator。

对 Webhook，payload 是 successful authentication 和 applicable decryption 后，从 Provider HTTP request body 得到的完整 decoded JSON object 的 serialization。Adapter 保留 decoded JSON data model 的全部 object members、array elements、scalar values 和 nulls，不做 consumer-specific transformation。Provider 使用 encrypted envelope 时，payload 表示 decrypted plaintext JSON object，而不是外层 encrypted envelope。该 contract 不保留 original body bytes、object-member order、whitespace 或其他 lexical JSON representation。

对 STREAM，payload 是 Provider SDK 交给 event callback 的完整 native event value 的 JSON serialization。Adapter 使用 Provider SDK 支持的 serialization，并保留该 serialization 暴露的全部 fields 和 values，不做 consumer-specific transformation。共享 contract 不要求保留 original STREAM wire bytes 或 Provider SDK 未暴露的字段，也不保证 Webhook 与 STREAM 生成 byte-for-byte identical JSON。

Concrete adapter 只负责 authentication、applicable decryption、control-message handling 和 transport-specific Provider payload serialization。Adapter-owned transport credential、signature header、raw encrypted envelope、HTTP response state、connection state、control frame、ACK handle、Provider client、persistence ID 和 consumer state 不得加入该 model；但 Provider payload 自身已有的 fields 不得因此被删除。只有 Provider 明确提供且能确认其 redelivery stability 的 event ID 才能保留；contract 不从 payload hash、timestamp 或 transport envelope 合成 ID。Serialized Provider payload 的 business decoding 由独立 consumer 完成。

### 8. Failure contracts remain capability-scoped

每个 capability 只定义 caller 当前需要区分的 typed success 与 failure。Messaging 不要求 caller 区分明确拒绝和无法确认 acceptance；两者统一为 `MessageSendingError`。共享 contract 不预定义覆盖所有 Provider failure 的大型 enum，也不暴露 raw Provider response、credential material 或 Provider-specific exception。

### 9. Provider evidence validates the contract without prescribing implementation

每个初始 Provider verification unit 的适用 operation 和 event entry 都需要权威资料，以及授权非生产环境真实执行产生的 committed fixture evidence。该 evidence 用于确认 tenant identity、directory scope、identity mapping、message acceptance/locator、authentication、challenge、decryption 与 ACK semantics 确实能够支撑共享 contract。

初始 verification units 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams。Feishu 与 Lark 在 production protocol path 和 semantics 相同时作为一个共享 evidence unit，并使用授权飞书非生产环境提供真实证据；两者的 typed configuration、Provider discriminator 和 API host 仍保持独立。如果 production path 或 protocol semantics 分叉，共享 evidence assumption 失效，相关 contract 必须重新审阅。

`temp/fixtures` 是独立的 committed fixture repository，其 `README.md` 按 Provider 维护 operation/event、transport/endpoint、fixture 与 verification result，作为本 change 的 real-execution evidence index。Fixture 可以在该专用 repository 中按其访问控制策略保留原始 capture；不得要求将它脱敏或复制进 Dify repository。Feishu credential、directory、destination 与 messaging 的补充 execution summary 已提交在该 repository 的 `progress` branch，card Webhook/STREAM 和 text evidence 已由 `main` branch index 覆盖。

Evidence 以 caller-observable capability operation 或 event path 为验收单元。一次已提交的完整 E2E capture、人工验证记录或 agent verification 可以覆盖该路径中的内部 prerequisite calls；这些内部调用不需要为了重复证明同一个端到端结果而各自增加 canonical fixture row。

对于签名或加密 transport，Dify test suite 中可公开提交的 replay fixture 必须以真实 plaintext structure 为基础，使用 test-only material 重新生成有效签名或 ciphertext。真实 credential、secret、token 或 key 不得从专用 fixture repository 复制到 Dify repository。

Evidence matrix 不规定 concrete adapter 使用哪个 SDK、怎样组织 client、怎样同步或怎样清理资源。

## Risks / Trade-offs

- [Interface contract leaves implementation freedom] → Future concrete adapters need black-box conformance tests, but they may choose SDK and resource strategies appropriate to each Provider.
- [Externally serialized root adapters limit overlap] → Callers prevent overlapping and re-entrant adapter calls; created Webhook handlers and event streams retain independent concurrency and lifecycle contracts.
- [Serialized Provider payload delays normalization] → This keeps Provider authentication and event capture separate from consumer-specific business decoding, at the cost of decoding the JSON snapshot at the consumer boundary.
- [Capability absence can be ignored] → Required capabilities remain non-optional, while optional capability absence is explicit in the type surface.

## Migration Plan

1. Add the Provider-neutral immutable values, results and protocols without switching existing callers.
2. Update direct callers to depend on the shared contracts rather than Provider-specific configuration or transport objects.
3. Implement concrete Provider adapters in separate changes and validate them against these contracts.

## Open Questions

- What exact normalized card intent fields are required by all initial Dynamic Card implementations?
- Which Provider event identifiers are documented as stable across redelivery?
