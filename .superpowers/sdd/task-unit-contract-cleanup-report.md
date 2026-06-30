# HITL Contract Unit-Test Cleanup Report

## Scope

- Updated only test files plus this report.
- Production code was not modified.

## Files Updated

- `api/tests/unit_tests/core/workflow/test_enrich_pause_reasons.py`
- `api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline.py`
- `api/tests/unit_tests/core/app/apps/test_workflow_app_runner_core.py`
- `api/tests/unit_tests/core/app/apps/test_workflow_app_runner_notifications.py`

## What Changed

- Replaced stale graph-side `HumanInputRequired` usage with `HitlRequired(session_id, node_id, node_title)`.
- Replaced stale `PauseReasonType.HUMAN_INPUT_REQUIRED` assumptions with `PauseReasonType.HITL_REQUIRED`.
- Updated tests to verify the current boundary:
  - graph/runtime reasons carry `session_id`
  - Dify outward payloads and downstream consumers resolve that to `form_id`
- Kept existing test intent intact by patching `session_binding.resolve_form_id_from_session_id(...)` where the production flow resolves outward `form_id`.
- Added focused coverage for the no-session-mapping case in `enrich_human_input_pause_reasons`, asserting unresolved HITL reasons do not leak stale `form_id`/token fields.

## Verification

Command run:

```bash
uv run --project api --group dev pytest -o addopts='' --import-mode=importlib \
  api/tests/unit_tests/core/workflow/test_enrich_pause_reasons.py \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_runner_core.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_runner_notifications.py
```

Result:

- `32 passed, 1 warning in 0.57s`

## Notes

- The remaining warning is an unrelated existing `DeprecationWarning` from `cgi` import in `api/core/rag/index_processor/index_processor_base.py`.
