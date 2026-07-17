## Context

本 change 只覆盖 Contacts 领域中的 Organization 级 IM platform 绑定与通讯录同步详情。它不涉及 Agent 发布、Agent Roster、App access point 或 workflow node binding。Figma 文件虽然名为 “Agent Roster”，但用户已经明确这些节点表达的是 Contacts 的 IM platform 管理 UI。

已有 `hitl-im-contact-domain-discovery` change 已确认以下领域约束，本 change 直接复用而不重新定义：

- 同一 Organization 一期只启用一个 IM platform。
- 该 workspace 入口只面向非企业版；CE / SaaS 由 workspace owner 或 workspace admin 管理，enterprise plan 不展示本入口。
- 连接状态包含 `Not configured`、`Configured`、`Connected`、`Permission issue`、`Callback error`、`Connection error`。
- 通讯录同步由管理员手动触发，不做自动同步。
- 同步优先按 platform user ID 匹配已有 binding，再按 Email 匹配 Contact；未命中对象进入 unmatched，不能自动创建 External contact。

本 change 的实现范围严格限定为前端。后端 contract 尚未就绪，因此页面、查询、mutation、权限、provider availability、同步任务和同步详情均由集中、类型安全、确定性的 mock repository 驱动。后续真实 API 接入必须通过独立 change 完成。

当前 web 中的 `web/features/agent-v2/roster/` 是 AI Agent 资产管理，不能作为 Contacts UI 的实现位置。Contacts feature 需要拥有自己的组件、数据访问抽象和路由边界，并由非企业版 CE / SaaS workspace 设置页挂载。

设计验收来源：

| 范围     | Figma node                                         |
| -------- | -------------------------------------------------- |
| 绑定界面 | `1649:6572`、`1613:5906`、`1646:5214`、`1646:5959` |
| 同步详情 | `1634:5098`、`1634:5104`                           |

## Goals / Non-Goals

**Goals:**

- 在 Contacts 管理区域提供从未绑定、配置、mock 授权、连接异常到已连接的完整 IM platform 管理体验。
- 在非 enterprise plan 的 CE / SaaS workspace 设置页提供 Contacts feature UI，并在 enterprise plan 隐藏入口。
- 支持手动启动 mock 通讯录同步、恢复 mock 进行中任务、查看最新摘要和指定 sync run 详情。
- 清晰表达 matched、created binding、updated binding、unmatched、skipped、failed 等结果，帮助管理员理解联系人映射。
- 将数据访问集中在可替换的 typed repository，避免页面组件直接依赖 fixture shape。
- 遵循 i18n、dify-ui、可访问性和前端测试约束。

**Non-Goals:**

- 不实现或修改 Agent、Agent Roster、Agent access point 或 workflow Agent binding。
- 不在本 change 中实现 Contact CRUD、External contact 创建、workspace IM override 或单个 Contact 的 IM identity 编辑。
- 不实现 unmatched 的手动映射、忽略或转 Contact 操作；同步详情保持只读。
- 不修改后端 API、OpenAPI schema、生成式 client、领域模型、数据库迁移、Celery task、provider adapter 或 credential 加密逻辑。
- 不执行真实 OAuth、真实 provider callback、真实网络连接测试、真实目录同步或服务端权限校验。
- 不支持同一 Organization 同时启用多个 IM platform。
- 不建设完整同步历史审计产品；只展示当前进行中的任务、最近结果和由 `sync_run_id` 指定的 mock 详情。

## Decisions

### 1. Contacts feature 独立拥有 UI，并由不同管理 shell 挂载

实现建立 Contacts-owned feature 模块，包含 binding summary、provider setup、connection diagnostics、sync trigger 和 sync details。CE / SaaS workspace 设置页负责使用现有 plan 判断、提供 Organization context、mock permission context 和返回路径；enterprise plan 不挂载该入口。

AI Agent Roster 与 Human Contacts 的数据、权限和生命周期完全不同，因此不复用 `web/features/agent-v2/roster/`。

