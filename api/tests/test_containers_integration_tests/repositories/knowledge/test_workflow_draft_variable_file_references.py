import json
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from core.workflow.file_reference import build_file_reference
from extensions.storage.storage_type import StorageType
from graphon.variables import SegmentType, StringSegment
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.workflow import (
    Workflow,
    WorkflowDraftVariable,
    WorkflowDraftVariableUploadFileReference,
)
from repositories.knowledge.upload_file_repository import (
    claim_orphan_upload_files,
    recheck_claimed_orphan_upload_files,
)
from services.knowledge.indexing.cleanup import UploadFileCleanup, UploadFilePendingDeletionError
from services.workflow_draft_variable_service import WorkflowDraftVariableService, _batch_upsert_draft_variable


def _upload(*, tenant_id: str, file_id: str) -> UploadFile:
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"workflow/{file_id}",
        name=f"{file_id}.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=naive_utc_now(),
        used=False,
    )
    upload.id = file_id
    return upload


def _workflow(*, tenant_id: str, app_id: str) -> Workflow:
    return Workflow.new(
        tenant_id=tenant_id,
        app_id=app_id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by=str(uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _file_variable(*, app_id: str, user_id: str, file_id: str) -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id=user_id,
        node_id="node-1",
        name="output",
        value=StringSegment(value="placeholder"),
        node_execution_id=str(uuid4()),
    )
    variable.value_type = SegmentType.FILE
    variable.value = json.dumps(
        {
            "transfer_method": "local_file",
            "reference": build_file_reference(record_id=file_id),
        }
    )
    return variable


def test_bulk_upsert_replaces_the_persisted_winners_file_edges(db_session_with_containers: Session) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    user_id = str(uuid4())
    first = _upload(tenant_id=tenant_id, file_id=str(uuid4()))
    second = _upload(tenant_id=tenant_id, file_id=str(uuid4()))
    db_session_with_containers.add_all([_workflow(tenant_id=tenant_id, app_id=app_id), first, second])
    db_session_with_containers.flush()

    original = _file_variable(app_id=app_id, user_id=user_id, file_id=first.id)
    _batch_upsert_draft_variable(db_session_with_containers, (original,))
    db_session_with_containers.flush()
    persisted_id = db_session_with_containers.scalar(
        select(WorkflowDraftVariable.id).where(
            WorkflowDraftVariable.app_id == app_id,
            WorkflowDraftVariable.user_id == user_id,
            WorkflowDraftVariable.node_id == "node-1",
            WorkflowDraftVariable.name == "output",
        )
    )
    assert persisted_id == original.id

    replacement = _file_variable(app_id=app_id, user_id=user_id, file_id=second.id)
    _batch_upsert_draft_variable(db_session_with_containers, (replacement,))
    db_session_with_containers.flush()
    references = db_session_with_containers.execute(
        select(
            WorkflowDraftVariableUploadFileReference.draft_variable_id,
            WorkflowDraftVariableUploadFileReference.upload_file_id,
        )
    ).all()
    assert references == [(original.id, second.id)]

    WorkflowDraftVariableService(db_session_with_containers).delete_node_variables(app_id, "node-1", user_id)
    db_session_with_containers.flush()
    assert tuple(db_session_with_containers.scalars(select(WorkflowDraftVariableUploadFileReference.id))) == ()


def test_bulk_upsert_rejects_a_file_claimed_for_cleanup(db_session_with_containers: Session) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    user_id = str(uuid4())
    upload = _upload(tenant_id=tenant_id, file_id=str(uuid4()))
    upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    db_session_with_containers.add_all([_workflow(tenant_id=tenant_id, app_id=app_id), upload])
    db_session_with_containers.flush()

    with pytest.raises(UploadFilePendingDeletionError):
        _batch_upsert_draft_variable(
            db_session_with_containers,
            (_file_variable(app_id=app_id, user_id=user_id, file_id=upload.id),),
        )


def test_pre_delete_recheck_sees_legacy_reference_committed_after_claim(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    upload = _upload(tenant_id=tenant_id, file_id=str(uuid4()))
    db_session_with_containers.add_all([_workflow(tenant_id=tenant_id, app_id=app_id), upload])
    db_session_with_containers.flush()
    candidate = (UploadFileCleanup(id=upload.id, key=upload.key),)

    assert claim_orphan_upload_files(db_session_with_containers, tenant_id=tenant_id, files=candidate) == candidate
    db_session_with_containers.commit()

    db_session_with_containers.execute(
        insert(WorkflowDraftVariable).values(
            id=str(uuid4()),
            app_id=app_id,
            user_id=str(uuid4()),
            node_id="node-legacy",
            name="output",
            description="",
            selector=json.dumps(["node-legacy", "output"]),
            value_type=SegmentType.FILE,
            value=json.dumps(
                {
                    "transfer_method": "local_file",
                    "reference": build_file_reference(record_id=upload.id, storage_key=upload.key),
                }
            ),
            visible=True,
            editable=True,
            node_execution_id=str(uuid4()),
            is_default_value=False,
        )
    )
    db_session_with_containers.commit()

    assert (
        recheck_claimed_orphan_upload_files(
            db_session_with_containers,
            tenant_id=tenant_id,
            files=candidate,
        )
        == ()
    )
    db_session_with_containers.flush()
    retained = db_session_with_containers.get_one(UploadFile, upload.id)
    assert retained.knowledge_cleanup_started_at is None
