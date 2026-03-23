"""
Unit tests for services.agent_service
"""

from collections.abc import Callable
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
import pytz

from core.plugin.impl.exc import PluginDaemonClientSideError
from models import Account
from models.model import App, Conversation, EndUser, Message, MessageAgentThought
from services.agent_service import AgentService


def _make_current_user_account(timezone: str = "UTC") -> Account:
    account = Account(name="Test User", email="test@example.com")
    account.timezone = timezone
    return account


def _make_app_model(app_model_config: MagicMock | None) -> MagicMock:
    app_model = MagicMock(spec=App)
    app_model.id = "app-123"
    app_model.tenant_id = "tenant-123"
    app_model.app_model_config = app_model_config
    return app_model


def _make_conversation(from_end_user_id: str | None, from_account_id: str | None) -> MagicMock:
    conversation = MagicMock(spec=Conversation)
    conversation.id = "conv-123"
    conversation.app_id = "app-123"
    conversation.from_end_user_id = from_end_user_id
    conversation.from_account_id = from_account_id
    return conversation


def _make_message(agent_thoughts: list[MessageAgentThought]) -> MagicMock:
    message = MagicMock(spec=Message)
    message.id = "msg-123"
    message.conversation_id = "conv-123"
    message.created_at = datetime(2024, 1, 1, tzinfo=pytz.UTC)
    message.provider_response_latency = 1.23
    message.answer_tokens = 4
    message.message_tokens = 6
    message.agent_thoughts = agent_thoughts
    message.message_files = ["file-a.txt"]
    return message


def _make_agent_thought() -> MagicMock:
    agent_thought = MagicMock(spec=MessageAgentThought)
    agent_thought.tokens = 3
    agent_thought.tool_input = "raw-input"
    agent_thought.observation = "raw-output"
    agent_thought.thought = "thinking"
    agent_thought.created_at = datetime(2024, 1, 1, tzinfo=pytz.UTC)
    agent_thought.files = []
    agent_thought.tools = ["tool_a", "dataset_tool"]
    agent_thought.tool_labels = {"tool_a": "Tool A"}
    agent_thought.tool_meta = {
        "tool_a": {
            "tool_config": {
                "tool_provider_type": "custom",
                "tool_provider": "provider-1",
            },
            "tool_parameters": {"param": "value"},
            "time_cost": 2.5,
        },
        "dataset_tool": {
            "tool_config": {
                "tool_provider_type": "dataset-retrieval",
                "tool_provider": "dataset-provider",
            }
        },
    }
    agent_thought.tool_inputs_dict = {"tool_a": {"q": "hello"}, "dataset_tool": {"k": "v"}}
    agent_thought.tool_outputs_dict = {"tool_a": {"result": "ok"}}
    return agent_thought


def _build_query_side_effect(
    conversation: Conversation | None,
    message: Message | None,
    executor: EndUser | Account | None,
) -> Callable[..., MagicMock]:
    def _query_side_effect(*args: object, **kwargs: object) -> MagicMock:
        query = MagicMock()
        query.where.return_value = query
        if any(arg is Conversation for arg in args):
            query.first.return_value = conversation
        elif any(arg is Message for arg in args):
            query.first.return_value = message
        elif any(arg is EndUser for arg in args) or any(arg is Account for arg in args):
            query.first.return_value = executor
        return query

    return _query_side_effect


