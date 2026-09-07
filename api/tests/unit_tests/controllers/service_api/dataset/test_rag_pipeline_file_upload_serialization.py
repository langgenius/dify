"""
Unit tests for Service API knowledge pipeline file-upload serialization.
"""

from datetime import UTC, datetime

from controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow import PipelineUploadFileResponse
from extensions.storage.storage_type import StorageType
from libs.helper import dump_response
from models.enums import CreatorUserRole
from models.model import UploadFile


def _upload_file(*, created_at: datetime) -> UploadFile:
    upload_file = UploadFile(
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
    )
    upload_file.id = "file-1"
    return upload_file


def test_file_upload_created_at_is_isoformat_string():
    created_at = datetime(2026, 2, 8, 12, 0, 0, tzinfo=UTC)
    upload_file = _upload_file(created_at=created_at)

    result = dump_response(PipelineUploadFileResponse, upload_file)
    assert result["created_at"] == created_at.isoformat()


def test_file_upload_created_at_none_serializes_to_null():
    upload_file = _upload_file(created_at=datetime(2026, 2, 8, 12, 0, 0, tzinfo=UTC))
    upload_file.created_at = None

    result = dump_response(PipelineUploadFileResponse, upload_file)
    assert result["created_at"] is None
