## 1. WTA-1878：冻结产品边界与官方 App 契约

- [ ] 1.1 将本 change 已确认的部署矩阵、workspace-only installation、Slack workspace 一对一 ownership、token rotation、legacy coexistence、same-workspace reauthorization、disconnect compensation 与非目标整理为可被 WTA-1879～WTA-1885 引用的 Engineering Brief。
- [ ] 1.2 固化 versioned official App contract，列出最小 bot scopes、event subscriptions、OAuth redirect URL、Events Request URL、Interactivity Request URL、token rotation 和 expected App identity，并与 WTA-1868、WTA-1873、WTA-1270 的消费者需求核对。
- [ ] 1.3 在实现开始前确认 WTA-1875 canonical Channels API 与 WTA-1282 durable callback contract 的最终接口；若接口尚未落地，仅实现可独立合入的模型/config 部分，不建立重复 management 或 inbox abstraction。
- [ ] 1.4 为产品边界添加契约测试矩阵，覆盖 Cloud OAuth、Cloud unavailable、Cloud legacy `self_managed`、Community / Enterprise self-managed、Enterprise Grid rejection 与跨 workspace ownership conflict。

## 2. WTA-1879：配置 Cloud 官方 Slack App 与运行时密钥

- [ ] 2.1 在 `api/configs/` 增加 Cloud-only official Slack App typed config、feature flag / allowlist、expected App identity 和 trusted callback/redirect URL 校验，确保 Community / Enterprise 不依赖该配置。
- [ ] 2.2 实现 official App readiness port 并接入 Channels composition；配置缺失时只禁用新 OAuth authorize，已有 OAuth runtime 和 legacy connection 必须保持可读且不被误删。
- [ ] 2.3 为 deployment secret owner 接入 `client_id`、`client_secret`、`signing_secret` 与受控 previous-secret rotation window，禁止这些值进入 tenant model、API schema、frontend bootstrap、日志、trace、metric、audit 或异常文本。
- [ ] 2.4 添加 manifest/config 契约测试，验证 scopes、App identity、redirect/callback URL 和 token rotation 设置一致，并覆盖完整配置、缺失配置、错误 URL、flag/allowlist 与 self-hosted 启动。
- [ ] 2.5 编写 client secret / signing secret 轮换和回滚 runbook，包含 readiness、旧 secret 过渡、signature rejection 观测与安全验证步骤。

## 3. WTA-1880：拆分 App 凭据与 workspace installation

- [ ] 3.1 设计并添加 additive database migration：OAuth installation 一对一表、全局唯一 Slack workspace claim、queryable expiry、`credential_revision`、refresh lease、lifecycle 与必要索引/约束；现有 Slack rows 必须继续解释为 `self_managed` 且不自动 claim。
- [ ] 3.2 扩展 IM Control Plane domain snapshot 和 transaction-oriented repository ports，支持 credential-mode discriminator、installation/claim 原子创建、独立 credential CAS、lifecycle transition CAS 与显式 eager loading。
- [ ] 3.3 实现 ORM models、Pydantic encrypted representations 和 repository mapper；非法字段组合、provider mismatch、claim chain mismatch、解密失败与 legacy payload 解析必须 fail closed。
- [ ] 3.4 将 Slack credential protector 和 adapter composition 按 `self_managed` / `oauth_installation` 分流：前者保留 secret preserve 与 Socket Mode，后者只提供当前 bot token 且不得调用 `apps.connections.open`。
- [ ] 3.5 调整 Slack management/runtime ports，使 App-level secret 只由 system config 使用，tenant OAuth row 只保存加密 installation token 与 safe metadata，所有 `repr`、serialization 和 error mapping 均隐藏 secret。
- [ ] 3.6 添加 domain、repository 和 migration tests，覆盖 claim 并发唯一性、credential/config revision 分离、加解密失败、mode mismatch、legacy 读取、same-team explicit rotation、provider replacement invalidation 与 secret redaction。

## 4. WTA-1881：实现 OAuth 发起、回调与原子安装

