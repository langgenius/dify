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

1. Public web form 需要从 token-only access 收口为符合 PRD 的 submit-time approval proof model。
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

### 1. Surface 按职责拆成四层，而不是做一个“大 Human Input API”

接口按调用者与鉴权方式拆成四层：

- Workspace console：`/console/api/workspaces/current/human-input/...`
- Draft workflow / advanced-chat：沿用 `/console/api/apps/<app_id>/.../draft/human-input/...`
- Public web：`/api/form/human-input/<form_token>/...`
- Service API：`/v1/form/human-input/<form_token>/...`
- EE dashboard admin：`/v1/dashboard/api/human-input/...`

选择这条路线的原因：

- 现有仓库本身就是按 namespace 和 auth model 拆 controller。
- PRD 对 workspace admin、workflow editor、external approver、Service API caller、EE admin 的权限要求不同，放在一个 surface 里只会把 auth 逻辑搅乱。

放弃方案：

- 用一个新的 `/human-input/tasks/...` 总入口统一所有 surface。
  原因：会违背现有 controller 组织方式，也会把 `form` 与 `task` 两套术语重新混在一起。

### 2. Runtime noun 保留 `form`，URL segment 统一改成 `human-input`

路径命名统一使用：

- noun：`form`
- url part：`human-input`

因此新 contract 使用：

- `/api/form/human-input/<form_token>`
- `/v1/form/human-input/<form_token>`
- `/console/api/form/human-input/<form_token>`

而不是：

- `/task/...`
- `/hitl/...`
- `/human_input/...`

实现阶段可以短期保留旧下划线路径作为 alias，但文档与新代码都应该以 `human-input` 为准。

### 3. Workspace console 按 edition 暴露 contact / IM 接口

workspace console endpoint 收敛为三组，其中 `Platform contact` candidate / add 是 EE-only capability；remove 则统一走一个批量 API。

| Group | Method | Path | View | Purpose |
| --- | --- | --- | --- | --- |
| Contacts | `GET` | `/console/api/workspaces/current/human-input/contacts` | `WorkspaceHumanInputContactsApi` | 浏览当前 workspace Contact，支持 `all / workspace / platform / external` 分组；其中 `platform` 表示非当前 workspace member 的 `Platform contact` |
| Contacts | `GET` | `/console/api/workspaces/current/human-input/organization-candidates` | `WorkspaceHumanInputOrganizationCandidatesApi` | 在 EE 中搜索可加入当前 workspace Contact 的 Organization member candidate；CE / SaaS 若保留实现，可直接报 edition-not-supported |
| Contacts | `POST` | `/console/api/workspaces/current/human-input/contacts/platform` | `WorkspaceHumanInputPlatformContactsApi` | 在 EE 中批量把 Organization member 加入当前 workspace Contact 并落成 `Platform contact`；CE / SaaS 若保留实现，可直接报 edition-not-supported |
| Contacts | `POST` | `/console/api/workspaces/current/human-input/contacts/external` | `WorkspaceHumanInputExternalContactsApi` | 创建 external contact |
| Contacts | `PATCH` | `/console/api/workspaces/current/human-input/contacts/external/<uuid:contact_id>` | `WorkspaceHumanInputExternalContactApi` | 更新 external contact |
| Contacts | `POST` | `/console/api/workspaces/current/human-input/contacts/remove` | `WorkspaceHumanInputContactsRemoveApi` | 批量 remove `Platform contact` / `External contact`；对 platform 执行 detach，对 external 执行 delete；`workspace contact` 不在此 API 范围内 |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceHumanInputIMIntegrationApi` | 读取当前 Organization 级 IM integration 摘要 |
| IM | `PUT` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceHumanInputIMIntegrationApi` | 保存或更新 IM integration |
| IM | `POST` | `/console/api/workspaces/current/human-input/im-integration/test` | `WorkspaceHumanInputIMIntegrationTestApi` | 校验当前 provider credentials / callback / permission |
| IM | `POST` | `/console/api/workspaces/current/human-input/im-sync-runs` | `WorkspaceHumanInputIMSyncRunsApi` | 手动触发一次 IM sync |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest` | `WorkspaceHumanInputLatestIMSyncRunApi` | 读取最近一次 sync run 的 summary；若当前还没有任何 run，则返回 not-found |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest/results` | `WorkspaceHumanInputLatestIMSyncRunResultsApi` | 按 `result` 分页读取最近一次 sync run 的结果条目 |
| IM | `GET` | `/console/api/workspaces/current/human-input/im-identities` | `WorkspaceHumanInputIMIdentitiesApi` | 搜索可供 contact 绑定或 override 的已同步 IM identity |
| IM | `PUT` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceHumanInputContactIMOverrideApi` | 绑定或替换当前 workspace 的 IM override |
| IM | `DELETE` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceHumanInputContactIMOverrideApi` | Reset to global |

