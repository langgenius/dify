"""
Unit tests for Service API knowledge pipeline file-upload serialization.
"""

from datetime import UTC, datetime

from controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow import PipelineUploadFileResponse
from libs.helper import dump_response


class FakeUploadFile:
    id: str
    name: str
    size: int
    extension: str
    mime_type: str
    created_by: str
    created_at: datetime | None


def test_file_upload_created_at_is_isoformat_string():
    created_at = datetime(2026, 2, 8, 12, 0, 0, tzinfo=UTC)
    upload_file = FakeUploadFile()
    upload_file.id = "file-1"
    upload_file.name = "test.pdf"
    upload_file.size = 123
    upload_file.extension = "pdf"
    upload_file.mime_type = "application/pdf"
    upload_file.created_by = "account-1"
    upload_file.created_at = created_at

    result = dump_response(PipelineUploadFileResponse, upload_file)
    assert result["created_at"] == created_at.isoformat()


def test_file_upload_created_at_none_serializes_to_null():
    upload_file = FakeUploadFile()
    upload_file.id = "file-1"
    upload_file.name = "test.pdf"
    upload_file.size = 123
    upload_file.extension = "pdf"
    upload_file.mime_type = "application/pdf"
    upload_file.created_by = "account-1"
    upload_file.created_at = None

    result = dump_response(PipelineUploadFileResponse, upload_file)
    assert result["created_at"] is None
