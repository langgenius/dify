## Context

Dify 需要面向多个 IM Provider 提供 credential testing、Directory、Messaging 与 inbound events。各 Provider 的 configuration、identity namespace、message locator 和 event transport 不同，但 capability consumer 只需要稳定的公共接口和明确的行为语义。

`IMProviderAdapter` 是 infrastructure-level interface composition root，不是 DDD aggregate。它把一份 Provider-specific configuration 关联到一组 capability views。共享 contract 只约束调用者能够观察到的行为，不定义 concrete adapter 的内部对象关系或资源组织方式。

Webhook 与 STREAM 具有不同控制流：Webhook 由调用方提交 request 并接收 response；STREAM 由长生命周期 operation 向 application-supplied `IMEventConsumer` 推送 event。两者在 transport authentication 后通过 `AuthenticatedIMEvent` 和 `IMEventConsumer` 汇合，但不共享假的 request、connection 或 ACK interface。

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

Basic Messaging 定义 `send_text`。Dynamic Card Messaging 定义 side-effect-free `assess`、`send_card` 和 exact-reference `replace_with_static`。Messaging 接收 `ProviderUserId`，不向 caller 暴露 destination ID、conversation state 或其他 Provider transport addressing。

Card assessment 对完整 `NormalizedCardIntent` 做整体 representability judgment。它不能忽略不支持的 input 并报告 partial success。初始 card-capable Providers 对包含 `FILE` 或 `FILE_LIST` 的 intent 返回 not representable。Caller 不得把 assessment 判定为不可表示的 intent 传给 `send_card`；如果仍然传入，`send_card` 必须在创建 Provider message 之前抛出 `DynamicCardMessagingError`。

一次 send invocation 对目标 message creation 至多尝试一次；一次 `replace_with_static` invocation 对目标 replacement 至多尝试一次。只有获得 confirmed Provider acceptance 才返回 success；明确拒绝或无法确认 acceptance 都返回统一的 `MessageSendingError`，caller 不能据此推断 Provider 是否接受了消息。结果不确定时不自动 replay。成功只表示 Provider acceptance，并返回能够定位该 Provider message 的 discriminated exact reference，不表示 end-user delivery。`replace_with_static` 成功返回 `None`；失败返回携带 `ReplacementErrorKind` 的 `ReplacementError`。

### 6. Webhook and STREAM converge through IMEventConsumer

`IMEventConsumer.accept()` 返回 `ACCEPTED` 或 `NOT_ACCEPTED`。当 Provider protocol 暴露由 adapter 控制的 acknowledgement decision 时，`ACCEPTED` 必须映射为 successful ACK，`NOT_ACCEPTED` 则不得映射为 successful ACK。同一个 consumer 可以被多个 Webhook calls 或 STREAM instances 并发调用，因此必须 thread-safe；其 processing、persistence、queueing 和 duplicate handling 不属于 Provider contract。

`IMWebhookHandler.handle()` 使用 framework-neutral request/response values，支持同一 handler 上的 concurrent calls，也可以与 root operations 或 root close overlap。Root close 不使已经创建的 Webhook handler 失效。

每个 `IMEventStream` instance 至多启动一次 blocking `run(signal)` lifecycle。`StopSignal.stop_requested` 变为 true 后，event stream 不再建立或重连 Provider connection，释放该 instance 拥有的资源，并等待所有 in-flight consumer calls 完成；`run()` 返回后不得再启动新的 consumer call。第二次调用 `run()` 必须抛出 `IMStreamRunError`。每次 `create_stream_handler(consumer)` 返回独立 instance，root close 不替代 instance 自身的 lifecycle management。Contract 不规定内部 state representation、atomic primitive、callback model 或 reconnect algorithm。

### 7. AuthenticatedIMEvent carries Provider evidence, not business state

`AuthenticatedIMEvent` 包含 Provider、stable Provider tenant ID、optional real Provider event ID、optional Provider event time、local receive time、immutable decrypted Provider-native payload，以及 optional Provider event-type discriminator。

Transport secret、encrypted envelope、HTTP response、ACK handle、connection object、SDK client、persistence ID 和 consumer state 不进入该 model。只有 Provider 明确提供且能确认其 redelivery stability 的 event ID 才能保留；contract 不从 payload hash、timestamp 或 transport envelope 合成 ID。

Provider-native payload 的 business decoding 由独立 consumer 完成。

### 8. Failure contracts remain capability-scoped

每个 capability 只定义 caller 当前需要区分的 typed success 与 failure。Messaging 不要求 caller 区分明确拒绝和无法确认 acceptance；两者统一为 `MessageSendingError`。共享 contract 不预定义覆盖所有 Provider failure 的大型 enum，也不暴露 raw Provider response、credential material 或 Provider-specific exception。

### 9. Provider evidence validates the contract without prescribing implementation

每个初始 Provider verification unit 的适用 operation 和 event entry 都需要权威资料、授权非生产环境真实执行和完整脱敏 fixture。该 evidence 用于确认 tenant identity、directory scope、identity mapping、message acceptance/reference、authentication、challenge、decryption 与 ACK semantics 确实能够支撑共享 contract。

初始 verification units 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams。Feishu 与 Lark 在 production protocol path 和 semantics 相同时作为一个共享 evidence unit，并使用授权飞书非生产环境提供真实证据；两者的 typed configuration、Provider discriminator 和 API host 仍保持独立。如果 production path 或 protocol semantics 分叉，共享 evidence assumption 失效，相关 contract 必须重新审阅。

对于签名或加密 transport，fixture 必须以完整脱敏的真实 plaintext structure 为基础，使用 test-only material 重新生成有效签名或 ciphertext。真实 credential、secret、token 或 key 不得进入 repository。

Evidence matrix 不规定 concrete adapter 使用哪个 SDK、怎样组织 client、怎样同步或怎样清理资源。

## Risks / Trade-offs

- [Interface contract leaves implementation freedom] → Future concrete adapters need black-box conformance tests, but they may choose SDK and resource strategies appropriate to each Provider.
- [Externally serialized root adapters limit overlap] → Callers prevent overlapping and re-entrant adapter calls; created Webhook handlers and event streams retain independent concurrency and lifecycle contracts.
- [Provider-native payload delays normalization] → This keeps Provider authentication separate from consumer-specific business decoding.
- [Capability absence can be ignored] → Required capabilities remain non-optional, while optional capability absence is explicit in the type surface.

## Migration Plan

1. Add the Provider-neutral immutable values, results and protocols without switching existing callers.
2. Update direct callers to depend on the shared contracts rather than Provider-specific configuration or transport objects.
3. Implement concrete Provider adapters in separate changes and validate them against these contracts.

## Open Questions

- What exact normalized card intent fields are required by all initial Dynamic Card implementations?
- Which Provider event identifiers are documented as stable across redelivery?
