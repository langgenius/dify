## ADDED Requirements

### Requirement: Contacts 必须提供 Organization 级 IM platform 绑定入口

前端 MUST 在 Contacts 管理区域展示当前 Organization 的 IM platform 绑定状态与管理入口。该入口只用于联系人目录、联系人 IM identity 与通讯录同步，MUST NOT 被解释为 Agent、App 或 workflow 的渠道绑定。

#### Scenario: 尚未绑定 IM platform

- **WHEN** 具备 mock 管理权限的用户打开 Contacts，且当前 scenario 没有 IM platform 配置
- **THEN** 前端 MUST 展示未绑定状态和开始绑定操作

#### Scenario: 已绑定 IM platform

- **WHEN** 当前 scenario 已有 IM platform 配置
- **THEN** 前端 MUST 展示 provider、连接状态、最近检查信息、最近同步摘要以及当前可执行操作

#### Scenario: Agent Roster 不承载该入口

- **WHEN** 用户浏览可复用 AI Agent 的 Agent Roster
- **THEN** 前端 MUST NOT 在该列表中展示或管理本 capability 的联系人 IM platform 绑定

### Requirement: 绑定 UI 必须只通过 typed mock repository 访问数据

本 change 中的绑定页面、query 和 mutation MUST 通过 Contacts-owned repository interface 访问类型安全的 mock 数据。组件 MUST NOT 直接 import 零散 fixture、调用真实 IM provider、调用后端 API 或依赖生成式 API client。

#### Scenario: 初始读取绑定状态

- **WHEN** 绑定页面初始化
- **THEN** 前端 MUST 通过 repository 读取 integration、provider definition、permission 和 capability view model

#### Scenario: 切换验收场景

- **WHEN** 测试或开发预览选择一个命名 mock scenario
- **THEN** repository MUST 确定性返回该场景对应的状态、错误和可执行操作

#### Scenario: 未来替换数据实现

- **WHEN** 后续 change 提供真实 API repository adapter
- **THEN** 页面组件的 props、query keys 和业务状态语义 SHOULD 无需改写即可切换 adapter

#### Scenario: 前端操作不访问真实服务

- **WHEN** 用户保存、测试、授权、替换或解除绑定
- **THEN** 当前 change 的实现 MUST 只调用 mock repository，MUST NOT 新增后端 endpoint、OpenAPI schema 或网络请求

### Requirement: 管理入口必须展示部署形态与权限差异

前端 MUST 支持 EE 企业管理面和 CE / SaaS workspace 管理面的 Contacts IM platform 入口。EE scenario 由企业管理员管理；CE / SaaS scenario 由 workspace owner 或 workspace admin 管理。该权限结果 MUST 来自 mock context，且 MUST 被明确视为 UI 展示状态而非真实安全边界。

#### Scenario: EE 企业管理员管理绑定

- **WHEN** EE 企业管理员 scenario 从企业 Contacts 管理面进入 IM platform 设置
- **THEN** 前端 MUST 允许其查看和操作当前 Organization 的 mock 绑定

#### Scenario: CE 或 SaaS 管理员管理绑定

- **WHEN** CE / SaaS workspace owner 或 workspace admin scenario 从 workspace Contacts 管理面进入 IM platform 设置
- **THEN** 前端 MUST 允许其查看和操作当前 Organization 的 mock 绑定

#### Scenario: 无管理权限

- **WHEN** 当前 mock context 的 `can_manage` 为 false
- **THEN** 前端 MUST 隐藏或禁用写操作，并 MUST 展示明确的权限说明

#### Scenario: 权限状态读取失败

- **WHEN** mock repository 返回权限读取失败
- **THEN** 前端 MUST 展示专用错误和重试操作，MUST NOT 将其降级为 `Not configured`

### Requirement: 同一 Organization 同时只能展示一个 active IM platform

前端 MUST 将当前 Organization 的 IM platform 作为单选绑定能力管理。已有 mock 绑定时，前端 MUST 展示该 provider 的配置，MUST NOT 在未确认替换或解除现有绑定的情况下创建第二个 active provider。

#### Scenario: 首次选择 provider

- **WHEN** 当前 scenario 尚未配置 IM platform，且管理员选择一个可用 provider
- **THEN** 前端 MUST 打开该 provider 对应的绑定流程

#### Scenario: 已有 active provider

- **WHEN** 当前 scenario 已绑定一个 provider
- **THEN** 前端 MUST 将该 provider 作为当前唯一 active binding 展示

#### Scenario: 替换 provider

- **WHEN** 管理员尝试将当前 provider 替换为另一个 provider
- **THEN** 前端 MUST 在执行 mock mutation 前要求确认，并 MUST 展示 scenario 提供的影响说明

### Requirement: 绑定流程必须适配 mock provider definition

前端 MUST 根据 typed mock provider definition 展示可用 provider、认证方式、必填字段、callback 信息和能力说明。凭据型 provider MUST 使用 provider-specific 表单；OAuth 型 provider MUST 使用可控的 mock 授权流程。

#### Scenario: 配置凭据型 provider

- **WHEN** 管理员选择使用 App ID、App Secret 或同类凭据的 provider
- **THEN** 前端 MUST 展示该 provider 所需字段、必填校验、帮助说明和可复制的 callback 信息

#### Scenario: 配置 OAuth 型 provider

