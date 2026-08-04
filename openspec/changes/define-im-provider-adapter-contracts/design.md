## Context

Dify 需要通过 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 提供 credential testing、目录读取和消息发送，并在支持的 Provider 上提供入站事件接入。各 Provider 的 credentials、SDK、token cache、HTTP client、WebSocket client、directory topology、message locator 与 ACK wire protocol 都不同，但这些差异不应迫使每个 capability consumer 重复构造 Provider SDK 或理解 Provider-specific lifecycle。

本设计中的根对象不是 DDD aggregate root：它不拥有业务实体或持久化一致性边界。它是 infrastructure-level facade/composite，负责把一份 immutable Provider-specific configuration 适配成一组稳定 capability views，因此命名为 `IMProviderAdapter`。

Webhook 与 STREAM 具有不同的控制流。Webhook request 先进入 Dify HTTP boundary，再调用 Provider adapter；STREAM 则由长生命周期 Provider SDK connection loop 主动回调 adapter。两者不能被压成一个假的 receive interface，但可以在完成 transport authentication 后通过同一个 `AuthenticatedIMEvent` 和 application-supplied `IMEventSink` 汇合。

## Goals / Non-Goals

**Goals:**

- 一份 Provider configuration 只构造一个 `IMProviderAdapter`，由 adapter 统一拥有 SDK client bundle、token cache、connection resources 与关闭生命周期。
- Capability consumer 从 adapter 获取 Directory、Messaging、Webhook Events、STREAM Events 等窄接口，不再次传 credentials，也不重新构造 SDK。
- Capability presence 直接表达 Provider 支持情况，不维护可能漂移的 support flag，也不提供 dummy unsupported methods。
- Webhook 与 STREAM 保留各自的 transport authentication、decryption、challenge/control-frame 和 ACK 语义；通过认证的 Provider business events 统一经 `AuthenticatedIMEvent` 与 `IMEventSink` 进入下游，具体事件类型由独立 decoder/router 解释。
- 本期 runtime MAY 只配置 Dynamic Card Messaging 所需的 Provider event subscriptions，但共享 Provider event contract MUST NOT 将事件范围限制为 Dynamic Card interactions。
- Provider adapter 只产生通用 Provider facts，不依赖任何业务 consumer、persistence schema、queue 或 workflow model。
- 为每个 Provider verification unit 的每个外部 API operation 和 event entry 建立独立、可审计的验证证据；Feishu 与 Lark 的共享协议实现属于同一个 verification unit。

**Non-Goals:**

- 不定义或调整业务 recipient、DeliveryEndpoint、delivery、form lifecycle、task、approval、workflow 或业务 card-submission model；Card Assessment 只接收从 HITL form 投影出的 immutable presentation facts。
- 不规定 `IMEventSink` 使用数据库 inbox、message broker、内存 handler 或其他具体实现。
- 不实现动态插件发现、generic operation dispatcher 或运行时 capability registry。
- 不要求所有 Provider 使用完全相同的 SDK client 数量；adapter 可以隐藏 Provider-specific client bundle。
- 不定义 deployment configuration、credential persistence、rotation orchestration、adapter cache key 或跨进程 adapter singleton。
- 不设计连接配额、leader election、滚动部署、remote revoke/uninstall 或 Provider delivery receipt。

## Decisions

### 1. IMProviderAdapter owns one immutable Provider client context

Concrete adapter 由 Provider-specific typed configuration 构造。构造阶段只进行本地 shape validation，不执行远端 credential test，因此即使 candidate credentials 无效，也能够先构造 adapter 再调用 `test_credentials()`。

Adapter configuration 在实例生命周期内不可变。需要使用新 credentials、verification material 或 connection material 时，composition layer 构造新 adapter 并关闭旧 adapter；capability 不得原地替换根 adapter 的 configuration。

Adapter 内部拥有 `ProviderClientContext`。该 context 是实现概念，不进入共享接口；它可以是一个 SDK client，也可以是由 API client、Webhook verifier、STREAM client、HTTP session、token cache 和 rate limiter 组成的 Provider-specific bundle。关键不变量是：每个 client role 由根 adapter 创建或 lazy-memoize，capability acquisition 和 capability method invocation 都不得自行构造相同 role 的新 client。

