# Task 1 RED Report

## Scope

仅修改测试文件：

- `api/tests/unit_tests/repositories/test_sqlalchemy_api_workflow_run_repository.py`
- `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_ask_human_hitl.py`
- `api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py`

未修改任何 production file。

## Added / Updated RED Coverage

1. `test_build_human_input_required_reason_uses_session_binding_form_id`
   - 断言 repository 在构造 `HumanInputRequired` 前，必须先将 persisted `form_id` 交给 `session_binding.issue_session_id_for_form(...)`。
   - 当前分支失败，实际仍返回原始 `form_id`。

2. `test_pause_reason_uses_session_binding_form_id`
   - 断言 `ask_human_hitl.build_ask_human_pause_reason(...)` 在构造 graphon pause reason 前，必须先经过 `session_binding.issue_session_id_for_form(...)`。
   - 当前分支失败，实际仍返回原始 `form_id`。

3. `test_task1_human_input_semantics_move_off_graphon_imports`
   - 将以下文件纳入边界断言：
     - `core/workflow/nodes/agent_v2/ask_human_hitl.py`
     - `core/workflow/nodes/agent_v2/ask_human_resume.py`
   - 断言它们必须从 `core.workflow.human_input` 导入，不再依赖 `graphon.nodes.human_input`。
   - 当前分支失败：
     - `ask_human_hitl.py` 仍含 `graphon.nodes.human_input` 导入。
     - `ask_human_resume.py` 既缺少 `core.workflow.human_input` 导入，也仍含 `graphon.nodes.human_input` 导入。

## Test Fixture Adjustment

`test_sqlalchemy_api_workflow_run_repository.py` 里的 form fixture 收缩为无 inputs / actions 的最小定义，用于避免把失败提前引到另一处 Dify-vs-graphon entity 类型不兼容上，保证本次 RED 聚焦在 session-binding 缺口。

## Verification

运行命令：

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/repositories/test_sqlalchemy_api_workflow_run_repository.py \
  api/tests/unit_tests/core/workflow/nodes/agent_v2/test_ask_human_hitl.py \
  api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py
```

结果：

- `30` tests collected
- `26` passed
- `4` failed

失败项：

- `api/tests/unit_tests/repositories/test_sqlalchemy_api_workflow_run_repository.py::test_build_human_input_required_reason_uses_session_binding_form_id`
- `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_ask_human_hitl.py::test_pause_reason_uses_session_binding_form_id`
- `api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py::test_task1_human_input_semantics_move_off_graphon_imports[core/workflow/nodes/agent_v2/ask_human_hitl.py]`
- `api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py::test_task1_human_input_semantics_move_off_graphon_imports[core/workflow/nodes/agent_v2/ask_human_resume.py]`

这些失败均与本任务要钉住的缺口一致。
