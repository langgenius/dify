# Handoff：Workflow 模式「定时/Webhook」触发起始节点生成

> 创建时间：2026-08-07
> 分支：`feature/workflow-copilot`（fork `origin` = sjking7318/dify；upstream = langgenius/dify）
> 当前 HEAD：`285b887939 refactor(workflow-copilot): remove token usage tracking`（已推送到 `origin/feature/workflow-copilot`，工作树干净）
> 状态：**本功能尚未开始**。这份文档是给新任务的完整交接。

---

## 0. 一句话目标

让 Workflow Copilot 在 **workflow 模式**下，能根据用户意图生成三种起始节点之一：
`start`（用户输入表单）、`trigger-schedule`（定时）、`trigger-webhook`（Webhook）。
且**触发器的具体参数（cron 表达式 / Webhook method+URL 等）由 AI 一并生成**（用户已拍板，见 §6 决策）。
本次**不做** `trigger-plugin`（插件触发，依赖已安装插件、场景少）。

---

## 1. 背景：为什么现在生成不出来（根因，已查穿）

Workflow 模式其实有 4 种起始节点（`BlockEnum`，见 `web/app/components/workflow/types.ts:57-59`）：

| 类型 | BlockEnum 值 | 说明 |
| --- | --- | --- |
| 用户输入 | `start` | 表单输入 |
| 定时触发 | `trigger-schedule` | cron / 可视化定时 |
| Webhook | `trigger-webhook` | 外部 HTTP 回调 |
| 插件触发 | `trigger-plugin` | 插件事件（本次不做） |

**但后端 generator 完全不认识 trigger 类型**——`api/core/workflow/generator/` 里 grep `trigger`/`schedule`/`webhook` 零结果。三个硬编码点写死了「起始节点 = `start`」：

1. **Planner 词汇表只有 `start`**
   - `api/core/workflow/generator/prompts/planner_prompts.py:21`：节点表只列 `"start"`
   - 同文件 `:48` 规则 1：`Always start with exactly one "start" node.`
   - `:135` 输出示例：`{"id": "node1", ..., "node_type": "start"}`
   → 用户说「定时触发」，planner 也只会吐 `start`。

2. **Builder 只为 `start` 生成输入表单**
   - `runner.py:928`：`format_start_inputs_section(...) if node_type == BuiltinNodeTypes.START else ""`
   → 永远只生成用户输入型。

3. **Validator 只认 `start` 起点**
   - `runner.py:2151-2159`：`starts = [t for t in types if t == BuiltinNodeTypes.START]`；`if len(starts) != 1` → 报 `MISSING_START`。
   → 就算 planner 侥幸生成了 trigger 节点，validator 也会因「没有 start」判定失败。

关键约束：`trigger-*` 是 **Dify 前端 workflow 层的概念**，连底层第三方包 `graphon.enums.BuiltinNodeTypes` 都没有它们（`api/.venv/.../graphon/enums.py:16-48`，**不可改**）。所以这是需要在 generator 里**新增能力**的跨前后端改动，不是小 bug。

对照：**chatflow（advanced-chat）** 起始只有一种（固定 `start` + `sys.query`），本来就正常，改动**必须不破坏它**。

---

## 2. 前置知识：前端三种起始节点的结构（生成目标形状）

新增的 trigger 节点最终要能在 Studio 里正常加载、通过 checklist 校验。生成的 `data` 必须对齐前端 `defaultValue`（这是 `builder_prompts.py` 里每个 snippet 的既定原则，见文件头注释）。

### 2.1 `start`（现状，参考）
- `web/app/components/workflow/nodes/start/default.ts`，`isStart: true`
- data: `{ variables: [...] }`，后端 snippet 见 `builder_prompts.py:14-46`

### 2.2 `trigger-schedule`（定时）
- `web/app/components/workflow/nodes/trigger-schedule/{default,types,constants}.ts`，`metaData.isStart: true`
- 类型（`types.ts`）：
  ```ts
  {
    mode: 'visual' | 'cron'
    frequency?: 'hourly' | 'daily' | 'weekly' | 'monthly'
    cron_expression?: string
    visual_config?: { time?, weekdays?, on_minute?, monthly_days? }
    timezone?: string
  }
  ```
- 默认值（`constants.ts` `getDefaultScheduleConfig`）：
  ```ts
  { mode: 'visual', frequency: 'daily',
    visual_config: { time: '12:00 AM', weekdays: ['sun'], on_minute: 0, monthly_days: [1] } }
  ```
