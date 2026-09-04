import types
from collections.abc import Iterator
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

import controllers.files.tool_files as module
from services.tool_file_download_service import (
    ToolFileDownload,
    ToolFileDownloadAccessDeniedError,
    ToolFileDownloadNotFoundError,
)


def _fake_request(args: dict[str, object]) -> types.SimpleNamespace:
    return types.SimpleNamespace(args=types.SimpleNamespace(to_dict=lambda **_kwargs: args))


def _set_request(monkeypatch: pytest.MonkeyPatch, args: dict[str, object]) -> None:
    monkeypatch.setattr(module, "request", _fake_request(args))


def _download(
    *,
    content: Iterator[bytes] | None = None,
    mime_type: str | None = "text/plain",
    filename: str | None = "tool.txt",
    size: int = 10,
) -> ToolFileDownload:
    return ToolFileDownload(
        content=content if content is not None else iter([b"data"]),
        mime_type=mime_type,
        filename=filename,
        size=size,
    )


class TestToolFileApi:
    @patch.object(module, "application_services")
    def test_success_stream(
        self,
        mock_application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _set_request(
            monkeypatch,
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            },
        )
        stream = iter([b"data"])
        service = mock_application_services.return_value.tool_file_downloads
        service.get_signed_file.return_value = _download(content=stream, size=100)

        response = unwrap(module.ToolFileApi().get)("file-id", "txt")

        assert response.response is stream
        assert response.mimetype == "text/plain"
        assert response.headers["Content-Length"] == "100"
        assert response.direct_passthrough is True
        service.get_signed_file.assert_called_once_with(
            file_id="file-id",
            timestamp="123",
            nonce="abc",
            sign="sig",
        )

    @patch.object(module, "application_services")
    def test_zero_size_omits_content_length(
        self,
        mock_application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _set_request(
            monkeypatch,
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            },
        )
        mock_application_services.return_value.tool_file_downloads.get_signed_file.return_value = _download(size=0)

        response = unwrap(module.ToolFileApi().get)("file-id", "txt")

        assert "Content-Length" not in response.headers

    @patch.object(module, "application_services")
    def test_as_attachment_preserves_mime_type(
        self,
        mock_application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _set_request(
            monkeypatch,
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": True,
            },
        )
        mock_application_services.return_value.tool_file_downloads.get_signed_file.return_value = _download(
            mime_type="application/pdf",
            filename="报告.pdf",
        )

        response = unwrap(module.ToolFileApi().get)("file-id", "pdf")

        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"
        assert response.headers["Content-Type"] == "application/pdf"

    @pytest.mark.parametrize(
        ("mime_type", "filename", "route_extension"),
        [
            pytest.param("text/html", "file.txt", "txt", id="mime-type"),
            pytest.param("text/plain", "file.HTML", "txt", id="filename"),
            pytest.param("text/plain", "file.txt", "html", id="route-extension"),
        ],
    )
    @patch.object(module, "application_services")
    def test_html_forces_download(
        self,
        mock_application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
        mime_type: str,
        filename: str,
        route_extension: str,
    ) -> None:
        _set_request(
            monkeypatch,
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            },
        )
        mock_application_services.return_value.tool_file_downloads.get_signed_file.return_value = _download(
            mime_type=mime_type,
            filename=filename,
        )

        response = unwrap(module.ToolFileApi().get)("file-id", route_extension)

        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    @patch.object(module, "application_services")
    def test_invalid_signature(
        self,
        mock_application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _set_request(
            monkeypatch,
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "bad-sig",
                "as_attachment": False,
            },
        )
        mock_application_services.return_value.tool_file_downloads.get_signed_file.side_effect = (
            ToolFileDownloadAccessDeniedError()
        )

        with pytest.raises(Forbidden, match=r"Invalid request\."):
            unwrap(module.ToolFileApi().get)("file-id", "txt")

    @patch.object(module, "application_services")
    def test_file_not_found(
        self,
        mock_application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _set_request(
            monkeypatch,
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            },
        )
        mock_application_services.return_value.tool_file_downloads.get_signed_file.side_effect = (
            ToolFileDownloadNotFoundError()
        )

        with pytest.raises(NotFound, match="file is not found"):
            unwrap(module.ToolFileApi().get)("file-id", "txt")

    @pytest.mark.parametrize("service_error", [RuntimeError("database unavailable"), OSError("storage unavailable")])
    @patch.object(module, "application_services")
    def test_unexpected_error_is_not_converted(
        self,
        mock_application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
        service_error: Exception,
    ) -> None:
        _set_request(
            monkeypatch,
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            },
        )
        mock_application_services.return_value.tool_file_downloads.get_signed_file.side_effect = service_error

        with pytest.raises(type(service_error)) as error_info:
            unwrap(module.ToolFileApi().get)("file-id", "txt")

        assert error_info.value is service_error
