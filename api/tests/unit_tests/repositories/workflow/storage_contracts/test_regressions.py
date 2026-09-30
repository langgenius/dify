"""Backend behavior that permissive repository substitutes previously hid."""

import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Mapper, Session, sessionmaker

from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from extensions.ext_storage import storage as state_storage
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.dataset import Pipeline
from models.workflow import WorkflowDraftVariable, WorkflowNodeExecutionModel, WorkflowPause, WorkflowRun
from repositories.workflow.logstore.schema import WORKFLOW_NODE_EXECUTION_LOGSTORE
from services.rag_pipeline import rag_pipeline as pipeline_module
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account
from tests.unit_tests.repositories.workflow.storage_contracts.entities import START, node, run
from tests.unit_tests.repositories.workflow.storage_contracts.harness import StorageContract


def _apply_mysql_datetime_precision(sessions: sessionmaker[Session], *, round_fraction: bool) -> None:
    """Emulate documented DATETIME(0) rounding and TIME_TRUNCATE_FRACTIONAL."""
    with sessions.begin() as session:
        stored = session.get(WorkflowNodeExecutionModel, "execution-1")
        assert stored is not None
        started_at = stored.created_at
        if round_fraction and started_at.microsecond >= 500_000:
            started_at += timedelta(seconds=1)
        stored.created_at = started_at.replace(microsecond=0)


@pytest.mark.parametrize("microsecond", [100_000, 700_000])
@pytest.mark.parametrize("round_fraction", [True, False], ids=["round", "truncate"])
@pytest.mark.parametrize("synchronous", [True, False], ids=["synchronous-row", "queued-row"])
@pytest.mark.parametrize("legacy", [False, True], ids=["versioned", "legacy-row"])
@pytest.mark.parametrize("status", [WorkflowNodeExecutionStatus.FAILED, WorkflowNodeExecutionStatus.PAUSED])
def test_celery_attempt_survives_database_datetime_precision(
    transports: StorageContract,
    monkeypatch: pytest.MonkeyPatch,
    microsecond: int,
    round_fraction: bool,
    synchronous: bool,
    legacy: bool,
    status: WorkflowNodeExecutionStatus,
) -> None:
    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery")
    writer = transports.node_writer()
    started = node().model_copy(
        update={"created_at": START.replace(microsecond=microsecond), "status": WorkflowNodeExecutionStatus.RUNNING}
    )
    if synchronous:
        writer.save_synchronously(started)
    else:
        writer.save(started)
        transports.settle()
    _apply_mysql_datetime_precision(transports.sessions, round_fraction=round_fraction)
    if legacy:
        with transports.sessions.begin() as session:
            stored = session.get(WorkflowNodeExecutionModel, started.id)
            assert stored is not None
            stored.execution_metadata = json.dumps(stored.execution_metadata_dict)
    finished = started.model_copy(update={"status": status, "outputs": {"answer": "latest"}})
    writer.save(finished)
    transports.settle()
    _apply_mysql_datetime_precision(transports.sessions, round_fraction=round_fraction)
    writer.save(started)  # Delayed RUNNING must not replace PAUSED, even after rounding down.
    transports.settle()

    actual = transports.nodes().get_execution_by_id(started.id, "tenant-1")
    assert actual is not None
    assert actual.status == status
    assert actual.outputs_dict == finished.outputs
    assert actual.execution_attempt_version == started.created_at.isoformat(timespec="microseconds")
    assert "__dify_execution_attempt" not in actual.execution_metadata_dict
    if status != WorkflowNodeExecutionStatus.PAUSED:
        history = transports.node_writer().get_by_workflow_execution("run-1")
        assert history[0].created_at == started.created_at