`organization-candidates` 与 `contacts/platform` 这两类 endpoint 只在 EE 里有实际业务含义。CE / SaaS 如果为了减少分支复杂度保留相同路由，实现上允许直接返回 edition-not-supported；但文档语义上它们仍然是 EE-only capability。

remove 不再按 `platform` / `external` 分成两条单条 DELETE。原因有两个：

- UI 允许在列表中批量勾选 `Platform contact` 与 `External contact`
- `workspace contact` 的移除归属 membership management，不应该在 Human Input Contact surface 再复制一套成员移除 API

没有新增 contact detail、task list、notification center 等额外接口，因为 PRD 本期并不需要。

### 4. Draft v2 API 保留 preview / run，但把 `delivery-test` 改成 `message-template/test`

`humaninput_v2` 已经没有 v1 那种 `delivery_method_id` 驱动的 delivery config，因此 draft debug 侧保留两条既有能力并替换一条旧接口：

| Method | Path | Existing / New | Purpose |
| --- | --- | --- | --- |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | existing | 渲染表单预览，继续只接收 `inputs` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/run` | existing | 运行草稿表单提交，继续接收 `form_inputs`、`inputs`、`action` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | new | 按 `DebugChannel` 向当前编辑者发送模板测试消息 |

`advanced-chat` 模式沿用同一组 preview / run 路由前缀；是否需要 `advanced-chat/.../message-template/test`，实现阶段也沿用同样 pattern。

放弃方案：

- 保留 v1 `delivery-test` 并把 `delivery_method_id` 映射到某个新 transport enum。
  原因：这会把 v1 delivery model 强行延长寿命，和 v2 DSL 的 recipient / template / debug channel 结构冲突。

### 5. 手动 batch node-data migration helper 只负责转换与校验

用户手动确认迁移后，前端调用下面的 workspace console helper，把一组 legacy Human Input node data 批量转换为 v2 node data：

| Method | Path | View | Purpose |
| --- | --- | --- | --- |
| `POST` | `/console/api/workspaces/current/human-input/node-data-migration` | `NodeDataMigrationAPI` | 基于当前 tenant 的 member / Contact 状态批量转换 v1 node data；全部成功时返回完整 v2 node data，任一失败时返回整批错误 |

这个 endpoint 的边界是：

- 它是一个 batch、side-effect-free conversion helper，不是“执行整个 migration”的后端 API。
- 调用方负责在发起请求前取得用户的显式迁移确认；由于 endpoint 不产生持久化副作用，不新增形式化但无法证明真实意图的 `confirmed` 字段。
- endpoint MUST NOT 更新 workflow DSL、draft、published workflow、graph state 或 migration history。
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

### 6. Public web access 改成“token read / upload + submit-time OTP”的提交校验模型

按当前业务定义，审批动作发生在 `submit`，不是打开页面。因此 public web runtime contract 收敛为四个 endpoint：

| Method | Path | View | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/form/human-input/<form_token>` | `HumanInputFormApi` | 直接返回 form definition |
| `POST` | `/api/form/human-input/<form_token>/access-request` | `HumanInputFormAccessRequestApi` | 向 token 绑定的 email recipient 发送 OTP |
| `POST` | `/api/form/human-input/<form_token>/upload-token` | `HumanInputFormUploadTokenApi` | 为 file / file-list input 申请 upload token；继续仅凭 `form_token` 工作 |
| `POST` | `/api/form/human-input/<form_token>` | `HumanInputFormApi` | 提交表单；对需要 Email proof 的 recipient 在提交时要求 `otp_code` |

这里的核心选择是把“打开页面”和“审批提交”拆开理解：`form_token` 可以作为查看表单和上传文件的入口，但 MUST NOT 单独作为提交授权凭证；真正的审批资格只在 `submit` 时通过 OTP / 登录态 / 当前 approver 关系校验。

### 7. Service API 继续保持 trusted app-token surface，但 GET / POST 都必须显式带 `user`

