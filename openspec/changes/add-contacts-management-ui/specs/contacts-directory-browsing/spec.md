## ADDED Requirements

### Requirement: Contacts 必须提供独立的目录入口

前端 MUST 提供独立于 workspace Members 和 Agent Roster 的 Contacts 目录入口。该入口只展示当前 workspace 已纳入 Contacts 的 `workspace contact`、`Platform contact` 和 `External contact`。

#### Scenario: 管理员进入 Contacts

- **WHEN** mock context 中 `can_view_contacts` 为 true
- **THEN** 前端 MUST 允许用户进入当前 workspace Contacts 目录

#### Scenario: 普通 member 尝试浏览完整目录

- **WHEN** mock context 中 `can_view_contacts` 为 false
- **THEN** 前端 MUST 隐藏入口或展示无权限状态，MUST NOT 渲染完整联系人数据

#### Scenario: Agent Roster 不承载 Contacts

- **WHEN** 用户浏览 AI Agent Roster
- **THEN** 前端 MUST NOT 在该列表中混入 Contact 行或 Contact 管理操作

### Requirement: 目录必须区分三种 Contact 类型

前端 MUST 使用明确类型标识区分 `workspace contact`、`Platform contact` 和 `External contact`，并 MUST 展示 Figma 要求的关键身份信息。至少名称、Email、Contact 类型、可用渠道以及加入时间 MUST 可被辨识。

#### Scenario: 展示 workspace contact

- **WHEN** 列表项的 `kind` 为 `workspace`
- **THEN** 前端 MUST 将其展示为当前 workspace member 对应的 workspace contact

#### Scenario: 展示 Platform contact

- **WHEN** 列表项的 `kind` 为 `platform`
- **THEN** 前端 MUST 在 Platform 分组中展示该 Contact，并 MUST 按 Figma 在类型列中将其标识为 `Organization`；本列表 MUST NOT 要求或推断来源 workspace 等未展示信息

#### Scenario: 展示 External contact

- **WHEN** 列表项的 `kind` 为 `external`
- **THEN** 前端 MUST 将其展示为只归属当前 workspace、以 Email 触达的 External contact

#### Scenario: 某个展示字段缺失

- **WHEN** mock view model 中某个非必填字段为空
- **THEN** 前端 MUST 使用统一空值表达，MUST NOT 猜测或拼接虚假数据

### Requirement: Contacts 目录必须支持搜索、筛选和增量读取

前端 MUST 支持按 Figma 定义的关键字和 Contact 类型浏览目录。搜索、筛选和分页状态 MUST 绑定到同一个列表 query，MUST NOT 混合不同条件下的结果。

#### Scenario: 按名称或 Email 搜索

- **WHEN** 用户输入搜索关键字
- **THEN** 前端 MUST 通过 mock repository 返回匹配名称或 Email 的当前 workspace Contacts

#### Scenario: 按 Contact 类型筛选

- **WHEN** 用户选择 workspace、platform 或 external 类型
- **THEN** 前端 MUST 只展示当前筛选条件下的 Contact

#### Scenario: 组合搜索与筛选

- **WHEN** 用户同时设置关键字和类型筛选
- **THEN** 前端 MUST 展示同时满足两个条件的结果

#### Scenario: 加载下一页

- **WHEN** 当前 query 仍有下一页或下一段结果
- **THEN** 前端 MUST 增量读取并去重追加结果

#### Scenario: 切换筛选条件

- **WHEN** 用户改变搜索或类型筛选
- **THEN** 前端 MUST 重置分页上下文，MUST NOT 保留上一条件的行

### Requirement: 目录必须覆盖完整读取状态

前端 MUST 区分初始加载、加载成功、空目录、无搜索结果、初始失败和后续页失败。

#### Scenario: 初始加载

- **WHEN** mock repository 尚未返回第一页
- **THEN** 前端 MUST 展示与 Figma 一致的加载状态，MUST NOT 短暂显示空目录

#### Scenario: 当前 workspace 没有 Contact

- **WHEN** repository 成功返回空目录且没有搜索条件
- **THEN** 前端 MUST 展示目录空状态和当前用户可执行的管理入口

#### Scenario: 搜索无结果

