"""Independent Celery readers and writers share pending state over persisted history."""

from collections.abc import Sequence
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_node_execution_query_repository import (
    CeleryWorkflowNodeExecutionCache,
    CeleryWorkflowNodeExecutionQueryRepository,
)
from core.repositories.celery_workflow_node_execution_write_repository import CeleryWorkflowNodeExecutionWriteRepository
from core.repositories.factory import OrderConfig
from core.repositories.sqlalchemy_workflow_node_execution_query_repository import (
    SQLAlchemyWorkflowNodeExecutionQueryRepository,
)
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models import Account, CreatorUserRole, EndUser, Tenant
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.file_upload_service import FileUploadService

RESOURCE_TENANT_ID = "resource-tenant-id"


class PersistedQuery:
    def __init__(self, executions: Sequence[WorkflowNodeExecution] = (), *, failures: int = 0) -> None:
        self.executions = executions
        self.failures = failures
        self.calls: list[tuple[str, OrderConfig | None]] = []

    def get_by_workflow_execution(
        self, workflow_execution_id: str, order_config: OrderConfig | None = None
    ) -> Sequence[WorkflowNodeExecution]:
        self.calls.append((workflow_execution_id, order_config))
        if self.failures:
            self.failures -= 1
            raise OSError("SQL unavailable")
        return [execution for execution in self.executions if execution.workflow_execution_id == workflow_execution_id]


def _execution(*, run_id: str = "run-1", index: int = 1, title: str = "Test Node") -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id=str(uuid4()),
        node_execution_id=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_execution_id=run_id,
        index=index,
        node_id="test_node",
        node_type=BuiltinNodeTypes.START,
        title=title,
        inputs={"input1": "value1"},
        status=WorkflowNodeExecutionStatus.RUNNING,
        created_at=naive_utc_now(),
    )


@pytest.fixture
def account() -> Account:
    user = Account(name="Test Account", email="test@example.com")
    user._current_tenant = Tenant(name="Creator tenant")
    return user


@pytest.fixture
def cache() -> CeleryWorkflowNodeExecutionCache:
    return CeleryWorkflowNodeExecutionCache()


@pytest.fixture
def writer(
    sqlite_session_factory: sessionmaker[Session],
    account: Account,
    file_uploads: FileUploadService,
    cache: CeleryWorkflowNodeExecutionCache,
) -> CeleryWorkflowNodeExecutionWriteRepository:
    return CeleryWorkflowNodeExecutionWriteRepository(
        session_factory=sqlite_session_factory,
        tenant_id=RESOURCE_TENANT_ID,
        user=account,
        app_id="test-app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        file_uploads=file_uploads,
        cache=cache,
    )


def test_writer_retains_explicit_dependencies(
    writer: CeleryWorkflowNodeExecutionWriteRepository,
    account: Account,
    file_uploads: FileUploadService,
    cache: CeleryWorkflowNodeExecutionCache,
) -> None:
    assert writer._sql_repository._file_uploads is file_uploads
    assert writer._cache is cache
    assert writer._tenant_id == RESOURCE_TENANT_ID
    assert writer._app_id == "test-app"
    assert writer._triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    assert writer._creator_user_id == account.id
    assert writer._creator_user_role == CreatorUserRole.ACCOUNT
    assert cache.executions == {}
    assert cache.workflow_execution_mapping == {}
    assert cache.database_loaded_workflow_executions == set()


def test_writer_accepts_engine_and_end_user(
    sqlite_engine: Engine, file_uploads: FileUploadService, cache: CeleryWorkflowNodeExecutionCache
) -> None:
    user = EndUser(id=str(uuid4()), tenant_id="creator-tenant")
    writer = CeleryWorkflowNodeExecutionWriteRepository(
        session_factory=sqlite_engine,
        tenant_id=RESOURCE_TENANT_ID,
        user=user,
        app_id="test-app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        file_uploads=file_uploads,
        cache=cache,
    )
    assert isinstance(writer._session_factory, sessionmaker)
    assert writer._creator_user_role == CreatorUserRole.END_USER
    assert writer._creator_user_id == user.id
    assert writer._tenant_id == RESOURCE_TENANT_ID


