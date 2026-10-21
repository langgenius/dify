"""Configured history backends retain synchronous, monotonic task control."""

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
)
from extensions.logstore.repositories.logstore_api_workflow_run_repository import LogstoreAPIWorkflowRunRepository
from extensions.logstore.repositories.logstore_workflow_execution_repository import LogstoreWorkflowExecutionRepository
from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models import Account, WorkflowRun
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from repositories.entities.workflow_execution import WorkflowExecution
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from repositories.workflow_run_control import apply_workflow_stop_to_node
from tasks.workflow_execution_tasks import _update_workflow_run_from_execution


@pytest.fixture
def logstore(monkeypatch: pytest.MonkeyPatch, mocker: MockerFixture) -> AliyunLogStore:
    monkeypatch.setattr(AliyunLogStore, "_instance", None)
    monkeypatch.setattr(AliyunLogStore, "_initialized", False)
    monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "https://example.com")
    mocker.patch.object(AliyunLogStore, "_check_endpoint_connectivity")
    store = AliyunLogStore()
    store._use_pg_protocol = True
    mocker.patch.object(store, "put_log")
    return store


@pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
def test_task_owner_is_durable_before_start_and_delayed_writes_cannot_revive_stop(
    sqlite_session_factory: sessionmaker[Session], logstore: AliyunLogStore, mocker: MockerFixture, backend: str
) -> None:
    queued_save = mocker.patch(
        "core.repositories.celery_workflow_execution_repository.save_workflow_execution_task.delay"
    )
    get_logs = mocker.patch.object(logstore, "get_logs")
    repository_class = {
        "sql": SQLAlchemyWorkflowExecutionRepository,
        "celery": CeleryWorkflowExecutionRepository,
        "logstore": LogstoreWorkflowExecutionRepository,
    }[backend]
    user = Account(name="Test", email="test@example.com")
    user.id = "account-1"
    repository = repository_class(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        user=user,
        app_id="app-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    if isinstance(repository, LogstoreWorkflowExecutionRepository):
        repository._enable_dual_write = False
    execution = WorkflowExecution(
        id_="run-1",
        workflow_id="workflow-1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1",
        graph={"nodes": [], "edges": []},
        inputs={},
        started_at=naive_utc_now(),
    )
    repository.save_synchronously(execution)
    queued_save.assert_not_called()
    control = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    control.bind_workflow_task(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1", task_id="task-1")
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, "run-1")
        assert run is not None
        assert run.task_id == "task-1"
        assert (run.created_by_role, run.created_by) == (CreatorUserRole.ACCOUNT, "account-1")
    execution.status = WorkflowExecutionStatus.PAUSED
    repository.save_synchronously(execution)
    stopped = control.stop_paused_workflow_task(tenant_id="tenant-1", app_id="app-1", task_id="task-1", owner=None)
    assert stopped is not None
    assert stopped.status == WorkflowExecutionStatus.STOPPED

    # A writer already queued or running before the stop cannot restore RUNNING.
    execution.status = WorkflowExecutionStatus.RUNNING
    repository.save_synchronously(execution)
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, "run-1")
        assert run is not None
        _update_workflow_run_from_execution(run, execution)
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, "run-1")
        assert run is not None
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert run.stop_requested_at is not None
    if backend == "logstore":
        # LogStore implements the configured run-control subset of the history protocol.
        api = LogstoreAPIWorkflowRunRepository(sqlite_session_factory)  # pyrefly: ignore[bad-instantiation]
        api._enable_dual_read = False
        found = api.get_workflow_run_by_id("tenant-1", "app-1", "run-1")
        assert found is not None
        assert found.status == WorkflowExecutionStatus.STOPPED
        unscoped = api.get_workflow_run_by_id_without_tenant("run-1")
        assert unscoped is not None
        assert unscoped.status == WorkflowExecutionStatus.STOPPED
        get_logs.assert_not_called()


