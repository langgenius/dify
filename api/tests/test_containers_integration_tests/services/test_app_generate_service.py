import uuid
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.app.entities.app_invoke_entities import InvokeFrom
from enums.cloud_plan import CloudPlan
from models.model import EndUser
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.errors.app import WorkflowIdFormatError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError


class TestAppGenerateService:
    """Integration tests for AppGenerateService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.app_generate_service.BillingService") as mock_billing_service,
            patch("services.app_generate_service.WorkflowService") as mock_workflow_service,
            patch("services.app_generate_service.RateLimit") as mock_rate_limit,
            patch("services.app_generate_service.RateLimiter") as mock_rate_limiter,
            patch("services.app_generate_service.CompletionAppGenerator") as mock_completion_generator,
            patch("services.app_generate_service.ChatAppGenerator") as mock_chat_generator,
            patch("services.app_generate_service.AgentChatAppGenerator") as mock_agent_chat_generator,
            patch("services.app_generate_service.AdvancedChatAppGenerator") as mock_advanced_chat_generator,
            patch("services.app_generate_service.WorkflowAppGenerator") as mock_workflow_generator,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
            patch("services.app_generate_service.dify_config") as mock_dify_config,
        ):
            # Setup default mock returns for billing service
            mock_billing_service.get_info.return_value = {"subscription": {"plan": CloudPlan.SANDBOX}}

            # Setup default mock returns for workflow service
            mock_workflow_service_instance = mock_workflow_service.return_value
            mock_workflow_service_instance.get_published_workflow.return_value = MagicMock(spec=Workflow)
            mock_workflow_service_instance.get_draft_workflow.return_value = MagicMock(spec=Workflow)
            mock_workflow_service_instance.get_published_workflow_by_id.return_value = MagicMock(spec=Workflow)

            # Setup default mock returns for rate limiting
            mock_rate_limit_instance = mock_rate_limit.return_value
            mock_rate_limit_instance.enter.return_value = "test_request_id"
            mock_rate_limit_instance.generate.return_value = ["test_response"]
            mock_rate_limit_instance.exit.return_value = None

            mock_rate_limiter_instance = mock_rate_limiter.return_value
            mock_rate_limiter_instance.is_rate_limited.return_value = False
            mock_rate_limiter_instance.increment_rate_limit.return_value = None

            # Setup default mock returns for app generators
            mock_completion_generator_instance = mock_completion_generator.return_value
            mock_completion_generator_instance.generate.return_value = ["completion_response"]
            mock_completion_generator_instance.generate_more_like_this.return_value = ["more_like_this_response"]
            mock_completion_generator.convert_to_event_stream.return_value = ["completion_stream"]

            mock_chat_generator_instance = mock_chat_generator.return_value
            mock_chat_generator_instance.generate.return_value = ["chat_response"]
            mock_chat_generator.convert_to_event_stream.return_value = ["chat_stream"]

            mock_agent_chat_generator_instance = mock_agent_chat_generator.return_value
            mock_agent_chat_generator_instance.generate.return_value = ["agent_chat_response"]
            mock_agent_chat_generator.convert_to_event_stream.return_value = ["agent_chat_stream"]

            mock_advanced_chat_generator_instance = mock_advanced_chat_generator.return_value
            mock_advanced_chat_generator_instance.generate.return_value = ["advanced_chat_response"]
            mock_advanced_chat_generator_instance.single_iteration_generate.return_value = ["single_iteration_response"]
            mock_advanced_chat_generator_instance.single_loop_generate.return_value = ["single_loop_response"]
            mock_advanced_chat_generator.convert_to_event_stream.return_value = ["advanced_chat_stream"]

            mock_workflow_generator_instance = mock_workflow_generator.return_value
            mock_workflow_generator_instance.generate.return_value = ["workflow_response"]
            mock_workflow_generator_instance.single_iteration_generate.return_value = [
                "workflow_single_iteration_response"
            ]
            mock_workflow_generator_instance.single_loop_generate.return_value = ["workflow_single_loop_response"]
            mock_workflow_generator.convert_to_event_stream.return_value = ["workflow_stream"]

            # Setup default mock returns for account service
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Setup dify_config mock returns
            mock_dify_config.BILLING_ENABLED = False
            mock_dify_config.APP_MAX_ACTIVE_REQUESTS = 100
            mock_dify_config.APP_DAILY_RATE_LIMIT = 1000

            yield {
                "billing_service": mock_billing_service,
                "workflow_service": mock_workflow_service,
                "rate_limit": mock_rate_limit,
                "rate_limiter": mock_rate_limiter,
                "completion_generator": mock_completion_generator,
                "chat_generator": mock_chat_generator,
                "agent_chat_generator": mock_agent_chat_generator,
                "advanced_chat_generator": mock_advanced_chat_generator,
                "workflow_generator": mock_workflow_generator,
                "account_feature_service": mock_account_feature_service,
                "dify_config": mock_dify_config,
            }

    def _create_test_app_and_account(self, db_session_with_containers, mock_external_service_dependencies, mode="chat"):
        """
        Helper method to create a test app and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            mode: App mode to create

        Returns:
            tuple: (app, account) - Created app and account instances
        """
        fake = Faker()

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True

        # Create account and tenant
        from services.account_service import AccountService, TenantService

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
            "mode": mode,
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FF6B6B",
            "api_rph": 100,
            "api_rpm": 10,
            "max_active_requests": 5,
        }

        from services.app_service import AppService

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        return app, account

    def _create_test_workflow(self, db_session_with_containers, app):
        """
        Helper method to create a test workflow for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance

        Returns:
            Workflow: Created workflow instance
        """
        fake = Faker()

        workflow = Workflow(
            id=str(uuid.uuid4()),
            app_id=app.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            type="workflow",
            status="published",
        )

        from extensions.ext_database import db

        db.session.add(workflow)
        db.session.commit()

        return workflow

    def test_generate_completion_mode_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful generation for completion mode app.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify rate limiting was called
        mock_external_service_dependencies["rate_limit"].return_value.enter.assert_called_once()
        mock_external_service_dependencies["rate_limit"].return_value.generate.assert_called_once()

        # Verify completion generator was called
        mock_external_service_dependencies["completion_generator"].return_value.generate.assert_called_once()
        mock_external_service_dependencies["completion_generator"].convert_to_event_stream.assert_called_once()

    def test_generate_chat_mode_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful generation for chat mode app.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="chat"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify chat generator was called
        mock_external_service_dependencies["chat_generator"].return_value.generate.assert_called_once()
        mock_external_service_dependencies["chat_generator"].convert_to_event_stream.assert_called_once()

    def test_generate_agent_chat_mode_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful generation for agent chat mode app.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="agent-chat"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify agent chat generator was called
        mock_external_service_dependencies["agent_chat_generator"].return_value.generate.assert_called_once()
        mock_external_service_dependencies["agent_chat_generator"].convert_to_event_stream.assert_called_once()

    def test_generate_advanced_chat_mode_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful generation for advanced chat mode app.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify advanced chat generator was called
        mock_external_service_dependencies["advanced_chat_generator"].return_value.generate.assert_called_once()
        mock_external_service_dependencies["advanced_chat_generator"].convert_to_event_stream.assert_called_once()

    def test_generate_workflow_mode_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful generation for workflow mode app.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="workflow"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify workflow generator was called
        mock_external_service_dependencies["workflow_generator"].return_value.generate.assert_called_once()
        mock_external_service_dependencies["workflow_generator"].convert_to_event_stream.assert_called_once()

    def test_generate_with_specific_workflow_id(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation with a specific workflow ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        workflow_id = str(uuid.uuid4())

        # Setup test arguments
        args = {
            "inputs": {"query": fake.text(max_nb_chars=50)},
            "workflow_id": workflow_id,
            "response_mode": "streaming",
        }

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify workflow service was called with specific workflow ID
        mock_external_service_dependencies[
            "workflow_service"
        ].return_value.get_published_workflow_by_id.assert_called_once()

    def test_generate_with_debugger_invoke_from(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation with debugger invoke from.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify draft workflow was fetched for debugger
        mock_external_service_dependencies["workflow_service"].return_value.get_draft_workflow.assert_called_once()

    def test_generate_with_non_streaming_mode(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation with non-streaming mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "blocking"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=False
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify rate limit exit was called for non-streaming mode
        mock_external_service_dependencies["rate_limit"].return_value.exit.assert_called_once()

    def test_generate_with_end_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation with EndUser instead of Account.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Create end user
        end_user = EndUser(
            tenant_id=account.current_tenant.id,
            app_id=app.id,
            type="normal",
            external_user_id=fake.uuid4(),
            name=fake.name(),
            is_anonymous=False,
            session_id=fake.uuid4(),
        )

        from extensions.ext_database import db

        db.session.add(end_user)
        db.session.commit()

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=end_user, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

    def test_generate_with_billing_enabled_sandbox_plan(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test generation with billing enabled and sandbox plan.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Setup billing service mock for sandbox plan
        mock_external_service_dependencies["billing_service"].get_info.return_value = {
            "subscription": {"plan": CloudPlan.SANDBOX}
        }

        # Set BILLING_ENABLED to True for this test
        mock_external_service_dependencies["dify_config"].BILLING_ENABLED = True

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify billing service was called
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(app.tenant_id)

    def test_generate_with_rate_limit_exceeded(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation when rate limit is exceeded.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Setup billing service mock for sandbox plan
        mock_external_service_dependencies["billing_service"].get_info.return_value = {
            "subscription": {"plan": CloudPlan.SANDBOX}
        }

        # Set BILLING_ENABLED to True for this test
        mock_external_service_dependencies["dify_config"].BILLING_ENABLED = True

        # Setup system rate limiter to return rate limited
        with patch("services.app_generate_service.AppGenerateService.system_rate_limiter") as mock_system_rate_limiter:
            mock_system_rate_limiter.is_rate_limited.return_value = True

            # Setup test arguments
            args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

            # Execute the method under test and expect rate limit error
            with pytest.raises(InvokeRateLimitError) as exc_info:
                AppGenerateService.generate(
                    app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
                )

            # Verify error message
            assert "Rate limit exceeded" in str(exc_info.value)

    def test_generate_with_invalid_app_mode(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation with invalid app mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="chat"
        )

        # Manually set invalid mode after creation
        app.mode = "invalid_mode"

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test and expect ValueError
        with pytest.raises(ValueError) as exc_info:
            AppGenerateService.generate(
                app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
            )

        # Verify error message
        assert "Invalid app mode" in str(exc_info.value)

    def test_generate_with_workflow_id_format_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test generation with invalid workflow ID format.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Setup test arguments with invalid workflow ID
        args = {
            "inputs": {"query": fake.text(max_nb_chars=50)},
            "workflow_id": "invalid_uuid",
            "response_mode": "streaming",
        }

        # Execute the method under test and expect WorkflowIdFormatError
        with pytest.raises(WorkflowIdFormatError) as exc_info:
            AppGenerateService.generate(
                app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
            )

        # Verify error message
        assert "Invalid workflow_id format" in str(exc_info.value)

    def test_generate_with_workflow_not_found_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test generation when workflow is not found.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        workflow_id = str(uuid.uuid4())

        # Setup workflow service to return None (workflow not found)
        mock_external_service_dependencies[
            "workflow_service"
        ].return_value.get_published_workflow_by_id.return_value = None

        # Setup test arguments
        args = {
            "inputs": {"query": fake.text(max_nb_chars=50)},
            "workflow_id": workflow_id,
            "response_mode": "streaming",
        }

        # Execute the method under test and expect WorkflowNotFoundError
        with pytest.raises(WorkflowNotFoundError) as exc_info:
            AppGenerateService.generate(
                app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
            )

        # Verify error message
        assert f"Workflow not found with id: {workflow_id}" in str(exc_info.value)

    def test_generate_with_workflow_not_initialized_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test generation when workflow is not initialized for debugger.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Setup workflow service to return None (workflow not initialized)
        mock_external_service_dependencies["workflow_service"].return_value.get_draft_workflow.return_value = None

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test and expect ValueError
        with pytest.raises(ValueError) as exc_info:
            AppGenerateService.generate(
                app_model=app, user=account, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=True
            )

        # Verify error message
        assert "Workflow not initialized" in str(exc_info.value)

    def test_generate_with_workflow_not_published_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test generation when workflow is not published for non-debugger.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Setup workflow service to return None (workflow not published)
        mock_external_service_dependencies["workflow_service"].return_value.get_published_workflow.return_value = None

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test and expect ValueError
        with pytest.raises(ValueError) as exc_info:
            AppGenerateService.generate(
                app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
            )

        # Verify error message
        assert "Workflow not published" in str(exc_info.value)

    def test_generate_single_iteration_advanced_chat_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful single iteration generation for advanced chat mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        node_id = fake.uuid4()
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}}

        # Execute the method under test
        result = AppGenerateService.generate_single_iteration(
            app_model=app, user=account, node_id=node_id, args=args, streaming=True
        )

        # Verify the result
        assert result == ["advanced_chat_stream"]

        # Verify advanced chat generator was called
        mock_external_service_dependencies[
            "advanced_chat_generator"
        ].return_value.single_iteration_generate.assert_called_once()

    def test_generate_single_iteration_workflow_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful single iteration generation for workflow mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="workflow"
        )

        node_id = fake.uuid4()
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}}

        # Execute the method under test
        result = AppGenerateService.generate_single_iteration(
            app_model=app, user=account, node_id=node_id, args=args, streaming=True
        )

        # Verify the result
        assert result == ["advanced_chat_stream"]

        # Verify workflow generator was called
        mock_external_service_dependencies[
            "workflow_generator"
        ].return_value.single_iteration_generate.assert_called_once()

    def test_generate_single_iteration_invalid_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test single iteration generation with invalid app mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        node_id = fake.uuid4()
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}}

        # Execute the method under test and expect ValueError
        with pytest.raises(ValueError) as exc_info:
            AppGenerateService.generate_single_iteration(
                app_model=app, user=account, node_id=node_id, args=args, streaming=True
            )

        # Verify error message
        assert "Invalid app mode" in str(exc_info.value)

    def test_generate_single_loop_advanced_chat_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful single loop generation for advanced chat mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        node_id = fake.uuid4()
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}}

        # Execute the method under test
        result = AppGenerateService.generate_single_loop(
            app_model=app, user=account, node_id=node_id, args=args, streaming=True
        )

        # Verify the result
        assert result == ["advanced_chat_stream"]

        # Verify advanced chat generator was called
        mock_external_service_dependencies[
            "advanced_chat_generator"
        ].return_value.single_loop_generate.assert_called_once()

    def test_generate_single_loop_workflow_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful single loop generation for workflow mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="workflow"
        )

        node_id = fake.uuid4()
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}}

        # Execute the method under test
        result = AppGenerateService.generate_single_loop(
            app_model=app, user=account, node_id=node_id, args=args, streaming=True
        )

        # Verify the result
        assert result == ["advanced_chat_stream"]

        # Verify workflow generator was called
        mock_external_service_dependencies["workflow_generator"].return_value.single_loop_generate.assert_called_once()

    def test_generate_single_loop_invalid_mode(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test single loop generation with invalid app mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        node_id = fake.uuid4()
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}}

        # Execute the method under test and expect ValueError
        with pytest.raises(ValueError) as exc_info:
            AppGenerateService.generate_single_loop(
                app_model=app, user=account, node_id=node_id, args=args, streaming=True
            )

        # Verify error message
        assert "Invalid app mode" in str(exc_info.value)

    def test_generate_more_like_this_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful more like this generation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        message_id = fake.uuid4()

        # Execute the method under test
        result = AppGenerateService.generate_more_like_this(
            app_model=app, user=account, message_id=message_id, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["more_like_this_response"]

        # Verify completion generator was called
        mock_external_service_dependencies[
            "completion_generator"
        ].return_value.generate_more_like_this.assert_called_once()

    def test_generate_more_like_this_with_end_user(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test more like this generation with EndUser.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Create end user
        end_user = EndUser(
            tenant_id=account.current_tenant.id,
            app_id=app.id,
            type="normal",
            external_user_id=fake.uuid4(),
            name=fake.name(),
            is_anonymous=False,
            session_id=fake.uuid4(),
        )

        from extensions.ext_database import db

        db.session.add(end_user)
        db.session.commit()

        message_id = fake.uuid4()

        # Execute the method under test
        result = AppGenerateService.generate_more_like_this(
            app_model=app, user=end_user, message_id=message_id, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["more_like_this_response"]

    def test_get_max_active_requests_with_app_limit(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting max active requests with app-specific limit.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Set app-specific limit
        app.max_active_requests = 10

        # Execute the method under test
        result = AppGenerateService._get_max_active_requests(app)

        # Verify the result (should return the smaller value between app limit and config limit)
        assert result == 10

    def test_get_max_active_requests_with_config_limit(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting max active requests with config limit being smaller.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Set app-specific limit higher than config
        app.max_active_requests = 100

        # Execute the method under test
        result = AppGenerateService._get_max_active_requests(app)

        # Verify the result (should return the smaller value)
        # Assuming config limit is smaller than 100
        assert result <= 100

    def test_get_max_active_requests_with_zero_limits(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting max active requests with zero limits (infinite).
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Set app-specific limit to 0 (infinite)
        app.max_active_requests = 0

        # Execute the method under test
        result = AppGenerateService._get_max_active_requests(app)

        # Verify the result (should return config limit when app limit is 0)
        assert result == 100  # dify_config.APP_MAX_ACTIVE_REQUESTS

    def test_generate_with_exception_cleanup(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test that rate limit exit is called when an exception occurs.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Setup completion generator to raise an exception
        mock_external_service_dependencies["completion_generator"].return_value.generate.side_effect = Exception(
            "Test exception"
        )

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test and expect exception
        with pytest.raises(Exception) as exc_info:
            AppGenerateService.generate(
                app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
            )

        # Verify exception message
        assert "Test exception" in str(exc_info.value)

        # Verify rate limit exit was called for cleanup
        mock_external_service_dependencies["rate_limit"].return_value.exit.assert_called_once()

    def test_generate_with_agent_mode_detection(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation with agent mode detection based on app configuration.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="chat"
        )

        # Mock app to have agent mode enabled by setting the mode directly
        app.mode = "agent-chat"

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify agent chat generator was called instead of regular chat generator
        mock_external_service_dependencies["agent_chat_generator"].return_value.generate.assert_called_once()
        mock_external_service_dependencies["agent_chat_generator"].convert_to_event_stream.assert_called_once()

    def test_generate_with_different_invoke_from_values(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test generation with different invoke from values.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Test different invoke from values
        invoke_from_values = [
            InvokeFrom.SERVICE_API,
            InvokeFrom.WEB_APP,
            InvokeFrom.EXPLORE,
            InvokeFrom.DEBUGGER,
        ]

        for invoke_from in invoke_from_values:
            # Setup test arguments
            args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

            # Execute the method under test
            result = AppGenerateService.generate(
                app_model=app, user=account, args=args, invoke_from=invoke_from, streaming=True
            )

            # Verify the result
            assert result == ["test_response"]

    def test_generate_with_complex_args(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test generation with complex arguments including files and external trace ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="workflow"
        )

        # Setup complex test arguments
        args = {
            "inputs": {
                "query": fake.text(max_nb_chars=50),
                "context": fake.text(max_nb_chars=100),
                "parameters": {"temperature": 0.7, "max_tokens": 1000},
            },
            "files": [
                {"id": fake.uuid4(), "name": "test_file.txt", "size": 1024},
                {"id": fake.uuid4(), "name": "test_image.jpg", "size": 2048},
            ],
            "external_trace_id": fake.uuid4(),
            "response_mode": "streaming",
        }

        # Execute the method under test
        result = AppGenerateService.generate(
            app_model=app, user=account, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=True
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify workflow generator was called with complex args
        mock_external_service_dependencies["workflow_generator"].return_value.generate.assert_called_once()
        call_args = mock_external_service_dependencies["workflow_generator"].return_value.generate.call_args
        assert call_args[1]["args"] == args
