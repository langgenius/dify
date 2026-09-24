"""
Unit tests for Service API knowledge pipeline file-upload serialization.
"""

from dataclasses import asdict
from datetime import UTC, datetime

from controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow import PipelineUploadFileResponse
from core.file.uploads import FileUploadResult
from extensions.storage.storage_type import StorageType
from libs.helper import dump_response
from models.enums import CreatorUserRole


def _upload_file(*, created_at: datetime) -> FileUploadResult:
    return FileUploadResult(
        id="file-1",
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="uploads/file-1",
        name="test.pdf",
        size=123,
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=created_at,
        used=False,
        used_by=None,
        used_at=None,
        hash=None,
        source_url="",
    )


def test_file_upload_created_at_is_isoformat_string():
    created_at = datetime(2026, 2, 8, 12, 0, 0, tzinfo=UTC)
    upload_file = _upload_file(created_at=created_at)

    result = dump_response(PipelineUploadFileResponse, upload_file)
    assert result["created_at"] == created_at.isoformat()


def test_file_upload_created_at_none_serializes_to_null():
    upload_file = _upload_file(created_at=datetime(2026, 2, 8, 12, 0, 0, tzinfo=UTC))
    result = dump_response(PipelineUploadFileResponse, {**asdict(upload_file), "created_at": None})
    assert result["created_at"] is None
