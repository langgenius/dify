## Why

当前前端缺少完整的 Contacts 管理体验，管理员无法在产品内浏览联系人目录、查看联系人详情、添加 External contact，或在移除 workspace member 时理解其对 Contacts 的影响。现有领域发现与 Figma 已给出主要业务分支和页面形态，需要将它们整理为可实施、可验收的纯前端 change。

## What Changes

- 增加 Contacts 列表页，支持联系人类型、关键身份信息、状态、搜索 / 筛选、分页或增量读取，以及加载、空数据和失败状态。
- 增加 Contact 详情视图，展示 workspace contact、Platform contact 和 External contact 的身份、归属、可用联系方式及类型相关操作。
- 增加 External contact 创建流程，覆盖必填字段、Email 格式、大小写归一后的重复校验、命中内部或 Platform contact 时的冲突提示、pending、失败和成功状态。
- 增加 EE 专属前端分支：workspace 不默认展示企业全量联系人，管理员可从 mock Organization directory 搜索并添加其他 workspace member 为 Platform contact。
- 增加移除 member 的提醒弹窗：CE / SaaS 明确联系人将从当前 workspace Contacts 移除；EE 支持选择是否保留为 Platform contact。
- 按权限控制完整 Contacts 的可见性和写操作；普通 member 不获得完整目录浏览能力，owner / admin 场景可执行 mock 管理操作。
- 本 change 只实现前端，所有列表、详情、搜索、表单校验和 mutation 先由集中、类型安全、确定性的 mock repository 驱动；真实数据结构、API 与权限校验留给后续独立 change。
- 以用户提供的十二个 Figma 节点作为布局、信息层级、交互状态和文案验收基准。

## Capabilities

### New Capabilities

- `contacts-directory-browsing`: Contacts 列表、搜索筛选、类型展示、权限状态，以及 CE / SaaS 与 EE 的目录差异。
- `contact-profile-details`: workspace contact、Platform contact 和 External contact 的详情展示、状态及类型相关操作。
- `external-contact-creation`: 管理员使用 Email 创建 External contact 的表单、冲突校验、提交状态与结果反馈。
- `member-removal-contact-retention`: 移除 workspace member 时的 Contacts 影响提示，以及 EE 是否保留为 Platform contact 的选择。

### Modified Capabilities

无。

## Impact

- 前端需要建立 Contacts-owned feature、路由或管理入口、typed mock repository、React Query 边界、dify-ui 组件及 `web/i18n/*` 文案。
- 本 change 不修改后端 API、OpenAPI schema、生成式 client、数据模型、数据库迁移、成员服务、Contact 服务或真实权限实现。
- 现有 `web/app/components/header/account-setting/members-page/` 仍管理 workspace membership；Contacts 是独立领域界面。移除 member 弹窗可以与成员操作入口衔接，但本 change 只执行 mock mutation。
- `add-im-platform-binding-ui` 继续独立负责 Organization 级 IM platform 绑定和同步详情；本 change 不重复实现该能力。
- 后续后端完成后，应通过新的 change 提供真实 repository adapter，并将 mock view model 映射到正式 contract。
- 需要为列表、详情、权限、External contact 校验、EE Platform contact 添加、member 移除分支和可访问性补充 Vitest / Testing Library 测试。
- 设计验收来源：
  - 列表页：Figma nodes `1294:64487`、`1282:62739`
  - Contact 详情：Figma nodes `1459:32284`、`1515:3382`
  - 添加 External contact：Figma nodes `1303:66983`、`1303:67192`、`1303:67388`、`1649:8221`
  - 企业版：Figma nodes `1459:31142`、`1459:32562`
  - 移除 member 提醒：Figma nodes `1515:3696`、`1649:5297`
