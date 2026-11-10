"""Draft-variable file adapters keep creator and upload persistence behind plain records."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_storage import storage
from graphon.file import helpers as file_helpers
from models import UploadFile
from models.enums import CreatorUserRole
from services.file_service import FileService
from services.workflow.draft_variable_contracts import DraftUploadRecord, DraftVariableCreator
from services.workflow.variable_file_gateway import WorkflowDraftFileUploader


def test_draft_file_uploader_persists_account_identity_and_returns_plain_record(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    stored: dict[str, bytes] = {}
    monkeypatch.setattr(storage, "save", stored.__setitem__)
    monkeypatch.setattr(file_helpers, "get_signed_file_url", lambda *, upload_file_id: f"signed:{upload_file_id}")
    uploader = WorkflowDraftFileUploader(FileService(sqlite_session_factory))

    result = uploader.upload_file(
        filename="node-output.txt",
        content=b"full output",
        mimetype="text/plain",
        creator=DraftVariableCreator(id="account-1"),
        tenant_id="tenant-1",
    )

    assert isinstance(result, DraftUploadRecord)
    with sqlite_session_factory() as session:
        upload = session.get(UploadFile, result.id)
        assert upload is not None
        assert upload.tenant_id == "tenant-1"
        assert upload.created_by == "account-1"
        assert upload.created_by_role == CreatorUserRole.ACCOUNT
        assert stored == {upload.key: b"full output"}
