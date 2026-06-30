# Human Input Node Test Migration Report

## Scope

- Updated test-only wiring in:
  - `api/tests/unit_tests/core/workflow/nodes/human_input/test_entities.py`
  - `api/tests/unit_tests/core/workflow/nodes/human_input/test_human_input_form_filled_event.py`
  - `api/tests/unit_tests/core/workflow/graph_engine/test_parallel_human_input_join_resume.py`
- No production files were edited.

## What Changed

- Replaced direct graphon `HumanInputNode(...)` construction with removed legacy args
  (`runtime`, `form_repository`, `file_reference_factory`) by building and injecting
  `hitl_callback` via `build_dify_human_input_hitl_callback(...)`.
- Kept repository-driven pause/resume coverage by wiring callbacks to the existing
  fake/in-memory repositories used in these tests.
- Preserved file restoration coverage by passing a test file restorer callback backed
  by the existing `_TestFileReferenceFactory`.
- Updated assertions that depended on removed graphon pause payload or removed
  human-input-specific node events:
  - default resolution now asserts repository `create_form(...)` params and session id
  - submitted/timeout cases now assert the current `NodeRunSucceededEvent` outputs and
    selected handle instead of removed specialized events
- Kept the parallel resume test focused on the current callback-based resume contract.

## Verification

Command run:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/workflow/nodes/human_input/test_entities.py \
  api/tests/unit_tests/core/workflow/nodes/human_input/test_human_input_form_filled_event.py \
  api/tests/unit_tests/core/workflow/graph_engine/test_parallel_human_input_join_resume.py
```

Result:

- `33 passed`
- `1 warning` from existing pytest config (`Unknown config option: env`)

## Notes

- `test_entities.py` now matches the current callback behavior where resolved default
  values include both variable-backed and constant-backed defaults.
- `test_human_input_form_filled_event.py` was aligned to current graphon behavior:
  the node completes with standard node-run success events carrying restored outputs,
  rather than emitting the removed specialized filled/timeout events.
