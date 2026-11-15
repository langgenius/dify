import json
from collections.abc import Mapping, Sequence
from unittest.mock import patch

import pytest

from core.agent.plugin_entities import AgentStrategyEntity, AgentStrategyIdentity, AgentStrategyParameter
from core.agent.strategy.plugin import PluginAgentStrategy
from core.app.entities.app_invoke_entities import InvokeFrom
from core.entities.provider_entities import CustomProviderConfiguration
from core.model_manager import ModelInstance
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from core.tools.entities.common_entities import I18nObject as ToolI18nObject
from core.workflow.nodes.agent.entities import AgentNodeData
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
from graphon.runtime import VariablePool
from tests.helpers.unit.core.model_fixtures import make_model_config


def test_fetch_model_reuses_single_model_assembly() -> None:
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


def test_extract_default_completion_params_collects_rule_defaults() -> None:
    """_extract_default_completion_params should gather every rule.default."""
    schema = _make_model_schema_with_defaults()
    params = AgentRuntimeSupport._extract_default_completion_params(schema)
    assert params == {"temperature": 0.7, "max_tokens": 2048, "top_p": 1.0}


def test_extract_default_completion_params_skips_rules_without_default() -> None:
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


def test_extract_default_completion_params_empty_when_no_defaults() -> None:
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


_ParameterType = AgentStrategyParameter.AgentStrategyParameterType


def _declared_parameter(name: str, parameter_type: _ParameterType) -> AgentStrategyParameter:
    return AgentStrategyParameter(name=name, label=ToolI18nObject(en_US=name), type=parameter_type)


def _resolved_strategy() -> PluginAgentStrategy:
    label = ToolI18nObject(en_US="strategy")
    return PluginAgentStrategy(
        tenant_id="tenant-1",
        declaration=AgentStrategyEntity(
            identity=AgentStrategyIdentity(author="author", name="strategy", label=label, provider="provider"),
            description=label,
        ),
        meta_version="0.0.2",
        plugin_unique_identifier="identifier",
    )


def _build_parameters(
    *,
    configured: Mapping[str, object],
    declared: Sequence[AgentStrategyParameter],
    variables: Mapping[str, object],
    scoped_variables: Mapping[tuple[str, str], object] | None = None,
    for_log: bool = False,
) -> dict[str, object]:
    variable_pool = VariablePool()
    for name, value in variables.items():
        variable_pool.add(("start", name), value)
    for selector, value in (scoped_variables or {}).items():
        variable_pool.add(selector, value)
    node_data = AgentNodeData.model_validate({"type": "agent", "agent_parameters": configured})
    return AgentRuntimeSupport().build_parameters(
        agent_parameters=declared,
        variable_pool=variable_pool,
        node_data=node_data,
        strategy=_resolved_strategy(),
        tenant_id="tenant-1",
        user_id="user-1",
        app_id="app-1",
        invoke_from=InvokeFrom.SERVICE_API,
        for_log=for_log,
    )


def _tool_with_setting(template: str) -> dict[str, object]:
    return {
        "provider_name": "provider",
        "tool_name": "call_something",
        "type": "builtin",
        "enabled": True,
        "settings": {"target": {"value": {"value": template, "type": "mixed"}}},
        "parameters": {},
    }


def test_build_parameters_treats_null_variable_value_as_not_provided() -> None:
    """A canvas-written {type: variable, value: null} entry must not crash the node.

    The canvas stores unset optional strategy params as {"type": "variable", "value": null}.
    build_parameters must pass None to the strategy instead of calling
    variable_pool.get(None), which raises TypeError: object of type 'NoneType' has no len().
    """
    result = _build_parameters(
        configured={
            "files": {"type": "variable", "value": None},
            "allowed_tools": {"type": "variable", "value": None},
        },
        declared=[
            _declared_parameter("files", _ParameterType.FILES),
            _declared_parameter("allowed_tools", _ParameterType.TOOLS_SELECTOR),
        ],
        variables={},
    )

    assert result["files"] is None
    assert result["allowed_tools"] is None


def test_build_parameters_resolves_set_variable_value() -> None:
    result = _build_parameters(
        configured={"query": {"type": "variable", "value": ["start", "target"]}},
        declared=[_declared_parameter("query", _ParameterType.STRING)],
        variables={"target": "dify"},
    )

    assert result["query"] == "dify"


@pytest.mark.parametrize(
    "raw_value",
    [
        pytest.param('a "quoted" word', id="double-quote"),
        pytest.param("a\\backslash", id="backslash"),
        pytest.param("tab\there", id="tab"),
        pytest.param("line\nbreak", id="newline"),
        pytest.param('{"looks": "like json\t"}', id="json-lookalike"),
    ],
)
def test_build_parameters_keeps_tool_settings_holding_json_special_characters(raw_value: str) -> None:
    """Tool settings referencing a variable must survive values that are illegal inside JSON text."""
    result = _build_parameters(
        configured={"tools": {"type": "constant", "value": [_tool_with_setting("{{#start.target#}}")]}},
        declared=[_declared_parameter("tools", _ParameterType.TOOLS_SELECTOR)],
        variables={"target": raw_value},
        for_log=True,
    )

    tools = result["tools"]
    assert isinstance(tools, list)
    assert len(tools) == 1
    assert tools[0]["tool_name"] == "call_something"
    assert tools[0]["settings"]["target"]["value"] == raw_value


