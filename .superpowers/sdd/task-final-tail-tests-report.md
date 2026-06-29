## Test Report

- Updated `api/tests/unit_tests/core/workflow/human_input/test_callback.py` with a focused regression test that asserts a HITL callback writes a constant paragraph default into `resolved_default_values`.
- Updated `api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py` to use Dify-owned `HumanInputFormKind` / `HumanInputFormStatus` and added a lightweight graphon enum alias so the task module can still import during test collection.

## Verification

- `uv run --project api pytest -o addopts='' api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py`
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/human_input/test_callback.py`

## Result

- Task timeout tests passed.
- The new callback regression test failed because the current callback path still drops constant paragraph defaults and produces `{}` for `resolved_default_values`.

## Concern

- The callback failure is a real production gap, not a test harness issue. I left it as-is because this task was limited to test files only.
