## Context

当前仓库已经具备实现 IM 联系人同步的大部分“下半身”能力：

- `api/controllers/console/workspace/human_input.py` 已经定义了统一的 workspace-scoped Human Input 管理路由，但仍全部是 stub。
- `api/controllers/common/human_input_v2_contracts.py` 已经定义了 integration、manual sync、latest-only result、IM identity search、binding 和 override 的 DTO。
- `api/core/human_input_v2/im_integration/*` 已经提供了 `IMIntegration`、`SyncReconciler`、`ProviderDirectoryEntry`、`IMControlPlaneRepository` 等纯领域与持久化边界。
- `api/repositories/human_input_v2/im_integration/repository.py` 已经实现了 CAS、single active run、revision-guarded apply 和 append-only sync result persistence。
- `api/repositories/human_input_v2/contact_directory/repository.py` 已经实现了 Contact Directory 的 snapshot / lifecycle / owner-bound mutation。

当前缺失的是“上半身”：

- 没有一个统一的 application service 去编排 provider directory 拉取、provider-neutral 归一化、reconciliation plan 生成和 apply。
- 没有一个真实的 provider adapter 边界，Feishu / Lark 的接入方式还未落地。
- 没有把同步结果稳定地接回现有 `im-identities` / `im-bindings` / `im-override` / `binding_resolution` 入口。

另外，仓库里存在两套需要显式收敛的约束：

- 当前后端 domain / DTO / 进行中的 `human-input-v2-api-contracts` change 使用 `added / not_matched / failed / removed / skipped` 作为 sync result bucket。
- 现有前端 mock / UI spec 曾用过 `matched / created_binding / updated_binding / unmatched / skipped / failed` 的展示分类。

本 change 需要先在设计上拍板哪一套是后端 canonical contract，再进入实现。

## Goals / Non-Goals

**Goals:**

- 在现有 `/console/api/workspaces/current/human-input` 路由下落地统一的 IM integration / manual sync / latest-only result / identity search / binding / override API。
- 为 Feishu / Lark 建立统一的 provider adapter 契约，让厂商差异只停留在 adapter 层，controller、service、domain 和 repository 完全不感知 provider 特例。
- 复用现有 `SyncReconciler`、`IMControlPlaneRepository`、`ContactDirectoryRepository` 和 binding resolution 代码路径，避免新增平行领域模型或平行 API。
- 优先通过厂商官方 SDK 完成 provider 接入，最小化手写 HTTP glue。
- 将实现范围控制在后端真实化，不把前端 mock repository 切换到真实 API 强行并入同一 change。

**Non-Goals:**

- 不新增按厂商区分的控制器、DTO 或 `/feishu/*`、`/lark/*` 风格专属 API。
- 不重写现有 `human_input_v2` core domain、sync repository 或 contact directory repository。
- 不在本 change 中实现 unmatched 人工映射 UI、前端真实 repository adapter 或新的管理页面。
- 不引入自动定时 sync；仍然只支持管理员手动触发。
- 不为了适配 UI mock taxonomy 而改写现有持久化模型和历史 sync result schema。

## Decisions

### 1. 继续复用现有 workspace console surface，而不是再造一套 provider-specific API

实现继续挂载在现有 stub 路由之下：

- `GET/PUT/DELETE /console/api/workspaces/current/human-input/im-integration`
- `POST /console/api/workspaces/current/human-input/im-integration/test`
- `POST /console/api/workspaces/current/human-input/im-sync-runs`
- `GET /console/api/workspaces/current/human-input/im-sync-runs/latest`
- `GET /console/api/workspaces/current/human-input/im-sync-runs/latest/results`
- `GET /console/api/workspaces/current/human-input/im-identities`
- `PUT/DELETE /console/api/workspaces/current/human-input/contacts/<contact_id>/im-override`
- `PUT/DELETE /console/api/workspaces/current/human-input/contacts/<contact_id>/im-bindings`

原因：

- 这组 DTO 和路由已经与当前 repo 内的 PRD / OpenSpec 收敛方向一致。
- 统一 API 更容易复用 `SyncReconciler` 和现有 repository；如果按厂商拆 route，最终只会把厂商差异泄漏到 transport 层。
- 当前用户要求明确禁止为各家实现独立 API。

放弃方案：

- 为 Feishu 和 Lark 分别暴露 `POST /.../feishu/sync`、`POST /.../lark/sync` 等 API。
  原因：违反统一 API 要求，且会把 provider capability / credential shape / error model 泄漏进 controller contract。

### 2. 新增薄 application service，统一编排 integration、sync 和 contact binding

实现引入两类应用服务，而不是把 orchestration 塞进 controller 或 repository：