Service API 不需要 OTP challenge，但必须和 current initiator 规则一致：`user` 是唯一可接受的 end-user context。

| Method | Path | View | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/form/human-input/<form_token>?user=<string>` | `WorkflowHumanInputFormApi` | 读取 form definition；没有 `user` 时直接拒绝 |
| `POST` | `/v1/form/human-input/<form_token>` | `WorkflowHumanInputFormApi` | 提交 form；继续要求 JSON body 带 `user` |

选择 GET 也强制 `user` 的原因：

- 读取 form 本身就是一次 access decision。
- 如果只在 POST 时校验 `user`，Service API client 会继续把“读 form”当成 token-only ability，和 PRD 的访问模型冲突。

没有新增 service API `access-request` / dedicated upload endpoint，因为 trusted app-token caller 继续复用当前 app-scoped end-user model 与现有 file upload 流程。

### 8. EE 管理后台 PB 只承担 Organization 级 IM control-plane

EE 这次只新增 org-level IM integration 与 manual sync protobuf / `google.api.http` contract，不扩展 member / workspace 基础 CRUD：

| Method | Path | RPC | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/dashboard/api/human-input/im-integration` | `GetHumanInputIMIntegration` | 读取当前部署唯一的 IM channel 配置摘要 |
| `PUT` | `/v1/dashboard/api/human-input/im-integration` | `UpsertHumanInputIMIntegration` | 保存或更新 IM channel credentials |
| `DELETE` | `/v1/dashboard/api/human-input/im-integration` | `DeleteHumanInputIMIntegration` | 清空当前 IM integration |
| `POST` | `/v1/dashboard/api/human-input/im-integration/test` | `TestHumanInputIMIntegration` | 执行连接 / callback / permission test |
| `POST` | `/v1/dashboard/api/human-input/im-sync-runs` | `CreateIMSyncRun` | 手动触发 sync |
| `GET` | `/v1/dashboard/api/human-input/im-sync-runs/latest` | `GetLatestIMSyncRun` | 读取最近一次 sync run 的 summary |
| `GET` | `/v1/dashboard/api/human-input/im-sync-runs/latest/results` | `ListLatestIMSyncRunResults` | 按 `result` 分页读取最近一次 sync run 的结果条目 |

EE workspace console 搜索当前 workspace 之外的 `organization contact` 并把它们投影成 `Platform contact` 时，应继续复用 enterprise 侧已有 member / workspace API，而不是在 Human Input 侧复制一套新的成员 CRUD。

## Risks / Trade-offs

- [旧下划线路径兼容性] -> 通过短期 alias 保住旧 client，再把文档和新调用统一切到 `human-input`
- [Service API GET 新增 `user` 可能破坏旧调用] -> 先上线显式文档与 SDK 适配，再切换为强制校验
- [upload-token 先于 OTP 校验会增加滥用面] -> 继续沿用现有 upload 限流与 task state 校验，并在 submit 时执行最终 OTP / approver 校验，避免把“上传成功”等价成“审批成功”
- [EE 和 workspace console 边界模糊] -> PB 只负责 org-level IM control-plane；`Platform contact` candidate / add 仍归 workspace console，但它是 EE-only capability，底层继续消费 enterprise member / workspace APIs
- [`delivery-test` 到 `message-template/test` 的切换会影响前端联调] -> 允许短期兼容 alias，但 v2 只维护新 request/response contract，避免双模型长期共存
- [Backend conversion contract 与 frontend orchestration 漂移] -> 后端独占语义转换和稳定 blocker taxonomy；前端只校验 batch response 的完整性与 `node_id` 关联，并原样应用返回的节点定义

## Migration Plan

1. 落地无副作用的 node-data migration helper、tenant-scoped resolution 与稳定 blocker contract。
2. 为 web / service / console form API 加入 `human-input` 正式路由；旧 `human_input` 路由按兼容需要保留一段时间。
3. 落地 public web 的 `access-request` / token-based `upload-token` / OTP-guarded `submit`。
4. 将 draft debug 从 `delivery-test` 切到 `message-template/test`，并同步前端联调。
5. 在 EE 侧增加 IM integration / sync proto，再让 EE 部署下的 workspace console 调用新的 enterprise backend control-plane。

## Open Questions

- 非阻塞问题只有一个：旧 `human_input` 路由 alias 需要保留多久，取决于前端与第三方 client 的迁移节奏。其余 contract 已经足够进入实现。
