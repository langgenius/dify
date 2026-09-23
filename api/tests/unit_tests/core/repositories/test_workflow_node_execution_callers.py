"""Caller identity survives storage updates independently of node payloads."""

from datetime import datetime
from unittest.mock import Mock
from uuid import uuid4

import pytest
from kombu.serialization import dumps, loads
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_node_execution_repository import CeleryWorkflowNodeExecutionRepository
from core.repositories.factory import WorkflowNodeExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.node_execution import WorkflowNodeExecution
from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from graphon.enums import WorkflowNodeExecutionStatus
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.factory import DifyAPIRepositoryFactory
from tasks.workflow_node_execution_tasks import save_workflow_node_execution_task
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_upload_file


@pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
def test_caller_locators_survive_storage_round_trip_and_updates(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, backend: str
) -> None:
    apply_config_overrides(monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=False)
    client = Mock()
    monkeypatch.setattr(
        "extensions.logstore.repositories.logstore_workflow_node_execution_repository.AliyunLogStore",
        Mock(return_value=client, workflow_node_execution_logstore="workflow_node_execution"),
    )
    sql = SQLAlchemyWorkflowNodeExecutionRepository(
        sqlite_session_factory, "tenant", make_account(), "source-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    )
    execution = WorkflowNodeExecution(
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
    execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
    execution.process_data = {"result": "no caller identifiers in this payload"}
    execution.finished_at = datetime(2026, 9, 23, 0, 0, 1)
    repository.save(execution)
    repository.save_execution_data(execution)

    if backend == "logstore":
        row = dict(client.put_log.call_args.args[1])
        client.execute_sql.return_value = [row]
        restored = repository.get_by_workflow_execution("root-run")[0]
        monkeypatch.setattr(
            "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore",
            Mock(return_value=client, workflow_node_execution_logstore="workflow_node_execution"),
        )
        apply_config_overrides(
            monkeypatch,
            API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
                "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository."
                "LogstoreAPIWorkflowNodeExecutionRepository"
            ),
        )
        api_repository = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(sqlite_session_factory)
        model = api_repository.get_execution_by_id(execution.id, "tenant")
    else:
        restored = sql.get_by_workflow_execution("root-run")[0]
        with sqlite_session_factory() as session:
            model = session.get(WorkflowNodeExecutionModel, execution.id)

    assert model is not None
    assert isinstance(restored, WorkflowNodeExecution)
    for record in (restored, model):
        assert record.triggered_from_workflow_id == execution.triggered_from_workflow_id
        assert record.triggered_from_node_execution_id == execution.triggered_from_node_execution_id
        assert record.workflow_id == execution.workflow_id
    assert model.app_id == "source-app"
    assert model.workflow_run_id == "root-run"
    assert restored.process_data == execution.process_data


def test_sql_offload_preserves_caller_locators(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=32, WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=8
    )
    repository = SQLAlchemyWorkflowNodeExecutionRepository(
        sqlite_session_factory, "tenant", make_account(), "source-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
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
    execution = WorkflowNodeExecution(
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
    assert isinstance(restored, WorkflowNodeExecution)
    assert restored.process_data_truncated
    assert restored.process_data == execution.process_data
    assert restored.triggered_from_workflow_id == execution.triggered_from_workflow_id
    assert restored.triggered_from_node_execution_id == "immediate-tool-execution"
