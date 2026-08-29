## Why

HITLv2 领域模型使用 `WorkspaceId` / `workspace_id` 表达 Dify `Tenant` 所有权，而 ORM、数据库列及后端通用隔离约定使用 `tenant_id`。同一概念的双重命名迫使 mapper 和 service 反复翻译，也容易与 IM provider 自身的 tenant 概念混淆，因此需要在 HITLv2 内部统一所有权术语。

## What Changes

- **BREAKING**：将 HITLv2 领域模型、值类型、port 及应用层内部契约中的 Dify owner 标识从 `WorkspaceId` / `workspace_id` 统一改为 `TenantId` / `tenant_id`；`WorkspaceScope` 作为 scope value object 使用 `id: TenantId`。
- 保留 `WorkspaceScope` 及产品语义中的 workspace 概念，其 `id` 明确对应 Dify `Tenant.id`；除明确表示 Dify owner 的字段外，IM scope 内的共享 IM Provider namespace、IM Provider adapter 及其 identifier 和 contract 均不纳入本次重命名。
- 更新 repository mapper、service composition、日志、序列化器与测试，使内部调用链使用统一命名，并继续映射到现有 ORM `tenant_id` 列。
- 直接将 HITLv2 JSON shape 和异步任务参数中的 owner 字段改为 `tenant_id`；当前不存在需要迁移的持久化数据或队列消息，因此不保留 `workspace_id` alias、旧格式 reader 或多版本 schema。
- 本变更仅将 HITLv2 内部用于表示 Dify `Tenant.id` 的 `WorkspaceId` / `workspace_id` 改为 `TenantId` / `tenant_id`。现有数据库 schema 及 SQLAlchemy owner column 定义保持不变；数据库模型文件中承载结构化 JSON、序列化契约或内部调用参数的相关字段仍属于本次变更范围。对外 workspace 契约、非 HITLv2 模块，以及 IM scope 内非 Dify-owner 的 namespace、identifier、contract 和 adapter 行为均保持不变。

## Capabilities

### New Capabilities

- `human-input-v2-tenant-ownership-model`: 规定 HITLv2 内部 Dify owner 的规范命名和边界映射行为。

### Modified Capabilities

无。

## Impact

- 主要影响 `api/core/human_input_v2/`、`api/repositories/human_input_v2/`、相关 `api/services/human_input*` 组合层、`api/models/human_input_v2.py` 中的结构化 JSON 模型及对应单元测试。
- SQLAlchemy owner columns 已使用 `tenant_id`，且当前没有需要迁移的 HITLv2 持久化数据或队列消息，因此不需要数据库或 payload migration；风险集中在一次性改全 Python 调用方、JSON shape、日志和测试。
