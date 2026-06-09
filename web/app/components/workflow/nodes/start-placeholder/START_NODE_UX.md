# Workflow Start Node Placeholder UX

这份文档总结当前 branch 上 workflow start node 的新 UX/UI 行为。

范围包括上一版已提交的基础能力：

`02c9b6e5ce feat(workflow): add start node placeholder panel`

以及之后继续追加的 UI、交互、tooltip、selector 状态、icon、copy 和刷新恢复逻辑。

## 目标

Workflow app 进入空白 workflow 时，不再优先弹出旧的 start node 选择 modal。

新的流程是：

1. 画布上先出现一个 `StartPlaceholder` 节点。
1. 这个 placeholder 默认被选中。
1. 右侧 panel 打开，引导用户选择真正的 start node。
1. 用户选中真实 start node 后，用真实节点原地替换 placeholder。
1. placeholder 只存在于前端本地，不会保存到 backend draft。

这个设计的核心是让 start node 的选择变成 workflow 画布的一部分，而不是一个脱离画布的 onboarding modal。

## 适用范围

这套新流程只针对：

`AppModeEnum.WORKFLOW`

其他 app 类型保持原有逻辑：

- Chat / advanced chat 不走 `StartPlaceholder`。
- Snippet 仍然沿用已有的 Start tab 禁用逻辑。
- 非 workflow app 不会自动创建 `BlockEnum.StartPlaceholder`。

## UX 状态拆分

### 1. 新 workflow，没有任何 entry node

条件：

- 当前 app mode 是 `WORKFLOW`。
- draft/template 里没有真实 entry node：
  - `BlockEnum.Start`
  - `BlockEnum.TriggerSchedule`
  - `BlockEnum.TriggerWebhook`
  - `BlockEnum.TriggerPlugin`
- 当前 graph 里也没有 `BlockEnum.StartPlaceholder`。

行为：

- 前端本地插入一个 `StartPlaceholder` 节点。
- 节点位置使用 `START_INITIAL_POSITION`。
- placeholder 默认 selected，因此右侧 panel 会自动打开。
- placeholder 在 node wrapper 层被视为 entry node，所以外层 label 显示 `START`，不是普通 trigger。
- placeholder 不显示 source/target handle。
- placeholder 不是用户可添加的 block，不会作为普通 block 出现在 selector 里。

节点卡片文案分两种：

- 右侧 panel 打开时，也就是 `data.selected === true`：
  `Pick a start node from the right panel`
- 右侧 panel 关闭时，也就是 `data.selected === false`：
  `Click to configure the start node`

这里的区别是：panel 打开时，卡片负责提示用户去右侧选择；panel 关闭后，卡片本身变成重新打开配置入口。

实现位置：

- `web/app/components/workflow-app/hooks/use-workflow-template.ts`
- `web/app/components/workflow/hooks/use-workflow-init.ts`
- `web/app/components/workflow-app/hooks/use-workflow-refresh-draft.ts`
- `web/app/components/workflow/hooks/use-nodes-sync-draft.ts`
- `web/app/components/workflow/nodes/start-placeholder/default.ts`
- `web/app/components/workflow/nodes/start-placeholder/node.tsx`

### 2. 右侧 placeholder panel 打开

条件：

- 当前选中的节点是 `BlockEnum.StartPlaceholder`。

行为：

- 右侧 panel 不展示普通节点的可编辑 title/description。
- panel header 固定为 start node 选择引导：
  - Title: `Pick a start node`
  - Description: `The start node defines what triggers your workflow to run`
- panel body 里展示 start node selector。
- 这里复用 `AllStartBlocks`，但使用 `variant="panel"`。

实现位置：

- `web/app/components/workflow/nodes/start-placeholder/panel.tsx`
- `web/app/components/workflow/nodes/_base/components/workflow-panel/index.tsx`
- `web/app/components/workflow/block-selector/all-start-blocks.tsx`

### 3. placeholder 存在时，点击左侧加号

条件：

- 画布上存在 `BlockEnum.StartPlaceholder`。
- 用户点击左侧加号打开 block selector popover。

行为：

- Start tab 禁用。
- hover Start tab 时显示 tooltip bubble。
- tooltip 告诉用户需要先配置画布上的 start node。
- tooltip 内有文档链接。
- 这个状态下不会让用户在左侧 popover 再添加一个 start node。

原因：

