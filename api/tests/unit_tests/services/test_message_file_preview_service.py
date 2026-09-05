from unittest.mock import Mock

import pytest

from services.message_file_preview_service import (
    FileStreamStorage,
    MessageFilePreviewAccessDeniedError,
    MessageFilePreviewNotFoundError,
    MessageFilePreviewQuery,
    MessageFilePreviewRecord,
    MessageFilePreviewService,
)


def _record() -> MessageFilePreviewRecord:
    return MessageFilePreviewRecord(
        key="upload_files/tenant/file.pdf",
        name="file.pdf",
        size=42,
        extension="pdf",
        mime_type="application/pdf",
    )


def test_get_preview_loads_the_authorized_file_stream() -> None:
    files = Mock(spec=MessageFilePreviewQuery)
    storage = Mock(spec=FileStreamStorage)
    file = _record()
    content = iter([b"content"])
    files.get_for_app.return_value = file
    storage.load_stream.return_value = content
    service = MessageFilePreviewService(files=files, storage=storage)

    preview = service.get_preview(
        file_id="file-id",
        app_id="app-id",
        tenant_id="tenant-id",
    )

    files.get_for_app.assert_called_once_with(
        file_id="file-id",
        app_id="app-id",
        tenant_id="tenant-id",
    )
    storage.load_stream.assert_called_once_with(file.key)
    assert preview.file is file
    assert preview.content is content


@pytest.mark.parametrize(
    "error",
    [MessageFilePreviewNotFoundError(), MessageFilePreviewAccessDeniedError()],
)
def test_get_preview_does_not_load_denied_or_missing_files(error: Exception) -> None:
    files = Mock(spec=MessageFilePreviewQuery)
    storage = Mock(spec=FileStreamStorage)
    files.get_for_app.side_effect = error
    service = MessageFilePreviewService(files=files, storage=storage)

    with pytest.raises(type(error)):
        service.get_preview(
            file_id="file-id",
            app_id="app-id",
            tenant_id="tenant-id",
        )

    storage.load_stream.assert_not_called()


def test_get_preview_does_not_mask_storage_errors() -> None:
    files = Mock(spec=MessageFilePreviewQuery)
    storage = Mock(spec=FileStreamStorage)
    files.get_for_app.return_value = _record()
    storage.load_stream.side_effect = OSError("storage down")
    service = MessageFilePreviewService(files=files, storage=storage)

    with pytest.raises(OSError, match="storage down"):
        service.get_preview(
            file_id="file-id",
            app_id="app-id",
            tenant_id="tenant-id",
        )
