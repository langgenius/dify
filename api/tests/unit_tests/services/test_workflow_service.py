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
import uuid
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest

from dify_graph.entities import WorkflowNodeExecution
from dify_graph.enums import (
    BuiltinNodeTypes,
    ErrorStrategy,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from dify_graph.errors import WorkflowNodeRunFailedError
from dify_graph.graph_events import NodeRunFailedEvent, NodeRunSucceededEvent
from dify_graph.node_events import NodeRunResult
from dify_graph.nodes.http_request import HTTP_REQUEST_CONFIG_FILTER_KEY, HttpRequestNode, HttpRequestNodeConfig
from dify_graph.variables.input_entities import VariableEntityType
from libs.datetime_utils import naive_utc_now
from models.human_input import RecipientType
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.errors.app import IsDraftWorkflowError, TriggerNodeLimitExceededError, WorkflowHashNotEqualError
from services.errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from services.workflow_service import (
    WorkflowService,
    _rebuild_file_for_user_inputs_in_start_node,
    _rebuild_single_file,
    _setup_variable_pool,
)


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
                    if node.get("data", {}).get("type") == str(specific_node_type)
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
                        "type": BuiltinNodeTypes.START,
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
                    "type": BuiltinNodeTypes.LLM,
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

    def test_restore_published_workflow_to_draft_keeps_source_features_unmodified(
        self, workflow_service, mock_db_session
    ):
        app = TestWorkflowAssociatedDataFactory.create_app_mock()
        account = TestWorkflowAssociatedDataFactory.create_account_mock()
        legacy_features = {
            "file_upload": {
                "image": {
                    "enabled": True,
                    "number_limits": 6,
                    "transfer_methods": ["remote_url", "local_file"],
                }
            },
            "opening_statement": "",
            "retriever_resource": {"enabled": True},
            "sensitive_word_avoidance": {"enabled": False},
            "speech_to_text": {"enabled": False},
            "suggested_questions": [],
            "suggested_questions_after_answer": {"enabled": False},
            "text_to_speech": {"enabled": False, "language": "", "voice": ""},
        }
        normalized_features = {
            "file_upload": {
                "enabled": True,
                "allowed_file_types": ["image"],
                "allowed_file_extensions": [],
                "allowed_file_upload_methods": ["remote_url", "local_file"],
                "number_limits": 6,
            },
            "opening_statement": "",
            "retriever_resource": {"enabled": True},
            "sensitive_word_avoidance": {"enabled": False},
            "speech_to_text": {"enabled": False},
            "suggested_questions": [],
            "suggested_questions_after_answer": {"enabled": False},
            "text_to_speech": {"enabled": False, "language": "", "voice": ""},
        }
        source_workflow = Workflow(
            id="published-workflow-id",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW.value,
            version="2026-03-19T00:00:00",
            graph=json.dumps(TestWorkflowAssociatedDataFactory.create_valid_workflow_graph()),
            features=json.dumps(legacy_features),
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        draft_workflow = Workflow(
            id="draft-workflow-id",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW.value,
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps({"nodes": [], "edges": []}),
            features=json.dumps({}),
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        with (
            patch.object(workflow_service, "get_published_workflow_by_id", return_value=source_workflow),
            patch.object(workflow_service, "get_draft_workflow", return_value=draft_workflow),
            patch.object(workflow_service, "validate_graph_structure"),
            patch.object(workflow_service, "validate_features_structure") as mock_validate_features,
            patch("services.workflow_service.app_draft_workflow_was_synced"),
        ):
            result = workflow_service.restore_published_workflow_to_draft(
                app_model=app,
                workflow_id=source_workflow.id,
                account=account,
            )

        mock_validate_features.assert_called_once_with(app_model=app, features=normalized_features)
        assert result is draft_workflow
        assert source_workflow.serialized_features == json.dumps(legacy_features)
        assert draft_workflow.serialized_features == json.dumps(legacy_features)
        mock_db_session.session.commit.assert_called_once()

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
        with patch("services.workflow_service.get_node_type_classes_mapping") as mock_mapping:
            # Mock node class with default config
            mock_node_class = MagicMock()
            mock_node_class.get_default_config.return_value = {"type": "llm", "config": {}}

            mock_mapping.return_value = {BuiltinNodeTypes.LLM: {"latest": mock_node_class}}

            with patch("services.workflow_service.LATEST_VERSION", "latest"):
                result = workflow_service.get_default_block_configs()

                assert len(result) > 0

    def test_get_default_block_configs_http_request_injects_default_config(self, workflow_service):
        injected_config = HttpRequestNodeConfig(
            max_connect_timeout=15,
            max_read_timeout=25,
            max_write_timeout=35,
            max_binary_size=4096,
            max_text_size=2048,
            ssl_verify=True,
            ssrf_default_max_retries=6,
        )

        with (
            patch("services.workflow_service.get_node_type_classes_mapping") as mock_mapping,
            patch("services.workflow_service.LATEST_VERSION", "latest"),
            patch(
                "services.workflow_service.build_http_request_config",
                return_value=injected_config,
            ) as mock_build_config,
        ):
            mock_http_node_class = MagicMock()
            mock_http_node_class.get_default_config.return_value = {"type": "http-request", "config": {}}
            mock_llm_node_class = MagicMock()
            mock_llm_node_class.get_default_config.return_value = {"type": "llm", "config": {}}
            mock_mapping.return_value = {
                BuiltinNodeTypes.HTTP_REQUEST: {"latest": mock_http_node_class},
                BuiltinNodeTypes.LLM: {"latest": mock_llm_node_class},
            }

            result = workflow_service.get_default_block_configs()

            assert result == [
                {"type": "http-request", "config": {}},
                {"type": "llm", "config": {}},
            ]
            mock_build_config.assert_called_once()
            passed_http_filters = mock_http_node_class.get_default_config.call_args.kwargs["filters"]
            assert passed_http_filters[HTTP_REQUEST_CONFIG_FILTER_KEY] is injected_config
            mock_llm_node_class.get_default_config.assert_called_once_with(filters=None)

    def test_get_default_block_config_for_node_type(self, workflow_service):
        """
        Test get_default_block_config returns config for specific node type.

        Returns the default configuration for a specific node type (e.g., LLM, HTTP).
        This includes default values for all required and optional parameters.
        """
        with (
            patch("services.workflow_service.get_node_type_classes_mapping") as mock_mapping,
            patch("services.workflow_service.LATEST_VERSION", "latest"),
        ):
            # Mock node class with default config
            mock_node_class = MagicMock()
            mock_config = {"type": "llm", "config": {"provider": "openai"}}
            mock_node_class.get_default_config.return_value = mock_config

            # Create a mock mapping that includes BuiltinNodeTypes.LLM
            mock_mapping.return_value = {BuiltinNodeTypes.LLM: {"latest": mock_node_class}}

            result = workflow_service.get_default_block_config(BuiltinNodeTypes.LLM)

            assert result == mock_config
            mock_node_class.get_default_config.assert_called_once()

    def test_get_default_block_config_invalid_node_type(self, workflow_service):
        """Test get_default_block_config returns empty dict for invalid node type."""
        with patch("services.workflow_service.get_node_type_classes_mapping") as mock_mapping:
            mock_mapping.return_value = {}

            # Use a valid NodeType but one that's not in the mapping
            result = workflow_service.get_default_block_config(BuiltinNodeTypes.LLM)

            assert result == {}

    def test_get_default_block_config_http_request_injects_default_config(self, workflow_service):
        injected_config = HttpRequestNodeConfig(
            max_connect_timeout=11,
            max_read_timeout=22,
            max_write_timeout=33,
            max_binary_size=4096,
            max_text_size=2048,
            ssl_verify=False,
            ssrf_default_max_retries=7,
        )

        with (
            patch("services.workflow_service.get_node_type_classes_mapping") as mock_mapping,
            patch("services.workflow_service.LATEST_VERSION", "latest"),
            patch(
                "services.workflow_service.build_http_request_config",
                return_value=injected_config,
            ) as mock_build_config,
        ):
            mock_node_class = MagicMock()
            expected = {"type": "http-request", "config": {}}
            mock_node_class.get_default_config.return_value = expected
            mock_mapping.return_value = {BuiltinNodeTypes.HTTP_REQUEST: {"latest": mock_node_class}}

            result = workflow_service.get_default_block_config(BuiltinNodeTypes.HTTP_REQUEST)

            assert result == expected
            mock_build_config.assert_called_once()
            passed_filters = mock_node_class.get_default_config.call_args.kwargs["filters"]
            assert passed_filters[HTTP_REQUEST_CONFIG_FILTER_KEY] is injected_config

    def test_get_default_block_config_http_request_uses_passed_config(self, workflow_service):
        provided_config = HttpRequestNodeConfig(
            max_connect_timeout=13,
            max_read_timeout=23,
            max_write_timeout=34,
            max_binary_size=8192,
            max_text_size=4096,
            ssl_verify=True,
            ssrf_default_max_retries=2,
        )

        with (
            patch("services.workflow_service.get_node_type_classes_mapping") as mock_mapping,
            patch("services.workflow_service.LATEST_VERSION", "latest"),
            patch("services.workflow_service.build_http_request_config") as mock_build_config,
        ):
            mock_node_class = MagicMock()
            expected = {"type": "http-request", "config": {}}
            mock_node_class.get_default_config.return_value = expected
            mock_mapping.return_value = {BuiltinNodeTypes.HTTP_REQUEST: {"latest": mock_node_class}}

            result = workflow_service.get_default_block_config(
                BuiltinNodeTypes.HTTP_REQUEST,
                filters={HTTP_REQUEST_CONFIG_FILTER_KEY: provided_config},
            )

            assert result == expected
            mock_build_config.assert_not_called()
            passed_filters = mock_node_class.get_default_config.call_args.kwargs["filters"]
            assert passed_filters[HTTP_REQUEST_CONFIG_FILTER_KEY] is provided_config

    def test_get_default_block_config_http_request_malformed_config_raises_value_error(self, workflow_service):
        with (
            patch(
                "services.workflow_service.get_node_type_classes_mapping",
                return_value={BuiltinNodeTypes.HTTP_REQUEST: {"latest": HttpRequestNode}},
            ),
            patch("services.workflow_service.LATEST_VERSION", "latest"),
        ):
            with pytest.raises(ValueError, match="http_request_config must be an HttpRequestNodeConfig instance"):
                workflow_service.get_default_block_config(
                    BuiltinNodeTypes.HTTP_REQUEST,
                    filters={HTTP_REQUEST_CONFIG_FILTER_KEY: "invalid"},
                )

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


# ===========================================================================
# TestWorkflowServiceCredentialValidation
# Tests for _validate_workflow_credentials and related private helpers
# ===========================================================================


class TestWorkflowServiceCredentialValidation:
    """
    Tests for the private credential-validation helpers on WorkflowService.

    These helpers gate `publish_workflow` when `PluginManager` is enabled.
    Each test focuses on a distinct branch inside `_validate_workflow_credentials`,
    `_validate_llm_model_config`, `_check_default_tool_credential`, and the
    load-balancing path.
    """

    @pytest.fixture
    def service(self) -> WorkflowService:
        with patch("services.workflow_service.db"):
            return WorkflowService()

    @staticmethod
    def _make_workflow(nodes: list[dict]) -> MagicMock:
        wf = MagicMock(spec=Workflow)
        wf.tenant_id = "tenant-1"
        wf.app_id = "app-1"
        wf.graph_dict = {"nodes": nodes}
        return wf

    # --- _validate_workflow_credentials: tool node (with credential_id) ---

    def test_validate_workflow_credentials_should_check_tool_credential_when_credential_id_present(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        nodes = [
            {
                "id": "tool-node",
                "data": {
                    "type": "tool",
                    "provider_id": "my-provider",
                    "credential_id": "cred-123",
                },
            }
        ]
        workflow = self._make_workflow(nodes)

        # Act + Assert
        with patch("core.helper.credential_utils.check_credential_policy_compliance") as mock_check:
            # Should not raise; mock allows the call
            service._validate_workflow_credentials(workflow)
            mock_check.assert_called_once()

    def test_validate_workflow_credentials_should_check_default_credential_when_no_credential_id(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        nodes = [
            {
                "id": "tool-node",
                "data": {
                    "type": "tool",
                    "provider_id": "my-provider",
                    # No credential_id — should fall back to default
                },
            }
        ]
        workflow = self._make_workflow(nodes)

        # Act
        with patch.object(service, "_check_default_tool_credential") as mock_default:
            service._validate_workflow_credentials(workflow)

        # Assert
        mock_default.assert_called_once_with("tenant-1", "my-provider")

    def test_validate_workflow_credentials_should_skip_tool_node_without_provider(
        self, service: WorkflowService
    ) -> None:
        """Tool nodes without a provider_id should be silently skipped."""
        # Arrange
        nodes = [{"id": "tool-node", "data": {"type": "tool"}}]
        workflow = self._make_workflow(nodes)

        # Act + Assert (no error raised)
        with patch.object(service, "_check_default_tool_credential") as mock_default:
            service._validate_workflow_credentials(workflow)
            mock_default.assert_not_called()

    def test_validate_workflow_credentials_should_validate_llm_node_with_model_config(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        nodes = [
            {
                "id": "llm-node",
                "data": {
                    "type": "llm",
                    "model": {"provider": "openai", "name": "gpt-4"},
                },
            }
        ]
        workflow = self._make_workflow(nodes)

        # Act
        with (
            patch.object(service, "_validate_llm_model_config") as mock_llm,
            patch.object(service, "_validate_load_balancing_credentials"),
        ):
            service._validate_workflow_credentials(workflow)

        # Assert
        mock_llm.assert_called_once_with("tenant-1", "openai", "gpt-4")

    def test_validate_workflow_credentials_should_raise_for_llm_node_missing_model(
        self, service: WorkflowService
    ) -> None:
        """LLM nodes without provider AND name should raise ValueError."""
        # Arrange
        nodes = [
            {
                "id": "llm-node",
                "data": {"type": "llm", "model": {"provider": "openai"}},  # name missing
            }
        ]
        workflow = self._make_workflow(nodes)

        # Act + Assert
        with pytest.raises(ValueError, match="Missing provider or model configuration"):
            service._validate_workflow_credentials(workflow)

    def test_validate_workflow_credentials_should_wrap_unexpected_exception_in_value_error(
        self, service: WorkflowService
    ) -> None:
        """Non-ValueError exceptions from validation must be re-raised as ValueError."""
        # Arrange
        nodes = [
            {
                "id": "llm-node",
                "data": {
                    "type": "llm",
                    "model": {"provider": "openai", "name": "gpt-4"},
                },
            }
        ]
        workflow = self._make_workflow(nodes)

        # Act + Assert
        with patch.object(service, "_validate_llm_model_config", side_effect=RuntimeError("boom")):
            with pytest.raises(ValueError, match="boom"):
                service._validate_workflow_credentials(workflow)

    def test_validate_workflow_credentials_should_validate_agent_node_model(self, service: WorkflowService) -> None:
        # Arrange
        nodes = [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "agent_parameters": {
                        "model": {"value": {"provider": "openai", "model": "gpt-4"}},
                        "tools": {"value": []},
                    },
                },
            }
        ]
        workflow = self._make_workflow(nodes)

        # Act
        with (
            patch.object(service, "_validate_llm_model_config") as mock_llm,
            patch.object(service, "_validate_load_balancing_credentials"),
        ):
            service._validate_workflow_credentials(workflow)

        # Assert
        mock_llm.assert_called_once_with("tenant-1", "openai", "gpt-4")

    def test_validate_workflow_credentials_should_validate_agent_tools(self, service: WorkflowService) -> None:
        """Each agent tool with a provider should be checked for credential compliance."""
        # Arrange
        nodes = [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "agent_parameters": {
                        "model": {"value": {}},  # no model config
                        "tools": {
                            "value": [
                                {"provider_name": "provider-a", "credential_id": "cred-a"},
                                {"provider_name": "provider-b"},  # uses default
                            ]
                        },
                    },
                },
            }
        ]
        workflow = self._make_workflow(nodes)

        # Act
        with (
            patch("core.helper.credential_utils.check_credential_policy_compliance") as mock_check,
            patch.object(service, "_check_default_tool_credential") as mock_default,
        ):
            service._validate_workflow_credentials(workflow)

        # Assert
        mock_check.assert_called_once()  # provider-a has credential_id
        mock_default.assert_called_once_with("tenant-1", "provider-b")

    # --- _validate_llm_model_config ---

    def test_validate_llm_model_config_should_raise_value_error_on_failure(self, service: WorkflowService) -> None:
        """If ModelManager raises any exception it must be wrapped into ValueError."""
        # Arrange
        with patch("core.model_manager.ModelManager.get_model_instance", side_effect=RuntimeError("no key")):
            # Act + Assert
            with pytest.raises(ValueError, match="Failed to validate LLM model configuration"):
                service._validate_llm_model_config("tenant-1", "openai", "gpt-4")

    def test_validate_llm_model_config_success(self, service: WorkflowService) -> None:
        """Test success path with ProviderManager and Model entities."""
        mock_model = MagicMock()
        mock_model.model = "gpt-4"
        mock_model.provider.provider = "openai"

        mock_configs = MagicMock()
        mock_configs.get_models.return_value = [mock_model]

        with (
            patch("core.model_manager.ModelManager.get_model_instance"),
            patch("core.provider_manager.ProviderManager") as mock_pm_cls,
        ):
            mock_pm_cls.return_value.get_configurations.return_value = mock_configs

            # Act
            service._validate_llm_model_config("tenant-1", "openai", "gpt-4")

            # Assert
            mock_model.raise_for_status.assert_called_once()

    def test_validate_llm_model_config_model_not_found(self, service: WorkflowService) -> None:
        """Test ValueError when model is not found in provider configurations."""
        mock_configs = MagicMock()
        mock_configs.get_models.return_value = []  # No models

        with (
            patch("core.model_manager.ModelManager.get_model_instance"),
            patch("core.provider_manager.ProviderManager") as mock_pm_cls,
        ):
            mock_pm_cls.return_value.get_configurations.return_value = mock_configs

            # Act + Assert
            with pytest.raises(ValueError, match="Model gpt-4 not found for provider openai"):
                service._validate_llm_model_config("tenant-1", "openai", "gpt-4")

    # --- _check_default_tool_credential ---

    def test_check_default_tool_credential_should_silently_pass_when_no_provider_found(
        self, service: WorkflowService
    ) -> None:
        """Missing BuiltinToolProvider → plugin requires no credentials → no error."""
        # Arrange
        with patch("services.workflow_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = None

            # Act + Assert (should NOT raise)
            service._check_default_tool_credential("tenant-1", "some-provider")

    def test_check_default_tool_credential_should_raise_when_compliance_fails(self, service: WorkflowService) -> None:
        # Arrange
        mock_provider = MagicMock()
        mock_provider.id = "builtin-cred-id"
        with (
            patch("services.workflow_service.db") as mock_db,
            patch("core.helper.credential_utils.check_credential_policy_compliance", side_effect=Exception("denied")),
        ):
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
                mock_provider
            )

            # Act + Assert
            with pytest.raises(ValueError, match="Failed to validate default credential"):
                service._check_default_tool_credential("tenant-1", "some-provider")

    # --- _is_load_balancing_enabled ---

    def test_is_load_balancing_enabled_should_return_false_when_provider_not_found(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        with patch("services.workflow_service.db"):
            service_instance = WorkflowService()

        with patch("core.provider_manager.ProviderManager.get_configurations") as mock_get_configs:
            mock_configs = MagicMock()
            mock_configs.get.return_value = None  # provider not found
            mock_get_configs.return_value = mock_configs

            # Act
            result = service_instance._is_load_balancing_enabled("tenant-1", "openai", "gpt-4")

        # Assert
        assert result is False

    def test_is_load_balancing_enabled_should_return_true_when_setting_enabled(self, service: WorkflowService) -> None:
        # Arrange
        with patch("core.provider_manager.ProviderManager.get_configurations") as mock_get_configs:
            mock_provider_config = MagicMock()
            mock_provider_model_setting = MagicMock()
            mock_provider_model_setting.load_balancing_enabled = True
            mock_provider_config.get_provider_model_setting.return_value = mock_provider_model_setting

            mock_configs = MagicMock()
            mock_configs.get.return_value = mock_provider_config
            mock_get_configs.return_value = mock_configs

            # Act
            result = service._is_load_balancing_enabled("tenant-1", "openai", "gpt-4")

        # Assert
        assert result is True

    def test_is_load_balancing_enabled_should_return_false_on_exception(self, service: WorkflowService) -> None:
        """Any exception should be swallowed and return False."""
        # Arrange
        with patch("core.provider_manager.ProviderManager.get_configurations", side_effect=RuntimeError("db down")):
            # Act
            result = service._is_load_balancing_enabled("tenant-1", "openai", "gpt-4")

        # Assert
        assert result is False

    # --- _get_load_balancing_configs ---

    def test_get_load_balancing_configs_should_return_empty_list_on_exception(self, service: WorkflowService) -> None:
        """Any exception during LB config retrieval should return an empty list."""
        # Arrange
        with patch(
            "services.model_load_balancing_service.ModelLoadBalancingService.get_load_balancing_configs",
            side_effect=RuntimeError("fail"),
        ):
            # Act
            result = service._get_load_balancing_configs("tenant-1", "openai", "gpt-4")

        # Assert
        assert result == []

    def test_get_load_balancing_configs_should_merge_predefined_and_custom(self, service: WorkflowService) -> None:
        # Arrange
        predefined = [{"credential_id": "cred-a"}, {"credential_id": None}]
        custom = [{"credential_id": "cred-b"}]
        with patch(
            "services.model_load_balancing_service.ModelLoadBalancingService.get_load_balancing_configs",
            side_effect=[
                (None, predefined),  # first call: predefined-model
                (None, custom),  # second call: custom-model
            ],
        ):
            # Act
            result = service._get_load_balancing_configs("tenant-1", "openai", "gpt-4")

        # Assert — only entries with a credential_id should be returned
        assert len(result) == 2
        assert all(c["credential_id"] for c in result)

    # --- _validate_load_balancing_credentials ---

    def test_validate_load_balancing_credentials_should_skip_when_no_model_config(
        self, service: WorkflowService
    ) -> None:
        """Missing provider or model in node_data should be a no-op."""
        # Arrange
        workflow = self._make_workflow([])
        node_data: dict = {}  # no model key

        # Act + Assert (no error expected)
        service._validate_load_balancing_credentials(workflow, node_data, "node-1")

    def test_validate_load_balancing_credentials_should_skip_when_lb_not_enabled(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        workflow = self._make_workflow([])
        node_data = {"model": {"provider": "openai", "name": "gpt-4"}}

        # Act + Assert (no error expected)
        with patch.object(service, "_is_load_balancing_enabled", return_value=False):
            service._validate_load_balancing_credentials(workflow, node_data, "node-1")

    def test_validate_load_balancing_credentials_should_raise_when_compliance_fails(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        workflow = self._make_workflow([])
        node_data = {"model": {"provider": "openai", "name": "gpt-4"}}
        lb_configs = [{"credential_id": "cred-lb-1"}]

        # Act + Assert
        with (
            patch.object(service, "_is_load_balancing_enabled", return_value=True),
            patch.object(service, "_get_load_balancing_configs", return_value=lb_configs),
            patch(
                "core.helper.credential_utils.check_credential_policy_compliance",
                side_effect=Exception("policy violation"),
            ),
        ):
            with pytest.raises(ValueError, match="Invalid load balancing credentials"):
                service._validate_load_balancing_credentials(workflow, node_data, "node-1")


# ===========================================================================
# TestWorkflowServiceExecutionHelpers
# Tests for _apply_error_strategy, _populate_execution_result, _execute_node_safely
# ===========================================================================


class TestWorkflowServiceExecutionHelpers:
    """
    Tests for the private execution-result handling methods:
    _apply_error_strategy, _populate_execution_result, _execute_node_safely.
    """

    @pytest.fixture
    def service(self) -> WorkflowService:
        with patch("services.workflow_service.db"):
            return WorkflowService()

    # --- _apply_error_strategy ---

    def test_apply_error_strategy_should_return_exception_status_noderunresult(self, service: WorkflowService) -> None:
        # Arrange
        node = MagicMock()
        node.error_strategy = ErrorStrategy.FAIL_BRANCH
        node.default_value_dict = {}
        original = NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error="something went wrong",
            error_type="SomeError",
            inputs={"x": 1},
            outputs={},
        )

        # Act
        result = service._apply_error_strategy(node, original)

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.EXCEPTION
        assert result.error == "something went wrong"
        assert result.metadata[WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY] == ErrorStrategy.FAIL_BRANCH

    def test_apply_error_strategy_should_include_default_values_for_default_value_strategy(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        node = MagicMock()
        node.error_strategy = ErrorStrategy.DEFAULT_VALUE
        node.default_value_dict = {"output_key": "fallback"}
        original = NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error="err",
        )

        # Act
        result = service._apply_error_strategy(node, original)

        # Assert
        assert result.outputs.get("output_key") == "fallback"
        assert result.status == WorkflowNodeExecutionStatus.EXCEPTION

    # --- _populate_execution_result ---

    def test_populate_execution_result_should_set_succeeded_fields_when_run_succeeded(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        node_execution = MagicMock(error=None)
        node_run_result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"q": "hello"},
            process_data={"steps": 3},
            outputs={"answer": "hi"},
            metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 10},
        )

        # Act
        with patch("services.workflow_service.WorkflowEntry.handle_special_values", side_effect=lambda x: x):
            service._populate_execution_result(node_execution, node_run_result, True, None)

        # Assert
        assert node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert node_execution.outputs == {"answer": "hi"}
        assert node_execution.error is None  # SUCCEEDED status doesn't set error

    def test_populate_execution_result_should_set_failed_status_and_error_when_not_succeeded(
        self, service: WorkflowService
    ) -> None:
        # Arrange
        node_execution = MagicMock(error=None)

        # Act
        service._populate_execution_result(node_execution, None, False, "catastrophic failure")

        # Assert
        assert node_execution.status == WorkflowNodeExecutionStatus.FAILED
        assert node_execution.error == "catastrophic failure"

    def test_populate_execution_result_should_set_error_field_for_exception_status(
        self, service: WorkflowService
    ) -> None:
        """A succeeded=True result with EXCEPTION status should still populate the error field."""
        # Arrange
        node_execution = MagicMock()
        node_run_result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.EXCEPTION,
            error="constraint violated",
        )

        # Act
        with patch("services.workflow_service.WorkflowEntry.handle_special_values", side_effect=lambda x: x):
            service._populate_execution_result(node_execution, node_run_result, True, None)

        # Assert
        assert node_execution.status == WorkflowNodeExecutionStatus.EXCEPTION
        assert node_execution.error == "constraint violated"

    # --- _execute_node_safely ---

    def test_execute_node_safely_should_return_succeeded_result_on_happy_path(self, service: WorkflowService) -> None:
        # Arrange
        node = MagicMock()
        node.error_strategy = None
        node_run_result = MagicMock()
        node_run_result.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_run_result.error = None

        succeeded_event = MagicMock(spec=NodeRunSucceededEvent)
        succeeded_event.node_run_result = node_run_result

        def invoke_fn():
            def _gen():
                yield succeeded_event

            return node, _gen()

        # Act
        out_node, out_result, run_succeeded, error = service._execute_node_safely(invoke_fn)

        # Assert
        assert out_node is node
        assert run_succeeded is True
        assert error is None

    def test_execute_node_safely_should_return_failed_result_on_failed_event(self, service: WorkflowService) -> None:
        # Arrange
        node = MagicMock()
        node.error_strategy = None
        node_run_result = MagicMock()
        node_run_result.status = WorkflowNodeExecutionStatus.FAILED
        node_run_result.error = "node exploded"

        failed_event = MagicMock(spec=NodeRunFailedEvent)
        failed_event.node_run_result = node_run_result

        def invoke_fn():
            def _gen():
                yield failed_event

            return node, _gen()

        # Act
        _, _, run_succeeded, error = service._execute_node_safely(invoke_fn)

        # Assert
        assert run_succeeded is False
        assert error == "node exploded"

    def test_execute_node_safely_should_handle_workflow_node_run_failed_error(self, service: WorkflowService) -> None:
        # Arrange
        node = MagicMock()
        exc = WorkflowNodeRunFailedError(node, "runtime failure")

        def invoke_fn():
            raise exc

        # Act
        out_node, out_result, run_succeeded, error = service._execute_node_safely(invoke_fn)

        # Assert
        assert out_node is node
        assert out_result is None
        assert run_succeeded is False
        assert error == "runtime failure"

    def test_execute_node_safely_should_raise_when_no_result_event(self, service: WorkflowService) -> None:
        """If the generator produces no NodeRunSucceededEvent/NodeRunFailedEvent, ValueError is expected."""
        # Arrange
        node = MagicMock()
        node.error_strategy = None

        def invoke_fn():
            def _gen():
                yield from []

            return node, _gen()

        # Act + Assert
        with pytest.raises(ValueError, match="no result returned"):
            service._execute_node_safely(invoke_fn)

    # --- _apply_error_strategy with FAIL_BRANCH strategy ---

    def test_execute_node_safely_should_apply_error_strategy_on_failed_status(self, service: WorkflowService) -> None:
        # Arrange
        node = MagicMock()
        node.error_strategy = ErrorStrategy.FAIL_BRANCH
        node.default_value_dict = {}

        original_result = MagicMock()
        original_result.status = WorkflowNodeExecutionStatus.FAILED
        original_result.error = "oops"
        original_result.error_type = "ValueError"
        original_result.inputs = {}

        failed_event = MagicMock(spec=NodeRunFailedEvent)
        failed_event.node_run_result = original_result

        def invoke_fn():
            def _gen():
                yield failed_event

            return node, _gen()

        # Act
        _, result, run_succeeded, _ = service._execute_node_safely(invoke_fn)

        # Assert — after applying error strategy status becomes EXCEPTION
        assert result is not None
        assert result.status == WorkflowNodeExecutionStatus.EXCEPTION
        # run_succeeded should be True because EXCEPTION is in the succeeded set
        assert run_succeeded is True


# ===========================================================================
# TestWorkflowServiceGetNodeLastRun
# Tests for get_node_last_run delegation to repository
# ===========================================================================


class TestWorkflowServiceGetNodeLastRun:
    @pytest.fixture
    def service(self) -> WorkflowService:
        with patch("services.workflow_service.db"):
            return WorkflowService()

    def test_get_node_last_run_should_delegate_to_repository(self, service: WorkflowService) -> None:
        # Arrange
        app = MagicMock(spec=App)
        app.tenant_id = "tenant-1"
        app.id = "app-1"
        workflow = MagicMock(spec=Workflow)
        workflow.id = "wf-1"
        expected = MagicMock()

        service._node_execution_service_repo = MagicMock()
        service._node_execution_service_repo.get_node_last_execution.return_value = expected

        # Act
        result = service.get_node_last_run(app, workflow, "node-42")

        # Assert
        assert result is expected
        service._node_execution_service_repo.get_node_last_execution.assert_called_once_with(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="wf-1",
            node_id="node-42",
        )

    def test_get_node_last_run_should_return_none_when_repository_returns_none(self, service: WorkflowService) -> None:
        # Arrange
        app = MagicMock(spec=App)
        app.tenant_id = "t"
        app.id = "a"
        workflow = MagicMock(spec=Workflow)
        workflow.id = "w"
        service._node_execution_service_repo = MagicMock()
        service._node_execution_service_repo.get_node_last_execution.return_value = None

        # Act
        result = service.get_node_last_run(app, workflow, "node-x")

        # Assert
        assert result is None


# ===========================================================================
# TestWorkflowServiceModuleLevelHelpers
# Tests for module-level helper functions exported from workflow_service
# ===========================================================================


class TestSetupVariablePool:
    """
    Tests for the module-level `_setup_variable_pool` function.
    This helper initialises the VariablePool used for single-step workflow execution.
    """

    def _make_workflow(self, workflow_type: str = WorkflowType.WORKFLOW.value) -> MagicMock:
        wf = MagicMock(spec=Workflow)
        wf.app_id = "app-1"
        wf.id = "wf-1"
        wf.type = workflow_type
        wf.environment_variables = []
        return wf

    def test_setup_variable_pool_should_use_full_system_variables_for_start_node(
        self,
    ) -> None:
        # Arrange
        workflow = self._make_workflow()

        # Act
        with patch("services.workflow_service.VariablePool") as MockPool:
            _setup_variable_pool(
                query="hello",
                files=[],
                user_id="u-1",
                user_inputs={"k": "v"},
                workflow=workflow,
                node_type=BuiltinNodeTypes.START,
                conversation_id="conv-1",
                conversation_variables=[],
            )

        # Assert — VariablePool should be called with a SystemVariable (non-default)
        MockPool.assert_called_once()
        call_kwargs = MockPool.call_args.kwargs
        assert call_kwargs["user_inputs"] == {"k": "v"}

    def test_setup_variable_pool_should_use_default_system_variables_for_non_start_node(
        self,
    ) -> None:
        # Arrange
        workflow = self._make_workflow()

        # Act
        with (
            patch("services.workflow_service.VariablePool") as MockPool,
            patch("services.workflow_service.SystemVariable.default") as mock_default,
        ):
            _setup_variable_pool(
                query="",
                files=[],
                user_id="u-1",
                user_inputs={},
                workflow=workflow,
                node_type=BuiltinNodeTypes.LLM,  # not a start/trigger node
                conversation_id="conv-1",
                conversation_variables=[],
            )

        # Assert — SystemVariable.default() should be used for non-start nodes
        mock_default.assert_called_once()
        MockPool.assert_called_once()

    def test_setup_variable_pool_should_set_chatflow_specifics_for_non_workflow_type(
        self,
    ) -> None:
        """For ADVANCED_CHAT workflows on a START node, query/conversation_id/dialogue_count should be set."""
        from models.workflow import WorkflowType

        # Arrange
        workflow = self._make_workflow(workflow_type=WorkflowType.CHAT.value)

        # Act
        with patch("services.workflow_service.VariablePool") as MockPool:
            _setup_variable_pool(
                query="what is AI?",
                files=[],
                user_id="u-1",
                user_inputs={},
                workflow=workflow,
                node_type=BuiltinNodeTypes.START,
                conversation_id="conv-abc",
                conversation_variables=[],
            )

        # Assert — we just verify VariablePool was called (chatflow path executed)
        MockPool.assert_called_once()


class TestRebuildSingleFile:
    """
    Tests for the module-level `_rebuild_single_file` function.
    Ensures correct delegation to `build_from_mapping` / `build_from_mappings`.
    """

    def test_rebuild_single_file_should_call_build_from_mapping_for_file_type(
        self,
    ) -> None:
        # Arrange
        tenant_id = "tenant-1"
        value = {"url": "https://example.com/file.pdf", "type": "document"}
        mock_file = MagicMock()

        # Act
        with patch("services.workflow_service.build_from_mapping", return_value=mock_file) as mock_build:
            result = _rebuild_single_file(tenant_id, value, VariableEntityType.FILE)

        # Assert
        assert result is mock_file
        mock_build.assert_called_once_with(mapping=value, tenant_id=tenant_id)

    def test_rebuild_single_file_should_raise_when_file_value_not_dict(
        self,
    ) -> None:
        # Arrange + Act + Assert
        with pytest.raises(ValueError, match="expected dict for file object"):
            _rebuild_single_file("tenant-1", "not-a-dict", VariableEntityType.FILE)

    def test_rebuild_single_file_should_call_build_from_mappings_for_file_list(
        self,
    ) -> None:
        # Arrange
        tenant_id = "tenant-1"
        value = [{"url": "https://example.com/a.pdf"}, {"url": "https://example.com/b.pdf"}]
        mock_files = [MagicMock(), MagicMock()]

        # Act
        with patch("services.workflow_service.build_from_mappings", return_value=mock_files) as mock_build:
            result = _rebuild_single_file(tenant_id, value, VariableEntityType.FILE_LIST)

        # Assert
        assert result is mock_files
        mock_build.assert_called_once_with(mappings=value, tenant_id=tenant_id)

    def test_rebuild_single_file_should_raise_when_file_list_value_not_list(
        self,
    ) -> None:
        # Arrange + Act + Assert
        with pytest.raises(ValueError, match="expected list for file list object"):
            _rebuild_single_file("tenant-1", "not-a-list", VariableEntityType.FILE_LIST)

    def test_rebuild_single_file_should_return_empty_list_for_empty_file_list(
        self,
    ) -> None:
        # Arrange + Act
        result = _rebuild_single_file("tenant-1", [], VariableEntityType.FILE_LIST)

        # Assert
        assert result == []

    def test_rebuild_single_file_should_raise_when_first_element_not_dict(
        self,
    ) -> None:
        # Arrange + Act + Assert
        with pytest.raises(ValueError, match="expected dict for first element"):
            _rebuild_single_file("tenant-1", ["not-a-dict"], VariableEntityType.FILE_LIST)


class TestRebuildFileForUserInputsInStartNode:
    """
    Tests for the module-level `_rebuild_file_for_user_inputs_in_start_node` function.
    """

    def _make_start_node_data(self, variables: list) -> MagicMock:
        start_data = MagicMock()
        start_data.variables = variables
        return start_data

    def _make_variable(self, name: str, var_type: VariableEntityType) -> MagicMock:
        var = MagicMock()
        var.variable = name
        var.type = var_type
        return var

    def test_rebuild_should_pass_through_non_file_variables(
        self,
    ) -> None:
        # Arrange
        text_var = self._make_variable("query", VariableEntityType.TEXT_INPUT)
        start_data = self._make_start_node_data([text_var])
        user_inputs = {"query": "hello world"}

        # Act
        result = _rebuild_file_for_user_inputs_in_start_node(
            tenant_id="tenant-1",
            start_node_data=start_data,
            user_inputs=user_inputs,
        )

        # Assert — non-file inputs are untouched
        assert result["query"] == "hello world"

    def test_rebuild_should_rebuild_file_variable(
        self,
    ) -> None:
        # Arrange
        file_var = self._make_variable("attachment", VariableEntityType.FILE)
        start_data = self._make_start_node_data([file_var])
        file_value = {"url": "https://example.com/file.pdf"}
        user_inputs = {"attachment": file_value}
        mock_file = MagicMock()

        # Act
        with patch("services.workflow_service.build_from_mapping", return_value=mock_file):
            result = _rebuild_file_for_user_inputs_in_start_node(
                tenant_id="tenant-1",
                start_node_data=start_data,
                user_inputs=user_inputs,
            )

        # Assert — the dict value should be replaced by the rebuilt File object
        assert result["attachment"] is mock_file

    def test_rebuild_should_skip_variable_not_in_inputs(
        self,
    ) -> None:
        # Arrange
        file_var = self._make_variable("attachment", VariableEntityType.FILE)
        start_data = self._make_start_node_data([file_var])
        user_inputs: dict = {}  # attachment not provided

        # Act
        result = _rebuild_file_for_user_inputs_in_start_node(
            tenant_id="tenant-1",
            start_node_data=start_data,
            user_inputs=user_inputs,
        )

        # Assert — no key should be added for missing inputs
        assert "attachment" not in result


class TestWorkflowServiceResolveDeliveryMethod:
    """
    Tests for the static helper `_resolve_human_input_delivery_method`.
    """

    def _make_method(self, method_id) -> MagicMock:
        m = MagicMock()
        m.id = method_id
        return m

    def test_resolve_delivery_method_should_return_method_when_id_matches(self) -> None:
        # Arrange
        method_a = self._make_method("method-1")
        method_b = self._make_method("method-2")
        node_data = MagicMock()
        node_data.delivery_methods = [method_a, method_b]

        # Act
        result = WorkflowService._resolve_human_input_delivery_method(
            node_data=node_data, delivery_method_id="method-2"
        )

        # Assert
        assert result is method_b

    def test_resolve_delivery_method_should_return_none_when_no_match(self) -> None:
        # Arrange
        method_a = self._make_method("method-1")
        node_data = MagicMock()
        node_data.delivery_methods = [method_a]

        # Act
        result = WorkflowService._resolve_human_input_delivery_method(
            node_data=node_data, delivery_method_id="does-not-exist"
        )

        # Assert
        assert result is None

    def test_resolve_delivery_method_should_return_none_for_empty_methods(self) -> None:
        # Arrange
        node_data = MagicMock()
        node_data.delivery_methods = []

        # Act
        result = WorkflowService._resolve_human_input_delivery_method(
            node_data=node_data, delivery_method_id="method-1"
        )

        # Assert
        assert result is None


# ===========================================================================
# TestWorkflowServiceDraftExecution
# Tests for run_draft_workflow_node
# ===========================================================================


class TestWorkflowServiceDraftExecution:
    @pytest.fixture
    def service(self) -> WorkflowService:
        with patch("services.workflow_service.db"):
            return WorkflowService()

    def test_run_draft_workflow_node_should_execute_start_node_successfully(self, service: WorkflowService) -> None:
        # Arrange
        app = MagicMock(spec=App)
        app.id = "app-1"
        app.tenant_id = "tenant-1"
        account = MagicMock()
        account.id = "user-1"

        draft_workflow = MagicMock(spec=Workflow)
        draft_workflow.id = "wf-1"
        draft_workflow.tenant_id = "tenant-1"
        draft_workflow.app_id = "app-1"
        draft_workflow.graph_dict = {"nodes": []}

        node_id = "start-node"
        node_config = {"id": node_id, "data": MagicMock(type=BuiltinNodeTypes.START)}
        draft_workflow.get_node_config_by_id.return_value = node_config
        draft_workflow.get_enclosing_node_type_and_id.return_value = None

        service.get_draft_workflow = MagicMock(return_value=draft_workflow)

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "exec-1"
        node_execution.process_data = {}

        # Mocking complex dependencies
        with (
            patch("services.workflow_service.db"),
            patch("services.workflow_service.Session"),
            patch("services.workflow_service.WorkflowDraftVariableService"),
            patch("services.workflow_service.StartNodeData") as mock_start_data,
            patch(
                "services.workflow_service._rebuild_file_for_user_inputs_in_start_node",
                side_effect=lambda **kwargs: kwargs["user_inputs"],
            ),
            patch("services.workflow_service._setup_variable_pool"),
            patch("services.workflow_service.DraftVarLoader"),
            patch("services.workflow_service.WorkflowEntry.single_step_run") as mock_run,
            patch("services.workflow_service.DifyCoreRepositoryFactory") as mock_repo_factory,
            patch("services.workflow_service.DraftVariableSaver") as mock_saver_cls,
            patch("services.workflow_service.storage"),
        ):
            mock_node = MagicMock()
            mock_node.node_type = BuiltinNodeTypes.START
            mock_node.title = "Start Node"
            mock_run_result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs={}, outputs={"result": "ok"}
            )
            mock_event = NodeRunSucceededEvent(
                id=str(uuid.uuid4()),
                node_id="start-node",
                node_type=BuiltinNodeTypes.START,
                node_run_result=mock_run_result,
                start_at=naive_utc_now(),
            )
            mock_run.return_value = (mock_node, [mock_event])

            mock_repo = MagicMock()
            mock_repo_factory.create_workflow_node_execution_repository.return_value = mock_repo

            service._node_execution_service_repo = MagicMock()
            mock_execution_record = MagicMock()
            mock_execution_record.node_type = "start"
            mock_execution_record.node_id = "start-node"
            mock_execution_record.load_full_outputs.return_value = {}
            service._node_execution_service_repo.get_execution_by_id.return_value = mock_execution_record

            # Act
            result = service.run_draft_workflow_node(
                app_model=app,
                draft_workflow=draft_workflow,
                account=account,
                node_id=node_id,
                user_inputs={"key": "val"},
                query="hi",
                files=[],
            )

            # Assert
            assert result is not None
            mock_run.assert_called_once()
            mock_repo.save.assert_called_once()
            mock_saver_cls.return_value.save.assert_called_once()

    def test_run_draft_workflow_node_should_execute_non_start_node_successfully(self, service: WorkflowService) -> None:
        # Arrange
        app = MagicMock(spec=App)
        account = MagicMock()
        draft_workflow = MagicMock(spec=Workflow)
        draft_workflow.graph_dict = {"nodes": []}
        node_id = "llm-node"
        node_config = {"id": node_id, "data": MagicMock(type=BuiltinNodeTypes.LLM)}
        draft_workflow.get_node_config_by_id.return_value = node_config
        draft_workflow.get_enclosing_node_type_and_id.return_value = None
        service.get_draft_workflow = MagicMock(return_value=draft_workflow)

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "exec-1"
        node_execution.process_data = {}

        with (
            patch("services.workflow_service.db"),
            patch("services.workflow_service.Session"),
            patch("services.workflow_service.WorkflowDraftVariableService"),
            patch("services.workflow_service.VariablePool") as mock_pool_cls,
            patch("services.workflow_service.DraftVarLoader"),
            patch("services.workflow_service.WorkflowEntry.single_step_run") as mock_run,
            patch("services.workflow_service.DifyCoreRepositoryFactory"),
            patch("services.workflow_service.DraftVariableSaver"),
            patch("services.workflow_service.storage"),
        ):
            mock_node = MagicMock()
            mock_node.node_type = BuiltinNodeTypes.LLM
            mock_node.title = "LLM Node"
            mock_run_result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs={}, outputs={"result": "ok"}
            )
            mock_event = NodeRunSucceededEvent(
                id=str(uuid.uuid4()),
                node_id="llm-node",
                node_type=BuiltinNodeTypes.LLM,
                node_run_result=mock_run_result,
                start_at=naive_utc_now(),
            )
            mock_run.return_value = (mock_node, [mock_event])

            service._node_execution_service_repo = MagicMock()
            mock_execution_record = MagicMock()
            mock_execution_record.node_type = "llm"
            mock_execution_record.node_id = "llm-node"
            mock_execution_record.load_full_outputs.return_value = {"answer": "hello"}
            service._node_execution_service_repo.get_execution_by_id.return_value = mock_execution_record

            # Act
            service.run_draft_workflow_node(
                app_model=app,
                draft_workflow=draft_workflow,
                account=account,
                node_id=node_id,
                user_inputs={},
                query="",
                files=None,
            )

            # Assert
            # For non-start nodes, VariablePool should be initialized with environment_variables
            mock_pool_cls.assert_called_once()
            args, kwargs = mock_pool_cls.call_args
            assert "environment_variables" in kwargs