- placeholder 本身就是当前 workflow 的待配置 start node。
- 如果此时左侧加号还允许添加 start node，会造成两个入口选择面同时存在，用户也可能创建出重复 entry node。

实现位置：

- `web/app/components/workflow/block-selector/main.tsx`
- `web/app/components/workflow/block-selector/hooks.ts`
- `web/app/components/workflow/block-selector/tabs.tsx`

### 4. 没有 placeholder，也没有真实 entry node 时，点击左侧加号

条件：

- 画布上没有 `StartPlaceholder`。
- 画布上也没有真实 entry node。

行为：

- Start tab 可选。
- `User Input` row 可选。
- `User Input` 显示 `Most common` badge。
- 用户可以通过旧的 selector/popover 选择 start node。

这个分支是为了保留旧 selector 的能力，避免新 placeholder 流程之外的入口被完全移除。

实现位置：

- `web/app/components/workflow/block-selector/start-blocks.tsx`
- `web/app/components/workflow/block-selector/all-start-blocks.tsx`

### 5. 已经选择了 User Input start node

条件：

- 画布上已经有 `BlockEnum.Start`。

行为：

- 左侧加号里的 Start tab 仍然可点。
- Start tab 不会被禁用。
- panel 顶部展示 info banner，说明 User Input 已经添加，不能重复添加。
- `User Input` row 禁用。
- `User Input` row 展示 `Added` 状态。
- 这个状态下不展示 `Most common` badge，因为 `Added` 是更重要的状态。
- 用户仍然可以在 Start tab 里查看/选择其他 trigger 类型。

原因：

- 设计上希望 Start tab 本身仍然可进入。
- 禁用的是不可重复添加的 `User Input` row，而不是整个 Start tab。

实现位置：

- `web/app/components/workflow/block-selector/all-start-blocks.tsx`
- `web/app/components/workflow/block-selector/start-blocks.tsx`

### 6. 已经添加了其他 trigger

条件：

- 画布上已经有非 User Input 的真实 trigger，例如：
  - Schedule
  - Webhook
  - Trigger Plugin

行为：

- 左侧加号里的 Start tab 可点。
- `User Input` row 仍然展示。
- `User Input` row 禁用。
- `User Input` row hover 时显示 tooltip bubble。
- tooltip 解释 User Input 不能和其他 trigger 同时使用。
- `User Input` 的 `Most common` badge 仍然展示。
- 但 badge 也要呈现 disabled 样式。

这个状态非常重要：不能因为禁用了 User Input 就把 `Most common` badge 删掉。设计上这里仍然要让用户知道 User Input 是常用选项，只是当前 workflow 状态下不可选。

实现位置：

- `web/app/components/workflow/block-selector/start-blocks.tsx`

### 7. Start selector 的 search 行为

条件：

- 用户在 Start selector 里输入搜索词。

行为：

- 搜索结果排序保持：
  1. 内置 start node 类型
  1. 已安装 trigger
  1. marketplace 搜索结果
- marketplace 搜索结果前不再展示重复的 `Search in Marketplace` 文案。
- 没有结果时展示：
  `No triggers were found`
- 即使没有搜索结果，底部 marketplace footer 也一直存在。

实现位置：

- `web/app/components/workflow/block-selector/all-start-blocks.tsx`
- `web/app/components/workflow/block-selector/market-place-plugin/list.tsx`
- `web/app/components/workflow/block-selector/trigger-plugin/list.tsx`

## UI 细节

### Placeholder 节点 icon

placeholder 使用新的自定义 icon，而不是在组件里直接写 inline svg。

原因：

- 项目里 custom icon 的范式是放到 iconify collection 里生成。
- React 组件里直接写 svg 不符合现有项目风格。

相关文件：

- `packages/iconify-collections/assets/vender/workflow/start-placeholder.svg`
- `packages/iconify-collections/assets/vender/workflow/user-input.svg`
- `packages/iconify-collections/custom-vender/icons.json`
- `packages/iconify-collections/custom-vender/info.json`
- `web/app/components/workflow/block-icon.tsx`

### 右侧 panel footer

右侧 panel 底部 marketplace 入口使用 panel variant。

文案：

`Browse more in Marketplace`

UI：

- 使用 marketplace icon。
- 不显示外链 arrow icon。
- 上方使用较短 divider。
- footer 固定在 panel 底部。

实现位置：

- `web/app/components/workflow/block-selector/all-start-blocks.tsx`

### 左侧 popover footer

左侧加号 popover 里的 marketplace 入口使用 popover variant。