### 2. Typed mock repository 是唯一数据边界

组件不得直接 import 零散 JSON fixture，也不得在组件内按场景硬编码响应。feature 定义稳定的前端 view model 和 repository interface，例如：

```text
ContactIMIntegrationView
  organization_id
  provider
  status
  safe_status_reason
  last_checked_at
  can_manage
  capabilities.directory_sync
  secret_configured
  last_sync

ContactIMProviderDefinition
  provider
  display_name
  availability
  unavailable_reason
  auth_mode
  callback_url
  required_fields

ContactIMSyncRunView
  id
  status
  started_at
  started_by
  completed_at
  counts
  safe_error

ContactIMSyncItemView
  id
  result
  platform_identity
  matched_contact
  safe_reason
```

repository 暴露读取 integration/provider、保存配置、mock 授权、测试连接、解除绑定、启动同步、读取 active run 和分页读取详情等方法。mock 实现通过命名 scenario 或 seed 创建状态，所有延迟、错误和状态迁移必须确定且可在测试中控制，不能依赖随机数或不可控的真实计时。

后续真实后端就绪时，应新增实现相同 interface 的 API repository adapter，再由 composition root 切换依赖；页面组件和业务状态语义不应因此改写。

### 3. 使用共享绑定 shell 与 provider-specific form adapter

绑定 dialog / drawer 共享标题、状态、footer、错误反馈和 callback 区域；每个 provider 使用类型明确的 form adapter 处理自己的字段、帮助文案和认证方式。provider availability 和 capability 暂由 mock provider definition 提供。

不采用完全动态 JSON form renderer，因为 App ID、OAuth、callback、权限说明等交互差异较大；也不为每个 provider 复制完整 overlay，以避免状态和错误处理分叉。

### 4. 连接状态与 mutation 状态分层

`Not configured` 等六种状态来自 repository 中持久化的 mock integration state。`saving`、`testing`、`authorizing`、`disconnecting` 是短暂的前端 mutation state，不写入 connection status。

- 保存凭据成功后刷新 integration，mock repository 可将状态推进到 `Configured`。
- 测试连接或 mock OAuth 结束后刷新 integration，由当前 scenario 决定最终六态。
- 所有 mutation pending 时阻止重复提交。
- 不做会伪造成功结果的 optimistic update。

### 5. Secret fixture 只表达配置状态，不保存真实 secret

已配置的 mock 数据只包含 `secret_configured: true` 或等价标识，不包含可回显 secret。用户输入新 secret 时，repository 只记录“已替换”的结果或版本标识，并立即丢弃原始文本；测试不得打印或快照 secret。

编辑非 secret 字段时使用字段省略或明确的 retain-secret command，掩码文本不得进入 mutation payload。

### 6. Mock sync run 使用 mutation 启动、query 恢复和有限 polling

启动同步 mutation 返回稳定的 `sync_run_id`。随后以该 ID 查询状态，只在 queued / running 时 polling；进入 success、partial success 或 failure 后停止 polling，并刷新 integration summary 和 detail query。

页面初始化时读取 mock active run。若 scenario 中存在进行中任务，UI 恢复该任务而不是创建新任务。mock repository 应允许测试通过 fake timers 或显式推进函数控制状态变化。

### 7. Sync details 以 `sync_run_id` 为稳定上下文

同步详情 surface 按 Figma 采用页面、drawer 或 dialog 的最终形态，但数据上下文必须由 `sync_run_id` 标识。推荐将该 ID 放入 URL query state，使刷新、返回和错误恢复不会丢失当前详情。

详情 query 支持 result filter 与 mock pagination。缺失 Email、Contact 或 platform name 时显示统一空值，不通过其他前端缓存猜测补全。

### 8. Summary 与 detail 使用统一结果 taxonomy

