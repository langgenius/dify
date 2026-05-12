import threading
from datetime import UTC, datetime
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
import pytz

from core.agent.entities import AgentEntity
from core.plugin.impl.agent import PluginAgentClient
from core.plugin.impl.exc import PluginDaemonClientSideError
from models import Account, App, Conversation, EndUser, Message, MessageAgentThought
from models.model import AppModelConfig
from services.agent_service import AgentService

TEST_TENANT_ID = "test_tenant_123"
TEST_APP_ID = "test_app_456"
TEST_CONVERSATION_ID = "test_conv_789"
TEST_MESSAGE_ID = "test_msg_001"
TEST_END_USER_ID = "test_end_user_002"
TEST_ACCOUNT_ID = "test_account_003"
TEST_USER_ID = "test_user_004"
TEST_TIMEZONE = "UTC"
TEST_PROVIDER_NAME = "test-strategy-provider"
TEST_TOOL_NAME = "test-tool"
TEST_DATASET_TOOL_NAME = "dataset-tool"


class TestAgentServiceFactory:
    """Factory for creating test model mocks."""

    @staticmethod
    def create_app_mock() -> MagicMock:
        """Create a mock App model instance."""
        app = MagicMock(spec=App)
        app.tenant_id = TEST_TENANT_ID
        app.id = TEST_APP_ID
        app.app_model_config = MagicMock(spec=AppModelConfig)
        app.app_model_config.agent_mode_dict = {"strategy": "react"}
        app.app_model_config.to_dict.return_value = {"tools": []}
        return app

    @staticmethod
    def create_account_mock() -> MagicMock:
        """Create a mock Account model instance."""
        account = MagicMock(spec=Account)
        account.id = TEST_ACCOUNT_ID
        account.name = "Test Admin"
        account.timezone = TEST_TIMEZONE
        return account

    @staticmethod
    def create_end_user_mock() -> MagicMock:
        """Create a mock EndUser model instance."""
        user = MagicMock(spec=EndUser)
        user.id = TEST_END_USER_ID
        user.name = "Test End User"
        return user

    @staticmethod
    def create_conversation_mock(from_end_user: bool = False) -> MagicMock:
        """Create a mock Conversation model instance."""
        conv = MagicMock(spec=Conversation)
        conv.id = TEST_CONVERSATION_ID
        conv.app_id = TEST_APP_ID
        if from_end_user:
            conv.from_end_user_id = TEST_END_USER_ID
            conv.from_account_id = None
        else:
            conv.from_end_user_id = None
            conv.from_account_id = TEST_ACCOUNT_ID
        return conv

    @staticmethod
    def create_agent_thought_mock() -> MagicMock:
        """Create a mock MessageAgentThought model instance with tool data."""
        thought = MagicMock(spec=MessageAgentThought)
        thought.tools = [TEST_TOOL_NAME, TEST_DATASET_TOOL_NAME]
        thought.tool_labels = {TEST_TOOL_NAME: "Test Tool Label", TEST_DATASET_TOOL_NAME: "Dataset Tool"}
        thought.tool_meta = {
            TEST_TOOL_NAME: {
                "error": None,
                "time_cost": 1.2,
                "tool_config": {"tool_provider_type": "plugin", "tool_provider": "test-provider"},
                "tool_parameters": {"param": "value"},
            },
            TEST_DATASET_TOOL_NAME: {
                "error": "test error",
                "time_cost": 0.5,
                "tool_config": {"tool_provider_type": "dataset-retrieval"},
            },
        }
        thought.tool_inputs_dict = {TEST_TOOL_NAME: {"input": "test"}, TEST_DATASET_TOOL_NAME: {"query": "test"}}
        thought.tool_outputs_dict = {TEST_TOOL_NAME: {"output": "result"}, TEST_DATASET_TOOL_NAME: {}}
        thought.tokens = 100
        thought.thought = "Test reasoning thought"
        thought.created_at = datetime.now(UTC)
        thought.files = []
        thought.tool_input = '{"tool": "test"}'
        thought.observation = '{"result": "test"}'
        return thought

    @staticmethod
    def create_message_mock(agent_thoughts: list | None = None) -> MagicMock:
        """Create a mock Message model instance."""
        msg = MagicMock(spec=Message)
        msg.id = TEST_MESSAGE_ID
        msg.conversation_id = TEST_CONVERSATION_ID
        msg.agent_thoughts = agent_thoughts or []
        msg.created_at = datetime.now(UTC)
        msg.provider_response_latency = 2.5
        msg.answer_tokens = 50
        msg.message_tokens = 150
        msg.message_files = []
        return msg

    @staticmethod
    def create_current_user_mock() -> MagicMock:
        """Create a mock current user Account with timezone property mock."""
        current_user = MagicMock(spec=Account)
        type(current_user).timezone = PropertyMock(return_value=TEST_TIMEZONE)
        return current_user

    @staticmethod
    def create_agent_config_mock(tools: list | None = None) -> MagicMock:
        """Create a mock AgentConfig instance with configurable tools."""
        agent_config = MagicMock(spec=AgentEntity)
        agent_config.tools = tools or []
        return agent_config

    @staticmethod
    def create_plugin_agent_client_mock(
        strategy_providers: list | None = None, single_provider: dict | None = None, error: Exception | None = None
    ) -> MagicMock:
        """Create a mock PluginAgentClient with configurable return values/errors."""
        client = MagicMock(spec=PluginAgentClient)
        if strategy_providers is not None:
            client.fetch_agent_strategy_providers.return_value = strategy_providers
        if single_provider is not None:
            client.fetch_agent_strategy_provider.return_value = single_provider
        if error is not None:
            client.fetch_agent_strategy_provider.side_effect = error
        return client

    @staticmethod
    def create_tool_config_mock(tool_name: str | None = None) -> MagicMock:
        """Create a mock tool config with tool_name attribute."""
        tool_config = MagicMock()
        tool_config.tool_name = tool_name
        return tool_config


