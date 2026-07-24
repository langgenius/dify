## ADDED Requirements

### Requirement: Workspace console MUST expose human-input contact directory APIs
系统 MUST 在 `/console/api/workspaces/current/human-input` 下提供 workspace Contact Directory API，覆盖 owner/admin 使用的 Contact list / detail / batch read、EE 下的 `Platform contact` candidate / add、`External contact` 的创建与编辑，以及一个统一的批量 remove API。列表接口省略 `group` 时 MUST 不按类型过滤；显式 group filter 只允许 `workspace / platform / external`，`all` MUST NOT 作为真实 group value。

系统 MUST 另外提供 workflow editor 使用的 `contact-options` list / batch read model。该 read model MUST 使用 edit permission，MUST NOT 复用管理目录的完整响应 DTO，并 MUST 只返回 `id / type / name / avatar_url`。普通 member MUST NOT 通过该接口浏览 Contact directory。

#### Scenario: 省略 group 浏览全部可见 Contact
- **WHEN** a workspace admin calls `GET /console/api/workspaces/current/human-input/contacts` without `group`
- **THEN** 系统 MUST 返回当前 workspace 中可解析为 `WORKSPACE`、`PLATFORM` 或 `EXTERNAL` 的 Contact，MUST NOT 返回 `ABSENT`

#### Scenario: 按 group 浏览当前 workspace Contact
- **WHEN** a workspace admin calls `GET /console/api/workspaces/current/human-input/contacts?group=platform`
- **THEN** 系统 MUST 返回当前 workspace 已收录的 `Platform contact` 集合，也就是非当前 workspace member 的 contact

#### Scenario: 按 ID 读取当前 workspace Contact
- **WHEN** a workspace admin calls `GET /console/api/workspaces/current/human-input/contacts/<contact_id>` and the contact resolves as `WORKSPACE`, `PLATFORM`, or `EXTERNAL`
- **THEN** 系统 MUST 返回该 Contact 的当前 workspace projection

#### Scenario: 按 ID 读取 ABSENT Contact
- **WHEN** a canonical contact exists but resolves as `ABSENT` in the current workspace, or the Contact has been hard-deleted
- **THEN** `GET /console/api/workspaces/current/human-input/contacts/<contact_id>` MUST return `404 Not Found`

#### Scenario: 历史对象不回查当前 Contact API
- **WHEN** a historical workflow, task, or audit record renders a removed or unavailable contact
- **THEN** 系统 MUST 使用创建时冻结的 snapshot，MUST NOT 通过当前 Contact list or detail API 回查历史展示数据

#### Scenario: Workflow editor 搜索静态 recipient candidate
- **WHEN** a workflow editor with edit permission calls `GET /console/api/workspaces/current/human-input/contact-options?keyword=<string>`
- **THEN** 系统 MUST 返回当前 workspace 中可选择 Contact 的分页结果，每个 item MUST 只包含 `id / type / name / avatar_url`，MUST NOT 返回 Email、IM binding 或 management metadata

#### Scenario: Workflow editor 批量回显已保存 recipient
- **WHEN** a workflow editor calls `GET /console/api/workspaces/current/human-input/contact-options/batch?contact_ids=<contact_id>`
- **THEN** 系统 MUST 使用与 contact option search 相同的最小 projection 和 workspace-scoped resolution，返回仍然可用的 Contact

#### Scenario: Contact option 过滤 unavailable Contact
- **WHEN** contact option search or batch resolution encounters an `ABSENT`, hard-deleted, or otherwise unavailable Contact
- **THEN** 系统 MUST omit that Contact from the current picker response and MUST NOT expose canonical or historical data through the current Contact API

#### Scenario: 普通 member 不能浏览 Contact option
- **WHEN** a workspace member without edit permission calls either `contact-options` endpoint
- **THEN** 系统 MUST reject the request

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
系统 MUST 在 `/console/api/workspaces/current/human-input` 下提供 Organization 级 IM integration、manual sync、最近一次 sync run 的 summary、按 result 分页的最近一次 sync 结果查询，以及 IM identity candidate 查询和 workspace IM override API。该 surface MUST 是 latest-only，MUST NOT 新增 run-by-ID、run list 或历史 run detail endpoint。manual sync 结果 MUST 能表达 `added / not_matched / failed / removed / skipped` 五类 bucket。

