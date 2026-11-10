from datetime import datetime
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from kombu.serialization import dumps, loads
from sqlalchemy import Engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_node_execution_repository import CeleryWorkflowNodeExecutionRepository
from core.repositories.factory import OrderConfig, WorkflowNodeExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.node_execution import WorkflowNodeExecution as _workflow_node_execution_batch_WorkflowNodeExecution
from core.workflow.node_execution import WorkflowNodeExecution as _workflow_node_execution_callers_WorkflowNodeExecution
from core.workflow.node_execution_process_data import WORKFLOW_TOOL_ROOT_APP_ID_KEY
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecution as _celery_workflow_node_execution_repository_WorkflowNodeExecution,
)
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecutionStatus as _celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus,
)
from graphon.enums import BuiltinNodeTypes
from graphon.enums import WorkflowNodeExecutionStatus as _workflow_node_execution_batch_WorkflowNodeExecutionStatus
from graphon.enums import WorkflowNodeExecutionStatus as _workflow_node_execution_callers_WorkflowNodeExecutionStatus
from graphon.variables.segments import ArrayFileSegment, ArrayObjectSegment, StringSegment
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser, Tenant
from models import WorkflowNodeExecutionModel as _celery_workflow_node_execution_repository_WorkflowNodeExecutionModel
from models.enums import ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel as _workflow_node_execution_batch_WorkflowNodeExecutionModel
from models.workflow import WorkflowNodeExecutionModel as _workflow_node_execution_callers_WorkflowNodeExecutionModel
from models.workflow import WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom
from repositories.factory import DifyAPIRepositoryFactory
from tasks import workflow_node_execution_tasks
from tasks.workflow_node_execution_tasks import (
    save_workflow_node_execution_task,
    save_workflow_node_executions_task,
)
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_upload_file

"""
Unit tests for CeleryWorkflowNodeExecutionRepository.

These tests verify the Celery-based asynchronous storage functionality
for workflow node execution data.
"""


RESOURCE_TENANT_ID = "resource-tenant-id"


