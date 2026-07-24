## Context

当前仓库里已经有三组 Human Input API：

- Console 内部 form token API：`api/controllers/console/human_input_form.py`
- Public web form API：`api/controllers/web/human_input_form.py`
- Service API form API：`api/controllers/service_api/app/human_input_form.py`

这些接口都围绕 `HumanInputForm` 展开，和用户给出的补充约束一致，可以把它视为 PRD 中的 task，并继续沿用 `form` 作为 runtime noun。与此同时，`humaninput_v2` 已经提供了 recipient / message template / debug channel 的 DSL 雏形：

- `RecipientType`、`Contact`、`DynamicEmail`、`OnetimeEmail`、`Initiator`
- `MessageTemplateConfig`
- `DebugChannel`、`DebugModeConfig`

本 change 当前收口了四类此前存在的 transport contract 问题：

1. Public web form definition 继续允许 token-based read，但 submit 需要从 token-only authorization 收口为符合 PRD 的 submit-time approval proof model。
2. Draft `delivery-test` 需要替换为不再依赖旧 `delivery_method_id` 的 `message-template/test` contract。
3. Contact Directory、Organization 级 IM integration、manual sync 与 workspace IM override 需要成型的 console / EE control-plane API。
4. 前端 migration change 与后端 helper 的职责边界现已独立规格化：前端负责用户确认、迁移节点集合选择、batch request orchestration、使用返回的完整节点定义做原子替换以及 draft 更新；后端 helper 是整批 node-data 转换、recipient resolution 与 blocker 校验的唯一权威边界，不能接管 graph mutation 或 draft 持久化。

另外，最新澄清已经固定了联系人概念边界：

- `organization contact` 是上位概念
- `workspace contact` 与 `Platform contact` 是 `organization contact` 的子类
- CE / SaaS 中 `Organization = workspace`，因此 `Platform contact` candidate / add 在运行时没有可用对象；如果共享实现保留这些路由，允许直接报 edition-not-supported
- `Platform contact` 只在 EE 的跨 workspace 组织视图里有意义

本 change 的额外输出物是根目录的 `/Users/qg/.codex/worktrees/5ab7/dify/human-input-v2-api-summary.md`，它会作为实现阶段直接参考的 contract 汇总。

## Goals / Non-Goals

**Goals:**

- 定义最小但完整的 CE / SaaS API surface，覆盖 PRD 已确认的 contact、IM、draft debug、runtime approval 逻辑。
- 定义 EE 管理后台的 protobuf / `google.api.http` contract，并且只覆盖 PRD 需要的新 control-plane。
- 复用现有 DSL / runtime enum，而不是为 transport 层重新发明同义枚举。
- 定义一个无副作用的 v1 → v2 batch node-data migration helper，使用户确认、整批转换校验与 draft 持久化的职责边界可追溯。

**Non-Goals:**

- 不在本 change 中实现数据库表、ORM、service 或 controller 代码。
- 不为通知中心、CLI 待办、审计 UI、新的 task list 设计额外接口。
- 不重新设计成员 / workspace 的 EE 基础 CRUD；这部分继续复用已有 enterprise proto。
- 不把 PB contract 扩成“完整 Contact Directory 后台”，只做本期确实新增的 Human Input control-plane。
- 不由 migration helper 自动触发迁移、更新 workflow draft、修改已发布版本或绕过前端的显式用户确认。

## Decisions

### 1. Surface 按职责与鉴权模型拆分，而不是做一个“大 Human Input API”

接口按调用者与鉴权方式拆成独立 surface：

- Workspace console：`/console/api/workspaces/current/human-input/...`
- Draft workflow / advanced-chat：沿用 `/console/api/apps/<app_id>/.../draft/human-input/...`
- Public Email form：`/api/form/human-input/<form_token>/...`
- Authenticated Contact approval：`/console/api/form/human-input/<form_token>/...`
- Service API：`/v1/form/human-input/<form_token>/...`
- EE dashboard admin：`/v1/dashboard/api/human-input/...`

