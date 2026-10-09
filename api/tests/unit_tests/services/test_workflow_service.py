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
from collections.abc import Callable
from typing import Any, cast
from unittest.mock import ANY, MagicMock, patch

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from enums import DeploymentEdition
from graphon.enums import (
    BuiltinNodeTypes,
    ErrorStrategy,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.errors import WorkflowNodeRunFailedError
from graphon.graph_events import NodeRunFailedEvent, NodeRunSucceededEvent
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.node_events import NodeRunResult
from graphon.nodes.http_request import HTTP_REQUEST_CONFIG_FILTER_KEY, HttpRequestNode, HttpRequestNodeConfig
from graphon.variables.input_entities import VariableEntityType
from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.model import App, AppMode
from models.tools import BuiltinToolProvider
from models.workflow import Workflow, WorkflowType
from repositories.credentials.query_repository import CredentialQueryRepository
from services.errors.app import IsDraftWorkflowError
from services.workflow_service import (
    WorkflowService,
    _rebuild_file_for_user_inputs_in_start_node,
    _rebuild_single_file,
    _setup_variable_pool,
)


class TestWorkflowAssociatedDataFactory:
    """
    Factory class for creating ORM models and workflow graph data for service tests.

    This factory provides reusable methods to create:
    - App models with configurable attributes
    - Workflow models with graph and feature configurations
    - Account models for user authentication
    - Valid workflow graph structures for testing
    """

    @staticmethod
    def create_app(
        app_id: str = "app-123",
        tenant_id: str = "tenant-456",
        mode: str = AppMode.WORKFLOW,
        workflow_id: str | None = None,
        **kwargs: Any,
    ) -> App:
        """Create an App model with specified attributes.

        Args:
            app_id: Unique identifier for the app
            tenant_id: Workspace/tenant identifier
            mode: App mode (workflow, chat, completion, etc.)
            workflow_id: Optional ID of the published workflow
            **kwargs: Additional attributes to set on the model

        Returns:
            App model configured for service tests
        """
        app = App(
            id=app_id,
            tenant_id=tenant_id,
            name="Test App",
            description="",
            mode=AppMode(mode),
            workflow_id=workflow_id,
            enable_site=True,
            enable_api=True,
            max_active_requests=0,
        )
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_workflow(
        workflow_id: str = "workflow-789",
        tenant_id: str = "tenant-456",
        app_id: str = "app-123",
        version: str = Workflow.VERSION_DRAFT,
        workflow_type: WorkflowType = WorkflowType.WORKFLOW,
        graph: dict[str, Any] | None = None,
        features: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Workflow:
        """Create a persistent Workflow model for SQLite-backed service tests."""
        workflow = Workflow(
            id=workflow_id,
            tenant_id=tenant_id,
            app_id=app_id,
            type=workflow_type,
            version=version,
            graph=json.dumps(graph or {"nodes": [], "edges": []}),
            features=json.dumps(features or {}),
            created_by="user-123",
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        for key, value in kwargs.items():
            setattr(workflow, key, value)
        return workflow

    @staticmethod
    def create_account(account_id: str = "user-123", **kwargs: Any) -> Account:
        """Create an Account model with specified attributes."""
        account = Account(name="Test User", email=f"{account_id}@example.com")
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


@pytest.mark.usefixtures("sqlite_session")
class TestWorkflowService:
    @pytest.fixture(autouse=True)
    def _community_edition(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

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
    def workflow_service(self, sqlite_engine: Engine) -> WorkflowService:
        """Create a WorkflowService whose repositories use the test SQLite engine."""
        return WorkflowService(sessionmaker(bind=sqlite_engine, expire_on_commit=False))

    # ==================== Workflow Existence Tests ====================
    # These tests verify the service can check if a draft workflow exists

    # ==================== Get Draft Workflow Tests ====================
    # These tests verify retrieval of draft workflows (version="draft")

    def test_get_draft_workflow_success(self, workflow_service: WorkflowService, sqlite_session: Session):
        """
        Test get_draft_workflow returns draft workflow successfully.

        Draft workflows are the working copy that users edit before publishing.
        Each app can have only one draft workflow at a time.
        """
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow = TestWorkflowAssociatedDataFactory.create_workflow()
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = workflow_service.get_draft_workflow(app, session=sqlite_session)

        assert result is workflow

    def test_get_draft_workflow_uses_provided_session(self, workflow_service: WorkflowService, sqlite_session: Session):
        """Test get_draft_workflow can reuse an injected SQLAlchemy session."""
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow = TestWorkflowAssociatedDataFactory.create_workflow()
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = workflow_service.get_draft_workflow(app, session=sqlite_session)

        assert result is workflow

    def test_get_draft_workflow_returns_none(self, workflow_service: WorkflowService, sqlite_session: Session):
        """Test get_draft_workflow returns None when no draft exists."""
        app = TestWorkflowAssociatedDataFactory.create_app()

        result = workflow_service.get_draft_workflow(app, session=sqlite_session)

        assert result is None

    def test_get_draft_workflow_with_workflow_id(self, workflow_service: WorkflowService, sqlite_session: Session):
        """Test get_draft_workflow with workflow_id calls get_published_workflow_by_id."""
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow_id = "workflow-123"
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(workflow_id=workflow_id, version="v1")
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = workflow_service.get_draft_workflow(app, workflow_id=workflow_id, session=sqlite_session)

        assert result is workflow

    def test_get_draft_workflow_with_workflow_id_reuses_provided_session(
        self, workflow_service: WorkflowService, sqlite_session: Session
    ):
        """A version lookup sees the caller's uncommitted rows through the shared repository."""
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow_id = "workflow-123"
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id=workflow_id, app_id=app.id, tenant_id=app.tenant_id, version="v1"
        )
        sqlite_session.add(workflow)
        assert workflow_service.get_draft_workflow(app, workflow_id=workflow_id, session=sqlite_session) is workflow

    # ==================== Get Published Workflow Tests ====================
    # These tests verify retrieval of published workflows (versioned snapshots)

    def test_get_published_workflow_by_id_success(self, workflow_service: WorkflowService, sqlite_session: Session):
        """Test get_published_workflow_by_id returns published workflow."""
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow_id = "workflow-123"
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(workflow_id=workflow_id, version="v1")
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = workflow_service.get_published_workflow_by_id(app, workflow_id, session=sqlite_session)

        assert result is workflow

    def test_get_published_workflow_by_id_can_lock_restore_source(
        self, workflow_service: WorkflowService, sqlite_session: Session, mocker: MockerFixture
    ):
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(version="v1")
        session = sqlite_session
        session.add(workflow)
        session.commit()
        lookup = mocker.spy(session, "scalar")

        result = workflow_service.get_published_workflow_by_id(
            app,
            workflow.id,
            session=session,
            for_update=True,
        )

        stmt = lookup.call_args.args[0]
        sql = str(stmt.compile(dialect=postgresql.dialect()))
        assert result is workflow
        assert "FOR UPDATE" in sql

    def test_get_published_workflow_by_id_raises_error_for_draft(
        self, workflow_service: WorkflowService, sqlite_session: Session
    ):
        """
        Test get_published_workflow_by_id raises error when workflow is draft.

        This prevents using draft workflows in production contexts where only
        published, stable versions should be used (e.g., API execution).
        """
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow_id = "workflow-123"
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id=workflow_id, version=Workflow.VERSION_DRAFT
        )
        sqlite_session.add(workflow)
        sqlite_session.commit()

        with pytest.raises(IsDraftWorkflowError):
            workflow_service.get_published_workflow_by_id(app, workflow_id, session=sqlite_session)

    def test_get_published_workflow_by_id_returns_none(
        self, workflow_service: WorkflowService, sqlite_session: Session
    ):
        """Test get_published_workflow_by_id returns None when workflow not found."""
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow_id = "nonexistent-workflow"

        result = workflow_service.get_published_workflow_by_id(app, workflow_id, session=sqlite_session)

        assert result is None

    @pytest.mark.parametrize(
        ("tenant_id", "app_id"),
        [("other-tenant", "app-123"), ("tenant-456", "other-app")],
    )
    def test_get_published_workflow_by_id_rejects_foreign_workflow(
        self,
        tenant_id: str,
        app_id: str,
        workflow_service: WorkflowService,
        sqlite_session: Session,
    ):
        app = TestWorkflowAssociatedDataFactory.create_app()
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id="workflow-123",
            tenant_id=tenant_id,
            app_id=app_id,
            version="v1",
        )
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = workflow_service.get_published_workflow_by_id(app, workflow.id, session=sqlite_session)

        assert result is None

    def test_get_published_workflow_success(self, workflow_service: WorkflowService, sqlite_session: Session):
        """Test get_published_workflow returns published workflow."""
        workflow_id = "workflow-123"
        app = TestWorkflowAssociatedDataFactory.create_app(workflow_id=workflow_id)
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(workflow_id=workflow_id, version="v1")
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = workflow_service.get_published_workflow(app, session=sqlite_session)

        assert result is workflow

    def test_get_published_workflow_returns_none_when_no_workflow_id(
        self, workflow_service: WorkflowService, sqlite_session: Session
    ):
        """Test get_published_workflow returns None when app has no workflow_id."""
        app = TestWorkflowAssociatedDataFactory.create_app(workflow_id=None)

        result = workflow_service.get_published_workflow(app, session=sqlite_session)

        assert result is None

    # ==================== Workflow Validation Tests ====================
    # These tests verify graph structure and feature configuration validation

    def test_validate_graph_structure_empty_graph(self, workflow_service: WorkflowService):
        """Test validate_graph_structure accepts empty graph."""
        graph = {"nodes": []}

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_graph_structure_valid_graph(self, workflow_service: WorkflowService):
        """Test validate_graph_structure accepts valid graph."""
        graph = TestWorkflowAssociatedDataFactory.create_valid_workflow_graph()

        # Should not raise any exception
        workflow_service.validate_graph_structure(graph)

    def test_validate_graph_structure_start_and_trigger_coexist_raises_error(self, workflow_service: WorkflowService):
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

    def test_validate_features_structure_workflow_mode(self, workflow_service: WorkflowService):
        """
        Test validate_features_structure for workflow mode.

        Different app modes have different feature configurations.
        This ensures the features match the expected schema for workflow apps.
        """
        app = TestWorkflowAssociatedDataFactory.create_app(mode=AppMode.WORKFLOW)
        features = {"file_upload": {"enabled": False}}

        with patch("services.workflow_service.WorkflowAppConfigManager.config_validate") as mock_validate:
            workflow_service.validate_features_structure(app, features)
            mock_validate.assert_called_once_with(
                tenant_id=app.tenant_id, config=features, only_structure_validate=True
            )

    def test_validate_features_structure_advanced_chat_mode(self, workflow_service: WorkflowService):
        """Test validate_features_structure for advanced chat mode."""
        app = TestWorkflowAssociatedDataFactory.create_app(mode=AppMode.ADVANCED_CHAT)
        features = {"opening_statement": "Hello"}

        with patch("services.workflow_service.AdvancedChatAppConfigManager.config_validate") as mock_validate:
            workflow_service.validate_features_structure(app, features)
            mock_validate.assert_called_once_with(
                tenant_id=app.tenant_id, config=features, only_structure_validate=True
            )

    def test_validate_features_structure_invalid_mode_raises_error(self, workflow_service: WorkflowService):
        """Test validate_features_structure raises error for invalid mode."""
        app = TestWorkflowAssociatedDataFactory.create_app(mode=AppMode.COMPLETION)
        features = {}

        with pytest.raises(ValueError, match="Invalid app mode"):
            workflow_service.validate_features_structure(app, features)

    # ==================== Publish Workflow Tests ====================
    # These tests verify creating published versions from draft workflows

    # ==================== Version Management Tests ====================
    # These tests verify listing and managing published workflow versions

    # ==================== Update Workflow Tests ====================
    # These tests verify updating workflow metadata (name, comments, etc.)

    # ==================== Get Default Block Config Tests ====================
    # These tests verify retrieval of default node configurations

    def test_get_default_block_configs(self, workflow_service: WorkflowService):
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

    def test_get_default_block_configs_http_request_injects_default_config(self, workflow_service: WorkflowService):
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

    def test_get_default_block_config_for_node_type(self, workflow_service: WorkflowService):
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

    def test_get_default_block_config_invalid_node_type(self, workflow_service: WorkflowService):
        """Test get_default_block_config returns empty dict for invalid node type."""
        with patch("services.workflow_service.get_node_type_classes_mapping") as mock_mapping:
            mock_mapping.return_value = {}

            # Use a valid NodeType but one that's not in the mapping
            result = workflow_service.get_default_block_config(BuiltinNodeTypes.LLM)

            assert result == {}

    def test_get_default_block_config_http_request_injects_default_config(self, workflow_service: WorkflowService):
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

    def test_get_default_block_config_http_request_uses_passed_config(self, workflow_service: WorkflowService):
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

    def test_get_default_block_config_http_request_malformed_config_raises_type_error(
        self, workflow_service: WorkflowService
    ):
        with (
            patch(
                "services.workflow_service.get_node_type_classes_mapping",
                return_value={BuiltinNodeTypes.HTTP_REQUEST: {"latest": HttpRequestNode}},
            ),
            patch("services.workflow_service.LATEST_VERSION", "latest"),
        ):
            with pytest.raises(TypeError, match="http_request_config must be an HttpRequestNodeConfig instance"):
                workflow_service.get_default_block_config(
                    BuiltinNodeTypes.HTTP_REQUEST,
                    filters={HTTP_REQUEST_CONFIG_FILTER_KEY: "invalid"},
                )


# ===========================================================================
# TestWorkflowServiceCredentialValidation
# Tests for _validate_workflow_credentials and related private helpers
# ===========================================================================


@pytest.mark.usefixtures("sqlite_session")
class TestWorkflowServiceCredentialValidation:
    """
    Tests for the private credential-validation helpers on WorkflowService.

    These helpers gate `publish_workflow` when `PluginManager` is enabled.
    Each test focuses on a distinct branch inside `_validate_workflow_credentials`,
    `_validate_llm_model_config`, `_check_default_tool_credential`, and the
    load-balancing path.
    """

    @pytest.fixture
    def service(self, sqlite_engine: Engine) -> WorkflowService:
        return WorkflowService(sessionmaker(bind=sqlite_engine, expire_on_commit=False))

    @pytest.fixture(autouse=True)
    def credential_repository(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        self.credentials = CredentialQueryRepository(session_factory=sqlite_session_factory)

    @staticmethod
    def _make_workflow(nodes: list[dict]) -> Workflow:
        return TestWorkflowAssociatedDataFactory.create_workflow(
            tenant_id="tenant-1",
            app_id="app-1",
            graph={"nodes": nodes, "edges": []},
        )

    # --- _validate_workflow_credentials: tool node (with credential_id) ---

    def test_validate_workflow_credentials_should_check_tool_credential_when_credential_id_present(
        self, service: WorkflowService, sqlite_session: Session
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
            service._validate_workflow_credentials(workflow, credentials=self.credentials)
            mock_check.assert_called_once()

    def test_validate_workflow_credentials_should_check_default_credential_when_no_credential_id(
        self, service: WorkflowService, sqlite_session: Session
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
            service._validate_workflow_credentials(workflow, credentials=self.credentials)

        # Assert
        mock_default.assert_called_once_with("tenant-1", "my-provider", credentials=self.credentials)

    def test_validate_workflow_credentials_should_skip_tool_node_without_provider(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        """Tool nodes without a provider_id should be silently skipped."""
        # Arrange
        nodes = [{"id": "tool-node", "data": {"type": "tool"}}]
        workflow = self._make_workflow(nodes)

        # Act + Assert (no error raised)
        with patch.object(service, "_check_default_tool_credential") as mock_default:
            service._validate_workflow_credentials(workflow, credentials=self.credentials)
            mock_default.assert_not_called()

    def test_validate_workflow_credentials_should_validate_llm_node_with_model_config(
        self, service: WorkflowService, sqlite_session: Session
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
            service._validate_workflow_credentials(workflow, credentials=self.credentials)

        # Assert
        mock_llm.assert_called_once_with("tenant-1", "openai", "gpt-4")

    def test_validate_workflow_credentials_should_use_llm_environment_variable_model(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        workflow = self._make_workflow(
            [
                {
                    "id": "llm-node",
                    "data": {
                        "type": "llm",
                        "model": {
                            "provider": "old-provider",
                            "name": "old-model",
                            "mode": "chat",
                            "completion_params": {"temperature": 0.2},
                        },
                        "model_selector": ["env", "shared_model"],
                    },
                }
            ]
        )
        workflow.environment_variables = [
            LLMEnvironmentVariable(
                name="shared_model",
                value={
                    "provider": "new-provider",
                    "name": "new-model",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.8},
                },
            )
        ]

        with (
            patch.object(service, "_validate_llm_model_config") as validate_model,
            patch.object(service, "_validate_load_balancing_credentials") as validate_load_balancing,
        ):
            service._validate_workflow_credentials(workflow, credentials=self.credentials)

        validate_model.assert_called_once_with("tenant-1", "new-provider", "new-model")
        validated_node_data = validate_load_balancing.call_args.args[1]
        assert validated_node_data["model"] == {
            "provider": "new-provider",
            "name": "new-model",
            "mode": "chat",
            "completion_params": {"temperature": 0.8},
        }

    def test_validate_workflow_credentials_should_reject_llm_environment_variable_mode_mismatch(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        workflow = self._make_workflow(
            [
                {
                    "id": "llm-node",
                    "data": {
                        "type": "llm",
                        "model": {"provider": "provider", "name": "model", "mode": "chat"},
                        "model_selector": ["env", "shared_model"],
                    },
                }
            ]
        )
        workflow.environment_variables = [
            LLMEnvironmentVariable(
                name="shared_model",
                value={"provider": "provider", "name": "model", "mode": "completion"},
            )
        ]

        with pytest.raises(ValueError, match="uses mode 'completion'.*uses mode 'chat'"):
            service._validate_workflow_credentials(workflow, credentials=self.credentials)

    def test_validate_workflow_credentials_should_raise_for_llm_node_missing_model(
        self, service: WorkflowService, sqlite_session: Session
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
            service._validate_workflow_credentials(workflow, credentials=self.credentials)

    def test_validate_workflow_credentials_should_wrap_unexpected_exception_in_value_error(
        self, service: WorkflowService, sqlite_session: Session
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
                service._validate_workflow_credentials(workflow, credentials=self.credentials)

    def test_validate_workflow_credentials_should_validate_agent_node_model(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
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
            service._validate_workflow_credentials(workflow, credentials=self.credentials)

        # Assert
        mock_llm.assert_called_once_with("tenant-1", "openai", "gpt-4")

    def test_validate_workflow_credentials_should_validate_agent_tools(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
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
            service._validate_workflow_credentials(workflow, credentials=self.credentials)

        # Assert
        mock_check.assert_called_once()  # provider-a has credential_id
        mock_default.assert_called_once_with("tenant-1", "provider-b", credentials=self.credentials)

    # --- _validate_llm_model_config ---

    def test_validate_llm_model_config_should_raise_value_error_on_failure(self, service: WorkflowService) -> None:
        """If ModelManager raises any exception it must be wrapped into ValueError."""
        # Arrange
        assembly = MagicMock()
        assembly.model_manager.get_model_instance.side_effect = RuntimeError("no key")

        with patch("services.workflow_service.create_plugin_model_assembly", return_value=assembly):
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
        assembly = MagicMock()
        assembly.provider_manager.get_configurations.return_value = mock_configs

        with patch("services.workflow_service.create_plugin_model_assembly", return_value=assembly):
            # Act
            service._validate_llm_model_config("tenant-1", "openai", "gpt-4")

            # Assert
            mock_model.raise_for_status.assert_called_once()
            assembly.model_manager.get_model_instance.assert_called_once_with(
                tenant_id="tenant-1",
                provider="openai",
                model_type=ModelType.LLM,
                model="gpt-4",
            )

    def test_validate_llm_model_config_model_not_found(self, service: WorkflowService) -> None:
        """Test ValueError when model is not found in provider configurations."""
        mock_configs = MagicMock()
        mock_configs.get_models.return_value = []  # No models
        assembly = MagicMock()
        assembly.provider_manager.get_configurations.return_value = mock_configs

        with patch("services.workflow_service.create_plugin_model_assembly", return_value=assembly):
            # Act + Assert
            with pytest.raises(ValueError, match="Model gpt-4 not found for provider openai"):
                service._validate_llm_model_config("tenant-1", "openai", "gpt-4")

    # --- _check_default_tool_credential ---

    def test_check_default_tool_credential_should_silently_pass_when_no_provider_found(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        """Missing BuiltinToolProvider → plugin requires no credentials → no error."""
        service._check_default_tool_credential("tenant-1", "some-provider", credentials=self.credentials)

    def test_check_default_tool_credential_should_raise_when_compliance_fails(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        provider = BuiltinToolProvider(
            name="API key",
            tenant_id="tenant-1",
            user_id="user-1",
            provider="some-provider",
        )
        sqlite_session.add(provider)
        sqlite_session.commit()

        with patch("core.helper.credential_utils.check_credential_policy_compliance", side_effect=Exception("denied")):
            with pytest.raises(ValueError, match="Failed to validate default credential"):
                service._check_default_tool_credential("tenant-1", "some-provider", credentials=self.credentials)

    # --- _is_load_balancing_enabled ---

    def test_is_load_balancing_enabled_should_return_false_when_provider_not_found(
        self, service: WorkflowService
    ) -> None:
        with patch("core.provider_manager.ProviderManager.get_configurations") as mock_get_configs:
            mock_configs = MagicMock()
            mock_configs.get.return_value = None  # provider not found
            mock_get_configs.return_value = mock_configs

            # Act
            result = service._is_load_balancing_enabled("tenant-1", "openai", "gpt-4")

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

    # --- _validate_load_balancing_credentials ---

    def test_validate_load_balancing_credentials_should_skip_when_no_model_config(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        """Missing provider or model in node_data should be a no-op."""
        # Arrange
        workflow = self._make_workflow([])
        node_data: dict[str, Any] = {}  # no model key

        # Act + Assert (no error expected)
        service._validate_load_balancing_credentials(workflow, node_data, "node-1", credentials=self.credentials)

    def test_validate_load_balancing_credentials_should_skip_when_lb_not_enabled(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        # Arrange
        workflow = self._make_workflow([])
        node_data = {"model": {"provider": "openai", "name": "gpt-4"}}

        # Act + Assert (no error expected)
        with patch.object(service, "_is_load_balancing_enabled", return_value=False):
            service._validate_load_balancing_credentials(workflow, node_data, "node-1", credentials=self.credentials)

    def test_validate_load_balancing_credentials_should_raise_when_compliance_fails(
        self, service: WorkflowService, sqlite_session: Session
    ) -> None:
        # Arrange
        workflow = self._make_workflow([])
        node_data = {"model": {"provider": "openai", "name": "gpt-4"}}
        lb_configs = ["cred-lb-1"]

        # Act + Assert
        with (
            patch.object(service, "_is_load_balancing_enabled", return_value=True),
            patch.object(self.credentials, "list_model_load_balancing_credential_ids", return_value=lb_configs),
            patch(
                "core.helper.credential_utils.check_credential_policy_compliance",
                side_effect=Exception("policy violation"),
            ),
        ):
            with pytest.raises(ValueError, match="Invalid load balancing credentials"):
                service._validate_load_balancing_credentials(
                    workflow, node_data, "node-1", credentials=self.credentials
                )


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
    def service(self, sqlite_engine: Engine) -> WorkflowService:
        return WorkflowService(sessionmaker(bind=sqlite_engine, expire_on_commit=False))

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
        node_run_result = NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
        succeeded_event = NodeRunSucceededEvent(
            id=str(uuid.uuid4()),
            node_id="node-1",
            node_type=BuiltinNodeTypes.LLM,
            node_run_result=node_run_result,
            start_at=naive_utc_now(),
        )

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
        node_run_result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error="node exploded",
        )
        failed_event = NodeRunFailedEvent(
            id=str(uuid.uuid4()),
            node_id="node-1",
            node_type=BuiltinNodeTypes.LLM,
            node_run_result=node_run_result,
            start_at=naive_utc_now(),
            error="node exploded",
        )

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

        original_result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            error="oops",
            error_type="ValueError",
            inputs={},
        )
        failed_event = NodeRunFailedEvent(
            id=str(uuid.uuid4()),
            node_id="node-1",
            node_type=BuiltinNodeTypes.LLM,
            node_run_result=original_result,
            start_at=naive_utc_now(),
            error="oops",
        )

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
    def service(self, sqlite_engine: Engine) -> WorkflowService:
        return WorkflowService(sessionmaker(bind=sqlite_engine, expire_on_commit=False))

    def test_get_node_last_run_should_delegate_to_repository(self, service: WorkflowService) -> None:
        # Arrange
        app = TestWorkflowAssociatedDataFactory.create_app(app_id="app-1", tenant_id="tenant-1")
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(workflow_id="wf-1")
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
        app = TestWorkflowAssociatedDataFactory.create_app(app_id="a", tenant_id="t")
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(workflow_id="w")
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

    def _make_workflow(self, workflow_type: str = WorkflowType.WORKFLOW) -> Workflow:
        return TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id="wf-1",
            app_id="app-1",
            workflow_type=WorkflowType(workflow_type),
        )

    def test_setup_variable_pool_should_use_full_system_variables_for_start_node(
        self,
    ) -> None:
        # Arrange
        workflow = self._make_workflow()

        # Act
        with (
            patch("services.workflow_service.VariablePool") as MockPool,
            patch("services.workflow_service.build_system_variables") as mock_build_system_variables,
            patch("services.workflow_service.build_bootstrap_variables") as mock_build_bootstrap_variables,
            patch("services.workflow_service.add_variables_to_pool") as mock_add_variables_to_pool,
            patch("services.workflow_service.add_node_inputs_to_pool") as mock_add_node_inputs_to_pool,
        ):
            _setup_variable_pool(
                query="hello",
                files=[],
                user_id="u-1",
                user_inputs={"k": "v"},
                workflow=workflow,
                node_id="start-node",
                node_type=BuiltinNodeTypes.START,
                conversation_id="conv-1",
                conversation_variables=[],
            )

        # Assert — start nodes should build bootstrap variables and attach node inputs.
        MockPool.assert_called_once_with()
        mock_build_system_variables.assert_called_once()
        mock_add_variables_to_pool.assert_called_once_with(
            MockPool.return_value,
            mock_build_bootstrap_variables.return_value,
        )
        mock_add_node_inputs_to_pool.assert_called_once_with(
            MockPool.return_value,
            node_id="start-node",
            inputs={"k": "v"},
        )

    def test_setup_variable_pool_should_use_default_system_variables_for_non_start_node(
        self,
    ) -> None:
        # Arrange
        workflow = self._make_workflow()

        # Act
        with (
            patch("services.workflow_service.VariablePool") as MockPool,
            patch("services.workflow_service.default_system_variables") as mock_default_system_variables,
            patch("services.workflow_service.build_bootstrap_variables") as mock_build_bootstrap_variables,
            patch("services.workflow_service.add_variables_to_pool") as mock_add_variables_to_pool,
            patch("services.workflow_service.add_node_inputs_to_pool") as mock_add_node_inputs_to_pool,
        ):
            _setup_variable_pool(
                query="",
                files=[],
                user_id="u-1",
                user_inputs={},
                workflow=workflow,
                node_id="llm-node",
                node_type=BuiltinNodeTypes.LLM,  # not a start/trigger node
                conversation_id="conv-1",
                conversation_variables=[],
            )

        # Assert — default system variables should be used and node inputs should not be added.
        mock_default_system_variables.assert_called_once()
        MockPool.assert_called_once_with()
        mock_add_variables_to_pool.assert_called_once_with(
            MockPool.return_value,
            mock_build_bootstrap_variables.return_value,
        )
        mock_add_node_inputs_to_pool.assert_not_called()

    def test_setup_variable_pool_should_set_chatflow_specifics_for_non_workflow_type(
        self,
    ) -> None:
        """For ADVANCED_CHAT workflows on a START node, query/conversation_id/dialogue_count should be set."""
        from models.workflow import WorkflowType

        # Arrange
        workflow = self._make_workflow(workflow_type=WorkflowType.CHAT)

        # Act
        with (
            patch("services.workflow_service.VariablePool") as MockPool,
            patch("services.workflow_service.build_system_variables") as mock_build_system_variables,
            patch("services.workflow_service.build_bootstrap_variables"),
            patch("services.workflow_service.add_variables_to_pool"),
            patch("services.workflow_service.add_node_inputs_to_pool"),
        ):
            _setup_variable_pool(
                query="what is AI?",
                files=[],
                user_id="u-1",
                user_inputs={},
                workflow=workflow,
                node_id="start-node",
                node_type=BuiltinNodeTypes.START,
                conversation_id="conv-abc",
                conversation_variables=[],
            )

        # Assert — chatflow system variables should include query, conversation_id and dialogue_count.
        MockPool.assert_called_once_with()
        system_variable_values = mock_build_system_variables.call_args.args[0]
        assert system_variable_values["query"] == "what is AI?"
        assert system_variable_values["conversation_id"] == "conv-abc"
        assert system_variable_values["dialogue_count"] == 1


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
        mock_build.assert_called_once_with(mapping=value, tenant_id=tenant_id, access_controller=ANY)

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
        mock_build.assert_called_once_with(mappings=value, tenant_id=tenant_id, access_controller=ANY)

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
        user_inputs: dict[str, Any] = {}  # attachment not provided

        # Act
        result = _rebuild_file_for_user_inputs_in_start_node(
            tenant_id="tenant-1",
            start_node_data=start_data,
            user_inputs=user_inputs,
        )

        # Assert — no key should be added for missing inputs
        assert "attachment" not in result


# ===========================================================================
# TestWorkflowServiceHumanInputOperations
# Tests for Human Input related methods
# ===========================================================================


# ===========================================================================
# TestWorkflowServiceFreeNodeExecution
# Tests for run_free_workflow_node and handle_single_step_result
# ===========================================================================


class TestWorkflowServiceFreeNodeExecution:
    @pytest.fixture
    def service(self, sqlite_engine: Engine) -> WorkflowService:
        return WorkflowService(sessionmaker(bind=sqlite_engine, expire_on_commit=False))

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
        app = TestWorkflowAssociatedDataFactory.create_app(mode=AppMode.WORKFLOW)
        features = {}
        with patch("services.workflow_service.WorkflowAppConfigManager.config_validate") as mock_val:
            service.validate_features_structure(app, features)
            mock_val.assert_called_once()

    def test_validate_features_structure_invalid_mode(self, service: WorkflowService) -> None:
        app = TestWorkflowAssociatedDataFactory.create_app()
        app.mode = "invalid"
        with pytest.raises(ValueError, match="Invalid app mode"):
            service.validate_features_structure(app, {})

    def test_validate_human_input_node_data_error(self, service: WorkflowService) -> None:
        with patch("services.workflow_service.HumanInputNodeData.model_validate", side_effect=Exception("error")):
            with pytest.raises(ValueError, match="Invalid HumanInput node data"):
                service._validate_human_input_node_data({})

    def test_rebuild_single_file_unreachable(self) -> None:
        # Test line 1523 (unreachable)
        with pytest.raises(Exception, match="unreachable"):
            _rebuild_single_file("tenant-1", {}, cast(Any, "invalid_type"))
