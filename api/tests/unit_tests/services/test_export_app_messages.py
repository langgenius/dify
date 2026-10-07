import datetime
import json
from types import SimpleNamespace

import pytest

from services.retention.conversation.message_export_service import AppMessageExportService


def test_validate_export_filename_accepts_relative_path():
    assert AppMessageExportService.validate_export_filename("exports/2026/test01") == "exports/2026/test01"


@pytest.mark.parametrize(
    "filename",
    [
        "test01.jsonl.gz",
        "test01.jsonl",
        "test01.gz",
        "/tmp/test01",
        "exports/../test01",
        "bad\x00name",
        "bad\tname",
        "a" * 1025,
    ],
)
def test_validate_export_filename_rejects_invalid_values(filename: str):
    with pytest.raises(ValueError):
        AppMessageExportService.validate_export_filename(filename)


def test_service_derives_output_names_from_filename_base():
    service = AppMessageExportService(
        app_id="736b9b03-20f2-4697-91da-8d00f6325900",
        start_from=None,
        end_before=datetime.datetime(2026, 3, 1),
        filename="exports/2026/test01",
        batch_size=1000,
        use_cloud_storage=True,
        dry_run=True,
    )

    assert service._filename_base == "exports/2026/test01"
    assert service.output_gz_name == "exports/2026/test01.jsonl.gz"
    assert service.output_jsonl_name == "exports/2026/test01.jsonl"


def _row(message_metadata: str) -> SimpleNamespace:
    return SimpleNamespace(
        id="msg-1",
        conversation_id="conv-1",
        query="q",
        answer="a",
        _inputs={},
        message_metadata=message_metadata,
    )


def test_build_record_extracts_retriever_resources():
    record = AppMessageExportService._build_record(_row(json.dumps({"retriever_resources": [{"id": "r1"}]})), {})

    assert record.retriever_resources == [{"id": "r1"}]
    assert record.message_id == "msg-1"


def test_build_record_ignores_unparseable_metadata():
    """message_metadata is free-form JSON, so a broken value must not fail the whole export."""
    record = AppMessageExportService._build_record(_row("{not json"), {})

    assert record.retriever_resources == []
    assert record.message_id == "msg-1"
