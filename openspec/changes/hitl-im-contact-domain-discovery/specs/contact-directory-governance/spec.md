## ADDED Requirements

### Requirement: Contact 类型与 Organization / Workspace 作用域
系统 MUST 先将 HITL 联系人按来源区分为 `organization contact` 与 `External contact`。凡属于当前 `Organization` 的成员，对应的联系人都 MUST 视为 `organization contact`。`organization contact` 在当前 workspace 内的子类 MUST 是 `workspace contact`；同一 `Organization` 内但不属于当前 workspace 的子类 MUST 是 `Platform contact`。系统 MUST NOT 将任何 `organization contact` 归类为 `External contact`。

#### Scenario: SaaS / CE member 自动进入 Contact
- **WHEN** a workspace member exists or is newly added in SaaS or CE
- **THEN** 系统 MUST 自动将该成员纳入当前 workspace Contact 列表，并将其视为 `organization contact` 下的 `workspace contact`

#### Scenario: EE 添加跨 workspace 成员
- **WHEN** a workspace admin adds a member from the same Organization but another workspace
- **THEN** 系统 MUST 将该对象作为 `organization contact` 下的 `Platform contact` 加入当前 workspace Contact，而不是 `External contact`

### Requirement: External contact 准入规则
系统 MUST 仅允许不属于当前 `Organization` 的对象成为 `External contact`。任何已属于当前 `Organization` 的成员，无论其最终落成 `workspace contact` 还是 `Platform contact`，都 MUST 视为 `organization contact` 而不是 `External contact`。系统 MUST 要求 external contact 提供合法 Email，并 MUST 使用整条 email lower-case 后完全相等的规则做重复判断。

#### Scenario: 创建合法 external contact
- **WHEN** a workspace admin submits a non-Dify email that is unique within the workspace
- **THEN** 系统 MUST 允许创建 `External contact`，并要求后续仅通过 Email 触达该联系人

#### Scenario: Email 命中内部联系人时拒绝创建 external contact
- **WHEN** a workspace admin submits an email that matches any existing `organization contact` in the current Organization scope
- **THEN** 系统 MUST 拒绝创建 `External contact`，并 MUST 提示该对象应按平台内联系人处理

### Requirement: Contact 生命周期随成员状态变化
系统 MUST 在 workspace 成员状态变化后更新该成员在 Contact 中的可选性。workspace-scoped resolution MUST 产出 `WORKSPACE`、`PLATFORM`、`EXTERNAL` 或 `ABSENT`；前三类允许由当前 Contact API 返回，`ABSENT` 不得出现在列表中，按 `contact_id` 读取时 MUST 返回 `404 Not Found`。历史 workflow 配置、历史 task 与 audit MUST 保留冻结 snapshot 用于历史展示与审计，MUST NOT 通过当前 Contact API 回查；新配置选择资格和 pending task 提交资格 MUST 以当前成员状态为准。

#### Scenario: SaaS / CE 移除成员时同步移出 Contact
- **WHEN** a workspace member is removed from a SaaS or CE workspace
- **THEN** 系统 MUST hard-delete 该成员当前 workspace-owned Contact identity，使其不能被新的 HITL 节点继续选择，list MUST omit it and detail read MUST return `404`; 历史 workflow、task 与 audit MUST 仅通过冻结快照继续展示

#### Scenario: SaaS / CE 成员移除后重新加入
- **WHEN** a previously removed SaaS or CE member joins the workspace again
- **THEN** 系统 MUST 为其创建新的 Contact identity，MUST NOT 恢复旧 Contact ID，也 MUST NOT 让旧 pending task 自动继承新的审批资格

#### Scenario: EE 保留为 Platform contact
- **WHEN** an EE admin removes a workspace member and selects `Keep as Platform contact`
- **THEN** 系统 MUST 保留该联系人在当前 workspace Contact 中的记录，并 MUST 将其类型改为 `Platform contact`

#### Scenario: EE 移除成员且不 retain
- **WHEN** an EE admin removes a workspace member without retaining it as a `Platform contact`
- **THEN** the Organization-level canonical Contact MUST remain, but the current workspace MUST resolve it as `ABSENT`, omit it from lists, and return `404` on detail read; other workspaces MUST remain unaffected

