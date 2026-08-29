# human-input-console-management-api Specification

## Purpose
TBD - created by archiving change human-input-v2-api-contracts. Update Purpose after archive.
## Requirements
### Requirement: Workspace console MUST expose human-input contact directory APIs
系统 MUST 在 `/console/api/workspaces/current/human-input` 下提供 workspace Contact Directory API，覆盖 owner/admin 使用的 Contact list / detail / batch read、EE 下的 `Platform contact` candidate / add、`External contact` 的创建与编辑，以及一个统一的批量 remove API。列表接口省略 `group` 时 MUST 不按类型过滤；显式 group filter 只允许 `workspace / platform / external`，`all` MUST NOT 作为真实 group value。`External contact` 的 normalized email MAY 与当前 `workspace contact` 或 `Platform contact` 重叠，但同一 workspace 内两个 `External contact` MUST NOT 共享同一 normalized email。

系统 MUST 另外提供 workflow editor 使用的 `contact-options` list / batch read model。该 read model MUST 使用 edit permission，MUST NOT 复用管理目录的完整响应 DTO，并 MUST 只返回 `id / type / name / avatar_url / email`。`email` MAY be null when the current Contact projection has no available Email. `id` MUST remain the Contact identity used by recipient DSL；`email` supports option presentation and same-email validation. 普通 member MUST NOT 通过该接口浏览 Contact directory。

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
- **THEN** 系统 MUST 返回当前 workspace 中可选择 Contact 的分页结果，每个 item MUST 只包含 `id / type / name / avatar_url / email`，MUST NOT 返回 IM binding 或 management metadata

#### Scenario: Workflow editor 批量回显已保存 recipient
- **WHEN** a workflow editor calls `GET /console/api/workspaces/current/human-input/contact-options/batch?contact_ids=<contact_id>`
- **THEN** 系统 MUST 使用与 contact option search 相同的最小 projection 和 workspace-scoped resolution，返回仍然可用的 Contact，包括各 Contact 当前可用的 nullable `email`

#### Scenario: Workflow editor 比较 same-email Contact candidates
- **WHEN** contact-option search or batch resolution returns two Contacts with the same normalized email
- **THEN** 系统 MUST include each Contact's `email` so the editor can compare their normalized values while continuing to persist recipients by `contact_id`

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

#### Scenario: 创建与内部 Contact 同邮箱的 external contact
- **WHEN** a workspace admin calls `POST /console/api/workspaces/current/human-input/contacts/external` with a valid email already used by a current `workspace contact` or `Platform contact`
- **THEN** 系统 MUST 创建 `External contact` 并返回创建后的 contact payload

#### Scenario: 创建重复 external contact
- **WHEN** a workspace admin calls the same create endpoint with a normalized email already owned by another `External contact` in the same workspace
- **THEN** the API MUST reject the request with a conflict outcome

#### Scenario: 更新 external contact 到内部 Contact 同邮箱
- **WHEN** a workspace admin calls `PATCH /console/api/workspaces/current/human-input/contacts/external/<contact_id>` and changes the normalized email to one currently used by an internal Contact
- **THEN** 系统 MUST 只更新该 `External contact` 的可编辑字段，而 MUST NOT 把它提升为 `organization contact`

#### Scenario: 更新 external contact 为另一 external contact 的重复邮箱
- **WHEN** a workspace admin updates one `External contact` to a normalized email already used by another `External contact` in the same workspace
- **THEN** the API MUST reject the update with a conflict outcome

#### Scenario: 批量 remove mixed platform and external contacts
- **WHEN** a workspace admin calls `POST /console/api/workspaces/current/human-input/contacts/remove` with both `Platform contact` and `External contact` identifiers
- **THEN** 系统 MUST 允许在一个批量请求里同时处理这两类 contact，并对 `Platform contact` 执行当前 workspace scope 内的移除，对 `External contact` 执行 contact 删除

#### Scenario: Remove platform contact 只影响当前 workspace
- **WHEN** a workspace admin removes one `Platform contact` through `POST /console/api/workspaces/current/human-input/contacts/remove`
- **THEN** 系统 MUST 只把该 `Platform contact` 从当前 workspace Contact 中移除，而 MUST NOT 删除其 Organization member 身份

#### Scenario: Workspace contact 不走 contacts remove API
- **WHEN** a workspace admin tries to include one `workspace contact` in `POST /console/api/workspaces/current/human-input/contacts/remove`
- **THEN** 系统 MUST 拒绝该条目或整个请求，并 MUST 要求改走 membership management 流程，而 MUST NOT 在 Human Input Contact API 中额外引入 workspace member removal

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
系统 MUST 在 `POST /console/api/workspaces/current/human-input/node-data-migration` 提供 Human Input v1 → v2 batch node-data migration helper。该 endpoint MUST 只执行当前 tenant / Organization 范围内的 recipient resolution、批量节点转换与 blocker 校验，MUST NOT 更新 workflow DSL、draft、published workflow、graph state 或 migration history。legacy email recipients for current workspace members、Platform members 和 arbitrary email targets MUST become email-scoped `onetime_email` recipients unless another explicit migration rule applies. The helper MUST NOT auto-upgrade legacy email recipients into Contact recipients and MUST NOT auto-create `External contact` records. 调用方 MUST 在用户显式确认后提交待迁移的 legacy node data 集合；节点集合选择、原子 graph replacement、draft sync 与 rollback MUST 继续由调用方的 migration flow 负责。legacy `whole_workspace: true` MUST migrate to explicit `all_workspace_contacts` rather than a lossy static snapshot.

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