```python
adapter = adapter_factory.create(provider_config)

credential_result = adapter.test_credentials()
directory_snapshot = adapter.directory.read_snapshot()
provider_user_id = directory_snapshot.entries[0].provider_user_id
message_result = adapter.messaging.send_text(provider_user_id, message)

adapter.close()
```

Adapter 还隐藏 concrete SDK 的并发约束。若 SDK client 可并发复用，adapter 可以直接共享；若需要 serialization、pooling 或 per-connection isolation，concrete adapter 在内部处理，capability consumers 不协调 SDK locks。

Alternatives considered:

- 每个 capability 接收 credentials 并自行构造 SDK client。Rejected because credentials、token cache、connection pool、rate limits 与 cleanup 会重复，并且 capability 之间可能观察到不同 Provider session state。
- 将该对象建模为 DDD aggregate root。Rejected because它不拥有业务 entity consistency 或 repository transaction；使用 aggregate 术语会把 infrastructure lifecycle 与 domain lifecycle 混淆。
- 使用全局 Provider SDK singleton。Rejected because不同 Provider configurations、credential revisions 和并发租户必须隔离。

### 2. The root exposes capability views rather than one umbrella method interface

`IMProviderAdapter` 是 capability composition root，不是包含所有方法的巨型接口。每个 view 保持独立 contract，但闭包引用相同 adapter-owned client context。

| Capability view | Initial availability | Shared operation boundary |
| --- | --- | --- |
| Credential testing | All five Providers | `test_credentials()` on the root |
| Directory | All five Providers | Complete Provider identity snapshot |
| Basic Messaging | All five Providers | `send_text` |
| Dynamic Card Messaging | Slack, Feishu/Lark, Microsoft Teams | Assessment, `send_card`, exact-reference update |
| Webhook Events | Slack, Feishu/Lark, Microsoft Teams | Caller-driven Webhook request handling |
| STREAM Events | Slack, Feishu/Lark | SDK-driven long-running event handling |

Required Directory and Basic Messaging views are always present. Dynamic Card Messaging, Webhook Events and STREAM Events views are absent when unsupported; there is no separate `supports_webhook`, `supports_stream` or `supported_event_transports` result to check before obtaining a view, and unsupported Providers do not implement methods that only return an unsupported error.

```python
class IMProviderAdapter(Protocol):
    def test_credentials(self) -> CredentialTestResult: ...

    @property
    def directory(self) -> IMDirectory: ...

    @property
    def messaging(self) -> IMMessaging: ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None: ...

    @property
    def webhook_events(self) -> IMWebhookEvents | None: ...

    @property
    def stream_events(self) -> IMStreamEvents | None: ...

    def close(self) -> None: ...
```

Capability accessors themselves are side-effect free and return views backed by the same root context. A concrete implementation may return stable view objects or lightweight wrappers, but obtaining a view never authenticates credentials, opens a stream connection or creates another SDK client.

### 3. Credential testing is bound to the adapter and independent from transport

`test_credentials()` takes no arguments. It uses only API credential material already bound into the adapter, authenticates against the Provider, identifies a stable Provider tenant and checks baseline API permissions.

It does not test message-recipient reachability, Webhook verification material, STREAM connection support or any business operation. Success returns normalized safe facts; authentication, tenant-identification and permission failures are typed. Raw credentials、SDK client objects、raw Provider responses 和 Provider-specific exceptions 不跨越接口。

Transport configuration material remains Provider-specific but belongs to Webhook or STREAM capability construction inside the root adapter. Capability presence, not credential-test output, states whether the adapter implements that transport.

### 4. Directory is an adapter-bound complete-snapshot capability

Directory capability receives no credentials、SDK client 或 generic integration context。它通过 root-owned client context 完成 Provider-specific pagination、department traversal、rate-limit handling 和 error translation。

一次成功调用返回完整 immutable snapshot；任何 page/node failure 都返回 typed failure 且不暴露 partial snapshot。共享 identity facts 只包含 nominal `ProviderUserId`、optional display name 和 optional Email；pagination cursors、raw responses、Provider lifecycle status 和 topology details 留在 concrete adapter。`ProviderUserId` 只在 bound adapter 的 Provider tenant/application namespace 内有意义，并且足以让同一 adapter 尝试个人消息发送，但不要求它等于 Provider transport address。

