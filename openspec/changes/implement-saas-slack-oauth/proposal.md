## Why

PRD 已明确 SaaS 首期通过 Slack ISV / OAuth 接入，但当前实现仍要求每个 Dify workspace 保存完整 Slack App 凭据，并在 credential test 中强制建立 Socket Mode 连接。这既把系统级 App secret 错误地下沉到 tenant 生命周期，也无法支撑一个官方 Slack App 的多 workspace 安装、公共 callback 路由和可靠 token 生命周期。

WTA-1877 已把该缺口拆分为官方 App 配置、凭据分层、OAuth、公共 callback、前端接线和生命周期管理；现在需要一份与现有 IM Integration CAS、Provider adapter、Channels API 及 Contacts UI 边界一致的实现规格。

## What Changes

- 为 Cloud 增加 Dify 官方 Slack App 配置与 fail-closed readiness；App 级 `client_id`、`client_secret`、`signing_secret` 只来自 deployment secret/config，不进入 tenant 持久化、API、日志或前端。
- 将 Slack 持久化凭据显式区分为 `self_managed` 与 `oauth_installation`：Cloud OAuth 只保存加密的 workspace 安装 token、refresh token、expiry、granted scopes 和可信 Slack identity metadata；Community / Enterprise 继续支持自建 App 与 Socket Mode。
- 在保留的 Channels API 上增加 Cloud-only OAuth authorize/callback、同 workspace 重授权和断开流程；OAuth state 一次性、短时并绑定 workspace、actor、当前 Integration revision 与操作意图。
- 增加官方 App 的公共 Slack Events / interactivity 入口，在 tenant 路由前使用系统级 signing secret 验签，再通过已声明的 Slack workspace ownership claim 路由到当前 Integration 和 durable event consumer。
- 首发官方 App 启用 Slack token rotation；自动 refresh 使用独立 credential revision，不把后台 token refresh 误判为 Integration 配置变更，也不使现有 IM identities、bindings 或在途业务关联失效。
- 外部卸载、token revoke/expiry 与主动断开进入明确生命周期；失效安装立即停止新的目录读取、消息发送和 callback 业务处理，并向管理员暴露安全的重授权状态。
- 将 Contacts Channels 的生产 composition 从纯 mock repository 接到生成的 Console client。Cloud Slack 展示 Connect / Reauthorize / Disconnect OAuth 流程，Community 保留 self-managed credential form，Enterprise 现有入口不变。
- **BREAKING (Cloud only)**：新建 Cloud Slack 连接不再接受 tenant 提交的 App ID、App Secret、Signing Secret、Bot Token 或 App Token。已有 Cloud 手工配置以 legacy self-managed 模式继续运行，直到管理员显式迁移到 OAuth。
- 不重做卡片渲染、卡片事件业务解码、Contact sync reconciliation 或 Channels / `im-integration` API 统一；这些分别由 WTA-1868、WTA-1873、WTA-1270 与 WTA-1875 拥有。

## Capabilities

### New Capabilities

- `saas-slack-oauth-management`: 定义 Cloud 官方 Slack App readiness、OAuth 安装与重授权、workspace ownership、安装凭据保护、token rotation、撤销和断开语义。
- `saas-slack-event-ingress`: 定义官方 App 公共 Events / interactivity callback 的验签、快速 ACK、tenant 路由、重复投递和外部卸载处理边界。
- `saas-slack-oauth-ui`: 定义 Contacts Channels 中真实 API adapter、Cloud OAuth 交互、legacy 迁移状态以及 Community / Enterprise 兼容展示。

### Modified Capabilities

- `human-input-channel-management`: Channel definition/view 增加 deployment-aware auth mode、availability 与 OAuth management capabilities；Cloud Slack 不再使用 credential candidate 保存路径。
- `human-input-v2-im-control-plane-core`: Integration 配置 revision 与自动 credential refresh revision 分离，并为 Cloud Slack workspace claim、OAuth credential mode 和失效状态增加原子持久化约束。

## Impact

- 后端：`api/configs/`、Human Input Channels controller/contracts、Slack management service、IM Integration domain/repository/models/migrations、Slack adapter runtime、Celery refresh task、公共 callback composition、metrics/audit。
- 前端：`web/features/contacts/im-platform/` 的 production repository、OAuth popup/callback、provider definition mapping、状态与错误恢复、i18n 和测试；API 调用必须使用生成的 `consoleClient` / `consoleQuery`。
- 外部系统：Dify Cloud 官方 Slack App manifest、OAuth redirect URL、Events Request URL、Interactivity Request URL、token rotation 与最小 bot scopes。
- 前置依赖：WTA-1875 的 canonical Channels API、WTA-1282 的 durable callback consumer/runtime，以及 WTA-1873 的 Slack card-event decoder；最终联调还依赖 WTA-1868 与 WTA-1270。
- 发布：使用 Cloud feature flag / allowlist 灰度；官方 App 配置不完整时禁止新授权但不破坏 Community、Enterprise 或已有 legacy Cloud 连接。
