## Context

Human Input v2 已将业务授权与通知渠道分离：Form 保存 frozen definition、`ApproverGrant` 与 immutable `DeliveryEndpoint`；提交只接受 current-state verifier 构造的 proof，并通过 `SubmitHumanInputFormHandler` 执行 first-success transaction、audit、commit-before-resume。

本 change 的上游依赖已经明确：

- `implement-human-input-v2-im-provider-foundation` 拥有 Integration management、credential/client lifecycle、deployment-level `DISABLED / WEBHOOK / STREAM` runtime policy、webhook verification/ack、stream supervision/lease/fencing，并输出 `AuthenticatedIMEventEnvelope`。Card不读取、选择或持久化该deployment policy。
- `implement-im-contact-sync-api` 拥有 directory reconciliation 以及 current IM identity/binding/override 管理。
- Card Interaction 只拥有 card render/send/update/fallback、card event semantic normalization、Card inbox 与 HITL v2 submission bridge。

```text
HITL v2 FormDeliveryProjection
             |
             v
        IMCardSender
             |
             v
       IMCardDocument
             |
             v
 IMCardTransportAdapter render/send
       |                 |
       | success         | UnsupportedCardShape
       v                 v
  direct card       IMCardSender
                          |
                          v
              canonical text + secure link
                          |
                          v
               IMCardTransportAdapter

Both adapter calls use Foundation Client Lifecycle

Provider Webhook / SDK Stream Listener
                  |
                  v
    Provider Event Transport Adapter
                  |
                  v
      AuthenticatedIMEventEnvelope
                  |
                  v
       Authenticated Event Router
                  |
                  v
         Card Interaction Sink
                  |
                  v
      IMCardEventNormalizer
                  |
                  v
    CanonicalIMCardInteraction
                  |
                  v
       Card Interaction Inbox
                  |
                  v
    IMCardInteractionProcessor
                  |
                  v
      Existing HITL v2 Submission
```

## Goals / Non-Goals

**Goals:**

- 以 `FormDeliveryProjection` 作为唯一 outbound 输入，提供通用 `IMCardSender`。
- 在 sender 内部抹平 Feishu、Lark、DingTalk render/send/update 差异。
- 对无法忠实映射的 Form shape 自动 fallback 到 text message + secure link，不丢失 required input。
- 让 Foundation 按deployment profile从`WEBHOOK`或`STREAM`交付的事件进入同一个Card sink、inbox与submission pipeline。
- 复用 current IM identity/binding 与 HITL v2 first-success semantics。

**Non-Goals:**

- 不管理 Integration、credential、provider tenant、client factory 或 connection diagnostics。
- 不验证 webhook、不处理 handshake/ack、不启动/监督 stream、不管理 lease/fencing/reconnect。
- 不定义 `CARD_SEND / CARD_UPDATE` runtime flags、通用 `CapabilityRegistry` 或 capability-specific adapter graph。
- 不读取 provider directory、不执行 sync reconciliation、不决定 directory event 是否触发 sync。
- 不修改 Human Input v1 delivery registry、legacy recipient model 或 v1 token contract。
- 不保证所有 Form control 都能 inline 渲染；fallback 是通用接口的正常结果。

## Decisions

### 1. `IMCardSender` 直接基于 HITL v2 delivery projection

Application boundary 接受 `FormDeliveryProjection` 与 stable delivery operation identity，内部加载 Foundation current Integration/client lifecycle，并返回 provider-neutral `IMCardDeliveryResult`。Task payload 只携带 stable IDs，不携带 credential、SDK client、provider JSON 或 raw response。

Projection 必须包含 frozen form definition、frozen App/workflow/node presentation、rendered `MessageTemplate` content、expiry、Grant 与 Endpoint facts。异步 sender 不回读 mutable workflow DSL 重建历史内容。

`FormDeliveryProjection`只存在于Dify-facing sender boundary。Direct rendering前，`IMCardSender`必须先把它转换为provider-neutral `IMCardDocument`；renderer返回`UnsupportedCardShape`后，控制权回到sender，由sender构造provider-neutral text fallback再调用adapter。Terminal update同样必须先成为canonical Card command。Provider adapter不得接收或导入Form、Grant、Contact、workflow runtime或submission service implementation。

Provider-specific payload、message handle 与 SDK exception 只存在于 adapter package；application/core/controller 不按 provider 分支。Sender与provider adapter都依赖Card-owned provider-neutral contracts，只有显式composition/factory module同时导入sender与concrete provider adapter。

### 2. Fallback 是 sender 的逐 Form 决策，不是 Foundation capability

Card layer 使用稳定 `IMCardDocument` 表达 HITL 语义。每个 provider renderer 尝试忠实映射当前 document：

