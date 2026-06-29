# WorkflowService HITL red test report

## Scope
- Updated `api/tests/unit_tests/services/test_workflow_service.py` only.
- Kept the change minimal and limited to the adjacent unit test for `_build_human_input_node_for_debugging()`.

## What changed
- Reworked the test to expect `HumanInputNode` construction with `hitl_callback` instead of `runtime` and `file_reference_factory`.
- Added a mock for the HITL callback builder so the test isolates the constructor call path and fails on the current production wiring.
- Removed the old runtime/file reference assertions from this test.

## Verification
- Ran:
  - `uv run --project api pytest -o addopts='' api/tests/unit_tests/services/test_workflow_service.py -k build_human_input_node_for_debugging`
- Result:
  - The focused test fails against current production code as expected.
  - Failure point is the missing `hitl_callback` call/argument wiring in `services.workflow_service._build_human_input_node_for_debugging()`.

## Notes
- I did not modify production code.
- One unrelated untracked file exists in the worktree and was left untouched.