- **WHEN** repository 成功返回空结果且存在搜索或筛选条件
- **THEN** 前端 MUST 展示无匹配结果并提供清除条件的操作

#### Scenario: 初始读取失败

- **WHEN** mock repository 返回列表读取失败
- **THEN** 前端 MUST 展示错误状态与重试操作，MUST NOT 将失败解释为空目录

#### Scenario: 后续页读取失败

- **WHEN** 已有列表存在但下一页读取失败
- **THEN** 前端 MUST 保留已加载行并提供只重试当前页的操作

### Requirement: CE / SaaS 与 EE 必须展示不同目录语义

前端 MUST 根据 typed deployment context 展示 CE / SaaS 与 EE 的 Contacts 行为差异。

#### Scenario: CE 或 SaaS 目录

- **WHEN** deployment 为 CE 或 SaaS
- **THEN** mock 目录 MUST 将当前 workspace member 表达为自动纳入的 workspace contact

#### Scenario: EE 目录

- **WHEN** deployment 为 EE
- **THEN** Contacts 列表 MUST 只展示当前 workspace member、已显式加入的 Platform contact 和 External contact，MUST NOT 自动展示 Organization 全量成员

#### Scenario: 非 EE 环境

- **WHEN** deployment 不是 EE
- **THEN** 前端 MUST NOT 展示从 Organization 添加 Platform contact 的入口

### Requirement: EE 管理员必须能够从 mock Organization directory 添加 Platform contact

EE 中具备 Contact 管理权限的用户 MUST 能搜索 mock Organization directory、选择尚未加入当前 Contacts 的其他 workspace member，并将其作为 Platform contact 添加到当前 workspace。

#### Scenario: 搜索 Organization member

- **WHEN** EE 管理员输入 Organization 搜索关键字
- **THEN** 前端 MUST 通过独立 repository query 返回可加入候选人

#### Scenario: 排除已有 Contact

- **WHEN** Organization candidate 已是当前 workspace contact 或 Platform contact
- **THEN** 前端 MUST 将其排除或明确标记为不可重复选择

#### Scenario: 多选添加 Platform contact

- **WHEN** 管理员选择一个或多个有效候选人并确认
- **THEN** mock repository MUST 将其加入当前 Contacts，并将 `kind` 标记为 `platform`

#### Scenario: 添加进行中

- **WHEN** 添加 Platform contact mutation 尚未结束
- **THEN** 前端 MUST 禁止重复提交并保持当前选择可见

#### Scenario: 添加失败

- **WHEN** mock mutation 失败
- **THEN** 前端 MUST 保留候选选择、展示可恢复错误，MUST NOT 乐观添加列表行

### Requirement: 目录数据必须来自 typed mock repository

本 change 中的 Contacts 列表、Organization candidate、搜索、筛选和分页 MUST 只通过 Contacts-owned repository interface 访问 mock 数据。

#### Scenario: 目录初始化

- **WHEN** Contacts 页面首次加载
- **THEN** 前端 MUST 通过 repository query 读取 typed view model，MUST NOT 直接 import 零散 fixture

#### Scenario: 切换命名 scenario

- **WHEN** 测试或开发预览选择一个命名 mock scenario
- **THEN** repository MUST 确定性返回该 scenario 的 deployment、权限、目录和错误状态

#### Scenario: 禁止真实请求

- **WHEN** 用户浏览、搜索、筛选或添加 Platform contact
- **THEN** 当前 change MUST NOT 调用真实后端或 Organization directory API

### Requirement: 列表浏览上下文必须可恢复且可访问

前端 MUST 在打开详情并返回后保留列表的搜索、筛选和分页上下文。控件、表头、状态与行操作 MUST 支持键盘和辅助技术。

#### Scenario: 从详情返回列表

- **WHEN** 用户从一个 Contact 详情返回目录
- **THEN** 前端 MUST 恢复原搜索、筛选和已加载位置

#### Scenario: 键盘打开 Contact

- **WHEN** 用户只使用键盘定位并打开列表中的 Contact
- **THEN** 前端 MUST 提供可辨识名称、可见焦点和正确详情触发行为

#### Scenario: 列表状态发生变化

- **WHEN** 搜索或 mutation 改变可见结果
- **THEN** 前端 MUST 以不会造成重复噪声的方式向辅助技术表达关键结果变化
