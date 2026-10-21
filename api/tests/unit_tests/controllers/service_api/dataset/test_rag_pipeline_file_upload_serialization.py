"""
Unit tests for Service API knowledge pipeline file-upload serialization.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from fields.service_api.rag_pipeline import PipelineUploadFileResponse
from libs.helper import dump_response


@dataclass(frozen=True)
class UploadFileResponseSource:
    id: str = "file-1"
    name: str = "test.pdf"
    size: int = 123
    extension: str = "pdf"
    mime_type: str = "application/pdf"
    created_by: str = "user-1"
    created_at: datetime | None = None


def test_file_upload_created_at_is_isoformat_string() -> None:
    created_at = datetime(2026, 2, 8, 12, 0, 0, tzinfo=UTC)
    upload_file = UploadFileResponseSource(created_at=created_at)

    result = dump_response(PipelineUploadFileResponse, upload_file)
    assert result["created_at"] == created_at.isoformat()


def test_file_upload_created_at_none_serializes_to_null() -> None:
    upload_file = UploadFileResponseSource(created_at=None)

    result = dump_response(PipelineUploadFileResponse, upload_file)
    assert result["created_at"] is None
