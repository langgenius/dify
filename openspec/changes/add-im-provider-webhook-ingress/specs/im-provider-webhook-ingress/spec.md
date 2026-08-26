## ADDED Requirements

### Requirement: 每个 IM Integration 必须持有稳定的 Webhook route identity

每个 `HumanInputIMIntegration` MUST 持有一个全局唯一、URL-safe、不可由 tenant 提供的 `webhook_id`。`webhook_id` MUST 是 encrypted credential envelope 之外的 server-generated routing metadata。它 MUST NOT 被封入 `EncryptedCredentials`，MUST NOT 代替 Provider signature、token、JWT 或 payload decryption verification。

#### Scenario: 首次创建 Integration
- **WHEN** 系统创建新的 IM Integration
- **THEN** 系统 MUST 使用 cryptographically secure randomness 生成新的 `webhook_id`
- **AND** persistence MUST 拒绝重复值
- **AND** credential codec MUST NOT把该值写入 encrypted credential payload

#### Scenario: 同一 Provider tenant 轮换 credential
- **WHEN** credential rotation 保留当前 `integration_id`
- **THEN** 系统 MUST 同时保留当前 `webhook_id`
- **AND** rotation MUST NOT接受 replacement `webhook_id` input

#### Scenario: Integration 被替换
- **WHEN** provider 或 provider tenant replacement 创建新的 Integration
- **THEN** replacement MUST 获得新的 `webhook_id`
- **AND** replacement commit 后旧 `webhook_id` MUST 不再解析到 current Integration

#### Scenario: Integration 删除后重建
- **WHEN** 一个 Integration 被删除并为相同 owner 创建另一个 Integration
- **THEN** 新 Integration MUST NOT复用已删除 Integration 的 `webhook_id`

### Requirement: Webhook URL 必须从 deployment origin 派生

系统 MUST 使用 `TRIGGER_URL`、固定 callback path 和 `webhook_id` 生成 Provider callback URL。Integration aggregate、credential envelope 和 ORM model MUST NOT持久化完整 callback URL。

#### Scenario: Callback URL 被生成
- **WHEN** management 需要展示一个可用 Webhook route
- **THEN** URL MUST 指向 `/callbacks/human-input/v2/im/<webhook_id>`
- **AND** URL MUST 使用当前 `TRIGGER_URL`

#### Scenario: Deployment origin 改变
- **WHEN** operator 修改 `TRIGGER_URL`
- **THEN** 后续 URL projection MUST 使用新 origin
- **AND** 系统 MUST NOT更新 Integration row 或 credential envelope

### Requirement: Webhook transport mode 必须属于 deployment configuration

`IMEventTransportMode` MUST 只包含 `WEBHOOK` 和 `STREAM`。Server-side `IMEventTransportModeResolver` MUST 从 deployment configuration 返回其中一个值。缺失或非法 deployment configuration MUST 失败，MUST NOT产生隐式 default或第三种 mode。Provider callback request MUST NOT设置或覆盖该 mode。Webhook ingress MUST 只在 effective mode 为 `WEBHOOK` 时执行 route lookup和 handler work。

#### Scenario: Deployment 选择 STREAM
- **WHEN** deployment mode 为 `STREAM`
- **THEN** callback ingress MUST 不查询 Integration、不恢复 credentials、不调用 Provider handler
- **AND** callback ingress MUST 返回与 unknown route 相同的 `404`

#### Scenario: Deployment mode 配置无效
- **WHEN** deployment configuration 缺失 event transport mode 或提供 `WEBHOOK` / `STREAM` 之外的值
- **THEN** resolver MUST 返回 configuration error
- **AND** system MUST NOT把该状态解释为第三种 transport mode

### Requirement: IMProvider 必须声明静态 Webhook capability

`IMProvider.supports_webhook()` MUST return whether the current Dify adapter implementation has Provider-level Webhook capability without reading credentials or constructing an adapter。It MUST return `True` for Slack、Feishu、Lark and Microsoft Teams，and `False` for DingTalk and WeCom。The method MUST NOT decide whether one concrete credential set can create a handler。

#### Scenario: Provider capability is queried
- **WHEN** management projection or ingress asks whether a Provider can support Webhook
- **THEN** caller MUST use `IMProvider.supports_webhook()`
- **AND** caller MUST NOT maintain another Provider-level Webhook allowlist

#### Scenario: Static-capable Provider has concrete credentials
- **WHEN** `IMProvider.supports_webhook()` returns `True` and ingress constructs the concrete adapter
- **THEN** `adapter.create_webhook_handler()` MUST be the authority for whether those credentials permit Webhook
- **AND** the shared adapter protocol MUST NOT enumerate Provider-specific credential requirements

### Requirement: Public controller 必须只做有界 HTTP adaptation

