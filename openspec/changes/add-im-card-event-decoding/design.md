## Context

`define-im-provider-adapter-contracts` 已定义 credential-bound `IMProviderAdapter`、optional Dynamic Card Messaging、`ProviderUserId`、`CorrelationToken` 与 transport-authenticated `AuthenticatedIMEvent`。Slack 与 Microsoft Teams concrete adapters 已能把 action identifier 和 correlation token 编码到发送的卡片中，但 inbound transport 目前只保存完整 Provider payload，没有 card-specific decoder。

`implement-im-message-inbox` 又明确要求 inbox infrastructure 只持久化、claim 和重建 `AuthenticatedIMEvent`，card decoding 必须在 claim 后由独立 consumer 完成。本 change 因此只补齐 Provider-specific event 到 Provider-neutral `IMCardEvent` 的转换边界，不接入 HITL submission runtime。

初始 Provider 的 callback 形态不同：Slack Webhook 直接保存 Block Actions payload，Slack Socket Mode 保存包含 native payload 的 SDK envelope；Microsoft Teams 把 `Action.Submit.data` 与 card inputs 合并到 activity `value`。这些差异必须由 concrete Provider implementation 隐藏。

## Goals / Non-Goals

**Goals:**

- 定义只使用现有 IM contract concepts 的 immutable `IMCardEvent`。
- 让非 card event 通过 `UnrecognizedIMEvent` 返回值表达，而不是依赖 method naming、`None` 或异常控制正常路由。
- 让 card payload 的解析失败和 schema violation 通过明确的 `IMCardEventDecodingError` 失败。
- 让每个 Dynamic Card Provider 在同一 implementation 中拥有发送编码与 callback decoding 知识。
- 实现 Slack、Feishu/Lark 与 Microsoft Teams card-event decoders，并用各自的脱敏 callback evidence 验证结果。
- 保证 decoder 产出的 `ProviderUserId` 与同一 adapter 的 Directory/Messaging namespace 一致。
- 让 decoder 无 credentials、无 I/O、thread-safe，并脱离 root adapter lifecycle。

**Non-Goals:**

- 不实现 inbox consumer、claim disposition、retry 或 dead-letter policy。
- 不解析 `CorrelationToken`，不加载 Contact、IM identity、binding、grant、form、endpoint 或 workflow state。
- 不验证 action 是否属于 frozen HITL form，不验证或 canonicalize submitted inputs。
- 不记录 HITL submission，不恢复 workflow，也不在提交后替换卡片。
- 不改变 `AuthenticatedIMEvent` 的 transport evidence 或 payload preservation contract。

## Decisions

### 1. Reuse the existing IM concepts without introducing a second normalized identity model

共享 contract 增加以下 values：

```python
@dataclass(frozen=True, slots=True)
class IMCardEvent:
    provider_user_id: ProviderUserId
    action_id: str
    inputs: Mapping[str, JsonValue]
    correlation_token: CorrelationToken


@dataclass(frozen=True, slots=True)
class UnrecognizedIMEvent:
    pass


type IMCardEventDecodeResult = IMCardEvent | UnrecognizedIMEvent
```

`IMCardEvent` 是 Provider-neutral IM contract，而不是 channel-neutral HITL model。它可以包含 `ProviderUserId` 和 `CorrelationToken`，但不得包含 Slack user object、Teams activity value、Feishu operator object或其他 Provider-specific shape。

`provider_user_id` 必须使用 concrete adapter 已经为 Directory 和 Messaging 选择的 identity namespace。对 Feishu/Lark，这意味着 decoder 必须产出 contract 规定的 `union_id`；如果真实 callback evidence 不能支持该映射，则该 implementation 不能暴露完整的 paired Dynamic Card capability，而不能改用第二种 actor identifier 绕过约束。

Alternative considered: 增加独立 actor ID 和 card context token types。Rejected because它们与已有 `ProviderUserId`、`CorrelationToken` 重复，并把同一个 IM identity/correlation concept 拆成两套模型。

### 2. Decode has one normal routing result and one explicit failure path

```python
class IMCardEventDecodingError(ValueError):
    """A recognized card event cannot be decoded using the expected schema."""


class IMCardEventDecoder(Protocol):
    def decode(
        self,
        event: AuthenticatedIMEvent,
    ) -> IMCardEventDecodeResult:
        ...
```

一个 event 不属于该 Provider 的 card-event type 时，decoder 返回 `UnrecognizedIMEvent`。一旦 event 已被 Provider discriminator 识别为 card event，以下情况统一抛出 `IMCardEventDecodingError`：payload 不是合法 JSON、缺少 callback actor/action/inputs/correlation facts、字段类型错误、出现 ambiguous invoked action，或 payload 不符合 Dify 发送端承诺的 callback schema。

异常只能包含 operator-safe diagnostics，不得保存或输出 raw payload、submitted inputs、correlation token 或 Provider user profile。Unexpected implementation failures 不得伪装成 `UnrecognizedIMEvent`。

Alternative considered: 使用 `try_decode()` 或 `IMCardEvent | None`。Rejected because method naming/`None` 无法显式表达正常的 non-card routing result，也容易把 malformed card payload 静默忽略。

### 3. Expose decoding as a class-level Provider adapter capability

`IMProviderAdapter` 增加：

```python
@classmethod
def card_event_decoder(cls) -> IMCardEventDecoder | None:
    ...
```