#### Scenario: 读取当前 IM integration 摘要
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-integration`
- **THEN** 系统 MUST 返回当前唯一 IM channel 的配置摘要、连接状态、`integration_id` 和 `config_version`；若尚未配置，MUST 返回 `Not configured`

#### Scenario: 使用当前 revision 更新 IM integration
- **WHEN** a workspace owner or admin calls `PUT /console/api/workspaces/current/human-input/im-integration` for an existing integration with its current `integration_id` and `config_version`
- **THEN** 系统 MUST compare-and-swap 当前 integration，成功时 MUST 递增 `config_version`

#### Scenario: 首次创建 IM integration
- **WHEN** the current Organization has no configured integration and a workspace owner or admin calls `PUT /console/api/workspaces/current/human-input/im-integration` without an expected integration ID or config version
- **THEN** 系统 MUST 创建新的 integration，并 MUST 从 `config_version = 1` 开始

#### Scenario: Existing integration update 缺少完整 CAS token
- **WHEN** a workspace owner or admin updates an existing integration without both `integration_id` and `config_version`, or provides only one of them
- **THEN** 系统 MUST 拒绝请求，并 MUST NOT 修改 integration 或触发 sync

#### Scenario: 使用 stale revision 更新 IM integration
- **WHEN** a workspace owner or admin updates an existing integration with a stale or mismatched `integration_id` or `config_version`
- **THEN** 系统 MUST 返回 `409 Conflict`，MUST NOT 修改 integration、清理 IM bindings / workspace overrides 或触发 manual / automatic sync

#### Scenario: 替换当前 IM provider
- **WHEN** a workspace owner or admin calls `PUT /console/api/workspaces/current/human-input/im-integration` with credentials for a provider different from the current provider
- **THEN** 系统 MUST 将该操作视为 provider replacement，MUST 使旧 provider 的 IM bindings 和 workspace overrides 失效，并 MUST 要求管理员重新执行 manual sync 后才能使用新 provider identity

#### Scenario: 同一 platform tenant 内轮换 provider credentials
- **WHEN** a workspace owner or admin updates credentials for the current provider, and the system can confirm that `platform_tenant_id` is unchanged
- **THEN** 系统 MUST 将该操作视为 credential rotation，并 MUST 保留当前 IM identities、Organization bindings 和 workspace overrides

#### Scenario: 更新 credentials 时 platform tenant 变化或无法确认
- **WHEN** a workspace owner or admin updates credentials for the current provider, but `platform_tenant_id` has changed or cannot be confirmed as unchanged
- **THEN** 系统 MUST 将该操作视为 provider replacement，MUST 使旧 IM bindings 和 workspace overrides 失效，并 MUST 要求管理员重新执行 manual sync

#### Scenario: 解除当前 IM integration
- **WHEN** a workspace owner or admin calls `DELETE /console/api/workspaces/current/human-input/im-integration` with the current `integration_id` and `config_version`
- **THEN** 系统 MUST 清空当前 IM integration，并使后续读取结果回到 `Not configured`

#### Scenario: 使用 stale revision 解除 IM integration
- **WHEN** a workspace owner or admin calls `DELETE /console/api/workspaces/current/human-input/im-integration` with a stale or mismatched `integration_id` or `config_version`
- **THEN** 系统 MUST 返回 `409 Conflict`，并 MUST 保留当前 integration、IM identities、bindings 和 workspace overrides

#### Scenario: 手动触发一次 IM sync
- **WHEN** a workspace owner or admin calls `POST /console/api/workspaces/current/human-input/im-sync-runs`
- **THEN** 系统 MUST 创建一条新的 sync run，保存当前 `integration_id` 与 `config_version`，并返回 run identifier 与初始状态

#### Scenario: Sync run 对应的 integration revision 已过期
- **WHEN** an IM sync worker is ready to apply reconciliation results, but the current integration ID or config version no longer matches the revision captured by the run
- **THEN** 系统 MUST 将该 run 作为 stale work 终止，MUST NOT 写入 current IM identities、Organization bindings 或 workspace overrides

#### Scenario: 查看最近一次 sync run summary
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest`
- **THEN** 系统 MUST 返回最近一次 sync run 的 summary，包括 run metadata、作为 UI 显式同步时间的 `finished_at` 和五类 bucket 的 aggregate counts，并 MUST NOT 返回 `started_by`