#### Scenario: External contact 删除后 hard-delete
- **WHEN** a workspace admin deletes an `External contact`
- **THEN** the Contact MUST be hard-deleted, omitted from lists, and return `404` on detail read

#### Scenario: 禁用账号不可再被新节点选择
- **WHEN** a Dify Account becomes disabled or deleted
- **THEN** 系统 MUST 禁止新的 HITL 节点选择该联系人，且 MUST 在 pending task 提交时拒绝该账号继续审批

### Requirement: Organization 边界必须统一适用于 EE / CE / SaaS
系统 MUST 在所有部署形态下维持同一条边界规则：任何 Contact 搜索、匹配和添加都 MUST 限制在当前 `Organization` 边界内，MUST NOT 跨 `Organization` 搜索或解析联系人。`Organization` 的具体作用域 MUST 随部署形态确定：EE 中一个部署对应一个 `Organization`；CE / SaaS 中一个 workspace 对应一个 `Organization`。

#### Scenario: EE 的 Organization 覆盖同一部署下多个 workspace
- **WHEN** the deployment shape is EE
- **THEN** 系统 MUST 将同一部署下的多个 workspace 视为同一个 `Organization`，并 MAY 在该 `Organization` 内搜索其他 workspace 的 `organization contact`

#### Scenario: CE / SaaS 的 Organization 等于当前 workspace
- **WHEN** the deployment shape is CE or SaaS
- **THEN** 系统 MUST 将当前 workspace 视为完整的 `Organization`，因此 MUST NOT 返回其他 workspace 的联系人结果

#### Scenario: 任意部署形态都禁止跨 Organization 搜索
- **WHEN** a user tries to search contacts outside the current `Organization`
- **THEN** 系统 MUST 拒绝该搜索请求，并 MUST NOT 返回任何跨 `Organization` 的联系人结果

### Requirement: IM Integration、全局 IM identity 与 workspace override 归属
系统 MUST 将 IM Integration 凭据归属到 Organization。系统 MUST 只允许一个 Organization 级 IM channel 生效。负责管理该 Organization 级 IM channel 的管理员身份 MUST 随部署形态确定：EE 中 MUST 由企业管理员在 EE 后台管理；CE / SaaS 中 MUST 由 workspace owner 或 workspace admin 在 workspace 内管理。workspace override MUST 只覆盖当前 workspace 内联系人的 IM identity 或通知行为，MUST NOT 覆盖 IM Integration 凭据。

#### Scenario: EE 由企业管理员管理 Organization 级 IM channel
- **WHEN** the deployment shape is EE
- **THEN** 系统 MUST 要求企业管理员在 EE 后台管理唯一的 Organization-level IM channel

#### Scenario: CE / SaaS 由 workspace owner 或 admin 管理 Organization 级 IM channel
- **WHEN** the deployment shape is CE or SaaS
- **THEN** 系统 MUST 要求 workspace owner or workspace admin 在当前 workspace 内管理唯一的 Organization-level IM channel

#### Scenario: Workspace override 优先于全局 IM identity
- **WHEN** a contact has both a workspace IM override and a global IM identity
- **THEN** 系统 MUST 在当前 workspace 运行时优先使用 workspace IM override

#### Scenario: Reset to global 恢复全局 IM identity
- **WHEN** a workspace admin resets a contact override to global
- **THEN** 系统 MUST 在该 workspace 后续运行时恢复使用全局 IM identity

#### Scenario: IM sync 未命中时进入 unmatched list
- **WHEN** IM sync cannot match a member by IM platform user ID and also cannot match that member to any `organization contact` by email
- **THEN** 系统 MUST 将其放入 unmatched list，等待管理员手动处理，并 MUST NOT 自动创建 `External contact`

### Requirement: IM identity 必须基于手动同步结果选择
系统 MUST 通过 IM sync 结果提供 IM identity 选择源，MUST NOT 在一期要求管理员手工输入自由文本 IM user ID。IM sync MUST 由 Organization 管理员手动触发：首次在 IM 配置完成后手动同步，后续刷新也由管理员 / owner 手动发起。

