## Context

当前 Slack IM Integration 把 `client_id`、`client_secret`、`signing_secret`、`bot_token` 与 `app_token` 作为同一组 tenant credential 持久化，并通过 `SlackIMProviderAdapter.test_credentials()` 同时验证 Web API 与 Socket Mode。该模型适用于 Community / Enterprise 的自建 Slack App，但不适用于 Cloud 官方 App：App 级 secret 应由部署拥有，一个 App 需要服务多个 Slack workspace，Events / interactivity callback 在知道 tenant 之前就必须完成验签和路由，OAuth token rotation 还要求可查询的 expiry、跨 worker lease 与独立 CAS。

现有 Human Input Channels facade 已提供完整的 Integration CAS token、provider tenant replacement、credential rotation 与 safe view；IM Control Plane 已保证一个 Organization 只有一个 active IM Integration。Contacts Channels 前端已抽象 repository、`oauth` auth mode 和 popup，但 production composition 仍使用 mock repository。通用 OAuth callback 页面可复用，不过当前 popup message listener 未校验 `event.origin` 和 `event.source`，现有 OAuth proxy state 的读取与删除也不是原子消费。

本设计以 repo-local PRD 收敛产物为需求基线。Cloud 中 Organization 与 workspace 等价；首期只支持 Slack workspace installation，不支持 Enterprise Grid org-wide installation。WTA-1875 提供 canonical Channels API，WTA-1282 提供 durable callback consumer/runtime，WTA-1873 负责 card-event decoding；本变更只定义这些边界的 Slack OAuth 接线。

## Goals / Non-Goals

**Goals:**

- 让 Cloud 管理员通过 Dify 官方 Slack App 完成 connect、same-workspace reauthorize、legacy migration 与 disconnect，tenant 无需接触 App 级 secret。
- 显式区分 `self_managed` 与 `oauth_installation` credential mode，并保持 Community / Enterprise 与已有 Cloud legacy connection 的行为兼容。
- 让一个 Slack workspace 最多归属一个 Dify workspace，同时维持一个 Dify workspace 最多一个 active IM Integration 的现有约束。
- 在 tenant 路由前验证官方 App callback，并把已认证事件可靠交给 durable consumer。
- 首发启用 Slack token rotation，以独立 credential revision、可查询 expiry、distributed lease 和 CAS 安全刷新 token。
- 对 uninstall、revocation、expiry、reauthorization 与主动 disconnect 建立 fail-closed、可恢复且可审计的生命周期。
- 将 Contacts Channels 接到生成的 Console client，并收紧 OAuth popup 的跨窗口消息验证。

**Non-Goals:**

- 不实现 Slack card rendering、card-event business decoding、Contact sync reconciliation 或 HITL authorization。
- 不合并或保留重复的 `im-integration` management API；OAuth 只扩展 WTA-1875 保留的 Channels API。
- 不支持 Enterprise Grid org-wide installation、多个 Slack workspace 绑定同一 Dify workspace，或同一 Slack workspace 绑定多个 Dify workspace。
- 不把官方 App OAuth 强制推广到 Community / Enterprise，也不批量切断已有 Cloud `self_managed` connection。
- 不在本变更中建设通用的多 provider OAuth framework；共享原语仅限一次性 state、safe callback result 与 credential lifecycle port。

## Decisions

### 1. Deployment config owns the official Slack App

新增 Cloud-only official App config，至少包含 `client_id`、`client_secret`、`signing_secret`、预期 `app_id`、OAuth redirect base URL、feature flag / allowlist 与 manifest version。secret 只从 deployment secret provider 注入，不进入 tenant API、数据库、日志、metrics、audit payload 或浏览器。readiness 在进程启动配置校验和 Channels definition composition 两处 fail closed：缺失或不一致时，Cloud Slack 仍可展示但标记 `unavailable`，禁止创建 authorize state；已有 legacy connection 继续运行。

官方 manifest 在仓库外的 Cloud deployment asset 中版本化，但所需 bot scopes、event subscriptions、redirect URL、Events Request URL、Interactivity Request URL 和 token rotation 设置必须有仓库内契约测试。OAuth callback 必须验证返回的 `app_id`、workspace identity、installation kind 与 granted scope 至少覆盖 manifest allowlist。

备选方案是把 App secret 继续复制到每个 Integration。该方案使 secret rotation 成为 tenant migration，扩大泄漏面，也无法形成可信的公共 callback 验签根，因此拒绝。

### 2. Credential mode is explicit and OAuth tokens use a one-to-one installation record

Slack persisted configuration 使用显式 discriminator：

- `self_managed` 保留现有 App / bot / Socket Mode credential shape 和 validation；
- `oauth_installation` 在 Integration 配置中只保存无 secret 的 installation reference，实际 token lifecycle 由一条一对一 Slack OAuth installation 记录拥有。

