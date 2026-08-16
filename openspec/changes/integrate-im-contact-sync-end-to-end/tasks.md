## 0. 已落地基线

- [x] 0.1 确认 canonical Channels API 当前只为 Resend 与 self-managed Slack 提供完整 list / get / test / save / delete；Feishu、DingTalk 仍为显式 unavailable handler，Lark、Microsoft Teams、WeCom 尚未进入 management provider/candidate union，legacy `im-integration` 路由继续保持 `501`。
- [x] 0.2 确认 manual sync 的 create-or-get-active、latest run、latest bucket results、IM identity search、当前全部 provider-specific `IMProviderAdapter`、`DifyIMProviderAdapterFactory`、`adapter.directory.read_directory()`、reconciliation planner、guarded apply、Celery task 与 stable run-ID idempotency 已落地；现有 credential structures 已能构造当前全部 adapter。
- [x] 0.3 确认 normalized Email 自动关联、Organization binding create/delete、workspace override set/reset 的 domain、application service、repository transaction 与 Console handlers 已落地。
- [x] 0.4 确认 Contacts Channels、manual sync、Contact management 的现有前端交互与测试均由 deterministic mock repositories 驱动；production account-settings composition 尚未调用真实 Channels、sync、Contact 或 binding API。

## 1. 范围与契约重新对齐

- [ ] 1.1 更新并复核本 change 的 proposal、design 与 delta specs，明确本次交付覆盖 Resend 以及当前全部五类 IM provider（Slack、Feishu/Lark、DingTalk、Microsoft Teams、WeCom）的 Channel API 与端到端 manual directory sync、自动关联、手动 Organization binding 和 workspace override；EE 管理面保持完全在范围外，但所有业务能力必须通过未来 EE inner API 可复用的 Dify application service boundary 暴露。
- [ ] 1.2 保持 SaaS Slack OAuth 由 `implement-saas-slack-oauth` 独立拥有；本 change 只提供 provider-neutral production repositories，并允许读取/同步服务端已存在的 authoritative SaaS connection，不复制 authorize、callback、installation 或 token lifecycle。
- [ ] 1.3 复核 `controllers/API_SCHEMA_GUIDE.md`、canonical Channels/generated contracts、archived `implement-im-contact-sync-api` 与 Contact Directory ownership，禁止新增第二套 channel、sync、Contact lifecycle 或 binding contract。
- [ ] 1.4 为 channel management、manual sync 与 binding/override 冻结transport-neutral application service contracts；public boundary不得依赖Flask request、controller DTO、ORM session/model、Celery task或EE principal type。Contact initialization必须保留为`flask data-migrate`运维入口，不得暴露为HTTP/application command。
- [ ] 1.5 先添加 backend red tests，覆盖 `flask data-migrate human-input-contacts` JSONL、page-local Plan/Apply、dry-run rollback/apply commit、whole-page write rollback/continuation、absence of nested transactions、read-failure fail-fast、幂等/final-exit语义、internal/external same-email coexistence、当前全部 IM provider 的 handler/candidate completeness、persisted connectivity、channel-kind/status sync eligibility、absence of sync-time Contact writes、现有 `IMProviderAdapter`/factory/read-directory 调用链复用、absence of parallel directory integration、credential structures unchanged by default、default worker queue、manual binding、override owner scope与多transport复用边界；authoritative Account/member write-through与periodic repair coverage属于`implement-contact-projection-lifecycle-maintenance`。
- [ ] 1.6 先添加 frontend red tests，覆盖 generated DTO mapping、production composition、Resend 以及 Slack、Feishu/Lark、DingTalk、Microsoft Teams、WeCom configuration、latest-only sync、Contact/identity search、manual binding、workspace override、canonical result variants、pagination 与 secret absence。

## 2. Contact Initialization Data Migration 与 Current Projections

