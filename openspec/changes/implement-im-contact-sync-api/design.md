## Context

仓库已经具备 Sync 的核心状态与持久化语义：

- `IMIntegration` 与 complete revision token；
- `SyncReconciler`、`ProviderDirectoryEntry` 与 revision-guarded apply；
- single-active-run、latest-only result persistence；
- Contact Directory、IM identity/binding、workspace override 与 effective-binding resolution；
- workspace-scoped Human Input routes 和共享 DTO 骨架。

`implement-human-input-v2-im-provider-foundation` 另行拥有 Integration management、credential encryption/rotation、provider tenant confirmation、provider-local SDK client construction、safe diagnostics 与 `WEBHOOK / STREAM` event transport。Sync 只消费 current Integration/client boundary，不能重新实现这些职责。

本 change 的真正缺口是：没有 Sync-owned directory port 与 provider normalization，没有一个 application service 把 manual run、directory fetch、reconciliation 和 apply 串起来，也没有把 synced identities 稳定接回 Contact binding 管理入口。

```text
Workspace / Trusted Internal API adapters
        (`human-input-v2-api-contracts`)
                  |
                  v
             IMSyncService
                  |
       +----------+-----------+
       |                      |
       v                      v
IMDirectoryReader       SyncReconciler
       |                      |
       v                      v
Provider Foundation     IMControlPlaneRepository
client lifecycle        + ContactDirectoryRepository
```

## Goals / Non-Goals

**Goals:**

- 落地 provider-agnostic manual sync trigger、latest run 与 latest-result application boundary。
- 由 `IMDirectoryReader` 抹平 Feishu、Lark 与 DingTalk directory response 差异，并只输出 `ProviderDirectoryEntry`。
- 复用 Foundation 的 current Integration/client/credential lifecycle，不复制 provider initialization。
- 复用现有 reconciliation、run/result repository 和 Contact binding resolution。
- 保持 Dify single-owner，EE 只做 façade/client/DTO mapping。

**Non-Goals:**

- 不读取、配置、删除或测试 Integration；这些 operations 的 application logic 属于 Foundation，workspace/internal HTTP API 属于 `human-input-v2-api-contracts`。
- 不持久化或解密 provider credential，不确认 provider tenant，不创建 SDK client factory。
- 不实现 webhook verification、stream runtime、directory event subscription 或自动/定时 sync。
- 不实现 card render/send/update/fallback、card action normalization 或 HITL submission。
- 不新增 provider-specific controller/DTO/route，不重写现有 sync result schema。
- 不把前端 mock repository 切换到真实 API。
- 不拥有 Pydantic DTO、workspace Flask handler、trusted internal HTTP controller、authentication/scope/operation-metadata mapping、HTTP response/error mapping、controller tests 或 IM 501 replacement；这些 transport concerns 全部由 `human-input-v2-api-contracts` 独占。

## Decisions

### 1. Sync 只拥有 run、result、identity 与 binding application boundary

本 change 只提供 manual sync trigger、latest summary/result query、identity search、binding 和 override 的 transport-neutral command/query、service factory 与 composition entry point。`human-input-v2-api-contracts` 独占 workspace 与 trusted internal HTTP contract、handler、DTO、auth/scope/metadata mapping、HTTP error mapping 和 controller tests。

Integration read/configure/delete/test 的 application logic 由 Foundation 的 `IMIntegrationManagementService` 实现，不进入 `IMSyncService`；其 workspace/internal HTTP adapters 同样由 `human-input-v2-api-contracts` 拥有。

两个 API consumers 必须注入同一个 `IMSyncService` 与 `ContactIMBindingService` implementation。Dify application services 不接收 EE-specific HTTP DTO，不执行 caller authentication/actor mapping，也不回调 EE Human Input API。

原因：Integration lifecycle 与 sync run lifecycle 是不同 application boundary。拆开后，Card 与 Sync 可以共享 Integration management，而不互相依赖。

### 2. `IMSyncService` 只编排 manual synchronization

`IMSyncService` 负责：

- 读取 Foundation 提供的 current `IntegrationRevisionToken`；
- 创建或返回 single active run；
- enqueue 只携带 `sync_run_id` 的后台任务；
- 查询 latest run summary 与 canonical result page。

worker 负责：

1. 加载 run 与 captured Integration revision；
2. 通过 `IMDirectoryReader` 拉取并归一化 directory；
3. 加载 reconciliation snapshot；
4. 调用 `SyncReconciler.reconcile(...)`；
5. 通过 revision-guarded repository apply plan；
6. 在 provider failure、stale revision 与 apply failure 路径终结 run 并写入 safe result。

service/worker 不提供 Integration commands，也不测试 candidate credentials。

### 3. Sync 拥有 `IMDirectoryReader` 语义，Foundation 拥有 client lifecycle

