"""Unit tests for the Service API file-preview transport boundary."""

from inspect import unwrap
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import pytest
from flask import Flask, Response

from controllers.service_api.app.error import FileAccessDeniedError, FileNotFoundError
from controllers.service_api.app.file_preview import FilePreviewApi, FilePreviewQuery
from models.model import App, EndUser
from services.message_file_preview_service import (
    MessageFilePreview,
    MessageFilePreviewAccessDeniedError,
    MessageFilePreviewNotFoundError,
    MessageFilePreviewRecord,
)


def _preview(
    *,
    mime_type: str | None = "image/jpeg",
    name: str = "test_file.jpg",
    extension: str = "jpg",
    size: int = 1024,
    content: bytes = b"file content",
) -> MessageFilePreview:
    return MessageFilePreview(
        content=iter([content]),
        file=MessageFilePreviewRecord(
            key="storage/key/test_file.jpg",
            name=name,
            size=size,
            extension=extension,
            mime_type=mime_type,
        ),
    )


def _app() -> App:
    return App(id=str(uuid4()), tenant_id=str(uuid4()))


def _get(
    *,
    api: FilePreviewApi,
    args: FilePreviewQuery,
    app_model: App,
    file_id: UUID,
    range_header: str | None = None,
) -> Response:
    flask_app = Flask(__name__)
    headers = {"Range": range_header} if range_header else None
    with flask_app.test_request_context(headers=headers):
        return unwrap(api.get)(
            api,
            args=args,
            app_model=app_model,
            end_user=EndUser(id=str(uuid4()), app_id=app_model.id, tenant_id=app_model.tenant_id),
            file_id=file_id,
        )


