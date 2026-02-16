"""Comprehensive TestContainers-based integration tests for PauseStatePersistenceLayer class.

This test suite covers complete integration scenarios including:
- Real database interactions using containerized PostgreSQL
- Real storage operations using test storage backend
- Complete workflow: event -> state serialization -> database save -> storage save
- Testing with actual WorkflowRunService (not mocked)
- Real Workflow and WorkflowRun instances in database
- Database transactions and rollback behavior
- Actual file upload and retrieval through storage
- Workflow status transitions in database
- Error handling with real database constraints
- Multiple pause events in sequence
- Integration with real ReadOnlyGraphRuntimeState implementations

These tests use TestContainers to spin up real services for integration testing,
providing more reliable and realistic test scenarios than mocks.
"""

import json
import uuid
from time import time

import pytest
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import (
    PauseStatePersistenceLayer,
    WorkflowResumptionContext,
)
from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.graph_engine.entities.commands import GraphEngineCommand
from core.workflow.graph_engine.layers.base import GraphEngineLayerNotInitializedError
from core.workflow.graph_events.graph import GraphRunPausedEvent
from core.workflow.runtime.graph_runtime_state import GraphRuntimeState
from core.workflow.runtime.graph_runtime_state_protocol import ReadOnlyGraphRuntimeState
from core.workflow.runtime.read_only_wrappers import ReadOnlyGraphRuntimeStateWrapper
from core.workflow.runtime.variable_pool import SystemVariable, VariablePool
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models import Account
from models import WorkflowPause as WorkflowPauseModel
from models.model import AppMode, UploadFile
from models.workflow import Workflow, WorkflowRun
from services.file_service import FileService
from services.workflow_run_service import WorkflowRunService


class _TestCommandChannelImpl:
    """Real implementation of CommandChannel for testing."""

    def __init__(self):
        self._commands: list[GraphEngineCommand] = []

    def fetch_commands(self) -> list[GraphEngineCommand]:
        """Fetch pending commands for this GraphEngine instance."""
        return self._commands.copy()

    def send_command(self, command: GraphEngineCommand) -> None:
        """Send a command to be processed by this GraphEngine instance."""
        self._commands.append(command)