class TestAgentServiceGetAgentLogs:
    """Test suite for AgentService.get_agent_logs."""

    def test_get_agent_logs_should_raise_when_conversation_missing(self) -> None:
        """Test missing conversation raises ValueError."""
        # Arrange
        app_model = _make_app_model(MagicMock())
        with patch("services.agent_service.db") as mock_db:
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError):
                AgentService.get_agent_logs(app_model, "missing-conv", "msg-1")

    def test_get_agent_logs_should_raise_when_message_missing(self) -> None:
        """Test missing message raises ValueError."""
        # Arrange
        app_model = _make_app_model(MagicMock())
        conversation = _make_conversation(from_end_user_id="end-user-1", from_account_id=None)
        with patch("services.agent_service.db") as mock_db:
            conversation_query = MagicMock()
            conversation_query.where.return_value = conversation_query
            conversation_query.first.return_value = conversation

            message_query = MagicMock()
            message_query.where.return_value = message_query
            message_query.first.return_value = None

            mock_db.session.query.side_effect = [conversation_query, message_query]

            # Act & Assert
            with pytest.raises(ValueError):
                AgentService.get_agent_logs(app_model, conversation.id, "missing-msg")

    def test_get_agent_logs_should_raise_when_app_model_config_missing(self) -> None:
        """Test missing app model config raises ValueError."""
        # Arrange
        app_model = _make_app_model(None)
        conversation = _make_conversation(from_end_user_id="end-user-1", from_account_id=None)
        message = _make_message([])
        current_user = _make_current_user_account()

        with patch("services.agent_service.db") as mock_db, patch("services.agent_service.current_user", current_user):
            mock_db.session.query.side_effect = _build_query_side_effect(conversation, message, MagicMock())

            # Act & Assert
            with pytest.raises(ValueError):
                AgentService.get_agent_logs(app_model, conversation.id, message.id)

    def test_get_agent_logs_should_raise_when_agent_config_missing(self) -> None:
        """Test missing agent config raises ValueError."""
        # Arrange
        app_model_config = MagicMock()
        app_model_config.agent_mode_dict = {"strategy": "react"}
        app_model_config.to_dict.return_value = {"tools": []}
        app_model = _make_app_model(app_model_config)
        conversation = _make_conversation(from_end_user_id="end-user-1", from_account_id=None)
        message = _make_message([])
        current_user = _make_current_user_account()

        with (
            patch("services.agent_service.db") as mock_db,
            patch("services.agent_service.AgentConfigManager.convert", return_value=None),
            patch("services.agent_service.current_user", current_user),
        ):
            mock_db.session.query.side_effect = _build_query_side_effect(conversation, message, MagicMock())

            # Act & Assert
            with pytest.raises(ValueError):
                AgentService.get_agent_logs(app_model, conversation.id, message.id)

    def test_get_agent_logs_should_return_logs_for_end_user_executor(self) -> None:
        """Test agent logs returned for end-user executor with tool icons."""
        # Arrange
        agent_thought = _make_agent_thought()
        message = _make_message([agent_thought])
        conversation = _make_conversation(from_end_user_id="end-user-1", from_account_id=None)
        executor = MagicMock(spec=EndUser)
        executor.name = "End User"
        app_model_config = MagicMock()
        app_model_config.agent_mode_dict = {"strategy": "react"}
        app_model_config.to_dict.return_value = {"tools": []}
        app_model = _make_app_model(app_model_config)
        current_user = _make_current_user_account()
        agent_tool = MagicMock()
        agent_tool.tool_name = "tool_a"
        agent_tool.provider_type = "custom"
        agent_tool.provider_id = "provider-2"
        agent_config = MagicMock()
        agent_config.tools = [agent_tool]

        with (
            patch("services.agent_service.db") as mock_db,
            patch("services.agent_service.AgentConfigManager.convert", return_value=agent_config) as mock_convert,
            patch("services.agent_service.ToolManager.get_tool_icon") as mock_get_icon,
            patch("services.agent_service.current_user", current_user),
        ):
            mock_db.session.query.side_effect = _build_query_side_effect(conversation, message, executor)
            mock_get_icon.side_effect = [None, "icon-a"]

            # Act
            result = AgentService.get_agent_logs(app_model, conversation.id, message.id)

            # Assert
            assert result["meta"]["status"] == "success"
            assert result["meta"]["executor"] == "End User"
            assert result["meta"]["total_tokens"] == 10
            assert result["meta"]["agent_mode"] == "react"
            assert result["meta"]["iterations"] == 1
            assert result["files"] == ["file-a.txt"]
            assert len(result["iterations"]) == 1
            tool_calls = result["iterations"][0]["tool_calls"]
            assert tool_calls[0]["tool_name"] == "tool_a"
            assert tool_calls[0]["tool_icon"] == "icon-a"
            assert tool_calls[1]["tool_name"] == "dataset_tool"
            assert tool_calls[1]["tool_icon"] == ""
            mock_convert.assert_called_once()

    def test_get_agent_logs_should_return_account_executor_when_no_end_user(self) -> None:
        """Test agent logs fall back to account executor when end user is missing."""
        # Arrange
        agent_thought = _make_agent_thought()
        message = _make_message([agent_thought])
        conversation = _make_conversation(from_end_user_id=None, from_account_id="account-1")
        executor = MagicMock(spec=Account)
        executor.name = "Account User"
        app_model_config = MagicMock()
        app_model_config.agent_mode_dict = {"strategy": "react"}
        app_model_config.to_dict.return_value = {"tools": []}
        app_model = _make_app_model(app_model_config)
        current_user = _make_current_user_account()
        agent_config = MagicMock()
        agent_config.tools = []

        with (
            patch("services.agent_service.db") as mock_db,
            patch("services.agent_service.AgentConfigManager.convert", return_value=agent_config),
            patch("services.agent_service.ToolManager.get_tool_icon", return_value=""),
            patch("services.agent_service.current_user", current_user),
        ):
            mock_db.session.query.side_effect = _build_query_side_effect(conversation, message, executor)

            # Act
            result = AgentService.get_agent_logs(app_model, conversation.id, message.id)

            # Assert
            assert result["meta"]["executor"] == "Account User"

    def test_get_agent_logs_should_use_defaults_when_executor_and_tool_data_missing(self) -> None:
        """Test unknown executor and missing tool details fall back to defaults."""
        # Arrange
        agent_thought = _make_agent_thought()
        agent_thought.tool_labels = {}
        agent_thought.tool_inputs_dict = {}
        agent_thought.tool_outputs_dict = None
        agent_thought.tool_meta = {"tool_a": {"error": "failed"}}
        agent_thought.tools = ["tool_a"]

        message = _make_message([agent_thought])
        conversation = _make_conversation(from_end_user_id="end-user-1", from_account_id=None)
        app_model_config = MagicMock()
        app_model_config.agent_mode_dict = {}
        app_model_config.to_dict.return_value = {"tools": []}
        app_model = _make_app_model(app_model_config)
        current_user = _make_current_user_account()
        agent_config = MagicMock()
        agent_config.tools = []

        with (
            patch("services.agent_service.db") as mock_db,
            patch("services.agent_service.AgentConfigManager.convert", return_value=agent_config),
            patch("services.agent_service.ToolManager.get_tool_icon", return_value=None),
            patch("services.agent_service.current_user", current_user),
        ):
            mock_db.session.query.side_effect = _build_query_side_effect(conversation, message, None)

            # Act
            result = AgentService.get_agent_logs(app_model, conversation.id, message.id)

            # Assert
            assert result["meta"]["executor"] == "Unknown"
            assert result["meta"]["agent_mode"] == "react"
            tool_call = result["iterations"][0]["tool_calls"][0]
            assert tool_call["status"] == "error"
            assert tool_call["error"] == "failed"
            assert tool_call["tool_label"] == "tool_a"
            assert tool_call["tool_input"] == {}
            assert tool_call["tool_output"] == {}
            assert tool_call["time_cost"] == 0
            assert tool_call["tool_parameters"] == {}
            assert tool_call["tool_icon"] is None


