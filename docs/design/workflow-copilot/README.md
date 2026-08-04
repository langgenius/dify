# Workflow Copilot 设计方案

> 状态：设计阶段（feature/workflow-copilot 分支）
> 目标：在工作流编辑页内提供一个常驻对话面板，用户可以像使用编码 Agent（如 Trae）一样，通过多轮对话增量生成 / 修改**当前这张工作流**的 schema，并支持 diff 预览、接受 / 回退、以及复用现有链路进行测试与运行。

## 1. 背景与目标

### 1.1 与现有 `/workflow-generate` 的区别

仓库中已存在一套**弹窗式、单次、整图生成**的能力：

- 前端：`web/app/components/workflow/workflow-generator/`（`WorkflowGeneratorModal`），由 `mount.tsx` 挂在**全局 layout**，跑在 Studio 的 ReactFlow Provider **之外**。
- 应用方式：`apply.ts` 的 `applyToCurrentApp` 落草稿后 `window.location.reload()` 让画布重新水合。
- 后端：`POST /console/api/workflow-generate` → `WorkflowGeneratorService` → `core/workflow/generator/WorkflowGenerator`（planner → builder → postproc → validate 四段流水线）。

本方案要做的 **Workflow Copilot** 与之不同：

| 维度 | 现有 generator | Workflow Copilot |
| --- | --- | --- |
| 交互 | 单次请求-响应 | 多轮对话，有历史 |
| 挂载位置 | 全局 Modal（Provider 外） | Studio 右侧面板（Provider 内） |
| 应用方式 | 落草稿 + reload | diff 预览 → 接受后直接写 live ReactFlow store，不刷新 |
| 作用对象 | 整图替换 | 当前画布的增量演进 |

### 1.2 核心心智模型

**把工作流当代码，把 Copilot 当编码 Agent。** AI 在当前画布上"改代码"（增量增删改节点）→ 用户看到 diff → 可接受 / 回退（类似 Ctrl+Z）→ "编译"（后端 validator 校验图合法性）→ "运行"（复用现有 debug 运行链路）。

## 2. 职责边界

```
┌─ 新增独立后端接口 /workflow-copilot ─────────────────────┐
│  职责: ①读取当前画布结构 ②AI 生成 ③"编译"校验            │
│  复用 WorkflowGenerator 的 planner/builder/validate 内核  │
│  产出: 目标图 + 面向用户的 reply + diff 元数据 + 校验错误  │
└──────────────────────────────────────────────────────────┘
        │ 生成/校验走这条新链路
        │
┌─ 复用现有链路(不动)────────────────────────────────────┐
│  测试/运行: debug-and-preview + 现有 workflow run         │
│  落草稿: syncWorkflowDraft                                 │
│  撤销: useWorkflowHistory (zundo 快照)                     │
└──────────────────────────────────────────────────────────┘
        │
┌─ 前端改造(主战场)──────────────────────────────────────┐
│  Copilot 面板 + 对话编排 + diff 预览 + 接受/回退 + 落草稿 │
└──────────────────────────────────────────────────────────┘
```

- **生成 / 编译**：走新独立后端接口 `/workflow-copilot`（内核复用 `WorkflowGenerator`）。
- **测试 / 运行**：完全复用现有链路（`debug-and-preview` + 现有 workflow run），生成与运行彻底解耦。
- **前端为主**：Copilot 面板、对话编排、diff 预览、接受 / 回退、落草稿。

## 3. 后端设计：新增独立接口 `/workflow-copilot`

不复用 `/workflow-generate` 的控制器（那是弹窗单次场景），新开一个，但**内核复用** `WorkflowGenerator`。

### 3.1 控制器

新增 `WorkflowCopilotApi`（`POST /console/api/workflow-copilot`）。建议放在 `api/controllers/console/app/` 下新建 `copilot.py`，或并入 `generator.py`。Payload：

```python
class CopilotMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class WorkflowCopilotPayload(BaseModel):
    mode: Literal["workflow", "advanced-chat"]
    messages: list[CopilotMessage]        # 多轮对话历史
    current_graph: dict                    # 当前 live 画布(必填,即"当前代码")
    model_config_data: ModelConfig = Field(alias="model_config")
    model_config = ConfigDict(extra="forbid")
```

