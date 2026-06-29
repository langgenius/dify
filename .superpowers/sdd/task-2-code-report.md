# Task 2 Code Report

## 结果

已按最小 Task 2 scope 完成生产代码改动：

- 新增 Dify-owned HITL callback 模块 `api/core/workflow/human_input/callback.py`
- `api/core/workflow/node_factory.py` 对 `HUMAN_INPUT` 改为仅注入 `hitl_callback`
- `api/core/workflow/nodes/agent_v2/*` 的 ask_human / resume / pause 关联路径切到 graphon 新的 HITL pause contract
- `api/pyproject.toml` 和 `api/uv.lock` 已切到 graphon commit `21af61373defc45e7024acb3de19dd836f5f2a00`
- 为了让最小链路在新 graphon commit 下可导入，顺手修复了相邻的 `models/human_input.py`、`models/workflow.py` 和 `core/workflow/human_input/__init__.py` 的直接 blocker

## 关键实现

### 1. Dify-owned HITL callback

`api/core/workflow/human_input/callback.py` 现在负责：

- 首次 pause：
  - 读取 `HITLContext`
  - 渲染 Dify form content
  - 解析默认值
  - 创建 Dify form
  - 返回 graphon `PauseRequested(session_id=...)`
- WAITING form：
  - 直接 re-pause
  - 不重复建表单
- SUBMITTED form：
  - 恢复 Dify 提交数据
  - 生成 graphon `Completed(...)`
  - 恢复 `inputs` / `outputs`
  - 保留 selected handle
  - 重建 `__action_id` / `__rendered_content`
- TIMEOUT / EXPIRED form：
  - 返回 graphon `Expired(...)`

### 2. Human Input node wiring

`api/core/workflow/node_factory.py` 现在：

- 为 `HUMAN_INPUT` 构建 callback
- 不再向 Human Input node 传入：
  - `runtime`
  - `form_repository`
  - `file_reference_factory`
- 保留 Dify 侧 delivery / debugger recipient / display-in-ui / session binding 语义

### 3. ask_human / agent_v2 邻接迁移

最小相邻链路已切到 graphon 新 contract：

- `ask_human_hitl.py` 返回 `HitlRequired(session_id=...)`
- `agent_node.py` 以 `session_id` 做 Phase 1 `session_binding`
- `ask_human_resume.py` 在 defensive repause 时也返回 `HitlRequired`

## 验证

已通过：

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/workflow/human_input/test_callback.py \
  api/tests/unit_tests/core/workflow/test_node_factory.py
```

结果：

- `59 passed`

额外 smoke check：

```bash
uv run --project api python - <<'PY'
import importlib, sys
sys.path.insert(0, '/Users/qg/.codex/worktrees/9d3c/dify-ai-playground/api')
for name in [
    'core.workflow.nodes.agent_v2.ask_human_hitl',
    'core.workflow.nodes.agent_v2.ask_human_resume',
    'core.workflow.nodes.agent_v2.agent_node',
]:
    importlib.import_module(name)
    print('imported', name)
PY
```

结果：

- `ask_human_hitl`
- `ask_human_resume`
- `agent_node`

均可成功导入。

## 已知范围外事项

按本次“最小 Task 2 scope”要求，未继续迁移仓库内其余仍直接依赖旧 `HumanInputRequired` /
`PauseReasonType.HUMAN_INPUT_REQUIRED` 的生产路径。它们不影响本次指定 RED tests，但后续完整 graphon
迁移仍需统一收口。
