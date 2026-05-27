# App Deploy Refactoring UI 逐章审查记录

- 项目：`/Users/hyoban/i/dify`
- 范围：`/deployments` app deploy 页面族，包括列表、创建引导、实例详情及其可访问操作页面。
- 方法：逐章读取 `/Users/hyoban/Downloads/8724ae996f4390f885086d121a70e40a.pdf` 原文，再用内置浏览器采集真实页面截图并核查。
- 截图目录：`/Users/hyoban/i/dify/.codex-ui-review/app-deploy-refactoring-ui/screenshots`
- 状态：完成
- 截图数量：39
- 数据变更：为走完创建部署流程，创建了一个 `testchat` 部署实例，ID 为 `aeffba17-3f47-4d15-9dbc-9ca14b3f6dcb`。删除、下线、撤销 API Key、生成 API Key 等高风险最终确认步骤只打开确认/创建弹窗，未点击最终确认。

## 页面覆盖清单

- [x] `/deployments`
- [x] `/deployments/create`
- [x] `/deployments/{appInstanceId}/overview`
- [x] `/deployments/{appInstanceId}/instances`
- [x] `/deployments/{appInstanceId}/releases`
- [x] `/deployments/{appInstanceId}/access`
- [x] `/deployments/{appInstanceId}/api-tokens`
- [x] `/deployments/{appInstanceId}/settings`
- [x] 创建/部署/发布/访问/API Key/权限/设置相关弹窗、抽屉、菜单和空/错误/加载状态
- [x] 移动端关键状态：列表、概览、实例、接入方式、创建引导

## PDF 原文章节读取状态

- [x] Starting from Scratch
- [x] Hierarchy is Everything
- [x] Layout and Spacing
- [x] Designing Text
- [x] Working with Color
- [x] Creating Depth
- [x] Working with Images
- [x] Finishing Touches
- [x] Leveling Up

## 截图索引

- `01-deployments-list.png`：部署列表
- `02-detail-overview-loaded-or-stuck.png`：实例详情概览
- `03b-detail-instances-after-10s.png`：实例列表
- `04-detail-releases.png`：版本列表
- `05b-detail-access-after-10s.png`：接入方式
- `07-detail-settings-loaded.png`：设置页
- `08-create-guide-method-loaded.png`：创建部署-选择来源
- `09-create-guide-release.png`：创建部署-实例/版本信息
- `10-create-guide-target.png`：创建部署-目标环境
- `12-new-deployment-overview-loaded.png`：实际部署后的概览
- `13-create-guide-import-dsl.png`：创建部署-导入 DSL
- `14-create-release-modal-source-app.png`：创建发布版本-源应用
- `15-create-release-modal-dsl.png`：创建发布版本-DSL
- `16-release-row-actions-menu.png`：版本行操作菜单
- `17-deploy-drawer-from-release-menu.png`：从版本部署/升级抽屉
- `18-instance-row-actions-menu.png`：实例行操作菜单
- `20-deploy-drawer-new-environment.png`：部署到新环境抽屉
- `21-undeploy-confirm-dialog.png`：下线确认
- `22-access-permission-dropdown.png`：访问权限下拉菜单
- `23-api-tokens-loaded.png`：API 令牌页
- `24-api-token-create-dialog.png`：生成 API 令牌弹窗
- `26-settings-edit-enabled.png`：设置编辑态
- `27-settings-delete-confirm.png`：删除实例确认
- `28-mobile-deployments-list.png`：移动端列表
- `29-mobile-detail-overview.png`：移动端概览
- `30-mobile-detail-instances.png`：移动端实例
- `31-mobile-detail-access.png`：移动端接入方式
- `32-mobile-create-guide.png`：移动端创建引导
- `33-deployments-empty-search.png`：部署列表无搜索结果状态

## 逐章发现

### 1. Starting from Scratch

已读取原文页 7-34。按本章“先做真实功能、延后细节、避免过度设计、选择一致个性、系统化约束”的标准核查：

