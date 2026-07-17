## Context

本 change 只覆盖 Contacts 领域的前端管理体验：联系人列表、联系人详情、添加 External contact、EE 下从 Organization 添加 Platform contact，以及移除 workspace member 时的 Contacts 影响提示。Figma 文件虽然名为 “Agent Roster”，这些节点在本 change 中只作为 Contacts UI 验收来源，不引入任何 Agent 领域能力。

已有 `hitl-im-contact-domain-discovery` change 已确认以下领域约束：

- Contact 分为 `workspace contact`、`Platform contact`、`External contact`。
- CE / SaaS 的 workspace member 自动进入当前 workspace Contacts。
- EE 不默认向 workspace 展示企业全量联系人；workspace admin 从 Organization 搜索并添加其他 workspace member 后，该对象成为 Platform contact。
- External contact 不属于 Dify Account，只归属当前 workspace，Email 必填，并按整条 Email lower-case 后完全相等判断重复或身份冲突。
- owner / admin 默认具备 Contact 管理权限；普通 member 不得浏览完整 Contacts。
- CE / SaaS 移除 member 后，该联系人从当前 workspace Contacts 移除；EE 移除 member 时可选择保留为 Platform contact。

当前 `web/app/components/header/account-setting/members-page/` 管理 workspace membership，并已有移除 member 的确认弹窗。Contacts 必须拥有独立 feature 与数据边界；成员页面只在移除操作时组合 Contacts 影响提示，不能成为 Contacts 列表或详情的实现位置。

本 change 严格限定为前端。后端数据结构尚未完成，因此目录、详情、Organization 搜索、External contact 创建和 member 移除均由集中、类型安全、确定性的 mock repository 驱动。mock 权限与 mutation 只用于展示和测试，不构成真实安全或持久化边界。

设计验收来源：

| 范围                  | Figma node                                            |
| --------------------- | ----------------------------------------------------- |
| 列表页                | `1294:64487`、`1282:62739`                            |
| Contact 详情          | `1459:32284`、`1515:3382`                             |
| 添加 External contact | `1303:66983`、`1303:67192`、`1303:67388`、`1649:8221` |
| 企业版                | `1459:31142`、`1459:32562`                            |
| 移除 member 提醒      | `1515:3696`、`1649:5297`                              |

## Goals / Non-Goals

**Goals:**

- 建立 Contacts-owned 前端 feature，使列表、详情和管理 overlay 可在 CE / SaaS 与 EE shell 中复用。
- 用 discriminated union 清晰表达三种 Contact，避免把缺失字段误当作同一种数据模型。
- 通过 typed mock repository 覆盖正常、空数据、权限受限、冲突、pending 和失败场景，并为未来真实 adapter 保留稳定边界。
- 支持管理员创建 External contact，以及 EE 管理员从 mock Organization directory 多选添加 Platform contact。
- 将 Contacts 影响合并进现有 member 移除确认流程，避免连续出现两个确认弹窗。
- 遵循 React Query、局部表单状态、dify-ui overlay、i18n、可访问性和前端测试规范。

**Non-Goals:**

- 不修改后端 API、OpenAPI schema、生成式 client、数据模型、数据库迁移、成员服务或 Contact 服务。
- 不执行真实 member 删除、External contact 持久化、Organization 搜索或权限校验。
- 不实现 Organization 级 IM platform 绑定和同步详情；该能力属于 `add-im-platform-binding-ui`。
- 不实现 Contact 在 HITL 节点中的选择器、通知投递、审批鉴权或历史审计。
- 不实现未由本批 Figma 页面明确覆盖的批量编辑、Contact 合并、External contact 删除、workspace IM override 或自由文本 IM identity 编辑。
- 不向普通 member 开放完整 Contacts 目录。

## Decisions

### 1. Contacts feature 与 Members feature 分离，通过窄接口组合

Contacts 建立独立 feature，拥有目录页面、详情 surface、External contact 表单、EE Organization picker、repository 和 query keys。Members feature 继续拥有成员列表和移除入口，只调用 Contacts 提供的 `MemberRemovalContactImpactDialog` 或等价窄组件。