选择这条路线的原因：

- 现有仓库本身就是按 namespace 和 auth model 拆 controller。
- PRD 对 workspace admin、workflow editor、external approver、Service API caller、EE admin 的权限要求不同，放在一个 surface 里只会把 auth 逻辑搅乱。

放弃方案：

- 用一个新的 `/human-input/tasks/...` 总入口统一所有 surface。
  原因：会违背现有 controller 组织方式，也会把 `form` 与 `task` 两套术语重新混在一起。

### 2. v1 与 v2 runtime contract 使用独立路径和提交逻辑

路径命名统一使用：

- noun：`form`
- url part：`human-input`

Human Input v1 继续保留现有下划线路径、完整 v1 node model、DTO 与提交逻辑：

- `/api/form/human_input/<form_token>`
- `/v1/form/human_input/<form_token>`

Human Input v2 使用新的连字符路径：

- `/api/form/human-input/<form_token>`
- `/v1/form/human-input/<form_token>`
- `/console/api/form/human-input/<form_token>`

v2 不使用：

- `/task/...`
- `/hitl/...`
- `/human_input/...`

两套路径不是 alias。v1 与 v2 必须使用独立 controller、request DTO 与 form-version resolution；任何一侧收到另一版本的 form token 都必须拒绝读取或提交。二者只允许复用 suspension 等不携带版本业务语义的基础设施。

### 3. Workspace console 按 edition 暴露 contact / IM 接口

workspace console endpoint 收敛为三组，其中 `Platform contact` candidate / add 是 EE-only capability；remove 则统一走一个批量 API。