- SFS-1：创建部署引导把右侧“确认部署”预览做成占据半屏的高保真卡片和斜纹背景，但在选择来源/填写版本/选择环境阶段并不产生可操作决策；它重复左侧信息，并在移动端直接消失。违反“从实际功能开始，不先设计壳/装饰”的原则。截图：`08-create-guide-method-loaded.png`、`09-create-guide-release.png`、`10-create-guide-target.png`、`13-create-guide-import-dsl.png`、`32-mobile-create-guide.png`。
- SFS-2：创建部署的桌面体验在每一步都维持同一个高成本视觉框架，导致实际要完成的字段区只有左半屏，右半屏大量留白或重复摘要；这是“过早投入细节”的表现。截图：`09-create-guide-release.png`、`10-create-guide-target.png`。
- SFS-3：移动端仍保留完整顶部产品壳、图标导航、左侧窄栏和内容区，导致 app deploy 的核心任务被挤压，尤其列表和创建引导首屏可见任务内容很少。违反“先解决当前功能，不让壳主导设计”的原则。截图：`28-mobile-deployments-list.png`、`32-mobile-create-guide.png`。
- SFS-4：同一套 app deploy 页面在“部署列表卡片”“详情表格”“创建引导预览”“弹窗表单”之间的视觉性格不一致：列表偏大卡片/留白，详情偏表格/后台工具，创建引导偏宣传式预览。缺少本章要求的统一产品性格约束。截图：`01-deployments-list.png`、`04-detail-releases.png`、`08-create-guide-method-loaded.png`、`17-deploy-drawer-from-release-menu.png`。

### 2. Hierarchy is Everything

已读取原文页 35-64。按本章“不是所有元素都同等重要、通过弱化建立层级、标签和值处理、动作层级优先于语义”的标准核查：

- HIE-1：创建部署引导右侧摘要和左侧当前任务视觉权重接近，甚至摘要卡片有独立背景、卡片和图标，抢走“下一步/部署”前的注意力。当前任务应是主层级，摘要应更弱。截图：`08-create-guide-method-loaded.png`、`09-create-guide-release.png`、`10-create-guide-target.png`。
- HIE-2：设置页无编辑时，唯一高饱和可点击按钮是红色“删除实例”，危险操作在页面层级上比常规设置更突出；本章强调动作样式应服从重要性，而不是只服从语义。截图：`07-detail-settings-loaded.png`、`27-settings-delete-confirm.png`。
- HIE-3：API 令牌页空状态的主要任务是“生成一个即可调用 API”，但“生成新 API 令牌”使用右上角次级按钮样式，空状态文案在中间却没有主操作，主次关系断裂。截图：`23-api-tokens-loaded.png`。
- HIE-4：接入方式页的“接入渠道”开关是决定 WebApp/CLI 是否可用的关键状态，但它只是标题旁的小开关，没有状态文本或更强提示；页面下方“该实例的接入渠道已关闭”才说明结果。状态和值的层级没有被合并。截图：`05b-detail-access-after-10s.png`。
- HIE-5：部署列表卡片底部的最新发布版本、接入状态、部署环境全部以相近弱样式散落，卡片没有明确告诉用户下一个最重要判断是“当前是否可访问/是否部署正常”。截图：`01-deployments-list.png`、`28-mobile-deployments-list.png`。
- HIE-6：移动端详情保留图标侧栏和顶部 app 选择器，侧栏图标和主要内容同屏竞争；当前页面标题与操作没有获得足够优先级。截图：`29-mobile-detail-overview.png`、`30-mobile-detail-instances.png`。

### 3. Layout and Spacing

已读取原文页 65-100。按本章“留白应有意、宽度只给需要的空间、不要被网格绑架、不要过早收缩、避免含糊间距”的标准核查：

- LAS-1：创建部署桌面端强制左右 50% 分栏，右侧预览在多数步骤只使用中间一小块，其余为空白或装饰背景；左侧表单被限制在半屏内。违反“不要为了填满屏幕而扩展无关区域”。截图：`08-create-guide-method-loaded.png`、`09-create-guide-release.png`、`10-create-guide-target.png`。
- LAS-2：移动端创建部署出现底部横向滚动条，说明固定宽度/分栏结构没有在 390px 宽度下完全收敛。违反“组件只在必要时收缩，但不能制造横向溢出”。截图：`32-mobile-create-guide.png`。
- LAS-3：移动端接入方式仍使用表格模型，内容区域出现内部横向滚动条，首行文本挤在一起，列标题和值的归属关系变得不清晰。违反“移动端应给元素所需宽度”和“避免含糊间距”。截图：`31-mobile-detail-access.png`。
- LAS-4：详情页移动端继续保留固定图标侧栏，主内容只剩约 320px，导致概览卡片和实例卡片内的发布名、状态和操作拥挤或截断。截图：`29-mobile-detail-overview.png`、`30-mobile-detail-instances.png`。
- LAS-5：部署列表桌面端卡片高度固定且内容稀疏，第二行以下有大量空白；但移动端同一张卡片又被压缩到只有少量信息。密度不是按任务需要决定，而是被固定卡片尺寸和网格驱动。截图：`01-deployments-list.png`、`28-mobile-deployments-list.png`。
- LAS-6：版本行操作菜单在表格右侧弹出后覆盖下一行内容，且菜单宽度与行内容关系弱；这类操作菜单应该靠层级和间距清楚归属于触发按钮。截图：`16-release-row-actions-menu.png`。

