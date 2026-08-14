## ADDED Requirements

### Requirement: Recipient schema 必须支持五种 DSL discriminator，并限制 migration-only authoring

前端 MUST 将 `recipients_spec` 建模为 ordered discriminated union，并 MUST 支持 `contact`、`dynamic_email`、`onetime_email`、`initiator` 与 `all_workspace_contacts` 五种类型。`all_workspace_contacts` 的完整 wire representation MUST 为：

```json
{ "type": "all_workspace_contacts" }
```

每种类型 MUST 只写入其定义的字段。`all_workspace_contacts` 是合法的 migration-only compatibility variant；当前 manual authoring controls MUST NOT 提供新增该类型的入口。

#### Scenario: 添加 Contact recipient

- **WHEN** 用户选择一个 Contact option
- **THEN** 前端 MUST 添加 `{ type: 'contact', contact_id }`

#### Scenario: 添加 Dynamic Email recipient

- **WHEN** 用户选择一个有效 workflow variable selector
- **THEN** 前端 MUST 添加 `{ type: 'dynamic_email', selector }` 并保留完整 selector path

#### Scenario: 添加 one-time Email recipient

- **WHEN** 用户输入并确认一个有效 Email
- **THEN** 前端 MUST 添加 `{ type: 'onetime_email', email }`

#### Scenario: 添加 initiator recipient

- **WHEN** 用户选择当前发起人
- **THEN** 前端 MUST 添加 `{ type: 'initiator' }`，MUST NOT 写入额外 identity 字段

#### Scenario: 导入 all-workspace recipient

- **WHEN** imported v2 DSL contains `{ "type": "all_workspace_contacts" }`
- **THEN** 前端 MUST 将其解析为受支持的 recipient variant，MUST NOT 将其归类为 unknown 或 malformed data

#### Scenario: 手动新增 recipient

- **WHEN** 用户通过当前 recipient type controls 新增 recipient
- **THEN** controls MUST 只提供 Contact、Dynamic Email、one-time Email 与 initiator，MUST NOT 提供 `all_workspace_contacts`

### Requirement: Recipient input 必须遵循 Figma 的类型选择与草稿交互

Recipient input MUST 按 Figma node `25087:29285` 呈现可用类型、输入状态、校验反馈与确认行为。未完成草稿 MUST NOT 写入 node data。

#### Scenario: 切换 recipient 类型

- **WHEN** 用户在尚未确认的 recipient draft 中切换类型
- **THEN** input MUST 重置只属于上一类型的 draft 字段，且 MUST NOT 改变已保存 recipient

#### Scenario: 确认有效草稿

- **WHEN** 当前类型的 required field 有效且用户确认
- **THEN** input MUST 原子地向 `recipients_spec` 添加一个 typed recipient，并按设计清理或保留输入状态

#### Scenario: 确认无效草稿

- **WHEN** required Contact、selector 或 Email 缺失或无效
- **THEN** input MUST 阻止新增并展示与控件关联的错误

#### Scenario: 取消草稿

- **WHEN** 用户取消 recipient 输入
- **THEN** input MUST 丢弃未确认草稿，MUST NOT 改变 `recipients_spec`

### Requirement: Recipient 列表必须支持局部编辑、删除与稳定顺序

Recipient 配置区 MUST 按 Figma node `25094:31750` 展示已配置项，并 MUST 支持设计规定的编辑与删除操作。更新一个 recipient 时 MUST 保持其他项和值的顺序不变。

#### Scenario: 编辑一个 recipient

- **WHEN** 用户修改指定 index 的 Contact、selector 或 one-time Email
- **THEN** 前端 MUST 只替换该 index 对应的 discriminated item

#### Scenario: 删除一个 recipient

- **WHEN** 用户确认删除指定 recipient
- **THEN** 前端 MUST 只移除该项，并保持其余 recipient 的相对顺序

#### Scenario: imported recipient 不完整

- **WHEN** imported DSL 中某个 recipient 缺少 required field
- **THEN** 配置区 MUST 保留并标记该项可修复，MUST NOT 在首次渲染时删除它

#### Scenario: imported migration-only recipient 完整

- **WHEN** imported DSL 中某项是完整的 `{ "type": "all_workspace_contacts" }`
- **THEN** 配置区 MUST 将其显示为有效的只读 compatibility item，MUST NOT 因当前 controls 无法新增该类型而显示字段错误

### Requirement: 前端必须阻止新增重复 recipient

前端 MUST 使用类型对应的 canonical key 检查人工新增的精确重复：Contact 使用 `contact_id`，Dynamic Email 使用完整 selector path，one-time Email 使用 trim 后 lower-case 的完整 Email，initiator 在整个列表中最多一个。人工新增或编辑 Contact 时，前端还 MUST 对 provider 返回的非空 `email` 执行 trim 和整串 lower-case normalization，并阻止两个不同 Contact recipients 共享同一 normalized email。该 same-email guard 只约束 active manual selection；已导入的 migration compatibility overlap MUST 被保留，MUST NOT 被自动合并或改写。

#### Scenario: 重复选择 Contact

- **WHEN** `recipients_spec` 已含相同 `contact_id` 且用户再次选择该 Contact
- **THEN** 前端 MUST 阻止新增并展示重复提示

#### Scenario: 人工选择不同 ID 的 same-email Contact

