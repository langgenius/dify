"""
Unit tests for Service API knowledge pipeline file-upload serialization.
"""

import importlib.util
from datetime import UTC, datetime
from pathlib import Path


class FakeUploadFile:
    id: str
    name: str
    size: int
    extension: str
    mime_type: str
    created_by: str
    created_at: datetime | None


def _load_serialize_upload_file():
    api_dir = Path(__file__).resolve().parents[5]
    serializers_path = api_dir / "controllers" / "service_api" / "dataset" / "rag_pipeline" / "serializers.py"

    spec = importlib.util.spec_from_file_location("rag_pipeline_serializers", serializers_path)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module.serialize_upload_file


def test_file_upload_created_at_is_isoformat_string():
    serialize_upload_file = _load_serialize_upload_file()

    created_at = datetime(2026, 2, 8, 12, 0, 0, tzinfo=UTC)
    upload_file = FakeUploadFile()
    upload_file.id = "file-1"
    upload_file.name = "test.pdf"
    upload_file.size = 123
    upload_file.extension = "pdf"
    upload_file.mime_type = "application/pdf"
    upload_file.created_by = "account-1"
    upload_file.created_at = created_at

    result = serialize_upload_file(upload_file)
    assert result["created_at"] == created_at.isoformat()


def test_file_upload_created_at_none_serializes_to_null():
    serialize_upload_file = _load_serialize_upload_file()

    upload_file = FakeUploadFile()
    upload_file.id = "file-1"
    upload_file.name = "test.pdf"
    upload_file.size = 123
    upload_file.extension = "pdf"
    upload_file.mime_type = "application/pdf"
    upload_file.created_by = "account-1"
    upload_file.created_at = None

    result = serialize_upload_file(upload_file)
    assert result["created_at"] is None