- [ ] 4.1 在 WTA-1875 保留的 Channels API 上定义 typed `connect`、`reauthorize`、`migrate_legacy` authorize command、safe authorization URL response、callback result 与稳定 failure codes，不扩展重复 `im-integration` routes。
- [ ] 4.2 实现短 TTL OAuth state store，使用 Redis `GETDEL` 或 Lua 原子消费，并绑定 workspace、actor、intent、complete Integration CAS、expected Slack workspace、popup correlation 与 trusted return origin。
- [ ] 4.3 实现 official Slack OAuth client，在数据库事务外调用 `oauth.v2.access`，验证 official App identity、workspace-only installation、token type、rotation material、required scopes 和可信 `team_id`，并分类用户取消、Slack 拒绝与网络错误。
- [ ] 4.4 实现新 connect transaction：原子创建 Integration、OAuth installation 和 workspace claim；对 concurrent claim、stale state/CAS 和 local commit failure 执行 secret-free error mapping 与 best-effort revoke/uninstall compensation。
- [ ] 4.5 实现 same-workspace reauthorization 和 legacy migration transaction，同时推进 `config_version` / `credential_revision` 并保留 Integration ID、identities、bindings；返回不同 `team_id` 时拒绝并要求 disconnect 后重连。
- [ ] 4.6 增加 authorize/callback controllers 和受控 `302` callback-page redirect；public callback 不依赖登录 cookie，浏览器只接收一次性 safe result ticket，完成后由 Channels GET 提供权威状态。
- [ ] 4.7 添加 OAuth service/controller tests，覆盖权限/readiness、authorize URL、state atomic consume、过期/伪造/重复/cross-tenant state、scope/App/team validation、claim conflict、same-team reauth、legacy migration、CAS race、compensation 和无 secret response。

## 5. WTA-1882：实现公共 Slack callback 与租户路由

- [ ] 5.1 在 WTA-1282 durable ingress contract 上增加 official Slack Events / interactivity endpoints，完整保留 raw body 和 verification-critical headers，并确保 Cloud OAuth 不启动 tenant Socket Mode connection。
- [ ] 5.2 实现 tenant routing 前的 system signing-secret 验证、timestamp replay window、duplicate critical-header rejection 和 expected App identity validation；只有验证成功后才能解析 `team_id` 或查询 workspace claim。
- [ ] 5.3 实现经过 claim → installation → Integration 一致性检查的 tenant resolver；unknown、inactive、cross-tenant correlation 或 inconsistent claim 必须 fail closed 且不泄露 ownership。
- [ ] 5.4 对有效 `url_verification` 直接返回 challenge；其他 callback 在 durable inbox commit 后快速 ACK，persistence failure 返回 retryable non-success，request thread 不执行 card decoding 或 HITL authorization。
- [ ] 5.5 实现 Events `event_id` 与 interactivity semantic identifier/body digest 的 provider-scoped dedup key，将已认证 envelope 交给 WTA-1873 decoder，并把 `app_uninstalled` / `tokens_revoked` 交给独立 lifecycle port。
- [ ] 5.6 添加 ingress tests，覆盖 raw-body signature、过期/重复 header、unexpected App、URL verification、两个 tenant 隔离、unknown/inactive claim、durable failure、duplicate delivery、fast ACK、lifecycle routing 与 Community / Enterprise Socket Mode 回归。

## 6. WTA-1883：接入 OAuth 管理 UI

- [ ] 6.1 扩展 Channels definition/view schema，返回 credential-free `auth_mode`、`availability`、credential mode、installation lifecycle、safe workspace metadata 和 state-aware capabilities，并重新生成 `consoleClient` / `consoleQuery` bindings。
- [ ] 6.2 在 `web/features/contacts/im-platform/` 实现 production repository adapter，使用 generated client 完成 list/read/authorize/disconnect 与 query invalidation，mock repository 仅保留为 test/story fixture。
- [ ] 6.3 按 server capabilities 渲染 Cloud Connect、same-workspace Reauthorize、Disconnect、legacy migration、unavailable 和 `reauthorization_required` 状态；Community / Enterprise 继续使用 self-managed credential form。
- [ ] 6.4 收紧 `web/hooks/use-oauth.ts` 与 callback page：校验 exact `event.origin`、`event.source === popup` 和 message schema，使用 exact same-origin target，保证 close/timeout/message 单次 settle 并清理 listener、timer 与 interval。
- [ ] 6.5 处理 popup blocked/closed、用户取消、state expired、missing scope、workspace conflict、Slack unavailable、stale CAS、disconnecting 和 callback failure；失败必须保留原 server state并要求 refetch 后再重试。
- [ ] 6.6 添加 Vitest / React Testing Library tests，覆盖 production repository、generated DTO mapping、Cloud OAuth/unavailable/legacy、CE/EE credentials、capability gating、popup origin/source 攻击、duplicate completion、stale refetch 与 DOM/request/telemetry secret absence。

