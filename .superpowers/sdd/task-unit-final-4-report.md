## Summary

Updated only the requested stale unit tests to match the current migrated HITL outward contract.

## Changes

- `api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_response_converter.py`
  - Replaced the stale pause reason fixture with the current Dify-facing payload shape using `TYPE: "hitl_required"`.
- `api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline_core.py`
  - Updated the paused blocking response assertion to expect the current HITL pause reason contract.
- `api/tests/unit_tests/core/workflow/test_form_input_serialization_compat.py`
  - Switched the compatibility payload from legacy `session_id` to current `form_id` for `HumanInputRequiredPauseReasonPayload`.
  - Added an explicit assertion that `form_id` survives deserialization.
- `api/tests/unit_tests/core/workflow/test_node_factory.py`
  - Removed the stale expectation that `DifyHumanInputNodeRuntime` is initialized from `DifyNodeFactory.__init__`.

## Verification

Ran:

```bash
uv run --project api pytest --import-mode=importlib \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_response_converter.py \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline_core.py \
  api/tests/unit_tests/core/workflow/test_form_input_serialization_compat.py \
  api/tests/unit_tests/core/workflow/test_node_factory.py
```

Result:

```text
97 passed, 2 warnings in 22.78s
```

## Notes

- The worktree already contained many unrelated tracked modifications before this cleanup. I staged and committed only the four requested test files plus this report file.
