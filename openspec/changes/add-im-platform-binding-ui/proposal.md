## Why

Contacts 目前缺少用于配置 Organization 级通知 Channels、触发 IM 通讯录同步以及排查同步结果的完整管理界面，管理员无法在产品内完成从“连接渠道”到“确认联系人映射结果”的闭环。最新设计将原 IM platform 菜单统一为 Channels，并增加 Email channel 与已配置 channel 的管理操作，需要同步更新为可实施、可验收的规格。

## What Changes

- 在 Contacts 管理区域将原 IM platform 入口调整为 Channels，展示 Email、Slack、Feishu、DingTalk 等 channel 的可连接与已配置状态。
- 增加 Email channel 的 Resend 专用配置弹窗，支持 sender email、可选 sender name、API key、测试连接和保存交互。
- 已配置 channel 以卡片摘要展示，并在右侧提供 Configure 与 Delete 操作；删除必须经过破坏性确认弹窗。
- 提供首次绑定、补全配置、重新连接和更新配置的交互流程，并覆盖 provider 特定字段、表单校验、保存中状态与失败反馈。
- 将连接状态映射为 `Not configured`、`Configured`、`Connected`、`Permission issue`、`Callback error`、`Connection error`，为异常状态提供可排查原因和恢复入口。
- 支持由具备权限的管理员手动触发 IM 联系人同步，并展示同步进行中、成功、部分成功和失败状态。
- 增加同步详情视图，展示同步时间、发起人、结果汇总以及 matched、updated、unmatched、skipped、failed 等明细。
- 补齐权限受限、空数据、加载、重复提交、mock mutation 失败和重试等 UI 状态，并确保 secret 不被回显或写入前端日志。
- 本 change 只实现前端：所有展示与交互先通过集中、类型安全、可替换的 mock repository 驱动；真实后端 contract 与 API 接入留给后续独立 change。
- 以用户提供的 Channels、Email 配置、provider 配置和同步详情 Figma 节点作为布局、文案层级和交互验收基准。

## Capabilities

### New Capabilities

- `contact-im-platform-binding`: 管理员在 Contacts 的 Channels 中配置 Email 与 IM provider、管理已配置 channel，并从异常状态恢复连接。
- `contact-im-directory-sync-details`: 管理员手动同步 IM 通讯录并查看一次同步的汇总、逐项匹配结果、异常原因和后续处理入口。

### Modified Capabilities

无。

## Impact

- 前端需要在 Contacts feature 边界内实现管理界面、相关路由、typed mock repository、dify-ui 组件使用和 `web/i18n/*` 文案。现有 `web/features/agent-v2/roster/` 管理的是可复用 AI Agent 资产，不属于本 change。
- 本 change 不修改后端 API、OpenAPI schema、生成式 client、数据模型、数据库迁移、任务队列、provider adapter 或真实 OAuth / credential 存储逻辑。
- Channels 入口只在非企业版的 CE / SaaS workspace 管理面展示，并复用现有 workspace plan 判断隐藏 enterprise plan；角色权限、provider availability 和各类状态暂由 mock scenario 提供，仅用于前端行为展示，不构成安全边界。
- 需要为权限、连接状态、表单提交、手动同步、匹配结果和同步详情补充 Vitest / Testing Library 测试，并使用确定性的 mock scenario 完成前端 smoke 验证。
- 后续后端能力就绪时，应通过新的 change 用真实 repository adapter 替换 mock repository，而不改写页面组件的状态语义。
- 设计验收来源：
  - Channels 与配置界面：Figma nodes `1649:6572`、`1613:5906`、`1646:5214`、`2188:34008`
  - 同步详情：Figma nodes `1634:5098`、`1634:5104`
