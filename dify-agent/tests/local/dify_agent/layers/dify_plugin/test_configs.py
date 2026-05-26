from types import SimpleNamespace

import pytest
from pydantic import ValidationError

import dify_agent.layers.dify_plugin as dify_plugin_exports
from dify_agent.layers.dify_plugin import (
    DifyPluginCredentialValue,
    DifyPluginLLMLayerConfig,
    DifyPluginToolCredentialType,
    DifyPluginToolConfig,
    DifyPluginToolParameter,
    DifyPluginToolParameterForm,
    DifyPluginToolParameterType,
    DifyPluginToolsLayerConfig,
    DifyPluginToolValue,
)


def test_dify_plugin_package_exports_client_safe_config_symbols_only() -> None:
    assert dify_plugin_exports.__all__ == [
        "DIFY_PLUGIN_LLM_LAYER_TYPE_ID",
        "DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID",
        "DifyPluginCredentialValue",
        "DifyPluginLLMLayerConfig",
        "DifyPluginToolCredentialType",
        "DifyPluginToolConfig",
        "DifyPluginToolOption",
        "DifyPluginToolParameter",
        "DifyPluginToolParameterForm",
        "DifyPluginToolParameterType",
        "DifyPluginToolsLayerConfig",
        "DifyPluginToolValue",
    ]
    assert dify_plugin_exports.DIFY_PLUGIN_LLM_LAYER_TYPE_ID == "dify.plugin.llm"
    assert dify_plugin_exports.DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID == "dify.plugin.tools"
    assert not hasattr(dify_plugin_exports, "DifyPluginLLMLayer")


def test_dify_plugin_llm_config_accepts_scalar_credentials_and_model_settings() -> None:
    credential: DifyPluginCredentialValue = "secret"
    config = DifyPluginLLMLayerConfig(
        plugin_id="langgenius/openai",
        model_provider="openai",
        model="gpt-4o-mini",
        credentials={"api_key": credential, "enabled": True, "retries": 2, "ratio": 0.5, "empty": None},
        model_settings={"temperature": 0.2, "max_tokens": 64},
    )

    assert config.plugin_id == "langgenius/openai"
    assert config.model_provider == "openai"
    assert config.credentials == {"api_key": "secret", "enabled": True, "retries": 2, "ratio": 0.5, "empty": None}
    assert config.model_settings == {"temperature": 0.2, "max_tokens": 64}
    with pytest.raises(ValidationError):
        _ = DifyPluginLLMLayerConfig.model_validate(
            {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "gpt-4o-mini",
                "credentials": {"nested": {"not": "allowed"}},
            }
        )


def test_dify_plugin_llm_config_rejects_old_provider_field() -> None:
    with pytest.raises(ValidationError):
        _ = DifyPluginLLMLayerConfig.model_validate(
            {
                "provider": "openai",
                "plugin_id": "langgenius/openai",
                "model": "gpt-4o-mini",
            }
        )


def test_dify_plugin_tools_layer_config_accepts_prepared_parameters_and_schema() -> None:
    runtime_value: DifyPluginToolValue = {"locale": "en-US", "max_results": 5}
    credential_type: DifyPluginToolCredentialType = "api-key"
    config = DifyPluginToolsLayerConfig(
        tools=[
            DifyPluginToolConfig(
                plugin_id="langgenius/tools",
                provider="search",
                tool_name="web_search",
                credential_type=credential_type,
                name="search_web",
                description="Search the web.",
                credentials={"api_key": "secret"},
                runtime_parameters={"settings": runtime_value},
                parameters=[
                    DifyPluginToolParameter(
                        name="query",
                        type=DifyPluginToolParameterType.STRING,
                        form=DifyPluginToolParameterForm.LLM,
                        required=True,
                        llm_description="Search query",
                    )
                ],
                parameters_json_schema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                    },
                    "required": ["query"],
                },
            )
        ]
    )

    assert config.tools[0].plugin_id == "langgenius/tools"
    assert config.tools[0].provider == "search"
    assert config.tools[0].tool_name == "web_search"
    assert config.tools[0].credential_type == "api-key"
    assert config.tools[0].name == "search_web"
    assert config.tools[0].runtime_parameters == {"settings": {"locale": "en-US", "max_results": 5}}
    assert config.tools[0].parameters[0].name == "query"
    assert config.tools[0].parameters_json_schema["required"] == ["query"]


def test_dify_plugin_tool_parameter_accepts_api_tool_parameter_dump_shape() -> None:
    parameter = DifyPluginToolParameter.model_validate(
        {
            "name": "query",
            "label": {"en_US": "Query"},
            "placeholder": None,
            "human_description": {"en_US": "Visible in UI"},
            "type": "select",
            "form": "llm",
            "required": True,
            "default": "dify",
            "llm_description": "Search query",
            "input_schema": {"type": "string"},
            "options": [
                {
                    "value": "dify",
                    "label": {"en_US": "Dify"},
                }
            ],
        }
    )

    assert parameter.name == "query"
    assert parameter.type is DifyPluginToolParameterType.SELECT
    assert parameter.form is DifyPluginToolParameterForm.LLM
    assert parameter.required is True
    assert parameter.default == "dify"
    assert parameter.input_schema == {"type": "string"}
    assert [option.value for option in parameter.options] == ["dify"]


def test_dify_plugin_tool_parameter_accepts_api_tool_parameter_attributes() -> None:
    parameter = DifyPluginToolParameter.model_validate(
        SimpleNamespace(
            name="language",
            label=SimpleNamespace(en_US="Language"),
            type="string",
            form="form",
            required=False,
            default="en",
            llm_description=None,
            input_schema=None,
            options=[SimpleNamespace(value="en", label=SimpleNamespace(en_US="English"))],
        )
    )

    assert parameter.name == "language"
    assert parameter.type is DifyPluginToolParameterType.STRING
    assert parameter.form is DifyPluginToolParameterForm.FORM
    assert parameter.default == "en"
    assert [option.value for option in parameter.options] == ["en"]


def test_dify_plugin_tool_config_rejects_non_json_runtime_parameters() -> None:
    with pytest.raises(ValidationError):
        _ = DifyPluginToolConfig.model_validate(
            {
                "plugin_id": "langgenius/tools",
                "provider": "search",
                "tool_name": "web_search",
                "credential_type": "api-key",
                "runtime_parameters": {"bad": object()},
            }
        )


def test_dify_plugin_tool_config_rejects_non_json_schema_values() -> None:
    with pytest.raises(ValidationError):
        _ = DifyPluginToolConfig.model_validate(
            {
                "plugin_id": "langgenius/tools",
                "provider": "search",
                "tool_name": "web_search",
                "credential_type": "api-key",
                "parameters_json_schema": {"type": object()},
            }
        )


def test_dify_plugin_tool_config_rejects_strict_flag() -> None:
    with pytest.raises(ValidationError):
        _ = DifyPluginToolConfig.model_validate(
            {
                "plugin_id": "langgenius/tools",
                "provider": "search",
                "tool_name": "web_search",
                "credential_type": "api-key",
                "strict": True,
            }
        )


def test_dify_plugin_tool_config_requires_explicit_credential_type() -> None:
    with pytest.raises(ValidationError):
        _ = DifyPluginToolConfig.model_validate(
            {
                "plugin_id": "langgenius/tools",
                "provider": "search",
                "tool_name": "web_search",
            }
        )