def test_build_parameters_resolves_template_embedded_in_a_longer_tool_setting() -> None:
    # for_log keeps the tools branch away from ToolManager while still resolving settings.
    result = _build_parameters(
        configured={"tools": {"type": "constant", "value": [_tool_with_setting("room {{#start.target#}}!")]}},
        declared=[_declared_parameter("tools", _ParameterType.TOOLS_SELECTOR)],
        variables={"target": 'a\t"tabbed"\tname'},
        for_log=True,
    )

    tools = result["tools"]
    assert isinstance(tools, list)
    assert tools[0]["settings"]["target"]["value"] == 'room a\t"tabbed"\tname!'


def test_build_parameters_preserves_nested_constant_structure() -> None:
    raw_value = 'a "quoted"\ttab'
    result = _build_parameters(
        configured={
            "options": {
                "type": "constant",
                "value": [{"label": "{{#start.target#}}", "nested": {"items": ["{{#start.target#}}"]}}],
            }
        },
        declared=[_declared_parameter("options", _ParameterType.ANY)],
        variables={"target": raw_value},
    )

    assert result["options"] == [{"label": raw_value, "nested": {"items": [raw_value]}}]


def test_build_parameters_keeps_scalar_constant_types() -> None:
    result = _build_parameters(
        configured={
            "maximum_iterations": {"type": "constant", "value": 10},
            "stream": {"type": "constant", "value": True},
            "ratio": {"type": "constant", "value": 0.5},
        },
        declared=[
            _declared_parameter("maximum_iterations", _ParameterType.NUMBER),
            _declared_parameter("stream", _ParameterType.BOOLEAN),
            _declared_parameter("ratio", _ParameterType.NUMBER),
        ],
        variables={},
    )

    assert result["maximum_iterations"] == 10
    assert isinstance(result["maximum_iterations"], int)
    assert result["stream"] is True
    assert result["ratio"] == 0.5


def test_build_parameters_resolves_plain_string_constant() -> None:
    result = _build_parameters(
        configured={"query": {"type": "mixed", "value": 'ask about "{{#start.target#}}"'}},
        declared=[_declared_parameter("query", _ParameterType.STRING)],
        variables={"target": "dify"},
    )

    assert result["query"] == 'ask about "dify"'


def test_build_parameters_selects_log_form_for_nested_leaves_when_logging() -> None:
    configured = {"options": {"type": "constant", "value": {"payload": "{{#start.blob#}}"}}}
    declared = [_declared_parameter("options", _ParameterType.ANY)]
    variables = {"blob": {"key": "value"}}

    logged = _build_parameters(configured=configured, declared=declared, variables=variables, for_log=True)
    rendered = _build_parameters(configured=configured, declared=declared, variables=variables, for_log=False)

    logged_options = logged["options"]
    rendered_options = rendered["options"]
    assert isinstance(logged_options, dict)
    assert isinstance(rendered_options, dict)

    assert logged_options["payload"] == json.dumps({"key": "value"}, ensure_ascii=False, indent=2)
    assert rendered_options["payload"] == json.dumps({"key": "value"}, ensure_ascii=False)


_SELECTOR_LOOKALIKES = {
    ("sys", "query"): "the user question",
    ("env", "SECRET"): "s3cr3t-value",
    ("start", "target"): "plain",
}


@pytest.mark.parametrize(
    "literal",
    [
        pytest.param("sys.query", id="system-variable"),
        pytest.param("env.SECRET", id="environment-secret"),
        pytest.param("start.target", id="node-output"),
    ],
)
def test_build_parameters_keeps_selector_lookalike_tool_arguments_literal(literal: str) -> None:
    """A tool argument carrying no {{#...#}} marker is literal text even when it names a variable.

    convert_template also looks a bare dotted fragment up as a selector. That stayed dormant while
    the value was resolved as one serialized document, so resolving leaves one by one must not
    resurrect it or existing configurations would start sending variable values to the tool.
    """
    result = _build_parameters(
        configured={"tools": {"type": "constant", "value": [_tool_with_setting(literal)]}},
        declared=[_declared_parameter("tools", _ParameterType.TOOLS_SELECTOR)],
        variables={},
        scoped_variables=_SELECTOR_LOOKALIKES,
        for_log=True,
    )

    tools = result["tools"]
    assert isinstance(tools, list)
    assert tools[0]["settings"]["target"]["value"] == literal


def test_build_parameters_resolves_markers_without_touching_bare_selectors_beside_them() -> None:
    result = _build_parameters(
        configured={"tools": {"type": "constant", "value": [_tool_with_setting("env.SECRET{{#start.target#}}")]}},
        declared=[_declared_parameter("tools", _ParameterType.TOOLS_SELECTOR)],
        variables={},
        scoped_variables=_SELECTOR_LOOKALIKES,
        for_log=True,
    )

    tools = result["tools"]
    assert isinstance(tools, list)
    assert tools[0]["settings"]["target"]["value"] == "env.SECRETplain"


def test_build_parameters_keeps_selector_lookalikes_literal_in_nested_constants() -> None:
    result = _build_parameters(
        configured={
            "options": {
                "type": "constant",
                "value": [{"label": "env.SECRET", "nested": {"items": ["sys.query", "{{#start.target#}}"]}}],
            }
        },
        declared=[_declared_parameter("options", _ParameterType.ANY)],
        variables={},
        scoped_variables=_SELECTOR_LOOKALIKES,
    )

    assert result["options"] == [{"label": "env.SECRET", "nested": {"items": ["sys.query", "plain"]}}]


def test_build_parameters_keeps_top_level_string_lookup_behaviour() -> None:
    """A top-level string is the template itself, so its lookup is deliberately left unchanged."""
    result = _build_parameters(
        configured={"query": {"type": "mixed", "value": "sys.query"}},
        declared=[_declared_parameter("query", _ParameterType.STRING)],
        variables={},
        scoped_variables=_SELECTOR_LOOKALIKES,
    )

    assert result["query"] == "the user question"
