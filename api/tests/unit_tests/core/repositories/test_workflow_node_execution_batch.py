"""Batch cleanup persists exact records without losing ownership or stored data."""

from datetime import datetime
from unittest.mock import Mock
from uuid import uuid4

import pytest
from kombu.serialization import dumps, loads
from sqlalchemy import Engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_node_execution_repository import CeleryWorkflowNodeExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.node_execution import WorkflowNodeExecution
from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from graphon.enums import WorkflowNodeExecutionStatus
from models.enums import ExecutionOffLoadType
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom
from tasks import workflow_node_execution_tasks
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_upload_file


def _execution() -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
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


@pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
def test_batch_creates_missing_rows_and_updates_only_supplied_records(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch, backend: str
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
        row = session.get(WorkflowNodeExecutionModel, existing.id)
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
        execution.status = WorkflowNodeExecutionStatus.FAILED
        execution.error = "workflow stopped"
        execution.finished_at = datetime(2026, 9, 23, 0, 0, 1)
        execution.process_data = {"partial": "result"}

    queued: list[dict[str, object]] = []
    client = Mock()
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
        monkeypatch.setattr(
            "extensions.logstore.repositories.logstore_workflow_node_execution_repository.AliyunLogStore",
            Mock(return_value=client, workflow_node_execution_logstore="workflow_node_execution"),
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
                WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel))
            )
        }
        assert set(rows) == {existing.id, missing.id, untouched.id}
        assert rows[untouched.id].status == WorkflowNodeExecutionStatus.RUNNING
        for execution in (existing, missing):
            row = rows[execution.id]
            assert row.status == WorkflowNodeExecutionStatus.FAILED
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
        records = [dict(call.args[1]) for call in client.put_log.call_args_list]
        assert {row["id"] for row in records} == {existing.id, missing.id}
        assert all(row["status"] == "failed" and row["log_version"] for row in records)
        assert all(row["triggered_from_node_execution_id"] == "caller-execution" for row in records)


@pytest.mark.parametrize("backend", ["sql", "celery"])
@pytest.mark.parametrize("owner", ["tenant_id", "app_id", "triggered_from", "workflow_id", "workflow_run_id"])
def test_owner_mismatch_rolls_back_the_whole_batch(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, backend: str, owner: str
) -> None:
    repository = SQLAlchemyWorkflowNodeExecutionRepository(
        sqlite_session_factory, "tenant", make_account(), "source-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    )
    valid, foreign = _execution(), _execution()
    repository.save(valid)
    repository.save(foreign)
    with sqlite_session_factory.begin() as session:
        row = session.get(WorkflowNodeExecutionModel, foreign.id)
        assert row is not None
        setattr(row, owner, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN if owner == "triggered_from" else "other")
    for execution in (valid, foreign):
        execution.status = WorkflowNodeExecutionStatus.FAILED
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
            row.status == WorkflowNodeExecutionStatus.RUNNING
            for row in session.scalars(select(WorkflowNodeExecutionModel))
        )


@pytest.mark.parametrize(
    "status",
    [WorkflowNodeExecutionStatus.FAILED, WorkflowNodeExecutionStatus.PAUSED, WorkflowNodeExecutionStatus.RETRY],
)
def test_delayed_start_cannot_undo_completed_failure_cleanup(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, status: WorkflowNodeExecutionStatus
) -> None:
    queued: list[dict[str, object]] = []
    start_task = workflow_node_execution_tasks.save_workflow_node_execution_task
    batch_task = workflow_node_execution_tasks.save_workflow_node_executions_task
    monkeypatch.setattr(start_task, "delay", lambda **kwargs: queued.append(kwargs))
    monkeypatch.setattr(batch_task, "delay", lambda **kwargs: queued.append(kwargs))
    repository = CeleryWorkflowNodeExecutionRepository(
        sqlite_session_factory, "tenant", make_account(), "source-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
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
        row = session.get(WorkflowNodeExecutionModel, execution.id)
        assert row is not None
        if status == WorkflowNodeExecutionStatus.FAILED:
            assert (row.status, row.error, row.finished_at) == (status, execution.error, execution.finished_at)
        else:
            assert row.status == WorkflowNodeExecutionStatus.RUNNING
            assert row.finished_at is None
