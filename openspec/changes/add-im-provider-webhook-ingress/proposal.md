## Why

Human Input 已经具备 Provider-specific `IMWebhookHandler`、durable `IMMessageInboxSink` 和异步 inbox worker，但没有公开 HTTP ingress 将 Provider callback 路由到当前 IM Integration。部署选择 Webhook transport 时，管理员因此拿不到可工作的 callback URL，Provider challenge、签名校验和业务事件也无法进入 durable inbox。

## What Changes

- 新增独立、无 Console session 的 `POST /callbacks/human-input/im/<webhook_id>` HTTP endpoint；它只负责有界读取原始请求、构造 framework-neutral `WebhookRequest`，并原样映射 `WebhookResponse`。
- 为每个 `HumanInputIMIntegration` 持久化全局唯一、不可枚举且不承担认证职责的 `webhook_id`；callback URL 从 `TRIGGER_URL` 和该标识派生，credential rotation 保留标识，replacement、delete 后重建生成新标识。
- **BREAKING**：删除 Integration 中持久化的 `callback_url`，避免把 deployment URL 复制进 tenant-owned configuration；Console summary 继续返回运行时派生的 `webhook_url`。
- 新增 `IMWebhookIngressService`，按 `webhook_id` 解析当前 Integration，校验 deployment-owned transport mode，复用当前 revision 的 Provider handler，并把 handler 绑定到 `IMMessageInboxSink`。
- 抽取共享 `DifyIMProviderAdapterFactory`，集中负责 owner-scoped credential 解密和 Provider adapter 构造，避免 Contact Sync、Webhook ingress 和后续 STREAM supervision 复制 credential mapping。
- 增加请求体上限、无 CORS/CSRF/session 的 callback blueprint、安全错误映射、低基数指标和 payload/credential-free 日志。
- 调整 Flask/WSGI header adaptation contract：controller 传递框架暴露的全部 header field-value，且不得拆分或重建被 WSGI 合并的重复 header；Provider authentication header 遇到歧义时必须 fail closed。

## Capabilities

### New Capabilities

- `im-provider-webhook-ingress`: 定义公开 callback route、Integration route identity、HTTP adaptation、Service orchestration、durable inbox handoff、错误语义和安全约束。

### Modified Capabilities

- `im-provider-events`: 将 `WebhookRequest` 的 header 要求收敛到 Flask/WSGI 可以诚实提供且仍然 fail-closed 的边界，不再声称能够恢复 server 已合并的原始重复 header。

## Impact

- Backend models and migrations: `HumanInputIMIntegration`、IM Integration aggregate/mappers、`webhook_id` 唯一约束和 `callback_url` 移除迁移。
- HTTP: 新 callback blueprint、blueprint registration、request-size configuration、callback URL generator 和 controller tests。
- Services: 新 Webhook ingress application service、revision-aware handler cache、共享 Provider adapter factory、inbox sink composition 和 observability。
- Reused contracts: `IMWebhookHandler`、`WebhookRequest`、`WebhookResponse`、`IMMessageInboxSink`、`SQLAlchemyIMMessageInboxRepository` 和当前 IM Integration complete-CAS semantics。
- Supported Webhook providers remain Slack、Feishu/Lark and Microsoft Teams；DingTalk and WeCom continue to expose no Webhook handler in this release。
- No new Provider authentication scheme、business-event decoder、submission behavior、STREAM lifecycle owner or inbox retention policy is introduced。
