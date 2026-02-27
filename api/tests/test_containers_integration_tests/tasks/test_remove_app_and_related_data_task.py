import uuid
from unittest.mock import ANY, call, patch

import pytest

from core.db.session_factory import session_factory
from core.variables.segments import StringSegment
from core.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from models import Tenant
from models.enums import CreatorUserRole
from models.model import App, UploadFile
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from tasks.remove_app_and_related_data_task import (
    _delete_draft_variable_offload_data,
    delete_draft_variables_batch,
)


@pytest.fixture(autouse=True)
def cleanup_database(db_session_with_containers):
    db_session_with_containers.query(WorkflowDraftVariable).delete()
    db_session_with_containers.query(WorkflowDraftVariableFile).delete()
    db_session_with_containers.query(UploadFile).delete()
    db_session_with_containers.query(App).delete()
    db_session_with_containers.query(Tenant).delete()
    db_session_with_containers.commit()


def _create_tenant_and_app(db_session_with_containers):
    tenant = Tenant(name=f"test_tenant_{uuid.uuid4()}")
    db_session_with_containers.add(tenant)
    db_session_with_containers.flush()

    app = App(
        tenant_id=tenant.id,
        name=f"Test App for tenant {tenant.id}",
        mode="workflow",
        enable_site=True,
        enable_api=True,
    )
    db_session_with_containers.add(app)
    db_session_with_containers.commit()

    return tenant, app


def _create_draft_variables(
    db_session_with_containers,
    *,
    app_id: str,
    count: int,
    file_id_by_index: dict[int, str] | None = None,
) -> list[WorkflowDraftVariable]:
    variables: list[WorkflowDraftVariable] = []
    file_id_by_index = file_id_by_index or {}

    for i in range(count):
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=app_id,
            node_id=f"node_{i}",
            name=f"var_{i}",
            value=StringSegment(value="test_value"),
            node_execution_id=str(uuid.uuid4()),
            file_id=file_id_by_index.get(i),
        )
        db_session_with_containers.add(variable)
        variables.append(variable)

    db_session_with_containers.commit()
    return variables


def _create_offload_data(db_session_with_containers, *, tenant_id: str, app_id: str, count: int):
    upload_files: list[UploadFile] = []
    variable_files: list[WorkflowDraftVariableFile] = []

    for i in range(count):
        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type="local",
            key=f"test/file-{uuid.uuid4()}-{i}.json",
            name=f"file-{i}.json",
            size=1024 + i,
            extension="json",
            mime_type="application/json",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid.uuid4()),
            created_at=naive_utc_now(),
            used=False,
        )
        db_session_with_containers.add(upload_file)
        db_session_with_containers.flush()
        upload_files.append(upload_file)

        variable_file = WorkflowDraftVariableFile(
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=str(uuid.uuid4()),
            upload_file_id=upload_file.id,
            size=1024 + i,
            length=10 + i,
            value_type=SegmentType.STRING,
        )
        db_session_with_containers.add(variable_file)
        db_session_with_containers.flush()
        variable_files.append(variable_file)

    db_session_with_containers.commit()

    return {
        "upload_files": upload_files,
        "variable_files": variable_files,
    }


