## ADDED Requirements

### Requirement: 每个 IM Integration 必须持有稳定的 Webhook route identity

每个 `HumanInputIMIntegration` MUST 持有一个全局唯一、URL-safe、不可由 tenant 提供的 `webhook_id`。`webhook_id` MUST 只用于把 callback 路由到当前 Integration，MUST NOT 代替 Provider signature、token、JWT 或 encryption verification。

#### Scenario: 首次创建 Integration
- **WHEN** 系统创建新的 IM Integration
- **THEN** 系统 MUST 使用 cryptographically secure randomness 生成新的 `webhook_id`
- **AND** persistence MUST 拒绝重复值

#### Scenario: 同一 Provider tenant 轮换 credential
- **WHEN** credential rotation 保留当前 `integration_id`
- **THEN** 系统 MUST 同时保留当前 `webhook_id`

#### Scenario: Integration 被替换
- **WHEN** provider 或 provider tenant replacement 创建新的 Integration
- **THEN** replacement MUST 获得新的 `webhook_id`
- **AND** replacement commit 后旧 `webhook_id` MUST 不再解析到 current Integration

#### Scenario: Integration 删除后重建
- **WHEN** 一个 Integration 被删除并为相同 owner 创建另一个 Integration
- **THEN** 新 Integration MUST NOT 复用已删除 Integration 的 `webhook_id`

### Requirement: Webhook URL 必须从 deployment origin 派生

系统 MUST 使用 `TRIGGER_URL`、固定 callback path 和 `webhook_id` 生成 Provider callback URL。Integration aggregate 和 ORM model MUST NOT 持久化完整 callback URL。只有 effective deployment mode 为 `WEBHOOK` 且当前 Provider 支持 `IMWebhookHandler` 时，management projection MUST 返回 `webhook_url`。

#### Scenario: Webhook mode 下读取支持的 Provider
- **WHEN** 当前 deployment mode 为 `WEBHOOK` 且当前 Provider 支持 Webhook
- **THEN** management projection MUST 返回指向 `/callbacks/human-input/im/<webhook_id>` 的 URL

#### Scenario: Deployment origin 改变
- **WHEN** operator 修改 `TRIGGER_URL`
- **THEN** 后续 projection MUST 使用新 origin 生成 URL
- **AND** 系统 MUST NOT 更新 Integration row

#### Scenario: 非 Webhook mode 下读取 Integration
- **WHEN** effective deployment mode 为 `DISABLED` 或 `STREAM`
- **THEN** management projection MUST NOT 返回 Webhook URL

#### Scenario: Provider 不支持 Webhook
- **WHEN** `create_webhook_handler()` 对当前 Provider 返回 `None`
- **THEN** management projection MUST NOT 返回 Webhook URL

### Requirement: Webhook transport mode 必须属于 deployment configuration

`DISABLED`、`WEBHOOK` 和 `STREAM` MUST 由 server-side `IMEventTransportModeResolver` 提供。Console、EE admin 或 Provider callback request MUST NOT 设置、覆盖或持久化该 mode。

#### Scenario: Deployment 未显式启用 Webhook
- **WHEN** deployment mode 为默认的 `DISABLED`
- **THEN** callback ingress MUST 不调用 Provider handler
- **AND** callback ingress MUST 返回与 unknown route 相同的 `404`

#### Scenario: Tenant 尝试选择 Webhook mode
- **WHEN** tenant configuration request 包含 event transport mode
- **THEN** management input validation MUST 拒绝该字段
- **AND** Integration persistence MUST 保持不变

### Requirement: Public controller 必须只做有界 HTTP adaptation

系统 MUST 在独立、无 Console session 的 blueprint 暴露 `POST /callbacks/human-input/im/<webhook_id>`。Controller MUST 在读取 body 或执行 I/O 前捕获 trusted UTC receive time，MUST 有界读取 exact body bytes，MUST 构造现有 `WebhookRequest`，并 MUST 把 Service 返回的 `WebhookResponse` 映射为 Flask response。Controller MUST NOT 解析 Provider JSON、选择 Provider、查询 tenant 或执行 business processing。

#### Scenario: 合法 callback 到达 controller
- **WHEN** callback path、method 和 body size 合法
- **THEN** controller MUST 把 uppercase method、framework-exposed headers、exact body bytes 和进入 controller 时捕获的 receive time 交给 `IMWebhookIngressService`

#### Scenario: Callback body 超过上限
- **WHEN** request body 超过 `HUMAN_INPUT_IM_WEBHOOK_MAX_BODY_BYTES`
- **THEN** controller MUST 返回 `413`
- **AND** controller MUST NOT查询 Integration、构造 Provider adapter 或写入 inbox

#### Scenario: 浏览器发送 preflight
- **WHEN** client 对 callback route 发送 CORS preflight
- **THEN** callback blueprint MUST NOT 提供 application CORS policy 或 authenticated Web API fallback

#### Scenario: Callback 携带 Console cookie
- **WHEN** callback request 携带 Console session cookie 或 CSRF header
- **THEN** controller MUST NOT把该状态用于 authentication、tenant selection 或 authorization

### Requirement: Ingress Service 必须从 route identity 解析 authoritative Integration

`IMWebhookIngressService.handle(webhook_id, request)` MUST 按全局唯一 `webhook_id` 加载 current domain `IMIntegration`，MUST NOT从 request body、header、query 或 path 的其他字段推导 Provider 或 tenant。Service MUST 在每个 request 开始时读取 current Integration revision，随后才可复用该 revision 对应的 handler。