OAuth installation 记录以 `integration_id` 唯一关联 Integration，包含加密的 `bot_access_token`、加密的 `refresh_token`、`expires_at`、granted scopes、Slack team / enterprise metadata、`credential_revision`、refresh lease owner / expiry、lifecycle status 与 safe diagnostic。`expires_at` 和 lease 必须是可查询列，不放在不可索引 JSON 中。所有 token 通过 tenant-keyed encryption boundary 保护，Pydantic representation 必须隐藏 secret 的 `repr` 和 serialization。

Slack runtime 按 credential mode 组合不同 transport：`self_managed` 可使用 Socket Mode；`oauth_installation` 只获得当前 bot token 并使用官方公共 HTTP callback，不要求 `app_token`，也不调用 `apps.connections.open`。共享业务 port 只接收调用所需的最小 runtime credential。

备选方案是在现有 `encrypted_credentials` JSON 内追加 OAuth token、expiry 和 lease。它会让 refresh scheduler 扫描 JSON、把分布式协调耦合到 provider payload，并继续混淆配置与轮换状态，因此拒绝。

### 3. Integration configuration revision and credential revision have different meanings

`config_version` 继续表示管理员可见的 Integration 配置事实，并用于 provider / provider-tenant replacement、manual credential replacement、reauthorization、legacy migration、disconnect transition 与 stale async work rejection。OAuth installation 的 `credential_revision` 只保护自动 token refresh 和 runtime credential snapshot。

后台 refresh 成功只以 `(installation_id, credential_revision, lease_owner)` CAS 更新 token、refresh token、expiry、scopes 与 credential revision；它不得推进 Integration `config_version`，不得失效 identities、bindings、sync run 或在途业务关联。管理员 same-workspace reauthorization 或 legacy migration 是显式配置写：在同一事务中校验完整 Integration CAS、推进 `config_version` 和 `credential_revision`，但因 provider tenant identity 未变而保留 identities 与 bindings。

备选方案是每次自动 refresh 都推进 `config_version`。这会周期性使 sync reconciliation 与业务引用变 stale，并把 provider 的例行 token 维护误建模为 tenant 配置变更，因此拒绝。

### 4. A dedicated workspace claim is the routing and ownership authority

新增 `human_input_slack_workspace_claims`，对标准 Slack `team_id` 建立全局唯一约束，并唯一关联一个 OAuth installation / Integration 和 Dify tenant。claim 只保存安全路由 metadata、claim revision 与 lifecycle，不保存 token。OAuth callback、public event ingress 和 disconnect 都在事务内锁定或 CAS 该 claim。

新 OAuth connect 与 legacy migration 必须原子创建 claim；claim 已被另一 tenant 占用时返回稳定 conflict，且不得泄露 owner。same-workspace reauthorization 必须命中当前 Integration 的 claim。OAuth code 返回不同 `team_id` 时拒绝写入并要求管理员先 disconnect 后重新 connect。现有 legacy `self_managed` rows 不回填 claim，也不受新唯一约束；只有显式迁移时才竞争 claim。

备选方案是直接在 Integration 表对 `provider_tenant_id` 建立全局唯一索引。它会改变所有 provider 和 legacy 数据的语义、可能使现有重复配置无法迁移，并把公共路由职责塞入通用 aggregate，因此拒绝。

### 5. OAuth authorize and callback use one-time server-side state

canonical Channels API 增加以下 Cloud Slack operations：

- `POST /console/api/workspaces/current/human-input/channels/im/slack/oauth/authorize`：认证管理员发起 `connect`、`reauthorize` 或 `migrate_legacy`，返回官方 Slack authorization URL；
- `GET /console/api/workspaces/current/human-input/channels/im/slack/oauth/callback`：Slack 无登录 callback，原子消费 state、交换 code、提交 installation，然后 `302` 到同源 `/oauth-callback`；
- `POST /console/api/workspaces/current/human-input/channels/im/slack/oauth/disconnect`：以完整 Integration CAS 启动安全 disconnect。

authorize state 使用至少 128-bit 随机 nonce，短 TTL，并在 Redis 中绑定 tenant、actor、operation intent、expected Integration ID / `config_version`、当前 provider tenant identity、popup correlation 和 trusted return origin。callback 通过 Redis `GETDEL` 或 Lua 原子消费，重复、过期或错误 intent 一律拒绝；不得复用现有非原子 get-then-delete 实现。state 只授权一次 callback，不替代 callback transaction 内的 CAS 与 workspace claim 检查。

