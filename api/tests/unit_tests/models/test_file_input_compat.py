from unittest.mock import MagicMock

import pytest

from graphon.file import File, FileTransferMethod, FileType
from models.utils.file_input_compat import (
    build_file_from_mapping_without_lookup,
    build_file_from_stored_mapping,
    rebuild_serialized_graph_files_without_lookup,
    resolve_upload_file_ids_from_serialized_file_value,
)


def test_build_file_from_mapping_without_lookup_accepts_legacy_payload() -> None:
    file = build_file_from_mapping_without_lookup(
        file_mapping={
            "id": "test-file",
            "tenant_id": "test-tenant-id",
            "type": "image",
            "transfer_method": "tool_file",
            "related_id": "test-related-id",
            "filename": "image.png",
            "extension": ".png",
            "mime_type": "image/png",
            "size": 67,
            "storage_key": "test-storage-key",
            "url": "https://example.com/image.png",
            "tool_file_id": "tool-file-123",
            "upload_file_id": "upload-file-456",
            "datasource_file_id": "datasource-file-789",
        }
    )

    assert file.related_id == "test-related-id"
    assert file.storage_key == "test-storage-key"
    assert file.type == FileType.IMAGE


@pytest.mark.parametrize(
    ("file_mapping", "expected_message"),
    [
        (
            {
                "id": "test-file",
                "transfer_method": "local_file",
            },
            "file type is required in file mapping",
        ),
        (
            {
                "id": "test-file",
                "type": "image",
            },
            "transfer_method is required in file mapping",
        ),
    ],
)
def test_build_file_from_mapping_without_lookup_requires_required_fields(
    file_mapping: dict[str, object],
    expected_message: str,
) -> None:
    with pytest.raises(ValueError, match=expected_message):
        build_file_from_mapping_without_lookup(file_mapping=file_mapping)


def test_build_file_from_mapping_without_lookup_normalizes_invalid_metadata_types() -> None:
    file = build_file_from_mapping_without_lookup(
        file_mapping={
            "id": "test-file",
            "type": "image",
            "transfer_method": "local_file",
            "reference": "upload-file-1",
            "filename": 123,
            "size": "large",
        }
    )

    assert file.filename is None
    assert file.size == -1


def test_build_file_from_mapping_without_lookup_accepts_enum_inputs() -> None:
    file = build_file_from_mapping_without_lookup(
        file_mapping={
            "id": "test-file",
            "type": FileType.IMAGE,
            "transfer_method": FileTransferMethod.REMOTE_URL,
            "url": "https://example.com/image.png",
        }
    )

    assert file.type == FileType.IMAGE
    assert file.transfer_method == FileTransferMethod.REMOTE_URL


def test_rebuild_serialized_graph_files_without_lookup_rehydrates_nested_files() -> None:
    rebuilt = rebuild_serialized_graph_files_without_lookup(
        {
            "file": {
                "dify_model_identity": "__dify__file__",
                "id": "test-file",
                "type": "document",
                "transfer_method": "local_file",
                "reference": "upload-file-123",
                "filename": "doc.txt",
            },
            "items": [
                {
                    "dify_model_identity": "__dify__file__",
                    "type": "image",
                    "transfer_method": "remote_url",
                    "url": "https://example.com/image.png",
                    "filename": "image.png",
                }
            ],
        }
    )

    assert isinstance(rebuilt["file"], File)
    assert rebuilt["file"].related_id == "upload-file-123"
    assert isinstance(rebuilt["items"][0], File)
    assert rebuilt["items"][0].transfer_method == FileTransferMethod.REMOTE_URL


def test_rebuild_serialized_graph_files_without_lookup_preserves_scalar_values() -> None:
    assert rebuild_serialized_graph_files_without_lookup("plain-text") == "plain-text"


def test_resolve_upload_file_ids_from_serialized_file_value_uses_persistent_upload_grammar() -> None:
    value = [
        {"transfer_method": "local_file", "reference": "local-file"},
        {"transfer_method": "remote_url", "related_id": "remote-upload"},
        {"transfer_method": "remote_url", "url": "https://example.test/external.png"},
        {"transfer_method": "tool_file", "related_id": "tool-file"},
        {"transfer_method": "datasource_file", "related_id": "datasource-file"},
        {"transfer_method": "local_file", "upload_file_id": "legacy-upload"},
    ]

    assert resolve_upload_file_ids_from_serialized_file_value(
        value_type="array[file]",
        value=value,
    ) == ("local-file", "remote-upload", "legacy-upload")


def test_resolve_upload_file_ids_from_serialized_file_value_ignores_unrelated_values() -> None:
    assert resolve_upload_file_ids_from_serialized_file_value(value_type="string", value='{"related_id":"x"}') == ()
    assert resolve_upload_file_ids_from_serialized_file_value(value_type="file", value="not-json") == ()


def test_build_file_from_stored_mapping_rebuilds_remote_urls_without_record_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rebuilt_file = File(
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image.png",
        filename="image.png",
    )
    build_without_lookup = MagicMock(return_value=rebuilt_file)
    monkeypatch.setattr("models.utils.file_input_compat.build_file_from_mapping_without_lookup", build_without_lookup)

    result = build_file_from_stored_mapping(
        file_mapping={
            "type": "image",
            "transfer_method": "remote_url",
            "url": "https://example.com/image.png",
            "filename": "image.png",
        },
        tenant_id="tenant-1",
    )

    build_without_lookup.assert_called_once()
    assert result is rebuilt_file
