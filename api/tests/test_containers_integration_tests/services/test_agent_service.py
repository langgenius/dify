import json
from unittest.mock import MagicMock, create_autospec, patch

import pytest
from faker import Faker

from core.plugin.impl.exc import PluginDaemonClientSideError
from models import Account
from models.model import AppModelConfig, Conversation, EndUser, Message, MessageAgentThought
from services.account_service import AccountService, TenantService
from services.agent_service import AgentService
from services.app_service import AppService


class TestAgentService:
    """Integration tests for AgentService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.agent_service.PluginAgentClient") as mock_plugin_agent_client,
            patch("services.agent_service.ToolManager") as mock_tool_manager,
            patch("services.agent_service.AgentConfigManager") as mock_agent_config_manager,
            patch("services.agent_service.current_user", create_autospec(Account, instance=True)) as mock_current_user,
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            # Setup default mock returns for agent service
            mock_plugin_agent_client_instance = mock_plugin_agent_client.return_value
            mock_plugin_agent_client_instance.fetch_agent_strategy_providers.return_value = [
                MagicMock(
                    plugin_id="test_plugin",
                    declaration=MagicMock(
                        identity=MagicMock(name="test_provider"),
                        strategies=[MagicMock(identity=MagicMock(name="test_strategy"))],
                    ),
                )
            ]
            mock_plugin_agent_client_instance.fetch_agent_strategy_provider.return_value = MagicMock(
                plugin_id="test_plugin",
                declaration=MagicMock(
                    identity=MagicMock(name="test_provider"),
                    strategies=[MagicMock(identity=MagicMock(name="test_strategy"))],
                ),
            )

            # Setup ToolManager mocks
            mock_tool_manager.get_tool_icon.return_value = "test_icon"
            mock_tool_manager.get_tool_label.return_value = MagicMock(
                to_dict=lambda: {"en_US": "Test Tool", "zh_Hans": "测试工具"}
            )

            # Setup AgentConfigManager mocks
            mock_agent_config = MagicMock()
            mock_agent_config.tools = [
                MagicMock(tool_name="test_tool", provider_type="test_provider", provider_id="test_id")
            ]
            mock_agent_config_manager.convert.return_value = mock_agent_config

            # Setup current_user mock
            mock_current_user.timezone = "UTC"

            # Setup default mock returns for app service
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None

            # Setup default mock returns for account service
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Mock ModelManager for model configuration
            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

            yield {
                "plugin_agent_client": mock_plugin_agent_client,
                "tool_manager": mock_tool_manager,
                "agent_config_manager": mock_agent_config_manager,
                "current_user": mock_current_user,
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
                "model_manager": mock_model_manager,
                "account_feature_service": mock_account_feature_service,
            }

    def _create_test_app_and_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test app and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (app, account) - Created app and account instances
        """
        fake = Faker()

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app with realistic data
        app_args = {
            "name": fake.company(),
            "description": fake.text(max_nb_chars=100),
            "mode": "agent-chat",
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FF6B6B",
            "api_rph": 100,
            "api_rpm": 10,
        }

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Update the app model config to set agent_mode for agent-chat mode
        if app.mode == "agent-chat" and app.app_model_config:
            app.app_model_config.agent_mode = json.dumps({"enabled": True, "strategy": "react", "tools": []})
            from extensions.ext_database import db

            db.session.commit()

        return app, account

    def _create_test_conversation_and_message(self, db_session_with_containers, app, account):
        """
        Helper method to create a test conversation and message with agent thoughts.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance
            account: Account instance

        Returns:
            tuple: (conversation, message) - Created conversation and message instances
        """
        fake = Faker()

        from extensions.ext_database import db

        # Create conversation
        conversation = Conversation(
            id=fake.uuid4(),
            app_id=app.id,
            from_account_id=account.id,
            from_end_user_id=None,
            name=fake.sentence(),
            inputs={},
            status="normal",
            mode="chat",
            from_source="api",
        )
        db.session.add(conversation)
        db.session.commit()

        # Create app model config
        app_model_config = AppModelConfig(
            app_id=app.id,
            provider="openai",
            model_id="gpt-3.5-turbo",
            configs={},
            model="gpt-3.5-turbo",
            agent_mode=json.dumps({"enabled": True, "strategy": "react", "tools": []}),
        )
        app_model_config.id = fake.uuid4()
        db.session.add(app_model_config)
        db.session.commit()

        # Update conversation with app model config
        conversation.app_model_config_id = app_model_config.id
        db.session.commit()

        # Create message
        message = Message(
            id=fake.uuid4(),
            conversation_id=conversation.id,
            app_id=app.id,
            from_account_id=account.id,
            from_end_user_id=None,
            inputs={},
            query=fake.text(max_nb_chars=100),
            message=[{"role": "user", "text": fake.text(max_nb_chars=100)}],
            answer=fake.text(max_nb_chars=200),
            message_tokens=100,
            message_unit_price=0.001,
            answer_tokens=200,
            answer_unit_price=0.001,
            provider_response_latency=1.5,
            currency="USD",
            from_source="api",
        )
        db.session.add(message)
        db.session.commit()

        return conversation, message

    def _create_test_agent_thoughts(self, db_session_with_containers, message):
        """
        Helper method to create test agent thoughts for a message.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            message: Message instance

        Returns:
            list: Created agent thoughts
        """
        fake = Faker()

        from extensions.ext_database import db

        agent_thoughts = []

        # Create first agent thought
        thought1 = MessageAgentThought(
            message_id=message.id,
            position=1,
            thought="I need to analyze the user's request",
            tool="test_tool",
            tool_labels_str=json.dumps({"test_tool": {"en_US": "Test Tool", "zh_Hans": "测试工具"}}),
            tool_meta_str=json.dumps(
                {
                    "test_tool": {
                        "error": None,
                        "time_cost": 0.5,
                        "tool_config": {"tool_provider_type": "test_provider", "tool_provider": "test_id"},
                        "tool_parameters": {},
                    }
                }
            ),
            tool_input=json.dumps({"test_tool": {"input": "test_input"}}),
            observation=json.dumps({"test_tool": {"output": "test_output"}}),
            tokens=50,
            created_by_role="account",
            created_by=message.from_account_id,
        )
        db.session.add(thought1)
        agent_thoughts.append(thought1)

        # Create second agent thought
        thought2 = MessageAgentThought(
            message_id=message.id,
            position=2,
            thought="Based on the analysis, I can provide a response",
            tool="dataset_tool",
            tool_labels_str=json.dumps({"dataset_tool": {"en_US": "Dataset Tool", "zh_Hans": "数据集工具"}}),
            tool_meta_str=json.dumps(
                {
                    "dataset_tool": {
                        "error": None,
                        "time_cost": 0.3,
                        "tool_config": {"tool_provider_type": "dataset-retrieval", "tool_provider": "dataset_id"},
                        "tool_parameters": {},
                    }
                }
            ),
            tool_input=json.dumps({"dataset_tool": {"query": "test_query"}}),
            observation=json.dumps({"dataset_tool": {"results": "test_results"}}),
            tokens=30,
            created_by_role="account",
            created_by=message.from_account_id,
        )
        db.session.add(thought2)
        agent_thoughts.append(thought2)

        db.session.commit()

        return agent_thoughts

    def test_get_agent_logs_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of agent logs with complete data.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)
        agent_thoughts = self._create_test_agent_thoughts(db_session_with_containers, message)

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result structure
        assert result is not None
        assert "meta" in result
        assert "iterations" in result
        assert "files" in result

        # Verify meta information
        meta = result["meta"]
        assert meta["status"] == "success"
        assert meta["executor"] == account.name
        assert meta["iterations"] == 2
        assert meta["agent_mode"] == "react"
        assert meta["total_tokens"] == 300  # 100 + 200
        assert meta["elapsed_time"] == 1.5

        # Verify iterations
        iterations = result["iterations"]
        assert len(iterations) == 2

        # Verify first iteration
        first_iteration = iterations[0]
        assert first_iteration["tokens"] == 50
        assert first_iteration["thought"] == "I need to analyze the user's request"
        assert len(first_iteration["tool_calls"]) == 1

        tool_call = first_iteration["tool_calls"][0]
        assert tool_call["tool_name"] == "test_tool"
        assert tool_call["tool_label"] == {"en_US": "Test Tool", "zh_Hans": "测试工具"}
        assert tool_call["status"] == "success"
        assert tool_call["time_cost"] == 0.5
        assert tool_call["tool_icon"] == "test_icon"

        # Verify second iteration
        second_iteration = iterations[1]
        assert second_iteration["tokens"] == 30
        assert second_iteration["thought"] == "Based on the analysis, I can provide a response"
        assert len(second_iteration["tool_calls"]) == 1

        dataset_tool_call = second_iteration["tool_calls"][0]
        assert dataset_tool_call["tool_name"] == "dataset_tool"
        assert dataset_tool_call["tool_label"] == {"en_US": "Dataset Tool", "zh_Hans": "数据集工具"}
        assert dataset_tool_call["status"] == "success"
        assert dataset_tool_call["time_cost"] == 0.3
        assert dataset_tool_call["tool_icon"] == ""  # dataset-retrieval tools have empty icon

    def test_get_agent_logs_conversation_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when conversation is not found.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Execute the method under test with non-existent conversation
        with pytest.raises(ValueError, match="Conversation not found"):
            AgentService.get_agent_logs(app, fake.uuid4(), fake.uuid4())

    def test_get_agent_logs_message_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when message is not found.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        # Execute the method under test with non-existent message
        with pytest.raises(ValueError, match="Message not found"):
            AgentService.get_agent_logs(app, str(conversation.id), fake.uuid4())

    def test_get_agent_logs_with_end_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test agent logs retrieval when conversation is from end user.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create end user
        end_user = EndUser(
            id=fake.uuid4(),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="web_app",
            is_anonymous=False,
            session_id=fake.uuid4(),
            name=fake.name(),
        )
        db.session.add(end_user)
        db.session.commit()

        # Create conversation with end user
        conversation = Conversation(
            id=fake.uuid4(),
            app_id=app.id,
            from_account_id=None,
            from_end_user_id=end_user.id,
            name=fake.sentence(),
            inputs={},
            status="normal",
            mode="chat",
            from_source="api",
        )
        db.session.add(conversation)
        db.session.commit()

        # Create app model config
        app_model_config = AppModelConfig(
            app_id=app.id,
            provider="openai",
            model_id="gpt-3.5-turbo",
            configs={},
            model="gpt-3.5-turbo",
            agent_mode=json.dumps({"enabled": True, "strategy": "react", "tools": []}),
        )
        app_model_config.id = fake.uuid4()
        db.session.add(app_model_config)
        db.session.commit()

        # Update conversation with app model config
        conversation.app_model_config_id = app_model_config.id
        db.session.commit()

        # Create message
        message = Message(
            id=fake.uuid4(),
            conversation_id=conversation.id,
            app_id=app.id,
            from_account_id=None,
            from_end_user_id=end_user.id,
            inputs={},
            query=fake.text(max_nb_chars=100),
            message=[{"role": "user", "text": fake.text(max_nb_chars=100)}],
            answer=fake.text(max_nb_chars=200),
            message_tokens=100,
            message_unit_price=0.001,
            answer_tokens=200,
            answer_unit_price=0.001,
            provider_response_latency=1.5,
            currency="USD",
            from_source="api",
        )
        db.session.add(message)
        db.session.commit()

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        assert result["meta"]["executor"] == end_user.name

    def test_get_agent_logs_with_unknown_executor(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test agent logs retrieval when executor is unknown.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create conversation with non-existent account
        conversation = Conversation(
            id=fake.uuid4(),
            app_id=app.id,
            from_account_id=fake.uuid4(),  # Non-existent account
            from_end_user_id=None,
            name=fake.sentence(),
            inputs={},
            status="normal",
            mode="chat",
            from_source="api",
        )
        db.session.add(conversation)
        db.session.commit()

        # Create app model config
        app_model_config = AppModelConfig(
            app_id=app.id,
            provider="openai",
            model_id="gpt-3.5-turbo",
            configs={},
            model="gpt-3.5-turbo",
            agent_mode=json.dumps({"enabled": True, "strategy": "react", "tools": []}),
        )
        app_model_config.id = fake.uuid4()
        db.session.add(app_model_config)
        db.session.commit()

        # Update conversation with app model config
        conversation.app_model_config_id = app_model_config.id
        db.session.commit()

        # Create message
        message = Message(
            id=fake.uuid4(),
            conversation_id=conversation.id,
            app_id=app.id,
            from_account_id=fake.uuid4(),  # Non-existent account
            from_end_user_id=None,
            inputs={},
            query=fake.text(max_nb_chars=100),
            message=[{"role": "user", "text": fake.text(max_nb_chars=100)}],
            answer=fake.text(max_nb_chars=200),
            message_tokens=100,
            message_unit_price=0.001,
            answer_tokens=200,
            answer_unit_price=0.001,
            provider_response_latency=1.5,
            currency="USD",
            from_source="api",
        )
        db.session.add(message)
        db.session.commit()

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        assert result["meta"]["executor"] == "Unknown"

    def test_get_agent_logs_with_tool_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test agent logs retrieval with tool errors.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        from extensions.ext_database import db

        # Create agent thought with tool error
        thought_with_error = MessageAgentThought(
            message_id=message.id,
            position=1,
            thought="I need to analyze the user's request",
            tool="error_tool",
            tool_labels_str=json.dumps({"error_tool": {"en_US": "Error Tool", "zh_Hans": "错误工具"}}),
            tool_meta_str=json.dumps(
                {
                    "error_tool": {
                        "error": "Tool execution failed",
                        "time_cost": 0.5,
                        "tool_config": {"tool_provider_type": "test_provider", "tool_provider": "test_id"},
                        "tool_parameters": {},
                    }
                }
            ),
            tool_input=json.dumps({"error_tool": {"input": "test_input"}}),
            observation=json.dumps({"error_tool": {"output": "error_output"}}),
            tokens=50,
            created_by_role="account",
            created_by=message.from_account_id,
        )
        db.session.add(thought_with_error)
        db.session.commit()

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        iterations = result["iterations"]
        assert len(iterations) == 1

        tool_call = iterations[0]["tool_calls"][0]
        assert tool_call["status"] == "error"
        assert tool_call["error"] == "Tool execution failed"

    def test_get_agent_logs_without_agent_thoughts(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test agent logs retrieval when message has no agent thoughts.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        assert result["meta"]["iterations"] == 0
        assert len(result["iterations"]) == 0

    def test_get_agent_logs_app_model_config_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when app model config is not found.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Remove app model config to test error handling
        app.app_model_config_id = None
        db.session.commit()

        # Create conversation without app model config
        conversation = Conversation(
            id=fake.uuid4(),
            app_id=app.id,
            from_account_id=account.id,
            from_end_user_id=None,
            name=fake.sentence(),
            inputs={},
            status="normal",
            mode="chat",
            from_source="api",
            app_model_config_id=None,  # Explicitly set to None
        )
        db.session.add(conversation)
        db.session.commit()

        # Create message
        message = Message(
            id=fake.uuid4(),
            conversation_id=conversation.id,
            app_id=app.id,
            from_account_id=account.id,
            from_end_user_id=None,
            inputs={},
            query=fake.text(max_nb_chars=100),
            message=[{"role": "user", "text": fake.text(max_nb_chars=100)}],
            answer=fake.text(max_nb_chars=200),
            message_tokens=100,
            message_unit_price=0.001,
            answer_tokens=200,
            answer_unit_price=0.001,
            provider_response_latency=1.5,
            currency="USD",
            from_source="api",
        )
        db.session.add(message)
        db.session.commit()

        # Execute the method under test
        with pytest.raises(ValueError, match="App model config not found"):
            AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

    def test_get_agent_logs_agent_config_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when agent config is not found.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        # Mock AgentConfigManager to return None
        mock_external_service_dependencies["agent_config_manager"].convert.return_value = None

        # Execute the method under test
        with pytest.raises(ValueError, match="Agent config not found"):
            AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

    def test_list_agent_providers_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful listing of agent providers.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Execute the method under test
        result = AgentService.list_agent_providers(str(account.id), str(app.tenant_id))

        # Verify the result
        assert result is not None
        assert len(result) == 1
        assert result[0].plugin_id == "test_plugin"

        # Verify the mock was called correctly
        mock_plugin_client = mock_external_service_dependencies["plugin_agent_client"].return_value
        mock_plugin_client.fetch_agent_strategy_providers.assert_called_once_with(str(app.tenant_id))

    def test_get_agent_provider_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of specific agent provider.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        provider_name = "test_provider"

        # Execute the method under test
        result = AgentService.get_agent_provider(str(account.id), str(app.tenant_id), provider_name)

        # Verify the result
        assert result is not None
        assert result.plugin_id == "test_plugin"

        # Verify the mock was called correctly
        mock_plugin_client = mock_external_service_dependencies["plugin_agent_client"].return_value
        mock_plugin_client.fetch_agent_strategy_provider.assert_called_once_with(str(app.tenant_id), provider_name)

    def test_get_agent_provider_plugin_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when plugin daemon client raises an error.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        provider_name = "test_provider"
        error_message = "Plugin not found"

        # Mock PluginAgentClient to raise an error
        mock_plugin_client = mock_external_service_dependencies["plugin_agent_client"].return_value
        mock_plugin_client.fetch_agent_strategy_provider.side_effect = PluginDaemonClientSideError(error_message)

        # Execute the method under test
        with pytest.raises(ValueError, match=error_message):
            AgentService.get_agent_provider(str(account.id), str(app.tenant_id), provider_name)

    def test_get_agent_logs_with_complex_tool_data(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test agent logs retrieval with complex tool data and multiple tools.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        from extensions.ext_database import db

        # Create agent thought with multiple tools
        complex_thought = MessageAgentThought(
            message_id=message.id,
            position=1,
            thought="I need to use multiple tools to complete this task",
            tool="tool1;tool2;tool3",
            tool_labels_str=json.dumps(
                {
                    "tool1": {"en_US": "First Tool", "zh_Hans": "第一个工具"},
                    "tool2": {"en_US": "Second Tool", "zh_Hans": "第二个工具"},
                    "tool3": {"en_US": "Third Tool", "zh_Hans": "第三个工具"},
                }
            ),
            tool_meta_str=json.dumps(
                {
                    "tool1": {
                        "error": None,
                        "time_cost": 0.5,
                        "tool_config": {"tool_provider_type": "test_provider", "tool_provider": "test_id"},
                        "tool_parameters": {"param1": "value1"},
                    },
                    "tool2": {
                        "error": "Tool 2 failed",
                        "time_cost": 0.3,
                        "tool_config": {"tool_provider_type": "another_provider", "tool_provider": "another_id"},
                        "tool_parameters": {"param2": "value2"},
                    },
                    "tool3": {
                        "error": None,
                        "time_cost": 0.7,
                        "tool_config": {"tool_provider_type": "dataset-retrieval", "tool_provider": "dataset_id"},
                        "tool_parameters": {"param3": "value3"},
                    },
                }
            ),
            tool_input=json.dumps(
                {"tool1": {"input1": "data1"}, "tool2": {"input2": "data2"}, "tool3": {"input3": "data3"}}
            ),
            observation=json.dumps(
                {"tool1": {"output1": "result1"}, "tool2": {"output2": "result2"}, "tool3": {"output3": "result3"}}
            ),
            tokens=100,
            created_by_role="account",
            created_by=message.from_account_id,
        )
        db.session.add(complex_thought)
        db.session.commit()

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        iterations = result["iterations"]
        assert len(iterations) == 1

        tool_calls = iterations[0]["tool_calls"]
        assert len(tool_calls) == 3

        # Verify first tool
        assert tool_calls[0]["tool_name"] == "tool1"
        assert tool_calls[0]["tool_label"] == {"en_US": "First Tool", "zh_Hans": "第一个工具"}
        assert tool_calls[0]["status"] == "success"
        assert tool_calls[0]["tool_parameters"] == {"param1": "value1"}

        # Verify second tool (with error)
        assert tool_calls[1]["tool_name"] == "tool2"
        assert tool_calls[1]["tool_label"] == {"en_US": "Second Tool", "zh_Hans": "第二个工具"}
        assert tool_calls[1]["status"] == "error"
        assert tool_calls[1]["error"] == "Tool 2 failed"

        # Verify third tool (dataset tool)
        assert tool_calls[2]["tool_name"] == "tool3"
        assert tool_calls[2]["tool_label"] == {"en_US": "Third Tool", "zh_Hans": "第三个工具"}
        assert tool_calls[2]["status"] == "success"
        assert tool_calls[2]["tool_icon"] == ""  # dataset-retrieval tools have empty icon

    def test_get_agent_logs_with_files(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test agent logs retrieval with message files and agent thought files.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        from core.file import FileTransferMethod, FileType
        from extensions.ext_database import db
        from models.enums import CreatorUserRole

        # Add files to message
        from models.model import MessageFile

        assert message.from_account_id is not None
        message_file1 = MessageFile(
            message_id=message.id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            url="http://example.com/file1.jpg",
            belongs_to="user",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=message.from_account_id,
        )
        message_file2 = MessageFile(
            message_id=message.id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            url="http://example.com/file2.png",
            belongs_to="user",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=message.from_account_id,
        )
        db.session.add(message_file1)
        db.session.add(message_file2)
        db.session.commit()

        # Create agent thought with files
        thought_with_files = MessageAgentThought(
            message_id=message.id,
            position=1,
            thought="I need to process some files",
            tool="file_tool",
            tool_labels_str=json.dumps({"file_tool": {"en_US": "File Tool", "zh_Hans": "文件工具"}}),
            tool_meta_str=json.dumps(
                {
                    "file_tool": {
                        "error": None,
                        "time_cost": 0.5,
                        "tool_config": {"tool_provider_type": "test_provider", "tool_provider": "test_id"},
                        "tool_parameters": {},
                    }
                }
            ),
            tool_input=json.dumps({"file_tool": {"input": "test_input"}}),
            observation=json.dumps({"file_tool": {"output": "test_output"}}),
            message_files=json.dumps(["file1", "file2"]),
            tokens=50,
            created_by_role="account",
            created_by=message.from_account_id,
        )
        db.session.add(thought_with_files)
        db.session.commit()

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        assert len(result["files"]) == 2

        iterations = result["iterations"]
        assert len(iterations) == 1
        assert len(iterations[0]["files"]) == 2
        assert "file1" in iterations[0]["files"]
        assert "file2" in iterations[0]["files"]

    def test_get_agent_logs_with_different_timezone(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test agent logs retrieval with different timezone settings.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        # Mock current_user with different timezone
        mock_external_service_dependencies["current_user"].timezone = "Asia/Shanghai"

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        assert "start_time" in result["meta"]

        # Verify the timezone conversion
        start_time = result["meta"]["start_time"]
        assert "T" in start_time  # ISO format
        assert "+08:00" in start_time or "Z" in start_time  # Timezone offset

    def test_get_agent_logs_with_empty_tool_data(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test agent logs retrieval with empty tool data.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        from extensions.ext_database import db

        # Create agent thought with empty tool data
        empty_thought = MessageAgentThought(
            message_id=message.id,
            position=1,
            thought="I need to analyze the user's request",
            tool="",  # Empty tool
            tool_labels_str="{}",  # Empty labels
            tool_meta_str="{}",  # Empty meta
            tool_input="",  # Empty input
            observation="",  # Empty observation
            tokens=50,
            created_by_role="account",
            created_by=message.from_account_id,
        )
        db.session.add(empty_thought)
        db.session.commit()

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result
        assert result is not None
        iterations = result["iterations"]
        assert len(iterations) == 1

        # Verify empty tool calls
        tool_calls = iterations[0]["tool_calls"]
        assert len(tool_calls) == 0  # No tools to process

    def test_get_agent_logs_with_malformed_json(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test agent logs retrieval with malformed JSON data in tool fields.
        """
        fake = Faker()

        # Create test data
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        conversation, message = self._create_test_conversation_and_message(db_session_with_containers, app, account)

        from extensions.ext_database import db

        # Create agent thought with malformed JSON
        malformed_thought = MessageAgentThought(
            message_id=message.id,
            position=1,
            thought="I need to analyze the user's request",
            tool="test_tool",
            tool_labels_str="invalid json",  # Malformed JSON
            tool_meta_str="invalid json",  # Malformed JSON
            tool_input="invalid json",  # Malformed JSON
            observation="invalid json",  # Malformed JSON
            tokens=50,
            created_by_role="account",
            created_by=message.from_account_id,
        )
        db.session.add(malformed_thought)
        db.session.commit()

        # Execute the method under test
        result = AgentService.get_agent_logs(app, str(conversation.id), str(message.id))

        # Verify the result - should handle malformed JSON gracefully
        assert result is not None
        iterations = result["iterations"]
        assert len(iterations) == 1

        tool_calls = iterations[0]["tool_calls"]
        assert len(tool_calls) == 1

        # Verify default values for malformed JSON
        tool_call = tool_calls[0]
        assert tool_call["tool_name"] == "test_tool"
        assert tool_call["tool_label"] == "test_tool"  # Default to tool name
        assert tool_call["tool_input"] == {}
        assert tool_call["tool_output"] == "invalid json"  # Raw observation value
        assert tool_call["tool_parameters"] == {}