#### Scenario: 当前 route 被调用
- **WHEN** `webhook_id` 对应一个 current Integration 且 deployment mode 为 `WEBHOOK`
- **THEN** Service MUST 使用该 Integration 的 Provider、provider tenant、owner scope、protected credentials 和 complete revision 构造 ingress context

#### Scenario: Route 不存在或已删除
- **WHEN** `webhook_id` 没有对应 current Integration
- **THEN** Service MUST 返回 `404`
- **AND** Service MUST NOT reveal credentials、构造 Provider adapter 或写入 inbox

#### Scenario: Caller 伪造 Provider header
- **WHEN** callback header 或 body 声称属于另一个 Provider 或 tenant
- **THEN** Service MUST 仍以 route lookup 得到的 Integration 构造 handler
- **AND** Provider handler 或 bound sink MUST 拒绝不匹配的 authenticated identity

#### Scenario: Route query 失败
- **WHEN** persistence 无法确定 route 是否对应 current Integration
- **THEN** Service MUST 返回 payload-free `503`
- **AND** Service MUST NOT把 query failure 映射为 `404`

### Requirement: Service 必须复用 revision-bound Provider handler

Service MUST 通过共享 `DifyIMProviderAdapterFactory` reveal owner-scoped credentials 和构造 `IMProviderAdapter`。Service MUST 把 Provider handler 绑定到该 Integration 的 `IMMessageInboxSink`，并 MUST 以完整 `(integration_id, config_version)` 为 key 复用 thread-safe handler。Cache MUST 有界，MUST NOT绕过每个 request 的 current route lookup。

#### Scenario: 同一 revision 收到并发 callback
- **WHEN** 多个 request 并发命中同一个 current Integration revision
- **THEN** Service MUST 让它们安全复用一个 revision-bound handler
- **AND** handler MUST 全部绑定到相同的 Integration、Provider、provider tenant 和 durable sink

#### Scenario: Credential rotation 已提交
- **WHEN** current Integration 的 `config_version` 已增加
- **THEN** commit 后开始 lookup 的 request MUST NOT使用旧 revision 的 cached handler

#### Scenario: Cache 中仍保留已删除 handler
- **WHEN** Integration 已删除但旧 handler 尚未 eviction
- **THEN** route lookup MUST 返回 not-found
- **AND** Service MUST NOT调用旧 cached handler

#### Scenario: Adapter root 已关闭
- **WHEN** Service 从 adapter 创建 Webhook handler 后关闭 root adapter
- **THEN** cached handler MUST 按既有 `IMWebhookHandler` contract 保持可调用

### Requirement: Shared Provider factory 必须隐藏 credential mapping

`DifyIMProviderAdapterFactory` MUST 成为 Contact Sync、Webhook ingress 和后续 STREAM composition 的唯一 production credential reveal 与 concrete Provider adapter construction owner。调用方 MUST 只通过 `IMProviderAdapter` capabilities 使用返回值，MUST NOT复制 encrypted field mapping、owner key selection 或 Provider constructor signature。

#### Scenario: Webhook Service 构造 Provider handler
- **WHEN** Webhook Service 需要当前 Integration 的 handler
- **THEN** Service MUST 把 domain `IMIntegration` 交给 shared factory
- **AND** Service MUST NOT直接调用 `decrypt_token` 或读取 encrypted credential model fields

#### Scenario: Contact Sync 读取 directory
- **WHEN** Contact Sync 为相同 Integration 构造 adapter
- **THEN** Contact Sync MUST 使用同一个 shared factory
- **AND** Contact Sync MUST 只访问 adapter 的 directory capability

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

Malformed或unknown `webhook_id`、inactive mode 和 unsupported Provider capability MUST 使用相同的 `404` surface。Credential reveal、handler construction 或未分类内部失败 MUST 返回 payload-free `503`。Logs、metrics、traces 和 exceptions MUST NOT包含 request body、request headers、Provider response body、plaintext/protected credentials 或完整 `webhook_id`。

#### Scenario: Malformed route identity 被探测
- **WHEN** request 使用长度或字符集非法的 `webhook_id`
- **THEN** controller MUST 返回与 unknown well-formed route 相同的 `404`

#### Scenario: Credential 无法 reveal
- **WHEN** Service 无法 reveal current Integration credentials
- **THEN** Service MUST 返回 `503`
- **AND** diagnostic MUST 只记录 safe failure code、Integration ID 和 Provider

#### Scenario: Ingress metric 被记录
- **WHEN** controller 或 Service 记录 request outcome
- **THEN** metric dimensions MUST 只包含低基数 Provider、outcome 和 HTTP status class
- **AND** metric MUST NOT包含 tenant ID、Integration ID、`webhook_id`、header 或 payload

### Requirement: Configuration commit 必须定义 in-flight request 边界

Ingress MUST NOT在 Provider authentication 或 inbox commit 期间持有 Integration write transaction。Request MUST 使用 route lookup 时捕获的 complete Integration revision；rotation、replacement 或 delete commit 后开始 lookup 的 request MUST 观察新 revision 或 route absence。下游 authorization MUST 继续依据处理时的 current Integration 和 Binding，而不是只依赖 ingress snapshot。

#### Scenario: Credential rotation 与 request 重叠
- **WHEN** request 在 rotation commit 前已经解析旧 revision
- **THEN** 该 in-flight request MAY 使用旧 revision-bound handler 完成
- **AND** commit 后开始 lookup 的 request MUST 使用新 revision-bound handler

#### Scenario: Replacement 与旧 callback 重叠
- **WHEN** replacement commit 后 Provider 调用旧 `webhook_id`
- **THEN** ingress MUST 返回 `404`
- **AND** ingress MUST NOT把旧 callback 路由到 replacement Integration

