from graphon.file import File, FileTransferMethod, FileType
from models.utils.file_input_compat import (
    build_file_from_mapping_without_lookup,
    rebuild_serialized_graph_files_without_lookup,
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
