from types import SimpleNamespace

import pytest

from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.agent.exceptions import AgentVariableNotFoundError
from core.workflow.nodes.agent.runtime_support import AgentRuntimeSupport


def test_filter_mcp_type_tool_depends_on_strategy_meta_version() -> None:
    runtime_support = AgentRuntimeSupport()
    tools = [
        {"type": ToolProviderType.BUILT_IN, "tool_name": "search"},
        {"type": ToolProviderType.MCP, "tool_name": "mcp-tool"},
    ]

    filtered_tools = runtime_support._filter_mcp_type_tool(SimpleNamespace(meta_version="0.0.1"), tools)
    preserved_tools = runtime_support._filter_mcp_type_tool(SimpleNamespace(meta_version="0.0.2"), tools)

    assert filtered_tools == [{"type": ToolProviderType.BUILT_IN, "tool_name": "search"}]
    assert preserved_tools == tools


def test_normalize_tool_payloads_keeps_enabled_tools_and_resolves_values() -> None:
    runtime_support = AgentRuntimeSupport()
    variable_pool = SimpleNamespace(get=lambda selector: SimpleNamespace(value=f"resolved:{'.'.join(selector)}"))

    normalized_tools = runtime_support._normalize_tool_payloads(
        strategy=SimpleNamespace(meta_version="0.0.2"),
        tools=[
            {
                "enabled": True,
                "tool_name": "search",
                "schemas": {"ignored": True},
                "parameters": {
                    "query": {
                        "auto": 0,
                        "value": {"type": "variable", "value": ["start", "query"]},
                    },
                    "top_k": {
                        "auto": 0,
                        "value": {"type": "constant", "value": 3},
                    },
                    "optional": {"auto": 1, "value": {"type": "constant", "value": "skip"}},
                },
                "settings": {
                    "region": {"value": "us"},
                    "safe": {"value": True},
                },
            },
            {"enabled": False, "tool_name": "disabled"},
        ],
        variable_pool=variable_pool,
    )

    assert normalized_tools == [
        {
            "enabled": True,
            "tool_name": "search",
            "parameters": {"query": "resolved:start.query", "top_k": 3, "optional": None},
            "settings": {"region": "us", "safe": True},
        }
    ]


def test_resolve_tool_parameters_raises_for_missing_variable() -> None:
    runtime_support = AgentRuntimeSupport()
    variable_pool = SimpleNamespace(get=lambda _selector: None)

    with pytest.raises(AgentVariableNotFoundError, match=r"\['start', 'query'\]"):
        runtime_support._resolve_tool_parameters(
            tool={
                "parameters": {
                    "query": {
                        "auto": 0,
                        "value": {"type": "variable", "value": ["start", "query"]},
                    }
                }
            },
            variable_pool=variable_pool,
        )


def test_build_credentials_collects_valid_tool_credentials_only() -> None:
    runtime_support = AgentRuntimeSupport()

    credentials = runtime_support.build_credentials(
        parameters={
            "tools": [
                {
                    "credential_id": "cred-1",
                    "identity": {
                        "author": "author",
                        "name": "tool",
                        "label": {"en_US": "Tool"},
                        "provider": "provider-a",
                    },
                },
                {
                    "credential_id": "cred-2",
                    "identity": {"author": "author"},
                },
                {
                    "credential_id": None,
                    "identity": {
                        "author": "author",
                        "name": "tool",
                        "label": {"en_US": "Tool"},
                        "provider": "provider-b",
                    },
                },
                "invalid",
            ]
        }
    )

    assert credentials.tool_credentials == {"provider-a": "cred-1"}


def test_coerce_named_json_objects_requires_string_keys_and_json_object_values() -> None:
    runtime_support = AgentRuntimeSupport()

    assert runtime_support._coerce_named_json_objects({"valid": {"value": 1}}) == {"valid": {"value": 1}}
    assert runtime_support._coerce_named_json_objects({1: {"value": 1}}) is None
    assert runtime_support._coerce_named_json_objects({"invalid": object()}) is None
