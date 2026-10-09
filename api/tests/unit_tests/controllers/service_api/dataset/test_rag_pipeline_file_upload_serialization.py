"""
Unit tests for Service API knowledge pipeline file-upload serialization.
"""

from datetime import UTC, datetime

from controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow import PipelineUploadFileResponse
from libs.helper import dump_response
from models.model import UploadFile
from tests.unit_tests.model_factories import make_upload_file


def _upload_file(*, created_at: datetime) -> UploadFile:
    return make_upload_file(
        file_id="file-1",
        name="test.pdf",
        size=123,
        extension="pdf",
        mime_type="application/pdf",
        created_at=created_at,
    )


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
