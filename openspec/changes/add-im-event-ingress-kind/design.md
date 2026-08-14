## Context

`define-im-provider-adapter-contracts` 已让 Webhook 与 STREAM 在 authentication 后通过 immutable `AuthenticatedIMEvent` 和 `IMEventConsumer` 汇合，同时有意保留两种 ingress 的不同 payload snapshot：Webhook 保存 authentication 与 applicable decryption 后的完整 Provider JSON object，STREAM 保存 Provider stream callback boundary 暴露的完整 native value serialization。`implement-im-message-inbox` 又把该 event 原子持久化并在 claim 后重建，Provider-specific card decoder 最终解释 `payload`。

当前 `AuthenticatedIMEvent` 没有记录 payload snapshot 采用哪一种 ingress contract。Slack decoder 通过顶层 `type == "interactive"` 推断 Socket Mode envelope，否则按 Webhook callback 解释。Feishu/Lark 则把 Webhook native JSON 包在 `__dify_feishu_lark.webhook` 中，把 STREAM native JSON 和 SDK object type 包在 `__dify_feishu_lark.stream` 中，再由 `_MSFeishuLarkCardCodec` 解开自定义 envelope。前者依赖 Provider payload shape 猜测 provenance，后者用第二份 Dify-owned representation 替代了实际 ingress payload。

本 change 建立在已完成但尚未归档的 `define-im-provider-adapter-contracts` 与 `implement-im-message-inbox` capability contract 之上。它修改 `im-provider-events` 与 `im-message-inbox`，而不是增加第三个横切 capability。

## Goals / Non-Goals

**Goals:**

- 让每个 `AuthenticatedIMEvent` 显式携带构造其 payload snapshot 的 ingress contract。
- 让 Provider-specific decoder 确定性选择 Webhook body 或 STREAM callback 的顶层解释路径。
- 让 Slack 与 Feishu/Lark 在 `IMEventConsumer` 前保留实际 ingress 的完整 Provider-native payload，不提前归一化，也不构造第二份 canonical payload。
- 让同一 Provider 的 Webhook 与 STREAM card callbacks 在 decoder boundary 汇合为相同 `IMCardEvent`。
- 让 inbox 在持久化后无损重建完整 authenticated delivery facts。
- 保持 Provider event identity、cross-ingress deduplication、ACK semantics 与 deployment transport selection 不变。
- 使用 non-null database column 建立 schema invariant。

**Non-Goals:**

- 不兼容或分类历史 inbox records；当前没有历史数据，不增加 nullable transition、default、legacy/unknown enum 或 backfill。
- 不把 deployment-owned `event_transport_mode`、configured capability 或 desired runtime mode加入 event。
- 不保存 HTTP original bytes、WebSocket frames、signature headers、ACK handles、connection state 或 Provider client objects。
- 不统一 Webhook 与 STREAM 的 lifecycle、request/response 或 ACK interfaces。
- 不把 Provider-native payload 转换成 consumer-specific business event，也不引入跨 ingress canonical payload。

## Decisions

### 1. Model ingress provenance directly on AuthenticatedIMEvent

共享 contract 增加：

```python
class IMEventIngressKind(StrEnum):
    """Ingress contract used to construct the Provider payload snapshot."""

    WEBHOOK = "webhook"
    STREAM = "stream"


@dataclass(frozen=True, slots=True)
class AuthenticatedIMEvent:
    provider: IMProvider
    provider_tenant_id: str
    event_id: str | None
    event_type: str | None
    occurred_at: NaiveDatetime | None
    received_at: NaiveDatetime
    ingress_kind: IMEventIngressKind
    payload: str
```

`ingress_kind` 是单次 authenticated delivery fact，也是 `payload` 的解释契约。它直接属于 event；inbox delivery 已包含 event，因此不得在 `IMInboxDelivery` 上复制同一字段。

Alternative considered: 增加 `AuthenticatedIMPayload(kind, content)` value object。Rejected because当前只有一个 discriminator 和一个 string，额外嵌套形成 shallow module，并放大所有 mapper 与 caller 的改动。Alternative considered: 使用 `payload_format`。Rejected because两种 representation 都是 JSON；该 discriminator 描述的是 ingress snapshot boundary，而不是 MIME/serialization format。

### 2. Keep ingress kind distinct from deployment transport mode and implementation context

`IMEventIngressKind` 记录这一次 delivery 实际采用的 ingress contract：Webhook handler 必须写 `WEBHOOK`，event stream 必须写 `STREAM`。它不表示 deployment 希望启用哪种 mode，不替代 transport factory capability，也不授权 consumer 管理 transport lifecycle。

共享 enum 使用 `STREAM` 而不是 `PROVIDER_SDK_CALLBACK`。是否使用某个具体 SDK 是 concrete adapter implementation decision；实现未来更换 client 时，event contract 不应变化。当前 STREAM payload 仍必须是 Provider SDK callback boundary 暴露的完整 supported serialization。

