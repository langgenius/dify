# Task 1 Agent Node RED Report

## Scope
Updated `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py` only.

## Change
Pinned the paused Agent node regression so that the stored `pending_form_id` must come from `session_binding.resolve_form_id_from_session_id(session_id=...)` rather than directly from `pause_reason.form_id`.

## Verification
Focused test command:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py -k paused_run_requests_workflow_pause_and_persists_snapshot
```

Result: failed as expected on the current branch because the code does not call `resolve_form_id_from_session_id`.

## Notes
No production files were modified.
