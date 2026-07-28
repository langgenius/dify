## Why

Human Input v2 已经具备稳定的 Form、Approver Grant、IM Delivery Endpoint、delivery attempt、IM identity proof 与 first-success submission 抽象，但还没有一条真正发送 IM card、消费 provider card action 并提交同一 Form 的运行时链路。独立的 `implement-human-input-v2-im-provider-foundation` 已统一拥有 Integration/credential/client lifecycle，以及 `WEBHOOK / STREAM` verification、ack、lease/fencing 与 authenticated event transport；Card Interaction 应复用这些基础，而不是再次实现 ingress runtime。

## What Changes

- 增加基于 HITL v2 `FormDeliveryProjection` 的通用 `IMCardSender`，在接口内部完成 provider-specific render/send/update mapping，并向上只返回 provider-neutral delivery facts。
- 由 `IMCardSender` 对每次 Form shape 做兼容性判断；无法忠实表达 required inputs/actions 时，不改变 provider support，而是 fail closed 到 `text message + secure form link`。
- 为 Feishu、Lark 与 DingTalk 实现 Card-owned render/send/update adapters；它们复用 Foundation provider-local client lifecycle，不引入 `CARD_SEND / CARD_UPDATE` capability flags 或通用 capability registry。
- 注册 Card-owned `AuthenticatedIMEventSink`，消费 Foundation 从 `WEBHOOK` 或 `STREAM` 交付的同一种 `AuthenticatedIMEventEnvelope`，再做 provider card-action semantic normalization。
- 增加 Card-owned durable interaction inbox 与 deduplication；只有 canonical card interaction 已 durable accept 或幂等存在后，sink 才向 Foundation 返回 `ACCEPTED`。
- 增加 provider-neutral interaction processor：解析 endpoint capability，以 current Integration、IM identity、binding、Contact 与 Account 构造 `VerifiedIMIdentityProof`，复用 HITL v2 form validation、first-success submission 与 workflow resume。
- 增加提交、超时与过期后的 terminal card update；更新失败只记录/retry delivery diagnostic，不回滚 Form submission。

## Capabilities

### New Capabilities

- `human-input-v2-im-card-delivery`: 定义基于 HITL v2 Form projection 的通用 `IMCardSender`、provider card render/send/update、text-link fallback 与 delivery facts。
- `human-input-v2-im-card-event-processing`: 定义 authenticated envelope 到 canonical card interaction、Card-owned durable inbox、deduplication 与异步 processing 的边界。
- `human-input-v2-im-card-submission`: 定义 canonical card interaction 如何重建 current IM identity proof、校验 form input、复用 first-success submission 并触发 terminal update。

### Modified Capabilities

- None.

## Impact

- Affected backend boundaries: `api/core/human_input_v2/approval/*`, Card-owned services/repositories/tasks, provider card adapter packages, Form creation/delivery hooks and submission after-commit hooks.
- Affected persistence: stable card delivery operations、provider card handles、encrypted short-lived capability escrow、Card interaction inbox/deduplication 与 terminal update operations；不修改 Integration event transport configuration 或 stream lease state。
- Dependencies: `implement-human-input-v2-im-provider-foundation` 提供 current Integration/client lifecycle 与 authenticated event transport；`implement-im-contact-sync-api` 提供 current IM identity/binding resolution；Form/submission runtime继续拥有 lifecycle 与 first-success transaction。
- Provider scope: Feishu、Lark、DingTalk card/message send/update 与 card-action semantic mapping；webhook verification、handshake/ack 与 SDK stream connection不属于本 change。
- Operations: 观测 card delivery/update、Card sink durable acceptance、inbox lag/dedup/outcome 与 submission result；Foundation 独立观测 webhook/stream health。
