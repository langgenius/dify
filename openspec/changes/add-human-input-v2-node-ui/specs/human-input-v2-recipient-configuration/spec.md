## ADDED Requirements

### Requirement: Recipient 配置必须严格支持四种 DSL discriminator

前端 MUST 将 `recpients_spec` 建模为 ordered discriminated union，并 MUST 支持 `contact`、`dynamic_email`、`onetime_email` 与 `initiator` 四种类型。每种类型 MUST 只写入 entity 定义的字段。

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

### Requirement: Recipient input 必须遵循 Figma 的类型选择与草稿交互

Recipient input MUST 按 Figma node `25087:29285` 呈现可用类型、输入状态、校验反馈与确认行为。未完成草稿 MUST NOT 写入 node data。

#### Scenario: 切换 recipient 类型

- **WHEN** 用户在尚未确认的 recipient draft 中切换类型
- **THEN** input MUST 重置只属于上一类型的 draft 字段，且 MUST NOT 改变已保存 recipient

#### Scenario: 确认有效草稿

- **WHEN** 当前类型的 required field 有效且用户确认
- **THEN** input MUST 原子地向 `recpients_spec` 添加一个 typed recipient，并按设计清理或保留输入状态

#### Scenario: 确认无效草稿

- **WHEN** required Contact、selector 或 Email 缺失或无效
- **THEN** input MUST 阻止新增并展示与控件关联的错误

#### Scenario: 取消草稿

- **WHEN** 用户取消 recipient 输入
- **THEN** input MUST 丢弃未确认草稿，MUST NOT 改变 `recpients_spec`

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

### Requirement: 前端必须阻止新增重复 recipient

前端 MUST 使用类型对应的 canonical key 检查重复：Contact 使用 `contact_id`，Dynamic Email 使用完整 selector path，one-time Email 使用 trim 后 lower-case 的完整 Email，initiator 在整个列表中最多一个。已导入的重复项 MUST 显示错误而不是被自动合并。

#### Scenario: 重复选择 Contact

- **WHEN** `recpients_spec` 已含相同 `contact_id` 且用户再次选择该 Contact
- **THEN** 前端 MUST 阻止新增并展示重复提示

#### Scenario: Email 大小写不同但值相同

- **WHEN** 已有 one-time Email 与新输入 Email 仅大小写或首尾空白不同
- **THEN** 前端 MUST 将其视为重复并阻止新增

#### Scenario: 重复选择 initiator

- **WHEN** 列表已含 `initiator` 且用户再次选择 initiator
- **THEN** 前端 MUST 阻止新增第二项

#### Scenario: DSL 已含重复项

- **WHEN** imported `recpients_spec` 包含重复 canonical key
- **THEN** 前端 MUST 保留原数组用于 round-trip，并 MUST 在 validation 与相关列表项展示可修复错误

### Requirement: Contact recipient 必须通过可替换的 typed provider 读取 mock options

Contact picker 与 node summary MUST 只通过一个窄的 typed option-provider boundary 搜索 Contact 或按 id 解析 label。本 change MUST 使用确定性的 mock provider，MUST NOT 新增或调用真实 Contact API。

#### Scenario: 搜索 mock Contact

- **WHEN** 用户在 Contact recipient input 输入查询词
- **THEN** picker MUST 通过 provider 返回匹配的 typed mock options，并按 Figma 展示 loading、empty 与 result 状态

#### Scenario: 解析已存 Contact

- **WHEN** panel 或 node card 需要展示一个已存 `contact_id`
- **THEN** 前端 MUST 通过 provider 按 id 解析该 Contact，MUST NOT 直接从组件 import fixture

#### Scenario: Contact id 无法解析

- **WHEN** provider 找不到已存 `contact_id` 或 mock query 失败
- **THEN** UI MUST 保留该 id、展示 unresolved 状态并允许用户替换或删除

#### Scenario: 后端 Contact API 尚未完成

- **WHEN** 用户完成本 change 范围内的 recipient 配置交互
- **THEN** 浏览器 MUST NOT 发起新的 Contact endpoint 请求

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