@pytest.mark.parametrize("round_fraction", [True, False], ids=["round", "truncate"])
def test_celery_resume_in_same_database_second_rejects_previous_attempt(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, round_fraction: bool
) -> None:
    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery")
    writer = transports.node_writer()
    paused = node().model_copy(
        update={"created_at": START.replace(microsecond=100_000), "status": WorkflowNodeExecutionStatus.PAUSED}
    )
    resumed = paused.model_copy(
        update={"created_at": START.replace(microsecond=200_000), "status": WorkflowNodeExecutionStatus.RUNNING}
    )
    writer.save(paused)
    transports.settle()
    _apply_mysql_datetime_precision(transports.sessions, round_fraction=round_fraction)
    writer.save(resumed)
    transports.settle()
    _apply_mysql_datetime_precision(transports.sessions, round_fraction=round_fraction)
    writer.save(paused.model_copy(update={"status": WorkflowNodeExecutionStatus.FAILED}))
    transports.settle()
    actual = transports.nodes().get_execution_by_id(paused.id, "tenant-1")
    assert actual is not None
    assert actual.status == WorkflowNodeExecutionStatus.RUNNING
    assert actual.execution_attempt_version == resumed.created_at.isoformat(timespec="microseconds")


def test_celery_legacy_row_rejects_an_unambiguously_older_attempt(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery")
    writer = transports.node_writer()
    current = node().model_copy(update={"status": WorkflowNodeExecutionStatus.RUNNING})
    writer.save(current)
    transports.settle()
    with transports.sessions.begin() as session:
        stored = session.get(WorkflowNodeExecutionModel, current.id)
        assert stored is not None
        stored.execution_metadata = "{}"
    writer.save(
        current.model_copy(
            update={
                "status": WorkflowNodeExecutionStatus.FAILED,
                "created_at": current.created_at - timedelta(seconds=10),
            }
        )
    )
    transports.settle()
    actual = transports.nodes().get_execution_by_id(current.id, "tenant-1")
    assert actual is not None
    assert actual.status == WorkflowNodeExecutionStatus.RUNNING


def test_datasource_debug_returns_result_and_saves_draft_before_async_delivery(
    storage: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The draft-variable upsert uses PostgreSQL's ON CONFLICT, also supported by SQLite.
    apply_config_overrides(monkeypatch, DB_TYPE="postgresql")
    pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline")
    pipeline.id = "app-1"
    actor = make_account(account_id="actor-1")
    execution = node().model_copy(update={"node_type": BuiltinNodeTypes.DATASOURCE})
    workflow = SimpleNamespace(
        id="workflow-1", get_node_config_by_id=lambda _node_id: {}, get_enclosing_node_type_and_id=lambda _config: None
    )
    monkeypatch.setattr(pipeline_module, "db", SimpleNamespace(engine=storage.sessions.kw["bind"]))
    trace = Mock()
    monkeypatch.setattr(pipeline_module, "enqueue_draft_node_execution_trace", trace)
    with storage.sessions() as session:
        service = pipeline_module.RagPipelineService(session, session_maker=storage.sessions)
        monkeypatch.setattr(service, "get_draft_workflow", lambda **_kwargs: workflow)
        monkeypatch.setattr(service, "_handle_node_run_result", lambda **_kwargs: execution)

        response = service.set_datasource_variables(pipeline, {"start_node_id": "node-1"}, actor)

    assert response.id == execution.id
    assert (response.tenant_id, response.app_id, response.workflow_id) == ("tenant-1", "app-1", "workflow-1")
    assert response.outputs_dict == execution.outputs
    assert response.process_data_dict == execution.process_data
    with storage.sessions() as session:
        variable = session.scalar(
            select(WorkflowDraftVariable).where(
                WorkflowDraftVariable.app_id == "app-1",
                WorkflowDraftVariable.node_id == "node-1",
                WorkflowDraftVariable.name == "answer",
            )
        )
        assert variable is not None
        assert variable.get_value().value == [1, 2]
    trace.assert_called_once()
    storage.settle()
    assert storage.nodes().get_execution_by_id(execution.id, "tenant-1") is not None


def test_offline_transport_rejects_sqlite_only_offset_syntax(transports: StorageContract) -> None:
    with pytest.raises(ValueError, match="SLS pagination requires"):
        transports.logs.client.execute_sql(
            sql="SELECT 1 LIMIT 1000 OFFSET 0", logstore=WORKFLOW_NODE_EXECUTION_LOGSTORE
        )


@pytest.mark.parametrize("synchronous", [True, False], ids=["caller-row", "execution-data"])
def test_celery_insert_between_sync_read_and_insert_keeps_the_execution_id(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, synchronous: bool
) -> None:
    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery")
    interleaved = False

    def deliver_before_insert(
        _mapper: Mapper[WorkflowNodeExecutionModel], _connection: Connection, _target: WorkflowNodeExecutionModel
    ) -> None:
        nonlocal interleaved
        if not interleaved:
            interleaved = True
            # Both repository reads returned no row; commit the real worker's
            # INSERT before the synchronous writer attempts its own INSERT.
            transports.settle()

    writer = transports.node_writer()
    started = node().model_copy(update={"status": WorkflowNodeExecutionStatus.RUNNING, "outputs": None})
    writer.save(started)
    finished = node()
    event.listen(WorkflowNodeExecutionModel, "before_insert", deliver_before_insert)
    try:
        if synchronous:
            writer.save_synchronously(finished)
        else:
            writer.save_execution_data(finished)
    finally:
        event.remove(WorkflowNodeExecutionModel, "before_insert", deliver_before_insert)
    assert interleaved
    assert started.id == finished.id == "execution-1"
    # Redelivery keeps addressing the original execution and cannot undo finish.
    writer.save(started)
    transports.settle()
    with transports.sessions() as session:
        rows = session.scalars(select(WorkflowNodeExecutionModel)).all()
        assert len(rows) == 1
        assert rows[0].id == finished.id
        assert rows[0].status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert rows[0].outputs_dict == finished.outputs


@pytest.mark.parametrize("human_input", [False, True], ids=["scheduling", "human-input"])
def test_run_can_pause_and_resume_before_log_delivery(
    storage: StorageContract, monkeypatch: pytest.MonkeyPatch, human_input: bool
) -> None:
    states: dict[str, bytes] = {}
    monkeypatch.setattr(state_storage, "save", lambda key, data: states.__setitem__(key, data))
    monkeypatch.setattr(state_storage, "load", lambda key: states[key])
    monkeypatch.setattr(state_storage, "delete", lambda key: states.pop(key))
    writer = storage.run_writer()
    running = run().model_copy(update={"status": WorkflowExecutionStatus.RUNNING, "finished_at": None})
    writer.save(running)
    # No settle: control transactions cannot wait for a broker or SLS indexing.
    repo = storage.runs()
    reason = (
        HumanInputRequired(form_id="form-1", form_content="", node_id="node-1", node_title="Human Input")
        if human_input
        else SchedulingPause(message="waiting for capacity")
    )
    pause = repo.create_workflow_pause(running.id_, "actor-1", "state-1", [reason])
    assert pause.get_state() == b"state-1"
    record = repo.get_pause_record(workspace_id="tenant-1", workflow_run_id=running.id_)
    assert record is not None
    assert record.status == WorkflowExecutionStatus.PAUSED
    assert record.reasons == (reason,)
    assert repo.get_pause_record(workspace_id="other-tenant", workflow_run_id=running.id_) is None
    storage.settle()  # An older RUNNING message must not reverse the SQL pause.
    with storage.sessions() as session:
        control = session.get(WorkflowRun, running.id_)
        assert control is not None
        assert control.status == WorkflowExecutionStatus.PAUSED
    writer.save(running.model_copy(update={"status": WorkflowExecutionStatus.PAUSED}))
    resumed = repo.resume_workflow_pause(running.id_, pause)
    assert resumed.resumed_at is not None
    assert resumed.get_state() == b"state-1"
    storage.settle()  # A delayed PAUSED message must not undo resumption either.
    record = repo.get_pause_record(workspace_id="tenant-1", workflow_run_id=running.id_)
    assert record is not None
    assert record.status == WorkflowExecutionStatus.RUNNING
    repo.delete_workflow_pause(resumed)
    assert repo.get_workflow_pause(running.id_) is None
    writer.save(run())
    storage.settle()
    with storage.sessions() as session:
        control = session.get(WorkflowRun, running.id_)
        assert control is not None
        assert control.status == WorkflowExecutionStatus.SUCCEEDED
        assert session.scalars(select(WorkflowPause)).all() == []
    assert states == {}