系统 MUST 在独立、无 Console session 的 blueprint 暴露 `POST /callbacks/human-input/v2/im/<webhook_id>`。Controller MUST 在读取 body 或执行 I/O 前捕获 trusted UTC receive time，MUST 有界读取 exact body bytes，MUST 构造 adapters package 中的 `WebhookRequest`，并 MUST 把 Service 返回的 `WebhookResponse` 映射为 Flask response。Controller MUST NOT解析 Provider JSON、选择 Provider、查询 tenant、恢复 credentials或执行 business processing。

#### Scenario: 合法 callback 到达 controller
- **WHEN** callback path、method 和 body size 合法
- **THEN** controller MUST 把 uppercase method、`tuple(request.headers.items())`、exact body bytes 和进入 controller 时捕获的 receive time 交给 `IMWebhookIngressService`

#### Scenario: Callback body 超过上限
- **WHEN** request body 超过 `HUMAN_INPUT_IM_WEBHOOK_MAX_BODY_BYTES`
- **THEN** controller MUST 返回 `413`
- **AND** controller MUST NOT查询 Integration、构造 Provider adapter 或写入 inbox

#### Scenario: 浏览器发送 preflight
- **WHEN** client 对 callback route 发送 CORS preflight
- **THEN** callback blueprint MUST NOT提供 application CORS policy 或 authenticated Web API fallback

#### Scenario: Callback 携带 Console state
- **WHEN** callback request 携带 Console session cookie 或 CSRF header
- **THEN** controller MUST NOT把该状态用于 authentication、tenant selection 或 authorization

### Requirement: Ingress Service 必须从 route identity 解析 authoritative Integration

`IMWebhookIngressService.handle(webhook_id, request)` MUST 按全局唯一 `webhook_id` 加载 current domain `IMIntegration`。Service MUST NOT从 request body、header、query 或 path 的其他字段推导 Provider 或 tenant。Repository MUST 返回 Integration 的 opaque credential envelope，但 MUST NOT执行 cipher resolution、credential recovery 或 Provider I/O。

#### Scenario: 当前 route 被调用
- **WHEN** `webhook_id` 对应 current Integration 且 deployment mode 为 `WEBHOOK`
- **THEN** Service MUST 使用 route lookup 得到的 Provider、provider tenant、owner scope、opaque envelope 和 complete revision

#### Scenario: Route 不存在或已删除
- **WHEN** `webhook_id` 没有对应 current Integration
- **THEN** Service MUST 返回 `404`
- **AND** Service MUST NOT解析 envelope、构造 Provider adapter 或写入 inbox

#### Scenario: Caller 伪造 Provider identity
- **WHEN** callback header 或 body 声称属于另一个 Provider 或 tenant
- **THEN** Service MUST 仍以 route lookup 得到的 Integration 构造 handler
- **AND** Provider handler 或 bound sink MUST 拒绝不匹配的 authenticated identity

#### Scenario: Route lookup persistence failure
- **WHEN** repository 因数据库连接、查询或结果映射失败而无法完成 `webhook_id` lookup
- **THEN** Service MUST 返回 payload-free `503`
- **AND** Service MUST NOT把 persistence failure 映射为 route not found

### Requirement: Service 必须为每个 callback 构造 request-scoped Provider handler

Service MUST 为每个 callback 先执行 authoritative route lookup。When `IMProvider.supports_webhook()` returns `True`，Service MUST 将 current `IMIntegration` 交给 injected Integration-to-adapter dependency，获得 `IMProviderAdapter`，并调用 `create_webhook_handler()` with the bound `IMMessageInboxSink`。A `None` result MUST return the same `404` surface as an unsupported Provider。Service MUST NOT直接解码 ciphertext、调用 cipher、校验 resolved credential union或 dispatch Provider constructors。Service MUST NOT在 HTTP requests 之间复用或持有 adapter、handler或 recovered credentials。

#### Scenario: 同一 revision 收到并发 callback
- **WHEN** 多个 request 并发命中同一个 current Integration revision
- **THEN** 每个 request MUST 独立构造和调用自己的 handler
- **AND** 每个 handler MUST 绑定到该 request读取的 Integration、Provider、provider tenant 和 durable sink

#### Scenario: Credential rotation 已提交
- **WHEN** current Integration 的 envelope 被替换且 `config_version` 已增加
- **THEN** commit 后开始 lookup 的 request MUST 恢复新 envelope并构造新 handler

#### Scenario: Integration 已删除
- **WHEN** delete commit 后 Provider调用旧 `webhook_id`
- **THEN** route lookup MUST 返回 not-found
- **AND** Service MUST NOT恢复 credentials或构造 handler

#### Scenario: Adapter root 已关闭
- **WHEN** Service 从 adapter 创建 Webhook handler 后关闭 root adapter
- **THEN** request-scoped handler MUST 按既有 `IMWebhookHandler` contract 完成当前 callback

