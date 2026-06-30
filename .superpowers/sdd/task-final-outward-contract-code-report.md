# Final Outward Contract Code Report

## Scope

- Fixed Dify outward HITL payloads to expose resolved Dify `form_id` instead of graphon `session_id`.
- Kept `session_binding` as the only `session_id -> form_id` translation boundary.
- Limited changes to production files only.

## Production Changes

### `api/core/app/apps/common/workflow_response_converter.py`

- `HumanInputRequiredResponse.Data.form_id` now uses the resolved Dify `form_id`.
- `workflow_paused.data.reasons[*]` enrichment now works on Dify-facing `form_id` keys and receives the pre-resolved `form_ids_by_session_id` map from the caller.

### `api/services/workflow_event_snapshot_service.py`

- Snapshot/reconnect `human_input_required` payloads now expose resolved `form_id`.
- Snapshot/reconnect `workflow_paused.data.reasons[*]` now project graphon HITL reasons into outward `form_id` payloads before adding tokens/channels/expiration.

### `api/core/workflow/human_input_policy.py`

- `enrich_human_input_pause_reasons(...)` now converts outward HITL reasons from internal `session_id` to public `form_id` when given `form_ids_by_session_id`.
- Added a tiny compatibility alias for `PauseReasonType.HUMAN_INPUT_REQUIRED` so the existing enrichment test file still collects against the current graphon enum layout.

### `api/core/app/entities/task_entities.py`

- Blocking pause payload DTO `HumanInputRequiredPauseReasonPayload` now exposes `form_id` instead of `session_id`.

### `api/controllers/console/app/workflow_run.py`

- Console pause-details response now returns the resolved Dify `form_id`.

## Verification

Executed:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/app/apps/test_workflow_pause_events.py \
  api/tests/unit_tests/services/workflow/test_workflow_event_snapshot_service.py \
  api/tests/unit_tests/controllers/console/app/test_workflow_pause_details_api.py \
  api/tests/unit_tests/controllers/service_api/app/test_hitl_service_api.py
```

Result: `48 passed`

Executed:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/workflow/test_enrich_pause_reasons.py
```

Result: `5 passed`

## Notes

- No test files were edited.
- The compatibility alias in `human_input_policy.py` is intentionally narrow and only preserves the old enum attribute name for current in-repo callers/tests; outward payload behavior is still driven by the new `form_id` contract.
