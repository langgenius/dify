from pathlib import Path
from unittest.mock import patch

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from models.tools import ToolFile
from services.tool_file_download_service import (
    ToolFileDownloadAccessDeniedError,
    ToolFileDownloadNotFoundError,
    ToolFileDownloadService,
)


@pytest.fixture
def storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Storage:
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr("core.tools.tool_file_manager.storage", storage)
    return storage


@pytest.fixture
def tool_files(sqlite_session_factory: sessionmaker[Session], storage: Storage) -> ToolFileManager:
    storage.save("tools/tenant-id/file.txt", b"ab")
    with sqlite_session_factory.begin() as session:
        file = ToolFile(
            user_id="user-id",
            tenant_id="tenant-id",
            conversation_id=None,
            file_key="tools/tenant-id/file.txt",
            mimetype="text/plain",
            name="tool.txt",
            size=2,
        )
        file.id = "file-id"
        session.add(file)
    return ToolFileManager()


@pytest.fixture
def service(tool_files: ToolFileManager) -> ToolFileDownloadService:
    return ToolFileDownloadService(tool_files=tool_files)


def test_invalid_signature_does_not_load_file(
    service: ToolFileDownloadService, tool_files: ToolFileManager, mocker: MockerFixture
) -> None:
    load = mocker.spy(tool_files, "get_file_generator_by_tool_file_id")
    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=False) as verify:
        with pytest.raises(ToolFileDownloadAccessDeniedError):
            service.get_signed_file(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")

    verify.assert_called_once_with(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")
    load.assert_not_called()


def test_missing_file_is_reported_after_signature_validation(
    service: ToolFileDownloadService,
    tool_files: ToolFileManager,
    mocker: MockerFixture,
) -> None:
    load = mocker.spy(tool_files, "get_file_generator_by_tool_file_id")
    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=True):
        with pytest.raises(ToolFileDownloadNotFoundError):
            service.get_signed_file(file_id="missing", timestamp="1", nonce="nonce", sign="valid")

    load.assert_called_once_with(tool_file_id="missing")


def test_signed_file_returns_stream_and_metadata(
    service: ToolFileDownloadService,
    tool_files: ToolFileManager,
    mocker: MockerFixture,
) -> None:
    load = mocker.spy(tool_files, "get_file_generator_by_tool_file_id")
    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=True):
        result = service.get_signed_file(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert b"".join(result.content) == b"ab"
    assert result.mime_type == "text/plain"
    assert result.filename == "tool.txt"
    assert result.size == 2
    load.assert_called_once_with(tool_file_id="file-id")


@pytest.mark.parametrize("source_error", [RuntimeError("database unavailable"), OSError("storage unavailable")])
def test_source_error_is_not_converted(
    service: ToolFileDownloadService,
    storage: Storage,
    mocker: MockerFixture,
    source_error: Exception,
) -> None:
    if isinstance(source_error, OSError):
        mocker.patch.object(storage, "load_stream", side_effect=source_error)
    else:
        mocker.patch("core.tools.tool_file_manager.session_factory.create_session", side_effect=source_error)

    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=True):
        with pytest.raises(type(source_error)) as error_info:
            service.get_signed_file(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert error_info.value is source_error
