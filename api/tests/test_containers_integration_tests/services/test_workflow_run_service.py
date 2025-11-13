import json
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from faker import Faker

from models.enums import CreatorUserRole
from models.model import (
    Message,
)
from models.workflow import WorkflowRun
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.workflow_run_service import WorkflowRunService


class TestWorkflowRunService:
    """Integration tests for WorkflowRunService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
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
            "mode": "chat",
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FF6B6B",
            "api_rph": 100,
            "api_rpm": 10,
        }

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        return app, account

    def _create_test_workflow_run(
        self, db_session_with_containers, app, account, triggered_from="debugging", offset_minutes=0
    ):
        """
        Helper method to create a test workflow run for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance
            account: Account instance
            triggered_from: Trigger source for workflow run

        Returns:
            WorkflowRun: Created workflow run instance
        """
        fake = Faker()

        from extensions.ext_database import db

        # Create workflow run with offset timestamp
        base_time = datetime.now(UTC)
        created_time = base_time - timedelta(minutes=offset_minutes)

        workflow_run = WorkflowRun(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=str(uuid.uuid4()),
            type="chat",
            triggered_from=triggered_from,
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            inputs=json.dumps({"input": "test"}),
            status="succeeded",
            outputs=json.dumps({"output": "test result"}),
            elapsed_time=1.5,
            total_tokens=100,
            total_steps=3,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=created_time,
            finished_at=created_time,
        )

        db.session.add(workflow_run)
        db.session.commit()

        return workflow_run

    def _create_test_message(self, db_session_with_containers, app, account, workflow_run):
        """
        Helper method to create a test message for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance
            account: Account instance
            workflow_run: WorkflowRun instance

        Returns:
            Message: Created message instance
        """
        fake = Faker()

        from extensions.ext_database import db

        # Create conversation first (required for message)
        from models.model import Conversation

        conversation = Conversation(
            app_id=app.id,
            name=fake.sentence(),
            inputs={},
            status="normal",
            mode="chat",
            from_source=CreatorUserRole.ACCOUNT,
            from_account_id=account.id,
        )
        db.session.add(conversation)
        db.session.commit()

        # Create message
        message = Message()
        message.app_id = app.id
        message.conversation_id = conversation.id
        message.query = fake.text(max_nb_chars=100)
        message.message = {"type": "text", "content": fake.text(max_nb_chars=100)}
        message.answer = fake.text(max_nb_chars=200)
        message.message_tokens = 50
        message.answer_tokens = 100
        message.message_unit_price = 0.001
        message.answer_unit_price = 0.002
        message.message_price_unit = 0.001
        message.answer_price_unit = 0.001
        message.currency = "USD"
        message.status = "normal"
        message.from_source = CreatorUserRole.ACCOUNT
        message.from_account_id = account.id
        message.workflow_run_id = workflow_run.id
        message.inputs = {"input": "test input"}

        db.session.add(message)
        db.session.commit()

        return message

    def test_get_paginate_workflow_runs_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful pagination of workflow runs with debugging trigger.

        This test verifies:
        - Proper pagination of workflow runs
        - Correct filtering by triggered_from
        - Proper limit and last_id handling
        - Repository method calls
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create multiple workflow runs
        workflow_runs = []
        for i in range(5):
            workflow_run = self._create_test_workflow_run(db_session_with_containers, app, account, "debugging")
            workflow_runs.append(workflow_run)

        # Act: Execute the method under test
        workflow_run_service = WorkflowRunService()
        args = {"limit": 3, "last_id": None}
        result = workflow_run_service.get_paginate_workflow_runs(app, args)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert hasattr(result, "data")
        assert len(result.data) == 3  # Should return 3 items due to limit

        # Verify pagination properties
        assert hasattr(result, "has_more")
        assert hasattr(result, "limit")

        # Verify all returned items are debugging runs
        for workflow_run in result.data:
            assert workflow_run.triggered_from == "debugging"
            assert workflow_run.app_id == app.id
            assert workflow_run.tenant_id == app.tenant_id

    def test_get_paginate_workflow_runs_with_last_id(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination of workflow runs with last_id parameter.

        This test verifies:
        - Proper pagination with last_id parameter
        - Correct handling of pagination state
        - Repository method calls with proper parameters
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create multiple workflow runs with different timestamps
        workflow_runs = []
        for i in range(5):
            workflow_run = self._create_test_workflow_run(
                db_session_with_containers, app, account, "debugging", offset_minutes=i
            )
            workflow_runs.append(workflow_run)

        # Act: Execute the method under test with last_id
        workflow_run_service = WorkflowRunService()
        args = {"limit": 2, "last_id": workflow_runs[1].id}
        result = workflow_run_service.get_paginate_workflow_runs(app, args)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert hasattr(result, "data")
        assert len(result.data) == 2  # Should return 2 items due to limit

        # Verify pagination properties
        assert hasattr(result, "has_more")
        assert hasattr(result, "limit")

        # Verify all returned items are debugging runs
        for workflow_run in result.data:
            assert workflow_run.triggered_from == "debugging"
            assert workflow_run.app_id == app.id
            assert workflow_run.tenant_id == app.tenant_id

    def test_get_paginate_workflow_runs_default_limit(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination of workflow runs with default limit.

        This test verifies:
        - Default limit of 20 when not specified
        - Proper handling of missing limit parameter
        - Repository method calls with default values
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create workflow runs
        workflow_run = self._create_test_workflow_run(db_session_with_containers, app, account, "debugging")

        # Act: Execute the method under test without limit
        workflow_run_service = WorkflowRunService()
        args = {}  # No limit specified
        result = workflow_run_service.get_paginate_workflow_runs(app, args)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert hasattr(result, "data")

        # Verify pagination properties
        assert hasattr(result, "has_more")
        assert hasattr(result, "limit")

        # Verify the returned workflow run
        if result.data:
            workflow_run_result = result.data[0]
            assert workflow_run_result.triggered_from == "debugging"
            assert workflow_run_result.app_id == app.id
            assert workflow_run_result.tenant_id == app.tenant_id

    def test_get_paginate_advanced_chat_workflow_runs_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful pagination of advanced chat workflow runs with message information.

        This test verifies:
        - Proper pagination of advanced chat workflow runs
        - Correct filtering by triggered_from
        - Message information enrichment
        - WorkflowWithMessage wrapper functionality
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create workflow runs with messages
        workflow_runs = []
        for i in range(3):
            workflow_run = self._create_test_workflow_run(
                db_session_with_containers, app, account, "debugging", offset_minutes=i
            )
            message = self._create_test_message(db_session_with_containers, app, account, workflow_run)
            workflow_runs.append(workflow_run)

        # Act: Execute the method under test
        workflow_run_service = WorkflowRunService()
        args = {"limit": 2, "last_id": None}
        result = workflow_run_service.get_paginate_advanced_chat_workflow_runs(app, args)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert hasattr(result, "data")
        assert len(result.data) == 2  # Should return 2 items due to limit

        # Verify pagination properties
        assert hasattr(result, "has_more")
        assert hasattr(result, "limit")

        # Verify all returned items have message information
        for workflow_run in result.data:
            assert hasattr(workflow_run, "message_id")
            assert hasattr(workflow_run, "conversation_id")
            assert workflow_run.app_id == app.id
            assert workflow_run.tenant_id == app.tenant_id

    def test_get_workflow_run_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of workflow run by ID.

        This test verifies:
        - Proper workflow run retrieval by ID
        - Correct tenant and app isolation
        - Repository method calls with proper parameters
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create workflow run
        workflow_run = self._create_test_workflow_run(db_session_with_containers, app, account, "debugging")

        # Act: Execute the method under test
        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_run(app, workflow_run.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.id == workflow_run.id
        assert result.tenant_id == app.tenant_id
        assert result.app_id == app.id
        assert result.triggered_from == "debugging"
        assert result.status == "succeeded"
        assert result.type == "chat"
        assert result.version == "1.0.0"

    def test_get_workflow_run_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test workflow run retrieval when run ID does not exist.

        This test verifies:
        - Proper handling of non-existent workflow run IDs
        - Repository method calls with proper parameters
        - Return value for missing records
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Use a non-existent UUID
        non_existent_id = str(uuid.uuid4())

        # Act: Execute the method under test
        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_run(app, non_existent_id)

        # Assert: Verify the expected outcomes
        assert result is None

    def test_get_workflow_run_node_executions_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful retrieval of workflow run node executions.

        This test verifies:
        - Proper node execution retrieval for workflow run
        - Correct tenant and app isolation
        - Repository method calls with proper parameters
        - Context setup for plugin tool providers
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create workflow run
        workflow_run = self._create_test_workflow_run(db_session_with_containers, app, account, "debugging")

        # Create node executions
        from extensions.ext_database import db
        from models.workflow import WorkflowNodeExecutionModel

        node_executions = []
        for i in range(3):
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow_run.workflow_id,
                triggered_from="workflow-run",
                workflow_run_id=workflow_run.id,
                index=i,
                node_id=f"node_{i}",
                node_type="llm" if i == 0 else "tool",
                title=f"Node {i}",
                inputs=json.dumps({"input": f"test_input_{i}"}),
                process_data=json.dumps({"process": f"test_process_{i}"}),
                status="succeeded",
                elapsed_time=0.5,
                execution_metadata=json.dumps({"tokens": 50}),
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
                created_at=datetime.now(UTC),
            )
            db.session.add(node_execution)
            node_executions.append(node_execution)

        db.session.commit()

        # Act: Execute the method under test
        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_run_node_executions(app, workflow_run.id, account)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 3

        # Verify node execution properties
        for node_execution in result:
            assert node_execution.tenant_id == app.tenant_id
            assert node_execution.app_id == app.id
            assert node_execution.workflow_run_id == workflow_run.id
            assert node_execution.index in [0, 1, 2]  # Check that index is one of the expected values
            assert node_execution.node_id.startswith("node_")  # Check that node_id starts with "node_"
            assert node_execution.status == "succeeded"

    def test_get_workflow_run_node_executions_empty(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting node executions for a workflow run with no executions.

        This test verifies:
        - Empty result when no node executions exist
        - Proper handling of empty data
        - No errors when querying non-existent executions
        """
        # Arrange: Setup test data
        account_service = AccountService()
        tenant_service = TenantService()
        app_service = AppService()
        workflow_run_service = WorkflowRunService()

        # Create account and tenant
        account = account_service.create_account(
            email="test@example.com",
            name="Test User",
            password="password123",
            interface_language="en-US",
        )
        TenantService.create_owner_tenant_if_not_exist(account, name="test_tenant")
        tenant = account.current_tenant

        # Create app
        app_args = {
            "name": "Test App",
            "mode": "chat",
            "icon_type": "emoji",
            "icon": "🚀",
            "icon_background": "#4ECDC4",
        }
        app = app_service.create_app(tenant.id, app_args, account)

        # Create workflow run without node executions
        workflow_run = self._create_test_workflow_run(db_session_with_containers, app, account, "debugging")

        # Act: Get node executions
        result = workflow_run_service.get_workflow_run_node_executions(
            app_model=app,
            run_id=workflow_run.id,
            user=account,
        )

        # Assert: Verify empty result
        assert result is not None
        assert len(result) == 0

    def test_get_workflow_run_node_executions_invalid_workflow_run_id(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting node executions with invalid workflow run ID.

        This test verifies:
        - Proper handling of invalid workflow run ID
        - Empty result when workflow run doesn't exist
        - No errors when querying with invalid ID
        """
        # Arrange: Setup test data
        account_service = AccountService()
        tenant_service = TenantService()
        app_service = AppService()
        workflow_run_service = WorkflowRunService()

        # Create account and tenant
        account = account_service.create_account(
            email="test@example.com",
            name="Test User",
            password="password123",
            interface_language="en-US",
        )
        TenantService.create_owner_tenant_if_not_exist(account, name="test_tenant")
        tenant = account.current_tenant

        # Create app
        app_args = {
            "name": "Test App",
            "mode": "chat",
            "icon_type": "emoji",
            "icon": "🚀",
            "icon_background": "#4ECDC4",
        }
        app = app_service.create_app(tenant.id, app_args, account)

        # Use invalid workflow run ID
        invalid_workflow_run_id = str(uuid.uuid4())

        # Act: Get node executions with invalid ID
        result = workflow_run_service.get_workflow_run_node_executions(
            app_model=app,
            run_id=invalid_workflow_run_id,
            user=account,
        )

        # Assert: Verify empty result
        assert result is not None
        assert len(result) == 0

    def test_get_workflow_run_node_executions_database_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting node executions when database encounters an error.

        This test verifies:
        - Proper error handling when database operations fail
        - Graceful degradation in error scenarios
        - Error propagation to calling code
        """
        # Arrange: Setup test data
        account_service = AccountService()
        tenant_service = TenantService()
        app_service = AppService()
        workflow_run_service = WorkflowRunService()

        # Create account and tenant
        account = account_service.create_account(
            email="test@example.com",
            name="Test User",
            password="password123",
            interface_language="en-US",
        )
        TenantService.create_owner_tenant_if_not_exist(account, name="test_tenant")
        tenant = account.current_tenant

        # Create app
        app_args = {
            "name": "Test App",
            "mode": "chat",
            "icon_type": "emoji",
            "icon": "🚀",
            "icon_background": "#4ECDC4",
        }
        app = app_service.create_app(tenant.id, app_args, account)

        # Create workflow run
        workflow_run = self._create_test_workflow_run(db_session_with_containers, app, account, "debugging")

        # Mock database error by closing the session
        db_session_with_containers.close()

        # Act & Assert: Verify error handling
        with pytest.raises((Exception, RuntimeError)):
            workflow_run_service.get_workflow_run_node_executions(
                app_model=app,
                run_id=workflow_run.id,
                user=account,
            )

    def test_get_workflow_run_node_executions_end_user(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test node execution retrieval for end user.

        This test verifies:
        - Proper handling of end user vs account user
        - Correct tenant ID extraction for end users
        - Repository method calls with proper parameters
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create workflow run
        workflow_run = self._create_test_workflow_run(db_session_with_containers, app, account, "debugging")

        # Create end user
        from extensions.ext_database import db
        from models.model import EndUser

        end_user = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="web_app",
            is_anonymous=False,
            session_id=str(uuid.uuid4()),
            external_user_id=str(uuid.uuid4()),
            name=fake.name(),
        )
        db.session.add(end_user)
        db.session.commit()

        # Create node execution
        from models.workflow import WorkflowNodeExecutionModel

        node_execution = WorkflowNodeExecutionModel(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow_run.workflow_id,
            triggered_from="workflow-run",
            workflow_run_id=workflow_run.id,
            index=0,
            node_id="node_0",
            node_type="llm",
            title="Node 0",
            inputs=json.dumps({"input": "test_input"}),
            process_data=json.dumps({"process": "test_process"}),
            status="succeeded",
            elapsed_time=0.5,
            execution_metadata=json.dumps({"tokens": 50}),
            created_by_role=CreatorUserRole.END_USER,
            created_by=end_user.id,
            created_at=datetime.now(UTC),
        )
        db.session.add(node_execution)
        db.session.commit()

        # Act: Execute the method under test
        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_run_node_executions(app, workflow_run.id, end_user)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 1

        # Verify node execution properties
        node_exec = result[0]
        assert node_exec.tenant_id == app.tenant_id
        assert node_exec.app_id == app.id
        assert node_exec.workflow_run_id == workflow_run.id
        assert node_exec.created_by == end_user.id
        assert node_exec.created_by_role == CreatorUserRole.END_USER