Snapshot membership 只表示 Provider 在经过验证的 configured directory scope 内仍暴露该 identity，不保证消息可达。若 Provider API 返回 documented deletion tombstone，且权威证据确认其语义是 identity 已不再存在，concrete adapter 将其归一化为 snapshot absence。Disabled、suspended、frozen 或其他仍随 identity 返回的 Provider-specific administrative status 不投影为共享 availability，也不改变 shared snapshot membership；若未来业务需要据此 invalidating binding，必须先定义明确 consumer、状态迁移和逐 Provider 证据。当前消息可达性只通过真实 Messaging send result 表达。

Directory capability 只读取 Provider directory。如何匹配、reconcile、persist 或消费这些 identity facts 属于调用方。

### 5. Messaging capabilities share the root context but keep operation semantics narrow

Basic Messaging 接收 Directory 共享的 `ProviderUserId` 并发送已经准备好的文本内容，不暴露独立的 recipient-reachability preflight。Dynamic Card Messaging 使用同一个 `ProviderUserId` 发送卡片，并基于 exact Provider message reference 更新同一实例。Messaging 不调用 Directory；concrete adapter 使用 bound configuration 和 private client context 完成 Provider-specific addressing。每个 Provider 如何解释 `ProviderUserId` 是 concrete adapter contract 的一部分，不进入通用 `IMMessaging`；Microsoft Teams 还需要在内部取得或恢复 personal conversation。

Channel 的 Test connection 由 channel-management/application orchestration 负责，不是 Basic 或 Dynamic Card Messaging operation。它可以组合 root credential testing、channel-level checks，以及 test policy 要求的真实 send operation。Message-template test、Debug Mode 与 runtime delivery 都调用真实 `send_text` 或 `send_card` operation，并通过正常 send result 得知目标用户不可达；adapter 不提供可能与真实发送结果漂移的独立 reachability probe。

Card intent 保留渲染后的 form content、完整且有序的 form inputs、actions 和 card presentation 所需的 immutable facts。Card Assessment 是 concrete Provider 对单个完整 intent 的 representability judgment：只有 Provider 能把全部 controls 和 semantics 映射为 Card Input Controls 时才返回 representable；任一 input 无法映射时，对整个 intent 返回 not representable，并可附带仅用于诊断的 human-readable reason。Assessment 不发送消息、不创建 Provider state，也不忽略不支持的 input 来产生 partial-card 结论。

本期 Slack、Feishu/Lark 与 Microsoft Teams 的 Card Assessment 对包含 `FILE` 或 `FILE_LIST` 的 intent 一律返回 not representable，因为这些 Provider 的 Dynamic Card 都不能表达对应的 file input control。Assessment result 只作为 Provider capability fact 返回；Provider adapter 不创建、修改或选择业务 `DeliveryEndpoint`，也不执行 fallback orchestration。

Messaging methods 不接收 credentials、SDK client、Directory reader 或 consumer business objects。一次 `send_text` 或 `send_card` 可以先执行 Provider-specific prerequisite operations，但至多尝试一次目标 message creation；一次 card update 同样至多尝试一次目标 mutation。Adapter 不自动重放 ambiguous message operation。Provider acceptance 与 exact message reference 作为 typed result 返回，不被解释为 end-user delivery。

Provider-specific transport address、conversation lifecycle、markdown/card rendering、message locator 和 error translation 留在 concrete adapter。公共 API 不暴露 `destination_id`、conversation ID 或 Provider-specific destination DTO。

Alternative considered: 让 caller 先把 directory user ID 转换成 destination，再把 destination 传回 Messaging。Rejected because该 temporal decomposition 只把 Teams conversation lifecycle、持久化和失效处理推给所有 callers，而没有形成独立、可复用的抽象。

### 6. Webhook and STREAM invert control through IMEventSink

`IMEventSink` 是 Provider adapter 唯一依赖的入站 consumer port。它接收一个 transport-authenticated `AuthenticatedIMEvent`，并返回 Provider transport 是否可以发送成功 ACK 所需的最小 outcome：

