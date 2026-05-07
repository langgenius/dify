# Phoenix Session 合并 Implementation Plan

> **给 agent 的说明：** 执行本计划时，必须配合使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。

**目标：** 在不修改上游 tracing 代码的前提下，让由顶层 workflow 触发的 nested workflow 进入与父 workflow 相同的 Phoenix session。

**实现边界：** 所有生产代码改动都留在 Phoenix provider 包内。复用上游已有的 `conversation_id`、`workflow_run_id` 和 `parent_trace_context.parent_workflow_run_id`，并调整 Phoenix-local 的 workflow session fallback 规则。

**不在本计划范围内：** 不修改上游 trace contract；不修改 synthetic root 的展示方式；不尝试在本计划里修复 Phoenix session 页面上的 `firstInput` / `lastOutput` 缺失问题。

---

## 文件范围

### 生产代码

- 修改：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  目的：
  - 调整 workflow session fallback 顺序
  - 增加简短 comment，说明未来应上移到上游标准 session contract

### 测试代码

- 修改：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
  目的：
  - 更新 helper 层的 session fallback 预期

- 修改：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
  目的：
  - 更新 workflow 层 nested session 的预期
  - 保留现有对父 trace root 复用的断言

---

## Task 1：先用测试锁定新规则

**文件：**
- 修改：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- 修改：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] 新增或更新 helper 测试，使 workflow session 解析规则变成：
  - 优先 `conversation_id`
  - 其次 `parent_workflow_run_id`
  - 最后当前 `workflow_run_id`

- [ ] 更新 workflow 层测试，使没有 `conversation_id` 的 nested workflow 预期变为：
  - workflow span 的 `session.id = 外层 workflow_run_id`
  - child node span 的 `session.id = 外层 workflow_run_id`

- [ ] 保留现有断言，继续验证 nested workflow 仍然复用父 trace root context。

- [ ] 运行：

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

- [ ] 提交红灯或预期更新检查点。

## Task 2：修改 Phoenix-Local 的 Session 解析

**文件：**
- 修改：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`

- [ ] 更新 `_resolve_workflow_session_id()`，让 fallback 顺序变成：

```python
conversation_id
parent_workflow_run_id
workflow_run_id
```

- [ ] 复用 `_resolve_workflow_parent_context()`，不要重复手写 metadata 解析逻辑。

- [ ] 添加或调整一条简短 code comment，明确说明：
  - 这仍然是 Phoenix-local fallback
  - 未来如果上游提供标准 session 字段，应由上游替代这条推断逻辑

- [ ] 确认最终 session id 仍然一致写入：
  - workflow spans
  - workflow node spans

## Task 3：验证并提交

- [ ] 再次执行 targeted verification：

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

- [ ] 如果可以本地看 Phoenix UI，确认预期行为：
  - 仍然有 1 个顶层 workflow trace
  - nested child workflow trace 仍然是独立 trace
  - 但这些 trace 现在会归到同一个 Phoenix session 下

- [ ] 提交实现：

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
        api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
        api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "feat: unify phoenix sessions for nested workflows"
```