鉴权沿用现有装饰器：`@setup_required / @login_required / @account_initialization_required / @with_current_tenant_id`。错误映射复用 `/rule-generate` 的 envelope（`ProviderTokenNotInitError` / `QuotaExceededError` / `InvokeError` 等）。

### 3.2 Service

新增 `WorkflowCopilotService`，镜像 `services/workflow_generator_service.py` 的模型解析（`ModelManager` 拿 LLM 实例）+ tool catalogue 构建逻辑，然后调 `WorkflowGenerator` 的新会话入口。

### 3.3 内核复用 + 一处扩展

`core/workflow/generator/WorkflowGenerator` 里加一个 `conversation` 模式（**不破坏**现有 `generate_workflow_graph`）：

- **planner prompt** 前注入对话历史（新增 `format_conversation_section`，加进 `prompts/planner_prompts.py`），让本轮理解"继续上文"。
- **builder / postproc / validate 完全复用**。`_validate_structure` 就是"编译器"：唯一 start、mode 对应终端节点（`end` / `answer`）、无环、无悬空边、容器拓扑合法、无幻觉工具、变量引用可解析。
- 返回结构在 `types.py` 的 `WorkflowGenerateResultDict` 基础上加两个字段：
  - `reply: str` —— LLM 单独产出"这轮做了什么、为什么"的对话回复（比现有 `message` 更像对话）。
  - `diff: {added_nodes, removed_nodes, modified_nodes, added_edges, removed_edges}` —— **后端 diff 当前图 vs 目标图**，前端拿来渲染高亮 / 幽灵节点。diff 在后端算，前端只负责展示与应用。

> ⚠️ 依赖提醒：后端所有引用在 `graphon` 命名空间下（官方 `core` 被重命名为 `graphon`，正式 PyPI 依赖 `graphon==0.5.3`，见 `api/pyproject.toml`）。改动务必遵守 `api/AGENTS.md` 的 controller → service → core 分层与 docstring 规范；提交前跑 `make lint / type-check / test`。

## 4. 前端设计（主战场）

### 4.1 面板挂载（3 处）

- `web/app/components/workflow/store/workflow/panel-slice.ts`：加 `showCopilotPanel` + `setShowCopilotPanel`（照抄 `showDebugAndPreviewPanel`）。
- `web/app/components/workflow-app/components/workflow-panel.tsx` 的 `WorkflowPanelOnRight`：按 `showCopilotPanel` 条件渲染 `<WorkflowCopilotPanel>`（与 `DebugAndPreview` 并列）。
- header 加一个 Copilot 入口按钮翻转开关。

### 4.2 对话 UI：复用 `<Chat>`

复用 `web/app/components/base/chat/chat/index.tsx`，参照 `web/app/components/workflow/panel/debug-and-preview/chat-wrapper.tsx` 的接线方式新写 `copilot-wrapper.tsx`。**不复用** debug-and-preview 的 `useChat`（那是跑工作流的），而是自己写一个轻量 `useCopilotChat`。

### 4.3 每轮编排（`useCopilotChat`）

```
onSend(text):
  1. getNodesReadOnly() → 只读则拒绝并提示            // hooks/use-workflow.ts
  2. 读 live canvas: store.getState().getNodes()/edges/transform  // reactflow useStoreApi
  3. append user 气泡; isResponding = true
  4. POST /workflow-copilot { messages, current_graph, model_config }
  5. res.errors 非空 → AI 气泡展示"编译错误"+ 重试
  6. 成功 → append res.reply 气泡 + 进入"diff 待确认"态(不立即改画布)
  7. isResponding = false
```

### 4.4 编码 Agent 式 diff → 接受 / 回退（核心 UX）

**生成后不直接改图，先展示 diff，用户确认再落地：**

