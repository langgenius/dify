"""SQLite-backed tests for workflow node execution offload behavior."""

import json
from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from graphon.enums import WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
)

TABLES = (WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, UploadFile)


def _persist_upload_file(session: Session, *, key: str = "offload/process-data.json") -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key=key,
        name="process-data.json",
        size=18,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime.now(UTC),
        used=True,
    )
    session.add(upload_file)
    session.flush()
    return upload_file


def _persist_execution(
    session: Session,
    *,
    process_data: str = '{"test": "data"}',
    offloads: tuple[tuple[ExecutionOffLoadType, str], ...] = (),
) -> WorkflowNodeExecutionModel:
    execution = WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id="node-execution-1",
        node_id="node-1",
        node_type="code",
        title="Code",
        inputs='{"input": "value"}',
        process_data=process_data,
        outputs='{"output": "value"}',
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        finished_at=None,
    )
    session.add(execution)
    session.flush()

    session.add_all(
        [
            WorkflowNodeExecutionOffload(
                tenant_id=execution.tenant_id,
                app_id=execution.app_id,
                node_execution_id=execution.id,
                type_=type_,
                file_id=file_id,
            )
            for type_, file_id in offloads
        ]
    )
    session.commit()
    session.expunge_all()

    stmt = WorkflowNodeExecutionModel.preload_offload_data(
        select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution.id)
    )
    loaded_execution = session.scalar(stmt)
    assert loaded_execution is not None
    return loaded_execution


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
class TestWorkflowNodeExecutionModel:
    """Exercise truncation flags and content restoration using persisted offload rows."""

    def test_process_data_truncated_property_false_when_no_offload_data(self, sqlite_session: Session):
        execution = _persist_execution(sqlite_session)

        assert execution.process_data_truncated is False

    def test_process_data_truncated_property_false_when_no_process_data_file(self, sqlite_session: Session):
        execution = _persist_execution(
            sqlite_session,
            offloads=(
                (ExecutionOffLoadType.INPUTS, "inputs-file"),
                (ExecutionOffLoadType.OUTPUTS, "outputs-file"),
            ),
        )

        assert execution.process_data_truncated is False

    def test_process_data_truncated_property_true_when_process_data_file_exists(self, sqlite_session: Session):
        execution = _persist_execution(
            sqlite_session,
            offloads=((ExecutionOffLoadType.PROCESS_DATA, "process-data-file-id"),),
        )

        assert execution.process_data_truncated is True

    def test_load_full_process_data_with_no_offload_data(self, sqlite_session: Session):
        execution = _persist_execution(sqlite_session)
        storage = Mock()

        result = execution.load_full_process_data(sqlite_session, storage)

        assert result == {"test": "data"}
        storage.load.assert_not_called()

    def test_load_full_process_data_with_no_file(self, sqlite_session: Session):
        execution = _persist_execution(
            sqlite_session,
            offloads=((ExecutionOffLoadType.INPUTS, "inputs-file"),),
        )
        storage = Mock()

        result = execution.load_full_process_data(sqlite_session, storage)

        assert result == {"test": "data"}
        storage.load.assert_not_called()

    def test_load_full_process_data_with_file(self, sqlite_session: Session):
        upload_file = _persist_upload_file(sqlite_session)
        execution = _persist_execution(
            sqlite_session,
            process_data='{"truncated": true}',
            offloads=((ExecutionOffLoadType.PROCESS_DATA, upload_file.id),),
        )
        full_process_data = {"full": "data", "large_field": "x" * 10000}
        storage = Mock()
        storage.load.return_value = json.dumps(full_process_data)

        result = execution.load_full_process_data(sqlite_session, storage)

        assert result == full_process_data
        storage.load.assert_called_once_with(upload_file.key)

    def test_consistency_with_inputs_outputs_truncation(self, sqlite_session: Session):
        execution = _persist_execution(
            sqlite_session,
            offloads=(
                (ExecutionOffLoadType.INPUTS, "inputs-file"),
                (ExecutionOffLoadType.OUTPUTS, "outputs-file"),
                (ExecutionOffLoadType.PROCESS_DATA, "process-data-file"),
            ),
        )

        assert execution.inputs_truncated is True
        assert execution.outputs_truncated is True
        assert execution.process_data_truncated is True

    def test_mixed_truncation_states(self, sqlite_session: Session):
        execution = _persist_execution(
            sqlite_session,
            offloads=((ExecutionOffLoadType.PROCESS_DATA, "process-data-file"),),
        )

        assert execution.inputs_truncated is False
        assert execution.outputs_truncated is False
        assert execution.process_data_truncated is True

    def test_preload_offload_data_and_files_loads_process_data_file(self, sqlite_session: Session):
        upload_file = _persist_upload_file(sqlite_session)
        execution = _persist_execution(
            sqlite_session,
            offloads=((ExecutionOffLoadType.PROCESS_DATA, upload_file.id),),
        )
        execution_id = execution.id
        sqlite_session.expunge_all()

        stmt = WorkflowNodeExecutionModel.preload_offload_data_and_files(
            select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution_id)
        )
        preloaded_execution = sqlite_session.scalar(stmt)

        assert preloaded_execution is not None
        assert len(preloaded_execution.offload_data) == 1
        assert preloaded_execution.offload_data[0].file is not None
        assert preloaded_execution.offload_data[0].file.key == upload_file.key
