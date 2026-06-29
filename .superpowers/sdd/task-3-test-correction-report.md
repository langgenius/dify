# Task 3 Test Correction Report

## Scope

Corrected `api/tests/unit_tests/models/test_workflow.py` so the `WorkflowPauseReason`
round-trip test matches the Task 3 requirement:

- graphon-facing `HumanInputRequired` uses `session_id`
- Dify persistence stores `form_id`
- `to_entity()` should emit the graphon-facing `session_id` through `session_binding`

## What Changed

- Updated the test to assert that `WorkflowPauseReason.from_entity(...)` persists the underlying `form_id`.
- Updated the test to assert that `WorkflowPauseReason.to_entity()` returns a `HumanInputRequired`
  with the graphon-facing `session_id`.

## Verification

Ran the focused test only:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/models/test_workflow.py -k workflow_pause_reason_uses_session_binding_for_human_input_round_trip
```

Result: the test still fails against current production code, as intended, because
`WorkflowPauseReason.to_entity()` still returns the raw stored `form_id` instead of resolving it
through `session_binding`.

## Notes

- No production files were edited.
- Change is intentionally minimal and limited to the test file.
