## Why

IM Contact reconciliation、Workspace Console API 和 Contacts Channels UI 已分别存在，但当前生产页面仍固定使用内存 mock，默认 worker 也不消费同步队列，且同步前没有保证当前 Organization Contact projection 已就绪。因此管理员无法从浏览器完成“连接 IM channel、手动同步、观察终态、查看真实对账结果”的闭环。

## What Changes

- 将非 Enterprise Contacts Channels 的生产 composition 从内存 mock 切换到 generated `consoleClient` / `consoleQuery` adapter；mock repository 仅保留给测试、Story 或显式开发 fixture。
- 通过 canonical Channels API 读取、测试、保存和删除当前 channel，并通过 server-declared capabilities 决定是否允许目录同步；首个完整验收 provider 为 self-managed Slack。
- 将同步 UI 对齐现有 latest-only Console contract：创建或复用 active run、轮询 latest run、停止于终态，并按必选 bucket 使用 `page / limit / total` 读取最新结果。
- **BREAKING（frontend-internal）**：移除 mock-only 的 `matched / created_binding / updated_binding / unmatched` 与 arbitrary run-by-ID/cursor 语义，统一使用后端 `added / not_matched / failed / removed / skipped` taxonomy；`partial success` 只作为基于终态计数派生的展示状态，不进入 transport contract。
- 在触发 provider directory read 前调用既有 Contact projection boundary 的 bounded ensure，使当前 scope 的 active Account/member facts 已投影为可匹配的 `HumanInputContact`；不在同步 planner 或 IM repository 中复制 Contact 生命周期逻辑。
- 将 `human_input_contact_sync` 纳入默认 Celery worker 队列和自定义队列文档，并增加从 HTTP trigger 到 worker terminal persistence 的配置回归门禁。
- 保持同步详情只读、latest-only 和安全诊断；不为保留当前 mock 深链而新增历史 run API。
- Cloud Slack OAuth lifecycle 继续由 `implement-saas-slack-oauth` 拥有；本 change 提供 provider-neutral production repository 基座和同步接线，OAuth change 必须在同一基座上扩展而不是实现第二套 repository。

## Capabilities

### New Capabilities

- `contact-im-sync-production-integration`: 定义 Contacts Channels 生产数据接入、latest-only 手动同步状态机、canonical result mapping、队列可消费性、错误恢复与端到端验收边界。

### Modified Capabilities

- `contact-directory-governance`: 明确 manual IM sync 前必须 bounded-ensure 当前 Organization Contact projection，并以该一致 scope snapshot 参与 Email matching。
- `human-input-channel-management`: 为 channel safe view 增加 server-declared directory-sync eligibility，使客户端不得根据 provider 名称或 mock definition 猜测同步能力。

## Impact

- Frontend: `web/features/contacts/im-platform/` 的 repository composition、view models、React Query hooks、sync summary/details、URL state、错误映射、i18n 和测试；生产请求只使用 `@/service/client` generated bindings。
- Backend/API: Human Input Channels capability projection、sync trigger composition 中的 Contact projection ensure、OpenAPI/generated contracts，以及现有 latest sync endpoints 的安全映射；不新增历史 run endpoint。
- Runtime: `api/docker/entrypoint.sh`、`docker/.env.example`、worker queue 文档和 queue registration regression tests。
- Verification: frontend adapter/component tests、backend unit tests、PostgreSQL/Redis container integration、HTTP-to-worker contract coverage，以及可选真实 Slack smoke。
- Dependencies: consumes the Contact projection service owned by `human-input-v2-api-contracts`, the sync service/worker delivered by archived `implement-im-contact-sync-api`, and the canonical Channels API delivered by `implement-human-input-channel-management-api`. Cloud OAuth and Enterprise management remain outside this change.