- `IMSyncManagementService`
  - 读取 / 更新 / 删除 integration
  - 测试 provider connectivity
  - 创建 sync run
  - 触发后台 sync worker
  - 读取 latest run summary / result page
- `ContactIMBindingService`
  - 搜索 synced IM identities
  - 为 Contact 创建 / 删除 organization binding
  - 为 EE Contact 设置 / 清除 workspace override
  - 组装 controller 返回所需的 `HumanInputContact` projection

原因：

- repo 目前已经是 transaction-oriented port；再让 controller 直接调用多个 repo / core object，会把 HTTP concern 和事务编排糊在一起。
- 现有 `services/human_input_v2/submission.py` 已经建立了 Human Input v2 application service 的仓库边界模式，本 change 应复用同类结构。

放弃方案：

- 直接在 controller 中写 provider 调用、snapshot load、reconcile、apply。
  原因：会破坏 controller → service → core/domain 的层次，也不利于测试和重试策略。

### 3. Provider 适配器统一输出 `ProviderDirectoryEntry`，Feishu / Lark 差异只停留在 adapter 内

新增 provider-neutral 端口，例如：

- `ProviderDirectoryClient`
  - `test_connection(...) -> ProviderConnectionDiagnostic`
  - `list_directory_entries(...) -> tuple[ProviderDirectoryEntry, ...]`
  - `resolve_provider_tenant(...) -> ProviderTenantIdentity`

Feishu / Lark 采用同一 SDK 家族的 adapter 实现。根据 2026-07-26 核验的官方文档：

- Feishu 官方文档提供服务端 Python SDK 示例，并在 API 调试台展示 Python SDK 示例代码。
- Lark 官方“服务端 SDK”文档明确提供 Python SDK，安装方式为 `pip install lark-oapi -U`。
- Lark / Feishu 的 Contact API 页面都提供 Python SDK 示例，说明目录读取能力可通过统一 SDK 家族接入。

来源：

- Feishu 开发工具概述与服务端 API 文档：https://open.feishu.cn/document/tools-and-sdks/developer-tools-portal
- Feishu Contact API 示例页：https://open.feishu.cn/document/server-docs/contact-v3/user/get?lang=zh-CN
- Lark 服务端 SDK 文档：https://open.larksuite.com/document/ukTMukTMukTM/uETO1YjLxkTN24SM5UjN?lang=en-US

设计决策：

- 优先接入官方 `lark-oapi` Python SDK。
- Adapter 负责把 SDK response 规整为 `ProviderDirectoryEntry`，并裁掉 SDK/raw payload 中不应进入 API surface 的字段。
- 如果某个能力在 SDK 中缺失，再在 adapter 内用最薄的 `httpx` 补洞，但不得把 hand-written HTTP client 暴露到 service / controller 层。

放弃方案：

- 不经 adapter，直接在 service 里写 Feishu / Lark HTTP 调用。
  原因：厂商差异会渗透进应用层，后续再接 Slack / DingTalk 时代价会线性放大。

### 4. Sync 继续采用“手动触发 + 后台异步执行 + latest-only 读取”模型

`POST /im-sync-runs` 的职责是：

1. 校验当前 integration 已配置且 revision 有效。
2. 通过 `IMControlPlaneRepository.create_or_get_active_run(...)` 创建或拿到唯一 active run。
3. 新建成功时，异步 enqueue 一个 worker 任务，仅携带 `sync_run_id`。
4. 立即返回 queued/running 的 run summary，不在 HTTP 请求里同步拉完整目录。

后台 worker 的职责是：

1. 读取 run 和 captured integration revision。
2. 使用 provider adapter 拉目录数据并规整为 `ProviderDirectoryEntry`。
3. 调用 `load_reconciliation_snapshot` 读取当前快照。
4. 调用 `SyncReconciler.reconcile(...)` 生成 plan。
5. 调用 `apply_reconciliation(...)` 按 revision-guarded 方式落 current state。

原因：

- 现有模型已经有 `QUEUED/RUNNING/SUCCEEDED/FAILED` 状态和 single-active-run 语义，天然适合后台执行。
- 通讯录同步在真实租户中可能很慢，不应该绑在 console request 生命周期里。
- latest-only 读取模式已经在当前 API contract change 中固定，避免引入不必要的 run history API。

放弃方案：

- 在 `POST /im-sync-runs` 中同步执行 provider 拉取与 apply。
  原因：阻塞长请求，且无法复用现有 active-run / retry / stale-revision 机制。

### 5. 后端 canonical sync result taxonomy 维持 `added/not_matched/failed/removed/skipped`

本 change 明确选择后端 canonical bucket 保持为：

- `added`
- `not_matched`
- `failed`
- `removed`
- `skipped`

