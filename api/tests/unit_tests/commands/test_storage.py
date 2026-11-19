"""Regression coverage for upload-file maintenance commands."""

import pytest
from click.testing import CliRunner
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from commands import storage
from models.dataset import SegmentAttachmentBinding
from models.model import UploadFile
from tests.helpers.unit.model_factories import make_upload_file


def test_clear_orphaned_file_records_keeps_files_used_as_segment_attachments(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    retained_upload = make_upload_file(
        file_id="0198a6b2-6e4c-7c3a-9d1e-2f3b4c5d6e7f",
        tenant_id="tenant-1",
        key="upload_files/tenant-1/retained.png",
    )
    orphaned_upload = make_upload_file(
        file_id="0198a6b2-6e4c-7c3a-9d1e-2f3b4c5d6e80",
        tenant_id="tenant-1",
        key="upload_files/tenant-1/orphaned.png",
    )
    binding = SegmentAttachmentBinding(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        attachment_id=retained_upload.id,
    )
    sqlite_session.add_all([retained_upload, orphaned_upload, binding])
    sqlite_session.commit()
    retained_upload_id = retained_upload.id
    orphaned_upload_id = orphaned_upload.id
    binding_id = binding.id
    monkeypatch.setattr(type(storage.db), "engine", property(lambda _db: sqlite_engine))

    result = CliRunner().invoke(storage.clear_orphaned_file_records, ["--force"])

    assert result.exit_code == 0, result.output
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, retained_upload_id) is not None
    assert sqlite_session.get(UploadFile, orphaned_upload_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is not None