#### Scenario: IM 配置完成后手动同步
- **WHEN** an Organization-level IM channel has been configured successfully
- **THEN** 系统 MUST 要求 Organization 管理员手动发起 IM sync，之后才允许从同步结果中选择 IM identity

#### Scenario: 从同步 IM contact 中选择 IM identity
- **WHEN** an admin configures IM identity for a contact
- **THEN** 系统 MUST 提供基于同步 IM contacts 的搜索与选择能力，且该搜索 MUST 支持按 IM user ID 查询，并 MUST NOT 依赖手工输入自由文本 IM user ID

### Requirement: Sync details 必须表达一次 sync run 的 binding 对账结果
系统 MUST 将 `Sync details` 建模为“一次 IM sync run 的 binding reconciliation result”，而不是联系人生命周期或 Contact 类型视图。`Added` MUST 表示本次 sync 为已匹配的 `organization contact` 新建了 IM binding；`Not Matched` MUST 表示按 `platform_user_id` 与 email 都未命中当前可解释的 `organization contact`，且 MUST 进入人工处理流、MUST NOT 自动创建 `External contact`；`Failed` MUST 表示理论上应能处理但本次同步处理失败，且 MUST 保留 failure reason；`Removed` MUST 仅表示本地既有 IM binding 在本次对账后被移除、失效或替换，MUST NOT 推导为 contact deletion、membership removal 或自动转换为 `External contact`，并 MUST 保留 machine-readable removal reason；`Skipped` MUST 表示本次 sync 观察到该 identity 但按规则不做变更。本期 `IMSyncResultItem` MUST NOT 返回 Contact type，skip reason MAY 在后续确有消费需求时再增加。

#### Scenario: Not Matched 进入人工处理流
- **WHEN** an IM identity from the provider matches neither an existing binding by `platform_user_id` nor any `organization contact` by email
- **THEN** 系统 MUST 将其归入 `Not Matched` bucket，并 MUST 进入人工处理流，而 MUST NOT 自动创建 `External contact`

#### Scenario: Removed 只表示 binding 对账结果
- **WHEN** a previously existing local IM binding is removed, invalidated, or replaced during a sync reconciliation run
- **THEN** 系统 MUST 将其归入 `Removed` bucket，MUST 将其解释为 binding-level reconciliation result only, not contact deletion, membership removal, or automatic conversion to `External contact`，并 MUST 记录 `not_present_in_directory`、`binding_invalidated` 或 `binding_replaced` 之一作为 machine-readable removal reason

#### Scenario: Skipped 不扩展本期 reason contract
- **WHEN** the sync run sees an IM identity but intentionally makes no change
- **THEN** 系统 MUST 将其归入 `Skipped` bucket，且本期 API MAY 不返回 machine-readable skip reason

### Requirement: Contact 的创建、编辑与可见性必须受权限约束
系统 MUST 将 Contact 与 external contact 的创建、编辑能力限制在具备 Contact 编辑权限的用户上。默认情况下，workspace owner / admin MUST 具备该权限；workflow editor MUST NOT 直接创建 external contact。普通 member MUST NOT 查看完整 Contact，且只允许访问分配给自己的 HITL task。

#### Scenario: Workflow editor 不能直接创建 external contact
- **WHEN** a workflow editor without Contact edit permission tries to create an external contact from workflow configuration
- **THEN** 系统 MUST 拒绝该操作，并 MUST 要求由具备 Contact 编辑权限的 owner / admin 管理联系人

#### Scenario: 普通 member 无法查看完整 Contact
- **WHEN** a regular member tries to browse the workspace Contact list
- **THEN** 系统 MUST 拒绝其查看完整 Contact，并 MUST 仅允许其访问分配给自己的 HITL task