class TestAgentServiceProviders:
    """Test suite for AgentService provider methods."""

    def test_list_agent_providers_should_delegate_to_plugin_client(self) -> None:
        """Test list_agent_providers delegates to PluginAgentClient."""
        # Arrange
        tenant_id = "tenant-1"
        expected = [{"name": "provider"}]
        with patch("services.agent_service.PluginAgentClient") as mock_client:
            mock_client.return_value.fetch_agent_strategy_providers.return_value = expected

            # Act
            result = AgentService.list_agent_providers("user-1", tenant_id)

            # Assert
            assert result == expected
            mock_client.return_value.fetch_agent_strategy_providers.assert_called_once_with(tenant_id)

    def test_get_agent_provider_should_return_provider_when_successful(self) -> None:
        """Test get_agent_provider returns provider when successful."""
        # Arrange
        tenant_id = "tenant-1"
        provider_name = "provider-a"
        expected = {"name": provider_name}
        with patch("services.agent_service.PluginAgentClient") as mock_client:
            mock_client.return_value.fetch_agent_strategy_provider.return_value = expected

            # Act
            result = AgentService.get_agent_provider("user-1", tenant_id, provider_name)

            # Assert
            assert result == expected
            mock_client.return_value.fetch_agent_strategy_provider.assert_called_once_with(tenant_id, provider_name)

    def test_get_agent_provider_should_raise_value_error_on_plugin_error(self) -> None:
        """Test get_agent_provider wraps PluginDaemonClientSideError into ValueError."""
        # Arrange
        tenant_id = "tenant-1"
        provider_name = "provider-a"
        with patch("services.agent_service.PluginAgentClient") as mock_client:
            mock_client.return_value.fetch_agent_strategy_provider.side_effect = PluginDaemonClientSideError(
                "plugin error"
            )

            # Act & Assert
            with pytest.raises(ValueError):
                AgentService.get_agent_provider("user-1", tenant_id, provider_name)
