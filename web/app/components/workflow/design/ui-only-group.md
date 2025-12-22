# UI-only Group（含 Group Input / Exit Port）方案

## 设计方案

### 目标

- Group 可持久化：刷新后仍保留分组/命名/布局。
- Group 不影响执行：Run Workflow 时不执行 Group/Input/ExitPort，也不改变真实执行图语义。
- 新增入边：任意外部节点连到 Group（或 Group Input）时，等价于“通过 Group Input fan-out 到每个 entry”。
- handler 粒度：以 leaf 节点的 `sourceHandle` 为粒度生成 Exit Port（If-Else / Classifier 等多 handler 需要拆分）。
- 支持改名：Group 标题、每个 Exit Port 名称可编辑并保存。
- 最小化副作用：真实节点/真实边不被“重接到 Group”，只做 UI 折叠；状态订阅尽量只取最小字段，避免雪崩式 rerender。

### 核心模型（两层图）

1) **真实图（可执行、可保存）**

- 真实 workflow nodes + 真实 edges（执行图语义只由它们决定）。
- Group 相关 UI 节点也会被保存到 graph.nodes，但后端运行时会过滤掉（不进入执行图）。

2) **展示图（仅 UI）**

- 组内成员节点与其相关真实边标记 `hidden=true`（保存，用于刷新后仍保持折叠）。
- 额外生成 **临时 UI 边**（`edge.data._isTemp = true`，不会 sync 到后端），用于：
  - 外部 → Group Input（表示外部连到该组的入边）
  - Exit Port → 外部（表示该组 handler 的出边）

## 影响范围

### 前端（`web/`）

- 新增 3 个 UI-only node type：`custom-group` / `custom-group-input` / `custom-group-exit-port`（组件、样式、panel/rename 交互）。
- `workflow/index.tsx` 与 `workflow-preview/index.tsx`：注册 nodeTypes。
- `hooks/use-nodes-interactions.ts`：
  - 重做 `handleMakeGroup`：创建 group + input + exit ports；隐藏成员节点/相关真实边；不做“重接真实边到 group”。
  - 扩展 `handleNodeConnect`：遇到 group/input/exitPort 时做连线翻译。
  - 扩展 edge delete：若删除的是临时 UI 边，反向删除对应真实边。
- 新增派生 UI 边的 hook（示例）：`hooks/use-group-ui-edges.ts`（从真实图派生临时 UI 边并写入 ReactFlow edges state）。
- 新增 `utils/get-node-source-handles.ts`：从节点数据提取可用 `sourceHandle`（If-Else/Classifer 等）。
- 复用现有 `use-make-group.ts`：继续以“共同 pre node handler（直接前序 handler）”控制 `Make group` disabled。

### 后端（`api/`）

- `api/core/workflow/graph/graph.py`：运行时过滤 `type in {'custom-note','custom-group','custom-group-input','custom-group-exit-port'}`，确保 UI 节点不进入执行图。

## 具体实施

### 1) 节点类型与数据结构（可持久化、无 `_` 前缀）

#### Group 容器节点（UI-only）

- `node.type = 'custom-group'`
- `node.data.type = ''`
- `node.data.group`：
  - `groupId: string`（可等于 node.id）
  - `title: string`
  - `memberNodeIds: string[]`
  - `entryNodeIds: string[]`
  - `inputNodeId: string`
  - `exitPorts: Array<{ portNodeId: string; leafNodeId: string; sourceHandle: string; name: string }>`
  - `collapsed: boolean`

#### Group Input 节点（UI-only）

- `node.type = 'custom-group-input'`
- `node.data.type = ''`
- `node.data.groupInput`：
  - `groupId: string`
  - `title: string`

#### Exit Port 节点（UI-only）

- `node.type = 'custom-group-exit-port'`
- `node.data.type = ''`
- `node.data.exitPort`：
  - `groupId: string`
  - `leafNodeId: string`
  - `sourceHandle: string`
  - `name: string`

### 2) entry / leaf / handler 计算

- entry（branch 头结点）：选区内“有入边且所有入边 source 在选区外”的节点。
- 禁止 side-entrance：若存在 `outside -> selectedNonEntry` 入边，则不可 group。
- 共同 pre node handler（直接前序 handler）：
  - 对每个 entry，收集其来自选区外的所有入边的 `(source, sourceHandle)` 集合
  - 要求每个 entry 的集合 `size === 1`，且所有 entry 的该值完全一致
  - 否则 `Make group` disabled
- leaf：选区内“没有指向选区内节点的出边”的节点。
- leaf sourceHandles：通过 `getNodeSourceHandles(node)` 枚举（普通 `'source'`、If-Else/Classifier 等拆分）。

### 3) Make group

- 创建 `custom-group` + `custom-group-input` + 多个 `custom-group-exit-port` 节点：
  - group/input/exitPort 坐标按选区包围盒计算，input 在左侧，exitPort 右侧按 handler 列表排列
- 隐藏成员节点：对 `memberNodeIds` 设 `node.hidden = true`（持久化）
- 隐藏相关真实边：凡是 `edge.source/edge.target` 在 `memberNodeIds` 的真实边设 `edge.hidden = true`（持久化）
- 不创建/不重接任何“指向 group/input/exitPort 的真实边”

### 4) UI edge 派生

- 从“真实边 + group 定义”派生临时 UI 边并写入 edges state：
  - inbound：真实 `outside -> entry` 映射为 `outside -> groupInput`
  - outbound：真实 `leaf(sourceHandle) -> outside` 映射为 `exitPort -> outside`
- 临时 UI 边统一标记 `edge.data._isTemp = true`，并在需要时写入用于反向映射的最小字段（`groupId / leafNodeId / sourceHandle / target / targetHandle` 等）。
- 为避免雪崩 rerender：
  - 派生逻辑只订阅最小字段（edges 的 `source/sourceHandle/target/targetHandle/hidden` + group 定义），用 `shallow` 比较 key 列表
  - UI 边增量更新：仅当派生 key 变化时才 `setEdges`

### 5) 连线翻译（拖线到 UI 节点最终只改真实边）

- `onConnect(target is custom-group or custom-group-input)`：
  - 翻译为：对该 group 的每个 `entryNodeId` 创建真实边 `source -> entryNodeId`（fan-out）
  - 复用现有合法性校验（available blocks + cycle check），要求每条 fan-out 都合法
- `onConnect(source is custom-group-exit-port)`：
  - 翻译为：创建真实边 `leafNodeId(sourceHandle) -> target`

### 6) 删除 UI 边（反向翻译）

- 若选中并删除的是临时 inbound UI 边：删除所有匹配的真实边 `source -> entryNodeId`（entryNodeIds 来自 group 定义，source/sourceHandle 来自 UI 边）
- 若选中并删除的是临时 outbound UI 边：删除对应真实边 `leafNodeId(sourceHandle) -> target`

### 7) 可编辑

- Group 标题：更新 `custom-group.data.group.title`
- Exit Port 名称：更新 `custom-group-exit-port.data.exitPort.name`
- 通过 `useNodeDataUpdateWithSyncDraft` 写回并 sync draft
