from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from fields.file_fields import FileResponse, FileWithSignedUrl, RemoteFileInfo, UploadConfig


def test_file_response_serializes_datetime() -> None:
    created_at = datetime(2024, 1, 1, 12, 0, 0)
    file_obj = SimpleNamespace(
        id="file-1",
        name="example.txt",
        size=1024,
        extension="txt",
        mime_type="text/plain",
        created_by="user-1",
        created_at=created_at,
        preview_url="https://preview",
        source_url="https://source",
        original_url="https://origin",
        user_id="user-1",
        tenant_id="tenant-1",
        conversation_id="conv-1",
        file_key="key-1",
    )

    serialized = FileResponse.model_validate(file_obj, from_attributes=True).model_dump(mode="json")

    assert serialized["id"] == "file-1"
    assert serialized["created_at"] == int(created_at.timestamp())
    assert serialized["preview_url"] == "https://preview"
    assert serialized["source_url"] == "https://source"
    assert serialized["original_url"] == "https://origin"
    assert serialized["user_id"] == "user-1"
    assert serialized["tenant_id"] == "tenant-1"
    assert serialized["conversation_id"] == "conv-1"
    assert serialized["file_key"] == "key-1"


def test_file_with_signed_url_builds_payload() -> None:
    payload = FileWithSignedUrl(
        id="file-2",
        name="remote.pdf",
        size=2048,
        extension="pdf",
        url="https://signed",
        mime_type="application/pdf",
        created_by="user-2",
        created_at=datetime(2024, 1, 2, 0, 0, 0),
    )

    dumped = payload.model_dump(mode="json")

    assert dumped["url"] == "https://signed"
    assert dumped["created_at"] == int(datetime(2024, 1, 2, 0, 0, 0).timestamp())


def test_remote_file_info_and_upload_config() -> None:
    info = RemoteFileInfo(file_type="text/plain", file_length=123)
    assert info.model_dump(mode="json") == {"file_type": "text/plain", "file_length": 123}

    config = UploadConfig(
        file_size_limit=1,
        batch_count_limit=2,
        file_upload_limit=3,
        image_file_size_limit=4,
        video_file_size_limit=5,
        audio_file_size_limit=6,
        workflow_file_upload_limit=7,
        image_file_batch_limit=8,
        single_chunk_attachment_limit=9,
        attachment_image_file_size_limit=10,
    )

    dumped = config.model_dump(mode="json")
    assert dumped["file_upload_limit"] == 3
    assert dumped["attachment_image_file_size_limit"] == 10