- [ ] 2.1 修正 Contact Directory 当前实现与 living specs 的偏差：同一 workspace 的 External Contact 只与另一个 External Contact 做 normalized Email 唯一性冲突判断，internal/external same-email 必须可共存；同步更新 domain policy、repository predicates、database constraints/migration 与并发测试。
- [ ] 2.2 在`api/commands/data_migrate.py`注册`flask data-migrate human-input-contacts`，默认dry-run且仅显式`--apply`提交；使用稳定`(created_at, id)` keyset cursor和小而有界的page transaction，每页生成immutable Plan并传给不重新规划的Apply。每页全部写入只使用一个transaction，禁止nested transaction、savepoint和per-record commit；任一record write/flush/commit失败时rollback/close整页、记录上下文并用新session继续下一页，仅page read失败立即中止。dry-run与apply共用相同page path，只在rollback/commit处分支；dry-run输出Plan JSONL，apply在commit后输出actual-change JSONL，事件包含可用的`tenant_id`、`account_id`、`member_id`、`contact_id`、cursor、action/outcome与其他必要非PII数据。实现保持对象级流程显式，除低风险机制外不抽取通用migration framework。
- [ ] 2.3 实现 manual binding UI 所需的 current Contact application projections，并接通现有 `contacts` detail 与 `contact-options` list/batch stubs；所有读取必须依赖 lifecycle owner 提供的 current eligibility，省略 `ABSENT`/unavailable Contact，保持 admin 与 editor-safe DTO 边界。
- [ ] 2.4 添加 command/service/repository tests，覆盖每行合法JSONL及关键ID、Plan作为Apply唯一输入、Apply不二次规划、dry-run每页rollback且零持久化、apply每页commit后只记录实际变更、重复复用输出带page cursor及tenant/account/member/contact IDs的reuse/no-op且不冒充changed、小页keyset cursor、无跨页或nested transaction、任一record write/flush/commit失败rollback整页且该页零actual-change、失败页后以新session继续、page read失败立即中止、写失败完成剩余扫描后返回non-zero summary、整命令安全重跑、首次创建/重复复用、跨workspace owner rejection、无provider/binding副作用与read/sync不触发migration；ongoing write-through、removal/rejoin、Account availability和periodic repair由`implement-contact-projection-lifecycle-maintenance`测试。

## 3. Channels Readiness 与 Manual Sync 编排

- [ ] 3.1 将 channel credential/configuration、manual sync、automatic binding reconciliation、manual binding 与 workspace override 的business orchestration固定在 `HumanInputChannelManagementService`、`ManualIMSyncApplicationService`、`ContactIMBindingService`及既有worker/reconciler中；controller不得直接调用repository、provider、credential protector或Celery task，Contact initialization只允许由`flask data-migrate human-input-contacts`运维命令编排。
- [ ] 3.2 扩展 `ChannelProvider`、provider-specific candidate unions、channel handlers 与 composition registry，完整支持 `slack`、`feishu`、`lark`、`ding_talk`、`ms_teams`、`we_com`，并移除 Feishu/DingTalk unavailable placeholders；management wiring 必须复用现有 provider credential types 与 `IMProviderAdapter`，不得新增 directory adapter/client 或 sync-specific credential model。只有 red test 证明现有 credential mapping 无法构造既有 adapter 时，才允许在原 owner 中做最小调整。
- [ ] 3.3 扩展所有当前 IM provider 的 confirmed configuration result，使 successful save/reconfigure 在同一 configuration transaction 中持久化 credential-free connected diagnostic 与 trusted `last_checked_at`；standalone test 保持无持久化，failed save 不得修改 credentials、diagnostics、revision、identities 或 bindings。
- [ ] 3.4 新增 transport-neutral `ManualIMSyncApplicationService`，只编排 eligibility 与既有 `IMSyncService.create_or_get_active_run(...)`；该service不得调用Contact backfill、ensure、lifecycle mutation或provider directory，worker必须继续通过现有 `DifyIMProviderAdapterFactory` 构造 `IMProviderAdapter`、调用 `adapter.directory.read_directory()`，再通过既有guarded reconciliation input load读取current available Contacts。
- [ ] 3.5 在 application service side 校验 trusted scope 中存在 channel kind 为 `IM` 且 persisted status 为 `connected` 的 current Integration；不满足时返回稳定 `im_sync_not_allowed`，不得创建 run、dispatch task 或执行 provider I/O，且不得按 provider name 分支同步资格。
- [ ] 3.6 将 `WorkspaceIMSyncRunsApi` 与 production composition 切到 manual-sync facade；latest run、latest results 与 IM identity search 继续复用现有 application query services，并补齐 not allowed、stale revision、lock unavailable 与 dispatch unavailable 的安全错误映射。
- [ ] 3.7 添加architecture/import/call-graph tests，证明Workspace controllers只做auth、trusted context、必要audit/correlation、DTO/error mapping；future EE inner adapter可以调用相同service contracts，且任何Dify Human Input路径都不会形成controller-to-controller或`Dify -> EE -> Dify`回环；同时证明现有 provider-specific `IMProviderAdapter` 是唯一 directory integration owner，management/service/controller/frontend 均未新增或直接调用 provider directory client。