- `ACCEPTED`: consumer 已接管该 event，Provider 可以收到成功 ACK；identified duplicate 可以折叠为该结果。
- `RETRY`: consumer 未接管该 event，adapter 不得发送成功 ACK，并按照 concrete Provider protocol 返回或触发 retry-compatible failure。

Sink 如何取得 `ACCEPTED` 不属于 adapter contract。它可以同步写入 durable store、发布到可靠 transport，或在测试中保存到 memory collector。Provider adapter 不得导入 sink implementation、persistence model 或 business event handler。

```python
class IMEventSink(Protocol):
    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance: ...


class IMWebhookEvents(Protocol):
    def handle(
        self,
        request: WebhookRequest,
        sink: IMEventSink,
    ) -> WebhookResponse: ...


class IMStreamEvents(Protocol):
    def run(
        self,
        sink: IMEventSink,
        stop: StopSignal,
    ) -> None: ...
```

#### Webhook control flow

HTTP boundary 把 framework-neutral method、headers、query、body 和 receive time 组成 `WebhookRequest`，再调用 `webhook_events.handle(request, sink)`。Concrete adapter 负责 URL challenge、signature/timestamp/replay verification、decryption 和 Provider-specific response encoding。

Challenge、authentication failure 或 non-event control request 不调用 sink。Authenticated event 只调用 sink 一次；sink 返回 `ACCEPTED` 后 adapter 才返回 success ACK response，返回 `RETRY` 或抛出 unexpected failure 时 adapter 产生 Provider-specific retry-compatible response。

#### STREAM control flow

Runtime 调用 `stream_events.run(sink, stop)` 启动长生命周期 operation。Concrete adapter 建立 Provider SDK connection、注册 callbacks、处理 connection authentication、control frames、reconnect 和 protocol ACK。

Provider SDK callback 收到 business delivery 后，adapter 验证 envelope、解密并构建 `AuthenticatedIMEvent`，随后调用同一个 sink。Sink outcome 在原 callback/connection ownership 内映射成 Provider-specific ACK；ACK ownership 不转移给 sink。Stop signal 请求终止后，run operation 负责停止 reconnect、关闭本 adapter 的 stream resources 并返回。

Webhook 与 STREAM 不共享 request、connection 或 ACK interface；它们只共享 authenticated event 和 sink semantics。这保留了真实控制流，同时避免两套 downstream consumer contract。

### 7. AuthenticatedIMEvent is provider-neutral evidence, not a business event

`AuthenticatedIMEvent` 包含：

- provider and stable Provider tenant ID;
- optional real Provider event ID;
- optional Provider event time and local receive time;
- immutable decrypted Provider-native payload;
- optional Provider-owned event type discriminator.

它不包含 raw verification secret、encrypted request body、HTTP response object、STREAM ACK envelope、SDK client、connection state、local persistence ID 或任何业务 consumer state。

Adapter 只保留 Provider 真正提供且能证明在 redelivery 中稳定的 event ID；不得从 payload hash、timestamp、message reference 或 ACK envelope 合成 event ID。

Provider-native payload 的进一步解释由独立 consumer/decoder 完成。本 change 不定义 card submission、workflow event 或其他业务 event model。

### 8. Do not expose ACK handles to downstream consumers

Alternative design 是让 Webhook/STREAM 返回带 `ack()` / `nack()` 的 delivery handle，或将 stream 表达为 async iterator。它能显式展示 ACK 时序，但会把 Provider connection ownership、ACK deadline 和 exactly-once handle lifecycle 泄漏给所有 consumers，并且与 callback-driven Provider SDK 不自然匹配。

本设计选择 callback sink：adapter 保留 ACK control，sink 只回答是否已经接管 event。这样 Provider-specific protocol complexity 被下拉到 concrete adapter，common consumer 不需要理解 Slack envelope、Feishu/Lark handler return value 或 Microsoft Teams HTTP acknowledgement。

### 9. Provider verification is exhaustive and evidence-backed

实现阶段维护 `Provider verification unit × capability operation / event entry` coverage matrix。初始 verification units 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams。Feishu 和 Lark 继续使用独立的 credentials、Provider discriminator、API host configuration 与 concrete adapter composition，但共享 SDK 和协议实现只占一个证据单元。