| Group | Method | Path | View | Purpose |
| --- | --- | --- | --- | --- |
| Contacts | `GET` | `/console/api/workspaces/current/human-input/contacts` | `WorkspaceHumanInputContactsApi` | 浏览当前 workspace Contact；省略 `group` 表示不按类型过滤，显式过滤值只有 `workspace / platform / external` |
| Contacts | `GET` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>` | `WorkspaceHumanInputContactApi` | 按 ID 读取当前 workspace 中可解析为 `workspace / platform / external` 的 Contact；解析为 `ABSENT` 时返回 not-found |
| Contacts | `GET` | `/console/api/workspaces/current/human-input/contacts/batch` | `BatchGetContactsAPI` | owner/admin 按 ID 批量读取 Contact management summary；workflow editor 不使用该接口 |
| Contact picker | `GET` | `/console/api/workspaces/current/human-input/contact-options` | `WorkspaceContactOptionsApi` | 为 workflow editor 分页搜索当前 workspace 可选择的静态 recipient，只返回最小 Contact projection |
| Contact picker | `GET` | `/console/api/workspaces/current/human-input/contact-options/batch` | `BatchGetContactOptionsAPI` | 按已保存的 Contact ID 批量回显静态 recipient，使用与搜索接口相同的最小 projection |
| Contacts | `GET` | `/console/api/workspaces/current/human-input/organization-candidates` | `WorkspaceHumanInputOrganizationCandidatesApi` | 在 EE 中搜索可加入当前 workspace Contact 的 Organization member candidate；CE / SaaS 若保留实现，可直接报 edition-not-supported |
| Contacts | `POST` | `/console/api/workspaces/current/human-input/contacts/platform` | `WorkspaceHumanInputPlatformContactsApi` | 在 EE 中批量把 Organization member 加入当前 workspace Contact 并落成 `Platform contact`；CE / SaaS 若保留实现，可直接报 edition-not-supported |
| Contacts | `POST` | `/console/api/workspaces/current/human-input/contacts/external` | `WorkspaceHumanInputExternalContactsApi` | 创建 external contact |
| Contacts | `PATCH` | `/console/api/workspaces/current/human-input/contacts/external/<uuid:contact_id>` | `WorkspaceHumanInputExternalContactApi` | 更新 external contact |
| Contacts | `POST` | `/console/api/workspaces/current/human-input/contacts/remove` | `WorkspaceHumanInputContactsRemoveApi` | 批量 remove `Platform contact` / `External contact`；对 platform 执行 detach，对 external 执行 delete；`workspace contact` 不在此 API 范围内 |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceHumanInputIMIntegrationApi` | 读取当前 Organization 级 IM integration 摘要 |
| IM | `PUT` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceHumanInputIMIntegrationApi` | 保存或更新 IM integration |
| IM | `DELETE` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceHumanInputIMIntegrationApi` | 解除当前 IM integration，并回到 `Not configured` |
| IM | `POST` | `/console/api/workspaces/current/human-input/im-integration/test` | `WorkspaceHumanInputIMIntegrationTestApi` | 校验当前 provider credentials / callback / permission |
| IM | `POST` | `/console/api/workspaces/current/human-input/im-sync-runs` | `WorkspaceHumanInputIMSyncRunsApi` | 手动触发一次 IM sync |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest` | `WorkspaceHumanInputLatestIMSyncRunApi` | 读取最近一次 sync run 的 summary；若当前还没有任何 run，则返回 not-found |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest/results` | `WorkspaceHumanInputLatestIMSyncRunResultsApi` | 按 `result` 分页读取最近一次 sync run 的结果条目 |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-identities` | `WorkspaceHumanInputIMIdentitiesApi` | 搜索可供 contact 绑定或 override 的已同步 IM identity |
| IM | `PUT` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceHumanInputContactIMOverrideApi` | 绑定或替换当前 workspace 的 IM override |
| IM | `DELETE` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceHumanInputContactIMOverrideApi` | Reset to global |

`organization-candidates` 与 `contacts/platform` 这两类 endpoint 只在 EE 里有实际业务含义。CE / SaaS 如果为了减少分支复杂度保留相同路由，实现上允许直接返回 edition-not-supported；但文档语义上它们仍然是 EE-only capability。

Contact API 的 workspace-scoped resolution 结果只有 `WORKSPACE / PLATFORM / EXTERNAL / ABSENT`。前三类可以出现在列表和单条读取中；`ABSENT` 不得出现在列表里，按 `contact_id` 读取时返回 `404 Not Found`。CE / SaaS member 被移除、External contact 被删除时 current Contact 已 hard-delete；EE member 被移除且未 retain 时 Organization-level canonical Contact 仍存在，但当前 workspace 必须解析为 `ABSENT`，其他 workspace 不受影响。历史 workflow、task 与 audit 只能读取创建时冻结的 snapshot，不得通过当前 Contact API 回查历史展示数据。

Contact management 与 workflow recipient selection 不共享响应 DTO 或权限边界。`contacts` list/detail/batch 是 owner/admin 管理读取面；`contact-options` list/batch 使用 edit permission，服务 workflow editor 的静态 recipient picker，只返回 `id / type / name / avatar_url`。普通 member 不能借该 projection 浏览目录。两个 `contact-options` endpoint 都必须基于当前 workspace 的 resolution 过滤 `ABSENT`、hard-deleted 或其他 unavailable Contact；batch 用于回显 workflow 中已保存的 Contact ID，不能通过当前 API 恢复历史 snapshot。

IM integration update 必须区分 credential rotation 与 platform tenant replacement。provider 相同且 provider adapter 能确认 `platform_tenant_id` 未变化时，系统必须保留现有 IM identities、Organization bindings 与 workspace overrides。provider 变化、`platform_tenant_id` 变化或无法确认其未变化时，系统必须按 replacement 处理，使旧 bindings / overrides 失效并要求重新执行 manual sync。

IM integration 是本 capability 唯一使用 optimistic concurrency 的 aggregate root。读取结果必须返回稳定的 `integration_id` 与单调递增的 `config_version`；对既有 integration 的更新和删除必须携带二者作为 compare-and-swap token，不匹配时返回 conflict，且不得修改配置、清理 binding 或触发 sync。首次创建时不存在 CAS token。token 必须同时包含 ID 与 version，避免解除绑定后创建新 integration 且 version 重新从 1 开始时出现 ABA。

Upsert request 中 `expected_integration_id` 与 `expected_config_version` 必须同时存在或同时省略：当前状态为 `Not configured` 的首次创建必须省略二者；更新既有 integration 必须同时提供二者；只提供其中一个或在已有 integration 时省略 token 都必须被拒绝。

只有会改变 provider、credentials、`platform_tenant_id` 或其他 directory sync 语义的配置写入才递增 `config_version`。连接测试结果、`last_checked_at`、安全诊断信息和 sync summary 不得递增该 revision。每个 sync run 必须保存创建时的 `integration_id + config_version`；worker 应用 current identity / binding reconciliation 前必须重新比较 revision，不匹配时必须拒绝 stale write。Contact、IM identity、IM binding、approver grant、delivery endpoint 与 OTP challenge 不使用独立 version 字段，授权路径直接重查 current state。

同步 UI 只消费 latest-run contract，不新增 run-by-ID、run list 或任意历史 run detail API。`GetLatestIMSyncRun` 返回 run metadata、作为 UI 显式同步时间的 `finished_at` 和 aggregate counts，且不返回 `started_by`。`ListLatestIMSyncRunResults` 必须指定一个真实 result bucket，不支持 `All` 或省略 filter，并使用 `page / limit` 分页；响应返回 `page / limit / total`，不使用 cursor，也不重复 summary。需要展示同步详情的客户端必须同时请求 latest run 与 latest results。sync result item 不携带 Contact type；IM identity 搜索 keyword 必须覆盖 provider user ID。

remove 不再按 `platform` / `external` 分成两条单条 DELETE。原因有两个：

- UI 允许在列表中批量勾选 `Platform contact` 与 `External contact`
- `workspace contact` 的移除归属 membership management，不应该在 Human Input Contact surface 再复制一套成员移除 API

没有新增 task list、notification center 等额外接口，因为 PRD 本期并不需要。

### 4. Draft v2 API 保留 preview / run，并独立新增 `message-template/test`

`humaninput_v2` 已经没有 v1 那种 `delivery_method_id` 驱动的 delivery config，因此 draft debug 侧保留两条既有 path capability，并为 v2 独立新增测试接口。v1 `delivery-test` 路由、完整 v1 node model 与 request contract 保持不变；preview / run handler 必须按 node version 分派到独立的 v1 / v2 逻辑，不能把一侧 payload 交给另一侧实现：

| Method | Path | Existing / New | Purpose |
| --- | --- | --- | --- |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | existing | 渲染表单预览，继续只接收 `inputs` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/run` | existing | 运行草稿表单提交，继续接收 `form_inputs`、`inputs`、`action` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | new | 按 `DebugChannel` 向当前编辑者发送模板测试消息 |

