## ADDED Requirements

### Requirement: Workspace console MUST expose human-input contact directory APIs
系统 MUST 在 `/console/api/workspaces/current/human-input` 下提供 workspace Contact Directory API，覆盖 Contact 列表浏览、EE 下的 `Platform contact` candidate / add、`External contact` 的创建与编辑，以及一个统一的批量 remove API。列表接口 MUST 支持 `all / workspace / platform / external` 四个分组语义。

#### Scenario: 按 group 浏览当前 workspace Contact
- **WHEN** a workspace admin calls `GET /console/api/workspaces/current/human-input/contacts?group=platform`
- **THEN** 系统 MUST 返回当前 workspace 已收录的 `Platform contact` 集合，也就是非当前 workspace member 的 contact

#### Scenario: EE 搜索 Platform contact candidate
- **WHEN** an EE workspace admin calls `GET /console/api/workspaces/current/human-input/organization-candidates`
- **THEN** 系统 MUST 返回当前 Organization 内可加入当前 workspace Contact 的 member candidate，并在加入后把它们落成为 `Platform contact`

#### Scenario: CE / SaaS 调用 Platform contact candidate or add endpoint
- **WHEN** a CE or SaaS workspace admin calls `GET /console/api/workspaces/current/human-input/organization-candidates` or `POST /console/api/workspaces/current/human-input/contacts/platform`
- **THEN** 系统 MAY 保留这些路由实现，但 MUST 允许在运行时返回 edition-not-supported 类错误

#### Scenario: 创建合法 external contact
- **WHEN** a workspace admin calls `POST /console/api/workspaces/current/human-input/contacts/external` with a valid non-Dify email
- **THEN** 系统 MUST 创建 `External contact` 并返回创建后的 contact payload

#### Scenario: 更新 external contact
- **WHEN** a workspace admin calls `PATCH /console/api/workspaces/current/human-input/contacts/external/<contact_id>`
- **THEN** 系统 MUST 只更新该 `External contact` 的可编辑字段，而 MUST NOT 把它提升为 `organization contact`

#### Scenario: 批量 remove mixed platform and external contacts
- **WHEN** a workspace admin calls `POST /console/api/workspaces/current/human-input/contacts/remove` with both `Platform contact` and `External contact` identifiers
- **THEN** 系统 MUST 允许在一个批量请求里同时处理这两类 contact，并对 `Platform contact` 执行当前 workspace scope 内的移除，对 `External contact` 执行 contact 删除

#### Scenario: Remove platform contact 只影响当前 workspace
- **WHEN** a workspace admin removes one `Platform contact` through `POST /console/api/workspaces/current/human-input/contacts/remove`
- **THEN** 系统 MUST 只把该 `Platform contact` 从当前 workspace Contact 中移除，而 MUST NOT 删除其 Organization member 身份

#### Scenario: Workspace contact 不走 contacts remove API
- **WHEN** a workspace admin tries to include one `workspace contact` in `POST /console/api/workspaces/current/human-input/contacts/remove`
- **THEN** 系统 MUST 拒绝该条目或整个请求，并 MUST 要求改走 membership management 流程，而 MUST NOT 在 Human Input Contact API 中额外引入 workspace member removal

### Requirement: Workspace console MUST expose IM integration, latest-run sync summary, paginated sync results, identity search, and override APIs
系统 MUST 在 `/console/api/workspaces/current/human-input` 下提供 Organization 级 IM integration、manual sync、最近一次 sync run 的 summary、按 result 分页的最近一次 sync 结果查询，以及 IM identity candidate 查询和 workspace IM override API。manual sync 结果 MUST 能表达 `added / not_matched / failed / removed / skipped` 五类 bucket。

#### Scenario: 读取当前 IM integration 摘要
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-integration`
- **THEN** 系统 MUST 返回当前唯一 IM channel 的配置摘要和连接状态；若尚未配置，MUST 返回 `Not configured`

#### Scenario: 手动触发一次 IM sync
- **WHEN** a workspace owner or admin calls `POST /console/api/workspaces/current/human-input/im-sync-runs`
- **THEN** 系统 MUST 创建一条新的 sync run，并返回 run identifier 与初始状态

#### Scenario: 查看最近一次 sync run summary
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest`
- **THEN** 系统 MUST 返回最近一次 sync run 的 summary，包括 run metadata 和五类 bucket 的 aggregate counts