### 4. Designing Text

已读取原文页 101-136。按本章“字体尺度、行长、基线、行高、链接样式、可读对齐、字距”的标准核查：

- TXT-1：部署/升级抽屉中直接展示 ISO 时间 `2026-05-27T07:47:25Z`，它是低可读性的机器格式，却与发布名、commit 同处主信息行。应使用本地化短时间或作为弱化的辅助信息。截图：`17-deploy-drawer-from-release-menu.png`。
- TXT-2：创建部署目标步骤的右侧摘要把 `langgenius/openai/...`、API Key 名称等关键凭据文字截断，摘要本来用于确认，但截断后无法完成确认任务。截图：`10-create-guide-target.png`。
- TXT-3：移动端概览中的发布名 `ui-review-release` 被截成 `ui-review-...`，而它是环境当前版本的核心值；此处应优先保留值或换行，而不是只保留标签和 hash。截图：`29-mobile-detail-overview.png`。
- TXT-4：移动端接入方式表格里“环境 / test-1 / 访问范围 / 授权对象”文本挤压并出现横向滚动，标签和值没有稳定阅读顺序。违反本章的可读对齐和行长原则。截图：`31-mobile-detail-access.png`。
- TXT-5：设置页“危险区域”的说明列过窄，中文句子被切成短碎行；这类说明不是标签扫描任务，应该给更舒适的行长。截图：`07-detail-settings-loaded.png`、`26-settings-edit-enabled.png`。
- TXT-6：列表卡片底部 release 链接在桌面和移动端都以靠右小字呈现，但缺少明显的链接 affordance；页面大量元素都是链接时可用弱处理，但这里它承载版本跳转，应至少在局部上下文中更清晰。截图：`01-deployments-list.png`、`28-mobile-deployments-list.png`。

### 5. Working with Color

已读取原文页 137-170。按本章“角色化调色板、语义色阶、可访问对比、不要只靠颜色传达状态”的标准核查：

- CLR-1：部署列表卡片里的环境 chip 只用红/绿小圆点区分状态，文本仍是环境名 `test-1` / `system`，没有“失败/就绪/部署中”等非颜色提示。违反“不要只靠颜色传达状态”。截图：`01-deployments-list.png`、`28-mobile-deployments-list.png`。
- CLR-2：版本列表“已部署到”列里 `system` 与 `test-1` badge 通过绿/红边框传达状态，但 badge 文案只是环境名；红色 `test-1` 对色弱用户无法说明是失败、回滚还是警告。截图：`04-detail-releases.png`、`16-release-row-actions-menu.png`。
- CLR-3：API 令牌页标题旁只有开关颜色表达启用状态，缺少“已启用/未启用”文本；开关虽然是控件，但状态在审查/分享截图中不够自解释。截图：`23-api-tokens-loaded.png`。
- CLR-4：接入方式页“接入渠道”也主要依赖灰色开关表达关闭，真正的状态文字在下方说明句里；状态和控件没有被组合成一个可读单元。截图：`05b-detail-access-after-10s.png`、`22-access-permission-dropdown.png`。
- CLR-5：移动端顶部导航图标在激活/未激活时主要依靠蓝色和灰色差异，无文字标签，信息密度变高后识别成本上升。截图：`29-mobile-detail-overview.png`、`31-mobile-detail-access.png`。

### 6. Creating Depth

已读取原文页 171-198。按本章“深度要表达层级、阴影应有系统、弹层/菜单/卡片的 z 轴关系要清楚”的标准核查：

- DEP-1：列表卡片、概览卡片、创建引导方式卡、右侧预览卡都使用相近的轻边框/轻阴影语言，但语义层级完全不同；卡片深度没有帮助用户区分“可点击列表项”“摘要预览”“表单容器”。截图：`01-deployments-list.png`、`08-create-guide-method-loaded.png`、`12-new-deployment-overview-loaded.png`。
- DEP-2：创建部署右侧预览卡在斜纹背景上使用独立阴影和层级，视觉上像主要内容层，却只是辅助摘要；深度使用没有服务任务层级。截图：`08-create-guide-method-loaded.png`、`10-create-guide-target.png`。
- DEP-3：版本行操作菜单虽然浮起，但菜单覆盖表格下一行并且没有明显锚定到当前行，层级关系依靠位置猜测。截图：`16-release-row-actions-menu.png`。
- DEP-4：实例行操作菜单与下线确认弹窗都使用弹层，但中间状态“菜单 -> 确认”没有视觉连续性；确认弹窗的遮罩很强，背景内容几乎不可辨，用户不容易核对正在下线哪一行。截图：`18-instance-row-actions-menu.png`、`21-undeploy-confirm-dialog.png`。
- DEP-5：移动端顶部 app 选择器胶囊有明显阴影并悬浮在内容上方，侧栏和主内容却几乎同一平面；深度强调了导航壳而不是当前页面任务。截图：`29-mobile-detail-overview.png`、`31-mobile-detail-access.png`。