- `matched`：已匹配且 binding 无需修改。
- `created_binding`：创建新的 Contact IM binding。
- `updated_binding`：更新已有 Contact IM binding。
- `unmatched`：无法映射到 Contact，留待人工处理。
- `skipped`：因重复、缺少必要字段或规则明确忽略。
- `failed`：单条处理发生错误。

任务级状态与条目级分类分开：有成功条目同时也有 unmatched、skipped 或 failed 时，任务 UI 显示 partial success。

### 9. 权限和 provider gate 是 mock 展示状态，不是安全边界

入口 shell 根据 mock `can_manage` 和 provider capability 隐藏或禁用绑定、测试、同步和解除绑定操作，并展示相应解释。由于本 change 没有后端，权限场景只用于验收前端降级行为，不可被视为真实授权机制。

### 10. 使用 React Query、repository 与局部表单状态

- Integration、provider definitions、active sync 和 sync detail 通过 React Query 包装 repository 读取。
- 绑定表单草稿仅由 overlay 局部状态拥有，不引入新的全局 store。
- mutation 成功后按 query key 精确失效。
- overlay 使用 `@langgenius/dify-ui/*` primitives。
- mock repository 由 feature composition 层注入，生产构建不发出后端请求。

### 11. 测试围绕可观察状态机与替换边界

前端测试至少覆盖：

- 无绑定、已配置、已连接和三类错误状态。
- credential 与 mock OAuth 两种认证路径。
- secret 不回显、掩码不提交、更新时保留原 secret。
- 无权限、provider 不可用、保存 / 测试失败和重复提交。
- 同步按钮 gate、active run 恢复、polling 停止、成功 / 部分成功 / 失败摘要。
- 详情筛选、mock 分页、加载失败、unmatched 只读和敏感错误脱敏。
- 关键 overlay 的焦点恢复、键盘提交和错误关联。
- 页面只通过 repository interface 访问数据，替换 repository implementation 不改变组件 contract。

## Risks / Trade-offs

- [Mock shape 与未来 API 漂移] → 以 UI 所需 view model 为稳定边界；真实 adapter 负责映射后端 DTO，而不是让组件依赖后端 shape。
- [Mock 交互被误认为真实功能] → 入口使用 feature gate，并在交付说明中明确没有后端持久化、真实授权和真实同步。
- [Figma 中 provider-specific 差异可能继续调整] → 保留共享 shell 与 provider adapter 边界，将视觉差异限制在 adapter 内。
- [企业版误展示 mock 入口] → workspace shell 复用现有 `Plan.enterprise` 判断，深链同样回退到允许访问的 tab。
- [不可控 polling 造成测试不稳定] → mock 状态迁移使用 fake timers 或显式推进，不使用随机延迟。
- [大型详情 fixture 降低测试性能] → 用小型分页 fixture 验证增量加载，不生成大规模浏览器内数据。
- [Secret 泄露到 fixture 或快照] → fixture 只保存配置标记，repository 丢弃输入文本，测试断言日志与 DOM 中无 secret。

## Migration Plan

1. 建立 Contacts-owned view model、repository interface、query keys 和命名 mock scenarios。
2. 在 mock repository 上完成绑定、连接状态、手动同步与同步详情 UI。
3. 完成 Vitest / Testing Library 覆盖、Figma 对照、i18n、可访问性和前端 smoke。
4. 通过现有产品 feature gate 控制入口开放范围。

本 change 不包含数据迁移，也不要求任何后端部署步骤。回滚时关闭或移除前端入口即可。

后端能力就绪后另建 change：实现真实 contract 与 API repository adapter、补充服务端权限和 credential 安全，并将 composition root 从 mock 切换为真实 adapter。

## Open Questions

- 首个前端 mock 需要展示哪些 provider、认证方式和 directory sync capability，需在实现时依据 Figma 可见内容确定。
- 替换或解除 provider 的最终数据影响必须由后续 Contacts / IM 后端 contract 决定；当前 mock 只用于展示确认交互。
- Figma 中 callback、权限说明和 provider 帮助链接的最终文案，需要在实现阶段通过已授权的 Figma 访问核对。