文案：

`Find more tools in Marketplace`

UI：

- 保持普通 popover footer 样式。
- 显示外链 arrow icon。
- 不使用右侧 panel 的 marketplace icon 样式。

实现位置：

- `web/app/components/workflow/block-selector/all-start-blocks.tsx`

### Info banner

当 User Input 已经存在时，Start tab 内容顶部展示 info banner。

行为：

- 不显示多余的 `All triggers` header。
- banner icon 对齐 Figma。
- banner 用来解释 User Input 已经添加，不能重复添加。

实现位置：

- `web/app/components/workflow/block-selector/all-start-blocks.tsx`

## 核心数据流

### 创建 placeholder

placeholder 会在以下路径被创建或恢复：

- 初始化 workflow template 时
- workflow draft 初始化时
- workflow refresh draft 后，如果 backend 返回的 draft 没有真实 entry node

这是为了覆盖一个关键场景：

用户删除 placeholder 后刷新页面，backend draft 里仍然没有 start node。刷新后应该重新出现 placeholder，而不是回到旧 modal 流程。

### placeholder 不持久化

`StartPlaceholder` 是前端本地节点。

保存 draft 时会被过滤掉，不会发给 backend。

原因：

- backend 不认识这个 frontend-only block。
- 最终 workflow 必须保存真实 start node，而不是 placeholder。

相关实现：

- `web/app/components/workflow/hooks/use-nodes-sync-draft.ts`

### 选择真实 start node

当用户在右侧 panel 选择真实 start node 时：

1. 复用当前 placeholder 的 node id。
1. 将 node type 从 `StartPlaceholder` 替换为真实 start node type。
1. 真实 start node 进入 workflow graph。
1. draft sync 保存真实 start node。
1. placeholder 不再存在。

这么做的原因是：

- 视觉上是原地替换，而不是删除再创建。
- workflow 入口位置稳定。
- 用户理解成本更低。

需要注意：

- 任何假设 node id 对应的 node type 永远不变的代码，都要小心这个行为。

## 这次改动涉及的文件

### 基础 placeholder 能力

这些文件主要来自上一版 commit `02c9b6e5ce`，负责把 placeholder 流程接入 workflow。

- `web/app/components/workflow/types.ts`
  - 新增 `BlockEnum.StartPlaceholder`。
- `web/app/components/workflow/constants.ts`
  - 注册 placeholder block。
- `web/app/components/workflow/nodes/start-placeholder/default.ts`
  - 定义 placeholder 默认节点数据。
- `web/app/components/workflow/nodes/start-placeholder/node.tsx`
  - placeholder 画布节点 UI。
- `web/app/components/workflow/nodes/start-placeholder/panel.tsx`
  - placeholder 右侧 panel。
- `web/app/components/workflow/nodes/index.ts`
  - 注册 placeholder node。
- `web/app/components/workflow/nodes/_base/node.helpers.tsx`
  - 将 placeholder 视为 entry node。
- `web/app/components/workflow/nodes/_base/node.tsx`
  - start node wrapper 判断包含 placeholder。
- `web/app/components/workflow/nodes/_base/components/workflow-panel/index.tsx`
  - 选择 placeholder 时渲染对应 panel。
- `web/app/components/workflow-app/hooks/use-workflow-template.ts`
  - 空 workflow template 里插入 placeholder。
- `web/app/components/workflow/hooks/use-workflow-init.ts`
  - workflow 初始化时恢复 placeholder。
- `web/app/components/workflow/hooks/use-nodes-sync-draft.ts`
  - 保存 draft 时过滤 placeholder。
- `web/i18n/en-US/workflow.json`
  - 英文文案。
- `web/i18n/zh-Hans/workflow.json`
  - 中文文案。

### 当前后续 UI 和行为改动

这些是上一版 commit 之后继续追加的 UI/UX 细节。

- `web/app/components/workflow-app/hooks/use-workflow-refresh-draft.ts`
  - refresh draft 后，如果没有真实 entry node，恢复本地 placeholder。
- `web/app/components/workflow-app/hooks/use-workflow-refresh-draft.test.ts`
  - 覆盖 refresh 后 placeholder 恢复行为。
- `web/app/components/workflow-app/hooks/use-workflow-template.test.ts`
  - 覆盖 workflow-only placeholder 创建行为。
- `web/app/components/workflow/block-selector/main.tsx`
  - 计算 selector 里的 start 状态：placeholder、User Input、其他 trigger。
