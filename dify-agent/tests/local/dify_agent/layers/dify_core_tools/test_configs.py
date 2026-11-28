import json
import pytest
from pydantic import ValidationError
import dify_agent.layers.dify_core_tools as dify_core_tools_exports
from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolsLayerConfig


def test_dify_core_tools_package_exports_client_safe_config_symbols_only() -> None:
    assert dify_core_tools_exports.__all__ == [
        "DifyCoreToolConfig",
        "DifyCoreToolProviderType",
        "DifyCoreToolsLayerConfig",
    ]


def test_dify_core_tools_layer_config_accepts_supported_provider_types() -> None:
    config = DifyCoreToolsLayerConfig.model_validate(
        {
            "tools": [
                {"provider_type": "plugin", "provider_id": "langgenius/search/search", "tool_name": "search"},
                {"provider_type": "builtin", "provider_id": "audio", "tool_name": "transcribe"},
                {"provider_type": "api", "provider_id": "weather", "tool_name": "forecast"},
                {"provider_type": "workflow", "provider_id": "workflow-tool", "tool_name": "run_workflow"},
                {"provider_type": "mcp", "provider_id": "server-1", "tool_name": "search_docs"},
            ]
        }
    )
    assert [tool.provider_type for tool in config.tools] == ["plugin", "builtin", "api", "workflow", "mcp"]


def test_dify_core_tool_config_rejects_unsupported_provider_types() -> None:
    with pytest.raises(ValidationError, match="provider_type"):
        _ = DifyCoreToolConfig.model_validate({"provider_type": "app", "provider_id": "app-tool", "tool_name": "run"})


@pytest.mark.parametrize("limit", [None, 1, 3, 10**40 + 123])
def test_tool_call_limit_accepts_null_or_strict_positive_integer_at_native_and_json_boundaries(
    limit: int | None,
) -> None:
    payload = {"provider_type": "api", "provider_id": "provider", "tool_name": "search"} | {"max_calls_per_run": limit}
    config = DifyCoreToolConfig.model_validate(payload)
    layer = DifyCoreToolsLayerConfig.model_validate_json(json.dumps({"tools": [payload]}))
    assert config.max_calls_per_run == limit
    assert layer.tools[0].max_calls_per_run == limit
    serialized_tool = json.loads(layer.model_dump_json())["tools"][0]
    if limit is None:
        assert "max_calls_per_run" not in serialized_tool
    else:
        assert serialized_tool["max_calls_per_run"] == limit


def test_legacy_tool_configuration_without_call_limit_remains_unlimited() -> None:
    payload = {"provider_type": "api", "provider_id": "provider", "tool_name": "search"}
    assert DifyCoreToolConfig.model_validate(payload).max_calls_per_run is None
    layer = DifyCoreToolsLayerConfig.model_validate_json(json.dumps({"tools": [payload]}))
    assert layer.tools[0].max_calls_per_run is None
    assert "max_calls_per_run" not in layer.model_dump(mode="json")["tools"][0]


@pytest.mark.parametrize("limit", [0, -1, 1.0, 1.5, True, False, "3", "", [], {}])
def test_tool_call_limit_rejects_non_positive_or_coerced_values_at_native_and_json_boundaries(limit: object) -> None:
    payload = {"provider_type": "api", "provider_id": "provider", "tool_name": "search"} | {"max_calls_per_run": limit}
    with pytest.raises(ValidationError, match="max_calls_per_run"):
        DifyCoreToolConfig.model_validate(payload)
    with pytest.raises(ValidationError, match="max_calls_per_run"):
        DifyCoreToolsLayerConfig.model_validate_json(json.dumps({"tools": [payload]}))