## 4. Worker Queue Readiness

- [ ] 4.1 将 `human_input_contact_sync` 加入 `api/docker/entrypoint.sh` 的 Cloud 与 self-hosted 默认 worker queue lists。
- [ ] 4.2 更新 `docker/.env.example` 与 repository-owned deployment guidance，明确启用 manual IM Contact sync 时，自定义 `CELERY_QUEUES` / `CELERY_WORKER_QUEUES` 必须同时包含 `human_input_delivery` 与 `human_input_contact_sync`。
- [ ] 4.3 添加 configuration regression tests，保证 task routing、两套默认 queue lists 与自定义 queue examples 一致。
- [ ] 4.4 补齐 worker tests，证明 terminal redelivery short-circuits、queued recovery 复用同一 run ID、duplicate delivery 不重复 current-state mutation 或 result facts。

## 5. Console API 与 Generated Contracts

- [ ] 5.1 增补严格 Pydantic response/error models，覆盖当前全部 IM provider 的 Channel commands/views、`im_sync_not_allowed`、Contact options/detail、IM identity search、binding 与 override mutation；响应不得暴露 credentials、provider payload、queue/lock details 或 raw exceptions。
- [ ] 5.2 使用现有 Contact、sync、identity、binding、override 与 canonical Channels routes；controller必须委托给共享application services，不得新增history endpoint、arbitrary run-by-ID endpoint、legacy `im-integration`依赖或transport-owned业务编排。
- [ ] 5.3 通过 repository-owned workflow 重新生成 OpenAPI 与 `packages/contracts/generated` Console bindings，禁止手工编辑 generated TypeScript。
- [ ] 5.4 添加 generated-schema contract tests，覆盖现有 management capabilities、Resend commands、当前六个 canonical IM provider values 对应的五类 provider family commands/views、sync lifecycle、五类 result variants、required bucket pagination、Contact projections、manual binding 与 workspace override。

## 6. Frontend Production Repository Boundary

- [ ] 6.1 将现有过宽的 mock boundary 拆为 `ContactChannelsRepository`、`ContactImSyncRepository` 与 `ContactImBindingRepository`；query keys、contexts 和 invalidation 必须按 workspace 与 authoritative resource 隔离。
- [ ] 6.2 用 canonical generated values 替换 mock-only provider/status/result aliases：sync lifecycle 使用 `queued / running / succeeded / failed`，results 使用 `added / not_matched / failed / removed / skipped`，pagination 使用 `page / limit / total`。
- [ ] 6.3 实现 `ConsoleContactChannelsRepository`，通过 generated clients 完成 collection/read/test/save/delete、Resend mapping，以及 Slack、Feishu/Lark、DingTalk、Microsoft Teams、WeCom 的 provider-specific candidate/view mapping、complete CAS 与 safe summaries；Slack form 必须完整映射其 preserve directives，其他 provider 必须遵循各自 canonical secret replacement contract。
- [ ] 6.4 实现 `ConsoleContactImSyncRepository`，完成 create-or-get、latest run、required-bucket latest results 与稳定 empty/error translation。
- [ ] 6.5 实现 `ConsoleContactImBindingRepository`，复用 generated Contact options/detail、IM identity search、Organization binding create/delete 与 workspace override set/reset bindings；禁止自由文本 IM user ID。
- [ ] 6.6 在 account-settings composition root 注入 production repositories；mock providers 仅保留给 tests、Stories 与显式 development fixtures，production page 不得实例化 in-memory repository。
- [ ] 6.7 Cloud Slack new-connect 在 `implement-saas-slack-oauth` 提供 server-owned `auth_mode`、availability 与 lifecycle 前保持关闭；Community / CE 当前全部 self-managed IM provider 与 Resend 不依赖该 OAuth change。

## 7. Production 配置与关联 UI