Decoder availability 与 Dynamic Card Messaging 必须成对：一个 concrete adapter 暴露 `dynamic_card_messaging` 当且仅当其 class-level `card_event_decoder()` 返回 decoder。Slack、Feishu/Lark 与 Microsoft Teams 必须提供两者；DingTalk 与 WeCom 必须两者都不提供。

Class-level factory 不依赖 adapter credentials，也不要求为了处理 inbox 中的历史 event 构造 credential-bound root adapter。每次调用可以返回同一个 immutable decoder 或一个等价的新 decoder；caller 不得依赖对象 identity。返回的 decoder 必须 thread-safe，可并发调用，并且不受任何 root adapter instance 的 `close()` 影响。

Alternative considered: 全局 `card_event_decoder_for(provider)` registry。Rejected because capability selection 已由 concrete Provider adapter class 拥有，全局 registry 会复制 Provider capability matrix。Alternative considered: 在 credential-bound root adapter 上直接执行 decoding。Rejected because它会把 inbox processing 绑定到 current credentials、external serialization 和 root lifecycle。

### 4. Keep send encoding and callback decoding in the same concrete Provider implementation

每个 Dynamic Card Provider implementation 同时拥有以下 wire knowledge：发送时 metadata 的嵌入位置、callback event discriminator、callback actor path、action path、input extraction，以及 correlation token 的恢复。共享 contract 不暴露 metadata envelope、reserved key 或 Provider control type。

必须满足以下 round-trip invariants：

- `send_card()` 接收的 `CorrelationToken` 由 decoder 原样恢复。
- invoked action identifier 由 decoder 原样恢复；Provider 同时回传外层 action ID 与嵌入 action ID 时，两者必须一致。
- decoder 产出的 `ProviderUserId` 与同一 Provider Directory/Messaging namespace 一致。
- `inputs` 只包含 normalized submitted input values，不包含 callback metadata 或 raw Provider envelope。
- callback metadata 与合法 input names 不得发生 silent collision。

Slack 保持 action metadata 位于 button `value`，decoder 同时支持 Webhook direct payload 与 Socket Mode SDK envelope，并把当前支持的 text/radio state values 归一化为 JSON inputs。Microsoft Teams 必须将 action metadata 与 `Action.Submit` 合并返回的 inputs 隔离；具体 reserved member 是 implementation detail，card assessment 必须在必要时拒绝与其冲突的 input identifier。Feishu/Lark decoder 也属于本 change 的实现范围；其 actor path、Webhook/STREAM envelope 与 action/value schema 必须先以脱敏的真实 callback evidence 固定，再实现共享 protocol path 下的 Feishu 与 Lark variants。

Alternative considered: 由 inbox consumer 解析 correlation/action metadata。Rejected because这会复制发送端的 Provider wire knowledge，并使 consumer 依赖 Slack、Teams 与 Feishu/Lark schema。

### 5. Preserve authenticated source context outside IMCardEvent

`IMCardEvent` 不重复保存 Provider、Provider tenant、event ID、event time 或 raw payload；这些 facts 已由 `AuthenticatedIMEvent` 和 future `IMInboxDelivery` 持有。后续 IM-to-HITL integration 必须同时保留 delivery source context 与 decoded event，才能在 `(provider, provider_tenant_id)` namespace 内解释 `ProviderUserId`。

Decoder 不把 authenticated Provider delivery 提升为 HITL authorization proof。构造 `VerifiedIMIdentityProof` 和 current binding revalidation 属于后续 change。

## Risks / Trade-offs

- [Provider callback identity may not match the selected `ProviderUserId` namespace] → 每个 Provider 必须用真实 callback fixture 证明映射；无法证明时不暴露 paired capability。
- [A malformed card callback now raises instead of being ignored] → 使用 operator-safe `IMCardEventDecodingError` 保留可观测失败，让后续 inbox consumer 决定 retry 或 terminal disposition。
- [Microsoft Teams merges action data and inputs] → 发送端与 decoder 使用同一隔离规则，并增加 reserved-key collision tests。
- [Slack Webhook and Socket Mode payload envelopes differ] → 同一个 Slack decoder 对两种 authenticated snapshot 运行 conformance tests，并要求产生相同 `IMCardEvent`。
- [Class-level capability can drift from instance messaging availability] → 加入所有 concrete adapters 的 pairing conformance test，禁止单独出现 decoder 或 Dynamic Card Messaging。

## Migration Plan

1. 增加共享 values、exception、decoder protocol 和 class-level adapter capability，不切换 inbox consumer。
2. 更新所有 concrete adapter classes，使 capability pairing 立即成立；DingTalk/WeCom 返回 `None`。
3. 在同一 Provider implementation change 中同步更新 Dynamic Card sender 与 decoder，避免新 sender/旧 decoder schema drift。
4. 增加 Slack、Feishu/Lark 与 Microsoft Teams 的脱敏 callback fixtures、decoders 和 black-box conformance tests。
5. 后续 change 再把 claimed inbox delivery 与 `IMCardEventDecoder.decode()` 接入 HITL submission application service。

Contract 尚无 production inbox consumer，因此 rollback 可以移除新增 capability 和 decoder，而不涉及持久化格式或数据迁移。已经发送的卡片是否需要兼容旧 callback metadata，必须由具体 Provider implementation 根据现有 production caller evidence 决定；兼容逻辑不得放入共享 model。

## Open Questions

- Feishu/Lark card callback 是否直接提供与 Directory/Messaging contract 相同的 `union_id`，或者是否存在无需 network I/O 的可靠映射？在真实 evidence 完成前不能关闭该 Provider 的 implementation task。
