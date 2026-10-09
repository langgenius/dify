from __future__ import annotations

import json
import uuid
from collections.abc import Generator
from typing import TYPE_CHECKING, Literal
from unittest.mock import ANY, MagicMock, patch

import pytest
import sqlalchemy as sa
from faker import Faker
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from enums import DeploymentEdition
from models import App
from models.enums import EndUserType
from models.model import EndUser
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.errors.app import WorkflowIdFormatError, WorkflowNotFoundError
from services.workflow.variable_contracts import WorkflowExecutionVariables
from tests.test_containers_integration_tests.helpers import generate_valid_password

if TYPE_CHECKING:
    from extensions.application_services.workflow import WorkflowExecutionDependencies


@pytest.fixture
def workflow_runtime(db_session_with_containers: Session) -> WorkflowExecutionDependencies:
    from extensions.application_services.workflow import build_workflow_execution_dependencies

    return build_workflow_execution_dependencies(
        sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    )


class TestAppGenerateService:
    """Integration tests for AppGenerateService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self) -> Generator[dict[str, MagicMock], None, None]:
        """Mock setup for external service dependencies."""
        with (
            patch("services.billing_service.BillingService", autospec=True) as mock_billing_service,
            patch(
                "repositories.workflow.definition_repository.WorkflowDefinitionStore.get_draft_workflow", autospec=True
            ) as mock_draft_workflow,
            patch(
                "repositories.workflow.definition_repository.WorkflowDefinitionStore.get_published_workflow",
                autospec=True,
            ) as mock_published_workflow,
            patch(
                "repositories.workflow.definition_repository.WorkflowDefinitionStore.get_published_workflow_by_id",
                autospec=True,
            ) as mock_workflow_by_id,
            patch("services.app_generate_service.RateLimit", autospec=True) as mock_rate_limit,
            patch("services.app_generate_service.CompletionAppGenerator", autospec=True) as mock_completion_generator,
            patch("services.app_generate_service.ChatAppGenerator", autospec=True) as mock_chat_generator,
            patch("services.app_generate_service.AgentChatAppGenerator", autospec=True) as mock_agent_chat_generator,
            patch(
                "services.app_generate_service.AdvancedChatAppGenerator", autospec=True
            ) as mock_advanced_chat_generator,
            patch("services.app_generate_service.WorkflowAppGenerator", autospec=True) as mock_workflow_generator,
            patch("services.app_generate_service.convert_to_event_stream", autospec=True) as mock_event_stream,
            patch(
                "services.app_generate_service.WorkflowEventStream.retrieve_events", autospec=True
            ) as mock_retrieve_events,
            patch(
                "services.account.login_adapters.SystemFeatureService", autospec=True
            ) as mock_account_feature_service,
            patch("services.app_generate_service.dify_config") as mock_dify_config,
            patch("services.quota_service.dify_config") as mock_quota_dify_config,
            patch("configs.dify_config") as mock_global_dify_config,
        ):
            # Setup default mock returns for billing service
            mock_billing_service.quota_reserve.return_value = {
                "reservation_id": "test-reservation-id",
                "available": 100,
                "reserved": 1,
            }
            mock_billing_service.quota_commit.return_value = {
                "available": 99,
                "reserved": 0,
                "refunded": 0,
            }

            # Supply persisted workflow reads while keeping execution selection intact.
            graph = json.dumps(
                {
                    "nodes": [
                        {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                        {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
                    ],
                    "edges": [{"source": "start", "target": "end"}],
                }
            )
            published_workflow = Workflow(id=str(uuid.uuid4()), version="1", graph=graph)
            mock_published_workflow.return_value = published_workflow
            draft_workflow = Workflow(id=str(uuid.uuid4()), version="draft", graph=graph)
            mock_draft_workflow.return_value = draft_workflow
            mock_workflow_by_id.return_value = published_workflow

            # Setup default mock returns for rate limiting
            mock_rate_limit_instance = mock_rate_limit.return_value
            mock_rate_limit_instance.enter.return_value = "test_request_id"
            mock_rate_limit_instance.generate.return_value = ["test_response"]
            mock_rate_limit_instance.exit.return_value = None

            # Setup default mock returns for app generators
            mock_completion_generator_instance = mock_completion_generator.return_value
            mock_completion_generator_instance.generate.return_value = ["completion_response"]
            mock_completion_generator_instance.generate_more_like_this.return_value = ["more_like_this_response"]

            mock_chat_generator_instance = mock_chat_generator.return_value
            mock_chat_generator_instance.generate.return_value = ["chat_response"]

            mock_agent_chat_generator_instance = mock_agent_chat_generator.return_value
            mock_agent_chat_generator_instance.generate.return_value = ["agent_chat_response"]

            mock_advanced_chat_generator_instance = mock_advanced_chat_generator.return_value
            mock_advanced_chat_generator_instance.generate.return_value = ["advanced_chat_response"]
            mock_advanced_chat_generator_instance.single_iteration_generate.return_value = ["single_iteration_response"]
            mock_advanced_chat_generator_instance.single_loop_generate.return_value = ["single_loop_response"]

            mock_workflow_generator_instance = mock_workflow_generator.return_value
            mock_workflow_generator_instance.generate.return_value = ["workflow_response"]
            mock_workflow_generator_instance.single_iteration_generate.return_value = [
                "workflow_single_iteration_response"
            ]
            mock_workflow_generator_instance.single_loop_generate.return_value = ["workflow_single_loop_response"]
            mock_event_stream.side_effect = lambda events: events
            mock_retrieve_events.return_value = ["workflow_events"]

            # Setup default mock returns for account service
            mock_account_feature_service.is_registration_allowed.return_value = True

            # Setup dify_config mock returns
            mock_dify_config.DEPLOYMENT_EDITION = DeploymentEdition.COMMUNITY
            mock_dify_config.APP_MAX_ACTIVE_REQUESTS = 100
            mock_dify_config.APP_DEFAULT_ACTIVE_REQUESTS = 100
            mock_dify_config.APP_DAILY_RATE_LIMIT = 1000

            mock_quota_dify_config.DEPLOYMENT_EDITION = DeploymentEdition.COMMUNITY

            mock_global_dify_config.DEPLOYMENT_EDITION = DeploymentEdition.COMMUNITY
            mock_global_dify_config.APP_MAX_ACTIVE_REQUESTS = 100
            mock_global_dify_config.APP_DAILY_RATE_LIMIT = 1000
            mock_global_dify_config.HOSTED_POOL_CREDITS = 1000

            yield {
                "billing_service": mock_billing_service,
                "get_draft_workflow": mock_draft_workflow,
                "get_published_workflow": mock_published_workflow,
                "get_published_workflow_by_id": mock_workflow_by_id,
                "rate_limit": mock_rate_limit,
                "completion_generator": mock_completion_generator,
                "chat_generator": mock_chat_generator,
                "agent_chat_generator": mock_agent_chat_generator,
                "advanced_chat_generator": mock_advanced_chat_generator,
                "workflow_generator": mock_workflow_generator,
                "event_stream": mock_event_stream,
                "retrieve_events": mock_retrieve_events,
                "account_feature_service": mock_account_feature_service,
                "dify_config": mock_dify_config,
                "quota_dify_config": mock_quota_dify_config,
                "global_dify_config": mock_global_dify_config,
            }

    def _create_test_app_and_account(
        self,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        mode: Literal["chat", "agent-chat", "advanced-chat", "workflow", "completion"] = "chat",
    ):
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
        mock_external_service_dependencies["account_feature_service"].is_registration_allowed.return_value = True

        # Create account and tenant
        from tests.test_containers_integration_tests.helpers import accounts as account_fixtures

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        from services.app_service import AppService, CreateAppParams

        # Create app with realistic data
        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode=mode,
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            api_rph=100,
            api_rpm=10,
            max_active_requests=5,
        )

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account, session=db_session_with_containers)

        return app, account

    def _create_test_workflow(self, db_session_with_containers: Session, app: App):
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

        db_session_with_containers.add(workflow)
        db_session_with_containers.commit()

        return workflow

    def test_generate_completion_mode_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify rate limiting was called
        mock_external_service_dependencies["rate_limit"].return_value.enter.assert_called_once()
        mock_external_service_dependencies["rate_limit"].return_value.generate.assert_called_once()

        # Verify completion generator was called
        generator = mock_external_service_dependencies["completion_generator"].return_value
        generator.generate.assert_called_once()
        mock_external_service_dependencies["event_stream"].assert_called_once_with(generator.generate.return_value)

    def test_generate_chat_mode_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify chat generator was called
        generator = mock_external_service_dependencies["chat_generator"].return_value
        generator.generate.assert_called_once()
        mock_external_service_dependencies["event_stream"].assert_called_once_with(generator.generate.return_value)

    def test_generate_agent_chat_mode_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify agent chat generator was called
        generator_factory = mock_external_service_dependencies["agent_chat_generator"]
        generator_factory.assert_called_once()
        constructor_args = generator_factory.call_args.kwargs
        assert constructor_args["tool_invoker"] is workflow_runtime.agent_tool_invoker
        assert constructor_args["draft_variable_saver"] is workflow_variables.saver_factory
        assert constructor_args["workflow_runtime"] is workflow_runtime
        generator = generator_factory.return_value
        generator.generate.assert_called_once()
        mock_external_service_dependencies["event_stream"].assert_called_once_with(generator.generate.return_value)

    def test_generate_advanced_chat_mode_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Streaming workflows read the shared event stream instead of constructing a synchronous generator.
        events = mock_external_service_dependencies["retrieve_events"]
        events.assert_called_once_with(ANY, ANY, on_subscribe=ANY)
        mock_external_service_dependencies["event_stream"].assert_called_once_with(events.return_value)

    def test_generate_workflow_mode_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Streaming workflows read the shared event stream instead of constructing a synchronous generator.
        events = mock_external_service_dependencies["retrieve_events"]
        events.assert_called_once_with(ANY, ANY, on_subscribe=ANY)
        mock_external_service_dependencies["event_stream"].assert_called_once_with(events.return_value)

    def test_generate_with_specific_workflow_id(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify the repository selected the specific workflow ID
        mock_external_service_dependencies["get_published_workflow_by_id"].assert_called_once()

    def test_generate_with_debugger_invoke_from(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify draft workflow was fetched for debugger
        mock_external_service_dependencies["get_draft_workflow"].assert_called_once()

    def test_generate_with_non_streaming_mode(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify rate limit exit was called for non-streaming mode
        mock_external_service_dependencies["rate_limit"].return_value.exit.assert_called_once()

    def test_generate_with_end_user(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            type=EndUserType.BROWSER,
            external_user_id=fake.uuid4(),
            name=fake.name(),
            is_anonymous=False,
            session_id=fake.uuid4(),
        )

        db_session_with_containers.add(end_user)
        db_session_with_containers.commit()

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            runtime=workflow_runtime,
            app_model=app,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

    def test_generate_in_cloud_sandbox_plan(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
        """
        Test generation in the Cloud edition with a sandbox plan.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="completion"
        )

        # Billing services are available in the Cloud deployment edition.
        mock_external_service_dependencies["dify_config"].DEPLOYMENT_EDITION = DeploymentEdition.CLOUD
        mock_external_service_dependencies["quota_dify_config"].DEPLOYMENT_EDITION = DeploymentEdition.CLOUD
        mock_external_service_dependencies["global_dify_config"].DEPLOYMENT_EDITION = DeploymentEdition.CLOUD

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test
        result = AppGenerateService.generate(
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify billing two-phase quota (reserve + commit)
        billing = mock_external_service_dependencies["billing_service"]
        billing.quota_reserve.assert_called_once()
        billing.quota_commit.assert_called_once()

    def test_generate_with_invalid_app_mode(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
        """
        Test generation with invalid app mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="chat"
        )

        # Manually set invalid mode after creation
        # With EnumText, invalid values are rejected at the DB level during flush,
        # raising StatementError wrapping ValueError
        app.mode = "invalid_mode"

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test and expect either ValueError (direct) or
        # StatementError (from EnumText validation during autoflush)
        with pytest.raises((ValueError, sa.exc.StatementError)):
            AppGenerateService.generate(
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

    def test_generate_with_workflow_id_format_error(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
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
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

        # Verify error message
        assert "Invalid workflow_id format" in str(exc_info.value)

    def test_generate_with_workflow_not_found_error(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
        """
        Test generation when workflow is not found.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        workflow_id = str(uuid.uuid4())

        # Return no persisted workflow for the requested ID
        mock_external_service_dependencies["get_published_workflow_by_id"].return_value = None

        # Setup test arguments
        args = {
            "inputs": {"query": fake.text(max_nb_chars=50)},
            "workflow_id": workflow_id,
            "response_mode": "streaming",
        }

        # Execute the method under test and expect WorkflowNotFoundError
        with pytest.raises(WorkflowNotFoundError) as exc_info:
            AppGenerateService.generate(
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

        # Verify error message
        assert f"Workflow not found with id: {workflow_id}" in str(exc_info.value)

    def test_generate_with_workflow_not_initialized_error(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
        """
        Test generation when workflow is not initialized for debugger.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Setup workflow service to return None (workflow not initialized)
        mock_external_service_dependencies["get_draft_workflow"].return_value = None

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test and expect ValueError
        with pytest.raises(ValueError) as exc_info:
            AppGenerateService.generate(
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

        # Verify error message
        assert "Workflow not initialized" in str(exc_info.value)

    def test_generate_with_workflow_not_published_error(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
        """
        Test generation when workflow is not published for non-debugger.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, mode="advanced-chat"
        )

        # Setup workflow service to return None (workflow not published)
        mock_external_service_dependencies["get_published_workflow"].return_value = None

        # Setup test arguments
        args = {"inputs": {"query": fake.text(max_nb_chars=50)}, "response_mode": "streaming"}

        # Execute the method under test and expect ValueError
        with pytest.raises(ValueError) as exc_info:
            AppGenerateService.generate(
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

        # Verify error message
        assert "Workflow not published" in str(exc_info.value)

    def test_generate_single_iteration_advanced_chat_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
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
            runtime=workflow_runtime,
            workflow=mock_external_service_dependencies["get_draft_workflow"].return_value,
            app_model=app,
            user=account,
            node_id=node_id,
            args=args,
            streaming=True,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["single_iteration_response"]

        # Verify advanced chat generator was called
        mock_external_service_dependencies[
            "advanced_chat_generator"
        ].return_value.single_iteration_generate.assert_called_once()

    def test_generate_single_iteration_workflow_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
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
            runtime=workflow_runtime,
            workflow=mock_external_service_dependencies["get_draft_workflow"].return_value,
            app_model=app,
            user=account,
            node_id=node_id,
            args=args,
            streaming=True,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["workflow_single_iteration_response"]

        # Verify workflow generator was called
        mock_external_service_dependencies[
            "workflow_generator"
        ].return_value.single_iteration_generate.assert_called_once()

    def test_generate_single_iteration_invalid_mode(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
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
                runtime=workflow_runtime,
                workflow=mock_external_service_dependencies["get_draft_workflow"].return_value,
                app_model=app,
                user=account,
                node_id=node_id,
                args=args,
                streaming=True,
                variables=workflow_variables,
            )

        # Verify error message
        assert "Invalid app mode" in str(exc_info.value)

    def test_generate_single_loop_advanced_chat_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
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
            runtime=workflow_runtime,
            workflow=mock_external_service_dependencies["get_draft_workflow"].return_value,
            app_model=app,
            user=account,
            node_id=node_id,
            args=args,
            streaming=True,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["single_loop_response"]

        # Verify advanced chat generator was called
        mock_external_service_dependencies[
            "advanced_chat_generator"
        ].return_value.single_loop_generate.assert_called_once()

    def test_generate_single_loop_workflow_success(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
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
            runtime=workflow_runtime,
            workflow=mock_external_service_dependencies["get_draft_workflow"].return_value,
            app_model=app,
            user=account,
            node_id=node_id,
            args=args,
            streaming=True,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["workflow_single_loop_response"]

        # Verify workflow generator was called
        mock_external_service_dependencies["workflow_generator"].return_value.single_loop_generate.assert_called_once()

    def test_generate_single_loop_invalid_mode(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
                runtime=workflow_runtime,
                workflow=mock_external_service_dependencies["get_draft_workflow"].return_value,
                app_model=app,
                user=account,
                node_id=node_id,
                args=args,
                streaming=True,
                variables=workflow_variables,
            )

        # Verify error message
        assert "Invalid app mode" in str(exc_info.value)

    def test_generate_more_like_this_success(
        self, workflow_runtime, db_session_with_containers: Session, mock_external_service_dependencies
    ):
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
            retrieval=workflow_runtime.retrieval,
            records=workflow_runtime.chat_records,
            annotations=workflow_runtime.annotation_replies,
            session=db_session_with_containers,
            app_model=app,
            user=account,
            message_id=message_id,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )

        # Verify the result
        assert result == ["more_like_this_response"]

        # Verify completion generator was called
        mock_external_service_dependencies[
            "completion_generator"
        ].return_value.generate_more_like_this.assert_called_once()

    def test_generate_more_like_this_with_end_user(
        self, workflow_runtime, db_session_with_containers: Session, mock_external_service_dependencies
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
            type=EndUserType.BROWSER,
            external_user_id=fake.uuid4(),
            name=fake.name(),
            is_anonymous=False,
            session_id=fake.uuid4(),
        )

        db_session_with_containers.add(end_user)
        db_session_with_containers.commit()

        message_id = fake.uuid4()

        # Execute the method under test
        result = AppGenerateService.generate_more_like_this(
            retrieval=workflow_runtime.retrieval,
            records=workflow_runtime.chat_records,
            annotations=workflow_runtime.annotation_replies,
            session=db_session_with_containers,
            app_model=app,
            user=end_user,
            message_id=message_id,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )

        # Verify the result
        assert result == ["more_like_this_response"]

    def test_get_max_active_requests_with_app_limit(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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
        self, db_session_with_containers: Session, mock_external_service_dependencies
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
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

    def test_generate_with_exception_cleanup(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

        # Verify exception message
        assert "Test exception" in str(exc_info.value)

        # Verify rate limit exit was called for cleanup
        mock_external_service_dependencies["rate_limit"].return_value.exit.assert_called_once()

    def test_generate_with_agent_mode_detection(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
            runtime=workflow_runtime,
            app_model=app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=db_session_with_containers,
            variables=workflow_variables,
        )

        # Verify the result
        assert result == ["test_response"]

        # Verify agent chat generator was called instead of regular chat generator
        generator = mock_external_service_dependencies["agent_chat_generator"].return_value
        generator.generate.assert_called_once()
        mock_external_service_dependencies["event_stream"].assert_called_once_with(generator.generate.return_value)

    def test_generate_with_different_invoke_from_values(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
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
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=invoke_from,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

            # Verify the result
            assert result == ["test_response"]

    def test_generate_with_complex_args(
        self,
        workflow_runtime,
        db_session_with_containers: Session,
        mock_external_service_dependencies,
        *,
        workflow_variables: WorkflowExecutionVariables,
    ):
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
        with patch("services.app_generate_service.AppExecutionParams", autospec=True) as mock_exec_params:
            mock_payload = MagicMock()
            mock_payload.workflow_run_id = fake.uuid4()
            mock_payload.model_dump_json.return_value = "{}"
            mock_exec_params.new.return_value = mock_payload

            result = AppGenerateService.generate(
                runtime=workflow_runtime,
                app_model=app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=True,
                session=db_session_with_containers,
                variables=workflow_variables,
            )

        # Verify the result
        assert result == ["test_response"]

        # Verify payload was built with complex args
        mock_exec_params.new.assert_called_once()
        call_kwargs = mock_exec_params.new.call_args.kwargs
        assert call_kwargs["args"] == args

        # Verify workflow streaming event retrieval was used
        mock_external_service_dependencies["retrieve_events"].assert_called_once_with(
            ANY,
            mock_payload.workflow_run_id,
            on_subscribe=ANY,
        )