#### Scenario: Legacy workspace member email migrates to one-time email
- **WHEN** one submitted legacy node references a current workspace member email recipient
- **THEN** the helper MUST return `onetime_email` recipient data for that target rather than a Contact recipient

#### Scenario: Legacy Platform member email migrates to one-time email
- **WHEN** one submitted legacy node references another workspace or Platform member by email
- **THEN** the helper MUST return `onetime_email` recipient data and MUST NOT auto-add a `Platform contact`

#### Scenario: Legacy arbitrary email migrates to one-time email
- **WHEN** one submitted legacy node contains another valid email recipient
- **THEN** the helper MUST return `onetime_email` recipient data and MUST NOT auto-create an `External contact`

#### Scenario: Legacy email matches an existing Contact
- **WHEN** a submitted legacy email recipient shares a normalized email with any current Contact
- **THEN** the helper MUST still preserve it as email-scoped migration output unless another explicit migration rule rewrites that exact source type

#### Scenario: Whole-workspace legacy recipient is migrated
- **WHEN** any submitted legacy node has enabled email configuration with `whole_workspace: true`
- **THEN** the helper MUST emit exactly one `all_workspace_contacts` recipient representation for that legacy source

#### Scenario: Whole-workspace overlaps a specific workspace Contact
- **WHEN** migrated output contains `all_workspace_contacts` and also preserves a specific workspace Contact that would already be covered by that set
- **THEN** the helper MUST preserve both recipients in imported output and MUST NOT collapse them during migration

#### Scenario: Whole-workspace overlaps a same-email External Contact
- **WHEN** migrated output contains `all_workspace_contacts` and also preserves an `External contact` whose normalized email matches a workspace member email
- **THEN** the helper MUST preserve both recipients in imported output and MUST NOT reject the batch solely because of that overlap

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

### Requirement: Workspace console MUST expose latest-run IM sync, identity search, and override APIs

系统 MUST 在 `/console/api/workspaces/current/human-input` 下继续提供 manual sync、最近一次 sync run summary、按 result 分页的最近一次 sync results、IM identity candidate 查询和 workspace IM override APIs。该 surface MUST 是 latest-only，MUST NOT 新增 run-by-ID、run list 或 historical run detail endpoint。Manual sync results MUST 能表达 `added / not_matched / failed / removed / skipped` 五类 bucket。Same IM identity reuse across Organization binding and workspace overrides MUST be modeled as a workspace-scoped resolution concern, not a global uniqueness conflict。

#### Scenario: Manual IM sync is requested

- **WHEN** workspace owner or admin calls `POST /console/api/workspaces/current/human-input/im-sync-runs`
- **THEN** system MUST atomically obtain the current single active run
- **AND** it MUST create a run with current `integration_id` and `config_version` when no active run exists, or reuse the active run when one exists

#### Scenario: Sync run references a stale Integration revision

- **WHEN** IM sync worker is ready to apply results but current Integration ID or config version no longer matches the revision captured by the run
- **THEN** system MUST terminate the run as stale work
- **AND** it MUST NOT write current IM identities, Organization bindings or workspace overrides

#### Scenario: Latest sync run summary is requested

- **WHEN** workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest`
- **THEN** system MUST return run metadata, `finished_at` and aggregate counts for all five result buckets
- **AND** it MUST NOT return `started_by`

#### Scenario: Latest sync results are requested by bucket

- **WHEN** workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest/results?result=not_matched&page=1&limit=20`
- **THEN** system MUST return only the latest run's `not_matched` results using `page / limit / total`
- **AND** it MUST NOT repeat run summary in the paginated response

#### Scenario: Latest sync result omits a real bucket

- **WHEN** caller omits `result` or requests `result=all`
- **THEN** API MUST reject the request
- **AND** `result` MUST be one of `added / not_matched / failed / removed / skipped`

#### Scenario: Sync result item is returned

- **WHEN** caller reads one latest-run result page
- **THEN** each `IMSyncResultItem` MUST describe its reconciliation result without returning `HumanInputContactType`

#### Scenario: Removed sync result is returned

- **WHEN** caller reads one `removed` result
- **THEN** system MUST return `not_present_in_directory`, `binding_invalidated` or `binding_replaced` as the machine-readable reason

#### Scenario: IM identity is searched by provider user ID

- **WHEN** workspace owner or admin searches `GET /console/api/workspaces/current/human-input/im-identities`
- **THEN** system MUST match provider-side user identifier in addition to display name and email

#### Scenario: Workspace IM override is set

- **WHEN** workspace admin calls `PUT /console/api/workspaces/current/human-input/contacts/<contact_id>/im-override` with one synced identity
- **THEN** system MUST bind that identity as the current workspace override
- **AND** it MUST NOT rewrite the Organization-level global IM identity

#### Scenario: Override reuses an Organization-bound identity

- **WHEN** workspace admin selects an identity already used by another Organization binding
- **THEN** API MUST allow the override if current workspace predicates pass
- **AND** it MUST preserve Organization binding state

#### Scenario: Override reuses an identity from another workspace

- **WHEN** another workspace already uses the same identity in its override
- **THEN** current workspace request MUST remain allowed if all current-scope predicates pass

#### Scenario: Contact target is needed for authorization or runtime lookup

- **WHEN** later task or runtime lookup evaluates an identity returned by override APIs
- **THEN** contract MUST require workspace-scoped target context
- **AND** it MUST NOT imply a global `im_user_id -> Contact` reverse lookup
