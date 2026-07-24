## ADDED Requirements

### Requirement: Contact 详情必须以稳定 identifier 打开

前端 MUST 允许用户从列表或可恢复 URL 上下文打开指定 `contact_id` 的详情。详情的页面、drawer 或 dialog 形态以 Figma 为准，但数据上下文 MUST 始终绑定到同一个 Contact。

#### Scenario: 从列表打开详情

- **WHEN** 用户激活某一 Contact 行
- **THEN** 前端 MUST 使用该行的 `contact_id` 打开对应详情

#### Scenario: 通过 URL 恢复详情

- **WHEN** 页面初始化时 URL 包含有效 `contact_id`
- **THEN** 前端 MUST 恢复该 Contact 的详情上下文

#### Scenario: Contact identifier 无效

- **WHEN** mock repository 找不到指定 `contact_id`
- **THEN** 前端 MUST 展示不存在或不可用状态以及返回目录的操作

### Requirement: 详情必须展示 Contact 的通用身份信息

前端 MUST 展示 Figma 定义的 Contact 通用信息，并至少保证名称、Email、Contact 类型和可用联系方式可辨识。

#### Scenario: 详情加载成功

- **WHEN** repository 返回有效 Contact
- **THEN** 前端 MUST 展示该 Contact 的通用身份信息和类型标识

#### Scenario: 可选信息缺失

- **WHEN** avatar 或 channel summary 等可选字段缺失
- **THEN** 前端 MUST 使用统一 fallback，MUST NOT 伪造值

#### Scenario: 详情数据与列表摘要更新

- **WHEN** mock mutation 改变 Contact 类型或可用状态
- **THEN** 前端 MUST 刷新详情与对应列表摘要，使二者保持一致

### Requirement: 详情必须按 Contact 类型展示专属语义

前端 MUST 根据 discriminated union 的 `kind` 展示类型专属字段，MUST NOT 向一种 Contact 展示只属于另一种 Contact 的身份语义。

#### Scenario: workspace contact 详情

- **WHEN** Contact `kind` 为 `workspace`
- **THEN** 前端 MUST 展示其当前 workspace membership、角色或成员状态摘要，以及可用联系方式

#### Scenario: Platform contact 详情

- **WHEN** Contact `kind` 为 `platform`
- **THEN** 前端 MUST 使用 `Organization` 类型标识展示该 Contact，并展示 Figma 明确提供的通用身份信息和可用联系方式；前端 MUST NOT 要求或推断来源 workspace 或额外 Organization identity

#### Scenario: External contact 详情

- **WHEN** Contact `kind` 为 `external`
- **THEN** 前端 MUST 表达其不属于 Dify Account、只归属当前 workspace 且当前只通过 Email 触达

#### Scenario: External contact 没有成员角色

- **WHEN** 用户查看 External contact
- **THEN** 前端 MUST NOT 渲染 workspace member role 或 Organization member 状态

### Requirement: 详情操作必须遵循 mock 权限与类型能力

前端 MUST 根据 `can_manage_contacts`、Contact `kind` 和 typed available actions 决定可见操作。mock 权限只用于前端验收，MUST NOT 被描述为真实授权。

#### Scenario: Contact 管理员查看详情

- **WHEN** `can_manage_contacts` 为 true
- **THEN** 前端 MUST 展示当前 Contact 类型在本 change 范围内可执行的操作

#### Scenario: 只读用户查看详情

- **WHEN** 用户可查看目录但 `can_manage_contacts` 为 false
- **THEN** 前端 MUST 保持详情只读并隐藏或禁用管理操作

#### Scenario: 未规划的操作

- **WHEN** 当前 Contact 没有 typed available action
- **THEN** 前端 MUST NOT 展示无法完成的编辑、删除、合并或 IM override 伪操作

### Requirement: 详情中的联系方式摘要不得越过 capability 边界

Contact 详情在 view model 提供 Email 或 IM identity 摘要时 MUST 以只读方式展示，并 MUST NOT 在本 change 中提供 Organization IM platform 配置、目录同步、credential 或自由文本 IM user ID 编辑。

#### Scenario: Contact 有 Email

- **WHEN** mock Contact 提供可用 Email
- **THEN** 详情 MUST 展示该 Email 作为联系方式摘要

#### Scenario: Contact 有 mock IM identity 摘要

- **WHEN** view model 提供安全的 IM identity summary
- **THEN** 详情 MUST 只读展示该摘要，MUST NOT 暴露 provider credential

#### Scenario: 用户尝试管理 IM platform

- **WHEN** 用户从 Contact 详情寻找 Organization IM platform 配置
- **THEN** 本 capability MUST NOT 在详情内重复实现该流程

### Requirement: 详情必须覆盖加载、失败和已移除状态

前端 MUST 区分详情加载、读取失败、重试成功、Contact 已从当前 workspace 移除和 Contact 不存在。

#### Scenario: 详情加载中

- **WHEN** repository 尚未返回 Contact
- **THEN** 前端 MUST 展示与 Figma 一致的详情加载状态

#### Scenario: 详情读取失败

- **WHEN** mock repository 返回可重试错误
- **THEN** 前端 MUST 展示安全错误与重试操作，并保留返回目录入口

#### Scenario: Contact 已从当前 workspace 移除

- **WHEN** member removal mutation 使当前 Contact 不再属于目录
- **THEN** 前端 MUST 关闭详情或展示已移除状态，并刷新目录

#### Scenario: EE member 保留为 Platform contact

- **WHEN** EE 移除 member mutation 保留该 Contact
- **THEN** 详情 MUST 将类型从 `workspace` 更新为 `platform`，并保留同一稳定 Contact 身份

### Requirement: 详情数据必须来自 typed mock repository

详情组件 MUST 通过 Contacts-owned repository interface 和 React Query 读取 Contact，MUST NOT 直接读取 fixture 或调用真实后端。

#### Scenario: 读取 Contact 详情

- **WHEN** 详情 surface 打开
- **THEN** 前端 MUST 使用 `contact_id` 调用 repository query

#### Scenario: 未来替换 adapter

- **WHEN** 后续 change 提供真实 API repository adapter
- **THEN** 详情组件的 view model 和可观察状态语义 MUST 保持不变

### Requirement: 详情 surface 必须可访问并恢复焦点

详情中的标题、分组、状态和操作 MUST 能被辅助技术识别；关闭 overlay 形态的详情后 MUST 恢复触发点焦点。

#### Scenario: 键盘浏览详情

- **WHEN** 用户只使用键盘浏览详情和可用操作
- **THEN** 前端 MUST 保持合理焦点顺序、可见焦点和明确控件名称

#### Scenario: 关闭详情 overlay

- **WHEN** 用户关闭 drawer 或 dialog 形态的详情
- **THEN** 前端 MUST 将焦点恢复到原 Contact 行或打开详情的控件
