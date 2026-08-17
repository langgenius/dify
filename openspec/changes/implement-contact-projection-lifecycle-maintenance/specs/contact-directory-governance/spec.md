## MODIFIED Requirements

### Requirement: Contact 生命周期随成员状态变化
系统 MUST 由 Contact lifecycle owner 在 authoritative Account/member application operation 中持续维护 source-backed Contact projection，并 MUST 由独立 periodic reconciliation 使用相同 transition rules 修复绕过该写路径造成的漂移。Contact reads 与 manual IM sync MUST 只消费 current projection，MUST NOT 创建、更新、删除、backfill 或 repair Contact。

系统 MUST 在 workspace 成员状态变化后更新该成员在 Contact 中的可选性。workspace-scoped resolution MUST 根据 current Account、membership、Platform allow-list 与 Contact facts 产出 `WORKSPACE`、`PLATFORM`、`EXTERNAL` 或 `ABSENT`；前三类允许由当前 Contact API 返回，`ABSENT` 与 unavailable Contact 不得出现在列表、recipient selection 或 IM Email matching 中，按 `contact_id` 读取时 MUST 返回 `404 Not Found`。历史 workflow 配置、历史 task 与 audit MUST 保留冻结 snapshot 用于历史展示与审计，MUST NOT 通过当前 Contact API 回查；新配置选择资格和 pending task 提交资格 MUST 以当前成员状态为准。

#### Scenario: Account 或 member 写入持续维护 Contact
- **WHEN** an authoritative application operation creates an eligible Account/member、adds workspace membership or changes mutable profile facts
- **THEN** Contact lifecycle owner MUST create or update the source-backed Contact and MUST preserve its Contact ID when that identity already exists
- **AND** a required Contact write failure MUST prevent the owning application operation from being reported as successfully committed

#### Scenario: SaaS / CE 移除成员时同步移出 Contact
- **WHEN** a workspace member is removed from a SaaS or CE workspace
- **THEN** the owning application operation MUST hard-delete 该成员当前 workspace-owned Contact identity and its current IM bindings，使其不能被新的 HITL 节点继续选择，list MUST omit it and detail read MUST return `404`; 历史 workflow、task 与 audit MUST 仅通过冻结快照继续展示

#### Scenario: SaaS / CE 成员移除后重新加入
- **WHEN** a previously removed SaaS or CE member joins the workspace again
- **THEN** 系统 MUST 为其创建新的 Contact identity，MUST NOT 恢复旧 Contact ID，也 MUST NOT 让旧 pending task 自动继承新的审批资格

#### Scenario: EE 保留为 Platform contact
- **WHEN** an EE admin removes a workspace member and selects `Keep as Platform contact`
- **THEN** 系统 MUST 保留 Organization-owned canonical Contact，并 MUST 将其在当前 workspace 中解析为 `Platform contact`

#### Scenario: EE 移除成员且不 retain
- **WHEN** an EE admin removes a workspace member without retaining it as a `Platform contact`
- **THEN** the Organization-level canonical Contact MUST remain, but the current workspace MUST resolve it as `ABSENT`, omit it from lists, and return `404` on detail read; other workspaces MUST remain unaffected

#### Scenario: External contact 删除后 hard-delete
- **WHEN** a workspace admin deletes an `External contact`
- **THEN** the Contact and its current IM bindings MUST be hard-deleted, omitted from lists, and return `404` on detail read

#### Scenario: 禁用账号不可再被新节点选择
- **WHEN** a Dify Account becomes disabled or deleted
- **THEN** 系统 MUST 保留 canonical Contact 与 Contact ID 不变，并 MUST 禁止新的 HITL 节点选择该联系人、在 pending task 提交时拒绝该账号继续审批以及从 IM Email matching 中排除该联系人

#### Scenario: Account 重新启用
- **WHEN** the same disabled Account becomes eligible again
- **THEN** current Contact reads MUST expose the existing canonical Contact with the same Contact ID rather than creating a replacement identity

#### Scenario: Periodic reconciliation 修复旁路写入
- **WHEN** Account/member source facts 与 Contact projection 因绕过 authoritative application operation 而发生漂移
- **THEN** periodic Contact reconciliation MUST 使用与 foreground write-through 相同的 transition rules 幂等修复该漂移
- **AND** it MUST process bounded pages independently from provider directory sync or manual IM sync

#### Scenario: Contact consumer 不修复 projection
- **WHEN** Contact API、recipient selection、pending-task authorization or manual IM sync reads current Contact state
- **THEN** it MUST apply current availability and workspace-resolution rules without creating、updating、deleting、backfilling or repairing Contact