class TestCeleryWorkflowNodeExecutionRepositoryCases:
    @staticmethod
    @pytest.fixture
    def account():
        """Create an Account user."""
        account = Account(name="Test Account", email="test@example.com")
        account.id = str(uuid4())
        account._current_tenant = Tenant(name="Test Tenant")
        account._current_tenant.id = str(uuid4())
        return account

    @staticmethod
    @pytest.fixture
    def end_user():
        """Create an EndUser."""
        user = EndUser(
            id=str(uuid4()),
            tenant_id=str(uuid4()),
        )
        return user

    @staticmethod
    @pytest.fixture
    def sample_workflow_node_execution():
        """Sample WorkflowNodeExecution for testing."""
        return _celery_workflow_node_execution_repository_WorkflowNodeExecution(
            id=str(uuid4()),
            node_execution_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_execution_id=str(uuid4()),
            index=1,
            node_id="test_node",
            node_type=BuiltinNodeTypes.START,
            title="Test Node",
            inputs={"input1": "value1"},
            status=_celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )

    class TestCeleryWorkflowNodeExecutionRepository:
        """Test cases for CeleryWorkflowNodeExecutionRepository."""

        @pytest.mark.parametrize("writer", ["save", "save_many"])
        def test_async_save_preserves_typed_cache_and_plain_history(
            self, writer, sqlite_session_factory, account, sample_workflow_node_execution
        ):
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            literal_object = {"value_type": "string", "value": "user data"}
            execution = sample_workflow_node_execution
            execution.node_type = BuiltinNodeTypes.TOOL
            execution.status = _celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.SUCCEEDED
            execution.inputs = {"prompt": StringSegment(value="input")}
            execution.process_data = {"nested": {"messages": [StringSegment(value="processing")]}}
            execution.outputs = {
                "text": StringSegment(value="done"),
                "files": ArrayFileSegment(value=[]),
                "json": ArrayObjectSegment(value=[literal_object]),
                "literal_object": literal_object,
            }
            task = save_workflow_node_execution_task if writer == "save" else save_workflow_node_executions_task
            with patch.object(task, "delay") as delay:
                if writer == "save":
                    repo.save(execution)
                else:
                    repo.save_many([execution])

            delay.assert_called_once()
            assert task.run(**delay.call_args.kwargs) is True

            expected_outputs = {
                "text": "done",
                "files": [],
                "json": [literal_object],
                "literal_object": literal_object,
            }
            with sqlite_session_factory() as observer:
                stored = observer.get(
                    _celery_workflow_node_execution_repository_WorkflowNodeExecutionModel, execution.id
                )
                assert stored is not None
                assert stored.inputs_dict == {"prompt": "input"}
                assert stored.process_data_dict == {"nested": {"messages": ["processing"]}}
                assert stored.outputs_dict == expected_outputs

            (cached,) = repo.get_by_workflow_execution(execution.workflow_execution_id)
            assert cached is execution
            assert isinstance(cached.inputs["prompt"], StringSegment)
            assert isinstance(cached.process_data["nested"]["messages"][0], StringSegment)
            assert isinstance(cached.outputs["text"], StringSegment)
            assert isinstance(cached.outputs["files"], ArrayFileSegment)
            assert isinstance(cached.outputs["json"], ArrayObjectSegment)
            assert cached.outputs["literal_object"] == literal_object

            history_repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            (restored,) = history_repo.get_by_workflow_execution(execution.workflow_execution_id)
            assert restored.inputs == {"prompt": "input"}
            assert restored.process_data == {"nested": {"messages": ["processing"]}}
            assert restored.outputs == expected_outputs

        def test_trace_read_keeps_source_nodes_out_of_runtime_cache(
            self, sqlite_session_factory, end_user, sample_workflow_node_execution
        ):
            caller = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=end_user,
                app_id="caller-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            root = sample_workflow_node_execution
            caller.save_synchronously(root)
            source = caller.for_workflow_tool("source-app")
            child = root.model_copy(
                update={
                    "id": "child",
                    "node_execution_id": "child",
                    "process_data": {WORKFLOW_TOOL_ROOT_APP_ID_KEY: "caller-app"},
                }
            )
            source.save_synchronously(child)
            assert [node.id for node in caller.get_by_workflow_execution(root.workflow_execution_id)] == [root.id]
            assert [node.id for node in source.get_by_workflow_execution(root.workflow_execution_id)] == [child.id]
            assert [node.id for node in caller.get_by_workflow_execution(root.workflow_execution_id)] == [root.id]

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_workflow_tool_scope_keeps_async_backend_and_isolates_same_app_history(
            self, mock_task, sqlite_session_factory, end_user, sample_workflow_node_execution
        ):
            caller = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=end_user,
                app_id="caller-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            source = caller.for_workflow_tool("caller-app")
            root_node = sample_workflow_node_execution
            source_node = root_node.model_copy(update={"id": "source-exec", "node_execution_id": "source-exec"})
            caller.save_synchronously(root_node)
            source.save_synchronously(source_node)
            source_node.status = _celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.SUCCEEDED
            source_node.outputs = {"answer": "ok"}
            source.save(source_node)
            source.save_execution_data(source_node)

            assert [node.id for node in caller.get_by_workflow_execution(root_node.workflow_execution_id)] == [
                root_node.id
            ]
            assert [node.id for node in source.get_by_workflow_execution(root_node.workflow_execution_id)] == [
                source_node.id
            ]
            restored_source = caller.for_workflow_tool("caller-app")
            assert [node.id for node in restored_source.get_by_workflow_execution(root_node.workflow_execution_id)] == [
                source_node.id
            ]
            mock_task.delay.assert_called_once_with(
                execution_data=source_node.model_dump(),
                tenant_id=RESOURCE_TENANT_ID,
                app_id="caller-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL.value,
                creator_user_id=end_user.id,
                creator_user_role="end_user",
            )

        def test_init_with_sessionmaker(self, sqlite_session_factory, account):
            """Test repository initialization with sessionmaker."""
            app_id = "test-app-id"
            triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN

            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            assert repo._tenant_id == RESOURCE_TENANT_ID
            assert repo._app_id == app_id
            assert repo._triggered_from == triggered_from
            assert repo._creator_user_id == account.id
            assert repo._creator_user_role is not None

        def test_init_with_cache_initialized(self, sqlite_session_factory, account):
            """Test repository initialization with cache properly initialized."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
            )

            assert repo._execution_cache == {}
            assert repo._workflow_execution_mapping == {}

        def test_init_with_end_user(self, sqlite_session_factory, end_user):
            """Test repository initialization with EndUser."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=end_user,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            assert repo._tenant_id == RESOURCE_TENANT_ID

        def test_init_without_tenant_id_raises_error(self, sqlite_session_factory):
            """Test that initialization fails without tenant_id."""
            # Create an Account with no tenant_id.
            user = Account(name="Test Account", email="test@example.com")
            user.id = str(uuid4())

            with pytest.raises(ValueError, match="tenant_id is required"):
                CeleryWorkflowNodeExecutionRepository(
                    session_factory=sqlite_session_factory,
                    tenant_id="",
                    user=user,
                    app_id="test-app",
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                )

        def test_init_uses_resource_tenant_when_account_has_no_current_tenant(self, sqlite_session_factory):
            user = Account(name="Test Account", email="test@example.com")
            user.id = str(uuid4())

            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=user,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            assert repo._tenant_id == RESOURCE_TENANT_ID
            assert repo._creator_user_id == user.id

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_save_caches_and_queues_celery_task(
            self, mock_task, sqlite_session_factory, account, sample_workflow_node_execution
        ):
            """Test that save operation caches execution and queues a Celery task."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            repo.save(sample_workflow_node_execution)

            # Verify Celery task was queued with correct parameters
            mock_task.delay.assert_called_once()
            call_args = mock_task.delay.call_args[1]

            assert call_args["execution_data"] == sample_workflow_node_execution.model_dump()
            assert call_args["tenant_id"] == RESOURCE_TENANT_ID
            assert call_args["app_id"] == "test-app"
            assert call_args["triggered_from"] == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
            assert call_args["creator_user_id"] == account.id

            # Verify execution is cached
            assert sample_workflow_node_execution.id in repo._execution_cache
            assert repo._execution_cache[sample_workflow_node_execution.id] == sample_workflow_node_execution

            # Verify workflow execution mapping is updated
            assert sample_workflow_node_execution.workflow_execution_id in repo._workflow_execution_mapping
            assert (
                sample_workflow_node_execution.id
                in repo._workflow_execution_mapping[sample_workflow_node_execution.workflow_execution_id]
            )

        def test_save_synchronously_uses_sql_repository_without_queueing(
            self, sqlite_session_factory, account, sample_workflow_node_execution
        ):
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            repo._sql_repository.save_synchronously = Mock()

            repo.save_synchronously(sample_workflow_node_execution)

            repo._sql_repository.save_synchronously.assert_called_once_with(sample_workflow_node_execution)
            assert repo._execution_cache[sample_workflow_node_execution.id] is sample_workflow_node_execution

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_save_handles_celery_failure(
            self, mock_task, sqlite_session_factory, account, sample_workflow_node_execution
        ):
            """Test that save operation handles Celery task failures."""
            mock_task.delay.side_effect = Exception("Celery is down")

            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            with pytest.raises(Exception, match="Celery is down"):
                repo.save(sample_workflow_node_execution)

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_get_by_workflow_execution_from_cache(
            self, mock_task, sqlite_session_factory, account, sample_workflow_node_execution
        ):
            """Test that get_by_workflow_execution retrieves executions from cache."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            # Save execution to cache first
            repo.save(sample_workflow_node_execution)

            workflow_execution_id = sample_workflow_node_execution.workflow_execution_id
            order_config = OrderConfig(order_by=["index"], order_direction="asc")

            result = repo.get_by_workflow_execution(workflow_execution_id, order_config)

            # Verify results were retrieved from cache
            assert len(result) == 1
            assert result[0].id == sample_workflow_node_execution.id
            assert result[0] is sample_workflow_node_execution

        def test_get_by_workflow_execution_without_order_config(self, sqlite_session_factory, account):
            """Test get_by_workflow_execution without order configuration."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            result = repo.get_by_workflow_execution("workflow-run-id")

            # Should return empty list since nothing in cache
            assert len(result) == 0

        def test_get_by_workflow_execution_loads_persisted_executions_on_cache_miss(
            self, sqlite_session_factory, account, sample_workflow_node_execution
        ):
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            repo._sql_repository = Mock()
            repo._sql_repository.get_by_workflow_execution.return_value = [sample_workflow_node_execution]

            result = repo.get_by_workflow_execution(sample_workflow_node_execution.workflow_execution_id)

            assert result == [sample_workflow_node_execution]
            assert repo._execution_cache[sample_workflow_node_execution.id] is sample_workflow_node_execution
            assert repo._workflow_execution_mapping[sample_workflow_node_execution.workflow_execution_id] == [
                sample_workflow_node_execution.id
            ]

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_get_by_workflow_execution_merges_database_and_newer_cache(
            self, mock_task, sqlite_session_factory, account, sample_workflow_node_execution
        ):
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            persisted_current = sample_workflow_node_execution.model_copy(deep=True)
            historical = sample_workflow_node_execution.model_copy(
                update={
                    "id": str(uuid4()),
                    "node_execution_id": str(uuid4()),
                    "index": 0,
                    "node_id": "start",
                }
            )
            sample_workflow_node_execution.status = (
                _celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.SUCCEEDED
            )
            repo.save(sample_workflow_node_execution)
            repo._sql_repository = Mock()
            repo._sql_repository.get_by_workflow_execution.return_value = [persisted_current, historical]

            result = repo.get_by_workflow_execution(
                sample_workflow_node_execution.workflow_execution_id,
                OrderConfig(order_by=["index"], order_direction="asc"),
            )

            assert [execution.id for execution in result] == [historical.id, sample_workflow_node_execution.id]
            assert result[1] is sample_workflow_node_execution

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_cache_operations(self, mock_task, sqlite_session_factory, account, sample_workflow_node_execution):
            """Test cache operations work correctly."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            # Test saving to cache
            repo.save(sample_workflow_node_execution)

            # Verify cache contains the execution
            assert sample_workflow_node_execution.id in repo._execution_cache

            # Test retrieving from cache
            result = repo.get_by_workflow_execution(sample_workflow_node_execution.workflow_execution_id)
            assert len(result) == 1
            assert result[0].id == sample_workflow_node_execution.id

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_multiple_executions_same_workflow(self, mock_task, sqlite_session_factory, account):
            """Test multiple executions for the same workflow."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            # Create multiple executions for the same workflow
            workflow_execution_id = str(uuid4())
            exec1 = _celery_workflow_node_execution_repository_WorkflowNodeExecution(
                id=str(uuid4()),
                node_execution_id=str(uuid4()),
                workflow_id=str(uuid4()),
                workflow_execution_id=workflow_execution_id,
                index=1,
                node_id="node1",
                node_type=BuiltinNodeTypes.START,
                title="Node 1",
                inputs={"input1": "value1"},
                status=_celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.RUNNING,
                created_at=naive_utc_now(),
            )
            exec2 = _celery_workflow_node_execution_repository_WorkflowNodeExecution(
                id=str(uuid4()),
                node_execution_id=str(uuid4()),
                workflow_id=str(uuid4()),
                workflow_execution_id=workflow_execution_id,
                index=2,
                node_id="node2",
                node_type=BuiltinNodeTypes.LLM,
                title="Node 2",
                inputs={"input2": "value2"},
                status=_celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.RUNNING,
                created_at=naive_utc_now(),
            )

            # Save both executions
            repo.save(exec1)
            repo.save(exec2)

            # Verify both are cached and mapped
            assert len(repo._execution_cache) == 2
            assert len(repo._workflow_execution_mapping[workflow_execution_id]) == 2

            # Test retrieval
            result = repo.get_by_workflow_execution(workflow_execution_id)
            assert len(result) == 2

        @patch("core.repositories.celery_workflow_node_execution_repository.save_workflow_node_execution_task")
        def test_ordering_functionality(self, mock_task, sqlite_session_factory, account):
            """Test ordering functionality works correctly."""
            repo = CeleryWorkflowNodeExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=account.current_tenant_id,
                user=account,
                app_id="test-app",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            # Create executions with different indices
            workflow_execution_id = str(uuid4())
            exec1 = _celery_workflow_node_execution_repository_WorkflowNodeExecution(
                id=str(uuid4()),
                node_execution_id=str(uuid4()),
                workflow_id=str(uuid4()),
                workflow_execution_id=workflow_execution_id,
                index=2,
                node_id="node2",
                node_type=BuiltinNodeTypes.START,
                title="Node 2",
                inputs={},
                status=_celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.RUNNING,
                created_at=naive_utc_now(),
            )
            exec2 = _celery_workflow_node_execution_repository_WorkflowNodeExecution(
                id=str(uuid4()),
                node_execution_id=str(uuid4()),
                workflow_id=str(uuid4()),
                workflow_execution_id=workflow_execution_id,
                index=1,
                node_id="node1",
                node_type=BuiltinNodeTypes.LLM,
                title="Node 1",
                inputs={},
                status=_celery_workflow_node_execution_repository_WorkflowNodeExecutionStatus.RUNNING,
                created_at=naive_utc_now(),
            )

            # Save in random order
            repo.save(exec1)
            repo.save(exec2)

            # Test ascending order
            order_config = OrderConfig(order_by=["index"], order_direction="asc")
            result = repo.get_by_workflow_execution(workflow_execution_id, order_config)
            assert len(result) == 2
            assert result[0].index == 1
            assert result[1].index == 2

            # Test descending order
            order_config = OrderConfig(order_by=["index"], order_direction="desc")
            result = repo.get_by_workflow_execution(workflow_execution_id, order_config)
            assert len(result) == 2
            assert result[0].index == 2
            assert result[1].index == 1


"""Batch cleanup persists exact records without losing ownership or stored data."""


def _execution() -> _workflow_node_execution_batch_WorkflowNodeExecution:
    return _workflow_node_execution_batch_WorkflowNodeExecution(
        id=str(uuid4()),
        node_execution_id=str(uuid4()),
        workflow_id="source-workflow",
        workflow_execution_id="root-run",
        triggered_from_workflow_id="caller-workflow",
        triggered_from_node_execution_id="caller-execution",
        index=1,
        node_id="tool",
        node_type="tool",
        title="Nested tool",
        created_at=datetime(2026, 9, 23),
        process_data={"workflow_agent_binding_id": "binding"},
    )


class TestWorkflowNodeExecutionBatchCases:
    @staticmethod
    @pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
    def test_batch_creates_missing_rows_and_updates_only_supplied_records(
        sqlite_session_factory: sessionmaker[Session],
        sqlite_engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
        backend: str,
    ) -> None:
        expiring_session_factory = sessionmaker(sqlite_engine)
        sql = SQLAlchemyWorkflowNodeExecutionRepository(
            expiring_session_factory,
            "tenant",
            make_account(),
            "source-app",
            WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
        )
        existing, missing, untouched = (_execution() for _ in range(3))
        sql.save(existing)
        sql.save(untouched)
        with sqlite_session_factory.begin() as session:
            session.add(make_upload_file(file_id="offloaded-inputs", tenant_id="tenant"))
            row = session.get(_workflow_node_execution_batch_WorkflowNodeExecutionModel, existing.id)
            assert row is not None
            row.inputs = '{"large": "stored preview"}'
            session.add(
                WorkflowNodeExecutionOffload(
                    tenant_id="tenant",
                    app_id="source-app",
                    node_execution_id=existing.id,
                    type_=ExecutionOffLoadType.INPUTS,
                    file_id="offloaded-inputs",
                )
            )
        existing.inputs = {"large": "full content restored from offload"}
        for execution in (existing, missing):
            execution.status = _workflow_node_execution_batch_WorkflowNodeExecutionStatus.FAILED
            execution.error = "workflow stopped"
            execution.finished_at = datetime(2026, 9, 23, 0, 0, 1)
            execution.process_data = {"partial": "result"}

        queued: list[dict[str, object]] = []
        logstore_records: list[dict[str, str]] = []
        if backend == "celery":
            task = workflow_node_execution_tasks.save_workflow_node_executions_task
            monkeypatch.setattr(task, "delay", lambda **kwargs: queued.append(kwargs))
            repository = CeleryWorkflowNodeExecutionRepository(
                expiring_session_factory,
                "tenant",
                make_account(),
                "source-app",
                WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
            )
        elif backend == "logstore":
            apply_config_overrides(monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=True)
            monkeypatch.setattr(AliyunLogStore, "_instance", None)
            monkeypatch.setattr(AliyunLogStore, "_initialized", False)
            monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "localhost")
            monkeypatch.setattr(AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda *_: None))
            monkeypatch.setattr(
                AliyunLogStore,
                "put_log",
                lambda _self, _name, record: logstore_records.append(dict(record)),
            )
            repository = LogstoreWorkflowNodeExecutionRepository(
                expiring_session_factory,
                "tenant",
                make_account(),
                "source-app",
                WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
            )
        else:
            repository = sql

        commits: list[None] = []
        event.listen(sqlite_engine, "commit", lambda _connection: commits.append(None))
        repository.save_many([existing, missing])
        repository.save_many([])
        if backend == "celery":
            assert len(queued) == 1
            assert commits == []
            content_type, encoding, payload = dumps(queued[0], serializer="json")
            workflow_node_execution_tasks.save_workflow_node_executions_task.run(
                **loads(payload, content_type, encoding, accept={content_type})
            )
        assert len(commits) == 1

        with sqlite_session_factory() as session:
            rows = {
                row.id: row
                for row in session.scalars(
                    _workflow_node_execution_batch_WorkflowNodeExecutionModel.preload_offload_data(
                        select(_workflow_node_execution_batch_WorkflowNodeExecutionModel)
                    )
                )
            }
            assert set(rows) == {existing.id, missing.id, untouched.id}
            assert rows[untouched.id].status == _workflow_node_execution_batch_WorkflowNodeExecutionStatus.RUNNING
            for execution in (existing, missing):
                row = rows[execution.id]
                assert row.status == _workflow_node_execution_batch_WorkflowNodeExecutionStatus.FAILED
                assert row.error == "workflow stopped"
                assert row.finished_at == execution.finished_at
                assert (row.tenant_id, row.app_id, row.triggered_from) == (
                    "tenant",
                    "source-app",
                    WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
                )
                assert (row.workflow_id, row.workflow_run_id) == ("source-workflow", "root-run")
                assert (row.triggered_from_workflow_id, row.triggered_from_node_execution_id) == (
                    "caller-workflow",
                    "caller-execution",
                )
            assert rows[existing.id].process_data_dict == {"partial": "result", "workflow_agent_binding_id": "binding"}
            assert rows[existing.id].inputs_dict == {"large": "stored preview"}
            assert rows[existing.id].offload_data[0].file_id == "offloaded-inputs"
        if backend == "logstore":
            assert {row["id"] for row in logstore_records} == {existing.id, missing.id}
            assert all(row["status"] == "failed" and row["log_version"] for row in logstore_records)
            assert all(row["triggered_from_node_execution_id"] == "caller-execution" for row in logstore_records)

    @staticmethod
    @pytest.mark.parametrize("backend", ["sql", "celery"])
    @pytest.mark.parametrize("owner", ["tenant_id", "app_id", "triggered_from", "workflow_id", "workflow_run_id"])
    def test_owner_mismatch_rolls_back_the_whole_batch(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, backend: str, owner: str
    ) -> None:
        repository = SQLAlchemyWorkflowNodeExecutionRepository(
            sqlite_session_factory,
            "tenant",
            make_account(),
            "source-app",
            WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
        )
        valid, foreign = _execution(), _execution()
        repository.save(valid)
        repository.save(foreign)
        with sqlite_session_factory.begin() as session:
            row = session.get(_workflow_node_execution_batch_WorkflowNodeExecutionModel, foreign.id)
            assert row is not None
            setattr(
                row, owner, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN if owner == "triggered_from" else "other"
            )
        for execution in (valid, foreign):
            execution.status = _workflow_node_execution_batch_WorkflowNodeExecutionStatus.FAILED
        if backend == "celery":
            task = workflow_node_execution_tasks.save_workflow_node_executions_task
            monkeypatch.setattr(task, "retry", lambda **kwargs: kwargs["exc"])
            with pytest.raises(IntegrityError):
                task.run(
                    executions_data=[execution.model_dump() for execution in (valid, foreign)],
                    tenant_id="tenant",
                    app_id="source-app",
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL.value,
                    creator_user_id="account",
                    creator_user_role="account",
                )
        else:
            with pytest.raises(IntegrityError):
                repository.save_many([valid, foreign])
        with sqlite_session_factory() as session:
            assert all(
                row.status == _workflow_node_execution_batch_WorkflowNodeExecutionStatus.RUNNING
                for row in session.scalars(select(_workflow_node_execution_batch_WorkflowNodeExecutionModel))
            )

    @staticmethod
    @pytest.mark.parametrize(
        "status",
        [
            _workflow_node_execution_batch_WorkflowNodeExecutionStatus.FAILED,
            _workflow_node_execution_batch_WorkflowNodeExecutionStatus.PAUSED,
            _workflow_node_execution_batch_WorkflowNodeExecutionStatus.RETRY,
        ],
    )
    def test_delayed_start_cannot_undo_completed_failure_cleanup(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        status: _workflow_node_execution_batch_WorkflowNodeExecutionStatus,
    ) -> None:
        queued: list[dict[str, object]] = []
        start_task = workflow_node_execution_tasks.save_workflow_node_execution_task
        batch_task = workflow_node_execution_tasks.save_workflow_node_executions_task
        monkeypatch.setattr(start_task, "delay", lambda **kwargs: queued.append(kwargs))
        monkeypatch.setattr(batch_task, "delay", lambda **kwargs: queued.append(kwargs))
        repository = CeleryWorkflowNodeExecutionRepository(
            sqlite_session_factory,
            "tenant",
            make_account(),
            "source-app",
            WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
        )
        execution = _execution()
        repository.save(execution)
        execution.status = status
        execution.error = "workflow stopped"
        execution.finished_at = datetime(2026, 9, 23, 0, 0, 1)
        repository.save_many([execution])

        for task, kwargs in zip((batch_task, start_task), reversed(queued), strict=True):
            content_type, encoding, payload = dumps(kwargs, serializer="json")
            task.run(**loads(payload, content_type, encoding, accept={content_type}))

        with sqlite_session_factory() as session:
            row = session.get(_workflow_node_execution_batch_WorkflowNodeExecutionModel, execution.id)
            assert row is not None
            if status == _workflow_node_execution_batch_WorkflowNodeExecutionStatus.FAILED:
                assert (row.status, row.error, row.finished_at) == (status, execution.error, execution.finished_at)
            else:
                assert row.status == _workflow_node_execution_batch_WorkflowNodeExecutionStatus.RUNNING
                assert row.finished_at is None


"""Caller identity survives storage updates independently of node payloads."""


class TestWorkflowNodeExecutionCallersCases:
    @staticmethod
    @pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
    def test_caller_locators_survive_storage_round_trip_and_updates(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, backend: str
    ) -> None:
        apply_config_overrides(monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=False)
        logstore_records: list[dict[str, str]] = []
        sql = SQLAlchemyWorkflowNodeExecutionRepository(
            sqlite_session_factory,
            "tenant",
            make_account(),
            "source-app",
            WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
        )
        execution = _workflow_node_execution_callers_WorkflowNodeExecution(
            id=str(uuid4()),
            node_execution_id="child-execution",
            workflow_id=str(uuid4()),
            workflow_execution_id="root-run",
            triggered_from_workflow_id=str(uuid4()),
            triggered_from_node_execution_id="call/" + "x" * 250,
            index=1,
            node_id="reused-canvas-node",
            node_type="tool",
            title="Nested Tool",
            created_at=datetime(2026, 9, 23),
        )
        repository: WorkflowNodeExecutionRepository
        if backend == "celery":

            def deliver(**kwargs: object) -> None:
                content_type, encoding, payload = dumps(kwargs, serializer="json")
                save_workflow_node_execution_task.run(**loads(payload, content_type, encoding, accept={content_type}))

            monkeypatch.setattr(save_workflow_node_execution_task, "delay", deliver)
            repository = CeleryWorkflowNodeExecutionRepository(
                sqlite_session_factory,
                "tenant",
                make_account(),
                "source-app",
                WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
            )
        elif backend == "logstore":
            monkeypatch.setattr(AliyunLogStore, "_instance", None)
            monkeypatch.setattr(AliyunLogStore, "_initialized", False)
            monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "localhost")
            monkeypatch.setattr(AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda *_: None))
            monkeypatch.setattr(
                AliyunLogStore,
                "put_log",
                lambda _self, _name, record: logstore_records.append(dict(record)),
            )
            repository = LogstoreWorkflowNodeExecutionRepository(
                sqlite_session_factory,
                "tenant",
                make_account(),
                "source-app",
                WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
            )
        else:
            repository = sql

        repository.save(execution)
        execution.status = _workflow_node_execution_callers_WorkflowNodeExecutionStatus.SUCCEEDED
        execution.process_data = {"result": "no caller identifiers in this payload"}
        execution.finished_at = datetime(2026, 9, 23, 0, 0, 1)
        repository.save(execution)
        repository.save_execution_data(execution)

        if backend == "logstore":
            row = logstore_records[-1]
            monkeypatch.setattr(AliyunLogStore, "execute_sql", lambda *_args, **_kwargs: [row])
            restored = repository.get_by_workflow_execution("root-run")[0]
            apply_config_overrides(
                monkeypatch,
                API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
                    "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository."
                    "LogstoreAPIWorkflowNodeExecutionRepository"
                ),
            )
            api_repository = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
                sqlite_session_factory
            )
            model = api_repository.get_execution_by_id(execution.id, "tenant")
        else:
            restored = sql.get_by_workflow_execution("root-run")[0]
            with sqlite_session_factory() as session:
                model = session.get(_workflow_node_execution_callers_WorkflowNodeExecutionModel, execution.id)

        assert model is not None
        assert isinstance(restored, _workflow_node_execution_callers_WorkflowNodeExecution)
        for record in (restored, model):
            assert record.triggered_from_workflow_id == execution.triggered_from_workflow_id
            assert record.triggered_from_node_execution_id == execution.triggered_from_node_execution_id
            assert record.workflow_id == execution.workflow_id
        assert model.app_id == "source-app"
        assert model.workflow_run_id == "root-run"
        assert restored.process_data == execution.process_data

    @staticmethod
    def test_sql_offload_preserves_caller_locators(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        apply_config_overrides(
            monkeypatch, WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=32, WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=8
        )
        repository = SQLAlchemyWorkflowNodeExecutionRepository(
            sqlite_session_factory,
            "tenant",
            make_account(),
            "source-app",
            WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
        )
        stored_content: dict[str, bytes] = {}

        def upload_file(*, content: bytes, **_kwargs: object) -> UploadFile:
            file = make_upload_file(file_id=str(uuid4()), key="process-data", tenant_id="tenant")
            with sqlite_session_factory.begin() as session:
                session.add(file)
            stored_content[file.key] = content
            return file

        monkeypatch.setattr(repository._file_service, "upload_file", upload_file)
        monkeypatch.setattr(
            "core.repositories.sqlalchemy_workflow_node_execution_repository.storage.load", stored_content.__getitem__
        )
        execution = _workflow_node_execution_callers_WorkflowNodeExecution(
            id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_execution_id="root-run",
            triggered_from_workflow_id=str(uuid4()),
            triggered_from_node_execution_id="immediate-tool-execution",
            index=1,
            node_id="node",
            node_type="code",
            title="Code",
            created_at=datetime(2026, 9, 23),
            process_data={"large": "x" * 1000},
        )
        repository.save(execution)
        repository.save_execution_data(execution)

        restored = repository.get_by_workflow_execution("root-run")[0]
        assert isinstance(restored, _workflow_node_execution_callers_WorkflowNodeExecution)
        assert restored.process_data_truncated
        assert restored.process_data == execution.process_data
        assert restored.triggered_from_workflow_id == execution.triggered_from_workflow_id
        assert restored.triggered_from_node_execution_id == "immediate-tool-execution"