- [ ] 7.1 将 Channels 页面接到 authoritative server views，完成 Resend 以及 Slack、Feishu/Lark、DingTalk、Microsoft Teams、WeCom 的 configure、test、replace、delete、stale-CAS recovery 与 safe error states；mutation 后必须 refetch server state，不得从 submitted candidate 推断 persisted status。
- [ ] 7.2 将 manual sync UI 改为 latest-only：只轮询 `queued/running`，终态停止；ambiguous create failure 先 refetch latest；details 只读取一个 required bucket，并正确展示 added、not_matched、failed、removed、skipped。
- [ ] 7.3 在 Contacts configuration surface 增加 Contact 与 synchronized IM Identity 的 searchable selector；手动关联必须调用 Organization binding API，支持查看/删除当前 binding，并在成功后精准刷新 Contact detail、identity occupancy 与相关 sync caches。
- [ ] 7.4 增加 workspace override 设置/替换/重置 UI，明确展示 Organization binding、workspace override 与 effective binding 的 scope；reset 后必须恢复 Organization binding，不得删除底层 Organization binding。
- [ ] 7.5 保持 sync details 本身只读；`not_matched` 可以导航到独立 manual binding flow，但不得在 result row 内隐式创建 External Contact、猜测 Contact 或自动提交 binding。
- [ ] 7.6 为 permission、not configured、not connected、not allowed、dispatch unavailable、identity/contact not found、binding conflict、invalid scope 与 page-load failure 提供不同的安全状态，并保留最后一次可信 summary/detail。
- [ ] 7.7 更新 `en-US` 与 `zh-Hans` Contacts copy，并添加 accessibility、focus restoration、duplicate-submit prevention、secret/PII redaction 与 query-cache isolation tests。

## 8. End-To-End Verification 与 Rollout

- [ ] 8.1 添加 PostgreSQL/Redis container integration，覆盖版本升级执行`flask data-migrate human-input-contacts --apply`及其幂等重跑、当前全部 IM provider 的 authenticated save/test 与 injected complete-directory adapter、manual sync不执行Contact mutation、durable sync dispatch、worker reconciliation/terminal persistence、normalized Email自动binding、latest/results queries、manual rebind、workspace override/reset与Resend configuration persistence；ongoing Contact lifecycle集成由`implement-contact-projection-lifecycle-maintenance`验证。
- [ ] 8.2 添加 controlled-backend browser scenarios，覆盖真实 Channels load、Resend 以及当前全部 IM provider configuration、manual sync queued/running/terminal、result diagnosis、Contact/identity selection、manual binding 与 override；所有请求必须经过 generated clients。
- [ ] 8.3 运行 focused backend unit suites、frontend Vitest/React Testing Library、generated-contract checks、scoped lint/type checks 与 formatter；本 change 新增/修改 production modules 的 aggregate unit line coverage 至少 85%，CI-owned backend integration line coverage 至少 80%。
- [ ] 8.4 基于现有 `IMProviderAdapter` 为每类当前 IM provider 增加 adapter construction/directory contract coverage，并维护可选 staging smoke checklist：provider-specific required scopes、credential rotation、multi-page directory、automatic binding、manual correction、override/reset 与 credential-free diagnostics；真实凭据缺失时 smoke 必须安全跳过，不能替代受控端到端测试。若确需调整 credential structure，必须补充证明必要性的 red test、encryption round-trip 与 unaffected-provider regression。
- [ ] 8.5 审计最终 diff：production composition 不得调用 mock；Contact initialization不得复制到IM code，ongoing lifecycle不得在本change实现；Workspace controller不得拥有provider/repository/task orchestration；所有可由EE复用的credential、sync与binding逻辑必须位于共享Dify application service；所有 provider directory sync 必须复用现有 `IMProviderAdapter`/factory/read-directory path，且不得新增平行 directory adapter/client/pagination/normalization/error translation；credential structures 无证明必要性不得调整；default workers必须消费dedicated queue；sync不得新增history semantics；前端、API、logs、metrics、trace与query cache不得出现credentials、masked placeholders、raw provider errors或internal infrastructure details。
- [ ] 8.6 将dry-run JSONL Plan review与`flask data-migrate human-input-contacts --apply`的committed-change JSONL复核纳入版本升级runbook；仅在命令成功且`implement-contact-projection-lifecycle-maintenance`完成后，才在Community / CE rollout gate下启用Resend与当前完整 IM provider set并观察queue age、run duration、directory size、result counts与binding conflicts；SaaS Slack OAuth rollout继续由其独立change控制，EE不进入本change的发布矩阵。
