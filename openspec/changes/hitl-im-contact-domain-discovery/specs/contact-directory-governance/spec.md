## ADDED Requirements

### Requirement: Contact 类型与 Organization / Workspace 作用域
系统 MUST 将 HITL 联系人区分为 `workspace contact`、`Platform contact` 和 `External contact`。系统 MUST 将同一 Organization 内但不属于当前 workspace 的 member 归类为 `Platform contact`，MUST NOT 将其归类为 `External contact`。

#### Scenario: SaaS / CE member 自动进入 Contact
- **WHEN** a workspace member exists or is newly added in SaaS or CE
- **THEN** 系统 MUST 自动将该成员纳入当前 workspace Contact 列表，并将其类型标记为 `workspace contact`

#### Scenario: EE 添加跨 workspace 成员
- **WHEN** a workspace admin adds a member from the same Organization but another workspace
- **THEN** 系统 MUST 将该对象作为 `Platform contact` 加入当前 workspace Contact，而不是 `External contact`

### Requirement: External contact 准入规则
系统 MUST 仅允许不属于当前审批域内任何 `workspace contact` 或 `Platform contact` 的对象成为 `External contact`。系统 MUST 要求 external contact 提供合法 Email，并 MUST 使用整条 email lower-case 后完全相等的规则做重复判断。

#### Scenario: 创建合法 external contact
- **WHEN** a workspace admin submits a non-Dify email that is unique within the workspace
- **THEN** 系统 MUST 允许创建 `External contact`，并要求后续仅通过 Email 触达该联系人

#### Scenario: Email 命中内部联系人时拒绝创建 external contact
- **WHEN** a workspace admin submits an email that matches an existing `Contact` or `Platform contact` in the current Organization scope
- **THEN** 系统 MUST 拒绝创建 `External contact`，并 MUST 提示该对象应按平台内联系人处理

### Requirement: Contact 生命周期随成员状态变化
系统 MUST 在 workspace 成员状态变化后更新该成员在 Contact 中的可选性。历史 workflow 配置和历史 task MUST 保留快照用于历史展示与审计，但新配置选择资格和 pending task 提交资格 MUST 以当前成员状态为准。

#### Scenario: SaaS / CE 移除成员时同步移出 Contact
- **WHEN** a workspace member is removed from a SaaS or CE workspace
- **THEN** 系统 MUST 将该成员从当前 workspace Contact 中移除，并 MUST 使其不能被新的 HITL 节点继续选择

#### Scenario: EE 保留为 Platform contact
- **WHEN** an EE admin removes a workspace member and selects `Keep as Platform contact`
- **THEN** 系统 MUST 保留该联系人在当前 workspace Contact 中的记录，并 MUST 将其类型改为 `Platform contact`

#### Scenario: 禁用账号不可再被新节点选择
- **WHEN** a Dify Account becomes disabled or deleted
- **THEN** 系统 MUST 禁止新的 HITL 节点选择该联系人，且 MUST 在 pending task 提交时拒绝该账号继续审批

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
- **WHEN** IM sync cannot match a member by IM platform user ID and also cannot match that member to any `Contact` or `Platform contact` by email
- **THEN** 系统 MUST 将其放入 unmatched list，等待管理员手动处理，并 MUST NOT 自动创建 `External contact`

### Requirement: IM identity 必须基于手动同步结果选择
系统 MUST 通过 IM sync 结果提供 IM identity 选择源，MUST NOT 在一期要求管理员手工输入自由文本 IM user ID。IM sync MUST 由 Organization 管理员手动触发：首次在 IM 配置完成后手动同步，后续刷新也由管理员 / owner 手动发起。

#### Scenario: IM 配置完成后手动同步
- **WHEN** an Organization-level IM channel has been configured successfully
- **THEN** 系统 MUST 要求 Organization 管理员手动发起 IM sync，之后才允许从同步结果中选择 IM identity

#### Scenario: 从同步 IM contact 中选择 IM identity
- **WHEN** an admin configures IM identity for a contact
- **THEN** 系统 MUST 提供基于同步 IM contacts 的搜索与选择能力，且该搜索 MUST 支持按 IM user ID 查询，并 MUST NOT 依赖手工输入自由文本 IM user ID

### Requirement: Contact 的创建、编辑与可见性必须受权限约束
系统 MUST 将 Contact 与 external contact 的创建、编辑能力限制在具备 Contact 编辑权限的用户上。默认情况下，workspace owner / admin MUST 具备该权限；workflow editor MUST NOT 直接创建 external contact。普通 member MUST NOT 查看完整 Contact，且只允许访问分配给自己的 HITL task。

#### Scenario: Workflow editor 不能直接创建 external contact
- **WHEN** a workflow editor without Contact edit permission tries to create an external contact from workflow configuration
- **THEN** 系统 MUST 拒绝该操作，并 MUST 要求由具备 Contact 编辑权限的 owner / admin 管理联系人

#### Scenario: 普通 member 无法查看完整 Contact
- **WHEN** a regular member tries to browse the workspace Contact list
- **THEN** 系统 MUST 拒绝其查看完整 Contact，并 MUST 仅允许其访问分配给自己的 HITL task