- `checkValid`（`default.ts:140+`）很严：cron 模式要求合法 cron 表达式（`isValidCronExpression`）；visual 模式按 frequency 校验 time 格式 `'H:MM AM/PM'`、weekdays、monthly_days，且必须能算出下次执行时间。**AI 生成 cron 若非法会被 checklist 拦**，所以建议默认生成 `mode: 'cron'` + 合法 cron，或直接复用 visual 默认值。

### 2.3 `trigger-webhook`（Webhook）
- `web/app/components/workflow/nodes/trigger-webhook/{default,types}.ts` + `utils/raw-variable.ts`，`metaData.isStart: true`
- 类型（`types.ts`）：
  ```ts
  {
    webhook_url?: string        // 由后端运行时生成，AI 不用填
    method: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'|'HEAD'
    content_type: string
    headers: {name, required}[]
    params: {name, type, required}[]
    body: {name, type, required}[]
    async_mode: boolean
    status_code: number
    response_body: string
    variables: Variable[]        // 至少含 createWebhookRawVariable()（_webhook_raw）
  }
  ```
- 默认值（`default.ts:18-29`）：`method:'POST'`, `content_type:'application/json'`, `async_mode:true`, `status_code:200`, `variables:[createWebhookRawVariable()]`
- `checkValid`（`default.ts:30+`）：要求 `webhook_url` 非空 + params/body 参数类型合法。
  ⚠️ **注意**：`webhook_url` 通常由后端/运行时分配，新建时为空。checklist 会因空 url 报错——这点要和 §5 验证时确认清楚（可能需要生成时给占位，或接受「需用户保存后生成 url」的既有行为）。

### 2.4 下游变量引用
- `start`：`{{#<start-id>.<var>#}}`
- `trigger-schedule`：基本无业务输出变量（定时只触发，无 payload）
- `trigger-webhook`：输出在 `variables` 里（`_webhook_raw` 是 raw payload，`value_type: object`）；下游引用 `{{#<webhook-id>._webhook_raw#}}` 或用户声明的 params/body 字段

---

## 3. 前端已具备的支撑（好消息，前端基本不用大改）

前端 checklist 已经**认识**这些 trigger 是合法起始节点：
- `web/app/components/workflow/hooks/use-checklist.ts:109-113`：
  ```ts
  const START_NODE_TYPES: BlockEnum[] = [
    BlockEnum.Start,
    BlockEnum.TriggerSchedule,
    BlockEnum.TriggerWebhook,
    BlockEnum.TriggerPlugin,
  ]
  ```
- `:506` / `:836` 用它判定「图里是否有合法起始节点」。

所以**只要后端能生成结构正确的 trigger 节点，前端 checklist 就会认**。前端唯一可能要动的是 §4.4 的 apply 兼容点。

`isTriggerNode()`（`types.ts:534`）、`TRIGGER_NODE_TYPES`（`:525`）可复用。

---

## 4. 实施计划（后端为主，改动尽量小）

> 原则（用户长期偏好）：在源头（generator）修；改动尽量小；不破坏 chatflow 与现有 `start` 生成；对齐前端 defaultValue。

### 4.1 Planner 提示词：教它认识 trigger 起始节点
文件：`api/core/workflow/generator/prompts/planner_prompts.py`
- 在「Available node types」（`:19-44`）补充 `trigger-schedule` / `trigger-webhook` 两种起始节点说明。
- 改写规则 1（`:48` `Always start with exactly one "start" node.`）：
  起始节点必须**恰好一个**，类型从 `{start, trigger-schedule, trigger-webhook}` 里**按用户意图**选：
  - 默认/用户要「表单输入/手动运行」→ `start`
  - 「定时/每天/每小时/cron/schedule」→ `trigger-schedule`
  - 「webhook/回调/外部触发/HTTP 推送」→ `trigger-webhook`
- 仅 **workflow 模式** 允许 trigger；**advanced-chat 模式仍固定 `start`**（在 mode 段或规则里明确约束，避免污染 chatflow）。
- 更新输出 schema 示例（`:134-142`）加一个 trigger 的例子。

### 4.2 Builder：为 trigger 节点生成 data 配置
文件：`api/core/workflow/generator/prompts/builder_prompts.py`（`_NODE_SNIPPETS` 字典）
- 新增 `"trigger-schedule"` / `"trigger-webhook"` 两个 snippet，**镜像 §2.2 / §2.3 的 defaultValue**（这是该字典的既定约定，见文件头注释）。
- `trigger-schedule` snippet 要引导 AI 产出**合法**配置（建议 `mode:'cron'` + 合法 cron，或安全复用 visual 默认），否则 checklist `checkValid` 会拦。
- `trigger-webhook` snippet 要包含必填默认（method/content_type/async_mode/status_code/variables 含 `_webhook_raw`）。

