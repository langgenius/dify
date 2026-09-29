from unittest.mock import Mock, patch

import pytest

from services.errors.file import UnsupportedFileTypeError
from services.upload_file_delivery_service import (
    UploadFileDelivery,
    UploadFileDeliveryNotFoundError,
    UploadFileDeliveryQuery,
    UploadFileDeliveryRecord,
    UploadFileDeliveryService,
    UploadFileStorage,
)


def _record(*, extension: str = "png") -> UploadFileDeliveryRecord:
    return UploadFileDeliveryRecord(
        key="upload_files/tenant-id/file-id",
        name=f"file.{extension}",
        size=7,
        extension=extension,
        mime_type="image/png" if extension == "png" else "text/plain",
    )


@pytest.fixture
def files() -> Mock:
    return Mock(spec=UploadFileDeliveryQuery)


@pytest.fixture
def storage() -> Mock:
    return Mock(spec=UploadFileStorage)


@pytest.fixture
def service(files: Mock, storage: Mock) -> UploadFileDeliveryService:
    return UploadFileDeliveryService(files=files, storage=storage)


def test_invalid_image_signature_does_not_query_or_load_file(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    with patch("services.upload_file_delivery_service.file_helpers.verify_image_signature", return_value=False):
        with pytest.raises(UploadFileDeliveryNotFoundError):
            service.get_signed_image_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")

    files.get_by_id.assert_not_called()
    storage.load_stream.assert_not_called()
    storage.load_once.assert_not_called()


def test_invalid_file_signature_does_not_query_or_load_file(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=False):
        with pytest.raises(UploadFileDeliveryNotFoundError):
            service.get_signed_file_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")

    files.get_by_id.assert_not_called()
    storage.load_stream.assert_not_called()
    storage.load_once.assert_not_called()


def test_signed_image_preview_loads_image_stream(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    file = _record()
    content = iter((b"content",))
    files.get_by_id.return_value = file
    storage.load_stream.return_value = content

    with patch("services.upload_file_delivery_service.file_helpers.verify_image_signature", return_value=True):
        result = service.get_signed_image_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert result == UploadFileDelivery(content=content, file=file)
    files.get_by_id.assert_called_once_with(file_id="file-id")
    storage.load_stream.assert_called_once_with(file.key)


def test_signed_image_preview_rejects_non_image_before_loading(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    files.get_by_id.return_value = _record(extension="txt")

    with patch("services.upload_file_delivery_service.file_helpers.verify_image_signature", return_value=True):
        with pytest.raises(UnsupportedFileTypeError):
            service.get_signed_image_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    storage.load_stream.assert_not_called()


def test_signed_file_preview_allows_non_image(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    file = _record(extension="txt")
    content = iter((b"content",))
    files.get_by_id.return_value = file
    storage.load_stream.return_value = content

    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=True):
        result = service.get_signed_file_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert result == UploadFileDelivery(content=content, file=file)
    storage.load_stream.assert_called_once_with(file.key)


def test_signed_file_preview_reports_missing_file(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    files.get_by_id.return_value = None

    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=True):
        with pytest.raises(UploadFileDeliveryNotFoundError):
            service.get_signed_file_preview(file_id="missing", timestamp="1", nonce="nonce", sign="valid")

    storage.load_stream.assert_not_called()


def test_workspace_logo_loads_content_once(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    file = _record()
    files.get_workspace_logo.return_value = file
    storage.load_once.return_value = b"content"

    result = service.get_workspace_webapp_logo(workspace_id="workspace-id")

    assert result == UploadFileDelivery(content=b"content", file=file)
    files.get_workspace_logo.assert_called_once_with(workspace_id="workspace-id")
    storage.load_once.assert_called_once_with(file.key)
    storage.load_stream.assert_not_called()


def test_workspace_logo_reports_missing_file(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    files.get_workspace_logo.return_value = None

    with pytest.raises(UploadFileDeliveryNotFoundError):
        service.get_workspace_webapp_logo(workspace_id="workspace-id")

    storage.load_once.assert_not_called()


def test_storage_error_is_not_converted(
    service: UploadFileDeliveryService,
    files: Mock,
    storage: Mock,
) -> None:
    storage_error = OSError("storage unavailable")
    files.get_by_id.return_value = _record(extension="txt")
    storage.load_stream.side_effect = storage_error

    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=True):
        with pytest.raises(OSError) as error_info:
            service.get_signed_file_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert error_info.value is storage_error