Provider-neutral port 只表达目录能力，例如：

- `read_directory(current_integration) -> tuple[ProviderDirectoryEntry, ...]`

Feishu、Lark 与 DingTalk adapter 位于各自 provider package 的 Sync 组合边界中。adapter 使用 Foundation 提供的 provider-local current client lifecycle，负责 pagination、provider user ID/email normalization 与 SDK response/error mapping；它不得解密 credential、确认 tenant 或把 SDK objects 交给 service/core/application consumer。

`test_connection(...)` 与 `resolve_provider_tenant(...)` 不属于 `IMDirectoryReader`：它们是 Foundation Integration management 的 baseline diagnostic 与 tenant confirmation。

原因：directory normalization 是 Sync domain concern，client construction 是跨 Sync/Card/transport 共享的 provider concern。两者分离能避免巨型 provider adapter，也不需要 capability registry。

### 4. Manual sync 保持异步、single-active-run 与 latest-only

manual-sync command 只校验 current Integration revision、创建或复用 active run 并 enqueue worker，不在同步 application call 内拉取完整目录。

每个 run 捕获完整 `integration_id + config_version`。apply 前必须重新检查 current revision；Integration replacement、credential rotation 或 event transport configuration change 使捕获 revision 过期时，run 必须终止且不得修改 current identities/bindings。

latest query boundary 不扩展成 run-by-ID 或 history semantics。

### 5. Canonical result taxonomy 保持五类

持久化与 application read model 继续使用：

- `added`
- `not_matched`
- `failed`
- `removed`
- `skipped`

`matched / created_binding / updated_binding` 仍是可选 presentation metadata，不替代 persisted buckets；latest-results query 必须显式选择一个 canonical bucket。

原因：core enum、repository 与现有 API contract 已采用这五类，UI taxonomy 不应反向修改 sync persistence。

### 6. Contact 接入只走 identity/binding/override 入口

`ContactIMBindingService` 负责：

- 搜索 synced identities；
- 为 current `WORKSPACE` 或 `PLATFORM` Contact 创建/删除 organization binding；
- 为支持 workspace-local override 的 edition 设置/清除 override；
- 复用 `workspace override > organization binding > Email fallback` resolver。

Unmatched directory entry 只保留为 read-only sync result，不自动创建 `External contact` 或 binding。`EXTERNAL`、`ABSENT`、hard-deleted 或 unavailable Contact 不能通过 binding 写路径被创建/恢复。

### 7. Directory event transport 是未来依赖，不与 manual sync 绑定

本 change 不注册 directory event sink，也不引入自动 sync policy。未来需要联系人自动同步时，Foundation 可以把 authenticated directory-change envelope 交给 Sync-owned sink；该 sink 决定 debounce、coalescing、scope 与是否创建 run，复用本 change 的 `IMSyncService`，Foundation 不直接触发 reconciliation。

## Risks / Trade-offs

- [Foundation 尚未就绪导致 Sync 重复 client glue] -> 把 Foundation 标为前置依赖；Sync adapter 只接受 provider-local client lifecycle，不临时解密 credential。
- [Provider directory pagination/field差异泄漏] -> 每个 `IMDirectoryReader` adapter 负责完整 pagination 与 normalization，并运行共享 contract suite。
- [后台 worker failure 使 run 卡死] -> 所有 provider fetch、stale revision、reconcile/apply failure 都必须显式终结 run并保留 safe diagnostics。
- [Integration revision 因 transport config 变化而使 run stale] -> 保持 complete CAS 语义，宁可重新触发 manual sync，也不把旧 credential/config 结果应用到 current state。
- [Binding 写路径误接入 unavailable Contact] -> 在单一 `ContactIMBindingService` 中做 resolution/type gate，并覆盖 repository-level tests。
- [未来自动 sync 反向污染 Foundation] -> event transport 只交付 authenticated facts；schedule policy 和 reconciliation 始终留在 Sync。

## Migration Plan

1. 先部署 Foundation 的 current Integration/client boundary，并保持 event transport `DISABLED`。
2. 落地 `IMDirectoryReader` contract 与 Feishu/Lark/DingTalk directory adapters。
3. 落地 `IMSyncService`、worker 与 manual sync/latest-only transport-neutral composition boundary。
4. 落地 identity search、binding 与 workspace override application operations，并提供 API-consumer fixtures。
5. 切除 Sync 中旧的 Integration CRUD/test、credential/client construction wiring。
6. 运行 provider contract、service、repository 与 concurrency tests 后，将稳定 boundary 交给 `human-input-v2-api-contracts` 进行 handler/controller 验证。

Rollback 只停用 manual sync worker/composition entry point；Foundation Integration 与 Card outbound 能力不受影响。

## Open Questions

- None blocking.