callback 先消费 state，再用系统级 App secret 调用 `oauth.v2.access`。它验证非 Enterprise Grid org-wide installation、官方 `app_id`、`team_id` 和 scope，随后在单个数据库事务中写 Integration、installation 和 claim。数据库冲突或 stale CAS 发生在 code exchange 后时，服务对新 token 执行 best-effort revoke / uninstall compensation，记录无 secret audit，并保持原 Integration 不变。callback 页面只获得短时、无 secret、一次性 result ticket；前端收到完成消息后重新读取 channel view。

直接把一个 Integration 切到不同 Slack workspace 会使远端安装、claim、identities 与 bindings 难以原子补偿，因此首期明确拒绝。安全路径是完成 disconnect 后重新 connect。

### 6. Public callbacks authenticate before tenant routing

官方 App 提供独立公共入口：

- `POST /webhook/human-input/slack/events`；
- `POST /webhook/human-input/slack/interactions`。

入口必须基于原始 body、单一 `X-Slack-Request-Timestamp` 和单一 `X-Slack-Signature`，使用 deployment `signing_secret` 校验签名与 replay window；验签成功前不得解析 tenant-owned payload、查询 workspace claim 或调用业务 decoder。验签后还要验证 `api_app_id`，再从已认证 envelope 提取 `team_id` 并通过 claim 路由。未知、inactive 或 `reauthorization_required` claim 不触发 tenant 业务处理，并返回不泄露 ownership 的安全 ACK。

`url_verification` 在完成签名和 App identity 验证后直接返回 challenge。其他 Events / interactivity 请求先写入 WTA-1282 durable inbox，再快速 ACK；持久化失败返回 retryable non-2xx。dedup key 优先使用 Slack `event_id`，无全局 event ID 的 interactivity payload 使用稳定语义 identifier 与规范化 body digest。重复投递返回成功 ACK，但只允许一个 durable item 进入消费。入口层不执行业务 card decoding 或 HITL authorization。

备选方案是先从 payload 读取 tenant 再使用 tenant signing secret 验签。官方 App callback 在验签前没有可信 tenant identity，且攻击者可控制路由键，因此拒绝。

### 7. Token rotation uses database leases and credential CAS

官方 App 首发启用 Slack token rotation。周期任务按 `expires_at` 扫描 active installations，在 refresh horizon 内以条件更新获取有限期 database lease。只有 lease owner 能用捕获的 `credential_revision` 提交 refresh；新 token 提交后清除 lease。worker 崩溃后 lease 到期可被其他 worker接管，重复 refresh response 不能覆盖更新后的 revision。

runtime send / sync 在每次 provider I/O 前读取当前 active installation credential；不得长期缓存 token。transient Slack / network failure 采用有界 exponential backoff，保留 active token 直到安全 horizon。`invalid_grant`、refresh token 被撤销、token 已过期且无法刷新或必要 scope 缺失时，installation 和 Integration diagnostic 原子进入 `reauthorization_required`，停止新的 send、sync 与 callback business dispatch；该 diagnostic 更新不推进 `config_version`。metrics 只记录 installation ID、provider、failure class、expiry bucket 和 latency。

使用仅 Redis lock 的备选方案不能和数据库 credential revision 原子关联，也无法在进程崩溃后解释 ownership，因此采用 database lease + CAS；Redis 只负责短时 OAuth state。

### 8. Disconnect and external revocation are explicit state transitions

主动 disconnect 分为两段：

1. 在 Integration CAS transaction 中把 OAuth installation / claim 标记为 `disconnecting`，推进 `config_version`，阻止新的 authorize completion、refresh、send、sync 与 callback business dispatch；
2. 调用 Slack uninstall / revoke 后，以 transition token 完成 CAS delete，原子删除 claim、installation、Integration 并按现有 provider replacement/delete 规则失效 identities 与 bindings。

远端调用失败时保留 `disconnecting` 与 safe retry diagnostic，由 idempotent retry task 或管理员重试继续；不能先删本地记录再失去远端补偿依据。并发 uninstall event 在 `disconnecting` 状态只记录事实，不把状态倒退。

外部 `app_uninstalled`、`tokens_revoked` 或确定性 auth failure 通过 durable consumer 把 active installation 标记为 `reauthorization_required`。为支持诊断和 same-workspace recovery，系统保留 Integration、workspace claim、identities 与 bindings，但所有新的 provider I/O 和业务 callback fail closed。管理员 reauthorize 成功后恢复 active；主动 disconnect 才删除 ownership。

### 9. Channels view and frontend are deployment-aware

Channel definition / view 增加 credential-free 的 `auth_mode`、`availability`、OAuth operation capabilities、installation lifecycle、legacy migration indicator 和 safe workspace display metadata。Cloud 新 Slack connection 暴露 `authorize`；active OAuth connection 暴露 `reauthorize` / `disconnect`；Cloud legacy connection 暴露 `migrate_legacy`；Community / Enterprise Slack 继续暴露 credential `test` / `save` / `delete`。后端始终从 trusted deployment context 决定模式，不能接受浏览器传入的 deployment 或 tenant scope。

