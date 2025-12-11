"""
Unit tests for WorkflowService.

This test suite covers:
- Workflow creation from template
- Workflow validation (graph and features structure)
- Draft/publish transitions
- Version management
- Execution triggering
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from core.workflow.enums import NodeType
from libs.datetime_utils import naive_utc_now
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.errors.app import IsDraftWorkflowError, TriggerNodeLimitExceededError, WorkflowHashNotEqualError
from services.errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from services.workflow_service import WorkflowService


class TestWorkflowAssociatedDataFactory:
    """
    Factory class for creating test data and mock objects for workflow service tests.

    This factory provides reusable methods to create mock objects for:
    - App models with configurable attributes
    - Workflow models with graph and feature configurations
    - Account models for user authentication
    - Valid workflow graph structures for testing

    All factory methods return MagicMock objects that simulate database models
    without requiring actual database connections.
    """

    @staticmethod
    def create_app_mock(
        app_id: str = "app-123",
        tenant_id: str = "tenant-456",
        mode: str = AppMode.WORKFLOW.value,
        workflow_id: str | None = None,
        **kwargs,
    ) -> MagicMock:
        """
        Create a mock App with specified attributes.

        Args:
            app_id: Unique identifier for the app
            tenant_id: Workspace/tenant identifier
            mode: App mode (workflow, chat, completion, etc.)
            workflow_id: Optional ID of the published workflow
            **kwargs: Additional attributes to set on the mock

        Returns:
            MagicMock object configured as an App model
        """
        app = MagicMock(spec=App)
        app.id = app_id
        app.tenant_id = tenant_id
        app.mode = mode
        app.workflow_id = workflow_id
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_workflow_mock(
        workflow_id: str = "workflow-789",
        tenant_id: str = "tenant-456",
        app_id: str = "app-123",
        version: str = Workflow.VERSION_DRAFT,
        workflow_type: str = WorkflowType.WORKFLOW.value,
        graph: dict | None = None,
        features: dict | None = None,
        unique_hash: str | None = None,
        **kwargs,
    ) -> MagicMock:
        """
        Create a mock Workflow with specified attributes.

        Args:
            workflow_id: Unique identifier for the workflow
            tenant_id: Workspace/tenant identifier
            app_id: Associated app identifier
            version: Workflow version ("draft" or timestamp-based version)
            workflow_type: Type of workflow (workflow, chat, rag-pipeline)
            graph: Workflow graph structure containing nodes and edges
            features: Feature configuration (file upload, text-to-speech, etc.)
            unique_hash: Hash for optimistic locking during updates
            **kwargs: Additional attributes to set on the mock

        Returns:
            MagicMock object configured as a Workflow model with graph/features
        """
        workflow = MagicMock(spec=Workflow)
        workflow.id = workflow_id
        workflow.tenant_id = tenant_id
        workflow.app_id = app_id
        workflow.version = version
        workflow.type = workflow_type

        # Set up graph and features with defaults if not provided
        # Graph contains the workflow structure (nodes and their connections)
        if graph is None:
            graph = {"nodes": [], "edges": []}
        # Features contain app-level configurations like file upload settings
        if features is None:
            features = {}

        workflow.graph = json.dumps(graph)
        workflow.features = json.dumps(features)
        workflow.graph_dict = graph
        workflow.features_dict = features
        workflow.unique_hash = unique_hash or "test-hash-123"
        workflow.environment_variables = []
        workflow.conversation_variables = []
        workflow.rag_pipeline_variables = []
        workflow.created_by = "user-123"
        workflow.updated_by = None
        workflow.created_at = naive_utc_now()
        workflow.updated_at = naive_utc_now()

        # Mock walk_nodes method to iterate through workflow nodes
        # This is used by the service to traverse and validate workflow structure
        def walk_nodes_side_effect(specific_node_type=None):
            nodes = graph.get("nodes", [])
            # Filter by node type if specified (e.g., only LLM nodes)
            if specific_node_type:
                return (
                    (node["id"], node["data"])
                    for node in nodes
                    if node.get("data", {}).get("type") == specific_node_type.value
                )
            # Return all nodes if no filter specified
            return ((node["id"], node["data"]) for node in nodes)

        workflow.walk_nodes = walk_nodes_side_effect

        for key, value in kwargs.items():
            setattr(workflow, key, value)
        return workflow

    @staticmethod
    def create_account_mock(account_id: str = "user-123", **kwargs) -> MagicMock:
        """Create a mock Account with specified attributes."""
        account = MagicMock()
        account.id = account_id
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_valid_workflow_graph(include_start: bool = True, include_trigger: bool = False) -> dict:
        """
        Create a valid workflow graph structure for testing.

        Args:
            include_start: Whether to include a START node (for regular workflows)
            include_trigger: Whether to include trigger nodes (webhook, schedule, etc.)

        Returns:
            Dictionary containing nodes and edges arrays representing workflow graph

        Note:
            Start nodes and trigger nodes cannot coexist in the same workflow.
            This is validated by the workflow service.
        """
        nodes = []
        edges = []

        # Add START node for regular workflows (user-initiated)
        if include_start:
            nodes.append(
                {
                    "id": "start",
                    "data": {
                        "type": NodeType.START.value,
                        "title": "START",
                        "variables": [],
                    },
                }
            )

        # Add trigger node for event-driven workflows (webhook, schedule, etc.)
        if include_trigger:
            nodes.append(
                {
                    "id": "trigger-1",
                    "data": {
                        "type": "http-request",
                        "title": "HTTP Request Trigger",
                    },
                }
            )

        # Add an LLM node as a sample processing node
        # This represents an AI model interaction in the workflow
        nodes.append(
            {
                "id": "llm-1",
                "data": {
                    "type": NodeType.LLM.value,
                    "title": "LLM",
                    "model": {
                        "provider": "openai",
                        "name": "gpt-4",
                    },
                },
            }
        )

        return {"nodes": nodes, "edges": edges}


class TestWorkflowService:
    """
    Comprehensive unit tests for WorkflowService methods.

    This test suite covers:
    - Workflow creation from template
    - Workflow validation (graph and features)
    - Draft/publish transitions
    - Version management
    - Workflow deletion and error handling
    """

    @pytest.fixture
    def workflow_service(self):
        """
        Create a WorkflowService instance with mocked dependencies.

        This fixture patches the database to avoid real database connections
        during testing. Each test gets a fresh service instance.
        """
        with patch("services.workflow_service.db"):
            service = WorkflowService()
            return service

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing database operations.

        Provides mock implementations of:
        - session.add(): Adding new records
        - session.commit(): Committing transactions
        - session.query(): Querying database
        - session.execute(): Executing SQL statements
        """
        with patch("services.workflow_service.db") as mock_db:
            mock_session = MagicMock()
            mock_db.session = mock_session
            mock_session.add = MagicMock()
            mock_session.commit = MagicMock()
            mock_session.query = MagicMock()
            mock_session.execute = MagicMock()
            yield mock_db

    @pytest.fixture
    def mock_sqlalchemy_session(self):
        """
        Mock SQLAlchemy Session for publish_workflow tests.

        This is a separate fixture because publish_workflow uses
        SQLAlchemy's Session class directly rather than the Flask-SQLAlchemy
        db.session object.
        """
        mock_session = MagicMock()
        mock_session.add = MagicMock()
        mock_session.commit = MagicMock()
        mock_session.scalar = MagicMock()
        return mock_session

    # ==================== Workflow Existence Tests ====================
    # These tests verify the service can check if a draft workflow exists

    def test_is_workflow_exist_returns_true(self, workflow_service, mock_db_session):
        """
        Test is_workflow_exist returns True when draft workflow exists.

        Verifies that the service correctly identifies when an app has a draft workflow.
        This is used to determine whether to create or update a workflow.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()

        # Mock the database query to return True
        mock_db_session.session.execute.return_value.scalar_one.return_value = True

        result = workflow_service.is_workflow_exist(app)

        assert result is True

    def test_is_workflow_exist_returns_false(self, workflow_service, mock_db_session):
        """Test is_workflow_exist returns False when no draft workflow exists."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock()

        # Mock the database query to return False
        mock_db_session.session.execute.return_value.scalar_one.return_value = False

        result = workflow_service.is_workflow_exist(app)

        assert result is False

    # ==================== Get Draft Workflow Tests ====================
    # These tests verify retrieval of draft workflows (version="draft")

    def test_get_draft_workflow_success(self, workflow_service, mock_db_session):
        """
        Test get_draft_workflow returns draft workflow successfully.

        Draft workflows are the working copy that users edit before publishing.
        Each app can have only one draft workflow at a time.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock()

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = mock_workflow

        result = workflow_service.get_draft_workflow(app)

        assert result == mock_workflow

    def test_get_draft_workflow_returns_none(self, workflow_service, mock_db_session):
        """Test get_draft_workflow returns None when no draft exists."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock()

        # Mock database query to return None
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = None

        result = workflow_service.get_draft_workflow(app)

        assert result is None

    def test_get_draft_workflow_with_workflow_id(self, workflow_service, mock_db_session):
        """Test get_draft_workflow with workflow_id calls get_published_workflow_by_id."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        workflow_id = "workflow-123"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(version="v1")

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = mock_workflow

        result = workflow_service.get_draft_workflow(app, workflow_id=workflow_id)

        assert result == mock_workflow

    # ==================== Get Published Workflow Tests ====================
    # These tests verify retrieval of published workflows (versioned snapshots)

    def test_get_published_workflow_by_id_success(self, workflow_service, mock_db_session):
        """Test get_published_workflow_by_id returns published workflow."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        workflow_id = "workflow-123"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=workflow_id, version="v1")

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = mock_workflow

        result = workflow_service.get_published_workflow_by_id(app, workflow_id)

        assert result == mock_workflow

    def test_get_published_workflow_by_id_raises_error_for_draft(self, workflow_service, mock_db_session):
        """
        Test get_published_workflow_by_id raises error when workflow is draft.

        This prevents using draft workflows in production contexts where only
        published, stable versions should be used (e.g., API execution).
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        workflow_id = "workflow-123"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(
            workflow_id=workflow_id, version=Workflow.VERSION_DRAFT
        )

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = mock_workflow

        with pytest.raises(IsDraftWorkflowError):
            workflow_service.get_published_workflow_by_id(app, workflow_id)

    def test_get_published_workflow_by_id_returns_none(self, workflow_service, mock_db_session):
        """Test get_published_workflow_by_id returns None when workflow not found."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        workflow_id = "nonexistent-workflow"

        # Mock database query to return None
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = None

        result = workflow_service.get_published_workflow_by_id(app, workflow_id)

        assert result is None

    def test_get_published_workflow_success(self, workflow_service, mock_db_session):
        """Test get_published_workflow returns published workflow."""
        workflow_id = "workflow-123"
        app = TestWorkflowAssociatedDataFactory.create_app_mock(workflow_id=workflow_id)
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=workflow_id, version="v1")

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = mock_workflow

        result = workflow_service.get_published_workflow(app)

        assert result == mock_workflow

    def test_get_published_workflow_returns_none_when_no_workflow_id(self, workflow_service):
        """Test get_published_workflow returns None when app has no workflow_id."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock(workflow_id=None)

        result = workflow_service.get_published_workflow(app)

        assert result is None

    # ==================== Sync Draft Workflow Tests ====================
    # These tests verify creating and updating draft workflows with validation

    def test_sync_draft_workflow_creates_new_draft(self, workflow_service, mock_db_session):
        """
        Test sync_draft_workflow creates new draft workflow when none exists.

        When a user first creates a workflow app, this creates the initial draft.
        The draft is validated before creation to ensure graph and features are valid.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        graph = TestWorkflowAssociatedDataFactory.create_valid_workflow_graph()
        features = {"file_upload": {"enabled": False}}

        # Mock get_draft_workflow to return None (no existing draft)
        # This simulates the first time a workflow is created for an app
        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = None

        with (
            patch.object(workflow_service, "validate_features_structure"),
            patch.object(workflow_service, "validate_graph_structure"),
            patch("services.workflow_service.app_draft_workflow_was_synced"),
        ):
            result = workflow_service.sync_draft_workflow(
                app_model=app,
                graph=graph,
                features=features,
                unique_hash=None,
                account=account,
                environment_variables=[],
                conversation_variables=[],
            )

            # Verify workflow was added to session
            mock_db_session.session.add.assert_called_once()
            mock_db_session.session.commit.assert_called_once()

    def test_sync_draft_workflow_updates_existing_draft(self, workflow_service, mock_db_session):
        """
        Test sync_draft_workflow updates existing draft workflow.

        When users edit their workflow, this updates the existing draft.
        The unique_hash is used for optimistic locking to prevent conflicts.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        graph = TestWorkflowAssociatedDataFactory.create_valid_workflow_graph()
        features = {"file_upload": {"enabled": False}}
        unique_hash = "test-hash-123"

        # Mock existing draft workflow
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(unique_hash=unique_hash)

        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = mock_workflow

        with (
            patch.object(workflow_service, "validate_features_structure"),
            patch.object(workflow_service, "validate_graph_structure"),
            patch("services.workflow_service.app_draft_workflow_was_synced"),
        ):
            result = workflow_service.sync_draft_workflow(
                app_model=app,
                graph=graph,
                features=features,
                unique_hash=unique_hash,
                account=account,
                environment_variables=[],
                conversation_variables=[],
            )

            # Verify workflow was updated
            assert mock_workflow.graph == json.dumps(graph)
            assert mock_workflow.features == json.dumps(features)
            assert mock_workflow.updated_by == account.id
            mock_db_session.session.commit.assert_called_once()

    def test_sync_draft_workflow_raises_hash_not_equal_error(self, workflow_service, mock_db_session):
        """
        Test sync_draft_workflow raises error when hash doesn't match.

        This implements optimistic locking: if the workflow was modified by another
        user/session since it was loaded, the hash won't match and the update fails.
        This prevents overwriting concurrent changes.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        graph = TestWorkflowAssociatedDataFactory.create_valid_workflow_graph()
        features = {}

        # Mock existing draft workflow with different hash
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(unique_hash="old-hash")

        mock_query = MagicMock()
        mock_db_session.session.query.return_value = mock_query
        mock_query.where.return_value.first.return_value = mock_workflow

        with pytest.raises(WorkflowHashNotEqualError):
            workflow_service.sync_draft_workflow(
                app_model=app,
                graph=graph,
                features=features,
                unique_hash="new-hash",
                account=account,
                environment_variables=[],
                conversation_variables=[],
            )

    # ==================== Workflow Validation Tests ====================
    # These tests verify graph structure and feature configuration validation

    def test_validate_graph_structure_empty_graph(self, workflow_service):
        """Test validate_graph_structure accepts empty graph."""
        graph = {"nodes": []}

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_graph_structure_valid_graph(self, workflow_service):
        """Test validate_graph_structure accepts valid graph."""
        graph = TestWorkflowAssociatedDataFactory.create_valid_workflow_graph()

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_graph_structure_start_and_trigger_coexist_raises_error(self, workflow_service):
        """
        Test validate_graph_structure raises error when start and trigger nodes coexist.

        Workflows can be either:
        - User-initiated (with START node): User provides input to start execution
        - Event-driven (with trigger nodes): External events trigger execution

        These two patterns cannot be mixed in a single workflow.
        """
        # Create a graph with both start and trigger nodes
        # Use actual trigger node types: trigger-webhook, trigger-schedule, trigger-plugin
        graph = {
            "nodes": [
                {
                    "id": "start",
                    "data": {
                        "type": "start",
                        "title": "START",
                    },
                },
                {
                    "id": "trigger-1",
                    "data": {
                        "type": "trigger-webhook",
                        "title": "Webhook Trigger",
                    },
                },
            ],
            "edges": [],
        }

        with pytest.raises(ValueError, match="Start node and trigger nodes cannot coexist"):
            workflow_service.validate_graph_structure(graph)

    def test_validate_features_structure_workflow_mode(self, workflow_service):
        """
        Test validate_features_structure for workflow mode.

        Different app modes have different feature configurations.
        This ensures the features match the expected schema for workflow apps.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.WORKFLOW.value)
        features = {"file_upload": {"enabled": False}}

        with patch("services.workflow_service.WorkflowAppConfigManager.config_validate") as mock_validate:
            workflow_service.validate_features_structure(app, features)
            mock_validate.assert_called_once_with(
                tenant_id=app.tenant_id, config=features, only_structure_validate=True
            )

    def test_validate_features_structure_advanced_chat_mode(self, workflow_service):
        """Test validate_features_structure for advanced chat mode."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.ADVANCED_CHAT.value)
        features = {"opening_statement": "Hello"}

        with patch("services.workflow_service.AdvancedChatAppConfigManager.config_validate") as mock_validate:
            workflow_service.validate_features_structure(app, features)
            mock_validate.assert_called_once_with(
                tenant_id=app.tenant_id, config=features, only_structure_validate=True
            )

    def test_validate_features_structure_invalid_mode_raises_error(self, workflow_service):
        """Test validate_features_structure raises error for invalid mode."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.COMPLETION.value)
        features = {}

        with pytest.raises(ValueError, match="Invalid app mode"):
            workflow_service.validate_features_structure(app, features)

    # ==================== Publish Workflow Tests ====================
    # These tests verify creating published versions from draft workflows

    def test_publish_workflow_success(self, workflow_service, mock_sqlalchemy_session):
        """
        Test publish_workflow creates new published version.

        Publishing creates a timestamped snapshot of the draft workflow.
        This allows users to:
        - Roll back to previous versions
        - Use stable versions in production
        - Continue editing draft without affecting published version
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        graph = TestWorkflowAssociatedDataFactory.create_valid_workflow_graph()

        # Mock draft workflow
        mock_draft = TestWorkflowAssociatedDataFactory.create_workflow_mock(version=Workflow.VERSION_DRAFT, graph=graph)
        mock_sqlalchemy_session.scalar.return_value = mock_draft

        with (
            patch.object(workflow_service, "validate_graph_structure"),
            patch("services.workflow_service.app_published_workflow_was_updated"),
            patch("services.workflow_service.dify_config") as mock_config,
            patch("services.workflow_service.Workflow.new") as mock_workflow_new,
        ):
            # Disable billing
            mock_config.BILLING_ENABLED = False

            # Mock Workflow.new to return a new workflow
            mock_new_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(version="v1")
            mock_workflow_new.return_value = mock_new_workflow

            result = workflow_service.publish_workflow(
                session=mock_sqlalchemy_session,
                app_model=app,
                account=account,
                marked_name="Version 1",
                marked_comment="Initial release",
            )

            # Verify workflow was added to session
            mock_sqlalchemy_session.add.assert_called_once_with(mock_new_workflow)
            assert result == mock_new_workflow

    def test_publish_workflow_no_draft_raises_error(self, workflow_service, mock_sqlalchemy_session):
        """
        Test publish_workflow raises error when no draft exists.

        Cannot publish if there's no draft to publish from.
        Users must create and save a draft before publishing.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        account = TestWorkflowAssociatedDataFactory.create_account_mock()

        # Mock no draft workflow
        mock_sqlalchemy_session.scalar.return_value = None

        with pytest.raises(ValueError, match="No valid workflow found"):
            workflow_service.publish_workflow(session=mock_sqlalchemy_session, app_model=app, account=account)

    def test_publish_workflow_trigger_limit_exceeded(self, workflow_service, mock_sqlalchemy_session):
        """
        Test publish_workflow raises error when trigger node limit exceeded in SANDBOX plan.

        Free/sandbox tier users have limits on the number of trigger nodes.
        This prevents resource abuse while allowing users to test the feature.
        The limit is enforced at publish time, not during draft editing.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        account = TestWorkflowAssociatedDataFactory.create_account_mock()

        # Create graph with 3 trigger nodes (exceeds SANDBOX limit of 2)
        # Trigger nodes enable event-driven automation which consumes resources
        graph = {
            "nodes": [
                {"id": "trigger-1", "data": {"type": "trigger-webhook"}},
                {"id": "trigger-2", "data": {"type": "trigger-schedule"}},
                {"id": "trigger-3", "data": {"type": "trigger-plugin"}},
            ],
            "edges": [],
        }
        mock_draft = TestWorkflowAssociatedDataFactory.create_workflow_mock(version=Workflow.VERSION_DRAFT, graph=graph)
        mock_sqlalchemy_session.scalar.return_value = mock_draft

        with (
            patch.object(workflow_service, "validate_graph_structure"),
            patch("services.workflow_service.dify_config") as mock_config,
            patch("services.workflow_service.BillingService") as MockBillingService,
            patch("services.workflow_service.app_published_workflow_was_updated"),
        ):
            # Enable billing and set SANDBOX plan
            mock_config.BILLING_ENABLED = True
            MockBillingService.get_info.return_value = {"subscription": {"plan": "sandbox"}}

            with pytest.raises(TriggerNodeLimitExceededError):
                workflow_service.publish_workflow(session=mock_sqlalchemy_session, app_model=app, account=account)

    # ==================== Version Management Tests ====================
    # These tests verify listing and managing published workflow versions

    def test_get_all_published_workflow_with_pagination(self, workflow_service):
        """
        Test get_all_published_workflow returns paginated results.

        Apps can have many published versions over time.
        Pagination prevents loading all versions at once, improving performance.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock(workflow_id="workflow-123")

        # Mock workflows
        mock_workflows = [
            TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=f"workflow-{i}", version=f"v{i}")
            for i in range(5)
        ]

        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = mock_workflows

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt
            mock_stmt.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_stmt.offset.return_value = mock_stmt

            workflows, has_more = workflow_service.get_all_published_workflow(
                session=mock_session, app_model=app, page=1, limit=10, user_id=None
            )

            assert len(workflows) == 5
            assert has_more is False

    def test_get_all_published_workflow_has_more(self, workflow_service):
        """
        Test get_all_published_workflow indicates has_more when results exceed limit.

        The has_more flag tells the UI whether to show a "Load More" button.
        This is determined by fetching limit+1 records and checking if we got that many.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock(workflow_id="workflow-123")

        # Mock 11 workflows (limit is 10, so has_more should be True)
        mock_workflows = [
            TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=f"workflow-{i}", version=f"v{i}")
            for i in range(11)
        ]

        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = mock_workflows

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt
            mock_stmt.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_stmt.offset.return_value = mock_stmt

            workflows, has_more = workflow_service.get_all_published_workflow(
                session=mock_session, app_model=app, page=1, limit=10, user_id=None
            )

            assert len(workflows) == 10
            assert has_more is True

    def test_get_all_published_workflow_no_workflow_id(self, workflow_service):
        """Test get_all_published_workflow returns empty when app has no workflow_id."""
        app = TestWorkflowAssociatedDataFactory.create_app_mock(workflow_id=None)
        mock_session = MagicMock()

        workflows, has_more = workflow_service.get_all_published_workflow(
            session=mock_session, app_model=app, page=1, limit=10, user_id=None
        )

        assert workflows == []
        assert has_more is False

    # ==================== Update Workflow Tests ====================
    # These tests verify updating workflow metadata (name, comments, etc.)

    def test_update_workflow_success(self, workflow_service):
        """
        Test update_workflow updates workflow attributes.

        Allows updating metadata like marked_name and marked_comment
        without creating a new version. Only specific fields are allowed
        to prevent accidental modification of workflow logic.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        account_id = "user-123"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=workflow_id)

        mock_session = MagicMock()
        mock_session.scalar.return_value = mock_workflow

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt

            result = workflow_service.update_workflow(
                session=mock_session,
                workflow_id=workflow_id,
                tenant_id=tenant_id,
                account_id=account_id,
                data={"marked_name": "Updated Name", "marked_comment": "Updated Comment"},
            )

            assert result == mock_workflow
            assert mock_workflow.marked_name == "Updated Name"
            assert mock_workflow.marked_comment == "Updated Comment"
            assert mock_workflow.updated_by == account_id

    def test_update_workflow_not_found(self, workflow_service):
        """Test update_workflow returns None when workflow not found."""
        mock_session = MagicMock()
        mock_session.scalar.return_value = None

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt

            result = workflow_service.update_workflow(
                session=mock_session,
                workflow_id="nonexistent",
                tenant_id="tenant-456",
                account_id="user-123",
                data={"marked_name": "Test"},
            )

            assert result is None

    # ==================== Delete Workflow Tests ====================
    # These tests verify workflow deletion with safety checks

    def test_delete_workflow_success(self, workflow_service):
        """
        Test delete_workflow successfully deletes a published workflow.

        Users can delete old published versions they no longer need.
        This helps manage storage and keeps the version list clean.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=workflow_id, version="v1")

        mock_session = MagicMock()
        # Mock successful deletion scenario:
        # 1. Workflow exists
        # 2. No app is currently using it
        # 3. Not published as a tool
        mock_session.scalar.side_effect = [mock_workflow, None]  # workflow exists, no app using it
        mock_session.query.return_value.where.return_value.first.return_value = None  # no tool provider

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt

            result = workflow_service.delete_workflow(
                session=mock_session, workflow_id=workflow_id, tenant_id=tenant_id
            )

            assert result is True
            mock_session.delete.assert_called_once_with(mock_workflow)

    def test_delete_workflow_draft_raises_error(self, workflow_service):
        """
        Test delete_workflow raises error when trying to delete draft.

        Draft workflows cannot be deleted - they're the working copy.
        Users can only delete published versions to clean up old snapshots.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(
            workflow_id=workflow_id, version=Workflow.VERSION_DRAFT
        )

        mock_session = MagicMock()
        mock_session.scalar.return_value = mock_workflow

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt

            with pytest.raises(DraftWorkflowDeletionError, match="Cannot delete draft workflow"):
                workflow_service.delete_workflow(session=mock_session, workflow_id=workflow_id, tenant_id=tenant_id)

    def test_delete_workflow_in_use_by_app_raises_error(self, workflow_service):
        """
        Test delete_workflow raises error when workflow is in use by app.

        Cannot delete a workflow version that's currently published/active.
        This would break the app for users. Must publish a different version first.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=workflow_id, version="v1")
        mock_app = TestWorkflowAssociatedDataFactory.create_app_mock(workflow_id=workflow_id)

        mock_session = MagicMock()
        mock_session.scalar.side_effect = [mock_workflow, mock_app]

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt

            with pytest.raises(WorkflowInUseError, match="currently in use by app"):
                workflow_service.delete_workflow(session=mock_session, workflow_id=workflow_id, tenant_id=tenant_id)

    def test_delete_workflow_published_as_tool_raises_error(self, workflow_service):
        """
        Test delete_workflow raises error when workflow is published as tool.

        Workflows can be published as reusable tools for other workflows.
        Cannot delete a version that's being used as a tool, as this would
        break other workflows that depend on it.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        mock_workflow = TestWorkflowAssociatedDataFactory.create_workflow_mock(workflow_id=workflow_id, version="v1")
        mock_tool_provider = MagicMock()

        mock_session = MagicMock()
        mock_session.scalar.side_effect = [mock_workflow, None]  # workflow exists, no app using it
        mock_session.query.return_value.where.return_value.first.return_value = mock_tool_provider

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt

            with pytest.raises(WorkflowInUseError, match="published as a tool"):
                workflow_service.delete_workflow(session=mock_session, workflow_id=workflow_id, tenant_id=tenant_id)

    def test_delete_workflow_not_found_raises_error(self, workflow_service):
        """Test delete_workflow raises error when workflow not found."""
        workflow_id = "nonexistent"
        tenant_id = "tenant-456"

        mock_session = MagicMock()
        mock_session.scalar.return_value = None

        with patch("services.workflow_service.select") as mock_select:
            mock_stmt = MagicMock()
            mock_select.return_value = mock_stmt
            mock_stmt.where.return_value = mock_stmt

            with pytest.raises(ValueError, match="not found"):
                workflow_service.delete_workflow(session=mock_session, workflow_id=workflow_id, tenant_id=tenant_id)

    # ==================== Get Default Block Config Tests ====================
    # These tests verify retrieval of default node configurations

    def test_get_default_block_configs(self, workflow_service):
        """
        Test get_default_block_configs returns list of default configs.

        Returns default configurations for all available node types.
        Used by the UI to populate the node palette and provide sensible defaults
        when users add new nodes to their workflow.
        """
        with patch("services.workflow_service.NODE_TYPE_CLASSES_MAPPING") as mock_mapping:
            # Mock node class with default config
            mock_node_class = MagicMock()
            mock_node_class.get_default_config.return_value = {"type": "llm", "config": {}}

            mock_mapping.values.return_value = [{"latest": mock_node_class}]

            with patch("services.workflow_service.LATEST_VERSION", "latest"):
                result = workflow_service.get_default_block_configs()

                assert len(result) > 0

    def test_get_default_block_config_for_node_type(self, workflow_service):
        """
        Test get_default_block_config returns config for specific node type.

        Returns the default configuration for a specific node type (e.g., LLM, HTTP).
        This includes default values for all required and optional parameters.
        """
        with (
            patch("services.workflow_service.NODE_TYPE_CLASSES_MAPPING") as mock_mapping,
            patch("services.workflow_service.LATEST_VERSION", "latest"),
        ):
            # Mock node class with default config
            mock_node_class = MagicMock()
            mock_config = {"type": "llm", "config": {"provider": "openai"}}
            mock_node_class.get_default_config.return_value = mock_config

            # Create a mock mapping that includes NodeType.LLM
            mock_mapping.__contains__.return_value = True
            mock_mapping.__getitem__.return_value = {"latest": mock_node_class}

            result = workflow_service.get_default_block_config(NodeType.LLM.value)

            assert result == mock_config
            mock_node_class.get_default_config.assert_called_once()

    def test_get_default_block_config_invalid_node_type(self, workflow_service):
        """Test get_default_block_config returns empty dict for invalid node type."""
        with patch("services.workflow_service.NODE_TYPE_CLASSES_MAPPING") as mock_mapping:
            # Mock mapping to not contain the node type
            mock_mapping.__contains__.return_value = False

            # Use a valid NodeType but one that's not in the mapping
            result = workflow_service.get_default_block_config(NodeType.LLM.value)

            assert result == {}

    # ==================== Workflow Conversion Tests ====================
    # These tests verify converting basic apps to workflow apps

    def test_convert_to_workflow_from_chat_app(self, workflow_service):
        """
        Test convert_to_workflow converts chat app to workflow.

        Allows users to migrate from simple chat apps to advanced workflow apps.
        The conversion creates equivalent workflow nodes from the chat configuration,
        giving users more control and customization options.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.CHAT.value)
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        args = {
            "name": "Converted Workflow",
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FFEAD5",
        }

        with patch("services.workflow_service.WorkflowConverter") as MockConverter:
            mock_converter = MockConverter.return_value
            mock_new_app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.WORKFLOW.value)
            mock_converter.convert_to_workflow.return_value = mock_new_app

            result = workflow_service.convert_to_workflow(app, account, args)

            assert result == mock_new_app
            mock_converter.convert_to_workflow.assert_called_once()

    def test_convert_to_workflow_from_completion_app(self, workflow_service):
        """
        Test convert_to_workflow converts completion app to workflow.

        Similar to chat conversion, but for completion-style apps.
        Completion apps are simpler (single prompt-response), so the
        conversion creates a basic workflow with fewer nodes.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.COMPLETION.value)
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        args = {"name": "Converted Workflow"}

        with patch("services.workflow_service.WorkflowConverter") as MockConverter:
            mock_converter = MockConverter.return_value
            mock_new_app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.WORKFLOW.value)
            mock_converter.convert_to_workflow.return_value = mock_new_app

            result = workflow_service.convert_to_workflow(app, account, args)

            assert result == mock_new_app

    def test_convert_to_workflow_invalid_mode_raises_error(self, workflow_service):
        """
        Test convert_to_workflow raises error for invalid app mode.

        Only chat and completion apps can be converted to workflows.
        Apps that are already workflows or have other modes cannot be converted.
        """
        app = TestWorkflowAssociatedDataFactory.create_app_mock(mode=AppMode.WORKFLOW.value)
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        args = {}

        with pytest.raises(ValueError, match="not supported convert to workflow"):
            workflow_service.convert_to_workflow(app, account, args)
