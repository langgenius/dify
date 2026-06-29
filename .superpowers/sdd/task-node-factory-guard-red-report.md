# Node factory guard red report

- Test added: `TestDifyNodeFactoryCreateNode.test_human_input_node_data_for_callback_only_for_human_input`
- Intent: prove non-`HUMAN_INPUT` nodes do not invoke `_build_dify_human_input_node_data_for_callback(...)`
- Verification command:
  - `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/test_node_factory.py -k 'human_input_node_data_for_callback_only_for_human_input'`
- Result:
  - Failed as expected on the current branch
  - Assertion showed `_build_dify_human_input_node_data_for_callback(...)` was called once for a `START` node
- Notes:
  - This is a red regression test only; no production code was modified