`advanced-chat` 模式沿用同一组 preview / run 路由前缀；是否需要 `advanced-chat/.../message-template/test`，实现阶段也沿用同样 pattern。

放弃方案：

- 把 v1 `delivery-test` alias 到 v2 `message-template/test`，或把 `delivery_method_id` 映射到某个新 transport enum。
  原因：这会让 v1 delivery model 与 v2 recipient / template / debug channel 结构交叉提交。

### 5. 手动 batch node-data migration helper 只负责转换与校验

用户手动确认迁移后，前端调用下面的 workspace console helper，把一组 legacy Human Input node data 批量转换为 v2 node data：

| Method | Path | View | Purpose |
| --- | --- | --- | --- |
| `POST` | `/console/api/workspaces/current/human-input/node-data-migration` | `NodeDataMigrationAPI` | 基于当前 tenant 的 member / Contact 状态批量转换 v1 node data；全部成功时返回完整 v2 node data，任一失败时返回整批错误 |

这个 endpoint 的边界是：

- 它是一个 batch、side-effect-free conversion helper，不是“执行整个 migration”的后端 API。
- 调用方负责在发起请求前取得用户的显式迁移确认；由于 endpoint 不产生持久化副作用，不新增形式化但无法证明真实意图的 `confirmed` 字段。
- endpoint MUST NOT 更新 workflow DSL、draft、published workflow、graph state 或 migration history。
- request 中 legacy node data 缺失 `version` 时按历史兼容语义默认成字符串 `"1"`；显式 `version` 只允许精确字符串 `"1"`，其他字符串或非字符串值必须拒绝。migration envelope 与 legacy node data 的额外字段直接忽略，以允许旧 DSL 携带当前 helper 不消费的字段。
- 同一个 request 内的 `node_id` MUST 唯一；重复 `node_id` 必须在转换前拒绝。
- member / Contact resolution MUST 限制在当前 tenant / Organization 边界内。
- 一次请求中的所有节点 MUST 使用同一个稳定的 tenant-scoped member / Contact resolution snapshot。在相同批量输入和相同 snapshot 下，转换结果 MUST 确定且可重复；重试 MUST 是幂等且无副作用的。
- endpoint MUST 在返回成功前为全部输入节点生成完整的新 schema。只要任一节点无法生成完整 v2 node data，整个请求 MUST 返回 `400 Bad Request`，MUST 提供与失败 `node_id` 关联的 machine-readable blocker code / context，并 MUST NOT 返回任何成功节点的部分 v2 node data。初始 blocker taxonomy 是由后端定义、供前端原样展示的稳定 contract：`unsupported-version`、`configured-disabled-method`、`unsupported-delivery-method`、`invalid-email-configuration`、`invalid-email`、`unresolved-member`、`conflicting-email-templates`、`missing-recipients`。
- 唯一允许的受控有损例外是 legacy Email `whole_workspace: true`。由于 v2 没有等价的动态“all workspace member” recipient，helper MUST 将其物化为“迁移当下当前 workspace contact / member resolution snapshot”的静态 recipient 列表，并保持稳定顺序、fallback 与去重规则；该场景返回转换结果而不是 blocker。
- 对迁移节点集合的选择、graph replacement、draft sync 与 rollback 继续由 frontend migration flow 负责。helper 只返回整批转换结果或整批错误，不负责 graph/draft orchestration。