- **WHEN** 管理员选择 OAuth 型 provider 并开始授权
- **THEN** 前端 MUST 进入 mock authorization pending 状态，并在 scenario 返回后刷新 repository 中的绑定状态

#### Scenario: Provider 当前不可用

- **WHEN** mock provider definition 将某个 provider 标记为未发布、不受当前部署支持或缺少必要能力
- **THEN** 前端 MUST 禁止开始该 provider 的绑定，并 MUST 展示可理解的不可用原因

#### Scenario: 必填字段缺失

- **WHEN** 管理员提交凭据表单但缺少 provider 要求的字段
- **THEN** 前端 MUST 阻止 mutation 并在对应字段附近展示校验信息

### Requirement: Secret 必须在 mock 绑定 UI 中保持不可回显

前端和 mock fixture MUST NOT 保存、返回或预填可回显的真实 secret。已有绑定只能通过 `secret_configured` 或等价状态表达。若管理员未提供替换值，前端 MUST NOT 把掩码或占位符作为新 secret 传给 repository。

#### Scenario: 打开已有绑定配置

- **WHEN** 管理员打开一个已配置 App Secret 的 mock provider
- **THEN** DOM、fixture、日志、错误反馈和测试快照 MUST NOT 包含原 secret

#### Scenario: 更新非 secret 字段

- **WHEN** 管理员只修改非 secret 字段并保留原 secret
- **THEN** 前端 MUST 省略替换值或发送 typed retain-secret command，MUST NOT 发送掩码文本

#### Scenario: 替换 secret

- **WHEN** 管理员显式输入新的 secret 并执行保存
- **THEN** mock repository MUST 只记录“secret 已替换”的状态并立即丢弃输入文本，提交完成后 UI MUST 恢复为不可回显状态

### Requirement: UI 必须完整表达六种 IM connection status

前端 MUST 使用 mock repository state 区分 `Not configured`、`Configured`、`Connected`、`Permission issue`、`Callback error`、`Connection error`。错误状态 MUST 展示可安全公开的原因、最近检查时间以及适用的恢复操作。

#### Scenario: 配置已保存但尚未验证

- **WHEN** mock provider 配置已保存但尚未完成连接测试
- **THEN** 前端 MUST 展示 `Configured`，MUST NOT 将其误报为 `Connected`

#### Scenario: Mock 连接测试成功

- **WHEN** 当前 scenario 的测试连接 mutation 成功
- **THEN** repository MUST 将状态推进为 `Connected`，前端 MUST 刷新并展示新的可用操作

#### Scenario: Provider 权限不足

- **WHEN** repository 返回 `Permission issue`
- **THEN** 前端 MUST 展示缺失权限或修复指引，并 MUST 提供重新测试或更新配置入口

#### Scenario: Callback 配置异常

- **WHEN** repository 返回 `Callback error`
- **THEN** 前端 MUST 展示 callback 相关原因和可复制的正确 callback 信息

#### Scenario: 其他连接失败

- **WHEN** repository 返回 `Connection error`
- **THEN** 前端 MUST 展示安全的失败原因和重试入口，MUST NOT 暴露凭据

### Requirement: 保存、测试、更新与解除绑定必须防止重复操作

前端 MUST 为保存配置、mock 测试连接、更新配置、替换 provider 和解除绑定提供明确的 pending、成功与失败状态。操作进行中 MUST 防止重复 mutation；失败时 MUST 保留可安全保留的表单内容，并通过重新读取 repository 确认最终状态。

#### Scenario: 保存进行中

- **WHEN** mock 保存 mutation 尚未结束
- **THEN** 前端 MUST 禁用会产生重复写入的操作并展示进行中状态

#### Scenario: 保存失败

- **WHEN** scenario 配置保存 mutation 失败
- **THEN** 前端 MUST 保持表单可继续修正，展示安全失败原因，MUST NOT 乐观展示成功状态

#### Scenario: 测试连接

- **WHEN** 管理员触发 mock 测试连接
- **THEN** 前端 MUST 防止并发重复测试，并 MUST 在 mutation 结束后重新读取 connection status

#### Scenario: 解除绑定

- **WHEN** 管理员确认解除当前 IM platform 绑定，且 mock mutation 成功
- **THEN** 前端 MUST 展示 `Not configured` 并关闭新的通讯录同步入口

### Requirement: 绑定 UI 必须具备完整的基础交互状态

前端 MUST 为初始加载、加载失败、空状态、表单错误、权限受限和操作成功提供可访问且国际化的反馈。用户可见文案 MUST 使用项目 i18n 资源，交互控件 MUST 支持键盘操作与可辨识的 focus 状态。

#### Scenario: 初始数据加载失败

- **WHEN** mock repository 返回 Contacts IM platform 状态加载失败
- **THEN** 前端 MUST 展示错误状态和重试操作，MUST NOT 将失败误显示为未绑定

#### Scenario: 键盘完成绑定

- **WHEN** 管理员只使用键盘浏览 provider、填写表单并提交
- **THEN** 前端 MUST 保持合理的焦点顺序、可见焦点和可读错误关联

#### Scenario: Overlay 关闭后恢复焦点

- **WHEN** 管理员关闭 binding dialog 或 drawer
- **THEN** 前端 MUST 将焦点恢复到打开该 overlay 的触发控件
