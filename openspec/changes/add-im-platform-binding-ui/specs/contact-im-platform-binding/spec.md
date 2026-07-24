## ADDED Requirements

### Requirement: Contacts 必须提供 Organization 级 Channels 入口

前端 MUST 在 Contacts 管理区域以 `Channels` 作为当前 Organization 的 channel 管理入口与页面标题。该入口只用于 Human Input 通知、联系人目录、联系人 IM identity 与通讯录同步，MUST NOT 被解释为 Agent、App 或 workflow 的渠道绑定。

#### Scenario: 尚未连接 channel

- **WHEN** 具备 mock 管理权限的用户打开 Channels，且当前 scenario 没有 channel 配置
- **THEN** 前端 MUST 展示 `Choose a channel to connect` 分组、Email 与可用 IM provider，以及每项的 Connect 操作

#### Scenario: 已配置 channel

- **WHEN** 当前 scenario 已有一个或多个 channel 配置
- **THEN** 前端 MUST 将已配置 channel 置于列表顶部，展示 provider、脱敏配置摘要和当前可执行操作，并在适用时展示最近同步摘要

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

### Requirement: 管理入口必须只在非企业版 workspace 展示

前端 MUST 只在非 enterprise plan 的 CE / SaaS workspace 管理面展示 Contacts IM platform 入口，并 MUST 复用现有 workspace plan 判断。非企业版由 workspace owner 或 workspace admin 管理；权限结果 MUST 来自 mock context，且 MUST 被明确视为 UI 展示状态而非真实安全边界。

#### Scenario: 企业版不展示绑定入口

- **WHEN** 当前 workspace plan 为 enterprise
- **THEN** 前端 MUST 不展示 Contacts IM platform 入口，且通过深链请求该 tab 时 MUST 回退到允许访问的设置页

#### Scenario: 非企业版管理员管理绑定

- **WHEN** 非 enterprise plan 的 CE / SaaS workspace owner 或 workspace admin 从 workspace Contacts 管理面进入 IM platform 设置
- **THEN** 前端 MUST 允许其查看和操作当前 Organization 的 mock 绑定

#### Scenario: 无管理权限

- **WHEN** 当前 mock context 的 `can_manage` 为 false
- **THEN** 前端 MUST 隐藏或禁用写操作，并 MUST 展示明确的权限说明

#### Scenario: 权限状态读取失败

- **WHEN** mock repository 返回权限读取失败
- **THEN** 前端 MUST 展示专用错误和重试操作，MUST NOT 将其降级为 `Not configured`

### Requirement: 同一 Organization 最多只能有一个 active IM binding

前端 MUST 允许 Email channel 与一个 active IM provider channel 同时存在。active IM binding 指尚未删除的非 Email integration，与其 connection status 是 `Configured`、`Connected` 或错误状态无关。已配置 provider MUST 从可连接列表移至已配置列表；已有 active IM binding 时，前端 MUST NOT 在未确认替换的情况下创建另一个 IM provider binding。

#### Scenario: 首次选择 provider

- **WHEN** 当前 scenario 尚未配置 IM platform，且管理员选择一个可用 provider
- **THEN** 前端 MUST 打开该 provider 对应的绑定流程

#### Scenario: Email 与 active IM binding 共存

- **WHEN** 当前 scenario 已配置 Email channel 和一个尚未删除的 IM provider
- **THEN** 前端 MUST 同时展示 Email 与该 IM provider，并 MUST 将其他尚未配置的 IM provider 展示为 replacement candidate

#### Scenario: 重复连接同一 provider

- **WHEN** 管理员尝试再次连接已配置 provider
- **THEN** 前端 MUST 引导其使用 Configure 操作，MUST NOT 创建第二份 active 配置

#### Scenario: 替换 active IM provider

- **WHEN** 管理员尝试将当前 IM provider 替换为另一个 IM provider
- **THEN** 前端 MUST 在执行 mock mutation 前要求确认，并 MUST 明确说明旧 provider 的 IM bindings 和 workspace overrides 将失效，且管理员需要为新 provider 重新执行通讯录同步

### Requirement: Email channel 必须使用 Resend 专用配置流程

前端 MUST 为 Email channel 提供独立的 Configure Email overlay。Email provider MUST 固定展示为不可编辑的 `Resend`，表单 MUST 包含必填 sender email、可选 sender name 与必填 API key，并 MUST 提供 Test connection、Cancel 和 Save 操作。

#### Scenario: 首次连接 Email

- **WHEN** 管理员在未配置 Email 时选择 Connect
- **THEN** 前端 MUST 打开 Configure Email overlay，并展示该配置作用于 workspace Human Input Email 通知的说明

#### Scenario: Email 必填校验

- **WHEN** 管理员缺少 sender email、输入无效 email 或缺少 API key 时保存或测试连接
- **THEN** 前端 MUST 阻止 mock mutation，并 MUST 在对应字段附近展示国际化校验信息

#### Scenario: Email 测试连接

- **WHEN** 管理员提交合法 Email 配置并选择 Test connection
- **THEN** 前端 MUST 调用可控的 mock test mutation、防止重复提交，并 MUST 展示成功或安全的失败反馈而不关闭弹窗

#### Scenario: 保存 Email 配置

- **WHEN** 管理员提交合法 Email 配置且 mock save mutation 成功
- **THEN** 前端 MUST 关闭 overlay，将 Email 移入已配置列表，并 MUST 只展示 `Resend · <sender email>` 摘要

#### Scenario: 编辑已配置 Email

- **WHEN** 管理员打开已配置 Email 的 Configure overlay
- **THEN** 前端 MUST 预填非敏感 sender 字段，MUST NOT 回显 API key，并 MUST 允许在不替换 API key 时保留已有 secret

### Requirement: 已配置 channel 必须提供 Configure 与 Delete 操作

每个已配置 channel 的右侧 MUST 展示两个具有可访问名称的独立操作按钮。Configure MUST 打开该 channel 对应的配置 overlay；Delete MUST 先打开包含 channel 名称与影响说明的破坏性确认弹窗，只有确认后才能调用 mock delete mutation。

#### Scenario: 配置已连接的 IM provider

- **WHEN** 管理员选择已配置 IM channel 的 Configure 操作
- **THEN** 前端 MUST 打开该 provider 的配置 overlay，并 MUST 遵守已有 secret 不回显与 retain-secret 规则

#### Scenario: 取消删除 channel

- **WHEN** 管理员打开删除确认后选择取消或关闭弹窗
- **THEN** 前端 MUST 保留 channel 配置，MUST NOT 调用 delete mutation，并 MUST 将焦点恢复到原 Delete 按钮

#### Scenario: 确认删除 channel

- **WHEN** 管理员确认删除且 mock delete mutation 成功
- **THEN** 前端 MUST 从已配置列表移除该 channel，并将其恢复到可连接列表

#### Scenario: 删除 channel 失败

- **WHEN** mock delete mutation 失败
- **THEN** 前端 MUST 保留原 channel、展示安全错误并允许重试，MUST NOT 乐观显示删除成功

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

前端 MUST 为保存配置、mock 测试连接、更新配置和删除 channel 提供明确的 pending、成功与失败状态。操作进行中 MUST 防止重复 mutation；失败时 MUST 保留可安全保留的表单内容，并通过重新读取 repository 确认最终状态。

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
- **THEN** 前端 MUST 将该 provider 恢复为可连接状态，并在没有剩余可同步 IM channel 时关闭通讯录同步入口

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