def test_writer_requires_resource_tenant_without_reading_account_tenant(
    sqlite_session_factory: sessionmaker[Session], account: Account, file_uploads: FileUploadService
) -> None:
    account._current_tenant = None
    with pytest.raises(ValueError, match="tenant_id is required"):
        CeleryWorkflowNodeExecutionWriteRepository(
            session_factory=sqlite_session_factory,
            tenant_id="",
            user=account,
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            file_uploads=file_uploads,
            cache=CeleryWorkflowNodeExecutionCache(),
        )
    writer = CeleryWorkflowNodeExecutionWriteRepository(
        session_factory=sqlite_session_factory,
        tenant_id=RESOURCE_TENANT_ID,
        user=account,
        app_id="test-app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        file_uploads=file_uploads,
        cache=CeleryWorkflowNodeExecutionCache(),
    )
    assert writer._creator_user_id == account.id
    assert writer._tenant_id == RESOURCE_TENANT_ID


def test_save_caches_execution_and_queues_correct_creator_and_owner(
    writer: CeleryWorkflowNodeExecutionWriteRepository, account: Account, cache: CeleryWorkflowNodeExecutionCache
) -> None:
    execution = _execution()
    with patch(
        "core.repositories.celery_workflow_node_execution_write_repository.save_workflow_node_execution_task"
    ) as task:
        writer.save(execution)
    task.delay.assert_called_once_with(
        execution_data=execution.model_dump(),
        tenant_id=RESOURCE_TENANT_ID,
        app_id="test-app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        creator_user_id=account.id,
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )
    assert cache.executions[execution.id] is execution
    assert cache.workflow_execution_mapping["run-1"] == [execution.id]


def test_repeated_save_updates_shared_cache_without_duplicate_run_entries(
    writer: CeleryWorkflowNodeExecutionWriteRepository, cache: CeleryWorkflowNodeExecutionCache
) -> None:
    execution = _execution()
    other = _execution(index=2)
    updated = execution.model_copy(update={"status": WorkflowNodeExecutionStatus.SUCCEEDED})
    with patch("core.repositories.celery_workflow_node_execution_write_repository.save_workflow_node_execution_task"):
        writer.save(execution)
        writer.save(other)
        writer.save(updated)
    query = CeleryWorkflowNodeExecutionQueryRepository(query=PersistedQuery(), cache=cache)
    assert query.get_by_workflow_execution("run-1") == [updated, other]
    assert cache.executions[execution.id] is updated
    assert cache.workflow_execution_mapping["run-1"] == [execution.id, other.id]


def test_queue_failure_propagates_while_pending_execution_remains_readable(
    writer: CeleryWorkflowNodeExecutionWriteRepository, cache: CeleryWorkflowNodeExecutionCache
) -> None:
    execution = _execution()
    with patch(
        "core.repositories.celery_workflow_node_execution_write_repository.save_workflow_node_execution_task"
    ) as task:
        task.delay.side_effect = OSError("Celery is down")
        with pytest.raises(OSError, match="Celery is down"):
            writer.save(execution)
    query = CeleryWorkflowNodeExecutionQueryRepository(query=PersistedQuery(), cache=cache)
    assert query.get_by_workflow_execution("run-1") == [execution]


def test_synchronous_save_persists_then_publishes_to_shared_cache_without_queueing(
    writer: CeleryWorkflowNodeExecutionWriteRepository,
    sqlite_session_factory: sessionmaker[Session],
    cache: CeleryWorkflowNodeExecutionCache,
) -> None:
    execution = _execution()
    with patch(
        "core.repositories.celery_workflow_node_execution_write_repository.save_workflow_node_execution_task"
    ) as task:
        writer.save_synchronously(execution)
        writer.save_synchronously(execution)
    task.delay.assert_not_called()
    with sqlite_session_factory() as session:
        stored = session.get(WorkflowNodeExecutionModel, execution.id)
        assert stored is not None
        assert stored.tenant_id == RESOURCE_TENANT_ID
        assert stored.app_id == "test-app"
    persisted = SQLAlchemyWorkflowNodeExecutionQueryRepository(sqlite_session_factory, RESOURCE_TENANT_ID, "test-app")
    query = CeleryWorkflowNodeExecutionQueryRepository(query=persisted, cache=cache)
    assert query.get_by_workflow_execution("run-1")[0] is execution
    assert cache.workflow_execution_mapping["run-1"] == [execution.id]


def test_synchronous_save_failure_does_not_publish_unpersisted_execution(
    writer: CeleryWorkflowNodeExecutionWriteRepository, cache: CeleryWorkflowNodeExecutionCache
) -> None:
    execution = _execution()
    with patch.object(writer._sql_repository, "save_synchronously", side_effect=OSError("database unavailable")):
        with pytest.raises(OSError, match="database unavailable"):
            writer.save_synchronously(execution)
    assert cache.executions == {}
    assert cache.workflow_execution_mapping == {}


