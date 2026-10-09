import json
from pathlib import Path
from unittest.mock import patch

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from repositories.upload_file_delivery_repository import UploadFileDeliveryQueryRepository
from services.errors.file import UnsupportedFileTypeError
from services.upload_file_delivery_service import (
    UploadFileDelivery,
    UploadFileDeliveryNotFoundError,
    UploadFileDeliveryRecord,
    UploadFileDeliveryService,
)
from tests.unit_tests.model_factories import make_tenant, make_upload_file


def _record(*, extension: str = "png") -> UploadFileDeliveryRecord:
    return UploadFileDeliveryRecord(
        key=f"upload_files/workspace-id/file.{extension}",
        name=f"file.{extension}",
        size=7,
        extension=extension,
        mime_type="image/png" if extension == "png" else "text/plain",
    )


@pytest.fixture
def files(sqlite_session_factory: sessionmaker[Session]) -> UploadFileDeliveryQueryRepository:
    with sqlite_session_factory.begin() as session:
        tenant = make_tenant(tenant_id="workspace-id")
        tenant.custom_config = json.dumps({"replace_webapp_logo": "file-id"})
        session.add(tenant)
        for extension, file_id in [("png", "file-id"), ("txt", "text-id")]:
            file = _record(extension=extension)
            session.add(
                make_upload_file(
                    file_id=file_id,
                    tenant_id=tenant.id,
                    key=file.key,
                    name=file.name,
                    size=file.size,
                    extension=extension,
                    mime_type="image/png" if extension == "png" else "text/plain",
                )
            )
    return UploadFileDeliveryQueryRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def storage(tmp_path: Path) -> Storage:
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    for extension in ("png", "txt"):
        storage.save(_record(extension=extension).key, b"content")
    return storage


@pytest.fixture
def service(files: UploadFileDeliveryQueryRepository, storage: Storage) -> UploadFileDeliveryService:
    return UploadFileDeliveryService(files=files, storage=storage)


def test_invalid_image_signature_does_not_query_or_load_file(
    service: UploadFileDeliveryService,
    files: UploadFileDeliveryQueryRepository,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    lookup = mocker.spy(files, "get_by_id")
    load_stream = mocker.spy(storage, "load_stream")
    load_once = mocker.spy(storage, "load_once")
    with patch("services.upload_file_delivery_service.file_helpers.verify_image_signature", return_value=False):
        with pytest.raises(UploadFileDeliveryNotFoundError):
            service.get_signed_image_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")

    lookup.assert_not_called()
    load_stream.assert_not_called()
    load_once.assert_not_called()


def test_invalid_file_signature_does_not_query_or_load_file(
    service: UploadFileDeliveryService,
    files: UploadFileDeliveryQueryRepository,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    lookup = mocker.spy(files, "get_by_id")
    load_stream = mocker.spy(storage, "load_stream")
    load_once = mocker.spy(storage, "load_once")
    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=False):
        with pytest.raises(UploadFileDeliveryNotFoundError):
            service.get_signed_file_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")

    lookup.assert_not_called()
    load_stream.assert_not_called()
    load_once.assert_not_called()


def test_signed_image_preview_loads_image_stream(
    service: UploadFileDeliveryService,
    files: UploadFileDeliveryQueryRepository,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    lookup = mocker.spy(files, "get_by_id")
    load_stream = mocker.spy(storage, "load_stream")
    with patch("services.upload_file_delivery_service.file_helpers.verify_image_signature", return_value=True):
        result = service.get_signed_image_preview(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert result.file == _record()
    assert not isinstance(result.content, bytes)
    assert b"".join(result.content) == b"content"
    lookup.assert_called_once_with(file_id="file-id")
    load_stream.assert_called_once_with(_record().key)


def test_signed_image_preview_rejects_non_image_before_loading(
    service: UploadFileDeliveryService,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    load_stream = mocker.spy(storage, "load_stream")
    with patch("services.upload_file_delivery_service.file_helpers.verify_image_signature", return_value=True):
        with pytest.raises(UnsupportedFileTypeError):
            service.get_signed_image_preview(file_id="text-id", timestamp="1", nonce="nonce", sign="valid")

    load_stream.assert_not_called()


def test_signed_file_preview_allows_non_image(
    service: UploadFileDeliveryService,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    load_stream = mocker.spy(storage, "load_stream")
    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=True):
        result = service.get_signed_file_preview(file_id="text-id", timestamp="1", nonce="nonce", sign="valid")

    assert result.file == _record(extension="txt")
    assert not isinstance(result.content, bytes)
    assert b"".join(result.content) == b"content"
    load_stream.assert_called_once_with(_record(extension="txt").key)


def test_signed_file_preview_reports_missing_file(
    service: UploadFileDeliveryService,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    load_stream = mocker.spy(storage, "load_stream")
    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=True):
        with pytest.raises(UploadFileDeliveryNotFoundError):
            service.get_signed_file_preview(file_id="missing", timestamp="1", nonce="nonce", sign="valid")

    load_stream.assert_not_called()


def test_workspace_logo_loads_content_once(
    service: UploadFileDeliveryService,
    files: UploadFileDeliveryQueryRepository,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    lookup = mocker.spy(files, "get_workspace_logo")
    load_once = mocker.spy(storage, "load_once")
    load_stream = mocker.spy(storage, "load_stream")

    result = service.get_workspace_webapp_logo(workspace_id="workspace-id")

    assert result == UploadFileDelivery(content=b"content", file=_record())
    lookup.assert_called_once_with(workspace_id="workspace-id")
    load_once.assert_called_once_with(_record().key)
    load_stream.assert_not_called()


def test_workspace_logo_reports_missing_file(
    service: UploadFileDeliveryService,
    storage: Storage,
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
) -> None:
    with sqlite_session_factory.begin() as session:
        tenant = make_tenant(tenant_id="missing-logo")
        tenant.custom_config = json.dumps({"replace_webapp_logo": "missing-file"})
        session.add(tenant)
    load_once = mocker.spy(storage, "load_once")

    with pytest.raises(UploadFileDeliveryNotFoundError):
        service.get_workspace_webapp_logo(workspace_id="missing-logo")

    load_once.assert_not_called()


def test_storage_error_is_not_converted(
    service: UploadFileDeliveryService,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    storage_error = OSError("storage unavailable")
    mocker.patch.object(storage, "load_stream", side_effect=storage_error)

    with patch("services.upload_file_delivery_service.file_helpers.verify_file_signature", return_value=True):
        with pytest.raises(OSError) as error_info:
            service.get_signed_file_preview(file_id="text-id", timestamp="1", nonce="nonce", sign="valid")

    assert error_info.value is storage_error
