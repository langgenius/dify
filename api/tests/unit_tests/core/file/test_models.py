from graphon.file import File, FileTransferMethod, FileType


def test_file():
    file = File(
        id="test-file",
        tenant_id="test-tenant-id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="test-related-id",
        filename="image.png",
        extension=".png",
        mime_type="image/png",
        size=67,
        storage_key="test-storage-key",
        url="https://example.com/image.png",
    )
    assert file.type == FileType.IMAGE
    assert file.transfer_method == FileTransferMethod.TOOL_FILE
    assert file.related_id == "test-related-id"
    assert file.storage_key == "test-storage-key"
    assert file.filename == "image.png"
    assert file.extension == ".png"
    assert file.mime_type == "image/png"
    assert file.size == 67


def test_file_model_validate_accepts_legacy_tenant_id():
    data = {
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
        # Extra legacy fields
        "tool_file_id": "tool-file-123",
        "upload_file_id": "upload-file-456",
        "datasource_file_id": "datasource-file-789",
    }

    file = File.model_validate(data)

    assert file.related_id == "test-related-id"
    assert file.storage_key == "test-storage-key"
    assert "tenant_id" not in file.model_dump()