这样可以保留 membership 与 contact identity 的领域边界，同时让一个确认流程同时表达“移除成员”和“联系人去留”。备选方案是把 Contacts 页面扩展在 `members-page` 内，但会混淆成员角色管理与联系人通知身份，因此不采用。

### 2. 使用 discriminated union 表达三种 Contact

前端 view model 使用 `kind` 作为判别字段：

```text
WorkspaceContactView
  kind: workspace
  id
  display_name
  email
  avatar
  membership_status
  workspace_role_summary
  channel_summary

PlatformContactView
  kind: platform
  id
  display_name
  email
  avatar
  organization_identity
  source_workspace_summary
  channel_summary

ExternalContactView
  kind: external
  id
  display_name
  email
  avatar
  workspace_id
  channel_summary.email_only
```

列表行和详情先按 `kind` 分支，再读取类型专属字段。备选方案是一个包含大量 optional 字段的统一 interface，但这会让 UI 难以区分“该类型没有此字段”和“数据加载缺失”，因此不采用。

### 3. Typed mock repository 是本 change 的唯一数据来源

页面和组件不得直接 import 零散 fixture。建议 repository interface 至少提供：

```text
listContacts(query)
getContact(contact_id)
createExternalContact(command)
searchOrganizationCandidates(query)
addPlatformContacts(contact_ids)
getMemberRemovalImpact(member_id)
removeMember(command)
```

mock implementation 使用命名 scenario / seed 描述：

- CE / SaaS 与 EE deployment。
- owner / admin / regular member 权限。
- 空目录、混合联系人、分页目录和失败目录。
- External contact 成功、重复、命中 workspace contact、命中 Platform contact和 mutation 失败。
- Organization 搜索无结果、已有联系人排除、多选成功和失败。
- CE / SaaS 移除、EE 移除并保留、EE 移除且不保留、mutation 失败。

所有延迟与结果必须可通过 fake timers 或显式推进控制，不能使用随机数或不可控真实计时。未来 API adapter 实现同一 interface，并在 composition root 替换 mock；组件不直接依赖后端 DTO。

### 4. React Query 管理 repository state，URL 保存可恢复的浏览上下文

列表 query key 包含 deployment、search、contact kind filter 和 pagination cursor。详情使用稳定 `contact_id`，由路由 segment 或 URL query 表达，具体 surface 以 Figma 为准。关闭详情或返回列表时保留原搜索、筛选和分页位置。

External contact、添加 Platform contact 和移除 member 使用 mutation；成功后精确失效目录、相关详情和 Organization candidate query。表单草稿与 overlay open state 保持局部，不引入全局 store。

### 5. 列表负责浏览，详情负责单个 Contact 的类型语义

列表统一展示 Figma 要求的关键字段，并至少保证名称、Email、类型和当前状态 / 来源可辨识。详情根据 Contact 类型展示 membership、Organization 来源或 External contact 的 workspace 归属与 Email-only 语义。

列表和详情中若出现 IM / Email channel summary，只展示 mock 联系方式状态；不提供 Organization IM platform 配置、同步或 credential 操作。

### 6. External contact 使用 typed result 表达冲突

表单至少拥有 display name 与必填 Email。前端先做必填和格式校验；mock repository 使用 lower-case 完整 Email 进行身份匹配，并返回 typed result：

- `created`
- `duplicate_external_contact`
- `matches_workspace_contact`
- `matches_platform_contact`
- `failed`

组件根据 result 展示明确且可恢复的反馈，而不是解析错误字符串。创建成功后刷新目录，并按 Figma 决定关闭 overlay或进入新 Contact 详情。

真实后端上线后，服务端必须成为最终冲突判定来源；当前客户端规则只用于 mock 验收。

### 7. EE Organization picker 与普通 Contacts 查询分离

EE shell 才展示“从 Organization 添加”操作。Organization candidate 使用独立 query、搜索输入和 selection state；已属于当前 workspace Contacts 的对象不能再次选择。确认后 mock mutation 将候选对象添加为 Platform contact。

不把企业全量目录直接混入 Contacts 列表，因为既有领域约束明确要求 EE workspace 只看已加入的联系人。

### 8. Member 移除只使用一个确认流程

