## MODIFIED Requirements

### Requirement: Contact 生命周期随成员状态变化
系统 MUST 在 workspace 成员状态变化后重新计算该成员在 Contact 中的可选性，但 MUST NOT 因 membership removal、Account profile update、Account disable 或 Account reactivate 删除或替换 Account-backed Contact identity。workspace-scoped resolution MUST 产出 `WORKSPACE`、`PLATFORM`、`EXTERNAL` 或 `ABSENT`；前三类允许由当前 Contact API 返回，`ABSENT` 不得出现在列表中，按 `contact_id` 读取时 MUST 返回 `404 Not Found`。历史 workflow 配置、历史 task 与 audit MUST 保留冻结 snapshot 用于历史展示与审计，MUST NOT 通过当前 Contact API 回查；新配置选择资格和 pending task 提交资格 MUST 使用请求时的 Account status、membership、Platform allow-list 与 External Contact profile state。

#### Scenario: SaaS / CE 移除成员时移出当前 Contact
- **WHEN** a workspace member is removed from a SaaS or CE workspace
- **THEN** 系统 MUST 保留该 Account 的全局 Contact identity 与 Contact ID，并 MUST 在该 workspace 中将其解析为 `ABSENT`
- **AND** list MUST omit it，detail read MUST return `404`，pending task submission MUST fail while the Account remains unavailable in that workspace

#### Scenario: SaaS / CE 成员移除后重新加入
- **WHEN** the same Account later rejoins the same SaaS or CE workspace
- **THEN** 系统 MUST 复用该 Account 已有的全局 Contact ID，并 MUST NOT 创建 replacement Contact identity
- **AND** current Contact reads and authorization MUST evaluate the new current membership without treating the earlier removal as a new Contact incarnation

#### Scenario: EE 保留为 Platform contact
- **WHEN** an EE admin removes a workspace member and selects `Keep as Platform contact`
- **THEN** 系统 MUST 保留同一 Account-backed Contact identity 与 Contact ID，并 MUST 在当前 workspace 中将其解析为 `PLATFORM`

#### Scenario: EE 移除成员且不 retain
- **WHEN** an EE admin removes a workspace member without retaining it as a `Platform contact`
- **THEN** 系统 MUST 保留 Account-backed Contact identity，但 MUST 在当前 workspace 中将其解析为 `ABSENT`、从列表省略并在 detail read 返回 `404`
- **AND** other workspaces MUST remain unaffected

#### Scenario: External contact 删除后不可恢复
- **WHEN** a workspace admin deletes an `External contact`
- **THEN** 系统 MUST 在同一事务中 hard-delete its External Contact profile、Contact identity and current bindings，并 MUST 在 current reads 返回 `404`
- **AND** recreating the same Email MUST allocate a new Contact ID

#### Scenario: 禁用账号不可再被新节点选择
- **WHEN** a Dify Account becomes disabled or deleted
- **THEN** 系统 MUST 保留 Account-backed Contact identity 与 Contact ID，并 MUST 禁止新的 HITL 节点选择该联系人且在 pending task 提交时拒绝该账号继续审批

#### Scenario: Account profile 更新不修改 Contact identity
- **WHEN** an authoritative Account operation changes the Account name、Email or avatar
- **THEN** current Contact reads MUST return the new Account-owned values without updating the Contact identity row or allocating a new Contact ID