Feishu/Lark 的 unit 与 integration tests 可以共享或参数化；两个 concrete adapter 的 configuration mapping、Provider discriminator 和 API host selection 仍必须分别受测试保护。共享 operation 或 event path 必须在授权飞书非生产环境中完成真实执行，并以该执行产生的 sanitized fixture 关闭 Feishu/Lark verification unit 的对应 evidence cell；本 change 不要求 Lark 环境的独立真实执行。若两者出现不同的 production code path 或 Provider protocol semantics，则当前共享证据单元的前提不再成立，必须回到 spec review，而不能使用飞书证据宣称 Lark 分叉路径已完成。

每个适用项都必须具有：

- concrete Provider unit test;
- concrete Provider integration test;
- authorized non-production real API call or real event processing evidence;
- sanitized real request/response or event payload fixture;
- applicable signature-verification and decryption tests.

Shared contract tests不能替代另一个 Provider verification unit 的 evidence；Feishu/Lark 的显式共享规则是唯一例外。Fixture 必须先脱敏 plaintext 和 metadata，再使用 test-only material 重新生成 cryptographically valid signature 或 ciphertext；不得提交真实 credential、secret、token 或 key。

### 10. Failure contracts grow incrementally and remain capability-scoped

公共 Provider API 不预先定义覆盖所有未来场景的大型 failure-code enum。每个 capability 先暴露当前 contract 确实需要区分的最小 typed success、known failure 与 ambiguous outcome；只有当 application caller 需要稳定分支判断，且 concrete Provider evidence 已确认语义时，才在对应 capability 内新增窄 enum member 或 result variant。

Failure values 只携带 operator-safe facts，不包含 raw Provider response、SDK exception 或 credential material。所有公共 enum member 和 immutable model field 都必须使用简洁 English comment 或 docstring 说明其业务语义、来源以及易混淆边界；注释不得只是复述字段名称。

## Risks / Trade-offs

- [Long-lived adapter can retain stale credentials] → Adapter configuration is immutable; composition replaces the whole adapter when configuration changes and closes the previous instance.
- [Shared SDK client may not be concurrency-safe] → Concrete adapter owns serialization、pooling 或 dedicated-client decisions inside its private client context。
- [Optional capability access can be ignored by callers] → Required capabilities are non-optional; optional capability absence is explicit and no dummy methods exist.
- [Sink callback can block Provider ACK deadlines] → Sink contract is intentionally limited to safe acceptance; slow business work remains outside the sink implementation.
- [STREAM shutdown differs across SDKs] → Shared contract specifies stop semantics while concrete adapters own SDK-specific cancellation and reconnect suppression.
- [Provider-native payload delays normalization] → This is intentional; generic Provider infrastructure must not guess consumer business schemas.
- [Provider user lifecycle states differ across directories] → Shared Directory exposes snapshot membership only; concrete adapters omit confirmed deletion tombstones, retain other exposed identities and leave actual reachability to Messaging until a product consumer defines narrower state semantics.

## Migration Plan

1. Introduce `IMProviderAdapter` and Provider-specific configuration types without switching existing callers.
2. Move concrete SDK/client construction into each root adapter and expose capability views backed by the same client context.
3. Change credential testing to `adapter.test_credentials()` and remove transport or credentials arguments from capability methods.
4. Move Directory and Messaging callers to adapter-bound views.
5. Introduce `IMEventSink`, `AuthenticatedIMEvent`, Webhook `handle` and STREAM `run` contracts.
6. Move Provider authentication、challenge/control-frame handling、SDK callbacks 和 ACK mapping into the applicable event capability。
7. Move persistence、queueing、routing 和 business decoding behind independent sink/consumer implementations。
8. Close every applicable verification-matrix cell before enabling a concrete Provider capability.

## Open Questions

- Which concrete Provider SDK clients are thread-safe, and which adapter implementations require internal serialization or a client pool?
- What exact stop/cancellation primitive best fits the implementation runtime while preserving the shared STREAM `run(sink, stop)` semantics?
- Which Provider event identifiers are documented as stable across redelivery rather than only across one transport envelope?
- What normalized generic card intent is shared by the three Dynamic Card Messaging implementations?
- Which Microsoft Teams operations acquire and refresh the private personal-conversation context used internally for a `ProviderUserId`?