职责矩阵需要在本 change 中显式固定：

- frontend migration flow owns：
  - 展示 banner / dialog，并对当前待迁移的 legacy node 集合取得显式确认。
  - 维护当前 draft 中 legacy Human Input node 的可见性、gating 与手动发起入口。
  - 组装整批 migration request，并展示后端返回的 node-scoped blocker。
  - 只在整批节点均成功生成新 schema 时，执行一次 graph/history transaction replacement。
  - 调用现有 draft sync、rollback、history / collaboration orchestration。
- backend node-data migration helper owns：
  - 校验 batch request 及每个 legacy node 的 request shape。
  - 基于一个 request-scoped snapshot，在当前 tenant / Organization 边界内做 recipient / member / Contact resolution。
  - 为全部节点产出 v2 node data，默认要求无损；唯一允许的受控有损例外是 `whole_workspace: true` 的静态快照化迁移。
  - 保证 all-or-error、deterministic、idempotent、side-effect-free 的 helper 语义。
- 因此 backend helper 是 migration flow 中唯一的 node-data converter / validator；前端不得保留另一套 recipient resolution 或 schema conversion。它仍然不是 migration orchestrator，也不是 draft mutation API。

`add-human-input-v2-migration-ui` 不实现 backend API，而是消费本 change 定义的 contract，并把成功响应中的完整节点定义作为原子 graph replacement 的唯一输入。

### 6. Runtime form 按具体 owner 回溯配置，不复制完整 node configuration snapshot

`Workflow` 数据库记录本身是不可变的 workflow revision。对于 workflow-owned runtime form，静态 `HumanInputNodeData` 的 source of truth MUST 是创建该 form 的 immutable Workflow revision，系统 MUST NOT 再为同一份节点配置建立独立的 `HumanInputFormSnapshot` 或其他完整 node configuration 副本。