- `web/app/components/workflow/block-selector/hooks.ts`
  - Start tab 只在 placeholder 或 snippet 等特定状态下禁用。
- `web/app/components/workflow/block-selector/tabs.tsx`
  - Start tab disabled tooltip。
- `web/app/components/workflow/block-selector/start-blocks.tsx`
  - User Input row 的 disabled、Added、Most common badge、tooltip 状态。
- `web/app/components/workflow/block-selector/all-start-blocks.tsx`
  - 统一右侧 panel 和左侧 popover 的 Start selector。
  - 处理 footer variant、info banner、empty state、marketplace link。
- `web/app/components/workflow/block-selector/market-place-plugin/list.tsx`
  - 去掉重复的 marketplace search 文案。
- `web/app/components/workflow/block-selector/trigger-plugin/list.tsx`
  - 调整 trigger list 排序和滚动行为。
- `web/app/components/workflow/block-selector/trigger-plugin/item.tsx`
  - trigger item 展开/禁用/hover 相关 UI。
- `web/app/components/workflow/block-selector/__tests__/all-start-blocks.spec.tsx`
  - 覆盖 selector UI 状态。
- `web/app/components/workflow/block-selector/__tests__/main.spec.tsx`
  - 覆盖 Start tab 状态。
- `web/app/components/workflow/block-selector/__tests__/start-blocks.spec.tsx`
  - 覆盖 User Input disabled/badge/tooltip。
- `web/app/components/workflow/block-icon.tsx`
  - 接入新的 custom icon。
- `web/app/components/workflow/nodes/_base/node-sections.tsx`
  - placeholder 不渲染普通 node description。
- `web/app/components/workflow/nodes/_base/__tests__/node-sections.spec.tsx`
  - 覆盖 placeholder description 不渲染。
- `web/app/components/workflow/nodes/start-placeholder/__tests__/node.spec.tsx`
  - 覆盖 placeholder selected/collapsed copy。
- `web/app/components/workflow/nodes/start-placeholder/__tests__/panel.spec.tsx`
  - 覆盖 placeholder panel 渲染。
- `packages/iconify-collections/assets/vender/workflow/start-placeholder.svg`
  - placeholder icon 源文件。
- `packages/iconify-collections/assets/vender/workflow/user-input.svg`
  - User Input icon 源文件。
- `packages/iconify-collections/custom-vender/icons.json`
  - 生成后的 custom icon metadata。
- `packages/iconify-collections/custom-vender/info.json`
  - custom icon collection metadata。

## 已验证内容

实现阶段跑过以下验证：

- `pnpm test app/components/workflow/block-selector/__tests__/all-start-blocks.spec.tsx app/components/workflow/block-selector/__tests__/main.spec.tsx`
- `pnpm test app/components/workflow/block-selector/__tests__/all-start-blocks.spec.tsx app/components/workflow/block-selector/__tests__/start-blocks.spec.tsx`
- `pnpm test app/components/workflow/nodes/start-placeholder/__tests__/node.spec.tsx app/components/workflow/nodes/_base/__tests__/node-sections.spec.tsx`
- `pnpm test app/components/workflow/nodes/_base/__tests__/node-sections.spec.tsx app/components/workflow/nodes/start-placeholder/__tests__/panel.spec.tsx`
- `pnpm type-check`

这次把文档改成中文是纯 markdown 改动，没有额外跑测试。

## 潜在负面影响和后续需要注意的地方

### 1. placeholder 是 frontend-only，可能和 backend 认知不一致

风险：

- backend draft 永远不会看到 `StartPlaceholder`。
- 如果后续有人在 backend、导入导出、workflow schema 校验里假设前端所有节点都会持久化，就可能误解这个节点。

当前处理：

- 保存 draft 前过滤 placeholder。
- 文档明确说明 placeholder 只是前端引导节点。

后续建议：

- 不要把 `StartPlaceholder` 加进 backend block schema。
- 如果要做协作或审计，需要把它当作本地 UI 状态，而不是 workflow 数据。

### 2. 真实 start node 会复用 placeholder 的 node id

风险：

- 有些代码如果假设同一个 node id 的 node type 不会变化，可能出现边界问题。

当前处理：

- 替换发生在选择 start node 的路径中。
- 这是为了让 UI 表现为原地替换。

后续建议：

- 检查依赖 node id/type 缓存的逻辑时，要记住这个节点可能从 `StartPlaceholder` 变成真实 start node。

