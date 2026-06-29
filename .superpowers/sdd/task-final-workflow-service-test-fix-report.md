# Workflow Service Test Fix Report

Updated `api/tests/unit_tests/services/test_workflow_service.py` to match the current `_build_human_input_node_for_debugging` contract.

What changed:
- `HumanInputNode` is now asserted to receive `hitl_callback` only.
- The test no longer expects `runtime` or `file_reference_factory`.
- The callback builder assertion now matches the production call shape and only constrains the meaningful arguments: `node_data`, `repository_factory`, `file_value_restorer`, `delivery_methods`, and `display_in_ui`.

Verification:
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/services/test_workflow_service.py -k build_human_input_node_for_debugging`
- Result: 1 passed, 113 deselected