1. **预览态**：根据后端 `diff`，把新增节点画成幽灵 / 高亮、删除节点标红、修改节点标黄（临时 overlay 或给节点打 `_copilotDiff` 标记）。面板给"接受 / 拒绝"按钮。**保留未改动节点的原位置**（合并时只对新增节点做布局，不整图重排 —— 对应"在原始页面上新增"的诉求）。
2. **接受**：
   - `useWorkflowUpdate().handleUpdateWorkflowCanvas(getWorkflowDraftGraphForCanvas(mergedGraph))` 把合并后的图就地写进 live store（**不刷新**，内部走 `initialNodes/initialEdges` fixup + `WORKFLOW_DATA_UPDATE` 事件）。
   - `saveStateToHistory(WorkflowHistoryEvent.X)`（`hooks/use-workflow-history.ts`）打快照 → 用户可 Ctrl+Z 整轮回退。
   - `handleSyncWorkflowDraft(true)`（`hooks/use-nodes-sync-draft.ts`）立即落草稿。
3. **拒绝**：清除 diff 标记，画布不变。

> 为什么用"整图合并 + diff 展示"而非逐条 `add_node/connect`：后端 validate 是对**完整图**做的（编译器语义），整图合并能保证"编译通过的东西才落地"；逐条 op 应用中途状态可能非法，且要重写一套健壮的 op 执行器，成本高、易碎。

### 4.5 测试 / 运行（零改动复用）

Copilot 面板加"运行"按钮，直接触发现有 `debug-and-preview` 运行链路 —— 生成与运行彻底解耦。

## 5. 分阶段落地

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| **P1 通链路** | 后端新接口（先返回整图 + reply，diff 可先前端算）+ 面板 + 对话 + 整图合并应用 + undo + 落草稿 | 能对话改图、能撤销、能落库 |
| **P2 编码 Agent 体验** | 后端返回结构化 `diff`；前端幽灵 / 高亮 diff 预览 + 接受 / 拒绝；保留未改动节点布局 | Trae 式 diff 确认流 |
| **P3 打磨** | 流式 reply、编译失败重试、"运行"按钮接 debug 链路、多轮上下文优化 | 完整体验 |

## 6. 注意事项与坑

1. **只读态**：改图前必查 `getNodesReadOnly()`（运行中 / 看历史版本时禁改）。
2. **容器节点**：iteration/loop 有 `custom-iteration-start`/`custom-loop-start` 子节点 + `parentId`，合并时别丢 —— 走 `handleUpdateWorkflowCanvas`（内部 `initialNodes` 已处理）而非手搓 `setNodes`。
3. **变量引用**：Dify 用 `{{#node.var#}}` 模板 + `[node, var]` selector（非 Coze 的结构化 ref），postproc 已对账，前端合并别破坏节点 id。
4. **hash 冲突**：落草稿走 `handleSyncWorkflowDraft`（带 hash 回写），别用会 reload 的 `applyToCurrentApp`。

## 7. 关键文件索引

### 后端
- `api/controllers/console/app/generator.py` —— 现有 `/workflow-generate` 控制器（参考）。
- `api/services/workflow_generator_service.py` —— 现有 service（镜像参考）。
- `api/core/workflow/generator/runner.py` —— `WorkflowGenerator` 内核。
- `api/core/workflow/generator/prompts/planner_prompts.py` —— planner prompt（注入对话历史处）。
- `api/core/workflow/generator/types.py` —— 返回类型（加 `reply` / `diff`）。

### 前端
- `web/app/components/workflow/store/workflow/panel-slice.ts` —— 面板显隐开关。
- `web/app/components/workflow-app/components/workflow-panel.tsx` —— 右侧面板挂载点。
- `web/app/components/base/chat/chat/index.tsx` —— 复用的对话组件。
- `web/app/components/workflow/panel/debug-and-preview/chat-wrapper.tsx` —— 接线参考。
- `web/app/components/workflow/hooks/use-workflow-update.ts` —— `handleUpdateWorkflowCanvas`（就地水合）。
- `web/app/components/workflow/hooks/use-nodes-sync-draft.ts` —— 落草稿。
- `web/app/components/workflow/hooks/use-workflow-history.ts` —— undo/redo 快照。
- `web/service/debug.ts` —— 现有 `generateWorkflow` 服务（新增 copilot 服务参考）。

参见同目录 `dev-environment.md` 了解本地热重载开发环境搭建。
</content>