Alternative considered: 增加通用 `transport` object。Rejected because它会把 addressing、connection、ACK 与 lifecycle details向下游泄漏，并迫使 Webhook 与 STREAM 共享假的公共 transport abstraction。

### 3. Preserve the complete actual-ingress payload and normalize only in Provider decoders

Webhook 与 STREAM 在 `IMEventConsumer` 前只共享 `AuthenticatedIMEvent` shape，不共享 canonical payload shape：

- Webhook `payload` 是 authentication 与 applicable decryption 后得到的完整 Provider JSON。
- STREAM `payload` 是 Provider SDK callback 的完整 supported serialization。

Adapter 可以读取 payload 提取 Provider、tenant、event ID/type/time 等 confirmed facts，但不得投影、重组或包裹 payload 来统一两种 ingress。Inbox 原样保存这一 representation。只有 Provider-specific decoder 负责把不同 representation 归一化为同一 `IMCardEvent`。

Alternative considered: 在 adapter boundary 提取两种 ingress 的共同 inner callback 并持久化为 canonical payload。Rejected because这会丢失 Socket Mode/SDK callback envelope evidence、改变现有 payload preservation contract，并产生与 Provider-native payload 并行的第二套 representation。

### 4. Slack dispatches by ingress kind and preserves both native representations

Slack Webhook handler 必须以 `IMEventIngressKind.WEBHOOK` 构造 event，payload 继续保存完整 authenticated HTTP callback JSON data model。Socket Mode stream 必须以 `IMEventIngressKind.STREAM` 构造 event，payload 继续保存完整 `SocketModeRequest.to_dict()` serialization，包括 Socket Mode envelope 与 nested Provider callback。

`_SlackCardCodec.decode()` 先检查 Provider/event type，再按 `event.ingress_kind` dispatch：

- `WEBHOOK`：把 payload root 直接作为 Slack card callback。
- `STREAM`：先验证并解开 Socket Mode envelope，再把 nested payload 作为 Slack card callback。

删除 `_unwrap_callback_payload()` 中以 root `type == "interactive"` 判断 STREAM 的 inference。一个 STREAM event 携带 bare Webhook callback，或一个 WEBHOOK event 携带 Socket Mode envelope时，必须通过现有 operator-safe `IMCardEventDecodingError` 失败，不得尝试另一条 parser。

### 5. Feishu/Lark persists native JSON directly and keeps SDK validation at ingress

Feishu/Lark Webhook authentication boundary 已同时持有 decoded JSON 与 authentication/decryption 后的 `native_payload`。构造 event 时必须写 `IMEventIngressKind.WEBHOOK` 并将该 `native_payload` 直接赋给 `AuthenticatedIMEvent.payload`；不得再调用 `_authenticated_webhook_payload()`，也不得持久化 `encrypted` provenance wrapper。

Feishu/Lark STREAM boundary 必须写 `IMEventIngressKind.STREAM` 并将 `sdk_event.native_payload` 直接赋给 `AuthenticatedIMEvent.payload`；不得再调用 `_authenticated_stream_payload()`，也不得把 `object_type` 或 SDK class name包装进 persisted payload。

Stream adapter 继续在 SDK object 到 `_SDKEventEnvelope`、以及 delivery acceptance boundary 验证 supported object type。该 validation 是 ingress implementation invariant；验证成功后，decoder 只需要 `ingress_kind`、Provider event facts 和 native payload，不需要持久化 implementation-specific class identity。

`_MSFeishuLarkCardCodec.decode()` 必须先按 `event.ingress_kind` 显式 dispatch，再解析直接保存的 Provider callback JSON。当前 Webhook decrypted JSON 与 `sdk_event.native_payload` 对 card action 暴露相同 Provider callback schema，因此两条 ingress branch 可以汇合到同一个 strict callback parser；它们仍必须显式拒绝 invalid payload、旧 Dify wrapper 或其他与声明 representation 不一致的可辨识 shape。

### 6. Reject mismatches without fabricating unverifiable provenance

如果 `ingress_kind` 与 payload shape 存在 contract 可辨识的冲突，recognized-event decoding 必须走现有 operator-safe decoding failure path，不得回退到另一 ingress parser。Slack 的 bare callback 与 Socket Mode envelope 可以据此严格区分；Feishu/Lark 的两个 native representations可能具有相同 Provider JSON schema，因此 decoder 不得通过持久化 SDK class name或新增 wrapper来伪造额外可辨识性。Feishu/Lark 必须拒绝 malformed JSON、旧 provenance wrapper 和不符合 direct Provider callback schema 的 payload；合法且结构相同的 native callback 则由 ingress kind 选择的 branch 正常解释。

