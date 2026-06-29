## Summary

- Removed the remaining `graphon.nodes.human_input` import from `api/services/workflow_service.py`.
- Kept preview, submit preview, and delivery-test flows on the existing `WorkflowService` private seams.
- Swapped local human-input debug/render/default-resolution/variable-mapping work to Dify-owned helpers and data methods.

## Production changes

- `api/services/workflow_service.py`
  - Replaced the direct graphon `HumanInputNode` dependency with a local compatibility wrapper that uses:
    - `HumanInputNodeData.model_validate(...)`
    - `render_form_content_before_submission(...)`
    - `render_form_content_with_outputs(...)`
    - `resolve_default_values(...)`
    - `HumanInputNodeData.extract_variable_selector_to_variable_mapping(...)`
  - Kept `_build_human_input_node_for_debugging(...)` and preview payload shaping intact for existing service callers/tests.
  - Kept delivery-test wiring through `build_dify_human_input_hitl_callback(...)`; only the node construction side moved off the graphon human-input module.
- `api/core/workflow/human_input/entities.py`
  - Added public `resolve_default_values(...)` helper so default-value resolution stays on the Dify human-input side.
- `api/core/workflow/human_input/callback.py`
  - Reused the new helper instead of maintaining a private duplicate implementation.
- `api/core/workflow/human_input/__init__.py`
  - Exported `resolve_default_values`.

## Verification

- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py`
  - Passed (`8 passed`)
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/services/test_workflow_service.py -k 'human_input_form_preview or submit_human_input_form_preview or test_human_input_delivery or build_human_input_variable_pool or build_human_input_node_for_debugging'`
  - Passed (`8 passed, 106 deselected`)
- `uv run --project api python -m compileall api/services/workflow_service.py api/core/workflow/human_input/entities.py api/core/workflow/human_input/callback.py api/core/workflow/human_input/__init__.py`
  - Passed

## Notes

- I left the unrelated untracked file `hitl-session-binding-plan.md` untouched.