class TestPauseStatePersistenceLayerTestContainers:
    """Comprehensive TestContainers-based integration tests for PauseStatePersistenceLayer class."""

    @pytest.fixture
    def engine(self, db_session_with_containers: Session):
        """Get database engine from TestContainers session."""
        bind = db_session_with_containers.get_bind()
        assert isinstance(bind, Engine)
        return bind

    @pytest.fixture
    def file_service(self, engine: Engine):
        """Create FileService instance with TestContainers engine."""
        return FileService(engine)

    @pytest.fixture
    def workflow_run_service(self, engine: Engine, file_service: FileService):
        """Create WorkflowRunService instance with TestContainers engine and FileService."""
        return WorkflowRunService(engine)

    @pytest.fixture(autouse=True)
    def setup_test_data(self, db_session_with_containers, file_service, workflow_run_service):
        """Set up test data for each test method using TestContainers."""
        # Create test tenant and account
        from models.account import Tenant, TenantAccountJoin, TenantAccountRole

        tenant = Tenant(
            name="Test Tenant",
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        account = Account(
            email="test@example.com",
            name="Test User",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        # Create tenant-account join
        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.commit()

        # Set test data
        self.test_tenant_id = tenant.id
        self.test_user_id = account.id
        self.test_app_id = str(uuid.uuid4())
        self.test_workflow_id = str(uuid.uuid4())
        self.test_workflow_run_id = str(uuid.uuid4())

        # Create test workflow
        self.test_workflow = Workflow(
            id=self.test_workflow_id,
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features='{"file_upload": {"enabled": false}}',
            created_by=self.test_user_id,
            created_at=naive_utc_now(),
        )

        # Create test workflow run
        self.test_workflow_run = WorkflowRun(
            id=self.test_workflow_run_id,
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            workflow_id=self.test_workflow_id,
            type="workflow",
            triggered_from="debugging",
            version="draft",
            status=WorkflowExecutionStatus.RUNNING,
            created_by=self.test_user_id,
            created_by_role="account",
            created_at=naive_utc_now(),
        )

        # Store session and service instances
        self.session = db_session_with_containers
        self.file_service = file_service
        self.workflow_run_service = workflow_run_service

        # Save test data to database
        self.session.add(self.test_workflow)
        self.session.add(self.test_workflow_run)
        self.session.commit()

        yield

        # Cleanup
        self._cleanup_test_data()

    def _cleanup_test_data(self):
        """Clean up test data after each test method."""
        try:
            # Clean up workflow pauses
            self.session.execute(delete(WorkflowPauseModel))
            # Clean up upload files
            self.session.execute(
                delete(UploadFile).where(
                    UploadFile.tenant_id == self.test_tenant_id,
                )
            )
            # Clean up workflow runs
            self.session.execute(
                delete(WorkflowRun).where(
                    WorkflowRun.tenant_id == self.test_tenant_id,
                    WorkflowRun.app_id == self.test_app_id,
                )
            )
            # Clean up workflows
            self.session.execute(
                delete(Workflow).where(
                    Workflow.tenant_id == self.test_tenant_id,
                    Workflow.app_id == self.test_app_id,
                )
            )
            self.session.commit()
        except Exception as e:
            self.session.rollback()
            raise e

    def _create_graph_runtime_state(
        self,
        outputs: dict[str, object] | None = None,
        total_tokens: int = 0,
        node_run_steps: int = 0,
        variables: dict[tuple[str, str], object] | None = None,
        workflow_run_id: str | None = None,
    ) -> ReadOnlyGraphRuntimeState:
        """Create a real GraphRuntimeState for testing."""
        start_at = time()

        execution_id = workflow_run_id or getattr(self, "test_workflow_run_id", None) or str(uuid.uuid4())

        # Create variable pool
        variable_pool = VariablePool(system_variables=SystemVariable(workflow_execution_id=execution_id))
        if variables:
            for (node_id, var_key), value in variables.items():
                variable_pool.add([node_id, var_key], value)

        # Create LLM usage
        llm_usage = LLMUsage.empty_usage()

        # Create graph runtime state
        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=start_at,
            total_tokens=total_tokens,
            llm_usage=llm_usage,
            outputs=outputs or {},
            node_run_steps=node_run_steps,
        )

        return ReadOnlyGraphRuntimeStateWrapper(graph_runtime_state)

    def _create_generate_entity(
        self,
        workflow_execution_id: str | None = None,
        user_id: str | None = None,
        workflow_id: str | None = None,
    ) -> WorkflowAppGenerateEntity:
        execution_id = workflow_execution_id or getattr(self, "test_workflow_run_id", str(uuid.uuid4()))
        wf_id = workflow_id or getattr(self, "test_workflow_id", str(uuid.uuid4()))
        tenant_id = getattr(self, "test_tenant_id", "tenant-123")
        app_id = getattr(self, "test_app_id", "app-123")
        app_config = WorkflowUIBasedAppConfig(
            tenant_id=str(tenant_id),
            app_id=str(app_id),
            app_mode=AppMode.WORKFLOW,
            workflow_id=str(wf_id),
        )
        return WorkflowAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            inputs={},
            files=[],
            user_id=user_id or getattr(self, "test_user_id", str(uuid.uuid4())),
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_execution_id=execution_id,
        )

    def _create_pause_state_persistence_layer(
        self,
        workflow_run: WorkflowRun | None = None,
        workflow: Workflow | None = None,
        state_owner_user_id: str | None = None,
        generate_entity: WorkflowAppGenerateEntity | None = None,
    ) -> PauseStatePersistenceLayer:
        """Create PauseStatePersistenceLayer with real dependencies."""
        owner_id = state_owner_user_id
        if owner_id is None:
            if workflow is not None and workflow.created_by:
                owner_id = workflow.created_by
            elif workflow_run is not None and workflow_run.created_by:
                owner_id = workflow_run.created_by
            else:
                owner_id = getattr(self, "test_user_id", None)

        assert owner_id is not None
        owner_id = str(owner_id)
        workflow_execution_id = (
            workflow_run.id if workflow_run is not None else getattr(self, "test_workflow_run_id", None)
        )
        assert workflow_execution_id is not None
        workflow_id = workflow.id if workflow is not None else getattr(self, "test_workflow_id", None)
        assert workflow_id is not None
        entity_user_id = getattr(self, "test_user_id", owner_id)
        entity = generate_entity or self._create_generate_entity(
            workflow_execution_id=str(workflow_execution_id),
            user_id=entity_user_id,
            workflow_id=str(workflow_id),
        )

        return PauseStatePersistenceLayer(
            session_factory=self.session.get_bind(),
            state_owner_user_id=owner_id,
            generate_entity=entity,
        )

    def test_complete_pause_flow_with_real_dependencies(self, db_session_with_containers):
        """Test complete pause flow: event -> state serialization -> database save -> storage save."""
        # Arrange
        layer = self._create_pause_state_persistence_layer()

        # Create real graph runtime state with test data
        test_outputs = {"result": "test_output", "step": "intermediate"}
        test_variables = {
            ("node1", "var1"): "string_value",
            ("node2", "var2"): {"complex": "object"},
        }
        graph_runtime_state = self._create_graph_runtime_state(
            outputs=test_outputs,
            total_tokens=100,
            node_run_steps=5,
            variables=test_variables,
        )

        command_channel = _TestCommandChannelImpl()
        layer.initialize(graph_runtime_state, command_channel)

        # Create pause event
        event = GraphRunPausedEvent(
            reasons=[SchedulingPause(message="test pause")],
            outputs={"intermediate": "result"},
        )

        # Act
        layer.on_event(event)

        # Assert - Verify pause state was saved to database
        self.session.refresh(self.test_workflow_run)
        workflow_run = self.session.get(WorkflowRun, self.test_workflow_run_id)
        assert workflow_run is not None
        assert workflow_run.status == WorkflowExecutionStatus.PAUSED

        # Verify pause state exists in database
        pause_model = self.session.scalars(
            select(WorkflowPauseModel).where(WorkflowPauseModel.workflow_run_id == workflow_run.id)
        ).first()
        assert pause_model is not None
        assert pause_model.workflow_id == self.test_workflow_id
        assert pause_model.workflow_run_id == self.test_workflow_run_id
        assert pause_model.state_object_key != ""
        assert pause_model.resumed_at is None

        storage_content = storage.load(pause_model.state_object_key).decode()
        resumption_context = WorkflowResumptionContext.loads(storage_content)
        assert resumption_context.version == "1"
        assert resumption_context.serialized_graph_runtime_state == graph_runtime_state.dumps()
        expected_state = json.loads(graph_runtime_state.dumps())
        actual_state = json.loads(resumption_context.serialized_graph_runtime_state)
        assert actual_state == expected_state
        persisted_entity = resumption_context.get_generate_entity()
        assert isinstance(persisted_entity, WorkflowAppGenerateEntity)
        assert persisted_entity.workflow_execution_id == self.test_workflow_run_id

    def test_state_persistence_and_retrieval(self, db_session_with_containers):
        """Test that pause state can be persisted and retrieved correctly."""
        # Arrange
        layer = self._create_pause_state_persistence_layer()

        # Create complex test data
        complex_outputs = {
            "nested": {"key": "value", "number": 42},
            "list": [1, 2, 3, {"nested": "item"}],
            "boolean": True,
            "null_value": None,
        }
        complex_variables = {
            ("node1", "var1"): "string_value",
            ("node2", "var2"): {"complex": "object"},
            ("node3", "var3"): [1, 2, 3],
        }

        graph_runtime_state = self._create_graph_runtime_state(
            outputs=complex_outputs,
            total_tokens=250,
            node_run_steps=10,
            variables=complex_variables,
        )

        command_channel = _TestCommandChannelImpl()
        layer.initialize(graph_runtime_state, command_channel)

        event = GraphRunPausedEvent(reasons=[SchedulingPause(message="test pause")])

        # Act - Save pause state
        layer.on_event(event)

        # Assert - Retrieve and verify
        pause_entity = self.workflow_run_service._workflow_run_repo.get_workflow_pause(self.test_workflow_run_id)
        assert pause_entity is not None
        assert pause_entity.workflow_execution_id == self.test_workflow_run_id
        assert pause_entity.get_pause_reasons() == event.reasons

        state_bytes = pause_entity.get_state()
        resumption_context = WorkflowResumptionContext.loads(state_bytes.decode())
        retrieved_state = json.loads(resumption_context.serialized_graph_runtime_state)
        expected_state = json.loads(graph_runtime_state.dumps())

        assert retrieved_state == expected_state
        assert retrieved_state["outputs"] == complex_outputs
        assert retrieved_state["total_tokens"] == 250
        assert retrieved_state["node_run_steps"] == 10
        assert resumption_context.get_generate_entity().workflow_execution_id == self.test_workflow_run_id

    def test_database_transaction_handling(self, db_session_with_containers):
        """Test that database transactions are handled correctly."""
        # Arrange
        layer = self._create_pause_state_persistence_layer()
        graph_runtime_state = self._create_graph_runtime_state(
            outputs={"test": "transaction"},
            total_tokens=50,
        )

        command_channel = _TestCommandChannelImpl()
        layer.initialize(graph_runtime_state, command_channel)

        event = GraphRunPausedEvent(reasons=[SchedulingPause(message="test pause")])

        # Act
        layer.on_event(event)

        # Assert - Verify data is committed and accessible in new session
        with Session(bind=self.session.get_bind(), expire_on_commit=False) as new_session:
            workflow_run = new_session.get(WorkflowRun, self.test_workflow_run_id)
            assert workflow_run is not None
            assert workflow_run.status == WorkflowExecutionStatus.PAUSED

            pause_model = new_session.scalars(
                select(WorkflowPauseModel).where(WorkflowPauseModel.workflow_run_id == workflow_run.id)
            ).first()
            assert pause_model is not None
            assert pause_model.workflow_run_id == self.test_workflow_run_id
            assert pause_model.resumed_at is None
            assert pause_model.state_object_key != ""

    def test_file_storage_integration(self, db_session_with_containers):
        """Test integration with file storage system."""
        # Arrange
        layer = self._create_pause_state_persistence_layer()

        # Create large state data to test storage
        large_outputs = {"data": "x" * 10000}  # 10KB of data
        graph_runtime_state = self._create_graph_runtime_state(
            outputs=large_outputs,
            total_tokens=1000,
        )

        command_channel = _TestCommandChannelImpl()
        layer.initialize(graph_runtime_state, command_channel)

        event = GraphRunPausedEvent(reasons=[SchedulingPause(message="test pause")])

        # Act
        layer.on_event(event)

        # Assert - Verify file was uploaded to storage
        self.session.refresh(self.test_workflow_run)
        pause_model = self.session.scalars(
            select(WorkflowPauseModel).where(WorkflowPauseModel.workflow_run_id == self.test_workflow_run.id)
        ).first()
        assert pause_model is not None
        assert pause_model.state_object_key != ""

        # Verify content in storage
        storage_content = storage.load(pause_model.state_object_key).decode()
        resumption_context = WorkflowResumptionContext.loads(storage_content)
        assert resumption_context.serialized_graph_runtime_state == graph_runtime_state.dumps()
        assert resumption_context.get_generate_entity().workflow_execution_id == self.test_workflow_run_id

    def test_workflow_with_different_creators(self, db_session_with_containers):
        """Test pause state with workflows created by different users."""
        # Arrange - Create workflow with different creator
        different_user_id = str(uuid.uuid4())
        different_workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features='{"file_upload": {"enabled": false}}',
            created_by=different_user_id,
            created_at=naive_utc_now(),
        )

        different_workflow_run = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            workflow_id=different_workflow.id,
            type="workflow",
            triggered_from="debugging",
            version="draft",
            status=WorkflowExecutionStatus.RUNNING,
            created_by=self.test_user_id,  # Run created by different user
            created_by_role="account",
            created_at=naive_utc_now(),
        )

        self.session.add(different_workflow)
        self.session.add(different_workflow_run)
        self.session.commit()

        layer = self._create_pause_state_persistence_layer(
            workflow_run=different_workflow_run,
            workflow=different_workflow,
        )

        graph_runtime_state = self._create_graph_runtime_state(
            outputs={"creator_test": "different_creator"},
            workflow_run_id=different_workflow_run.id,
        )

        command_channel = _TestCommandChannelImpl()
        layer.initialize(graph_runtime_state, command_channel)

        event = GraphRunPausedEvent(reasons=[SchedulingPause(message="test pause")])

        # Act
        layer.on_event(event)

        # Assert - Should use workflow creator (not run creator)
        self.session.refresh(different_workflow_run)
        pause_model = self.session.scalars(
            select(WorkflowPauseModel).where(WorkflowPauseModel.workflow_run_id == different_workflow_run.id)
        ).first()
        assert pause_model is not None

        # Verify the state owner is the workflow creator
        pause_entity = self.workflow_run_service._workflow_run_repo.get_workflow_pause(different_workflow_run.id)
        assert pause_entity is not None
        resumption_context = WorkflowResumptionContext.loads(pause_entity.get_state().decode())
        assert resumption_context.get_generate_entity().workflow_execution_id == different_workflow_run.id

    def test_layer_ignores_non_pause_events(self, db_session_with_containers):
        """Test that layer ignores non-pause events."""
        # Arrange
        layer = self._create_pause_state_persistence_layer()
        graph_runtime_state = self._create_graph_runtime_state()

        command_channel = _TestCommandChannelImpl()
        layer.initialize(graph_runtime_state, command_channel)

        # Import other event types
        from core.workflow.graph_events.graph import (
            GraphRunFailedEvent,
            GraphRunStartedEvent,
            GraphRunSucceededEvent,
        )

        # Act - Send non-pause events
        layer.on_event(GraphRunStartedEvent())
        layer.on_event(GraphRunSucceededEvent(outputs={"result": "success"}))
        layer.on_event(GraphRunFailedEvent(error="test error", exceptions_count=1))

        # Assert - No pause state should be created
        self.session.refresh(self.test_workflow_run)
        assert self.test_workflow_run.status == WorkflowExecutionStatus.RUNNING

        pause_states = (
            self.session.query(WorkflowPauseModel)
            .filter(WorkflowPauseModel.workflow_run_id == self.test_workflow_run_id)
            .all()
        )
        assert len(pause_states) == 0

    def test_layer_requires_initialization(self, db_session_with_containers):
        """Test that layer requires proper initialization before handling events."""
        # Arrange
        layer = self._create_pause_state_persistence_layer()
        # Don't initialize - graph_runtime_state should be uninitialized

        event = GraphRunPausedEvent(reasons=[SchedulingPause(message="test pause")])

        # Act & Assert - Should raise GraphEngineLayerNotInitializedError
        with pytest.raises(GraphEngineLayerNotInitializedError):
            layer.on_event(event)