- 能完整表达 required inputs/actions 时发送 direct interactive card；
- 不能完整表达时返回 typed `UnsupportedCardShape`，由 `IMCardSender` 发送 `MessageTemplate` 文案与 secure form link 的 text message。

Sender 不静默删除、coerce 或 default required input，也不因某个 Form shape 不兼容而把 provider 标为不支持。受支持 provider 必须满足 Foundation 固定的 message send/update baseline；inline rendering compatibility 只属于当前 Card document。

原因：`CARD_SEND` 是产品 baseline，fallback 已经保证可达性。再增加 runtime capability flag 或矩阵会重复表达 Card sender 自己能决定的事实。

### 3. Card provider composition 只有两个业务 adapter

每个 provider 显式 wiring：

- `IMCardTransportAdapter`: render direct card、send card/text、update terminal state，并返回 safe result/message handle；
- `IMCardEventNormalizer`: 将 authenticated envelope 中的 provider card-action payload 映射为 `CanonicalIMCardInteraction`。

两者使用 Foundation provider-local client/Integration lifecycle，但不组成通用 provider registry graph。`IMCardEventNormalizer` 不验证 transport；`IMCardTransportAdapter` 不处理 directory 或 submission。

Provider adapter拥有canonical Card value到SDK model/provider JSON的唯一转换知识。Dify application不得预先构造provider payload，adapter也不得反向调用Card/HITL application service。

### 4. Outbound delivery 使用稳定 operation identity

Form commit 后为每个 IM Endpoint 创建 stable delivery operation，并通过 after-commit dispatch。Worker 重载 projection 与 current Integration，验证 endpoint provider tenant/identity 仍属于 current configuration后调用 `IMCardSender`。

Endpoint只保存 high-entropy interaction capability hash。跨越 Form commit 与异步 send 所需的 plaintext capability只允许短期进入 encrypted、access-controlled delivery-operation escrow；send terminal outcome或Form expiry后必须清除。

Provider confirmed success 只持久化 safe message ID 与 adapter-owned opaque update handle。Ambiguous timeout 仅在 provider 支持 idempotency key 或 deterministic reconciliation 时自动 retry，否则保留 `AMBIGUOUS` fact，不能盲重放 mutation。

### 5. Foundation envelope 与 Card interaction 是两个边界

Foundation 完成 `WEBHOOK` signature/decrypt/handshake 或 `STREAM` session authentication、revision fencing后，向 Card sink 交付同一种 `AuthenticatedIMEventEnvelope`。Envelope 表达 transport authenticity，但仍包含 provider-specific、尚未做 Card 语义解释的 bounded payload。

Inbound provider-specific processing必须拆成两段，并由shared router隔开：

1. Foundation provider transport adapter将raw HTTP callback或SDK listener event转换为`AuthenticatedIMEventEnvelope`；
2. shared router按authenticated provider与native event name选择Card sink，但不解释Card payload；
3. Card sink选择matching `IMCardEventNormalizer`，把envelope转换为`CanonicalIMCardInteraction`。

Card sink 根据 provider与 event name 选择显式 `IMCardEventNormalizer`。Normalizer 是 provider payload 到 Dify canonical interaction 的 anti-corruption boundary：

- 非 Card event 返回 `IGNORED`，不创建 Card record；
- provider、provider tenant、Integration revision 与 event identity 只能取自 authenticated envelope，payload 不能覆盖这些 transport-authenticated facts；
- normalizer 只从 provider payload 提取 provider user ID、endpoint capability、selected action 与 bounded inputs，并生成 `CanonicalIMCardInteraction`；
- normalizer 只做结构解析、类型转换、字段/大小边界与 malformed-payload classification，不加载 Integration、identity、binding、Contact、Account、Grant 或 Form；
- normalizer 不执行 effective-binding resolution、Dify authorization、Form validation、proof construction 或 submission；
- 只有 canonical inbox record 已提交或幂等存在后返回 `ACCEPTED`；
- normalization或persistence的可重试失败返回 `RETRY`。

Foundation 决定 provider acknowledgement/redelivery；Card sink 不构造 HTTP/SDK ack，也不知道连接 lease。

`CanonicalIMCardInteraction`是Dify application/business的最终入口。Inbox、processor、proof factory与submission handler不得接收或依赖callback、webhook、stream、HTTP request、SDK event或raw provider payload概念。

### 6. Card-owned inbox 提供业务幂等与恢复

Inbox unique boundary 是 `(integration_id, provider_event_id)`，不包含deployment `WEBHOOK / STREAM` mode，因此deployment rollout期间的cross-transport redelivery收敛到同一record。Inbox只持久化canonical action、bounded values、provider actor identity、capability hash与safe correlation，不保留raw envelope payload、headers、signature、SDK object或plaintext capability。