文件：`api/core/workflow/generator/runner.py`
- `format_start_inputs_section` 分发（`:928`）：目前 `node_type == START` 才注入。若希望 trigger 节点也能声明「用户可配参数」，酌情扩展；**最小改动可先不动**（trigger 一般不走 start_inputs）。

### 4.3 Validator：放宽「必须有 start」为「必须有一个起始节点」
文件：`api/core/workflow/generator/runner.py:2151-2159`
- 现状：`starts = [t for t in types if t == BuiltinNodeTypes.START]`，`len != 1` → `MISSING_START`。
- 改为：起始节点集合 = `{start, trigger-schedule, trigger-webhook}`，统计三者总数 == 1 才合法。
- ⚠️ 因为 `graphon.enums.BuiltinNodeTypes` 没有 trigger 常量，需要在 runner 里定义本地常量（如模块级 `_TRIGGER_START_TYPES = ("trigger-schedule", "trigger-webhook")` 字符串字面量），或加一个 `_START_NODE_TYPES` 集合。**用字符串字面量即可，别去改 graphon。**
- 同步检查 `runner.py` 其它假设「起点是 start」的地方：`:1244`、`:1392`、`:2002`、`:1521`（`_declares_variable` 里 start 暴露 variables 的逻辑——trigger 的输出变量形状不同，若下游引用 trigger 输出需在这里加分支，见 §2.4）。这些是**潜在坑点**，实施时逐一评估。

### 4.4 前端 apply 兼容（可能不用改，需验证）
- `copilot-chat.tsx` 生成请求 mode：`isChatMode ? 'advanced-chat' : 'workflow'`（约 `:483`）——已正确。
- start-placeholder 剥离逻辑（`copilot-chat.tsx:438-450`，上一轮已修）：新建 workflow 应用画布是 `start-placeholder` 占位符，构建 `currentGraph` 时会被剥掉 → 空画布走 CREATE 模式。生成的 trigger 节点会整体替换占位符。**这条链路对 trigger 同样适用**，大概率不用改，但要在 §5 实测确认。
- `initialNodes/initialEdges`（`web/app/components/workflow/utils/workflow-init.ts`）对未知节点类型的处理需确认（trigger 是已知类型，应无碍）。

### 4.5 单元测试
文件：`api/tests/unit_tests/core/workflow/generator/test_runner.py`
- 加 case：给含「定时」意图的 instruction，mock planner 返回 `trigger-schedule` 起点，断言 validator 通过、图含 trigger 节点。
- 加 case：webhook 同理。
- 确保原有 `start` / chatflow case 仍绿（当前基线 **130 passed**）。

---

## 5. 验证方法（用户偏好浏览器实测，"方案 B"）

后端/前端服务启动约定（记忆 + 本仓约定）：
- 后端：`cd api && uv run flask --app app run --host :: --port 5001`
  （`--host ::` 双栈，否则 Next.js SSR 的 localhost→IPv6 会 `fetch failed`）
- 前端：`cd web && pnpm --config.verifyDepsBeforeRun=false dev`
  （master 引入的 `verifyDepsBeforeRun` + bnpm 镜像缺元数据会 `ERR_PNPM_TRUST_DOWNGRADE`）
- `api/.env:37` 已设 `ENABLE_COLLABORATION_MODE=false`（否则「同步数据中」遮罩卡死）
- DB 迁移若报错：`cd api && uv run flask --app app db upgrade heads`（复数，两个 head 分叉）

实测步骤：
1. 新建一个 **workflow 模式** app（画布应是 start-placeholder 占位符）。
2. Copilot 输入「我要一个每天定时触发的任务，分析日志并生成报告」→ 生成预览应含 `trigger-schedule` 起点。
3. Apply → 画布应正确渲染定时触发节点（非用户输入 start），无孤立节点、无 008 连线错误、checklist 无「请先选择开始节点」。
4. 打开该 trigger 节点配置，确认 cron/visual 参数已由 AI 填好且合法。
5. Webhook 同样测一遍（「webhook 触发」）。
6. 回归：chatflow app 生成仍正常（起点是 start + sys.query）；普通 workflow「表单输入」意图仍生成 `start`。

浏览器登录态：`http://localhost:3000`（已登录）。

---

## 6. 已确认的产品决策（来自用户，勿再问）