## 7. WTA-1884：实现 token 生命周期、撤销与卸载

- [ ] 7.1 实现按 queryable `expires_at` 扫描的 refresh scheduler/task、有限 database lease、jittered horizon 和 `(installation_id, credential_revision, lease_owner)` CAS；worker crash 后 lease 必须可接管。
- [ ] 7.2 实现 Slack token refresh client 和原子 credential commit；成功只推进 `credential_revision`，不得推进 Integration `config_version` 或使 identities、bindings、sync/business references stale。
- [ ] 7.3 统一 connection test、delivery、directory sync 与 callback consumer 的 auth/scope failure classifier；transient failure 有界退避，`invalid_grant`、revoked、expired 或 missing scope 原子进入 `reauthorization_required` 并停止新 provider I/O。
- [ ] 7.4 实现 active → `disconnecting` CAS、remote uninstall/revoke、transition-token CAS delete 和 idempotent retry；远端失败保留补偿凭据与 safe status，成功后按现有 Integration delete 规则清理 claim、installation、identities 与 bindings。
- [ ] 7.5 实现 verified `app_uninstalled`、`tokens_revoked` 与 runtime deterministic auth failure 的 idempotent lifecycle transition；外部失效保留 Integration/claim/bindings 以支持 same-workspace reauthorization，disconnect race 不得倒退状态。
- [ ] 7.6 添加 clock-controlled tests，覆盖 refresh horizon、lease contention/expiry、one-time refresh token、stale response、reauthorization race、transient retry、terminal auth failure、disconnect compensation、external uninstall/revoke 与 lifecycle idempotency。

## 8. WTA-1885：验证、可观测性与灰度发布

- [ ] 8.1 为 authorize/callback、claim conflict、signature rejection、durable enqueue/dedup、refresh、revoke/uninstall、lifecycle transition 和 provider failure 增加 metrics、structured audit 与 correlation，并添加 token/secret/raw-payload redaction tests。
- [ ] 8.2 运行 targeted backend unit tests，例如 `uv run --project api --dev pytest <targeted-test-paths>`，再运行受影响路径的 `uv run --project api --dev ruff check <changed-python-paths>` 与项目规定的 type checks；backend integration tests 只记录 CI evidence。
- [ ] 8.3 运行 targeted frontend tests，例如 `pnpm --dir web test --run <targeted-test-paths>`、`pnpm --dir web type-check` 和受影响 i18n/lint checks，保存 Cloud/self-hosted management matrix 结果。
- [ ] 8.4 在 staging official App 完成首次安装、same-workspace reauth、different-workspace rejection、legacy migration、duplicate/expired/forged state、missing scope、claim race、callback retry、refresh、disconnect、revoke、external uninstall 与 reinstall 演练。
- [ ] 8.5 使用至少两个 Dify tenants / Slack workspaces 验证隔离，并与 WTA-1868 card rendering、WTA-1873 decoding、WTA-1270 directory sync 和 WTA-1282 durable runtime 完成 DM send、dynamic card submit、dedup 与 authorization 联调。
- [ ] 8.6 通过 Cloud feature flag / allowlist 分阶段放量，配置 OAuth completion、callback latency/error、signature rejection、refresh failure/expiry、lease contention、durable failure 和 compensation failure alerts 及明确 owner。
- [ ] 8.7 演练回滚：停止新 authorize 但继续服务已安装 callback/refresh/runtime，验证 config unreadiness 不破坏 legacy 或 Community / Enterprise；输出发布 checklist、known limitations、support runbook 与 integration evidence pack 后再关闭 WTA-1877。