class TestDeleteDraftVariablesBatch:
    def test_delete_draft_variables_batch_success(self, db_session_with_containers):
        """Test successful deletion of draft variables in batches."""
        _, app1 = _create_tenant_and_app(db_session_with_containers)
        _, app2 = _create_tenant_and_app(db_session_with_containers)

        _create_draft_variables(db_session_with_containers, app_id=app1.id, count=150)
        _create_draft_variables(db_session_with_containers, app_id=app2.id, count=100)

        result = delete_draft_variables_batch(app1.id, batch_size=100)

        assert result == 150
        app1_remaining = db_session_with_containers.query(WorkflowDraftVariable).where(
            WorkflowDraftVariable.app_id == app1.id
        )
        app2_remaining = db_session_with_containers.query(WorkflowDraftVariable).where(
            WorkflowDraftVariable.app_id == app2.id
        )
        assert app1_remaining.count() == 0
        assert app2_remaining.count() == 100

    def test_delete_draft_variables_batch_empty_result(self, db_session_with_containers):
        """Test deletion when no draft variables exist for the app."""
        result = delete_draft_variables_batch(str(uuid.uuid4()), 1000)

        assert result == 0
        assert db_session_with_containers.query(WorkflowDraftVariable).count() == 0

    @patch("tasks.remove_app_and_related_data_task._delete_draft_variable_offload_data")
    @patch("tasks.remove_app_and_related_data_task.logger")
    def test_delete_draft_variables_batch_logs_progress(
        self, mock_logger, mock_offload_cleanup, db_session_with_containers
    ):
        """Test that batch deletion logs progress correctly."""
        tenant, app = _create_tenant_and_app(db_session_with_containers)
        offload_data = _create_offload_data(db_session_with_containers, tenant_id=tenant.id, app_id=app.id, count=10)

        file_ids = [variable_file.id for variable_file in offload_data["variable_files"]]
        file_id_by_index: dict[int, str] = {}
        for i in range(30):
            if i % 3 == 0:
                file_id_by_index[i] = file_ids[i // 3]
        _create_draft_variables(db_session_with_containers, app_id=app.id, count=30, file_id_by_index=file_id_by_index)

        mock_offload_cleanup.return_value = len(file_id_by_index)

        result = delete_draft_variables_batch(app.id, 50)

        assert result == 30
        mock_offload_cleanup.assert_called_once()
        _, called_file_ids = mock_offload_cleanup.call_args.args
        assert {str(file_id) for file_id in called_file_ids} == {str(file_id) for file_id in file_id_by_index.values()}
        assert mock_logger.info.call_count == 2
        mock_logger.info.assert_any_call(ANY)


class TestDeleteDraftVariableOffloadData:
    """Test the Offload data cleanup functionality."""

    @patch("extensions.ext_storage.storage")
    def test_delete_draft_variable_offload_data_success(self, mock_storage, db_session_with_containers):
        """Test successful deletion of offload data."""
        tenant, app = _create_tenant_and_app(db_session_with_containers)
        offload_data = _create_offload_data(db_session_with_containers, tenant_id=tenant.id, app_id=app.id, count=3)
        file_ids = [variable_file.id for variable_file in offload_data["variable_files"]]
        upload_file_keys = [upload_file.key for upload_file in offload_data["upload_files"]]
        upload_file_ids = [upload_file.id for upload_file in offload_data["upload_files"]]

        with session_factory.create_session() as session, session.begin():
            result = _delete_draft_variable_offload_data(session, file_ids)

        assert result == 3
        expected_storage_calls = [call(storage_key) for storage_key in upload_file_keys]
        mock_storage.delete.assert_has_calls(expected_storage_calls, any_order=True)

        remaining_var_files = db_session_with_containers.query(WorkflowDraftVariableFile).where(
            WorkflowDraftVariableFile.id.in_(file_ids)
        )
        remaining_upload_files = db_session_with_containers.query(UploadFile).where(UploadFile.id.in_(upload_file_ids))
        assert remaining_var_files.count() == 0
        assert remaining_upload_files.count() == 0

    @patch("extensions.ext_storage.storage")
    @patch("tasks.remove_app_and_related_data_task.logging")
    def test_delete_draft_variable_offload_data_storage_failure(
        self, mock_logging, mock_storage, db_session_with_containers
    ):
        """Test handling of storage deletion failures."""
        tenant, app = _create_tenant_and_app(db_session_with_containers)
        offload_data = _create_offload_data(db_session_with_containers, tenant_id=tenant.id, app_id=app.id, count=2)
        file_ids = [variable_file.id for variable_file in offload_data["variable_files"]]
        storage_keys = [upload_file.key for upload_file in offload_data["upload_files"]]
        upload_file_ids = [upload_file.id for upload_file in offload_data["upload_files"]]

        mock_storage.delete.side_effect = [Exception("Storage error"), None]

        with session_factory.create_session() as session, session.begin():
            result = _delete_draft_variable_offload_data(session, file_ids)

        assert result == 1
        mock_logging.exception.assert_called_once_with("Failed to delete storage object %s", storage_keys[0])

        remaining_var_files = db_session_with_containers.query(WorkflowDraftVariableFile).where(
            WorkflowDraftVariableFile.id.in_(file_ids)
        )
        remaining_upload_files = db_session_with_containers.query(UploadFile).where(UploadFile.id.in_(upload_file_ids))
        assert remaining_var_files.count() == 0
        assert remaining_upload_files.count() == 0