不同 form surface 的 ownership 与持久化语义如下：

| Form surface | Persistent `HumanInputForm` | Owner / configuration source |
| --- | --- | --- |
| Workflow runtime，包括 debugger execution | 是 | `workflow_run_id` 指向 `WorkflowRun`，再由 `WorkflowRun.workflow_id` 回溯 immutable Workflow revision 和 `node_id` |
| Draft form preview / preview submit | 否 | 直接读取当前 draft Workflow revision；preview 结果不创建 runtime form |
| Message template / delivery test | 可以创建 `DELIVERY_TEST` form，但不要求 `workflow_run_id` | 该记录只是测试投递的临时 carrier；`form_definition`、`rendered_content` 和 delivery records 已包含测试所需事实，不保存完整 `HumanInputNodeData` 副本 |
| Agent v2 chat `ask_human` | 是，但可以没有 `workflow_run_id` | 由 `conversation_id` 拥有；node data 在运行时动态生成，form 只冻结实际展示、审批主体和投递所需的 resolved facts |

`RUNTIME` form MUST 至少存在 `workflow_run_id` 或 `conversation_id` 之一。静态配置与运行时事实的边界如下：

- Immutable Workflow revision 负责保存 workflow-owned form 的静态节点配置。
- `HumanInputForm.form_definition` 与 `rendered_content` 负责保存实际展示和提交校验所需的表单定义。
- Approver grant 负责保存 task 创建时解析出的授权 subject、匹配来源和最小展示快照。Grant subject 只允许 `Contact / EndUser / EmailAddress`；能够解析为 Contact 的 workspace Account、Platform Contact、External Contact 和 dynamic Email 必须使用 Contact-backed grant。
- `ApproverGrant.subject_key` 只用于跨数据库可移植的 form-scoped canonicalization 与唯一约束，不是新的 identity 类型。格式固定为 `contact:<contact_id>`、`end_user:<end_user_id>` 或 `email_address:<sha256(normalized_email)>`；授权仍必须读取对应的 discriminated subject 字段。
- Delivery endpoint 负责保存实际投递或交互地址。Address 是 endpoint 自身的 immutable fact，不是 Grant subject snapshot。
- Submission 负责保存首次成功提交的 action、form data 和实际 actor。Submission actor 只允许 `Account / EndUser / EmailAddress`；IM identity 必须通过 current binding 和 Contact 解析为 Account actor，不能成为独立 actor 类型。
- 成功提交必须引用同一事务内创建的 `submission_authorized` AuditEvent。该 AuditEvent 负责保存 verified authorization proof；Submission 不复制 proof，AuditEvent 也不复制 Submission 的 action、data 或 actor。
- Authorization proof 使用 `AccountSession / EmailOTP / IMIdentity / TrustedEndUser` discriminated union。IM proof 的外部身份核心必须是 `provider + platform_tenant_id + platform_user_id`，并冻结当时用于展示的 `display_name / email`。historical integration / identity / binding ID 只作为内部 trace；display fields 不参与授权判断。系统不得持久化 OTP plaintext、session cookie、callback signature 或 API token。
- Delivery attempt 与其他 AuditEvent 负责保存投递结果、拒绝原因和没有 Submission 承载的失败历史事实。

因此，历史回溯需要冻结的是 recipient resolution、delivery endpoint、rendered content 与 submission 等运行时结果，而不是复制已经不可变的 workflow node configuration。

### 7. Public Email page 与 authenticated Contact page 按鉴权方式拆分

页面本身就是提交鉴权方式和 API namespace 的边界。`External contact`、one-time Email 与未命中 Contact 的 dynamic Email 使用 public Email page 和 `/api` web API namespace；`workspace contact` 与 `Platform contact` 使用独立的 authenticated page 和 `/console/api` namespace。两者可以复用 version-neutral 表单展示组件，但不能复用 controller、request DTO、transport state、token scope 或提交鉴权逻辑。

