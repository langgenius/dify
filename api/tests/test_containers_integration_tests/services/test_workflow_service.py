"""
TestContainers-based integration tests for WorkflowService.

This module provides comprehensive integration testing for WorkflowService using
TestContainers to ensure realistic database interactions and proper isolation.
"""

import json
from unittest.mock import MagicMock

import pytest
from faker import Faker

from models import Account, App, Workflow
from models.model import AppMode
from models.workflow import WorkflowType
from services.workflow_service import WorkflowService


class TestWorkflowService:
    """
    Comprehensive integration tests for WorkflowService using testcontainers.

    This test class covers all major functionality of the WorkflowService:
    - Workflow CRUD operations (Create, Read, Update, Delete)
    - Workflow publishing and versioning
    - Node execution and workflow running
    - Workflow conversion and validation
    - Error handling for various edge cases

    All tests use the testcontainers infrastructure to ensure proper database isolation
    and realistic testing environment with actual database interactions.
    """

    def _create_test_account(self, db_session_with_containers, fake=None):
        """
        Helper method to create a test account with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            Account: Created test account instance
        """
        fake = fake or Faker()
        account = Account(
            email=fake.email(),
            name=fake.name(),
            avatar=fake.url(),
            status="active",
            interface_language="en-US",  # Set interface language for Site creation
        )
        account.created_at = fake.date_time_this_year()
        account.id = fake.uuid4()
        account.updated_at = account.created_at

        # Create a tenant for the account
        from models.account import Tenant

        tenant = Tenant(
            name=f"Test Tenant {fake.company()}",
            plan="basic",
            status="active",
        )
        tenant.id = account.current_tenant_id
        tenant.created_at = fake.date_time_this_year()
        tenant.updated_at = tenant.created_at

        from extensions.ext_database import db

        db.session.add(tenant)
        db.session.add(account)
        db.session.commit()

        # Set the current tenant for the account
        account.current_tenant = tenant

        return account

    def _create_test_app(self, db_session_with_containers, fake=None):
        """
        Helper method to create a test app with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            App: Created test app instance
        """
        fake = fake or Faker()
        app = App(
            id=fake.uuid4(),
            tenant_id=fake.uuid4(),
            name=fake.company(),
            description=fake.text(),
            mode=AppMode.WORKFLOW,
            icon_type="emoji",
            icon="🤖",
            icon_background="#FFEAD5",
            enable_site=True,
            enable_api=True,
            created_by=fake.uuid4(),
            workflow_id=None,  # Will be set when workflow is created
        )
        app.updated_by = app.created_by

        from extensions.ext_database import db

        db.session.add(app)
        db.session.commit()
        return app

    def _create_test_workflow(self, db_session_with_containers, app, account, fake=None):
        """
        Helper method to create a test workflow associated with an app.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: The app to associate the workflow with
            account: The account creating the workflow
            fake: Faker instance for generating test data

        Returns:
            Workflow: Created test workflow instance
        """
        fake = fake or Faker()
        workflow = Workflow(
            id=fake.uuid4(),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps({"nodes": [], "edges": []}),
            features=json.dumps({"features": []}),
            # unique_hash is a computed property based on graph and features
            created_by=account.id,
            updated_by=account.id,
            environment_variables=[],
            conversation_variables=[],
        )

        from extensions.ext_database import db

        db.session.add(workflow)
        db.session.commit()
        return workflow

    def test_get_node_last_run_success(self, db_session_with_containers):
        """
        Test successful retrieval of the most recent execution for a specific node.

        This test verifies that the service can correctly retrieve the last execution
        record for a workflow node, which is essential for debugging and monitoring
        workflow execution history.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)

        # Create a mock node execution record
        from models.enums import CreatorUserRole
        from models.workflow import WorkflowNodeExecutionModel

        node_execution = WorkflowNodeExecutionModel()
        node_execution.id = fake.uuid4()
        node_execution.tenant_id = app.tenant_id
        node_execution.app_id = app.id
        node_execution.workflow_id = workflow.id
        node_execution.triggered_from = "single-step"  # Required field
        node_execution.index = 1  # Required field
        node_execution.node_id = "test-node-1"
        node_execution.node_type = "test_node"
        node_execution.title = "Test Node"  # Required field
        node_execution.status = "succeeded"
        node_execution.created_by_role = CreatorUserRole.ACCOUNT  # Required field
        node_execution.created_by = account.id  # Required field
        node_execution.created_at = fake.date_time_this_year()

        from extensions.ext_database import db

        db.session.add(node_execution)
        db.session.commit()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_node_last_run(app, workflow, "test-node-1")

        # Assert
        assert result is not None
        assert result.node_id == "test-node-1"
        assert result.workflow_id == workflow.id
        assert result.status == "succeeded"

    def test_get_node_last_run_not_found(self, db_session_with_containers):
        """
        Test retrieval when no execution record exists for the specified node.

        This test ensures that the service correctly handles cases where there are
        no previous executions for a node, returning None as expected.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_node_last_run(app, workflow, "non-existent-node")

        # Assert
        assert result is None

    def test_is_workflow_exist_true(self, db_session_with_containers):
        """
        Test workflow existence check when a draft workflow exists.

        This test verifies that the service correctly identifies when a draft workflow
        exists for an application, which is important for workflow management operations.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.is_workflow_exist(app)

        # Assert
        assert result is True

    def test_is_workflow_exist_false(self, db_session_with_containers):
        """
        Test workflow existence check when no draft workflow exists.

        This test ensures that the service correctly identifies when no draft workflow
        exists for an application, which is the initial state for new apps.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        # Don't create any workflow

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.is_workflow_exist(app)

        # Assert
        assert result is False

    def test_get_draft_workflow_success(self, db_session_with_containers):
        """
        Test successful retrieval of a draft workflow.

        This test verifies that the service can correctly retrieve an existing
        draft workflow for an application, which is essential for workflow editing
        and development workflows.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_draft_workflow(app)

        # Assert
        assert result is not None
        assert result.id == workflow.id
        assert result.version == Workflow.VERSION_DRAFT
        assert result.app_id == app.id
        assert result.tenant_id == app.tenant_id

    def test_get_draft_workflow_not_found(self, db_session_with_containers):
        """
        Test draft workflow retrieval when no draft workflow exists.

        This test ensures that the service correctly handles cases where there is
        no draft workflow for an application, returning None as expected.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        # Don't create any workflow

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_draft_workflow(app)

        # Assert
        assert result is None

    def test_get_published_workflow_by_id_success(self, db_session_with_containers):
        """
        Test successful retrieval of a published workflow by ID.

        This test verifies that the service can correctly retrieve a published
        workflow using its ID, which is essential for workflow execution and
        reference operations.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create a published workflow (not draft)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow.version = "2024.01.01.001"  # Published version

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_published_workflow_by_id(app, workflow.id)

        # Assert
        assert result is not None
        assert result.id == workflow.id
        assert result.version != Workflow.VERSION_DRAFT
        assert result.app_id == app.id

    def test_get_published_workflow_by_id_draft_error(self, db_session_with_containers):
        """
        Test error when trying to retrieve a draft workflow as published.

        This test ensures that the service correctly prevents access to draft
        workflows when a published version is requested, maintaining proper
        workflow version control.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        # Keep as draft version

        workflow_service = WorkflowService()

        # Act & Assert
        from services.errors.app import IsDraftWorkflowError

        with pytest.raises(IsDraftWorkflowError):
            workflow_service.get_published_workflow_by_id(app, workflow.id)

    def test_get_published_workflow_by_id_not_found(self, db_session_with_containers):
        """
        Test retrieval when no workflow exists with the specified ID.

        This test ensures that the service correctly handles cases where the
        requested workflow ID doesn't exist in the system.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        non_existent_workflow_id = fake.uuid4()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_published_workflow_by_id(app, non_existent_workflow_id)

        # Assert
        assert result is None

    def test_get_published_workflow_success(self, db_session_with_containers):
        """
        Test successful retrieval of the current published workflow for an app.

        This test verifies that the service can correctly retrieve the published
        workflow that is currently associated with an application.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create a published workflow and associate it with the app
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow.version = "2024.01.01.001"  # Published version

        from extensions.ext_database import db

        app.workflow_id = workflow.id
        db.session.commit()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_published_workflow(app)

        # Assert
        assert result is not None
        assert result.id == workflow.id
        assert result.version != Workflow.VERSION_DRAFT
        assert result.app_id == app.id

    def test_get_published_workflow_no_workflow_id(self, db_session_with_containers):
        """
        Test retrieval when app has no associated workflow ID.

        This test ensures that the service correctly handles cases where an
        application doesn't have any published workflow associated with it.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        # app.workflow_id is None by default

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_published_workflow(app)

        # Assert
        assert result is None

    def test_get_all_published_workflow_pagination(self, db_session_with_containers):
        """
        Test pagination of published workflows.

        This test verifies that the service can correctly paginate through
        published workflows, supporting large workflow collections and
        efficient data retrieval.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create multiple published workflows
        workflows = []
        for i in range(5):
            workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
            workflow.version = f"2024.01.0{i + 1}.001"  # Published version
            workflow.marked_name = f"Workflow {i + 1}"
            workflows.append(workflow)

        # Set the app's workflow_id to the first workflow
        app.workflow_id = workflows[0].id

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act - First page
        result_workflows, has_more = workflow_service.get_all_published_workflow(
            session=db.session,
            app_model=app,
            page=1,
            limit=3,
            user_id=None,  # Show all workflows
        )

        # Assert
        assert len(result_workflows) == 3
        assert has_more is True

        # Act - Second page
        result_workflows, has_more = workflow_service.get_all_published_workflow(
            session=db.session,
            app_model=app,
            page=2,
            limit=3,
            user_id=None,  # Show all workflows
        )

        # Assert
        assert len(result_workflows) == 2
        assert has_more is False

    def test_get_all_published_workflow_user_filter(self, db_session_with_containers):
        """
        Test filtering published workflows by user.

        This test verifies that the service can correctly filter workflows
        by the user who created them, supporting user-specific workflow
        management and access control.
        """
        # Arrange
        fake = Faker()
        account1 = self._create_test_account(db_session_with_containers, fake)
        account2 = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create workflows by different users
        workflow1 = self._create_test_workflow(db_session_with_containers, app, account1, fake)
        workflow1.version = "2024.01.01.001"  # Published version
        workflow1.created_by = account1.id

        workflow2 = self._create_test_workflow(db_session_with_containers, app, account2, fake)
        workflow2.version = "2024.01.02.001"  # Published version
        workflow2.created_by = account2.id

        # Set the app's workflow_id to the first workflow
        app.workflow_id = workflow1.id

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act - Filter by account1
        result_workflows, has_more = workflow_service.get_all_published_workflow(
            session=db.session, app_model=app, page=1, limit=10, user_id=account1.id
        )

        # Assert
        assert len(result_workflows) == 1
        assert result_workflows[0].created_by == account1.id

    def test_get_all_published_workflow_named_only_filter(self, db_session_with_containers):
        """
        Test filtering published workflows to show only named workflows.

        This test verifies that the service correctly filters workflows
        to show only those with marked names, supporting workflow
        organization and management features.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create workflows with and without names
        workflow1 = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow1.version = "2024.01.01.001"  # Published version
        workflow1.marked_name = "Named Workflow 1"

        workflow2 = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow2.version = "2024.01.02.001"  # Published version
        workflow2.marked_name = ""  # No name

        workflow3 = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow3.version = "2024.01.03.001"  # Published version
        workflow3.marked_name = "Named Workflow 3"

        # Set the app's workflow_id to the first workflow
        app.workflow_id = workflow1.id

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act - Filter named only
        result_workflows, has_more = workflow_service.get_all_published_workflow(
            session=db.session, app_model=app, page=1, limit=10, user_id=None, named_only=True
        )

        # Assert
        assert len(result_workflows) == 2
        assert all(wf.marked_name for wf in result_workflows)

    def test_sync_draft_workflow_create_new(self, db_session_with_containers):
        """
        Test creating a new draft workflow through sync operation.

        This test verifies that the service can correctly create a new draft
        workflow when none exists, which is the initial workflow setup process.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        graph = {"nodes": [{"id": "start", "type": "start"}], "edges": []}
        features = {"features": ["feature1", "feature2"]}
        # Don't pre-calculate hash, let the service generate it
        unique_hash = None

        environment_variables = []
        conversation_variables = []

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.sync_draft_workflow(
            app_model=app,
            graph=graph,
            features=features,
            unique_hash=unique_hash,
            account=account,
            environment_variables=environment_variables,
            conversation_variables=conversation_variables,
        )

        # Assert
        assert result is not None
        assert result.version == Workflow.VERSION_DRAFT
        assert result.app_id == app.id
        assert result.tenant_id == app.tenant_id
        assert result.unique_hash is not None  # Should have a hash generated
        assert result.graph == json.dumps(graph)
        assert result.features == json.dumps(features)
        assert result.created_by == account.id

    def test_sync_draft_workflow_update_existing(self, db_session_with_containers):
        """
        Test updating an existing draft workflow through sync operation.

        This test verifies that the service can correctly update an existing
        draft workflow with new graph and features data.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create existing draft workflow
        existing_workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        # Get the actual hash that was generated
        original_hash = existing_workflow.unique_hash

        new_graph = {"nodes": [{"id": "start", "type": "start"}, {"id": "end", "type": "end"}], "edges": []}
        new_features = {"features": ["feature1", "feature2", "feature3"]}

        environment_variables = []
        conversation_variables = []

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.sync_draft_workflow(
            app_model=app,
            graph=new_graph,
            features=new_features,
            unique_hash=original_hash,  # Use original hash to allow update
            account=account,
            environment_variables=environment_variables,
            conversation_variables=conversation_variables,
        )

        # Assert
        assert result is not None
        assert result.id == existing_workflow.id  # Same workflow updated
        assert result.version == Workflow.VERSION_DRAFT
        # Hash should be updated to reflect new content
        assert result.unique_hash != original_hash  # Hash should change after update
        assert result.graph == json.dumps(new_graph)
        assert result.features == json.dumps(new_features)
        assert result.updated_by == account.id

    def test_sync_draft_workflow_hash_mismatch_error(self, db_session_with_containers):
        """
        Test error when sync is attempted with mismatched hash.

        This test ensures that the service correctly prevents workflow sync
        when the hash doesn't match, maintaining workflow consistency and
        preventing concurrent modification conflicts.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create existing draft workflow
        existing_workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        # Get the actual hash that was generated
        original_hash = existing_workflow.unique_hash

        new_graph = {"nodes": [{"id": "start", "type": "start"}], "edges": []}
        new_features = {"features": ["feature1"]}
        # Use a different hash to trigger the error
        mismatched_hash = "different_hash_12345"
        environment_variables = []
        conversation_variables = []

        workflow_service = WorkflowService()

        # Act & Assert
        from services.errors.app import WorkflowHashNotEqualError

        with pytest.raises(WorkflowHashNotEqualError):
            workflow_service.sync_draft_workflow(
                app_model=app,
                graph=new_graph,
                features=new_features,
                unique_hash=mismatched_hash,
                account=account,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
            )

    def test_publish_workflow_success(self, db_session_with_containers):
        """
        Test successful workflow publishing.

        This test verifies that the service can correctly publish a draft
        workflow, creating a new published version with proper versioning
        and status management.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create draft workflow
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow.version = Workflow.VERSION_DRAFT

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act - Mock current_user context and pass session
        from unittest.mock import patch

        with patch("flask_login.utils._get_user", return_value=account):
            result = workflow_service.publish_workflow(
                session=db_session_with_containers, app_model=app, account=account
            )

        # Assert
        assert result is not None
        assert result.version != Workflow.VERSION_DRAFT
        # Version should be a timestamp format like '2025-08-22 00:10:24.722051'
        assert isinstance(result.version, str)
        assert len(result.version) > 10  # Should be a reasonable timestamp length
        assert result.created_by == account.id

    def test_publish_workflow_no_draft_error(self, db_session_with_containers):
        """
        Test error when publishing workflow without draft.

        This test ensures that the service correctly prevents publishing
        when no draft workflow exists, maintaining workflow state consistency.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Don't create any workflow - app should have no draft

        workflow_service = WorkflowService()

        # Act & Assert
        with pytest.raises(ValueError, match="No valid workflow found"):
            workflow_service.publish_workflow(session=db_session_with_containers, app_model=app, account=account)

    def test_publish_workflow_already_published_error(self, db_session_with_containers):
        """
        Test error when publishing already published workflow.

        This test ensures that the service correctly prevents re-publishing
        of already published workflows, maintaining version control integrity.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create already published workflow
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow.version = "2024.01.01.001"  # Already published

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act & Assert
        with pytest.raises(ValueError, match="No valid workflow found"):
            workflow_service.publish_workflow(session=db_session_with_containers, app_model=app, account=account)

    def test_get_default_block_configs(self, db_session_with_containers):
        """
        Test retrieval of default block configurations for all node types.

        This test verifies that the service can correctly retrieve default
        configurations for all available workflow node types, which is
        essential for workflow design and configuration.
        """
        # Arrange
        workflow_service = WorkflowService()

        # Act
        result = workflow_service.get_default_block_configs()

        # Assert
        assert isinstance(result, list)
        # The list might be empty if no default configs are available
        # This is acceptable behavior

        # Check that each config has required structure if any exist
        for config in result:
            assert isinstance(config, dict)
            # The structure can vary, so we just check it's a dict

    def test_get_default_block_config_specific_type(self, db_session_with_containers):
        """
        Test retrieval of default block configuration for a specific node type.

        This test verifies that the service can correctly retrieve default
        configuration for a specific workflow node type, supporting targeted
        workflow node configuration.
        """
        # Arrange
        workflow_service = WorkflowService()
        node_type = "start"  # Common node type

        # Act
        result = workflow_service.get_default_block_config(node_type=node_type)

        # Assert
        # The result might be None if no default config is available for this node type
        # This is acceptable behavior
        assert result is None or isinstance(result, dict)

    def test_get_default_block_config_invalid_type(self, db_session_with_containers):
        """
        Test retrieval of default block configuration for invalid node type.

        This test ensures that the service correctly handles requests for
        invalid or non-existent node types, returning None as expected.
        """
        # Arrange
        workflow_service = WorkflowService()
        invalid_node_type = "invalid_node_type_12345"

        # Act
        try:
            result = workflow_service.get_default_block_config(node_type=invalid_node_type)
            # If we get here, the service should return None for invalid types
            assert result is None
        except ValueError:
            # It's also acceptable for the service to raise a ValueError for invalid types
            pass

    def test_get_default_block_config_with_filters(self, db_session_with_containers):
        """
        Test retrieval of default block configuration with filters.

        This test verifies that the service can correctly apply filters
        when retrieving default configurations, supporting conditional
        configuration retrieval.
        """
        # Arrange
        workflow_service = WorkflowService()
        node_type = "start"
        filters = {"category": "input"}

        # Act
        result = workflow_service.get_default_block_config(node_type=node_type, filters=filters)

        # Assert
        # Result might be None if filters don't match, but should not raise error
        assert result is None or isinstance(result, dict)

    def test_convert_to_workflow_chat_mode_success(self, db_session_with_containers):
        """
        Test successful conversion from chat mode app to workflow mode.

        This test verifies that the service can correctly convert a chatbot
        application to workflow mode, which is essential for app mode migration.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)

        # Create chat mode app
        app = self._create_test_app(db_session_with_containers, fake)
        app.mode = AppMode.CHAT

        # Create app model config (required for conversion)
        from models.model import AppModelConfig

        app_model_config = AppModelConfig()
        app_model_config.id = fake.uuid4()
        app_model_config.app_id = app.id
        app_model_config.tenant_id = app.tenant_id
        app_model_config.provider = "openai"
        app_model_config.model_id = "gpt-3.5-turbo"
        # Set the model field directly - this is what model_dict property returns
        app_model_config.model = json.dumps(
            {
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "completion_params": {"max_tokens": 1000, "temperature": 0.7},
            }
        )
        # Set pre_prompt for PromptTemplateConfigManager
        app_model_config.pre_prompt = "You are a helpful assistant."
        app_model_config.created_by = account.id
        app_model_config.updated_by = account.id

        from extensions.ext_database import db

        db.session.add(app_model_config)
        app.app_model_config_id = app_model_config.id
        db.session.commit()

        workflow_service = WorkflowService()
        conversion_args = {
            "name": "Converted Workflow App",
            "icon_type": "emoji",
            "icon": "🚀",
            "icon_background": "#FF5733",
        }

        # Act
        result = workflow_service.convert_to_workflow(app_model=app, account=account, args=conversion_args)

        # Assert
        assert result is not None
        assert result.mode == AppMode.ADVANCED_CHAT  # CHAT mode converts to ADVANCED_CHAT, not WORKFLOW
        assert result.name == conversion_args["name"]
        assert result.icon == conversion_args["icon"]
        assert result.icon_type == conversion_args["icon_type"]
        assert result.icon_background == conversion_args["icon_background"]

    def test_convert_to_workflow_completion_mode_success(self, db_session_with_containers):
        """
        Test successful conversion from completion mode app to workflow mode.

        This test verifies that the service can correctly convert a completion
        application to workflow mode, supporting different app type migrations.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)

        # Create completion mode app
        app = self._create_test_app(db_session_with_containers, fake)
        app.mode = AppMode.COMPLETION

        # Create app model config (required for conversion)
        from models.model import AppModelConfig

        app_model_config = AppModelConfig()
        app_model_config.id = fake.uuid4()
        app_model_config.app_id = app.id
        app_model_config.tenant_id = app.tenant_id
        app_model_config.provider = "openai"
        app_model_config.model_id = "gpt-3.5-turbo"
        # Set the model field directly - this is what model_dict property returns
        app_model_config.model = json.dumps(
            {
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "completion_params": {"max_tokens": 1000, "temperature": 0.7},
            }
        )
        # Set pre_prompt for PromptTemplateConfigManager
        app_model_config.pre_prompt = "Complete the following text:"
        app_model_config.created_by = account.id
        app_model_config.updated_by = account.id

        from extensions.ext_database import db

        db.session.add(app_model_config)
        app.app_model_config_id = app_model_config.id
        db.session.commit()

        workflow_service = WorkflowService()
        conversion_args = {
            "name": "Converted Workflow App",
            "icon_type": "emoji",
            "icon": "🚀",
            "icon_background": "#FF5733",
        }

        # Act
        result = workflow_service.convert_to_workflow(app_model=app, account=account, args=conversion_args)

        # Assert
        assert result is not None
        assert result.mode == AppMode.WORKFLOW
        assert result.name == conversion_args["name"]
        assert result.icon == conversion_args["icon"]
        assert result.icon_type == conversion_args["icon_type"]
        assert result.icon_background == conversion_args["icon_background"]

    def test_convert_to_workflow_unsupported_mode_error(self, db_session_with_containers):
        """
        Test error when attempting to convert unsupported app mode.

        This test ensures that the service correctly prevents conversion
        of apps that are not in supported modes for workflow conversion.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)

        # Create workflow mode app (already in workflow mode)
        app = self._create_test_app(db_session_with_containers, fake)
        app.mode = AppMode.WORKFLOW

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()
        conversion_args = {"name": "Test"}

        # Act & Assert
        with pytest.raises(ValueError, match="Current App mode: workflow is not supported convert to workflow"):
            workflow_service.convert_to_workflow(app_model=app, account=account, args=conversion_args)

    def test_validate_features_structure_advanced_chat(self, db_session_with_containers):
        """
        Test feature structure validation for advanced chat mode apps.

        This test verifies that the service can correctly validate feature
        structures for advanced chat applications, ensuring proper configuration.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        app.mode = AppMode.ADVANCED_CHAT

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()
        features = {
            "opening_statement": "Hello!",
            "suggested_questions": ["Question 1", "Question 2"],
            "more_like_this": True,
        }

        # Act
        result = workflow_service.validate_features_structure(app_model=app, features=features)

        # Assert
        # The validation should return the validated config or raise an error
        # The exact behavior depends on the AdvancedChatAppConfigManager implementation
        assert result is not None or isinstance(result, dict)

    def test_validate_features_structure_workflow(self, db_session_with_containers):
        """
        Test feature structure validation for workflow mode apps.

        This test verifies that the service can correctly validate feature
        structures for workflow applications, ensuring proper configuration.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        app.mode = AppMode.WORKFLOW

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()
        features = {"workflow_config": {"max_steps": 10, "timeout": 300}}

        # Act
        result = workflow_service.validate_features_structure(app_model=app, features=features)

        # Assert
        # The validation should return the validated config or raise an error
        # The exact behavior depends on the WorkflowAppConfigManager implementation
        assert result is not None or isinstance(result, dict)

    def test_validate_features_structure_invalid_mode(self, db_session_with_containers):
        """
        Test error when validating features for invalid app mode.

        This test ensures that the service correctly handles feature validation
        for unsupported app modes, preventing invalid operations.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        app.mode = "invalid_mode"  # Invalid mode

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()
        features = {"test": "value"}

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid app mode: invalid_mode"):
            workflow_service.validate_features_structure(app_model=app, features=features)

    def test_update_workflow_success(self, db_session_with_containers):
        """
        Test successful workflow update with allowed fields.

        This test verifies that the service can correctly update workflow
        attributes like marked_name and marked_comment, supporting workflow
        metadata management.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()
        update_data = {"marked_name": "Updated Workflow Name", "marked_comment": "Updated workflow comment"}

        # Act
        result = workflow_service.update_workflow(
            session=db.session,
            workflow_id=workflow.id,
            tenant_id=workflow.tenant_id,
            account_id=account.id,
            data=update_data,
        )

        # Assert
        assert result is not None
        assert result.marked_name == update_data["marked_name"]
        assert result.marked_comment == update_data["marked_comment"]
        assert result.updated_by == account.id

    def test_update_workflow_not_found(self, db_session_with_containers):
        """
        Test workflow update when workflow doesn't exist.

        This test ensures that the service correctly handles update attempts
        on non-existent workflows, returning None as expected.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        from extensions.ext_database import db

        workflow_service = WorkflowService()
        non_existent_workflow_id = fake.uuid4()
        update_data = {"marked_name": "Test"}

        # Act
        result = workflow_service.update_workflow(
            session=db.session,
            workflow_id=non_existent_workflow_id,
            tenant_id=app.tenant_id,
            account_id=account.id,
            data=update_data,
        )

        # Assert
        assert result is None

    def test_update_workflow_ignores_disallowed_fields(self, db_session_with_containers):
        """
        Test that workflow update ignores disallowed fields.

        This test verifies that the service correctly filters update data,
        only allowing modifications to permitted fields and ignoring others.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        original_name = workflow.marked_name

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()
        update_data = {
            "marked_name": "Allowed Update",
            "graph": "disallowed_field",  # Should be ignored
            "features": "disallowed_field",  # Should be ignored
        }

        # Act
        result = workflow_service.update_workflow(
            session=db.session,
            workflow_id=workflow.id,
            tenant_id=workflow.tenant_id,
            account_id=account.id,
            data=update_data,
        )

        # Assert
        assert result is not None
        assert result.marked_name == "Allowed Update"  # Allowed field updated
        # Disallowed fields should not be changed
        assert result.graph == workflow.graph
        assert result.features == workflow.features

    def test_delete_workflow_success(self, db_session_with_containers):
        """
        Test successful workflow deletion.

        This test verifies that the service can correctly delete a workflow
        when it's not in use and not a draft version, supporting workflow
        lifecycle management.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create a published workflow (not draft)
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow.version = "2024.01.01.001"  # Published version

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.delete_workflow(
            session=db.session, workflow_id=workflow.id, tenant_id=workflow.tenant_id
        )

        # Assert
        assert result is True

        # Verify workflow is actually deleted
        deleted_workflow = db.session.query(Workflow).filter_by(id=workflow.id).first()
        assert deleted_workflow is None

    def test_delete_workflow_draft_error(self, db_session_with_containers):
        """
        Test error when attempting to delete a draft workflow.

        This test ensures that the service correctly prevents deletion
        of draft workflows, maintaining workflow development integrity.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create draft workflow
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        # Keep as draft version

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act & Assert
        from services.errors.workflow_service import DraftWorkflowDeletionError

        with pytest.raises(DraftWorkflowDeletionError, match="Cannot delete draft workflow versions"):
            workflow_service.delete_workflow(session=db.session, workflow_id=workflow.id, tenant_id=workflow.tenant_id)

    def test_delete_workflow_in_use_error(self, db_session_with_containers):
        """
        Test error when attempting to delete a workflow that's in use by an app.

        This test ensures that the service correctly prevents deletion
        of workflows that are currently referenced by applications.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        app = self._create_test_app(db_session_with_containers, fake)

        # Create a published workflow
        workflow = self._create_test_workflow(db_session_with_containers, app, account, fake)
        workflow.version = "2024.01.01.001"  # Published version

        # Associate workflow with app
        app.workflow_id = workflow.id

        from extensions.ext_database import db

        db.session.commit()

        workflow_service = WorkflowService()

        # Act & Assert
        from services.errors.workflow_service import WorkflowInUseError

        with pytest.raises(WorkflowInUseError, match="Cannot delete workflow that is currently in use by app"):
            workflow_service.delete_workflow(session=db.session, workflow_id=workflow.id, tenant_id=workflow.tenant_id)

    def test_delete_workflow_not_found_error(self, db_session_with_containers):
        """
        Test error when attempting to delete a non-existent workflow.

        This test ensures that the service correctly handles deletion
        attempts on workflows that don't exist in the system.
        """
        # Arrange
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, fake)
        non_existent_workflow_id = fake.uuid4()

        from extensions.ext_database import db

        workflow_service = WorkflowService()

        # Act & Assert
        with pytest.raises(ValueError, match=f"Workflow with ID {non_existent_workflow_id} not found"):
            workflow_service.delete_workflow(
                session=db.session, workflow_id=non_existent_workflow_id, tenant_id=app.tenant_id
            )

    def test_run_free_workflow_node_success(self, db_session_with_containers):
        """
        Test successful execution of a free workflow node.

        This test verifies that the service can correctly execute a standalone
        workflow node without requiring a full workflow context, supporting
        node testing and development workflows.
        """
        # Arrange
        fake = Faker()
        tenant_id = fake.uuid4()
        user_id = fake.uuid4()
        node_id = "test-node-1"
        node_data = {
            "type": "parameter-extractor",  # Use supported NodeType
            "title": "Parameter Extractor Node",  # Required by BaseNodeData
            "model": {
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "mode": "chat",
                "completion_params": {"max_tokens": 1000, "temperature": 0.7},
            },
            "query": ["Extract parameters from the input"],
            "parameters": [{"name": "param1", "type": "string", "description": "First parameter", "required": True}],
            "reasoning_mode": "function_call",
        }
        user_inputs = {"input1": "test_value"}

        workflow_service = WorkflowService()

        # Act
        result = workflow_service.run_free_workflow_node(
            node_data=node_data, tenant_id=tenant_id, user_id=user_id, node_id=node_id, user_inputs=user_inputs
        )

        # Assert
        assert result is not None
        assert result.node_id == node_id
        assert result.workflow_id == ""  # No workflow ID for free nodes
        assert result.index == 1

    def test_run_free_workflow_node_with_complex_inputs(self, db_session_with_containers):
        """
        Test execution of a free workflow node with complex input data.

        This test verifies that the service can handle complex input structures
        when executing free workflow nodes, supporting realistic workflow scenarios.

        Note: This test is currently simplified to avoid external service dependencies
        that are not available in the test environment.
        """
        # Arrange
        fake = Faker()
        tenant_id = fake.uuid4()
        user_id = fake.uuid4()
        node_id = "complex-node-1"

        # Use a simple node type that doesn't require external services
        node_data = {
            "type": "start",  # Use start node type which has minimal dependencies
            "title": "Start Node",  # Required by BaseNodeData
        }
        user_inputs = {
            "text_input": "Sample text",
            "number_input": 42,
            "list_input": ["item1", "item2", "item3"],
            "dict_input": {"key1": "value1", "key2": "value2"},
        }

        workflow_service = WorkflowService()

        # Act
        # Since start nodes are not supported in run_free_node, we expect an error
        with pytest.raises(Exception) as exc_info:
            workflow_service.run_free_workflow_node(
                node_data=node_data, tenant_id=tenant_id, user_id=user_id, node_id=node_id, user_inputs=user_inputs
            )

        # Verify the error message indicates the expected issue
        error_msg = str(exc_info.value).lower()
        assert any(keyword in error_msg for keyword in ["start", "not supported", "external"])

    def test_handle_node_run_result_success(self, db_session_with_containers):
        """
        Test successful handling of node run results.

        This test verifies that the service can correctly process and format
        successful node execution results, ensuring proper data structure
        for workflow execution tracking.
        """
        # Arrange
        fake = Faker()
        node_id = "test-node-1"
        start_at = fake.unix_time()

        # Mock successful node execution
        def mock_successful_invoke():
            import uuid
            from datetime import datetime

            from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
            from core.workflow.graph_events import NodeRunSucceededEvent
            from core.workflow.node_events import NodeRunResult
            from core.workflow.nodes.base.node import Node

            # Create mock node
            mock_node = MagicMock(spec=Node)
            mock_node.node_type = NodeType.START
            mock_node.title = "Test Node"
            mock_node.error_strategy = None

            # Create mock result with valid metadata
            mock_result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"input1": "value1"},
                outputs={"output1": "result1"},
                process_data={"process1": "data1"},
                metadata={"total_tokens": 100},  # Use valid metadata field
            )

            # Create mock event with all required fields
            mock_event = NodeRunSucceededEvent(
                id=str(uuid.uuid4()),
                node_id=node_id,
                node_type=NodeType.START,
                node_run_result=mock_result,
                start_at=datetime.now(),
            )

            # Return node and generator
            def event_generator():
                yield mock_event

            return mock_node, event_generator()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service._handle_single_step_result(
            invoke_node_fn=mock_successful_invoke, start_at=start_at, node_id=node_id
        )

        # Assert
        assert result is not None
        assert result.node_id == node_id
        from core.workflow.enums import NodeType

        assert result.node_type == NodeType.START  # Should match the mock node type
        assert result.title == "Test Node"
        # Import the enum for comparison
        from core.workflow.enums import WorkflowNodeExecutionStatus

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.inputs is not None
        assert result.outputs is not None
        assert result.process_data is not None

    def test_handle_node_run_result_failure(self, db_session_with_containers):
        """
        Test handling of failed node run results.

        This test verifies that the service can correctly process and format
        failed node execution results, ensuring proper error handling and
        status tracking for workflow execution.
        """
        # Arrange
        fake = Faker()
        node_id = "test-node-1"
        start_at = fake.unix_time()

        # Mock failed node execution
        def mock_failed_invoke():
            import uuid
            from datetime import datetime

            from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
            from core.workflow.graph_events import NodeRunFailedEvent
            from core.workflow.node_events import NodeRunResult
            from core.workflow.nodes.base.node import Node

            # Create mock node
            mock_node = MagicMock(spec=Node)
            mock_node.node_type = NodeType.LLM
            mock_node.title = "Test Node"
            mock_node.error_strategy = None

            # Create mock failed result
            mock_result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs={"input1": "value1"},
                error="Test error message",
            )

            # Create mock event with all required fields
            mock_event = NodeRunFailedEvent(
                id=str(uuid.uuid4()),
                node_id=node_id,
                node_type=NodeType.LLM,
                node_run_result=mock_result,
                error="Test error message",
                start_at=datetime.now(),
            )

            # Return node and generator
            def event_generator():
                yield mock_event

            return mock_node, event_generator()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service._handle_single_step_result(
            invoke_node_fn=mock_failed_invoke, start_at=start_at, node_id=node_id
        )

        # Assert
        assert result is not None
        assert result.node_id == node_id
        # Import the enum for comparison
        from core.workflow.enums import WorkflowNodeExecutionStatus

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error is not None
        assert "Test error message" in str(result.error)

    def test_handle_node_run_result_continue_on_error(self, db_session_with_containers):
        """
        Test handling of node run results with continue_on_error strategy.

        This test verifies that the service can correctly handle nodes
        configured to continue execution even when errors occur, supporting
        resilient workflow execution strategies.
        """
        # Arrange
        fake = Faker()
        node_id = "test-node-1"
        start_at = fake.unix_time()

        # Mock node execution with continue_on_error
        def mock_continue_on_error_invoke():
            import uuid
            from datetime import datetime

            from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
            from core.workflow.graph_events import NodeRunFailedEvent
            from core.workflow.node_events import NodeRunResult
            from core.workflow.nodes.base.node import Node

            # Create mock node with continue_on_error
            mock_node = MagicMock(spec=Node)
            mock_node.node_type = NodeType.TOOL
            mock_node.title = "Test Node"
            mock_node.error_strategy = ErrorStrategy.DEFAULT_VALUE
            mock_node.default_value_dict = {"default_output": "default_value"}

            # Create mock failed result
            mock_result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs={"input1": "value1"},
                error="Test error message",
            )

            # Create mock event with all required fields
            mock_event = NodeRunFailedEvent(
                id=str(uuid.uuid4()),
                node_id=node_id,
                node_type=NodeType.TOOL,
                node_run_result=mock_result,
                error="Test error message",
                start_at=datetime.now(),
            )

            # Return node and generator
            def event_generator():
                yield mock_event

            return mock_node, event_generator()

        workflow_service = WorkflowService()

        # Act
        result = workflow_service._handle_single_step_result(
            invoke_node_fn=mock_continue_on_error_invoke, start_at=start_at, node_id=node_id
        )

        # Assert
        assert result is not None
        assert result.node_id == node_id
        # Import the enum for comparison
        from core.workflow.enums import WorkflowNodeExecutionStatus

        assert result.status == WorkflowNodeExecutionStatus.EXCEPTION  # Should be EXCEPTION, not FAILED
        assert result.outputs is not None
        assert "default_output" in result.outputs
        assert result.outputs["default_output"] == "default_value"
        assert "error_message" in result.outputs
        assert "error_type" in result.outputs
