from types import SimpleNamespace
from unittest.mock import patch

from core.entities.provider_entities import CustomProviderConfiguration
from core.model_manager import ModelInstance
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from core.tools.entities.common_entities import I18nObject as ToolI18nObject
from core.tools.entities.tool_entities import ToolDescription, ToolEntity, ToolIdentity, ToolParameter
from core.workflow.nodes.agent.runtime_support import AgentRuntimeSupport
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
)
from tests.unit_tests.core.model_fixtures import make_model_config


def test_fetch_model_reuses_single_model_assembly():
    config = make_model_config(provider="openai", model="gpt-4o-mini", mode="chat")
    provider_model_bundle = config.provider_model_bundle
    provider_model_bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"api_key": "x"}
    )
    assembly = PluginModelAssembly(tenant_id="tenant-1", user_id="user-1")

    with (
        patch(
            "core.workflow.nodes.agent.runtime_support.create_plugin_model_assembly",
            return_value=assembly,
        ) as mock_assembly,
        patch.object(
            assembly.provider_manager, "get_provider_model_bundle", return_value=provider_model_bundle
        ) as get_bundle,
        patch.object(
            assembly.model_manager, "get_model_instance", wraps=assembly.model_manager.get_model_instance
        ) as get_instance,
        patch.object(provider_model_bundle.model_type_instance, "get_model_schema", return_value=config.model_schema),
    ):
        resolved_instance, resolved_schema = AgentRuntimeSupport().fetch_model(
            tenant_id="tenant-1",
            user_id="user-1",
            value={"provider": "openai", "model": "gpt-4o-mini", "model_type": "llm"},
        )

    assert isinstance(resolved_instance, ModelInstance)
    assert resolved_instance.model_name == "gpt-4o-mini"
    assert resolved_instance.credentials == {"api_key": "x"}
    assert resolved_schema is config.model_schema
    mock_assembly.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    assert get_bundle.call_count == 2
    get_bundle.assert_called_with(
        tenant_id="tenant-1",
        provider="openai",
        model_type=ModelType.LLM,
    )
    get_instance.assert_called_once_with(
        tenant_id="tenant-1",
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
    )


def _make_model_schema_with_defaults() -> AIModelEntity:
    """Return a minimal AIModelEntity whose parameter_rules carry defaults."""
    return AIModelEntity(
        model="qwen-max",
        label=I18nObject(en_US="Qwen Max"),
        model_type=ModelType.LLM,
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.MULTI_TOOL_CALL],
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={
            ModelPropertyKey.MODE: "chat",
            ModelPropertyKey.CONTEXT_SIZE: 32768,
        },
        parameter_rules=[
            ParameterRule(
                name="temperature",
                use_template="temperature",
                label=I18nObject(en_US="Temperature"),
                type=ParameterType.FLOAT,
                required=False,
                default=0.7,
                min=0.0,
                max=2.0,
                precision=2,
            ),
            ParameterRule(
                name="max_tokens",
                use_template="max_tokens",
                label=I18nObject(en_US="Max Tokens"),
                type=ParameterType.INT,
                required=False,
                default=2048,
                min=1,
                max=32768,
            ),
            ParameterRule(
                name="top_p",
                use_template="top_p",
                label=I18nObject(en_US="Top P"),
                type=ParameterType.FLOAT,
                required=False,
                default=1.0,
            ),
        ],
    )


def test_extract_default_completion_params_collects_rule_defaults():
    """_extract_default_completion_params should gather every rule.default."""
    schema = _make_model_schema_with_defaults()
    params = AgentRuntimeSupport._extract_default_completion_params(schema)
    assert params == {"temperature": 0.7, "max_tokens": 2048, "top_p": 1.0}


def test_extract_default_completion_params_skips_rules_without_default():
    """Rules whose default is None must not appear in the result."""
    schema = AIModelEntity(
        model="test-model",
        label=I18nObject(en_US="Test"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.MODE: "chat"},
        parameter_rules=[
            ParameterRule(
                name="seed",
                label=I18nObject(en_US="Seed"),
                type=ParameterType.INT,
                required=False,
                default=None,
            ),
            ParameterRule(
                name="temperature",
                label=I18nObject(en_US="Temperature"),
                type=ParameterType.FLOAT,
                required=False,
                default=0.5,
            ),
        ],
    )
    params = AgentRuntimeSupport._extract_default_completion_params(schema)
    assert params == {"temperature": 0.5}


def test_extract_default_completion_params_empty_when_no_defaults():
    """An empty parameter_rules list yields an empty dict."""
    schema = AIModelEntity(
        model="test-model",
        label=I18nObject(en_US="Test"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.MODE: "chat"},
        parameter_rules=[],
    )
    assert AgentRuntimeSupport._extract_default_completion_params(schema) == {}


def test_build_model_visible_tool_snapshots_excludes_runtime_values() -> None:
    city = ToolParameter.get_simple_instance(
        name="city",
        llm_description="City name",
        typ=ToolParameter.ToolParameterType.STRING,
        required=True,
    )
    api_key = ToolParameter.get_simple_instance(
        name="api_key",
        llm_description="Hidden credential",
        typ=ToolParameter.ToolParameterType.SECRET_INPUT,
        required=True,
    )
    api_key.form = ToolParameter.ToolParameterForm.FORM
    tool = ToolEntity(
        identity=ToolIdentity(
            author="Dify",
            name="weather",
            label=ToolI18nObject(en_US="Weather", zh_Hans="天气"),
            provider="weather-provider",
        ),
        parameters=[city, api_key],
        description=ToolDescription(
            human=ToolI18nObject(en_US="Weather", zh_Hans="天气"),
            llm="Get the current weather.",
        ),
    )
    serialized_tool = {
        **tool.model_dump(mode="json"),
        "runtime_parameters": {"api_key": "must-not-leak"},
        "credential_id": "credential-id",
    }

    snapshots = AgentRuntimeSupport.build_model_visible_tool_snapshots(
        agent_parameters=[SimpleNamespace(name="tools", type="array[tools]")],  # type: ignore[list-item]
        resolved_parameters={"tools": [serialized_tool]},
    )

    assert snapshots == [
        {
            "tool_ref": "weather-provider/weather",
            "name": "weather",
            "display_name": "Weather",
            "description": "Get the current weather.",
            "input_schema": {
                "type": "object",
                "properties": {"city": {"type": "string", "description": "City name"}},
                "required": ["city"],
            },
            "schema_available": True,
        }
    ]
