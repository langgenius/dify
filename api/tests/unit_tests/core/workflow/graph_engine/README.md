# Workflow Graph Engine Smoke Tests

This directory now keeps only a small Dify-owned smoke layer around the external
`graphon` package.

Retained coverage focuses on:

1. Dify workflow layers:
   - `layers/test_llm_quota.py`
   - `layers/test_observability.py`
2. Human-input resume integration:
   - `test_parallel_human_input_join_resume.py`
3. One mocked tool/chatflow smoke path:
   - `test_tool_in_chatflow.py`

The helper modules below remain only because the retained smoke tests use them:

1. `test_mock_config.py`
2. `test_mock_factory.py`
3. `test_mock_nodes.py`
4. `test_table_runner.py`

Examples:

```bash
uv run --project api --dev pytest api/tests/unit_tests/core/workflow/graph_engine/layers/test_llm_quota.py
uv run --project api --dev pytest api/tests/unit_tests/core/workflow/graph_engine/layers/test_observability.py
uv run --project api --dev pytest api/tests/unit_tests/core/workflow/graph_engine/test_parallel_human_input_join_resume.py
uv run --project api --dev pytest api/tests/unit_tests/core/workflow/graph_engine/test_tool_in_chatflow.py
```
