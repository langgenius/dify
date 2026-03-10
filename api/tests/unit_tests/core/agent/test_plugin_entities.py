"""Unit tests for core.agent.plugin_entities.

Covers entities such as AgentFeature, AgentProviderEntityWithPlugin,
AgentStrategyEntity, AgentStrategyIdentity, AgentStrategyParameter,
AgentStrategyProviderEntity, and AgentStrategyProviderIdentity. Tests rely on
Pydantic ValidationError behavior and pytest fixtures for validation and
mocking; ensure entity invariants and validation rules remain stable.
"""

import pytest
from pydantic import ValidationError

from core.agent.plugin_entities import (
    AgentFeature,
    AgentProviderEntityWithPlugin,
    AgentStrategyEntity,
    AgentStrategyIdentity,
    AgentStrategyParameter,
    AgentStrategyProviderEntity,
    AgentStrategyProviderIdentity,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolIdentity, ToolProviderIdentity

# =========================================================
# Fixtures
# =========================================================


@pytest.fixture
def mock_identity(mocker):
    return mocker.MagicMock(spec=AgentStrategyIdentity)


@pytest.fixture
def mock_provider_identity(mocker):
    return mocker.MagicMock(spec=AgentStrategyProviderIdentity)


# =========================================================
# AgentStrategyParameterType Tests
# =========================================================


class TestAgentStrategyParameterType:
    @pytest.mark.parametrize(
        "enum_member",
        list(AgentStrategyParameter.AgentStrategyParameterType),
    )
    def test_as_normal_type_calls_external_function(self, mocker, enum_member) -> None:
        mock_func = mocker.patch(
            "core.agent.plugin_entities.as_normal_type",
            return_value="normalized",
        )

        result = enum_member.as_normal_type()

        mock_func.assert_called_once_with(enum_member)
        assert result == "normalized"

    def test_as_normal_type_propagates_exception(self, mocker) -> None:
        enum_member = AgentStrategyParameter.AgentStrategyParameterType.STRING
        mocker.patch(
            "core.agent.plugin_entities.as_normal_type",
            side_effect=RuntimeError("boom"),
        )

        with pytest.raises(RuntimeError):
            enum_member.as_normal_type()

    @pytest.mark.parametrize(
        ("enum_member", "value"),
        [
            (AgentStrategyParameter.AgentStrategyParameterType.STRING, "abc"),
            (AgentStrategyParameter.AgentStrategyParameterType.NUMBER, 10),
            (AgentStrategyParameter.AgentStrategyParameterType.BOOLEAN, True),
            (AgentStrategyParameter.AgentStrategyParameterType.ANY, {"a": 1}),
            (AgentStrategyParameter.AgentStrategyParameterType.STRING, None),
            (AgentStrategyParameter.AgentStrategyParameterType.FILES, []),
        ],
    )
    def test_cast_value_calls_external_function(self, mocker, enum_member, value) -> None:
        mock_func = mocker.patch(
            "core.agent.plugin_entities.cast_parameter_value",
            return_value="casted",
        )

        result = enum_member.cast_value(value)

        mock_func.assert_called_once_with(enum_member, value)
        assert result == "casted"

    def test_cast_value_propagates_exception(self, mocker) -> None:
        enum_member = AgentStrategyParameter.AgentStrategyParameterType.STRING
        mocker.patch(
            "core.agent.plugin_entities.cast_parameter_value",
            side_effect=ValueError("invalid"),
        )

        with pytest.raises(ValueError):
            enum_member.cast_value("bad")


# =========================================================
# AgentStrategyParameter Tests
# =========================================================


class TestAgentStrategyParameter:
    def test_valid_creation_minimal(self) -> None:
        # bypass base PluginParameter required fields using model_construct
        param = AgentStrategyParameter.model_construct(
            type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
            name="test",
            label="label",
            help=None,
        )
        assert param.type == AgentStrategyParameter.AgentStrategyParameterType.STRING
        assert param.help is None

    def test_valid_creation_with_help(self) -> None:
        help_obj = I18nObject(en_US="test")

        param = AgentStrategyParameter.model_construct(
            type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
            name="test",
            label="label",
            help=help_obj,
        )
        assert param.help == help_obj

    @pytest.mark.parametrize("invalid_type", [None, "invalid_type", 999, [], {}, ["bad"], {"bad": 1}])
    def test_invalid_type_raises_validation_error(self, invalid_type) -> None:
        with pytest.raises(ValidationError) as exc_info:
            AgentStrategyParameter(type=invalid_type, name="x", label=I18nObject(en_US="y", zh_Hans="y"))

        assert any(error["loc"] == ("type",) for error in exc_info.value.errors())

    def test_init_frontend_parameter_calls_external(self, mocker) -> None:
        mock_func = mocker.patch(
            "core.agent.plugin_entities.init_frontend_parameter",
            return_value="frontend",
        )

        param = AgentStrategyParameter.model_construct(
            type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
            name="test",
            label="label",
        )

        result = param.init_frontend_parameter("value")

        mock_func.assert_called_once_with(param, param.type, "value")
        assert result == "frontend"

    def test_init_frontend_parameter_propagates_exception(self, mocker) -> None:
        mocker.patch(
            "core.agent.plugin_entities.init_frontend_parameter",
            side_effect=RuntimeError("error"),
        )

        param = AgentStrategyParameter.model_construct(
            type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
            name="test",
            label="label",
        )

        with pytest.raises(RuntimeError):
            param.init_frontend_parameter("value")


# =========================================================
# AgentStrategyProviderEntity Tests
# =========================================================


class TestAgentStrategyProviderEntity:
    def test_creation_with_plugin_id(self, mock_provider_identity) -> None:
        entity = AgentStrategyProviderEntity(
            identity=mock_provider_identity,
            plugin_id="plugin-123",
        )
        assert entity.plugin_id == "plugin-123"

    def test_creation_with_empty_plugin_id(self, mock_provider_identity) -> None:
        entity = AgentStrategyProviderEntity(
            identity=mock_provider_identity,
            plugin_id="",
        )
        assert entity.plugin_id == ""

    def test_creation_without_plugin_id(self, mock_provider_identity) -> None:
        entity = AgentStrategyProviderEntity(identity=mock_provider_identity)
        assert entity.plugin_id is None

    def test_invalid_identity_raises(self) -> None:
        with pytest.raises(ValidationError):
            AgentStrategyProviderEntity(identity="invalid")


# =========================================================
# AgentStrategyEntity Tests
# =========================================================


class TestAgentStrategyEntity:
    def test_parameters_default_empty(self, mock_identity) -> None:
        entity = AgentStrategyEntity(
            identity=mock_identity,
            description=I18nObject(en_US="test"),
        )
        assert entity.parameters == []

    def test_parameters_none_converted_to_empty(self, mock_identity) -> None:
        entity = AgentStrategyEntity(
            identity=mock_identity,
            description=I18nObject(en_US="test"),
            parameters=None,
        )
        assert entity.parameters == []

    def test_parameters_preserved(self, mock_identity) -> None:
        param = AgentStrategyParameter.model_construct(
            type=AgentStrategyParameter.AgentStrategyParameterType.STRING,
            name="test",
            label="label",
        )

        entity = AgentStrategyEntity(
            identity=mock_identity,
            description=I18nObject(en_US="test"),
            parameters=[param],
        )
        assert entity.parameters == [param]

    def test_invalid_parameters_type_raises(self, mock_identity) -> None:
        with pytest.raises(ValidationError):
            AgentStrategyEntity(
                identity=mock_identity,
                description=I18nObject(en_US="test"),
                parameters="invalid",
            )

    @pytest.mark.parametrize(
        "features",
        [
            None,
            [],
            [AgentFeature.HISTORY_MESSAGES],
        ],
    )
    def test_features_valid(self, mock_identity, features) -> None:
        entity = AgentStrategyEntity(
            identity=mock_identity,
            description=I18nObject(en_US="test"),
            features=features,
        )
        assert entity.features == features

    def test_invalid_features_type_raises(self, mock_identity) -> None:
        with pytest.raises(ValidationError):
            AgentStrategyEntity(
                identity=mock_identity,
                description=I18nObject(en_US="test"),
                features="invalid",
            )

    def test_output_schema_and_meta_version(self, mock_identity) -> None:
        entity = AgentStrategyEntity(
            identity=mock_identity,
            description=I18nObject(en_US="test"),
            output_schema={"type": "object"},
            meta_version="v1",
        )
        assert entity.output_schema == {"type": "object"}
        assert entity.meta_version == "v1"

    def test_missing_required_fields_raise(self, mock_identity) -> None:
        with pytest.raises(ValidationError):
            AgentStrategyEntity(identity=mock_identity)


# =========================================================
# AgentProviderEntityWithPlugin Tests
# =========================================================


class TestAgentProviderEntityWithPlugin:
    def test_default_strategies_empty(self, mock_provider_identity) -> None:
        entity = AgentProviderEntityWithPlugin(identity=mock_provider_identity)
        assert entity.strategies == []

    def test_strategies_assignment(self, mock_provider_identity, mock_identity) -> None:
        strategy = AgentStrategyEntity.model_construct(
            identity=mock_identity,
            description=I18nObject(en_US="test"),
            parameters=[],
        )

        entity = AgentProviderEntityWithPlugin(
            identity=mock_provider_identity,
            strategies=[strategy],
        )
        assert entity.strategies == [strategy]

    def test_invalid_strategies_type_raises(self, mock_provider_identity) -> None:
        with pytest.raises(ValidationError):
            AgentProviderEntityWithPlugin(
                identity=mock_provider_identity,
                strategies="invalid",
            )


# =========================================================
# Inheritance Smoke Tests
# =========================================================


class TestInheritanceBehavior:
    def test_agent_strategy_identity_inherits(self) -> None:
        assert issubclass(AgentStrategyIdentity, ToolIdentity)

    def test_agent_strategy_provider_identity_inherits(self) -> None:
        assert issubclass(AgentStrategyProviderIdentity, ToolProviderIdentity)