# ===========================================================================
# TestWorkflowServiceHumanInputOperations
# Tests for Human Input related methods
# ===========================================================================


class TestWorkflowServiceHumanInputOperations:
    @pytest.fixture
    def service(self) -> WorkflowService:
        with patch("services.workflow_service.db"):
            return WorkflowService()

    def test_get_human_input_form_preview_should_raise_if_workflow_not_init(self, service: WorkflowService) -> None:
        service.get_draft_workflow = MagicMock(return_value=None)
        with pytest.raises(ValueError, match="Workflow not initialized"):
            service.get_human_input_form_preview(app_model=MagicMock(), account=MagicMock(), node_id="node-1")

    def test_get_human_input_form_preview_should_raise_if_wrong_node_type(self, service: WorkflowService) -> None:
        draft = MagicMock()
        draft.get_node_config_by_id.return_value = {"data": {"type": "llm"}}
        service.get_draft_workflow = MagicMock(return_value=draft)
        with patch("models.workflow.Workflow.get_node_type_from_node_config", return_value=BuiltinNodeTypes.LLM):
            with pytest.raises(ValueError, match="Node type must be human-input"):
                service.get_human_input_form_preview(app_model=MagicMock(), account=MagicMock(), node_id="node-1")

    def test_get_human_input_form_preview_success(self, service: WorkflowService) -> None:
        app_model = MagicMock(spec=App)
        app_model.id = "app-1"
        app_model.tenant_id = "tenant-1"

        account = MagicMock()
        account.id = "user-1"

        draft = MagicMock()
        draft.id = "wf-1"
        draft.tenant_id = "tenant-1"
        draft.app_id = "app-1"
        draft.graph_dict = {"nodes": []}
        draft.get_node_config_by_id.return_value = {
            "id": "node-1",
            "data": MagicMock(type=BuiltinNodeTypes.HUMAN_INPUT),
        }
        service.get_draft_workflow = MagicMock(return_value=draft)

        mock_node = MagicMock()
        mock_node.render_form_content_before_submission.return_value = "rendered"
        mock_node.resolve_default_values.return_value = {"def": 1}
        mock_node.title = "Form Title"
        mock_node.node_data = MagicMock()

        with (
            patch("services.workflow_service.db"),
            patch("services.workflow_service.WorkflowDraftVariableService"),
            patch("models.workflow.Workflow.get_node_type_from_node_config", return_value=BuiltinNodeTypes.HUMAN_INPUT),
            patch.object(service, "_build_human_input_variable_pool"),
            patch("services.workflow_service.HumanInputNode", return_value=mock_node),
            patch("services.workflow_service.HumanInputRequired") as mock_required_cls,
        ):
            service.get_human_input_form_preview(app_model=app_model, account=account, node_id="node-1")
            mock_node.render_form_content_before_submission.assert_called_once()
            mock_required_cls.return_value.model_dump.assert_called_once()

    def test_submit_human_input_form_preview_success(self, service: WorkflowService) -> None:
        app_model = MagicMock(spec=App)
        app_model.id = "app-1"
        app_model.tenant_id = "tenant-1"

        account = MagicMock()
        account.id = "user-1"

        draft = MagicMock()
        draft.id = "wf-1"
        draft.tenant_id = "tenant-1"
        draft.app_id = "app-1"
        draft.graph_dict = {"nodes": []}
        draft.get_node_config_by_id.return_value = {"id": "node-1", "data": {"type": "human-input"}}
        service.get_draft_workflow = MagicMock(return_value=draft)

        mock_node = MagicMock()
        mock_node.node_data = MagicMock()
        mock_node.node_data.outputs_field_names.return_value = ["field1"]

        with (
            patch("services.workflow_service.db"),
            patch("services.workflow_service.WorkflowDraftVariableService"),
            patch("models.workflow.Workflow.get_node_type_from_node_config", return_value=BuiltinNodeTypes.HUMAN_INPUT),
            patch.object(service, "_build_human_input_variable_pool"),
            patch("services.workflow_service.HumanInputNode", return_value=mock_node),
            patch("services.workflow_service.validate_human_input_submission"),
            patch("services.workflow_service.Session"),
            patch("services.workflow_service.DraftVariableSaver") as mock_saver_cls,
        ):
            result = service.submit_human_input_form_preview(
                app_model=app_model, account=account, node_id="node-1", form_inputs={"field1": "val1"}, action="submit"
            )
            assert result["__action_id"] == "submit"
            mock_saver_cls.return_value.save.assert_called_once()

    def test_test_human_input_delivery_success(self, service: WorkflowService) -> None:
        draft = MagicMock()
        draft.get_node_config_by_id.return_value = {"data": {"type": "human-input"}}
        service.get_draft_workflow = MagicMock(return_value=draft)

        with (
            patch("models.workflow.Workflow.get_node_type_from_node_config", return_value=BuiltinNodeTypes.HUMAN_INPUT),
            patch("services.workflow_service.HumanInputNodeData.model_validate"),
            patch.object(service, "_resolve_human_input_delivery_method") as mock_resolve,
            patch("services.workflow_service.apply_debug_email_recipient"),
            patch.object(service, "_build_human_input_variable_pool"),
            patch.object(service, "_build_human_input_node"),
            patch.object(service, "_create_human_input_delivery_test_form", return_value=("form-1", [])),
            patch("services.workflow_service.HumanInputDeliveryTestService") as mock_test_srv,
        ):
            mock_resolve.return_value = MagicMock()
            service.test_human_input_delivery(
                app_model=MagicMock(), account=MagicMock(), node_id="node-1", delivery_method_id="method-1"
            )
            mock_test_srv.return_value.send_test.assert_called_once()

    def test_test_human_input_delivery_failure_cases(self, service: WorkflowService) -> None:
        draft = MagicMock()
        draft.get_node_config_by_id.return_value = {"data": {"type": "human-input"}}
        service.get_draft_workflow = MagicMock(return_value=draft)

        with (
            patch("models.workflow.Workflow.get_node_type_from_node_config", return_value=BuiltinNodeTypes.HUMAN_INPUT),
            patch("services.workflow_service.HumanInputNodeData.model_validate"),
            patch.object(service, "_resolve_human_input_delivery_method", return_value=None),
        ):
            with pytest.raises(ValueError, match="Delivery method not found"):
                service.test_human_input_delivery(
                    app_model=MagicMock(), account=MagicMock(), node_id="node-1", delivery_method_id="none"
                )

    def test_load_email_recipients_parsing_failure(self, service: WorkflowService) -> None:
        # Arrange
        mock_recipient = MagicMock()
        mock_recipient.recipient_payload = "invalid json"
        mock_recipient.recipient_type = RecipientType.EMAIL_MEMBER

        with (
            patch("services.workflow_service.db"),
            patch("services.workflow_service.WorkflowDraftVariableService"),
            patch("services.workflow_service.Session") as mock_session_cls,
            patch("services.workflow_service.select"),
            patch("services.workflow_service.json.loads", side_effect=ValueError("bad json")),
        ):
            mock_session = mock_session_cls.return_value.__enter__.return_value
            # sqlalchemy assertions check for .bind
            mock_session.bind = MagicMock()  # removed spec=Engine to avoid import issues for now
            mock_session.scalars.return_value.all.return_value = [mock_recipient]

            # Act
            # _load_email_recipients(form_id: str) is a static method
            result = WorkflowService._load_email_recipients("form-1")

            # Assert
            assert result == []  # Should fall back to empty list on parsing error

    def test_build_human_input_variable_pool(self, service: WorkflowService) -> None:
        workflow = MagicMock()
        workflow.environment_variables = []
        workflow.graph_dict = {}

        with (
            patch("services.workflow_service.db"),
            patch("services.workflow_service.Session"),
            patch("services.workflow_service.WorkflowDraftVariableService"),
            patch("services.workflow_service.VariablePool") as mock_pool_cls,
            patch("services.workflow_service.DraftVarLoader"),
            patch("services.workflow_service.HumanInputNode.extract_variable_selector_to_variable_mapping"),
            patch("services.workflow_service.load_into_variable_pool"),
            patch("services.workflow_service.WorkflowEntry.mapping_user_inputs_to_variable_pool"),
        ):
            service._build_human_input_variable_pool(
                app_model=MagicMock(), workflow=workflow, node_config={}, manual_inputs={}, user_id="user-1"
            )
            mock_pool_cls.assert_called_once()