- **WHEN** `recipients_spec` 已含一个 Contact，且用户尝试新增另一个具有不同 `contact_id` 但相同 normalized `email` 的 Contact
- **THEN** 前端 MUST 阻止新增，并 MUST 说明一个节点不能人工选择多个 same-email Contacts

#### Scenario: 编辑 Contact 形成 same-email 冲突

- **WHEN** 用户编辑一个 Contact selection 后会使两个 active Contact recipients 具有相同 normalized `email`
- **THEN** 前端 MUST 拒绝提交该编辑或保持明确的 uncommitted error state，MUST NOT 静默保存冲突组合

#### Scenario: Email 大小写不同但值相同

- **WHEN** 已有 one-time Email 与新输入 Email 仅大小写或首尾空白不同
- **THEN** 前端 MUST 将其视为重复并阻止新增

#### Scenario: 重复选择 initiator

- **WHEN** 列表已含 `initiator` 且用户再次选择 initiator
- **THEN** 前端 MUST 阻止新增第二项

#### Scenario: DSL 已含重复项

- **WHEN** imported `recipients_spec` 包含重复 canonical key
- **THEN** 前端 MUST 保留原数组用于 round-trip，并 MUST 在 validation 与相关列表项展示可修复错误

#### Scenario: DSL 已含 migration-preserved overlap

- **WHEN** imported `recipients_spec` contains `all_workspace_contacts` together with an explicit Contact covered by that set or a same-email `External contact`
- **THEN** 前端 MUST 保留原数组和顺序，且 MUST NOT 把该兼容组合当作人工选择产生的 duplicate error

### Requirement: Contact recipient 必须通过 typed provider 搜索并批量回显

Contact picker 与 node summary MUST 只通过一个窄的 typed option-provider boundary 搜索 Contact 或按 id 解析 label。已存 ID 的回显 MUST 以 `{ contact_ids }` 调用一次批量查询边界。每个 Contact option MUST 包含 nullable `email`，供 option presentation 和 active manual same-email validation 使用；recipient DSL MUST continue to persist only `contact_id` as Contact identity。当前 provider MUST 使用确定性 mock 数据；真实网络 adapter 留待授权 contract 与 client 可用后替换，组件接口不得因此改变。

#### Scenario: 搜索 Contact

- **WHEN** 用户在 Contact recipient input 输入查询词
- **THEN** picker MUST 通过当前 typed provider 返回包含 nullable `email` 的匹配 options，并按 Figma 展示 loading、empty 与 result 状态

#### Scenario: 批量解析已存 Contact

- **WHEN** panel 或 node card 需要展示一个或多个已存 `contact_id`
- **THEN** 前端 MUST 向 provider 发出一个 `{ contact_ids: deduplicatedIds }` 批量查询来解析 ID，MUST NOT 使用列表第一页或逐 ID 请求

#### Scenario: Contact id 无法解析

- **WHEN** provider 找不到已存 `contact_id`、响应缺少该 ID 或批量查询失败
- **THEN** UI MUST 保留该 id、展示 unresolved 状态并允许用户替换或删除

#### Scenario: Contact 字段可为空

- **WHEN** provider 返回 nullable email 或 avatar 字段
- **THEN** adapter MUST 保留数据语义并在最终展示边界提供安全 label，MUST NOT 丢弃该 Contact 或伪造 identity

### Requirement: Dynamic Email 必须使用 workflow variable selector 并维护依赖

Dynamic Email recipient MUST 使用现有 workflow variable selection primitives，并 MUST 将 `selector` 作为 node variable dependency 纳入提取、重命名、删除、复制与粘贴流程。

#### Scenario: 选择有效变量

- **WHEN** 用户为 Dynamic Email 选择设计允许的 workflow variable
- **THEN** 前端 MUST 保存完整 selector，并在 recipient summary 中展示可辨识变量信息

#### Scenario: 重命名变量或上游节点

- **WHEN** 已被 Dynamic Email selector 引用的变量路径发生受支持的重命名
- **THEN** 前端 MUST 使用现有 dependency update 语义同步该 selector

#### Scenario: 删除被引用变量

- **WHEN** Dynamic Email selector 指向的变量被删除或变为不可用
- **THEN** recipient MUST 保留为可修复的 invalid state，MUST NOT 被静默删除

#### Scenario: 复制粘贴 v2 节点

- **WHEN** 用户复制并粘贴包含 Dynamic Email recipient 的节点且 selector 需要重新映射
- **THEN** 前端 MUST 使用 workflow copy/paste 的变量映射更新 selector，并保持其他 recipient 不变

### Requirement: Recipient 配置必须提供可访问且本地化的交互

Recipient picker、列表项、类型选择、错误、删除与 unresolved 状态 MUST 使用 i18n 文案并可通过键盘和辅助技术操作。

#### Scenario: 键盘添加 recipient

- **WHEN** 用户只使用键盘打开 recipient input、选择类型、输入值并确认
- **THEN** 所有步骤 MUST 具有合理焦点顺序、可见焦点和明确 accessible name

#### Scenario: 展示字段错误

- **WHEN** recipient draft 或已存项无效
- **THEN** 错误 MUST 与对应控件或列表项建立可感知关联

#### Scenario: 只读 workflow

- **WHEN** workflow editor 处于只读状态
- **THEN** 用户 MUST 能查看 recipient summary 与配置，但 MUST NOT 添加、编辑或删除 recipient
