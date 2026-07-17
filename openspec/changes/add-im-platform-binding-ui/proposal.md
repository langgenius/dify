## Why

Contacts 目前缺少用于配置 Organization 级 IM platform、触发通讯录同步以及排查同步结果的完整管理界面，管理员无法在产品内完成从“绑定渠道”到“确认联系人映射结果”的闭环。设计稿已经定义了绑定与同步详情的主要交互，需要将其整理为可实施、可验收的规格。

## What Changes

- 在 Contacts 管理区域增加 IM platform 管理入口，展示当前 provider、连接状态、最近同步信息和可执行操作。
- 提供首次绑定、补全配置、重新连接和更新配置的交互流程，并覆盖 provider 特定字段、表单校验、保存中状态与失败反馈。
- 将连接状态映射为 `Not configured`、`Configured`、`Connected`、`Permission issue`、`Callback error`、`Connection error`，为异常状态提供可排查原因和恢复入口。
- 支持由具备权限的管理员手动触发 IM 联系人同步，并展示同步进行中、成功、部分成功和失败状态。
- 增加同步详情视图，展示同步时间、发起人、结果汇总以及 matched、updated、unmatched、skipped、failed 等明细。
- 补齐权限受限、空数据、加载、重复提交、mock mutation 失败和重试等 UI 状态，并确保 secret 不被回显或写入前端日志。
- 本 change 只实现前端：所有展示与交互先通过集中、类型安全、可替换的 mock repository 驱动；真实后端 contract 与 API 接入留给后续独立 change。
- 以用户提供的六个 Figma 节点作为布局、文案层级和交互验收基准。

## Capabilities

### New Capabilities

- `contact-im-platform-binding`: 管理员在 Contacts 中查看 IM platform 状态、完成 provider 绑定或更新配置，并从异常状态恢复连接。
- `contact-im-directory-sync-details`: 管理员手动同步 IM 通讯录并查看一次同步的汇总、逐项匹配结果、异常原因和后续处理入口。

### Modified Capabilities

无。

## Impact

- 前端需要在 Contacts feature 边界内实现管理界面、相关路由、typed mock repository、dify-ui 组件使用和 `web/i18n/*` 文案。现有 `web/features/agent-v2/roster/` 管理的是可复用 AI Agent 资产，不属于本 change。
- 本 change 不修改后端 API、OpenAPI schema、生成式 client、数据模型、数据库迁移、任务队列、provider adapter 或真实 OAuth / credential 存储逻辑。
- 管理入口只在非企业版的 CE / SaaS workspace 管理面展示，并复用现有 workspace plan 判断隐藏 enterprise plan；角色权限、provider availability 和各类状态暂由 mock scenario 提供，仅用于前端行为展示，不构成安全边界。
- 需要为权限、连接状态、表单提交、手动同步、匹配结果和同步详情补充 Vitest / Testing Library 测试，并使用确定性的 mock scenario 完成前端 smoke 验证。
- 后续后端能力就绪时，应通过新的 change 用真实 repository adapter 替换 mock repository，而不改写页面组件的状态语义。
- 设计验收来源：
  - 绑定界面：Figma nodes `1649:6572`、`1613:5906`、`1646:5214`、`1646:5959`
  - 同步详情：Figma nodes `1634:5098`、`1634:5104`
