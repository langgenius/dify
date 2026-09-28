"""Unit tests for the Service API file-preview transport boundary."""

from inspect import unwrap
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import pytest
from flask import Response

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
) -> MessageFilePreview:
    return MessageFilePreview(
        content=iter([b"file content"]),
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
) -> Response:
    return unwrap(api.get)(
        api,
        args=args,
        app_model=app_model,
        end_user=Mock(spec=EndUser),
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
