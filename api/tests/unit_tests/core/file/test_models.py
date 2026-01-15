from core.file import File, FileTransferMethod, FileType


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
    assert file.tenant_id == "test-tenant-id"
    assert file.type == FileType.IMAGE
    assert file.transfer_method == FileTransferMethod.TOOL_FILE
    assert file.related_id == "test-related-id"
    assert file.filename == "image.png"
    assert file.extension == ".png"
    assert file.mime_type == "image/png"
    assert file.size == 67


def test_file_model_validate_with_legacy_fields():
    """Test `File` model can handle data containing compatibility fields."""
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

    # Should be able to create `File` object without raising an exception
    file = File.model_validate(data)

    # The File object does not have tool_file_id, upload_file_id, or datasource_file_id as attributes.
    # Instead, check it does not expose unrecognized legacy fields (should raise on getattr).
    for legacy_field in ("tool_file_id", "upload_file_id", "datasource_file_id"):
        assert not hasattr(file, legacy_field)
