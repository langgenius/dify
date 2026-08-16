## ADDED Requirements

### Requirement: HITLv2 MUST use canonical tenant owner terminology
HITLv2 拥有或传递 Dify `Tenant.id` 的领域值、普通 model 属性、port、repository 和 service 内部契约 MUST 使用 `TenantId` / `tenant_id`。`WorkspaceId` / `workspace_id` MUST NOT 继续作为该内部 owner 的兼容名称。表示产品 workspace scope 的类型 MAY 保留 `WorkspaceScope` 名称和 `kind = "workspace"`；该 scope MUST 使用 `id: TenantId`，并明确说明 `id` 对应 Dify `Tenant.id`。

#### Scenario: Tenant-owned model is constructed
- **WHEN** 使用 Dify `Tenant.id` 构造 `FormRef`、workspace-owned Contact owner、`EmailChannelConfiguration`、tenant-owned `IMIntegration` 或 `RenderedEmailDeliveryRequest`
- **THEN** 该 model MUST 将 owner 暴露为 `tenant_id: TenantId`
- **AND** 该 model MUST NOT 暴露 `WorkspaceId` 或 `workspace_id`

#### Scenario: Workspace scope is represented
- **WHEN** Contact Directory 使用 workspace-relative scope
- **THEN** scope MUST 保留 workspace 产品语义，通过 `id: TenantId` 携带对应的 Dify `Tenant.id`，并在类型文档中明确该映射

### Requirement: HITLv2 MUST translate ownership only at explicit boundaries
HITLv2 composition layer MUST 在仍使用 workspace 产品术语的既有外部契约与内部 `TenantId` 之间完成转换。进入 HITLv2 内部调用链后，repository mapper MUST 将普通领域 `tenant_id` 或 `WorkspaceScope.id` 映射到现有 ORM `tenant_id`，所有读取、写入和 owner 比较 MUST 保持完整 tenant scope。

#### Scenario: Existing workspace-facing boundary invokes HITLv2
- **WHEN** 一个保留 `workspace_id` 的既有非 HITLv2 boundary 调用 HITLv2
- **THEN** composition layer MUST 将其转换为 `TenantId`，普通下游 HITLv2 model 和 port MUST 接收 `tenant_id`，workspace scope MUST 接收 `id`

#### Scenario: Repository scopes an owned record
- **WHEN** repository 保存或加载一个 tenant-owned HITLv2 aggregate
- **THEN** mapper 和查询 MUST 使用同一个 tenant owner 并将完整 owner chain 约束到 ORM `tenant_id`

#### Scenario: Tenant owner does not match
- **WHEN** HITLv2 domain reference、request scope 或 persisted record 携带不同的 `tenant_id`
- **THEN** HITLv2 MUST 保持现有的跨 tenant 拒绝行为，并且 MUST NOT 因重命名而放宽 predicate
- **AND** repository query MUST 继续包含完整的 `tenant_id` owner predicate

### Requirement: HITLv2 MUST preserve IM-scoped provider contracts
Dify `tenant_id`、共享 IM Provider namespace 的 `provider_tenant_id` 与 IM Provider adapter 中 provider-native credential/payload 的 `tenant_id` MUST 保持为不同概念。除明确表示 Dify `Tenant.id` 的 owner 字段外，本次内部 owner 重命名 MUST NOT 改写、合并或重解释 IM scope 内的 identifier、namespace、contract 或 adapter 行为。

#### Scenario: IM-scoped provider contract is mapped
- **WHEN** HITLv2 映射 IM Integration、identity、binding、event 或 authorization proof
- **THEN** Dify owner MUST 使用 `tenant_id`，共享 IM Provider namespace MUST 继续使用 `provider_tenant_id`，且其他 IM-scoped identifier 和 contract MUST 保持不变

#### Scenario: IM Provider adapter decodes a native tenant field
- **WHEN** IM Provider adapter 解码第三方协议定义的 `tenant_id`
- **THEN** adapter MUST 保留 provider 原生字段及协议语义，并在共享 IM Provider contract 边界显式映射为 `provider_tenant_id`

### Requirement: HITLv2 serialized ownership MUST use only tenant terminology
包含 Dify owner 的 HITLv2 structured JSON、primitive 和异步任务参数 MUST 使用 `tenant_id`。`WorkspaceScope` primitive 是唯一 scope-specific 例外，MUST 使用 `id` 表示对应的 Dify `Tenant.id`。Serializer、deserializer 和 model validation MUST NOT 接受或输出 `workspace_id` alias，也 MUST NOT 为本次重命名增加 legacy reader 或并行 schema version。

#### Scenario: Email OTP proof is persisted
- **WHEN** 验证成功的 Email OTP proof 写入 audit persistence
- **THEN** model 与持久化 JSON MUST 使用 `tenant_id`，且 `workspace_id` 输入 MUST 被 strict validation 拒绝

#### Scenario: Rendered Email request is serialized
- **WHEN** producer 序列化或 worker 反序列化 rendered Email request
- **THEN** 当前 schema MUST 只使用 `tenant_id`，且 `workspace_id` MUST 被视为 malformed input

#### Scenario: Workspace scope primitive is emitted
- **WHEN** `WorkspaceScope` 输出 primitive representation
- **THEN** primitive MUST 保留 `kind = "workspace"` 并使用 `id` 作为唯一 scope identifier，且该值 MUST 对应 Dify `Tenant.id`

### Requirement: Tenant terminology migration MUST NOT require a database schema change
HITLv2 ORM owner columns 已使用 `tenant_id`，且当前没有需要迁移的 HITLv2 持久化记录或异步消息，因此实现 MUST 复用现有表、列、索引和 owner predicates。该 change MUST NOT 创建 schema migration、payload migration 或数据回填。

#### Scenario: Renamed models are persisted
- **WHEN** 使用 `tenant_id` 的新领域 model 经 repository mapper 持久化
- **THEN** repository MUST 写入现有 ORM `tenant_id` 列，并且数据库 schema MUST 保持不变
