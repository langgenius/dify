"""Configured history backends retain synchronous, monotonic task control."""

from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
)
from extensions.logstore.repositories.logstore_api_workflow_run_repository import LogstoreAPIWorkflowRunRepository
from extensions.logstore.repositories.logstore_workflow_execution_repository import LogstoreWorkflowExecutionRepository
from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from graphon.entities import WorkflowExecution, WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models import Account, WorkflowRun
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from tasks.workflow_execution_tasks import _update_workflow_run_from_execution


@pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
def test_task_owner_is_durable_before_start_and_delayed_writes_cannot_revive_stop(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, backend: str
) -> None:
    logstore = Mock()
    # Keep the static logstore name available to the writer.
    monkeypatch.setattr(
        "extensions.logstore.repositories.logstore_workflow_execution_repository.AliyunLogStore",
        Mock(return_value=logstore, workflow_execution_logstore="executions"),
    )
    monkeypatch.setattr(
        "extensions.logstore.repositories.logstore_api_workflow_run_repository.AliyunLogStore",
        Mock(return_value=logstore),
    )
    queued_save = Mock()
    monkeypatch.setattr(
        "core.repositories.celery_workflow_execution_repository.save_workflow_execution_task.delay", queued_save
    )
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
    execution = WorkflowExecution.new(
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
        logstore.get_logs.assert_not_called()


def test_logstore_pause_lifecycle_uses_sql_control_with_dual_write_disabled(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("extensions.logstore.repositories.logstore_api_workflow_run_repository.AliyunLogStore", Mock())
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", Mock())
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.delete", Mock())
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
        WorkflowExecution.new(
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
    before_resume = Mock()
    resumed = api.resume_workflow_pause("run-1", pause, before_resume=before_resume)
    before_resume.assert_called_once_with()
    api.delete_workflow_pause(resumed)
    assert api.get_workflow_pause("run-1") is None


@pytest.mark.parametrize("record_type", ["workflow", "node"])
def test_logstore_stop_orders_before_delayed_upload_and_overrides_stale_indexes(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, record_type: str
) -> None:
    logstore = Mock()
    for module in (
        "logstore_workflow_execution_repository",
        "logstore_workflow_node_execution_repository",
        "logstore_api_workflow_node_execution_repository",
    ):
        monkeypatch.setattr(
            f"extensions.logstore.repositories.{module}.AliyunLogStore",
            Mock(return_value=logstore, workflow_execution_logstore="runs", workflow_node_execution_logstore="nodes"),
        )
    user = Account(name="Test", email="test@example.com")
    user.id = "account-1"
    run = WorkflowExecution.new(
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
        status=WorkflowNodeExecutionStatus.PAUSED,
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

    logstore.put_log.side_effect = append_after_concurrent_stop
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
        run_writer.save(run)  # Another late RUNNING/PAUSED write also remains terminal.
    else:
        node_writer.save(node)
        expected_status = "failed"
        assert max(records, key=lambda row: int(row["log_version"]))["status"] == expected_status
        stale_paused = next(row for row in records if row["status"] == "paused")
        logstore.execute_sql.return_value = [stale_paused]
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