# ===========================================================================
# TestWorkflowServiceFreeNodeExecution
# Tests for run_free_workflow_node and handle_single_step_result
# ===========================================================================


class TestWorkflowServiceFreeNodeExecution:
    @pytest.fixture
    def service(self) -> WorkflowService:
        with patch("services.workflow_service.db"):
            return WorkflowService()

    def test_run_free_workflow_node_success(self, service: WorkflowService) -> None:
        node_execution = MagicMock()
        with (
            patch.object(service, "_handle_single_step_result", return_value=node_execution),
            patch("services.workflow_service.WorkflowEntry.run_free_node"),
        ):
            result = service.run_free_workflow_node({}, "tenant-1", "user-1", "node-1", {})
            assert result == node_execution

    def test_validate_graph_structure_coexist_error(self, service: WorkflowService) -> None:
        graph = {
            "nodes": [
                {"data": {"type": "start"}},
                {"data": {"type": "trigger-webhook"}},  # is_trigger_node=True
            ]
        }
        with pytest.raises(ValueError, match="Start node and trigger nodes cannot coexist"):
            service.validate_graph_structure(graph)

    def test_validate_features_structure_success(self, service: WorkflowService) -> None:
        app = MagicMock()
        app.mode = "workflow"
        features = {}
        with patch("services.workflow_service.WorkflowAppConfigManager.config_validate") as mock_val:
            service.validate_features_structure(app, features)
            mock_val.assert_called_once()

    def test_validate_features_structure_invalid_mode(self, service: WorkflowService) -> None:
        app = MagicMock()
        app.mode = "invalid"
        with pytest.raises(ValueError, match="Invalid app mode"):
            service.validate_features_structure(app, {})

    def test_validate_human_input_node_data_error(self, service: WorkflowService) -> None:
        with patch(
            "dify_graph.nodes.human_input.entities.HumanInputNodeData.model_validate", side_effect=Exception("error")
        ):
            with pytest.raises(ValueError, match="Invalid HumanInput node data"):
                service._validate_human_input_node_data({})

    def test_rebuild_single_file_unreachable(self) -> None:
        # Test line 1523 (unreachable)
        with pytest.raises(Exception, match="unreachable"):
            _rebuild_single_file("tenant-1", {}, cast(Any, "invalid_type"))

    def test_build_human_input_node(self, service: WorkflowService) -> None:
        """Cover _build_human_input_node (lines 1065-1088)."""
        workflow = MagicMock()
        workflow.id = "wf-1"
        workflow.tenant_id = "t-1"
        workflow.app_id = "app-1"
        account = MagicMock()
        account.id = "u-1"
        node_config = {"id": "n-1"}
        variable_pool = MagicMock()

        with (
            patch("services.workflow_service.GraphInitParams"),
            patch("services.workflow_service.GraphRuntimeState"),
            patch("services.workflow_service.HumanInputNode") as mock_node_cls,
            patch("services.workflow_service.HumanInputFormRepositoryImpl"),
        ):
            node = service._build_human_input_node(
                workflow=workflow, account=account, node_config=node_config, variable_pool=variable_pool
            )
            assert node == mock_node_cls.return_value
            mock_node_cls.assert_called_once()