### 7. Working with Images

已读取原文页 199-218。该范围主要没有照片，按本章“图标/截图有目标尺寸、不要把截图细节缩到不可读、用户上传资产要受约束”的标准核查：

- IMG-1：创建部署右侧摘要像一个缩小的产品截图/确认卡，里面包含发布名、环境、凭据、描述等真实文本，但在目标环境步骤中多处被截断或缩得难以确认。违反“不要把包含细节的截图/界面缩到不可读”。截图：`10-create-guide-target.png`。
- IMG-2：移动端侧栏只剩 app 图标与导航图标，应用名称被隐藏；如果 app 图标来自用户上传或 emoji，它被迫承担唯一身份识别，但没有相邻文本保障识别。截图：`29-mobile-detail-overview.png`、`31-mobile-detail-access.png`。
- IMG-3：创建/发布的 DSL 上传区只使用通用上传图标和文字，缺少对 YAML/DSL 文件形态的视觉反馈；对“当前是否已选文件”的图像/图标状态约束不明显。截图：`13-create-guide-import-dsl.png`、`15-create-release-modal-dsl.png`。

### 8. Finishing Touches

已读取原文页 219-248。按本章“强化默认控件、空状态优先、少用边框、背景装饰要服务内容、最后 polish”的标准核查：

- FIN-1：部署列表无搜索结果时只显示一组像骨架屏的空卡片，没有明确“无结果”文案、清除筛选建议或创建部署 CTA；空状态像加载中。截图：`33-deployments-empty-search.png`。
- FIN-2：API 令牌空状态只有一句“尚无 API 令牌，生成一个即可调用 API”，但 CTA 在页面右上角，空状态区域本身没有操作按钮或引导。截图：`23-api-tokens-loaded.png`。
- FIN-3：详情页大量使用边框分隔：侧栏分割线、表格行、卡片边框、弹窗 header/footer、输入框边框同时出现，页面整体显得偏线框化。可通过背景层次、间距和少量阴影减少边框噪声。截图：`04-detail-releases.png`、`05b-detail-access-after-10s.png`、`17-deploy-drawer-from-release-menu.png`。
- FIN-4：移动端接入方式页暴露内部横向滚动条，是明显未 polish 的默认溢出状态。截图：`31-mobile-detail-access.png`。
- FIN-5：创建部署右侧斜纹背景属于装饰背景，但它没有承载任务信息，反而加重了右侧摘要的存在感。截图：`08-create-guide-method-loaded.png`、`10-create-guide-target.png`。
- FIN-6：下线/删除确认弹窗的文案和按钮具备基本确认，但没有把将受影响的环境/实例以更可扫描的结构呈现；高风险确认仍停留在默认标题+段落+按钮。截图：`21-undeploy-confirm-dialog.png`、`27-settings-delete-confirm.png`。

### 9. Leveling Up

已读取原文页 249-252。按本章“观察成熟界面中自己不会想到的细节，并通过重建发现 polish 差异”的标准核查：

- LVL-1：app deploy 的核心关系是“发布版本 -> 环境实例 -> 接入渠道/API”，但当前页面主要复用通用卡片、表格、弹窗，没有形成更适合部署工作的结构化表达，例如环境时间线、版本到环境的状态矩阵、可访问性总览。截图：`02-detail-overview-loaded-or-stuck.png`、`03b-detail-instances-after-10s.png`、`04-detail-releases.png`。
- LVL-2：创建部署流程没有采用部署类产品常见的“逐步确认 + 最终 review”模式，而是每步都固定显示半屏 review；这看起来像未进一步比较成熟部署产品后留下的保守实现。截图：`08-create-guide-method-loaded.png`、`09-create-guide-release.png`、`10-create-guide-target.png`。
- LVL-3：移动端不是重新思考后的任务流，而是桌面导航和表格的缩窄版本；成熟后台工具通常会在移动端隐藏壳、改用卡片摘要或专门的详情抽屉。截图：`28-mobile-deployments-list.png`、`31-mobile-detail-access.png`。
