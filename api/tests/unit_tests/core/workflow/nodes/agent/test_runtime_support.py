from unittest.mock import MagicMock, patch

import pytest

from core.agent.plugin_entities import AgentStrategyParameter
from core.entities.provider_entities import CustomProviderConfiguration
from core.model_manager import ModelInstance
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from core.workflow.nodes.agent.entities import AgentNodeData
from core.workflow.nodes.agent.exceptions import AgentVariableNotFoundError
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
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.workflow_test_utils import build_test_variable_pool


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


@pytest.mark.parametrize("empty_selector", ["", [], None])
def test_build_parameters_empty_selector_optional_parameter_treated_as_unset(empty_selector: object) -> None:
    support = AgentRuntimeSupport()
    variable_pool = build_test_variable_pool(node_id="start", inputs={"text": "hello"})
    param = AgentStrategyParameter(
        name="context",
        label={"en_US": "Context"},
        type=AgentStrategyParameter.AgentStrategyParameterType.ANY,
        required=False,
    )
    node_data = AgentNodeData(
        agent_parameters={"context": AgentNodeData.AgentInput(type="variable", value=empty_selector)}
    )

    result = support.build_parameters(
        agent_parameters=[param],
        variable_pool=variable_pool,
        node_data=node_data,
        strategy=MagicMock(),
        tenant_id="tenant-1",
        user_id="user-1",
        app_id="app-1",
        invoke_from="debugger",
    )

    assert "context" not in result


@pytest.mark.parametrize("empty_selector", ["", [], None])
def test_build_parameters_empty_selector_required_parameter_raises_error(empty_selector: object) -> None:
    support = AgentRuntimeSupport()
    variable_pool = build_test_variable_pool(node_id="start", inputs={"text": "hello"})
    param = AgentStrategyParameter(
        name="context",
        label={"en_US": "Context"},
        type=AgentStrategyParameter.AgentStrategyParameterType.ANY,
        required=True,
    )
    node_data = AgentNodeData(
        agent_parameters={"context": AgentNodeData.AgentInput(type="variable", value=empty_selector)}
    )

    with pytest.raises(AgentVariableNotFoundError):
        support.build_parameters(
            agent_parameters=[param],
            variable_pool=variable_pool,
            node_data=node_data,
            strategy=MagicMock(),
            tenant_id="tenant-1",
            user_id="user-1",
            app_id="app-1",
            invoke_from="debugger",
        )


def test_build_parameters_non_empty_unresolvable_selector_raises_error() -> None:
    support = AgentRuntimeSupport()
    variable_pool = build_test_variable_pool(node_id="start", inputs={"text": "hello"})
    param = AgentStrategyParameter(
        name="context",
        label={"en_US": "Context"},
        type=AgentStrategyParameter.AgentStrategyParameterType.ANY,
        required=False,
    )
    node_data = AgentNodeData(
        agent_parameters={"context": AgentNodeData.AgentInput(type="variable", value=["start", "missing"])}
    )

    with pytest.raises(AgentVariableNotFoundError):
        support.build_parameters(
            agent_parameters=[param],
            variable_pool=variable_pool,
            node_data=node_data,
            strategy=MagicMock(),
            tenant_id="tenant-1",
            user_id="user-1",
            app_id="app-1",
            invoke_from="debugger",
        )


@pytest.mark.parametrize(
    ("selector_key", "expected_value"),
    [
        ("empty_str", ""),
        ("zero", 0),
        ("falsy", False),
    ],
)
def test_build_parameters_resolving_to_empty_or_falsy_not_treated_as_unset(
    selector_key: str,
    expected_value: object,
) -> None:
    support = AgentRuntimeSupport()
    variable_pool = build_test_variable_pool(
        node_id="start",
        inputs={"empty_str": "", "zero": 0, "falsy": False},
    )
    param = AgentStrategyParameter(
        name="context",
        label={"en_US": "Context"},
        type=AgentStrategyParameter.AgentStrategyParameterType.ANY,
        required=False,
    )
    node_data = AgentNodeData(
        agent_parameters={"context": AgentNodeData.AgentInput(type="variable", value=["start", selector_key])}
    )

    result = support.build_parameters(
        agent_parameters=[param],
        variable_pool=variable_pool,
        node_data=node_data,
        strategy=MagicMock(),
        tenant_id="tenant-1",
        user_id="user-1",
        app_id="app-1",
        invoke_from="debugger",
    )

    assert result["context"] == expected_value
