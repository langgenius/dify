## Why

Dify 需要通过 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 提供一致的 credential testing、目录读取、消息发送和入站事件能力，但当前缺少一组稳定的 Provider adapter 公共接口。调用方不应理解 Provider-specific credentials、transport addressing、event authentication 或 SDK lifecycle；同时，共享接口也不应规定 concrete adapter 如何创建、共享、缓存或关闭内部 client 与其他资源。

本 change 只定义调用方可观察和依赖的 capability、数据、失败、并发与生命周期契约，为后续 concrete Provider implementation 提供稳定边界。

## What Changes

- 定义 `IMProviderAdapter`：绑定一份 immutable Provider-specific typed configuration，并暴露 credential testing、required capability views、optional capability views、event transport factories 与幂等 `close()`。
- 定义 capability presence 语义和初始 Provider capability matrix；不使用可能与实际 capability 漂移的独立 support flags，也不返回 dummy unsupported capabilities。
- 定义 adapter-bound credential testing、Directory、Basic Messaging 与 Dynamic Card Messaging 的公共输入、输出和失败语义。
- 定义 Directory 的完整 snapshot 语义，以及 Directory 与 Messaging 共享的 nominal `ProviderUserId` namespace。
- 定义消息发送的 confirmed Provider acceptance、未确认 acceptance 的统一 failure、exact message reference 和 no-automatic-retry 语义。
- 将 Webhook 与 STREAM 保留为两种独立 event transport interfaces，并通过 `AuthenticatedIMEvent` 与 thread-safe `IMEventConsumer` 形成共同的 downstream boundary。
- 定义调用方必须遵守的并发与生命周期约束，包括 externally serialized root adapter、thread-safe Webhook handling、独立 STREAM lifecycle，以及 root close 对已创建 event transport 的可观察影响。
- 使用逐 Provider 的权威资料、授权非生产环境真实调用或真实事件，以及专用 fixture repository 中已提交的完整 capture 验证公共接口假设；这些证据不要求复制或脱敏后进入 Dify repository，只约束 contract correctness，不规定 production implementation structure。

## Capabilities

### New Capabilities

- `im-provider-adapter`: 定义 Provider-bound root interface、credential testing、capability discovery、并发边界与 lifecycle contract。
- `im-provider-directory`: 定义完整 Provider identity snapshot、最小共享 identity facts 与 failure contract。
- `im-provider-messaging`: 定义 Basic Messaging、optional Dynamic Card Messaging、representability assessment、send/replacement outcomes 与 exact Provider message references。
- `im-provider-events`: 定义 `IMWebhookHandler`、`IMEventStream`、`AuthenticatedIMEvent`、`IMEventConsumer` 和 Provider ACK semantics。

### Modified Capabilities

无。

## Impact

- 影响 Provider-neutral IM contract package 及其直接调用方。
- Provider-specific configuration fields、SDK selection、client construction、connection pooling、caching、locking、resource ownership、pagination/traversal algorithm、transport addressing 和 wire protocol implementation 均不由本 change 规定。
- 本 change 不实现 Slack、Feishu/Lark、DingTalk、WeCom 或 Microsoft Teams concrete adapters。它仍要求为适用的 Provider operation 和 event entry 完成真实环境验证并保留脱敏证据，但不规定 production adapter 的内部测试结构或资源设计。
- `IMEventConsumer` 的 processing、persistence、queueing、routing、deduplication 和 business decoding implementation 不属于 Provider adapter contract。
- 本 change 不处理 recipient resolution、DeliveryEndpoint planning、delivery orchestration、workflow/card-submission model、deployment coordination、remote revoke/unsubscribe 或 Provider delivery receipt。
