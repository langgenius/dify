# Adjacent Legacy HITL Tests Report

## Status

Completed.

## Updated files

- `api/tests/unit_tests/core/app/apps/test_workflow_pause_events.py`
- `api/tests/unit_tests/services/workflow/test_workflow_event_snapshot_service.py`

## What changed

- Replaced legacy rich `HumanInputRequired(...)` pause-reason construction with minimal `HitlRequired(session_id, node_id, node_title)`.
- Updated tests to assert that rich outward `human_input_required` payload fields are rehydrated from persisted `form_definition` data.
- Updated pause-reason assertions to the current minimal contract:
  - outward reason keeps `session_id`
  - enriched fields on pause reasons are limited to lookup-derived data such as `form_token`, `approval_channels`, and `expiration_time`
  - rich fields like `inputs` are no longer expected on `workflow_paused.data.reasons`
- Preserved the distinction between outward `session_id` and internal Dify `form_id` lookup via mocked `session_binding.resolve_form_id_from_session_id(...)`.
- Made snapshot tests locate `human_input_required` / `workflow_paused` events by event type instead of position so they remain stable with adjacent node events present.
- Added test-local default monkeypatching for `services.workflow_event_snapshot_service` to provide:
  - `json` module access for existing parsing helpers
  - default session-id to form-id resolution for tests not explicitly overriding binding behavior

## Verification

Executed:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/app/apps/test_workflow_pause_events.py \
  api/tests/unit_tests/services/workflow/test_workflow_event_snapshot_service.py
```

Result:

- `35 passed`
- `1 warning` from existing pytest config (`Unknown config option: env`)

## Notes

- No production files were edited.
