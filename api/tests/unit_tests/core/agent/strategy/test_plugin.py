# File: tests/unit_tests/core/agent/strategy/test_plugin.py

from unittest.mock import MagicMock

import pytest

from core.agent.strategy.plugin import PluginAgentStrategy

# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def mock_parameter():
    def _factory(name="param", return_value="initialized"):
        param = MagicMock()
        param.name = name
        param.init_frontend_parameter = MagicMock(return_value=return_value)
        return param

    return _factory


@pytest.fixture
def mock_declaration(mock_parameter):
    param1 = mock_parameter("param1", "init1")
    param2 = mock_parameter("param2", "init2")

    identity = MagicMock()
    identity.provider = "provider_x"
    identity.name = "strategy_x"

    declaration = MagicMock()
    declaration.parameters = [param1, param2]
    declaration.identity = identity

    return declaration


@pytest.fixture
def strategy(mock_declaration):
    return PluginAgentStrategy(
        tenant_id="tenant_123",
        declaration=mock_declaration,
        meta_version="v1",
    )


# ============================================================
# Initialization Tests
# ============================================================


class TestPluginAgentStrategyInitialization:
    def test_init_sets_attributes(self, mock_declaration) -> None:
        strategy = PluginAgentStrategy(
            tenant_id="tenant_test",
            declaration=mock_declaration,
            meta_version="meta_v",
        )

        assert strategy.tenant_id == "tenant_test"
        assert strategy.declaration == mock_declaration
        assert strategy.meta_version == "meta_v"

    def test_init_meta_version_none(self, mock_declaration) -> None:
        strategy = PluginAgentStrategy(
            tenant_id="tenant_test",
            declaration=mock_declaration,
            meta_version=None,
        )

        assert strategy.meta_version is None


# ============================================================
# get_parameters Tests
# ============================================================


class TestGetParameters:
    def test_get_parameters_returns_parameters(self, strategy, mock_declaration) -> None:
        result = strategy.get_parameters()
        assert result == mock_declaration.parameters


# ============================================================
# initialize_parameters Tests
# ============================================================


class TestInitializeParameters:
    def test_initialize_parameters_success(self, strategy, mock_declaration) -> None:
        params = {"param1": "value1"}

        result = strategy.initialize_parameters(params.copy())

        assert result["param1"] == "init1"
        assert result["param2"] == "init2"

        mock_declaration.parameters[0].init_frontend_parameter.assert_called_once_with("value1")
        mock_declaration.parameters[1].init_frontend_parameter.assert_called_once_with(None)

    @pytest.mark.parametrize(
        "input_params",
        [
            {},
            {"param1": None},
            {"param1": ""},
            {"param1": 0},
            {"param1": []},
            {"param1": {}, "param2": "value"},
        ],
    )
    def test_initialize_parameters_edge_cases(self, strategy, input_params) -> None:
        result = strategy.initialize_parameters(input_params.copy())

        for param in strategy.declaration.parameters:
            assert param.name in result

    def test_initialize_parameters_invalid_input_type(self, strategy) -> None:
        with pytest.raises(AttributeError):
            strategy.initialize_parameters(None)


# ============================================================
# _invoke Tests
# ============================================================


class TestInvoke:
    def test_invoke_success_all_arguments(self, strategy, mocker) -> None:
        mock_manager = MagicMock()
        mock_manager.invoke = MagicMock(return_value=iter(["msg1", "msg2"]))

        mocker.patch(
            "core.agent.strategy.plugin.PluginAgentClient",
            return_value=mock_manager,
        )

        mock_convert = mocker.patch(
            "core.agent.strategy.plugin.convert_parameters_to_plugin_format",
            return_value={"converted": True},
        )

        result = list(
            strategy._invoke(
                params={"param1": "value"},
                user_id="user_1",
                conversation_id="conv_1",
                app_id="app_1",
                message_id="msg_1",
                credentials=None,
            )
        )

        assert result == ["msg1", "msg2"]
        mock_convert.assert_called_once()
        mock_manager.invoke.assert_called_once()

        call_kwargs = mock_manager.invoke.call_args.kwargs
        assert call_kwargs["tenant_id"] == "tenant_123"
        assert call_kwargs["user_id"] == "user_1"
        assert call_kwargs["agent_provider"] == "provider_x"
        assert call_kwargs["agent_strategy"] == "strategy_x"
        assert call_kwargs["agent_params"] == {"converted": True}
        assert call_kwargs["conversation_id"] == "conv_1"
        assert call_kwargs["app_id"] == "app_1"
        assert call_kwargs["message_id"] == "msg_1"
        assert call_kwargs["context"] is not None

    def test_invoke_with_credentials(self, strategy, mocker) -> None:
        mock_manager = MagicMock()
        mock_manager.invoke = MagicMock(return_value=iter([]))

        mocker.patch(
            "core.agent.strategy.plugin.PluginAgentClient",
            return_value=mock_manager,
        )

        mocker.patch(
            "core.agent.strategy.plugin.convert_parameters_to_plugin_format",
            return_value={},
        )

        # Patch PluginInvokeContext to bypass pydantic validation
        mock_context = MagicMock()
        mocker.patch(
            "core.agent.strategy.plugin.PluginInvokeContext",
            return_value=mock_context,
        )

        credentials = MagicMock()

        result = list(
            strategy._invoke(
                params={},
                user_id="user_1",
                credentials=credentials,
            )
        )

        assert result == []
        mock_manager.invoke.assert_called_once()

    @pytest.mark.parametrize(
        ("conversation_id", "app_id", "message_id"),
        [
            (None, None, None),
            ("conv", None, None),
            (None, "app", None),
            (None, None, "msg"),
        ],
    )
    def test_invoke_optional_arguments(self, strategy, mocker, conversation_id, app_id, message_id) -> None:
        mock_manager = MagicMock()
        mock_manager.invoke = MagicMock(return_value=iter([]))

        mocker.patch(
            "core.agent.strategy.plugin.PluginAgentClient",
            return_value=mock_manager,
        )

        mocker.patch(
            "core.agent.strategy.plugin.convert_parameters_to_plugin_format",
            return_value={},
        )

        result = list(
            strategy._invoke(
                params={},
                user_id="user_1",
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
            )
        )

        assert result == []
        mock_manager.invoke.assert_called_once()

    def test_invoke_convert_raises_exception(self, strategy, mocker) -> None:
        mocker.patch(
            "core.agent.strategy.plugin.PluginAgentClient",
            return_value=MagicMock(),
        )

        mocker.patch(
            "core.agent.strategy.plugin.convert_parameters_to_plugin_format",
            side_effect=ValueError("conversion failed"),
        )

        with pytest.raises(ValueError):
            list(strategy._invoke(params={}, user_id="user_1"))

    def test_invoke_manager_raises_exception(self, strategy, mocker) -> None:
        mock_manager = MagicMock()
        mock_manager.invoke.side_effect = RuntimeError("invoke failed")

        mocker.patch(
            "core.agent.strategy.plugin.PluginAgentClient",
            return_value=mock_manager,
        )

        mocker.patch(
            "core.agent.strategy.plugin.convert_parameters_to_plugin_format",
            return_value={},
        )

        with pytest.raises(RuntimeError):
            list(strategy._invoke(params={}, user_id="user_1"))
