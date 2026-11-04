import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import cast
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import Table, create_engine, func, select
from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from factories.variable_factory import build_segment
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from services.workflow_draft_variable_service import WorkflowDraftVariableService


@dataclass(frozen=True)
class OffloadedVariable:
    variable: WorkflowDraftVariable
    variable_id: str
    variable_file_id: str
    upload_file_id: str
    storage_key: str


@pytest.fixture
def sqlite_session() -> Iterator[Session]:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    for table in (UploadFile.__table__, WorkflowDraftVariableFile.__table__, WorkflowDraftVariable.__table__):
        cast(Table, table).create(engine)

    with Session(engine) as session:
        yield session


def _create_offloaded_variable(
    session: Session,
    *,
    app_id: str,
    user_id: str,
    node_id: str,
    name: str,
) -> OffloadedVariable:
    tenant_id = str(uuid.uuid4())
    storage_key = f"draft-variables/{uuid.uuid4()}.json"
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=storage_key,
        name="offload.json",
        size=2,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user_id,
        created_at=naive_utc_now(),
        used=True,
        used_by=user_id,
        used_at=naive_utc_now(),
    )
    variable_file = WorkflowDraftVariableFile(
        upload_file_id=upload_file.id,
        value_type=SegmentType.OBJECT,
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        size=2,
        length=None,
    )
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id=user_id,
        node_id=node_id,
        name=name,
        value=build_segment({"truncated": True}),
        visible=True,
        node_execution_id=str(uuid.uuid4()),
    )
    variable.file_id = variable_file.id
    session.add_all([upload_file, variable_file, variable])
    session.commit()
    return OffloadedVariable(
        variable=variable,
        variable_id=variable.id,
        variable_file_id=variable_file.id,
        upload_file_id=upload_file.id,
        storage_key=storage_key,
    )


def _row_exists(session: Session, model: type, row_id: str) -> bool:
    return bool(session.scalar(select(func.count()).select_from(model).where(model.id == row_id)))


@pytest.mark.parametrize("scope", ["user", "node", "app"])
def test_bulk_deletion_cleans_only_matching_offloaded_variables(sqlite_session: Session, scope: str) -> None:
    app_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    node_id = "node-1"
    target = _create_offloaded_variable(
        sqlite_session,
        app_id=app_id,
        user_id=user_id,
        node_id=node_id,
        name="target",
    )
    survivor = _create_offloaded_variable(
        sqlite_session,
        app_id=str(uuid.uuid4()) if scope == "app" else app_id,
        user_id=str(uuid.uuid4()) if scope == "user" else user_id,
        node_id="node-2" if scope == "node" else node_id,
        name="survivor",
    )

    service = WorkflowDraftVariableService(sqlite_session)
    with patch("services.workflow_draft_variable_service.storage.delete") as delete_storage:
        if scope == "user":
            service.delete_user_workflow_variables(app_id, user_id)
        elif scope == "node":
            service.delete_node_variables(app_id, node_id, user_id)
        else:
            service.delete_app_workflow_variables(app_id)
        sqlite_session.commit()

    assert not _row_exists(sqlite_session, WorkflowDraftVariable, target.variable_id)
    assert not _row_exists(sqlite_session, WorkflowDraftVariableFile, target.variable_file_id)
    assert not _row_exists(sqlite_session, UploadFile, target.upload_file_id)
    assert _row_exists(sqlite_session, WorkflowDraftVariable, survivor.variable_id)
    assert _row_exists(sqlite_session, WorkflowDraftVariableFile, survivor.variable_file_id)
    assert _row_exists(sqlite_session, UploadFile, survivor.upload_file_id)
    delete_storage.assert_called_once_with(target.storage_key)


def test_single_variable_deletion_cleans_offloaded_resources(sqlite_session: Session) -> None:
    offloaded = _create_offloaded_variable(
        sqlite_session,
        app_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
        node_id="node-1",
        name="payload",
    )

    with patch("services.workflow_draft_variable_service.storage.delete") as delete_storage:
        WorkflowDraftVariableService(sqlite_session).delete_variable(offloaded.variable)
        sqlite_session.commit()

    assert not _row_exists(sqlite_session, WorkflowDraftVariable, offloaded.variable_id)
    assert not _row_exists(sqlite_session, WorkflowDraftVariableFile, offloaded.variable_file_id)
    assert not _row_exists(sqlite_session, UploadFile, offloaded.upload_file_id)
    delete_storage.assert_called_once_with(offloaded.storage_key)


def test_reset_deletion_cleans_offloaded_resources(sqlite_session: Session) -> None:
    offloaded = _create_offloaded_variable(
        sqlite_session,
        app_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
        node_id="node-1",
        name="payload",
    )
    offloaded.variable.node_execution_id = None

    with patch("services.workflow_draft_variable_service.storage.delete") as delete_storage:
        result = WorkflowDraftVariableService(sqlite_session).reset_variable(Mock(), offloaded.variable)
        sqlite_session.commit()

    assert result is None
    assert not _row_exists(sqlite_session, WorkflowDraftVariable, offloaded.variable_id)
    assert not _row_exists(sqlite_session, WorkflowDraftVariableFile, offloaded.variable_file_id)
    assert not _row_exists(sqlite_session, UploadFile, offloaded.upload_file_id)
    delete_storage.assert_called_once_with(offloaded.storage_key)
