from collections.abc import Iterator
from unittest.mock import Mock, patch

import pytest

from graphon.file import File, FileTransferMethod, FileType
from services.tool_file_download_service import (
    ToolFileDownload,
    ToolFileDownloadAccessDeniedError,
    ToolFileDownloadNotFoundError,
    ToolFileDownloadService,
    ToolFileDownloadSource,
)


def _file() -> File:
    return File(
        file_id="file-id",
        tenant_id="tenant-id",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="file-id",
        filename="tool.txt",
        extension=".txt",
        mime_type="text/plain",
        size=12,
        storage_key="tools/tenant-id/file.txt",
    )


@pytest.fixture
def tool_files() -> Mock:
    return Mock(spec=ToolFileDownloadSource)


@pytest.fixture
def service(tool_files: Mock) -> ToolFileDownloadService:
    return ToolFileDownloadService(tool_files=tool_files)


def test_invalid_signature_does_not_load_file(service: ToolFileDownloadService, tool_files: Mock) -> None:
    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=False) as verify:
        with pytest.raises(ToolFileDownloadAccessDeniedError):
            service.get_signed_file(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")

    verify.assert_called_once_with(file_id="file-id", timestamp="1", nonce="nonce", sign="invalid")
    tool_files.get_file_generator_by_tool_file_id.assert_not_called()


def test_missing_file_is_reported_after_signature_validation(
    service: ToolFileDownloadService,
    tool_files: Mock,
) -> None:
    tool_files.get_file_generator_by_tool_file_id.return_value = (None, None)

    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=True):
        with pytest.raises(ToolFileDownloadNotFoundError):
            service.get_signed_file(file_id="missing", timestamp="1", nonce="nonce", sign="valid")

    tool_files.get_file_generator_by_tool_file_id.assert_called_once_with(tool_file_id="missing")


def test_signed_file_returns_stream_and_metadata(
    service: ToolFileDownloadService,
    tool_files: Mock,
) -> None:
    stream: Iterator[bytes] = iter([b"a", b"b"])
    tool_files.get_file_generator_by_tool_file_id.return_value = (stream, _file())

    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=True):
        result = service.get_signed_file(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert result == ToolFileDownload(
        content=stream,
        mime_type="text/plain",
        filename="tool.txt",
        size=12,
    )
    tool_files.get_file_generator_by_tool_file_id.assert_called_once_with(tool_file_id="file-id")


@pytest.mark.parametrize("source_error", [RuntimeError("database unavailable"), OSError("storage unavailable")])
def test_source_error_is_not_converted(
    service: ToolFileDownloadService,
    tool_files: Mock,
    source_error: Exception,
) -> None:
    tool_files.get_file_generator_by_tool_file_id.side_effect = source_error

    with patch("services.tool_file_download_service.verify_tool_file_signature", return_value=True):
        with pytest.raises(type(source_error)) as error_info:
            service.get_signed_file(file_id="file-id", timestamp="1", nonce="nonce", sign="valid")

    assert error_info.value is source_error