#### Scenario: 按 bucket 分页查看最近一次 sync result
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest/results?result=not_matched&page=1&limit=20`
- **THEN** 系统 MUST 只返回最近一次 sync run 中 `not_matched` bucket 的结果条目分页，使用 `page / limit / total` 表达分页状态，MUST NOT 返回 cursor，且 MUST NOT 在分页响应中重复 run summary；需要 summary 的客户端 MUST 同时请求 `GetLatestIMSyncRun`

#### Scenario: Latest sync result 必须指定真实 bucket
- **WHEN** a workspace owner or admin omits `result` or requests `result=all` from the latest results endpoint
- **THEN** 系统 MUST 拒绝该请求；`result` MUST 是 `added / not_matched / failed / removed / skipped` 之一，MUST NOT 提供 `All` 或不筛选模式

#### Scenario: Sync result item 不返回 Contact type
- **WHEN** a workspace owner or admin reads one latest-run result page
- **THEN** each `IMSyncResultItem` MUST describe its reconciliation result without returning `HumanInputContactType`

#### Scenario: Removed sync result 返回稳定原因
- **WHEN** a workspace owner or admin reads one `removed` sync result
- **THEN** 系统 MUST 返回 `not_present_in_directory`、`binding_invalidated` 或 `binding_replaced` 之一作为 machine-readable removal reason

#### Scenario: 按 provider user ID 搜索 IM identity
- **WHEN** a workspace owner or admin searches `GET /console/api/workspaces/current/human-input/im-identities` with a provider user ID keyword
- **THEN** 系统 MUST match the provider-side user identifier in addition to display name and email

#### Scenario: 为 contact 设置 workspace IM override
- **WHEN** a workspace admin calls `PUT /console/api/workspaces/current/human-input/contacts/<contact_id>/im-override` with one synced identity
- **THEN** 系统 MUST 将该 identity 绑定为当前 workspace override，而 MUST NOT 改写 Organization 级 global IM identity

### Requirement: Draft human-input editor MUST expose preview, run, and message template test APIs
系统 MUST 继续提供 draft `form/preview` 与 `form/run` API，并为 v2 新增独立 `message-template/test`。v1 `delivery-test`、完整 v1 node model 与 request contract MUST 保持不变；preview / run MUST 按 node version 使用独立逻辑，MUST NOT 让 v1 / v2 payload 交叉提交。v2 测试接口 MUST 使用 `DebugChannel` 作为 `channel` 参数，而 MUST NOT 依赖旧 `delivery_method_id`。

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

该 endpoint 的 request body MUST 使用 `nodes: [{ node_id, node_data }]`，成功响应 MUST 使用 `data: [{ node_id, node_data }]`，并保持现有的输入顺序保证。整批失败响应 MUST 使用 `blockers` 返回 node-scoped machine-readable blocker，不得混入任何部分成功的 v2 node data。该 transport 对齐只约束 HTTP / generated-client boundary，不改变本 requirement 定义的转换、tenant snapshot、all-or-error、幂等或 ownership 语义。

#### Scenario: Migration input 只接受 v1 node data
- **WHEN** a submitted node contains an explicit `version`
- **THEN** the version MUST be the exact string `"1"`; any other explicit version MUST be rejected before conversion

#### Scenario: Migration input 缺失 version
- **WHEN** a submitted legacy node data omits `version`
- **THEN** the helper MUST normalize the missing value to the string `"1"` before conversion

#### Scenario: Migration input 忽略额外字段
- **WHEN** the request envelope, node envelope, or legacy node data contains fields not consumed by the current helper
- **THEN** those additional fields MUST be ignored rather than rejected

#### Scenario: Migration request 禁止重复 node_id
- **WHEN** two submitted entries have the same `node_id`
- **THEN** the entire request MUST be rejected before conversion and MUST NOT return partial node data

#### Scenario: Migration transport 对齐 frontend adapter boundary
- **WHEN** the generated client is used to replace the frontend's temporary mock migration adapter
- **THEN** the request MUST expose `nodes[].node_id` and `nodes[].node_data`, the success response MUST expose `data[].node_id` and `data[].node_data`, and a whole-batch failure MUST expose `blockers` without requiring changes to frontend executor, graph application, or UI orchestration

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
- **THEN** 系统 MUST 为整个 request 返回 `400 Bad Request` 和 `blockers`，其中包含关联失败 `node_id` 的 machine-readable blocker code and context；系统 MUST NOT 返回 success response，并 MUST NOT 返回其他成功节点的部分 v2 node data

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