Processing 使用可恢复 lease/attempt state，将 pending interaction 异步交给 `IMCardInteractionProcessor`。Durable acceptance不代表Form提交成功；accepted interaction仍可能因current binding/Form state变化进入stable rejection。

Card inbox retention、payload 与 ordering由Card业务定义。Foundation不预先建立通用业务 inbox。

### 7. Authenticated event 不是 submission proof

Processor按固定顺序：

1. 由 capability hash解析 `FormRef -> ApproverGrantRef -> DeliveryEndpointRef`，校验 owner chain 与 canonical provider actor 的 provider、provider tenant、Integration 和 endpoint identity；
2. 将 canonical provider actor转换为 provider-neutral `VerifiedIMIdentityProof` evidence，不在 Card 模块决定 Contact、Account、workspace 或 Form authorization；
3. 用 frozen definition 的共享 validator 处理action与inputs；
4. 调用 `SubmitHumanInputFormHandler`；
5. 由共享 submission transaction加载current Integration、effective binding、Contact、Account、workspace与Form snapshot，并作为这些authorization rules的单一owner完成first-success decision。

Normalizer/inbox不能加载Dify authorization state、创建proof、选择Grant、校验Form或提交Form。Proof evidence不等于submission authority；Fallback-link message不能通过伪造card action变成direct submission。

### 8. Submission 与 terminal card update 使用 after-commit 边界

IM、Email、Web 与 Service API 竞争同一个 first-success transaction。Interaction retry必须从已提交submission恢复，不重复audit、workflow resume或update dispatch。

Form进入 `SUBMITTED / TIMEOUT / EXPIRED` 后，为全部successful card handles创建terminal update operation。Update document移除/禁用action并展示safe terminal status。Update failure独立retry并记录delivery diagnostic，不改变Form、Submission或inbox outcome。

### 9. 安全与 observability 使用 allow-list

Provider-neutral documents、operations、inbox、logs、traces、metrics与API diagnostics禁止包含credential、event transport secrets、raw provider response/payload、SDK token/object、plaintext capability或unbounded input。

Metrics只使用provider、operation、safe result class、latency、inbox lag/dedup与submission outcome；provider user ID、Contact ID、message body与form input不能作为label。

## Risks / Trade-offs

- [Provider card差异导致required input丢失] -> renderer返回typed incompatibility，sender统一fallback到text+secure link并fail closed。
- [Webhook与stream重复交付] -> Foundation stable event identity + Card inbox unique key；transport mode不进入dedup key。
- [Envelope已认证但actor不再有权限] -> proof resolver只验证actor与Endpoint identity，shared submission transaction重查current Integration/binding/Contact/Account/workspace/Form，保持authenticity与authorization分离且authorization policy只有一个owner。
- [Provider send ambiguous timeout产生重复message] -> 仅使用provider idempotency/reconciliation能力安全retry，否则保留ambiguous operation。
- [Terminal update失败仍可点击] -> Form state/first-success始终是防重复权威，update只负责UX与diagnostic。
- [Card inbox敏感数据滞留] -> canonical allow-list、bounded values、retention/cleanup与raw payload禁止持久化。
- [Foundation与Card rollout顺序错误] -> 先部署Foundation transport和Card sink contract，sink/inbox就绪后才通过deployment configuration从`DISABLED`启用目标`WEBHOOK`或`STREAM` profile。

## Migration Plan

1. 先部署 Foundation Integration/client/event transport boundary，保持deployment event transport mode为`DISABLED`；不修改现有Integration records。
2. 落地 `IMCardDocument`、`IMCardSender`、delivery operations与text-link fallback。
3. 落地 Feishu/Lark/DingTalk card render/send/update adapters并运行共享Card contract tests。
4. 落地 Card event normalizers、durable interaction inbox与Foundation sink registration。
5. 落地 interaction processor、current proof、shared validation与first-success submission bridge。
6. 落地 terminal update operations；随后按目标deployment profile灰度Foundation `WEBHOOK`或`STREAM` runtime。
7. Rollback时注销Card sink或通过deployment rollout切回`DISABLED`；不写Integration mode，保留delivery/inbox/audit facts，已提交Form不回滚。

## Open Questions

- Feishu、Lark、DingTalk首批可以忠实表达的inline controls与send idempotency机制，需要通过固定SDK版本和sandbox contract tests冻结；未冻结或不兼容的shape一律fallback。
- Card inbox与terminal update retention期限需要与Human Input audit retention策略对齐；在策略确定前必须使用有界默认值。