### 3. Start selector 状态比以前复杂

风险：

- 以前 Start tab 大多只是可选/不可选。
- 现在要区分：
  - placeholder 存在
  - User Input 已存在
  - 其他 trigger 已存在
  - 没有任何 entry
  - search 中
  - panel variant
  - popover variant

当前处理：

- 状态集中从 `main.tsx` 传入 `AllStartBlocks` / `StartBlocks`。
- 对关键状态加了测试。

后续建议：

- 新增 start node 类型时，需要同时检查 `hasTriggerNode`、`hasUserInputNode`、`hasStartPlaceholderNode` 这些判断。

### 4. User Input 的显示规则有特殊 case

风险：

- User Input 不应该因为存在其他 trigger 就隐藏。
- User Input disabled 时仍然要显示 `Most common` badge，而且 badge 也要 disabled。
- User Input 已经添加时则显示 `Added`，不显示 `Most common`。

当前处理：

- `start-blocks.tsx` 显式区分 disabled、added、badge 三种状态。

后续建议：

- 如果后续调整 Start selector UI，要优先回归这几个状态。

### 5. Marketplace footer 有两个 variant

风险：

- 右侧 panel 和左侧 popover 的 footer 看起来相似，但设计不同。
- 后续如果直接统一样式，容易把其中一个场景改坏。

当前处理：

- `AllStartBlocks` 用 `variant` 区分：
  - `panel`
  - `popover`

后续建议：

- 改 footer 时先确认当前修改的是 panel 还是 popover。

### 6. refresh 后 placeholder 会重新出现

风险：

- 用户删除 placeholder 后，如果还没有选择真实 start node，刷新页面会重新出现 placeholder。
- 这不是 bug，而是产品逻辑：workflow 必须有 start node。

当前处理：

- refresh draft 后，如果没有真实 entry node，就恢复本地 placeholder。

后续建议：

- 如果之后产品希望支持“无 start node 的空 canvas”，需要重新评估这个逻辑。

### 7. 协作场景可能有本地 placeholder 状态差异

风险：

- placeholder 不持久化，因此不同用户本地看到的 placeholder 状态可能不同。
- 一个用户选择真实 start node 后，另一个用户本地如果还有 placeholder，需要依赖 draft sync 刷新掉。

当前处理：

- 选择真实 start node 后立即走真实 draft sync。

后续建议：

- 协作 QA 时要覆盖多人同时打开空 workflow 的场景。

### 8. tooltip 是 hover-only

风险：

- disabled row 的说明主要依赖 hover tooltip。
- touch 设备和 screen reader 体验可能不足。

当前处理：

- 重要的 User Input 已添加状态有 visible info banner。
- 其他 trigger 冲突状态使用 tooltip。

后续建议：

- 如果 accessibility 要求更高，可以补 `aria-describedby` 或 inline disabled reason。

### 9. icon 依赖 custom icon pipeline

风险：

- 如果只改 SVG，没有重新生成 metadata，icon 可能不生效。

当前处理：

- 新 icon 走 `packages/iconify-collections` 的 custom vendor 体系。

后续建议：

- 后续改 icon 时保持流程：
  1. 修改 `packages/iconify-collections/assets/vender/...`
  1. 重新生成 custom vendor metadata
  1. 前端用 `i-custom-vender-*`

## 总结

这次改动把 workflow start node 选择从旧的 modal-first 流程，改成了 canvas-first 的 placeholder 流程。

新的用户路径是：

1. 用户进入空 workflow。
1. 画布出现本地 `StartPlaceholder`。
1. 右侧 panel 自动打开。
1. 用户在右侧选择 User Input、Schedule、Webhook 或 trigger plugin。
1. 真实 start node 原地替换 placeholder。
1. placeholder 不保存到 backend。
1. 左侧加号 selector 根据当前 start node 状态提供对应限制和提示。

整体收益：

- 首屏更贴近 workflow canvas。
- 用户能先看到 workflow 里确实需要一个 start node。
- 右侧 panel 和节点选中状态形成统一配置入口。
- 旧加号 popover 仍保留，但会根据当前状态禁用或提示，避免重复 start node。

主要代价：

- selector 状态判断更复杂。
- placeholder 作为 frontend-only node 需要长期保持清晰边界。
- 同 id 原地替换真实 node 需要后续相关逻辑注意 node type 变化。
- panel 和 popover 两套视觉 variant 需要避免被误合并。