class TestAgentService:
    """
    Unit tests for AgentService.

    This test suite covers:
    - Get agent logs when conversation or message is not found
    - Get agent logs with conversations created by end users vs account users
    - Get agent logs when app model config or agent config is missing
    - Full flow of get_agent_logs with agent thoughts and tool calls
    - List agent providers successfully
    - Get specific agent provider successfully
    - Handle errors when fetching agent provider from plugin client
    """

    @pytest.fixture
    def factory(self):
        return TestAgentServiceFactory()

    @patch("services.agent_service.db.session")
    def test_get_agent_logs_conversation_not_found(self, mock_db_session, factory):
        """Test get_agent_logs raises ValueError when conversation does not exist."""
        # Arrange
        app = factory.create_app_mock()
        mock_db_session.scalar.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match=f"Conversation not found: {TEST_CONVERSATION_ID}"):
            AgentService.get_agent_logs(app, TEST_CONVERSATION_ID, TEST_MESSAGE_ID)

    @patch("services.agent_service.db.session")
    def test_get_agent_logs_message_not_found(self, mock_db_session, factory):
        """Test get_agent_logs raises ValueError when message does not exist."""
        # Arrange
        app = factory.create_app_mock()
        conv = factory.create_conversation_mock()
        mock_db_session.scalar.side_effect = [conv, None]

        # Act & Assert
        with pytest.raises(ValueError, match=f"Message not found: {TEST_MESSAGE_ID}"):
            AgentService.get_agent_logs(app, TEST_CONVERSATION_ID, TEST_MESSAGE_ID)

    @patch("services.agent_service.AgentConfigManager.convert")
    @patch("services.agent_service.current_user")
    @patch("services.agent_service.pytz.timezone")
    @patch("services.agent_service.db.session")
    def test_get_agent_logs_from_end_user(self, mock_db_session, mock_tz, mock_current_user, mock_convert, factory):
        """Test get_agent_logs with conversation created by end user."""
        # Arrange
        app = factory.create_app_mock()
        conv = factory.create_conversation_mock(from_end_user=True)
        msg = factory.create_message_mock()
        end_user = factory.create_end_user_mock()
        mock_tz.return_value = pytz.UTC
        mock_db_session.scalar.side_effect = [conv, msg, end_user.name]
        mock_current_user = factory.create_current_user_mock()
        mock_agent_config = factory.create_agent_config_mock()
        mock_convert.return_value = mock_agent_config

        # Act
        with patch("services.agent_service.current_user", mock_current_user):
            result = AgentService.get_agent_logs(app, TEST_CONVERSATION_ID, TEST_MESSAGE_ID)

        # Assert
        assert result["meta"]["executor"] == end_user.name
        assert result["meta"]["status"] == "success"

    @patch("services.agent_service.AgentConfigManager.convert")
    @patch("services.agent_service.current_user")
    @patch("services.agent_service.pytz.timezone")
    @patch("services.agent_service.db.session")
    def test_get_agent_logs_from_account(self, mock_db_session, mock_tz, mock_current_user, mock_convert, factory):
        """Test get_agent_logs with conversation created by account user."""
        # Arrange
        app = factory.create_app_mock()
        conv = factory.create_conversation_mock(from_end_user=False)
        msg = factory.create_message_mock()
        account = factory.create_account_mock()
        mock_tz.return_value = pytz.UTC
        mock_db_session.scalar.side_effect = [conv, msg, account.name]
        mock_current_user = factory.create_current_user_mock()
        mock_agent_config = factory.create_agent_config_mock()
        mock_convert.return_value = mock_agent_config

        # Act
        with patch("services.agent_service.current_user", mock_current_user):
            result = AgentService.get_agent_logs(app, TEST_CONVERSATION_ID, TEST_MESSAGE_ID)

        # Assert
        assert result["meta"]["executor"] == account.name

    @patch("services.agent_service.db.session")
    @patch("services.agent_service.current_user")
    @patch("services.agent_service.pytz.timezone")
    def test_get_agent_logs_app_config_not_found(self, mock_tz, mock_current_user, mock_db_session, factory):
        """Test get_agent_logs raises ValueError when app model config is missing."""
        # Arrange
        app = factory.create_app_mock()
        app.app_model_config = None
        conv = factory.create_conversation_mock()
        msg = factory.create_message_mock()
        mock_db_session.scalar.side_effect = [conv, msg, "Unknown"]
        mock_tz.return_value = pytz.UTC
        mock_current_user = factory.create_current_user_mock()

        # Act & Assert
        with patch("services.agent_service.current_user", mock_current_user):
            with pytest.raises(ValueError, match="App model config not found"):
                AgentService.get_agent_logs(app, TEST_CONVERSATION_ID, TEST_MESSAGE_ID)

    @patch("services.agent_service.AgentConfigManager.convert")
    @patch("services.agent_service.current_user")
    @patch("services.agent_service.pytz.timezone")
    @patch("services.agent_service.db.session")
    def test_get_agent_logs_agent_config_not_found(
        self, mock_db_session, mock_tz, mock_current_user, mock_convert, factory
    ):
        """Test get_agent_logs raises ValueError when agent config is missing."""
        # Arrange
        app = factory.create_app_mock()
        conv = factory.create_conversation_mock()
        msg = factory.create_message_mock()
        mock_tz.return_value = pytz.UTC
        mock_db_session.scalar.side_effect = [conv, msg, "Unknown"]
        mock_current_user = factory.create_current_user_mock()
        mock_convert.return_value = None

        # Act & Assert
        with patch("services.agent_service.current_user", mock_current_user):
            with pytest.raises(ValueError, match="Agent config not found"):
                AgentService.get_agent_logs(app, TEST_CONVERSATION_ID, TEST_MESSAGE_ID)

    @pytest.mark.parametrize(
        ("icon_value", "tool_name"),
        [
            ("https://test-icon.com/icon.png", TEST_TOOL_NAME),
            (None, TEST_TOOL_NAME),
            (None, "wrong-tool"),
            (None, None),
        ],
    )
    @patch("services.agent_service.ToolManager.get_tool_icon")
    @patch("services.agent_service.AgentConfigManager.convert")
    @patch("services.agent_service.current_user")
    @patch("services.agent_service.pytz.timezone")
    @patch("services.agent_service.contexts")
    @patch("services.agent_service.db.session")
    def test_get_agent_logs_full_flow1(
        self,
        mock_db_session,
        mock_context,
        mock_tz,
        mock_current_user,
        mock_convert,
        mock_tool_icon,
        factory,
        icon_value,
        tool_name,
    ):
        """Test get_agent_logs full flow with agent thoughts and tool calls."""
        # Arrange
        mock_context.plugin_tool_providers.set = MagicMock()
        mock_context.plugin_tool_providers_lock.set = MagicMock(return_value=threading.Lock())
        app = factory.create_app_mock()
        conv = factory.create_conversation_mock()
        thought = factory.create_agent_thought_mock()
        msg = factory.create_message_mock(agent_thoughts=[thought])
        account = factory.create_account_mock()
        mock_tz.return_value = pytz.UTC
        mock_db_session.scalar.side_effect = [conv, msg, account.name]
        mock_current_user = factory.create_current_user_mock()
        mock_agent_config = factory.create_agent_config_mock(
            tools=[factory.create_tool_config_mock(tool_name=tool_name)]
        )
        mock_convert.return_value = mock_agent_config
        mock_tool_icon.return_value = icon_value

        # Act
        with patch("services.agent_service.current_user", mock_current_user):
            result = AgentService.get_agent_logs(app, TEST_CONVERSATION_ID, TEST_MESSAGE_ID)

        # Assert
        assert result["meta"]["iterations"] == 1
        assert len(result["iterations"]) == 1
        assert len(result["iterations"][0]["tool_calls"]) == 2
        assert result["iterations"][0]["tool_calls"][0]["status"] == "success"
        assert result["iterations"][0]["tool_calls"][1]["status"] == "error"
        assert result["iterations"][0]["tool_calls"][1]["tool_icon"] == ""
        assert mock_context.plugin_tool_providers.set.called

    @patch("services.agent_service.PluginAgentClient")
    def test_list_agent_providers_success(self, mock_plugin_client, factory):
        """Test list_agent_providers returns strategy providers successfully."""
        # Arrange
        mock_providers = [{"name": "provider1"}, {"name": "provider2"}]
        mock_manager = factory.create_plugin_agent_client_mock(strategy_providers=mock_providers)
        mock_plugin_client.return_value = mock_manager

        # Act
        result = AgentService.list_agent_providers(TEST_USER_ID, TEST_TENANT_ID)
        # Assert
        assert result == mock_providers

    @patch("services.agent_service.PluginAgentClient")
    def test_get_agent_provider_success(self, mock_plugin_client, factory):
        """Test get_agent_provider returns specific provider successfully."""
        # Arrange
        mock_provider = {"name": TEST_PROVIDER_NAME, "type": "strategy"}
        mock_manager = factory.create_plugin_agent_client_mock(single_provider=mock_provider)
        mock_plugin_client.return_value = mock_manager

        # Act
        result = AgentService.get_agent_provider(TEST_USER_ID, TEST_TENANT_ID, TEST_PROVIDER_NAME)

        # Assert
        assert result == mock_provider

    @patch("services.agent_service.PluginAgentClient")
    def test_get_agent_provider_client_error(self, mock_plugin_client, factory):
        """Test get_agent_provider raises ValueError on PluginDaemonClientSideError."""
        # Arrange
        error_msg = "Client connection failed"
        error = PluginDaemonClientSideError(error_msg)
        mock_manager = factory.create_plugin_agent_client_mock(error=error)
        mock_plugin_client.return_value = mock_manager

        # Act & Assert
        with pytest.raises(ValueError, match=error_msg) as exc_info:
            AgentService.get_agent_provider(TEST_USER_ID, TEST_TENANT_ID, TEST_PROVIDER_NAME)

        assert isinstance(exc_info.value.__cause__, PluginDaemonClientSideError)
