"""SQLite reads do not need upload services, actors, or a Flask application."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import override

import pytest
from flask import has_app_context
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.factory import OrderConfig
from core.repositories.sqlalchemy_workflow_node_execution_query_repository import (
    SQLAlchemyWorkflowNodeExecutionQueryRepository,
    _filter_by_offload_type,
    _find_first,
)
from extensions.storage.storage_type import StorageType
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom


def _model(
    *,
    execution_id: str = "execution-1",
    index: int = 1,
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    run_id: str = "run-1",
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.SUCCEEDED,
    triggered_from: WorkflowNodeExecutionTriggeredFrom = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        id=execution_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="workflow-1",
        workflow_run_id=run_id,
        triggered_from=triggered_from,
        node_execution_id=f"node-{execution_id}",
        index=index,
        predecessor_node_id=None,
        node_id=f"node-{index}",
        node_type=BuiltinNodeTypes.LLM,
        title=f"Node {index}",
        inputs='{"input": 1}',
        outputs='{"output": 2}',
        process_data='{"step": 3}',
        status=status,
        error=None,
        elapsed_time=1.0,
        execution_metadata='{"total_tokens": 4}',
        created_at=datetime.now(UTC),
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        finished_at=None,
        offload_data=[],
    )


def test_query_accepts_engine_and_sessionmaker(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    for sessions in (sqlite_engine, sqlite_session_factory):
        query = SQLAlchemyWorkflowNodeExecutionQueryRepository(sessions, tenant_id="tenant-1", app_id="app-1")
        assert query.get_by_workflow_execution("missing-run") == []


def test_query_rejects_invalid_factory_and_missing_tenant() -> None:
    with pytest.raises(ValueError, match="Invalid session_factory type"):
        SQLAlchemyWorkflowNodeExecutionQueryRepository(
            session_factory=object(),  # type: ignore[arg-type]
            tenant_id="tenant-1",
            app_id=None,
        )
    with pytest.raises(ValueError, match="tenant_id is required"):
        SQLAlchemyWorkflowNodeExecutionQueryRepository(sessionmaker(), tenant_id="", app_id=None)


def test_query_scopes_run_tenant_app_trigger_and_paused_and_orders(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session, session.begin():
        session.add_all(
            [
                _model(execution_id="two", index=2),
                _model(execution_id="one", index=1),
                _model(execution_id="paused", status=WorkflowNodeExecutionStatus.PAUSED),
                _model(execution_id="foreign-tenant", tenant_id="tenant-2"),
                _model(execution_id="foreign-app", app_id="app-2", index=3),
                _model(execution_id="foreign-run", run_id="run-2"),
                _model(execution_id="single-step", triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP),
            ]
        )
    query = SQLAlchemyWorkflowNodeExecutionQueryRepository(sqlite_session_factory, "tenant-1", "app-1")
    results = query.get_by_workflow_execution(
        "run-1", OrderConfig(order_by=["missing", "index"], order_direction="desc")
    )
    assert [execution.id for execution in results] == ["two", "one"]
    results = query.get_by_workflow_execution("run-1", OrderConfig(order_by=["index"], order_direction="asc"))
    assert [execution.id for execution in results] == ["one", "two"]
    assert query.get_by_workflow_execution("missing-run") == []
    no_app_query = SQLAlchemyWorkflowNodeExecutionQueryRepository(sqlite_session_factory, "tenant-1", None)
    results = no_app_query.get_by_workflow_execution("run-1", OrderConfig(order_by=["index"], order_direction="asc"))
    assert [execution.id for execution in results] == ["one", "two", "foreign-app"]
    assert no_app_query.get_by_workflow_execution("missing-run", OrderConfig(order_by=["missing"])) == []


def test_query_reads_real_rows_without_flask_or_upload_service(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory() as session, session.begin():
        session.add(_model())

    def read_without_application() -> list[WorkflowNodeExecution]:
        assert not has_app_context()
        query = SQLAlchemyWorkflowNodeExecutionQueryRepository(sqlite_session_factory, "tenant-1", "app-1")
        return list(query.get_by_workflow_execution("run-1"))

    with ThreadPoolExecutor(max_workers=1) as executor:
        executions = executor.submit(read_without_application).result()
    assert len(executions) == 1
    execution = executions[0]
    assert execution.id == "execution-1"
    assert execution.inputs == {"input": 1}
    assert execution.outputs == {"output": 2}
    assert execution.process_data == {"step": 3}
    assert execution.metadata == {WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 4}
    assert execution.get_truncated_inputs() is None
    assert execution.get_truncated_outputs() is None
    assert execution.get_truncated_process_data() is None


def test_query_restores_all_offloads_after_closing_database_session(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    model = _model()
    model.inputs = '{"truncated": "inputs"}'
    model.outputs = '{"truncated": "outputs"}'
    model.process_data = '{"truncated": "process_data"}'
    for offload_type in ExecutionOffLoadType:
        upload = UploadFile(
            tenant_id="tenant-1",
            storage_type=StorageType.LOCAL,
            key=offload_type.value,
            name=f"{offload_type.value}.json",
            size=1,
            extension="json",
            mime_type="application/json",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
            created_at=datetime.now(UTC),
            used=False,
        )
        offload = WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id=model.id,
            type_=offload_type,
            file_id=upload.id,
        )
        offload.file = upload
        model.offload_data.append(offload)
    with sqlite_session_factory() as session, session.begin():
        session.add(model)

    closed_sessions: list[Session] = []

    class TrackingSession(Session):
        @override
        def close(self) -> None:
            super().close()
            closed_sessions.append(self)

    sessions: sessionmaker[Session] = sessionmaker(bind=sqlite_engine, class_=TrackingSession, expire_on_commit=False)
    loaded_keys: list[str] = []

    def load_file(key: str) -> bytes:
        assert closed_sessions
        assert not any(session.in_transaction() for session in closed_sessions)
        assert not has_app_context()
        loaded_keys.append(key)
        return json.dumps({"full": key}).encode()

    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_query_repository.storage.load", load_file)
    query = SQLAlchemyWorkflowNodeExecutionQueryRepository(sessions, "tenant-1", "app-1")
    domain = query.get_by_workflow_execution("run-1")[0]
    assert domain.inputs == {"full": "inputs"}
    assert domain.outputs == {"full": "outputs"}
    assert domain.process_data == {"full": "process_data"}
    assert domain.get_truncated_inputs() == {"truncated": "inputs"}
    assert domain.get_truncated_outputs() == {"truncated": "outputs"}
    assert domain.get_truncated_process_data() == {"truncated": "process_data"}
    assert set(loaded_keys) == {offload_type.value for offload_type in ExecutionOffLoadType}


def test_find_offload_by_type() -> None:
    assert _find_first([], lambda _value: True) is None
    assert _find_first([1, 2, 3], lambda value: value > 1) == 2
    inputs = WorkflowNodeExecutionOffload(
        tenant_id="tenant-1",
        app_id="app-1",
        node_execution_id="execution-1",
        type_=ExecutionOffLoadType.INPUTS,
        file_id="inputs-file",
    )
    outputs = WorkflowNodeExecutionOffload(
        tenant_id="tenant-1",
        app_id="app-1",
        node_execution_id="execution-1",
        type_=ExecutionOffLoadType.OUTPUTS,
        file_id="outputs-file",
    )
    assert _find_first([inputs, outputs], _filter_by_offload_type(ExecutionOffLoadType.OUTPUTS)) is outputs