### Requirement: Provider response 和 durable acceptance 语义必须保持不变

Service MUST 返回 Provider handler 产生的 status、headers 和 body，MUST NOT把 Provider-specific challenge、authentication failure、validation failure 或 ACK 改写为通用 success。业务事件的成功 ACK MUST 继续以 `IMMessageInboxSink` 已经 durable accept 或解析 real-ID duplicate 为前提。

#### Scenario: Provider challenge 成功
- **WHEN** Provider handler 验证并处理 challenge request
- **THEN** controller MUST 返回 handler 产生的 challenge response
- **AND** inbox MUST NOT新增 record

#### Scenario: Provider authentication 失败
- **WHEN** Provider handler 无法验证 signature、token、JWT 或 encryption material
- **THEN** controller MUST 返回 handler 产生的 non-success response
- **AND** inbox MUST NOT新增 record

#### Scenario: 新业务事件 durable commit 成功
- **WHEN** handler 产生的 `AuthenticatedIMEvent` 被 bound sink 成功写入 inbox
- **THEN** controller MUST 返回 handler 的成功 ACK

#### Scenario: Inbox persistence 失败
- **WHEN** bound sink 无法 durable accept event
- **THEN** controller MUST 返回 handler 的 retry-compatible response
- **AND** Service MUST NOT伪造成功 ACK

### Requirement: Ingress failure 和 observability 必须保护敏感内容

Malformed或unknown `webhook_id`、`STREAM` mode、`IMProvider.supports_webhook() == False` 和 `create_webhook_handler() is None` MUST 使用相同的 `404` surface。Database query、cipher resolution、credential recovery、adapter construction 或未分类内部失败 MUST 返回 payload-free `503`。Immediately after a successful Integration lookup，Service MUST emit one structured `im_webhook_integration_resolved` log containing the resolved Provider and Integration ID。Logs、metrics、traces 和 exceptions MUST NOT包含 request body、request headers、Provider response body、credential plaintext、credential ciphertext 或完整 `webhook_id`。

#### Scenario: Malformed route identity 被探测
- **WHEN** request 使用长度或字符集非法的 `webhook_id`
- **THEN** controller MUST 返回与 unknown well-formed route 相同的 `404`

#### Scenario: Integration lookup 成功
- **WHEN** repository 返回 current `IMIntegration`
- **THEN** Service MUST 立即记录一条 `im_webhook_integration_resolved` structured log
- **AND** log MUST 包含 `provider` 和 `integration_id`
- **AND** log MUST 发生在 `IMProvider.supports_webhook()`、cipher resolution、credential recovery 和 adapter construction 之前
- **AND** log MUST NOT包含 tenant ID、完整 `webhook_id`、headers、payload、credential plaintext 或 ciphertext

#### Scenario: Credential envelope 无法恢复
- **WHEN** Integration-to-adapter dependency raises `IMCredentialError`
- **THEN** Service MUST 返回 `503`
- **AND** diagnostic MUST 只记录 safe failure code、Integration ID 和 Provider

#### Scenario: Concrete credentials 不允许 Webhook
- **WHEN** `IMProvider.supports_webhook()` returns `True` but `create_webhook_handler()` returns `None`
- **THEN** Service MUST 返回 `404`
- **AND** Service MUST NOT把 Provider-specific credential fields 泄漏给 caller

#### Scenario: Ingress metric 被记录
- **WHEN** controller 或 Service 记录 request outcome
- **THEN** metric dimensions MUST 只包含低基数 Provider、outcome 和 HTTP status class
- **AND** metric MUST NOT包含 tenant ID、Integration ID、`webhook_id`、header、payload 或 ciphertext

### Requirement: Configuration commit 必须定义 in-flight request 边界

Ingress MUST NOT在 cipher work、Provider authentication 或 inbox commit 期间持有 Integration write transaction。Request MUST 使用 route lookup 时捕获的 complete Integration revision；rotation、replacement 或 delete commit 后开始 lookup 的 request MUST 观察新 revision 或 route absence。下游 authorization MUST 继续依据处理时的 current Integration 和 Binding，而不是只依赖 ingress snapshot。

#### Scenario: Credential rotation 与 request 重叠
- **WHEN** request 在 rotation commit 前已经解析旧 revision
- **THEN** 该 in-flight request MAY 使用旧 revision-bound handler 完成
- **AND** commit 后开始 lookup 的 request MUST 使用新 revision-bound handler

#### Scenario: Replacement 与旧 callback 重叠
- **WHEN** replacement commit 后 Provider 调用旧 `webhook_id`
- **THEN** ingress MUST 返回 `404`
- **AND** ingress MUST NOT把旧 callback 路由到 replacement Integration
