## Why

IM Contact reconciliation、Workspace Console API 和 Contacts Channels UI 已分别存在，但当前生产页面仍固定使用内存 mock，默认 worker 也不消费同步队列，且 rollout 尚未将已有 Account/member 一次性导入 `HumanInputContact` projection。因此管理员无法从浏览器完成“连接 IM channel、手动同步、观察终态、查看真实对账结果”的闭环，provider Email matching 也没有可供首次发布消费的 Contact 基线。

## What Changes

- 将非 Enterprise Contacts Channels 的生产 composition 从内存 mock 切换到 generated `consoleClient` / `consoleQuery` adapter；mock repository 仅保留给测试、Story 或显式开发 fixture。
- 扩展 canonical Channels API，使 Resend 以及当前全部五类 IM provider（Slack、Feishu/Lark、DingTalk、Microsoft Teams、WeCom）都具备读取、测试、保存和删除能力；所有 persisted `connected` 的 IM channel 统一进入 manual directory sync 生产链路。
- 所有 IM directory synchronization 必须复用现有 provider-specific `IMProviderAdapter`、`DifyIMProviderAdapterFactory` 与 `adapter.directory.read_directory()` 路径；本 change 不得新增平行的 directory adapter、provider directory HTTP client、分页/标准化实现或 management-owned directory read。现有 credential structures 默认保持不变，只有测试证明既有 adapter 无法由当前结构正确构造或执行时，才允许做满足该 adapter 的最小调整。
- 将同步 UI 对齐现有 latest-only Console contract：创建或复用 active run、轮询 latest run、停止于终态，并按必选 bucket 使用 `page / limit / total` 读取最新结果。
- **BREAKING（frontend-internal）**：移除 mock-only 的 `matched / created_binding / updated_binding / unmatched` 与 arbitrary run-by-ID/cursor 语义，统一使用后端 `added / not_matched / failed / removed / skipped` taxonomy；`partial success` 只作为基于终态计数派生的展示状态，不进入 transport contract。
- 在 `flask data-migrate` namespace 下新增 `human-input-contacts` 运维命令，作为版本升级步骤为已有 eligible Account/member 幂等创建或复用 source-backed Contact；迁移按小页执行显式 Plan/Apply、使用 JSONL 审计日志，且重复执行不得创建重复 identity。
- Manual IM sync 不创建、更新、删除或补偿 Contact。worker 在 provider directory read 完成后，通过现有 guarded reconciliation input load 读取当前 scope 中仍 available 的 Contact 与 membership facts，再执行 Email matching 和 binding reconciliation。
- 将 IM credential/configuration、manual sync、自动 binding reconciliation、手动 Organization binding 与 workspace override 的业务 command/query 收敛到各自 Dify-owned、transport-neutral application services；Workspace Console controller 与未来 Dify EE inner API adapter 必须复用同一 service/composition，只负责各自入口的鉴权、必要审计、trusted context、DTO mapping 与稳定错误翻译。Contact initialization 只通过版本升级使用的 `flask data-migrate human-input-contacts` 运维入口执行，不暴露为 HTTP/application command。
- 将 `human_input_contact_sync` 纳入默认 Celery worker 队列和自定义队列文档，并增加从 HTTP trigger 到 worker terminal persistence 的配置回归门禁。
- 保持同步详情只读、latest-only 和安全诊断；不为保留当前 mock 深链而新增历史 run API。
- Cloud Slack OAuth lifecycle 继续由 `implement-saas-slack-oauth` 拥有；本 change 提供 provider-neutral production repository 基座和同步接线，OAuth change 必须在同一基座上扩展而不是实现第二套 repository。

## Capabilities

### New Capabilities

- `contact-im-sync-production-integration`: 定义 Contacts Channels 生产数据接入、latest-only 手动同步状态机、canonical result mapping、队列可消费性、错误恢复与端到端验收边界。

### Modified Capabilities

- `contact-directory-governance`: 增加由版本升级流程执行的 `flask data-migrate human-input-contacts` 一次性、幂等 Contact initialization；manual IM sync 只消费 current Contact projection，不承担 initialization 或 repair。
- `human-input-channel-management`: 将 Channels management provider/candidate/handler contract 扩展到当前全部五类 IM provider，并明确 manual directory sync 由 IM channel kind、persisted connection status 与当前权限决定。

## Impact

- Frontend: `web/features/contacts/im-platform/` 的 repository composition、view models、React Query hooks、sync summary/details、URL state、错误映射、i18n 和测试；生产请求只使用 `@/service/client` generated bindings。
- Backend/API: `api/commands/data_migrate.py` 下的 Contact initialization 运维命令及迁移实现、当前全部 IM provider 的 Channel API handlers/candidate contracts、复用现有 `IMProviderAdapter` 的 manual-sync application boundary、OpenAPI/generated contracts，以及现有 latest sync endpoints 的安全映射；不新增 Contact initialization HTTP API、Account/member lifecycle integration、periodic Contact repair、平行 provider directory integration 或历史 run endpoint。
- Runtime: `api/docker/entrypoint.sh`、`docker/.env.example`、worker queue 文档和 queue registration regression tests。
- Verification: 当前全部 IM provider 的 frontend adapter/component tests、backend unit tests、PostgreSQL/Redis container integration、HTTP-to-worker contract coverage，以及按凭据可用性执行的可选真实-provider smoke。
- Dependencies: extends the Contact Directory owner delivered by `human-input-v2-api-contracts`, consumes the sync service/worker delivered by archived `implement-im-contact-sync-api`, and consumes the canonical Channels API delivered by `implement-human-input-channel-management-api`. Ongoing Account/member write-through and periodic repair are owned by `implement-contact-projection-lifecycle-maintenance`; production rollout is blocked until the version upgrade has successfully run `flask data-migrate human-input-contacts --apply` and that lifecycle change is complete. Manual sync is not a fallback projection mechanism. Cloud OAuth and Enterprise management remain outside this change.