@pytest.mark.usefixtures("logstore")
def test_logstore_pause_lifecycle_uses_sql_control_with_dual_write_disabled(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    mocker.patch("repositories.sqlalchemy_api_workflow_run_repository.storage.save")
    mocker.patch("repositories.sqlalchemy_api_workflow_run_repository.storage.delete")
    user = Account(name="Test", email="test@example.com")
    user.id = "account-1"
    sql = SQLAlchemyWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        user=user,
        app_id="app-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    sql.save_synchronously(
        WorkflowExecution(
            id_="run-1",
            workflow_id="workflow-1",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_version="1",
            graph={},
            inputs={},
            started_at=naive_utc_now(),
        )
    )
    api = LogstoreAPIWorkflowRunRepository(sqlite_session_factory)  # pyrefly: ignore[bad-instantiation]
    api.bind_workflow_task(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1", task_id="task-1")
    pause = api.create_workflow_pause("run-1", "account-1", "{}", [])
    persisted_pause = api.get_workflow_pause("run-1")
    assert persisted_pause is not None
    assert persisted_pause.id == pause.id
    resume_callbacks: list[None] = []
    resumed = api.resume_workflow_pause("run-1", pause, before_resume=lambda: resume_callbacks.append(None))
    assert resume_callbacks == [None]
    api.delete_workflow_pause(resumed)
    assert api.get_workflow_pause("run-1") is None


@pytest.mark.parametrize(
    ("record_type", "node_status"),
    [
        ("workflow", WorkflowNodeExecutionStatus.PAUSED),
        ("node", WorkflowNodeExecutionStatus.PAUSED),
        ("node", WorkflowNodeExecutionStatus.RETRY),
    ],
)
def test_logstore_stop_orders_before_delayed_upload_and_overrides_stale_indexes(
    sqlite_session_factory: sessionmaker[Session],
    logstore: AliyunLogStore,
    mocker: MockerFixture,
    record_type: str,
    node_status: WorkflowNodeExecutionStatus,
) -> None:
    user = Account(name="Test", email="test@example.com")
    user.id = "account-1"
    run = WorkflowExecution(
        accumulated_elapsed_time=3.5,
        id_="run-1",
        workflow_id="workflow-1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1",
        graph={},
        inputs={},
        started_at=naive_utc_now(),
    )
    run.status = WorkflowExecutionStatus.PAUSED
    SQLAlchemyWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        user=user,
        app_id="app-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    ).save(run)
    control = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    control.bind_workflow_task(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1", task_id="task-1")
    node = WorkflowNodeExecution(
        id="node-1",
        node_execution_id="node-1",
        workflow_id="workflow-1",
        workflow_execution_id="run-1",
        index=1,
        node_id="review",
        node_type="human-input",
        title="Review",
        created_at=run.started_at,
        status=node_status,
    )
    SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        user=user,
        app_id="app-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    ).save_synchronously(node)
    records: list[dict[str, str]] = []
    interrupted = False

    def append_after_concurrent_stop(_store: str, fields: list[tuple[str, str]]) -> None:
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            stopped = control.stop_paused_workflow_task(
                tenant_id="tenant-1", app_id="app-1", task_id="task-1", owner=None
            )
            assert stopped is not None
            if record_type == "workflow":
                run_writer.save(
                    run.model_copy(
                        update={
                            "status": WorkflowExecutionStatus.STOPPED,
                            "finished_at": stopped.finished_at,
                            "error_message": stopped.error,
                        }
                    )
                )
            else:
                node_writer.save_many(
                    [
                        node.model_copy(
                            update={
                                "status": WorkflowNodeExecutionStatus.FAILED,
                                "finished_at": stopped.finished_at,
                                "error": stopped.error,
                            }
                        )
                    ]
                )
        records.append(dict(fields))

    mocker.patch.object(logstore, "put_log", side_effect=append_after_concurrent_stop)
    run_writer = LogstoreWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        user=user,
        app_id="app-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    node_writer = LogstoreWorkflowNodeExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        user=user,
        app_id="app-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    run_writer._enable_dual_write = node_writer._enable_dual_write = False
    if record_type == "workflow":
        run_writer.save(run)
        expected_status = "stopped"
        assert max(records, key=lambda row: int(row["log_version"]))["status"] == expected_status
        run.accumulated_elapsed_time = 999.0
        run_writer.save(run)  # Another late RUNNING/PAUSED write also remains terminal.
        assert float(records[-1]["elapsed_time"]) == 3.5
    else:
        node_writer.save(node)
        expected_status = "failed"
        assert max(records, key=lambda row: int(row["log_version"]))["status"] == expected_status
        stale_node = next(row for row in records if row["status"] == node_status)
        mocker.patch.object(logstore, "execute_sql", return_value=[stale_node])
        api = LogstoreAPIWorkflowNodeExecutionRepository(sqlite_session_factory)  # pyrefly: ignore[bad-instantiation]
        assert api.get_executions_by_workflow_run("tenant-1", "app-1", "run-1")[0].status == expected_status
        by_id = api.get_execution_by_id("node-1", "tenant-1")
        assert by_id is not None
        assert by_id.status == expected_status
        assert (
            api.get_execution_snapshots_by_workflow_run("tenant-1", "app-1", "workflow-1", "workflow-run", "run-1")[
                0
            ].status
            == expected_status
        )
        assert node_writer.get_by_workflow_execution("run-1")[0].status == expected_status
        node_writer.save(node)
    assert records[-1]["status"] == expected_status


@pytest.mark.parametrize(
    "status",
    [
        WorkflowNodeExecutionStatus.SUCCEEDED,
        WorkflowNodeExecutionStatus.FAILED,
        WorkflowNodeExecutionStatus.EXCEPTION,
        WorkflowNodeExecutionStatus.STOPPED,
    ],
)
def test_stop_preserves_completed_node_history(status: WorkflowNodeExecutionStatus) -> None:
    finished_at = naive_utc_now()
    stopped = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.STOPPED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        error="User requested stop",
        finished_at=finished_at,
        stop_requested_at=finished_at,
    )
    node = WorkflowNodeExecution(
        id="node-1",
        workflow_id="workflow-1",
        workflow_execution_id="run-1",
        index=1,
        node_id="answer",
        node_type="llm",
        title="Answer",
        status=status,
        outputs={"answer": "preserved"},
        error=None if status == WorkflowNodeExecutionStatus.SUCCEEDED else "Original terminal error",
        elapsed_time=2.5,
        created_at=finished_at,
        finished_at=finished_at,
    )
    original = node.model_dump()

    apply_workflow_stop_to_node(node, stopped)

    assert node.model_dump() == original