现有成员菜单的简单 AlertDialog 应扩展或替换为 Contacts-aware 确认 surface：

- 对 pending invitation 的取消保持原有简单确认，不展示 Contacts 去留。
- CE / SaaS active member 展示“将同时从当前 Contacts 移除”的不可选影响说明。
- EE active member 展示 `Keep as Platform contact` 控件，并在确认时将选择传给 mock repository。

确认 mutation pending 时禁止重复提交；失败时保持 dialog、选择状态和成员行不变；成功后刷新 mock member list、Contacts list 和当前 Contact detail。当前 change 不调用真实 `deleteMemberOrCancelInvitation`。

### 9. 权限状态只控制前端展示，不被描述为真实授权

mock context 提供 `can_view_contacts`、`can_manage_contacts` 和 `can_manage_members`。普通 member 无法进入完整目录；只读角色不显示创建或添加操作；移除 member 同时要求现有成员管理资格。

由于本 change 没有后端，所有权限场景只用于 UI 验收。入口应受 feature gate 控制，避免 mock-backed 管理操作被误当成已交付的生产能力。

### 10. Overlay、文案和测试遵循 web 规范

- Dialog、drawer、popover、toast 等使用 `@langgenius/dify-ui/*`。
- 用户可见文案进入 `web/i18n/en-US/` 与 `web/i18n/zh-Hans/`；其他 locale 的
  `contacts` namespace 按现有加载策略回退到英文。
- 测试优先覆盖可观察行为与回归风险，使用 Vitest、Testing Library 和确定性 repository。
- 关键场景覆盖键盘操作、焦点恢复、错误关联、状态通知和窄屏布局。

## Risks / Trade-offs

- [后续 Figma 更新造成实现漂移] → 以 `figma-acceptance.md` 记录的十二个节点验收基线为准，并在后续设计变更中显式更新矩阵。
- [Mock view model 与未来 API 漂移] → 组件依赖稳定 UI view model，由未来 adapter 负责 DTO 映射。
- [Contacts 与 Members 出现重复状态] → repository composition 层提供单一 mock scenario，并在 member mutation 后精确刷新两个 feature 的 query。
- [Mock 权限被误认为安全边界] → 使用 feature gate，并在交付说明和测试命名中明确其仅为展示状态。
- [移除 member 出现双重确认或真实误删] → 用单一 Contacts-aware dialog 替换当前确认路径，且本 change 禁止调用真实删除服务。
- [大型 EE Organization directory 导致前端数据膨胀] → mock 仍使用分页 / 增量查询 contract，不把企业全量候选一次性载入浏览器。
- [Email 冲突规则在并发下不可靠] → 当前只验证 UX；未来后端 change 必须提供权威原子校验。
- [与 IM platform change 的 Contacts shell 冲突] → 共享入口布局与 Organization context，但保持 directory repository 和 IM integration repository 独立。

## Migration Plan

1. 通过授权 Figma 访问建立十二个节点的 acceptance matrix。
2. 建立 Contacts view model、repository interface、query keys、feature context 和命名 mock scenarios。
3. 完成列表与详情，再完成 External contact、EE Organization picker 和 member removal dialog。
4. 补齐 i18n、可访问性、响应式和前端测试，并通过 feature gate 开放入口。
5. 最终 diff 审计确认没有真实后端请求或生成式 client 变更。

本 change 不包含数据迁移和后端部署。回滚时关闭 Contacts feature gate，并恢复现有 member removal confirmation。

后端能力完成后另建 change：冻结正式 contract、实现 API repository adapter、启用服务端权限与冲突校验，并替换 mock composition。

## Resolved Figma Questions

- 逐节点验收结果记录在 `figma-acceptance.md`。详情采用列表右侧 320px panel，
  创建与成员移除采用 dialog。
- 列表展示名称、Email、类型、只读 channel summary 与加入时间；详情不提供没有
  typed action 的编辑、删除、合并或 IM override 操作。
- EE 的 `Keep as Platform contact` 默认勾选；CE / SaaS 不显示该控件。
- `1649:8221` 的 workspace IM override 属于 `add-im-platform-binding-ui`，仅作为跨
  change 参考，不进入本 repository 或 UI。
