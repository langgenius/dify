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
