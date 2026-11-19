import json
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.workflow.file_reference import build_file_reference
from repositories.workflow.upload_file_references import lock_new_workflow_upload_file_references
from services.errors.file import UploadFileReferenceNotFoundError
from tests.helpers.unit.model_factories import make_upload_file


def _local_file(file_id: str) -> dict[str, str]:
    return {
        "transfer_method": "local_file",
        "reference": build_file_reference(record_id=file_id),
    }


def test_lock_new_workflow_references_validates_only_introduced_files(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    existing_file_id = str(uuid4())
    introduced_file_id = str(uuid4())
    sqlite_session.add_all(
        [
            make_upload_file(file_id=existing_file_id, tenant_id=tenant_id),
            make_upload_file(file_id=introduced_file_id, tenant_id=tenant_id),
        ]
    )
    sqlite_session.commit()

    lock_new_workflow_upload_file_references(
        sqlite_session,
        tenant_id=tenant_id,
        previous_payloads=({"files": [_local_file(existing_file_id)]},),
        current_payloads=({"files": [_local_file(existing_file_id), _local_file(introduced_file_id)]},),
    )


def test_unchanged_historical_missing_reference_does_not_block_update(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    missing_file = _local_file(str(uuid4()))

    lock_new_workflow_upload_file_references(
        sqlite_session,
        tenant_id=tenant_id,
        previous_payloads=({"file": missing_file, "status": "running"},),
        current_payloads=({"file": missing_file, "status": "succeeded"},),
    )


def test_new_missing_workflow_reference_is_rejected(sqlite_session: Session) -> None:
    with pytest.raises(UploadFileReferenceNotFoundError):
        lock_new_workflow_upload_file_references(
            sqlite_session,
            tenant_id=str(uuid4()),
            current_payloads=({"file": _local_file(str(uuid4()))},),
        )


def test_nested_serialized_local_reference_is_rejected(sqlite_session: Session) -> None:
    nested_state = json.dumps({"file": _local_file(str(uuid4()))})

    with pytest.raises(UploadFileReferenceNotFoundError):
        lock_new_workflow_upload_file_references(
            sqlite_session,
            tenant_id=str(uuid4()),
            current_payloads=({"serialized_graph_runtime_state": nested_state},),
        )


def test_nested_serialized_tool_file_is_not_treated_as_upload(sqlite_session: Session) -> None:
    nested_state = json.dumps(
        {
            "file": {
                "transfer_method": "tool_file",
                "reference": build_file_reference(record_id=str(uuid4())),
            }
        }
    )

    lock_new_workflow_upload_file_references(
        sqlite_session,
        tenant_id=str(uuid4()),
        current_payloads=({"serialized_graph_runtime_state": nested_state},),
    )
