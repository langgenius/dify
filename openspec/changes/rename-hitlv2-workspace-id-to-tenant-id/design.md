## Context

HITLv2 当前跨三套命名层次表达同一个 Dify owner：领域层定义 `WorkspaceId` 并在 `FormRef`、Contact owner、`IMIntegration`、Email configuration、delivery request 和管理上下文中暴露 `workspace_id`；repository mapper 再把它转换为 ORM 已有的 `tenant_id`；JSON shape 和异步参数也沿用了 `workspace_id`。这与后端以 `Tenant.id` / `tenant_id` 作为隔离键的通用约定不一致。

与此同时，HITLv2 的 IM scope 还包含共享 IM Provider namespace 和具体 IM Provider adapter。共享契约使用 `provider_tenant_id`，Microsoft Teams 等 adapter 的 credential/payload 则可能遵循 provider 原生字段 `tenant_id`。本次重命名必须只处理 Dify owner，不能改写、合并或重解释这些 IM-scoped identifier、contract 或 adapter 行为。

当前尚无需要保留的 HITLv2 持久化记录或异步队列消息，因此可以一次性修改 model 与 JSON shape，无需 legacy reader、field alias、schema version 并存或数据迁移。

## Goals / Non-Goals

**Goals:**

- 将 HITLv2 内部 Dify owner 的类型统一为 `TenantId`，普通 owner 属性统一为 `tenant_id`，`WorkspaceScope` 的 scope identifier 使用 `id`。
- 让领域、port、repository、service 和 ORM mapper 在同一所有权概念上使用相同名称。
- 直接将 HITLv2 JSON shape 和异步任务参数中的 Dify owner 改为 `tenant_id`，且只支持新名称。
- 维持现有 owner scope 校验、完整 tenant predicate 和跨 tenant 拒绝行为。

**Non-Goals:**

- 不把产品层 `Workspace`、`WorkspaceScope` 或 workspace URL/权限语义改名为 tenant。
- 不全局重命名 HITLv2 之外的 `workspace_id`，也不改变既有对外 HTTP API。
- 除明确表示 Dify owner 的字段外，不修改 IM scope 内的共享 IM Provider namespace、IM Provider adapter、identifier、credential/payload schema 或其他 provider contract。
- 不修改表名、列名、索引或外键，不执行数据回填。

## Decisions

### 1. 以 `TenantId` 表示 owner 类型，并按模型职责命名属性

在 shared values 中用 `TenantId = NewType("TenantId", str)` 替换 `WorkspaceId`。拥有或传递 Dify `Tenant.id` 的普通 HITLv2 dataclass、Pydantic model、port 参数、repository 参数和 service 内部契约改用 `TenantId` / `tenant_id`；`WorkspaceId` 不保留兼容 alias，以便类型检查和搜索能够暴露漏改调用方。

`WorkspaceScope` 保留类名和 `kind = "workspace"` 语义，因为它表达的是相对于 deployment scope 的产品边界，而不是数据库实体名。作为 scope value object，它使用 `id: TenantId`，且 class docstring 必须明确该 `id` 对应 Dify `Tenant.id`：

```python
@dataclass(frozen=True, slots=True)
class WorkspaceScope:
    """Workspace scope whose id is the corresponding Dify Tenant.id."""

    id: TenantId
```

相比 `tenant_id`，`id` 避免在已经由 `WorkspaceScope` 限定语义后重复 owner 类型；相比把类改为 `TenantScope`，它也避免把实现层术语泄漏到 Contact Directory 的产品语义中。

### 2. 在组合边界完成外部 workspace 术语到内部 tenant 术语的转换

若 controller、URL builder 或非 HITLv2 既有接口仍提供 `workspace_id`，composition layer 必须在进入 HITLv2 model 前构造 `TenantId`，此后普通调用链只传递 `tenant_id`；需要 workspace-relative scope 时构造 `WorkspaceScope(id=tenant_id)`。Repository mapper 将普通领域 `tenant_id` 或 `WorkspaceScope.id` 映射到 ORM `tenant_id`，不再通过局部 `workspace_id` 变量二次翻译。

共享 IM Provider namespace 的 owner 必须继续命名为 `provider_tenant_id`；IM Provider adapter 的原生 payload 或 credential 中不可控的 `tenant_id` 保留在 adapter 边界。除明确表示 Dify `Tenant.id` 的 owner 字段外，IM scope 内的 identifier、contract 和 adapter 行为均保持不变。相比一次全仓重命名，该边界化方案缩小了改动面，也保留现有 IM contract。

### 3. JSON shape 和异步参数直接采用 `tenant_id`

`EmailOTPAuthorizationProof` 的 Python 与 JSON 字段直接改为 `tenant_id`，不配置 `workspace_id` validation alias。Structured JSON 的 `extra="forbid"` 继续确保旧 owner key 被拒绝。

Rendered Email request 保持现有 `schema_version`，只将 owner key 改为 `tenant_id`；serializer 和 deserializer 同步切换，不增加旧格式分支或新旧版本协商。其他 HITLv2 primitive 和异步任务参数同样直接重命名。`WorkspaceScope.to_primitive()` 作为明确例外保留 `kind = "workspace"`，并使用 `id` 表示对应的 Dify `Tenant.id`。

### 4. 以 owner 不变量而不是文本替换作为完成标准

实现必须更新构造、比较、加密 key 选择、查询 predicate、日志和测试。所有跨层 owner 比较仍使用同一个 `TenantId`，repository 查询继续将完整 owner chain 约束到 ORM `tenant_id`。静态搜索用于发现残留，但必须为共享 IM Provider namespace、IM Provider adapter 及明确的非 HITLv2 boundary 建立语义化 allowlist，避免机械替换破坏 IM-scoped identifier、contract 或第三方协议。

## Risks / Trade-offs

- [机械替换误伤 IM scope] → 除明确表示 Dify owner 的字段外，将共享 IM Provider namespace、IM Provider adapter 及其 identifier/contract 列为显式非目标，并为 IM identity、binding 和 adapter mapping 保留针对性测试。
- [字段漏改导致内部调用失败] → 通过类型检查、目标测试和限定范围残留搜索确保 model、serializer、deserializer 与调用方一次性切换。

## Migration Plan

无需数据或兼容迁移。实现以一个原子 change 完成：

1. 一次性重命名 Python 领域类型、字段、JSON shape、异步参数和所有调用方，并更新 repository/service mapper。
2. 更新测试，使 `tenant_id` 成为唯一合法名称并明确拒绝 `workspace_id`。
3. 运行 HITLv2 目标单元测试、lint 和 type check，并通过限定范围的残留搜索审计遗漏与 allowlist。
4. 若需要回退，直接回退整个代码 change；不存在需要转换或保留的 HITLv2 数据与队列状态。

## Observability Impact

HITLv2 submission failure/retry 日志中的 Dify owner label 从 `workspace_id` 改为 `tenant_id`；依赖旧 label 的日志查询、告警与 dashboard 需要同步更新。IM Provider 边界的 `provider_tenant_id` label 保持不变，provider-native `tenant_id` 也不纳入该 label 重命名。

## CI Verification

Docker-backed transaction/isolation 验证仍由 CI 负责。相关范围包括 `api/tests/integration_tests/repositories/human_input_v2/` 下的四个 repository concurrency 模块、`api/tests/test_containers_integration_tests/repositories/human_input_v2/` 下的 Contact Directory 与 Email repository PostgreSQL contract，以及 `api/tests/test_containers_integration_tests/services/human_input_v2/` 下的 IM contact-sync/control-plane contract。

## Open Questions

无。
