import pytest
from pydantic import ValidationError

import dify_agent.layers.dify_core_tools as dify_core_tools_exports
from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolsLayerConfig


def test_dify_core_tools_package_exports_client_safe_config_symbols_only() -> None:
    assert dify_core_tools_exports.__all__ == [
        "DIFY_CORE_TOOLS_LAYER_TYPE_ID",
        "DifyCoreToolConfig",
        "DifyCoreToolProviderType",
        "DifyCoreToolsLayerConfig",
    ]
    assert dify_core_tools_exports.DIFY_CORE_TOOLS_LAYER_TYPE_ID == "dify.core.tools"


def test_dify_core_tools_layer_config_accepts_supported_provider_types() -> None:
    config = DifyCoreToolsLayerConfig.model_validate(
        {
            "tools": [
                {
                    "provider_type": "plugin",
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                },
                {
                    "provider_type": "builtin",
                    "provider_id": "audio",
                    "tool_name": "transcribe",
                },
                {
                    "provider_type": "api",
                    "provider_id": "weather",
                    "tool_name": "forecast",
                },
                {
                    "provider_type": "workflow",
                    "provider_id": "workflow-tool",
                    "tool_name": "run_workflow",
                },
                {
                    "provider_type": "mcp",
                    "provider_id": "server-1",
                    "tool_name": "search_docs",
                },
            ]
        }
    )

    assert [tool.provider_type for tool in config.tools] == ["plugin", "builtin", "api", "workflow", "mcp"]


def test_dify_core_tool_config_rejects_unsupported_provider_types() -> None:
    with pytest.raises(ValidationError, match="provider_type"):
        _ = DifyCoreToolConfig.model_validate(
            {
                "provider_type": "app",
                "provider_id": "app-tool",
                "tool_name": "run",
            }
        )
