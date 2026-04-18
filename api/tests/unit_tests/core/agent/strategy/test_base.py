from collections.abc import Generator
from unittest.mock import MagicMock

import pytest

from core.agent.strategy.base import BaseAgentStrategy


class DummyStrategy(BaseAgentStrategy):
    """
    Concrete implementation for testing BaseAgentStrategy
    """

    def __init__(self, return_values=None, raise_exception=None):
        self.return_values = return_values or []
        self.raise_exception = raise_exception
        self.received_args = None

    def _invoke(
        self,
        params,
        user_id,
        conversation_id=None,
        app_id=None,
        message_id=None,
        credentials=None,
    ) -> Generator:
        self.received_args = (
            params,
            user_id,
            conversation_id,
            app_id,
            message_id,
            credentials,
        )

        if self.raise_exception:
            raise self.raise_exception

        yield from self.return_values


class TestBaseAgentStrategyInstantiation:
    def test_cannot_instantiate_abstract_class(self) -> None:
        with pytest.raises(TypeError):
            BaseAgentStrategy()


class TestBaseAgentStrategyInvoke:
    @pytest.fixture
    def mock_message(self):
        return MagicMock(name="AgentInvokeMessage")

    @pytest.fixture
    def mock_credentials(self):
        return MagicMock(name="InvokeCredentials")

    @pytest.mark.parametrize(
        ("params", "user_id", "conversation_id", "app_id", "message_id"),
        [
            ({"key": "value"}, "user1", "conv1", "app1", "msg1"),
            ({}, "user2", None, None, None),
            ({"a": 1}, "", "", "", ""),
            ({"nested": {"x": 1}}, "user3", None, "app3", None),
        ],
    )
    def test_invoke_success(
        self,
        mock_message,
        mock_credentials,
        params,
        user_id,
        conversation_id,
        app_id,
        message_id,
    ) -> None:
        # Arrange
        strategy = DummyStrategy(return_values=[mock_message])

        # Act
        result = list(
            strategy.invoke(
                params=params,
                user_id=user_id,
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
                credentials=mock_credentials,
            )
        )

        # Assert
        assert result == [mock_message]
        assert strategy.received_args == (
            params,
            user_id,
            conversation_id,
            app_id,
            message_id,
            mock_credentials,
        )

    def test_invoke_multiple_yields(self, mock_message) -> None:
        # Arrange
        messages = [mock_message, MagicMock(), MagicMock()]
        strategy = DummyStrategy(return_values=messages)

        # Act
        result = list(strategy.invoke(params={}, user_id="user"))

        # Assert
        assert result == messages

    def test_invoke_empty_generator(self) -> None:
        # Arrange
        strategy = DummyStrategy(return_values=[])

        # Act
        result = list(strategy.invoke(params={}, user_id="user"))

        # Assert
        assert result == []

    def test_invoke_propagates_exception(self) -> None:
        # Arrange
        strategy = DummyStrategy(raise_exception=ValueError("failure"))

        # Act & Assert
        with pytest.raises(ValueError, match="failure"):
            list(strategy.invoke(params={}, user_id="user"))

    @pytest.mark.parametrize(
        "invalid_params",
        [
            None,
            "",
            123,
            [],
        ],
    )
    def test_invoke_invalid_params_type_pass_through(self, invalid_params) -> None:
        """
        Base class does not validate types — ensure pass-through behavior
        """
        strategy = DummyStrategy(return_values=[])

        result = list(strategy.invoke(params=invalid_params, user_id="user"))

        assert result == []

    def test_invoke_none_user_id(self) -> None:
        strategy = DummyStrategy(return_values=[])

        result = list(strategy.invoke(params={}, user_id=None))

        assert result == []


class TestBaseAgentStrategyGetParameters:
    def test_get_parameters_default_empty_list(self) -> None:
        strategy = DummyStrategy()
        result = strategy.get_parameters()

        assert isinstance(result, list)
        assert result == []

    def test_get_parameters_returns_new_list_each_time(self) -> None:
        strategy = DummyStrategy()

        first = strategy.get_parameters()
        second = strategy.get_parameters()

        assert first == second == []
        assert first is not second