不在本次实现中引入 `matched / created_binding / updated_binding` 作为持久化或 API bucket。

原因：

- 当前 core enum `IMSyncResultType`、controller DTO、repository tests 和进行中的 `human-input-v2-api-contracts` change 已经统一使用这五类 bucket。
- 如果现在把后端持久化 bucket 改成 UI mock taxonomy，会牵动 domain enum、result persistence、controller DTO、existing tests 和 pending spec，blast radius 过大。
- `created_binding` / `updated_binding` 更接近 presentation concern，可以在未来真实前端 adapter 中由 `added` 结果配合额外字段衍生，而不是现在重写 core contract。

配套策略：

- latest results API 继续只接受真实 bucket，不支持 `all`。
- 如果未来前端需要 finer-grained taxonomy，应新增可选 display metadata，而不是改写 persisted bucket。

### 6. Contact 接入只走现有 identity/binding/override 入口，不自动创建 Contact

同步结果接入 Contact 的方式明确为：

- `GET /im-identities`：搜索已同步 identity，支持 display name / email / provider user ID。
- `PUT /contacts/<contact_id>/im-bindings`：为 current workspace 可解析的非-External contact 创建或替换 organization binding。
- `DELETE /contacts/<contact_id>/im-bindings`：解除指定 binding。
- `PUT /DELETE /contacts/<contact_id>/im-override`：仅在 EE 中设置 / 清除 workspace override。

边界规则：

- unmatched provider entry 只保留为 sync result，绝不自动创建 `External contact`。
- `External contact` 不允许创建 IM binding；其 `im_bindings` 继续保持为空。
- binding / override 写入前必须复用 Contact Directory resolution，`ABSENT` 或 hard-deleted contact 直接拒绝。
- override 和 organization binding 是两条不同写路径；reset override 只能回退到 global binding，不能复制 binding 到 workspace scope。

原因：

- 这完全符合 PRD 对 unmatched list、external contact email-only 和 workspace override 语义的约束。
- 现有 binding resolution 已经具备 `workspace override > organization binding > Email fallback` 的优先级语义，无需再建平行模型。

### 7. 尽量避免 schema 变化，优先复用现有表与 DTO

本 change 目标是不新增核心表，不重塑现有 current-state schema。优先复用：

- `HumanInputIMIntegration`
- `HumanInputIMIdentity`
- `HumanInputIMBinding`
- `HumanInputIMSyncRun`
- `HumanInputIMSyncResult`
- `HumanInputContact`

只有在实现时发现当前 `HumanInputIMSyncResult` 无法承载必要的安全展示字段时，才允许补充最小 schema 变更；默认预期是现有模型已足够。

原因：

- contact directory / im control plane 的 schema 刚在 2026-07-24 到 2026-07-25 附近完成设计和落地，当前更重要的是把应用层打通，而不是再次动底层表结构。

## Risks / Trade-offs

- [Provider SDK 与现有依赖未集成] -> 先在 `api/pyproject.toml` 中最小增量接入官方 SDK，并把 SDK 使用限制隔离在 adapter；如果 SDK 某个接口不可用，再在 adapter 内局部回退到 `httpx`。
- [UI mock taxonomy 与后端 canonical bucket 不一致] -> 本 change 明确以后端五类 bucket 为准，并在 design/spec 记录该裁决；前端真实 adapter 未来做展示映射，不反向污染 core contract。
- [后台 sync worker 失败导致 run 卡死] -> worker 必须在 provider fetch failure、stale revision 和 apply failure 路径都显式结束 run，并写入安全 error/result fact。
- [Binding 写路径误接入 External/ABSENT Contact] -> `ContactIMBindingService` 必须在写前统一做 workspace resolution 和 contact type gate，拒绝不合规主体。
- [实现范围膨胀到前端替换] -> tasks 明确把真实前端 repository adapter 排除在本 change 外，避免跨端大改影响收敛。
- [高覆盖率目标导致回归成本升高] -> 以 service / controller / repository 分层测试为主，优先补高价值失败路径和并发路径，避免把覆盖率建立在低价值 snapshot test 上。

## Migration Plan

1. 先落地 OpenSpec planning artifacts，并提交 planning change。
2. 为 provider adapter 引入 SDK 依赖和最小配置装配。
3. 落地 application service 与 Celery/worker task，打通 manual sync。
4. 落地 controller stub、identity search、binding / override 写路径。
5. 补齐 unit / integration / controller tests，并以 targeted test commands 验证高风险路径。
6. 代码收敛后归档 change，并提交 archive。

## Open Questions

- None blocking.
- 如果实现阶段确认现有 `IMSyncResult` DTO 无法满足后续真实前端展示，需要在不改变 canonical bucket 的前提下补充 display metadata；这不阻塞本 change 启动。
