# Task 3 RED Report

Scope: test-only changes for the remaining Task 3 gaps.

## Added coverage

- `api/tests/unit_tests/controllers/console/app/test_workflow_pause_details_api.py`
  - Verifies pause-details resolves graphon `session_id` back to Dify `form_id` before calling `_load_form_tokens_by_form_id(...)`.
  - Verifies the response still exposes the graphon-facing pause id in `pause_type.form_id`.

- `api/tests/unit_tests/models/test_workflow.py`
  - Verifies `WorkflowPauseReason.from_entity()` stores the graphon-facing `session_id` instead of the Dify `form_id`.
  - Verifies `WorkflowPauseReason.to_entity()` resolves the stored session id back to the Dify `form_id`.

## Verification

Focused pytest runs were executed with:

- `uv run --project api pytest -o addopts='' api/tests/unit_tests/controllers/console/app/test_workflow_pause_details_api.py -q`
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/models/test_workflow.py -q`

Both selections failed on the current branch, which is expected for RED state:

- Controller test failed because `_load_form_tokens_by_form_id(...)` received `session-1` instead of the resolved Dify `form-1`.
- Model test failed because `WorkflowPauseReason.from_entity()` still stored `form-123` instead of the graphon-facing `session::form-123`.