Public Email runtime contract 收敛为四个 endpoint：

| Method | Path | View | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/form/human-input/<form_token>` | `HumanInputFormApi` | 为 Email proof approver 返回 form definition |
| `POST` | `/api/form/human-input/<form_token>/access-request` | `HumanInputFormAccessRequestApi` | 向 token 绑定的 email recipient 发送 OTP，并返回 challenge token、重发冷却与过期时间 |
| `POST` | `/api/form/human-input/<form_token>/upload-token` | `HumanInputFormUploadTokenApi` | 为 file / file-list input 申请 upload token；继续仅凭 `form_token` 工作 |
| `POST` | `/api/form/human-input/<form_token>` | `HumanInputFormApi` | 提交表单；对需要 Email proof 的 recipient 在提交时要求 `otp_code + challenge_token` |

Authenticated Contact submit 使用独立的 console endpoint：

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/console/api/form/human-input/<form_token>` | 使用 Dify session 和当前 Contact / approver grant 校验后提交表单；不接受 `otp_code` 或 `challenge_token` |

这里的核心选择是：public Email `form_token` 可以作为查看表单和上传文件的入口，但 MUST NOT 单独作为提交授权凭证；public submit 只接受 OTP Challenge proof。Authenticated Contact submit 必须经过 console API authentication 和当前 Contact / approver 关系校验，并且不得调用 public `access-request`。两个 submit endpoint 即使共享底层 version-neutral submission primitive，也必须拥有独立 controller、request DTO 和 auth guard。任一 endpoint 收到另一 surface 的 token、grant 或 proof 字段都必须拒绝，而不能路由或回退到另一种鉴权方式。

### 8. Service API 继续保持 trusted app-token surface，但 GET / POST 都必须显式带 `user`

Service API 不需要 OTP challenge，但必须和 current initiator 规则一致：`user` 是唯一可接受的 end-user context。

| Method | Path | View | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/form/human-input/<form_token>?user=<string>` | `WorkflowHumanInputFormApi` | 读取 form definition；没有 `user` 时直接拒绝 |
| `POST` | `/v1/form/human-input/<form_token>` | `WorkflowHumanInputFormApi` | 提交 form；要求 JSON body 带 `user / inputs / action`，不接受 public web OTP proof 字段 |

选择 GET 也强制 `user` 的原因：

- 读取 form 本身就是一次 access decision。
- 如果只在 POST 时校验 `user`，Service API client 会继续把“读 form”当成 token-only ability，和 PRD 的访问模型冲突。

没有新增 service API `access-request` / dedicated upload endpoint，因为 trusted app-token caller 继续复用当前 app-scoped end-user model 与现有 file upload 流程。

### 9. EE 管理后台 PB 只承担 Organization 级 IM 与 Contact binding control-plane

EE 这次只新增 org-level IM integration、manual sync 与 Organization Contact IM binding protobuf / `google.api.http` contract，不扩展 member / workspace 基础 CRUD、workspace Contact lifecycle 或 workspace override：

| Method | Path | RPC | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/dashboard/api/human-input/im-integration` | `GetHumanInputIMIntegration` | 读取当前部署唯一的 IM channel 配置摘要 |
| `PUT` | `/v1/dashboard/api/human-input/im-integration` | `UpsertHumanInputIMIntegration` | 保存或更新 IM channel credentials |
| `DELETE` | `/v1/dashboard/api/human-input/im-integration` | `DeleteHumanInputIMIntegration` | 清空当前 IM integration |
| `POST` | `/v1/dashboard/api/human-input/im-integration/test` | `TestHumanInputIMIntegration` | 执行连接 / callback / permission test |
| `POST` | `/v1/dashboard/api/human-input/im-sync-runs` | `CreateIMSyncRun` | 手动触发 sync |
| `GET` | `/v1/dashboard/api/human-input/im-sync-runs/latest` | `GetLatestIMSyncRun` | 读取最近一次 sync run 的 summary |
| `GET` | `/v1/dashboard/api/human-input/im-sync-runs/latest/results` | `ListLatestIMSyncRunResults` | 按 `result` 分页读取最近一次 sync run 的结果条目 |
| `GET` | `/v1/dashboard/api/human-input/contacts` | `ListHumanInputContacts` | 按 member name / Email 分页读取 Organization Contact、`created_at` 与 channel summary；UI 将 `created_at` 展示为 `Joined` |
| `GET` | `/v1/dashboard/api/human-input/im-identities` | `ListHumanInputIMIdentities` | 按 provider 与 IM user ID 搜索已同步 identity |
| `POST` | `/v1/dashboard/api/human-input/contacts/{contact_id}/im-bindings` | `CreateHumanInputIMBinding` | 为 Organization Contact 创建 IM binding |
| `DELETE` | `/v1/dashboard/api/human-input/contacts/{contact_id}/im-bindings/{binding_id}` | `DeleteHumanInputIMBinding` | 删除指定 Organization Contact binding |
| `POST` | `/v1/dashboard/api/human-input/contacts/{contact_id}/im-bindings/{binding_id}/test` | `TestHumanInputIMBinding` | 测试指定联系人 binding 的 identity reachability |