#### Scenario: 按 bucket 分页查看最近一次 sync result
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest/results?result=not_matched&page=1&limit=20`
- **THEN** 系统 MUST 只返回最近一次 sync run 中 `not_matched` bucket 的结果条目分页，以及与该分页关联的 run summary

#### Scenario: 为 contact 设置 workspace IM override
- **WHEN** a workspace admin calls `PUT /console/api/workspaces/current/human-input/contacts/<contact_id>/im-override` with one synced identity
- **THEN** 系统 MUST 将该 identity 绑定为当前 workspace override，而 MUST NOT 改写 Organization 级 global IM identity

### Requirement: Draft human-input editor MUST expose preview, run, and message template test APIs
系统 MUST 继续提供 draft `form/preview` 与 `form/run` API，并新增 `message-template/test`。新测试接口 MUST 使用 `DebugChannel` 作为 `channel` 参数，而 MUST NOT 继续依赖旧 `delivery_method_id`。

#### Scenario: 预览表单仍然只依赖 draft inputs
- **WHEN** a workflow editor calls `POST /console/api/apps/<app_id>/workflows/draft/human-input/nodes/<node_id>/form/preview`
- **THEN** 系统 MUST 继续只基于 `inputs` 渲染 preview，而 MUST NOT 要求 runtime form token

#### Scenario: 运行 draft form submit
- **WHEN** a workflow editor calls `POST /console/api/apps/<app_id>/workflows/draft/human-input/nodes/<node_id>/form/run`
- **THEN** 系统 MUST 接收 `form_inputs`、`inputs` 和 `action`，并返回 draft run result

#### Scenario: 发送 message template 测试消息
- **WHEN** a workflow editor calls `POST /console/api/apps/<app_id>/workflows/draft/human-input/nodes/<node_id>/message-template/test` with `channel=EMAIL`
- **THEN** 系统 MUST 按当前 node 的 `MessageTemplateConfig` 渲染测试消息，并向当前编辑者可达的对应 debug channel 发送测试消息

### Requirement: Workspace console MUST expose a side-effect-free batch Human Input node-data migration helper
系统 MUST 在 `POST /console/api/workspaces/current/human-input/node-data-migration` 提供 Human Input v1 → v2 batch node-data migration helper。该 endpoint MUST 只执行当前 tenant / Organization 范围内的 recipient resolution、以无损转换为默认的批量节点转换与 blocker 校验，MUST NOT 更新 workflow DSL、draft、published workflow、graph state 或 migration history。调用方 MUST 在用户显式确认后提交待迁移的 legacy node data 集合；节点集合选择、原子 graph replacement、draft sync 与 rollback MUST 继续由调用方的 migration flow 负责。唯一允许的受控有损例外是把 legacy Email `whole_workspace: true` 物化为迁移当下当前 workspace recipient snapshot 的静态列表。

#### Scenario: 用户确认后批量转换 legacy nodes
- **WHEN** a workflow editor explicitly confirms migration and submits multiple eligible legacy Human Input node data entries to `POST /console/api/workspaces/current/human-input/node-data-migration`
- **THEN** 系统 MUST 为全部输入节点返回规范化的 Human Input v2 node data，保持 `node_id` 关联和输入顺序，并 MUST NOT 持久化结果或修改任何 workflow

#### Scenario: Recipient resolution 限制在当前 tenant
- **WHEN** the migration helper resolves legacy member or email recipients for a submitted batch
- **THEN** 系统 MUST 为整批节点使用同一个稳定的、仅包含当前 tenant / Organization member and Contact state 的 snapshot，并 MUST NOT 搜索或引用跨 Organization contact

#### Scenario: All workspace member 迁移为静态 snapshot
- **WHEN** any submitted node has enabled email configuration with `whole_workspace: true`
- **THEN** 系统 MUST 使用该批次 request-scoped workspace member / contact snapshot 展开 recipient，按既有 fallback 与去重规则生成静态 v2 recipient 列表；该场景是唯一允许的受控有损转换，MUST NOT 单独导致整批失败

#### Scenario: 任一节点生成新 schema 失败时整批返回错误
- **WHEN** any submitted legacy node cannot produce complete Human Input v2 node data because of unsupported delivery methods, conflicting message templates, invalid email configuration, unresolved recipients, or another blocker
- **THEN** 系统 MUST 为整个 request 返回 `400 Bad Request` 和关联失败 `node_id` 的 machine-readable blocker code and context，MUST NOT 返回 success response，并 MUST NOT 返回其他成功节点的部分 v2 node data

#### Scenario: 重复批量转换无副作用
- **WHEN** the same ordered legacy node data batch is submitted repeatedly while the tenant-scoped resolution state remains unchanged
- **THEN** 系统 MUST 返回等价的完整结果或等价的整批错误，MUST NOT 创建持久化 migration state，并 MUST NOT 修改 workflow

#### Scenario: 成功响应覆盖完整输入批次
- **WHEN** every submitted legacy node successfully generates complete Human Input v2 node data
- **THEN** the success response MUST contain exactly one result for every submitted `node_id` in input order, and MUST NOT silently omit any node

#### Scenario: migration helper 不接管前端 orchestration
- **WHEN** the caller uses `POST /console/api/workspaces/current/human-input/node-data-migration` as part of a larger draft migration flow
- **THEN** the helper MUST stay limited to batch conversion and blocker validation, while node-set selection, explicit user confirmation, atomic graph replacement, draft synchronization, rollback, and history/collaboration orchestration remain owned by the caller

### Requirement: New console contracts MUST use `human-input` paths and Pydantic DTOs
本 change 新增或重定义的 console API MUST 使用 `human-input` 作为 URL part，MUST 继续使用 Pydantic model 定义 Request / Response，并且在语义相同处 MUST 复用现有 DSL / runtime enum，而不是重新发明 transport-only enum。

#### Scenario: 文档路径不出现 `hitl`
- **WHEN** the generated console API contract is reviewed
- **THEN** 所有新路径 MUST 使用 `human-input`，而 MUST NOT 出现 `hitl` path segment

#### Scenario: message template test 复用 DebugChannel
- **WHEN** the request model for `message-template/test` is defined
- **THEN** 系统 MUST 复用 `DebugChannel` 作为 `channel` 字段类型，而 MUST NOT 新增一个语义重复的 debug-channel enum