class TestFilePreviewApi:
    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_uses_authenticated_app_scope(self, mock_application_services: Mock) -> None:
        app_model = _app()
        file_id = uuid4()
        preview = _preview()
        service = mock_application_services.return_value.message_file_previews
        service.get_preview.return_value = preview

        response = _get(
            api=FilePreviewApi(),
            args=FilePreviewQuery(),
            app_model=app_model,
            file_id=file_id,
        )

        service.get_preview.assert_called_once_with(
            file_id=str(file_id),
            app_id=app_model.id,
            tenant_id=app_model.tenant_id,
        )
        assert response.response is preview.content
        assert response.mimetype == "image/jpeg"

    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_passes_range_header_to_media_response(self, mock_application_services: Mock) -> None:
        app_model = _app()
        file_id = uuid4()
        preview = _preview(mime_type="video/mp4", content=b"0123456789", size=10)
        mock_application_services.return_value.message_file_previews.get_preview.return_value = preview

        response = _get(
            api=FilePreviewApi(),
            args=FilePreviewQuery(),
            app_model=app_model,
            file_id=file_id,
            range_header="bytes=2-5",
        )

        assert response.status_code == 206
        assert response.headers["Content-Range"] == "bytes 2-5/10"
        assert b"".join(response.response) == b"2345"

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            (MessageFilePreviewNotFoundError(), FileNotFoundError),
            (MessageFilePreviewAccessDeniedError(), FileAccessDeniedError),
        ],
    )
    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_maps_expected_errors(
        self,
        mock_application_services: Mock,
        service_error: Exception,
        http_error: type[Exception],
    ) -> None:
        mock_application_services.return_value.message_file_previews.get_preview.side_effect = service_error

        with pytest.raises(http_error):
            _get(
                api=FilePreviewApi(),
                args=FilePreviewQuery(),
                app_model=_app(),
                file_id=uuid4(),
            )

    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_does_not_mask_storage_errors(self, mock_application_services: Mock) -> None:
        mock_application_services.return_value.message_file_previews.get_preview.side_effect = OSError("storage down")

        with pytest.raises(OSError, match="storage down"):
            _get(
                api=FilePreviewApi(),
                args=FilePreviewQuery(),
                app_model=_app(),
                file_id=uuid4(),
            )

    @pytest.mark.parametrize(
        ("preview", "as_attachment"),
        [
            (_preview(), False),
            (_preview(name="报告 1.jpg"), True),
            (_preview(mime_type="text/html", name="unsafe.html", extension="html"), False),
            (_preview(mime_type="video/mp4", name="video.mp4", extension="mp4"), False),
            (_preview(size=0), False),
        ],
    )
    def test_build_file_response(self, preview: MessageFilePreview, as_attachment: bool) -> None:
        response = FilePreviewApi()._build_file_response(
            preview=preview,
            as_attachment=as_attachment,
        )

        assert response.direct_passthrough is True
        assert response.headers["Cache-Control"] == "public, max-age=3600"
        assert ("Content-Length" in response.headers) is (preview.file.size > 0)
        if as_attachment:
            assert response.headers["Content-Disposition"] == (
                "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A%201.jpg"
            )
            assert response.headers["Content-Type"] == "application/octet-stream"
        elif preview.file.mime_type == "text/html":
            assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''unsafe.html"
            assert response.headers["Content-Type"] == "application/octet-stream"
            assert response.headers["X-Content-Type-Options"] == "nosniff"
        else:
            assert response.mimetype == preview.file.mime_type
        if preview.file.mime_type == "video/mp4":
            assert response.headers["Accept-Ranges"] == "bytes"

    def test_build_file_response_honors_single_media_byte_range(self) -> None:
        preview = _preview(mime_type="video/mp4", name="video.mp4", extension="mp4", content=b"0123456789", size=10)

        response = FilePreviewApi()._build_file_response(preview=preview, range_header="bytes=2-5")

        assert response.status_code == 206
        assert response.headers["Accept-Ranges"] == "bytes"
        assert response.headers["Content-Range"] == "bytes 2-5/10"
        assert response.headers["Content-Length"] == "4"
        assert b"".join(response.response) == b"2345"

    @pytest.mark.parametrize(
        ("range_header", "expected_range", "expected_body"),
        [
            ("bytes=7-", "bytes 7-9/10", b"789"),
            ("bytes=-3", "bytes 7-9/10", b"789"),
            ("bytes=8-99", "bytes 8-9/10", b"89"),
        ],
    )
    def test_build_file_response_resolves_open_ended_suffix_and_clamped_ranges(
        self, range_header: str, expected_range: str, expected_body: bytes
    ) -> None:
        preview = _preview(mime_type="video/mp4", content=b"0123456789", size=10)

        response = FilePreviewApi()._build_file_response(preview=preview, range_header=range_header)

        assert response.status_code == 206
        assert response.headers["Content-Range"] == expected_range
        assert b"".join(response.response) == expected_body

    @pytest.mark.parametrize(
        ("mime_type", "range_header"),
        [
            ("video/mp4", "bytes=0-1,4-5"),
            ("video/mp4", "bytes=not-a-range"),
            ("video/mp4", "bytes=-0"),
            ("image/jpeg", "bytes=0-1"),
        ],
    )
    def test_build_file_response_ignores_unsupported_ranges(self, mime_type: str, range_header: str) -> None:
        preview = _preview(mime_type=mime_type, content=b"0123456789", size=10)

        response = FilePreviewApi()._build_file_response(preview=preview, range_header=range_header)

        assert response.status_code == 200
        assert "Content-Range" not in response.headers
        assert b"".join(response.response) == b"0123456789"

    @pytest.mark.parametrize(
        ("size", "range_header"),
        [(10, "bytes=10-"), (0, "bytes=0-0")],
    )
    def test_build_file_response_returns_416_for_unsatisfiable_media_range(self, size: int, range_header: str) -> None:
        preview = _preview(mime_type="audio/mpeg", name="audio.mp3", extension="mp3", content=b"0123456789", size=size)

        response = FilePreviewApi()._build_file_response(preview=preview, range_header=range_header)

        assert response.status_code == 416
        assert response.headers["Accept-Ranges"] == "bytes"
        assert response.headers["Content-Range"] == f"bytes */{size}"
        assert response.headers["Content-Length"] == "0"
        assert b"".join(response.response) == b""