- **支持范围**：定时（trigger-schedule）+ Webhook（trigger-webhook）。**不做** trigger-plugin。
- **触发器参数**：AI **一并生成**（cron 表达式、Webhook method/URL 等），不是只搭骨架留默认。
  - 注意落地时的现实约束：cron 必须合法（否则 checklist 拦）；webhook_url 通常运行时分配，AI 无法真正生成有效 url——§2.3/§5 需确认既有产品行为，必要时回来跟用户对齐这一点。

---

## 7. 关键文件清单（带锚点）

后端：
- `api/core/workflow/generator/prompts/planner_prompts.py`（词汇表 `:19-44`、规则1 `:48`、schema `:134-142`）
- `api/core/workflow/generator/prompts/builder_prompts.py`（`_NODE_SNIPPETS` 字典 `:13+`，start snippet `:14-46`）
- `api/core/workflow/generator/runner.py`（builder 分发 `:928`；validator `MISSING_START` `:2151-2159`；start 假设点 `:1244/1392/2002/1521`）
- `api/core/workflow/generator/prompts/node_builder_prompts.py`（`get_node_builder_system_prompt` `:68`、`format_start_inputs_section` `:113`）
- `api/tests/unit_tests/core/workflow/generator/test_runner.py`（单测，基线 130 passed）

前端（多为参考/兼容确认，非必改）：
- `web/app/components/workflow/nodes/trigger-schedule/{default,types,constants}.ts`
- `web/app/components/workflow/nodes/trigger-webhook/{default,types}.ts` + `utils/raw-variable.ts`
- `web/app/components/workflow/hooks/use-checklist.ts:109-113`（`START_NODE_TYPES` 已含 trigger）
- `web/app/components/workflow/types.ts:57-59`（BlockEnum）、`:525-536`（`TRIGGER_NODE_TYPES`/`isTriggerNode`）
- `web/app/components/workflow/panel/workflow-copilot/copilot-chat.tsx:438-484`（mode + start-placeholder 剥离 + current_graph）
- `web/app/components/workflow-app/hooks/use-workflow-template.ts:87-103`（workflow 模式初始 = start-placeholder）

**不可改**：`api/.venv/.../graphon/enums.py`（第三方包，无 trigger 常量，用字符串字面量绕开）。

---

## 8. 已知坑 / 注意事项

1. **别改 generator 无关的干净文件**：`types.py`/`builder_prompts.py` 是 feature 的增量改动，只在必要处加 trigger 支持。runner.py 已对齐「删 token」后的版本（上一轮刚提交）。
2. **chatflow 不能被污染**：所有 trigger 逻辑都要 gate 在 workflow 模式；advanced-chat 起点恒为 start。
3. **cron 合法性**：AI 生成的 cron 若非法，前端 checklist `checkValid` 会拦，导致「生成了但校验红」。builder snippet 要给强约束或安全默认。
4. **webhook_url 空值**：新建 webhook 节点 url 为空会被 checkValid 拦，需确认既有产品如何处理（保存后由后端分配？）。
5. **pre-commit hook**：`web/*` 改动会跑 `vp staged`（oxlint/tsc）。注意：
   - i18n 必须用 selector 模式 `t($ => $['key'], {ns})`，新增文案 key 要加到 `web/i18n/en-US/<ns>.json`（flat dot-notation，字母序）。
   - `service.ts` 有个既有 `no-restricted-imports` error 无法用内联注释抑制（全仓通病），必要时 `--no-verify`（上一轮已如此提交，用户已知情）。
   - 后端 `api/*.py` 改动会跑 Ruff。
6. **提交规范**：feature 分支跟踪 `origin/feature/workflow-copilot`（sjking7318 fork）。只推 origin，不碰 upstream。

---

## 9. 上一轮刚完成的上下文（避免重复/冲突）

- 刚提交 `285b887939`：**彻底删除了 token 统计**（前后端 usage 全删），并把 copilot-chat.tsx 的 27 处 i18n 迁移到 selector 模式（补了 14 个 `workflowGenerator.*` key 到 en-US 词典）。已推送。
- start-placeholder 生成问题（workflow 模式新建应用生成后起点错乱）**已修**：见 `copilot-chat.tsx:438-450` 剥离逻辑。本功能是它的自然延伸（那次只保证了「生成正确的 start」，这次要「按意图生成 start / 定时 / webhook」）。
- 之前几个设计文档（complete-guide 等）已丢失，仅存 `docs/design/workflow-copilot/README.md`（早期整体设计）。