前端 production repository 使用生成的 `consoleClient` / `consoleQuery` 映射 canonical Channels API，mock repository 只留给 story / unit fixture。OAuth popup 只接受 `event.origin === window.location.origin` 且 `event.source === popup` 的 schema-validated message，使用 exact same-origin target，确保 timeout、popup close 和 message 只 settle 一次并清理 listener / interval。message 不携带 token、state、tenant ID 或 provider raw error；完成后 invalidate/refetch Channels query。

备选方案是为 Slack OAuth 建一套旁路页面和 API。它会复制 channel authorization、CAS、safe view 与 query invalidation，因此拒绝。

### 10. Audit, observability and ownership boundaries are first-class

管理 audit 覆盖 authorize started、callback succeeded/failed、claim conflict、reauthorize、legacy migration、refresh failure、external revocation、disconnect started/completed/retry。日志和 tracing 只使用 correlation ID、tenant / Integration / installation ID、safe Slack team ID hash、operation、state transition 和 classified error；原始 OAuth code、state、token、authorization header、signature、raw interaction payload 与 App secret 均不得记录。

关键 metrics 包含 OAuth completion rate / latency、state rejection、claim conflict、callback signature rejection、ingress durable enqueue latency / duplicate rate、refresh due / success / failure / lease contention、installation lifecycle count 和 disconnect compensation failure。alert 关注 official App config unreadiness、持续 refresh failure、durable enqueue failure 与 signature rejection突增。

## Risks / Trade-offs

- [OAuth code 已交换但本地事务失败会产生短暂 orphan installation] → callback 失败路径 best-effort revoke / uninstall，记录 compensation metric，并提供按 safe correlation 查找的运维清理手册。
- [Slack workspace 全局唯一 claim 可能阻止合法的 workspace 转移] → 首期要求旧 owner 显式 disconnect；支持人员只能通过可审计的 ownership recovery 流程处理遗留 claim，不提供普通管理员强占。
- [保留 legacy Cloud self-managed 会形成双运行模式] → view 明确 `credential_mode` 与 migration CTA，测试覆盖两条 composition；新 Cloud connection 只允许 OAuth，并为 legacy deprecation 单独规划后续 change。
- [database refresh lease 增加 provider-specific schema 和后台复杂度] → lease、revision 与 lifecycle 封装在 Slack OAuth installation repository port，不泄漏到通用 domain consumer。
- [公共 callback 快速 ACK 与业务处理异步化会延迟用户反馈] → durable inbox 持久化成功即 ACK，按 WTA-1282 的 retry / dead-letter 指标观察，UI 状态通过管理 API 而非 callback 同步结果更新。
- [外部 uninstall 后保留 bindings 可能展示过期目录关系] → Integration 状态 fail closed，effective delivery 不得选择无效安装；reauthorize 保留关系，最终 disconnect 才按现有规则原子失效。
- [manifest scopes 与下游 WTA-1868/WTA-1873/WTA-1270 不一致] → manifest contract test 固化 scope / subscription 集合，相关 changes 联调前比较同一 manifest version。

## Migration Plan

1. 先合入 WTA-1875 canonical Channels API 和 WTA-1282 durable ingress contract；在 feature flag 关闭时部署 additive schema、repository ports、official App config validation 与 metrics。
2. 创建 OAuth installation / workspace claim 表和 credential-mode discriminator。现有 Slack rows 全部解释为 `self_managed`，不自动创建 claim、不改 token、不推进 `config_version`。
3. 配置 staging official App manifest、redirect / Events / interactivity URLs 和 token rotation，运行 OAuth、signature、scope、refresh、disconnect 与 retry 演练。
4. 为内部 allowlist 打开 backend authorize/callback 与 public ingress，再启用 production frontend repository 和 OAuth UI。config unreadiness 必须只关闭新 OAuth operation。
5. 验证 metrics、audit 与 durable consumer 后逐步扩大 Cloud allowlist；管理员按需显式迁移 legacy connection，same-team migration 保留 Integration identity / bindings。
6. 回滚时先关闭 authorize feature flag 和前端 CTA，继续服务已安装 OAuth runtime、callback 和 refresh，避免把已连接 workspace 切断。若必须回滚 runtime，保留 schema 和 encrypted installation data，先完成受控 uninstall / revoke，不能只回滚数据库 migration。

## Open Questions

- 没有阻塞实现规格的问题。最终 production App display metadata、redirect host、allowlist owner 与支持升级流程属于部署配置，由 official App launch task 在 staging 验收后固化。
- Enterprise Grid 支持、legacy Cloud 强制迁移时间表和跨 Dify workspace ownership transfer 明确留给后续 change。