EE workspace console 搜索当前 workspace 之外的 `organization contact` 并把它们投影成 `Platform contact` 时，应继续复用 enterprise 侧已有 member / workspace API，而不是在 Human Input 侧复制一套新的成员 CRUD。

`TestHumanInputIMBinding` 与 `TestHumanInputIMIntegration` 的语义必须分离：前者验证某个已绑定 Contact identity 的当前可达性，后者验证 Organization 级 credentials、callback 与 permission。

EE `HumanInputContact` 生命周期绑定 Organization Account，不绑定任意单个 workspace membership。Account 仍属于当前 EE Organization 时，加入或离开单个 workspace 不得重建 Contact identity，列表中的 `Joined` 直接展示 Contact `created_at`。

## Risks / Trade-offs

- [v1 / v2 token 串用] -> 保留独立路径、DTO、controller 与 token owner lookup：v1 token 只从 legacy recipient 记录解析，v2 token 只从 delivery endpoint token hash 解析；任一 surface 都必须拒绝另一版本的 token
- [Service API GET 新增 `user` 可能破坏旧调用] -> 先上线显式文档与 SDK 适配，再切换为强制校验
- [upload-token 先于 OTP 校验会增加滥用面] -> 继续沿用现有 upload 限流与 task state 校验，并在 submit 时执行最终 OTP / approver 校验，避免把“上传成功”等价成“审批成功”
- [EE 和 workspace console 边界模糊] -> PB 只负责 org-level IM integration / sync 与 Organization Contact binding control-plane；`Platform contact` candidate / add、External Contact、workspace override、migration 与 Email provider 仍归 workspace console 或独立配置 surface
- [`delivery-test` 到 `message-template/test` 的切换会影响前端联调] -> v1 继续保留原 contract，v2 只维护新 request/response contract，避免跨版本复用提交逻辑
- [Backend conversion contract 与 frontend orchestration 漂移] -> 后端独占语义转换和稳定 blocker taxonomy；前端只校验 batch response 的完整性与 `node_id` 关联，并原样应用返回的节点定义

## Migration Plan

1. 落地无副作用的 node-data migration helper、tenant-scoped resolution 与稳定 blocker contract。
2. 为 web / service / console form API 加入独立 `human-input` v2 路由；现有 `human_input` v1 路由与完整 v1 node model 保持不变，并增加跨版本 token 拒绝测试。
3. 分别落地 public web 的 `access-request` / token-based `upload-token` / OTP-guarded `submit`，以及 authenticated Contact 的 session-guarded console `submit`。
4. 保留 v1 draft `delivery-test`，为 v2 独立接入 `message-template/test`，并确保 preview / run 按 node version 分派。
5. 在 EE 侧增加 IM integration / sync proto，再让 EE 部署下的 workspace console 调用新的 enterprise backend control-plane。