### Requirement: Platform contact 搜索必须限制在 EE Organization 范围内的 owner / admin
系统 MUST 仅在 EE 中提供 `Platform contact` 搜索。该能力 MUST 只开放给当前 `Organization` 内具备 owner / admin 权限的用户，且搜索范围 MUST 限制在同一 `Organization` 内、当前 workspace 之外的成员。CE / SaaS 中虽然仍然存在 `Organization` 概念，但由于 `Organization = workspace`，系统 MUST NOT 暴露 `Platform contact` 搜索，也 MUST NOT 返回当前 workspace 之外的联系人结果。

#### Scenario: EE owner / admin 可以搜索 Platform contact
- **WHEN** an EE owner or admin searches organization contacts outside the current workspace
- **THEN** 系统 MUST 只返回同一 Organization 内其他 workspace 的可解释联系人，并 MUST 将这些结果视为 `organization contact` 下的 `Platform contact` 候选

#### Scenario: EE 非 owner / admin 不能搜索 Platform contact
- **WHEN** an EE user without owner / admin permission tries to search organization contacts outside the current workspace
- **THEN** 系统 MUST 拒绝该 `Platform contact` 搜索请求

#### Scenario: CE / SaaS 不暴露 Platform contact 搜索
- **WHEN** the deployment shape is CE or SaaS
- **THEN** 系统 MUST NOT 提供 `Platform contact` 搜索入口，也 MUST NOT 返回当前 workspace 之外的联系人结果

### Requirement: Contact 管理界面必须显式区分联系人分组与添加路径
系统 MUST 在 Contact 管理界面中显式区分 `All`、`Workspace`、`Platform` 和 `External` 四类浏览视图。`All` 不是 Contact type，而是省略类型过滤；`Platform` 表示当前 workspace 中解析为 `Platform contact` 的联系人。`Organization` 继续作为 ownership boundary 术语，但 MUST NOT 作为联系人分组名称。系统 MUST 为 `Platform contact` 与 `External contact` 提供不同的添加入口，MUST NOT 把二者混成同一条创建路径。

#### Scenario: 管理员按联系人分组浏览
- **WHEN** a workspace admin opens the Contact management page
- **THEN** 系统 MUST 允许其在 `All`、`Workspace`、`Platform` 和 `External` 视图之间切换；选择 `All` 时客户端 MUST 省略 `group`，其余视图分别使用 `workspace / platform / external`

#### Scenario: Add contact 菜单分离 Platform 与 External 路径
- **WHEN** a workspace admin adds a new contact from the Contact management page
- **THEN** 系统 MUST 将 `Platform contact` 添加路径与 `External contact` 添加路径分离；Platform candidate 搜索仍 MUST 限制在当前 Organization ownership boundary 内，系统并 MUST 在进入 external contact 创建前继续执行内部联系人命中校验

## Acceptance Coverage

| 场景族 | 最小验收标准 | Primary owner |
| --- | --- | --- |
| 联系人分类与作用域 | 必须证明 `organization contact` 是上位概念，且同 Organization 跨 workspace member 会落成 `Platform contact`，不会误分类成 `External contact` | Product + Backend Contact |
| external contact 准入失败 | 必须覆盖“email 命中内部联系人时拒绝创建 external contact”与“workspace editor 无权限创建 external contact”两类失败路径 | Backend Contact + Web Console |
| 成员生命周期与权限变化 | 必须覆盖 SaaS / CE member hard-delete、External contact hard-delete、EE retain 为 Platform、EE 不 retain 时当前 workspace 解析为 `ABSENT`、账号禁用 / 删除，并证明 list/detail、pending task 与新配置选择资格都按当前状态重算，历史只读冻结 snapshot | Backend Contact |
| IM sync 与 unmatched 处理 | 必须覆盖“手动 sync 后才能选择 IM identity”与“按 IM user ID / email 都未命中任何 `organization contact` 时进入 unmatched list”两类路径 | Backend Contact + Admin Console |
| Contact 可见性与 Platform contact 搜索 | 必须覆盖普通 member 无法浏览完整 Contact、EE owner / admin 可搜索 `Platform contact`、EE 非 owner / admin 被拒绝、CE / SaaS 不暴露 `Platform contact` 搜索，以及任意部署形态都不允许跨 `Organization` 搜索 | Backend Contact + QA |
