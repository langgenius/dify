from collections.abc import Iterator
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, Response
from werkzeug.exceptions import Forbidden, NotFound, UnprocessableEntity

import controllers.files.tool_files as module
from services.tool_file_download_service import (
    ToolFileDownload,
    ToolFileDownloadAccessDeniedError,
    ToolFileDownloadNotFoundError,
)


def _query(*, sign: str = "sig", as_attachment: bool = False) -> module.ToolFileQuery:
    return module.ToolFileQuery(timestamp="123", nonce="abc", sign=sign, as_attachment=as_attachment)


def _get(query: module.ToolFileQuery, file_id: str, extension: str) -> Response:
    api = module.ToolFileApi()
    return unwrap(api.get)(api, query, file_id, extension)


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
    def test_success_stream(self, mock_application_services: MagicMock) -> None:
        stream = iter([b"data"])
        service = mock_application_services.return_value.tool_file_downloads
        service.get_signed_file.return_value = _download(content=stream, size=100)

        response = _get(_query(), "file-id", "txt")

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
    def test_zero_size_omits_content_length(self, mock_application_services: MagicMock) -> None:
        mock_application_services.return_value.tool_file_downloads.get_signed_file.return_value = _download(size=0)

        response = _get(_query(), "file-id", "txt")

        assert "Content-Length" not in response.headers

    @patch.object(module, "application_services")
    def test_as_attachment_preserves_mime_type(self, mock_application_services: MagicMock) -> None:
        mock_application_services.return_value.tool_file_downloads.get_signed_file.return_value = _download(
            mime_type="application/pdf",
            filename="报告.pdf",
        )

        response = _get(_query(as_attachment=True), "file-id", "pdf")

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
        mime_type: str,
        filename: str,
        route_extension: str,
    ) -> None:
        mock_application_services.return_value.tool_file_downloads.get_signed_file.return_value = _download(
            mime_type=mime_type,
            filename=filename,
        )

        response = _get(_query(), "file-id", route_extension)

        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    @patch.object(module, "application_services")
    def test_invalid_signature(self, mock_application_services: MagicMock) -> None:
        mock_application_services.return_value.tool_file_downloads.get_signed_file.side_effect = (
            ToolFileDownloadAccessDeniedError()
        )

        with pytest.raises(Forbidden, match=r"Invalid request\."):
            _get(_query(sign="bad-sig"), "file-id", "txt")

    @patch.object(module, "application_services")
    def test_file_not_found(self, mock_application_services: MagicMock) -> None:
        mock_application_services.return_value.tool_file_downloads.get_signed_file.side_effect = (
            ToolFileDownloadNotFoundError()
        )

        with pytest.raises(NotFound, match="file is not found"):
            _get(_query(), "file-id", "txt")

    @pytest.mark.parametrize("service_error", [RuntimeError("database unavailable"), OSError("storage unavailable")])
    @patch.object(module, "application_services")
    def test_unexpected_error_is_not_converted(
        self,
        mock_application_services: MagicMock,
        service_error: Exception,
    ) -> None:
        mock_application_services.return_value.tool_file_downloads.get_signed_file.side_effect = service_error

        with pytest.raises(type(service_error)) as error_info:
            _get(_query(), "file-id", "txt")

        assert error_info.value is service_error

    def test_missing_signature_is_rejected_before_the_service_call(self, app: Flask) -> None:
        """`timestamp`, `nonce` and `sign` are required, so this covers the decorator's rejection path."""
        with patch.object(module, "application_services") as application_services:
            with app.test_request_context("/files/tools/file-id.txt"):
                with pytest.raises(UnprocessableEntity):
                    module.ToolFileApi().get("file-id", "txt")

        application_services.assert_not_called()