### 7. Persist ingress kind as an immutable non-null inbox fact

`im_message_inbox` 增加一个 non-null enum-text ingress kind column，并将现有 `raw_payload` ORM/数据库字段统一命名为 `payload`。该值不是 original HTTP bytes 或 STREAM wire frame；它就是 `AuthenticatedIMEvent.payload` 的持久化表示，因此 repository mapper 必须在 event-to-record 与 record-to-event 两个方向原样映射 `ingress_kind` 与 `payload`。Processing claim、retry 与 terminal transitions 不得修改它们。

Inbox contract 只使用既有的 `AuthenticatedIMEvent.payload` 概念，不定义 `raw_payload` alias、第二份 payload value 或额外转换层。这样持久化不变量保持为 `record.payload == event.payload`，不会把数据库实现命名泄漏成新的领域概念。

Migration 直接增加 non-null ingress kind column并把 `raw_payload` 列改名为 `payload`，不设置 ingress default、不引入 `UNKNOWN`/`LEGACY_UNSPECIFIED`，也不执行 data backfill。该策略依赖已确认的前置条件：目标环境没有历史 inbox records，并且 migration 与所有 event producers 在同一 rollout 中切换。

Rollback 在还没有写入需要保留的新 inbox data 时可回退 code 并 drop column；若 rollout 后已写入 records，回退会丢弃 ingress provenance，因此应优先 forward-fix。这里不设计 mixed-version rolling compatibility。

### 8. Keep deduplication ingress-neutral

Inbox unique identity 继续只使用 `(provider, provider_tenant_id, provider_event_id)`。`ingress_kind` 不加入 unique constraint、lookup predicate 或 synthesized event ID。这样同一个 real Provider event 先后经 Webhook 与 STREAM 到达时仍解析为同一 identified event。

Duplicate resolution 保留现有 record 及其首次 accepted delivery facts，不用后续 duplicate 的 ingress kind 或 payload 覆盖原 record。该语义与当前 duplicate handling 一致，并避免 processing input 在 redelivery 时发生变化。

## Risks / Trade-offs

- [Public constructor becomes breaking] → 在同一 implementation change 中更新所有 production constructors、fixtures、test helpers 和 exact-field conformance assertions；不提供 default，确保遗漏在 type/test boundary 暴露。
- [Ingress enum can be confused with deployment mode] → 命名为 `IMEventIngressKind`，contract 明确它是 actual delivery provenance，不进入 integration configuration。
- [Producer writes a kind inconsistent with payload] → Decoder 严格按 kind 解释并返回 operator-safe failure，不 fallback 猜测；增加各 Provider Webhook/STREAM fixture tests。
- [Feishu/Lark native representations can share the same JSON shape] → 不持久化 SDK class name或重建 wrapper来制造区分；在 stream ingress boundary 完成 object validation，并让 codec 对两条显式 branch 使用同一 Provider callback parser。
- [Removing Feishu/Lark wrappers changes stored payload shape] → 当前没有历史 inbox data；同一 change 更新 producers、decoders、fixtures 和 persistence tests，不提供 legacy wrapper compatibility。
- [Renaming raw_payload changes the internal persistence surface] → 当前没有历史 inbox data；在同一 migration 中统一 ORM、column、mapper 和 tests，不保留 alias 或双字段兼容。
- [Non-null migration cannot run over existing records] → 当前没有历史数据是本 change 的硬前置条件；migration 不提供 backfill 或 compatibility path。
- [Cross-ingress duplicate retains only the first snapshot] → 保持当前 first-record deduplication 语义；ingress provenance不加入 event identity，也不让 redelivery 改写 processing input。

## Migration Plan

1. 确认 `define-im-provider-adapter-contracts` 与 `implement-im-message-inbox` 已完成，并在需要 strict main-spec dependency 时先完成其 OpenSpec sync/archive。
2. 增加公共 enum、必填 event field 与 exports；更新 Slack producers 和 `_SlackCardCodec` ingress dispatch，同时保持两种完整 native payload。
3. 更新 Feishu/Lark producers 直接保存 decrypted/native SDK JSON，删除两个 provenance wrapper helpers，并更新 `_MSFeishuLarkCardCodec` explicit dispatch；保留 stream adapter boundary 的 SDK object-type validation。
4. 增加 `IMMessageInbox` non-null ingress kind column，将 ORM/数据库 `raw_payload` 统一改名为 `payload`，并更新双向 repository mapping；migration 不执行 data backfill。
5. 更新 unit、container integration 与 Provider conformance tests，验证 ingress kind、完整 payload、card convergence、mismatch rejection、persistence round-trip 和 cross-ingress deduplication。
6. 在没有旧 inbox records 的目标环境中随 code 一起部署 migration。

## Open Questions

无。
