# Node Factory Code Report

## Change

- Updated `api/core/workflow/node_factory.py` so the HITL callback now receives a Dify-owned `core.workflow.human_input.HumanInputNodeData` object.
- Preserved the graphon `HumanInputNode` constructor validation path by keeping the resolved graphon node data for node instantiation.
- Added a small local normalization step for legacy human-input payloads:
  - converts `{{ name }}` placeholders to Dify output markers
  - maps legacy `variable` keys to `output_variable_name`
  - strips legacy `label` keys from callback wiring data

## Verification

- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/test_node_factory.py -k 'human_input_callback_builder_receives_dify_node_data_via_real_node_class_path'`
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/human_input/test_callback.py`

## Result

- The targeted regression now passes.
- The adjacent human-input callback unit tests still pass.