def test_query_backfills_persisted_history_once_per_run(cache: CeleryWorkflowNodeExecutionCache) -> None:
    first = _execution()
    second_run = _execution(run_id="run-2")
    persisted = PersistedQuery([first, second_run])
    query = CeleryWorkflowNodeExecutionQueryRepository(query=persisted, cache=cache)
    order = OrderConfig(order_by=["index"], order_direction="asc")
    assert query.get_by_workflow_execution("run-1", order) == [first]
    assert query.get_by_workflow_execution("run-1") == [first]
    assert query.get_by_workflow_execution("run-2") == [second_run]
    assert persisted.calls == [("run-1", order), ("run-2", None)]
    assert cache.database_loaded_workflow_executions == {"run-1", "run-2"}
    assert cache.executions[first.id] is first
    assert cache.workflow_execution_mapping == {"run-1": [first.id], "run-2": [second_run.id]}


def test_query_keeps_pending_version_when_persisted_history_contains_same_id(
    writer: CeleryWorkflowNodeExecutionWriteRepository, cache: CeleryWorkflowNodeExecutionCache
) -> None:
    pending = _execution(index=2)
    stored_old_version = pending.model_copy(deep=True)
    historical = _execution(index=1)
    pending.status = WorkflowNodeExecutionStatus.SUCCEEDED
    with patch("core.repositories.celery_workflow_node_execution_write_repository.save_workflow_node_execution_task"):
        writer.save(pending)
    query = CeleryWorkflowNodeExecutionQueryRepository(
        query=PersistedQuery([stored_old_version, historical]), cache=cache
    )
    result = query.get_by_workflow_execution("run-1", OrderConfig(order_by=["index"], order_direction="asc"))
    assert result == [historical, pending]
    assert result[1] is pending
    assert result[1].status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert cache.workflow_execution_mapping["run-1"] == [pending.id, historical.id]


def test_failed_backfill_returns_pending_then_retries_database(
    writer: CeleryWorkflowNodeExecutionWriteRepository,
    cache: CeleryWorkflowNodeExecutionCache,
    caplog: pytest.LogCaptureFixture,
) -> None:
    pending = _execution(index=2)
    historical = _execution(index=1)
    persisted = PersistedQuery([historical], failures=1)
    query = CeleryWorkflowNodeExecutionQueryRepository(query=persisted, cache=cache)
    with patch("core.repositories.celery_workflow_node_execution_write_repository.save_workflow_node_execution_task"):
        writer.save(pending)
    assert query.get_by_workflow_execution("run-1") == [pending]
    assert "run-1" not in cache.database_loaded_workflow_executions
    assert "Failed to load persisted workflow node executions for execution run-1" in caplog.text
    assert query.get_by_workflow_execution("run-1") == [pending, historical]
    assert query.get_by_workflow_execution("run-1") == [pending, historical]
    assert persisted.calls == [("run-1", None), ("run-1", None)]
    assert cache.database_loaded_workflow_executions == {"run-1"}


def test_empty_persisted_history_is_loaded_only_once(cache: CeleryWorkflowNodeExecutionCache) -> None:
    persisted = PersistedQuery()
    query = CeleryWorkflowNodeExecutionQueryRepository(query=persisted, cache=cache)
    assert query.get_by_workflow_execution("missing-run") == []
    assert query.get_by_workflow_execution("missing-run") == []
    assert persisted.calls == [("missing-run", None)]


def test_reader_observes_writes_after_initial_backfill(
    writer: CeleryWorkflowNodeExecutionWriteRepository, cache: CeleryWorkflowNodeExecutionCache
) -> None:
    persisted = PersistedQuery()
    query = CeleryWorkflowNodeExecutionQueryRepository(query=persisted, cache=cache)
    assert query.get_by_workflow_execution("run-1") == []
    pending = _execution()
    with patch("core.repositories.celery_workflow_node_execution_write_repository.save_workflow_node_execution_task"):
        writer.save(pending)
    assert query.get_by_workflow_execution("run-1") == [pending]
    assert persisted.calls == [("run-1", None)]


@pytest.mark.parametrize("direction", ["asc", "desc"])
def test_query_orders_multiple_fields_and_ignores_unknown_fields(
    cache: CeleryWorkflowNodeExecutionCache, direction: str
) -> None:
    first = _execution(index=1, title="A")
    second = _execution(index=1, title="B")
    third = _execution(index=2, title="A")
    query = CeleryWorkflowNodeExecutionQueryRepository(query=PersistedQuery([third, second, first]), cache=cache)
    order = OrderConfig(
        order_by=["unknown", "index", "title"], order_direction="desc" if direction == "desc" else "asc"
    )
    expected = [first, second, third]
    if direction == "desc":
        expected.reverse()
    assert query.get_by_workflow_execution("run-1", order) == expected
