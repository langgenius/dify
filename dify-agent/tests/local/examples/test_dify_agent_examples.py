from __future__ import annotations

import importlib


def test_dify_agent_examples_are_importable() -> None:
    for module_name in [
        "dify_agent_examples.run_pydantic_ai_agent",
        "dify_agent_examples.run_server_consumer",
        "dify_agent_examples.run_server_sse_consumer",
    ]:
        importlib.import_module(module_name)
