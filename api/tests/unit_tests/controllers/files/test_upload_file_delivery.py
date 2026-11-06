from inspect import unwrap
from unittest.mock import patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound, UnprocessableEntity

import controllers.files.upload_file_delivery as module
from services.errors.file import UnsupportedFileTypeError as UnsupportedFileTypeServiceError
from services.upload_file_delivery_service import (
    UploadFileDelivery,
    UploadFileDeliveryNotFoundError,
    UploadFileDeliveryRecord,
)


def _delivery(
    *,
    mime_type: str | None = "text/plain",
    size: int = 10,
    name: str = "test.txt",
    extension: str = "txt",
    content: bytes | None = None,
) -> UploadFileDelivery:
    return UploadFileDelivery(
        content=content if content is not None else iter([b"data"]),
        file=UploadFileDeliveryRecord(
            key="uploads/file-id",
            name=name,
            size=size,
            extension=extension,
            mime_type=mime_type,
        ),
    )


_SIGNED_QUERY = "/?timestamp=123&nonce=abc&sign=sig"


class TestImagePreviewApi:
    @patch.object(module, "application_services")
    def test_success(self, mock_application_services, app: Flask):
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_image_preview.return_value = _delivery(mime_type="image/png", extension="png")

        with app.test_request_context(_SIGNED_QUERY):
            response = module.ImagePreviewApi().get("file-id")

        assert response.mimetype == "image/png"
        service.get_signed_image_preview.assert_called_once_with(
            file_id="file-id",
            timestamp="123",
            nonce="abc",
            sign="sig",
        )

    @patch.object(module, "application_services")
    def test_not_found(self, mock_application_services, app: Flask):
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_image_preview.side_effect = UploadFileDeliveryNotFoundError(
            "File not found or signature is invalid"
        )

        with (
            app.test_request_context(_SIGNED_QUERY),
            pytest.raises(NotFound, match="File not found or signature is invalid"),
        ):
            module.ImagePreviewApi().get("file-id")

    @patch.object(module, "application_services")
    def test_unsupported_file_type(self, mock_application_services, app: Flask):
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_image_preview.side_effect = UnsupportedFileTypeServiceError()

        with app.test_request_context(_SIGNED_QUERY), pytest.raises(module.UnsupportedFileTypeError):
            module.ImagePreviewApi().get("file-id")

    @patch.object(module, "application_services")
    def test_missing_signature_params_are_rejected(self, mock_application_services, app: Flask):
        """An incomplete signature must fail validation before the service is reached."""
        with app.test_request_context("/?timestamp=123"), pytest.raises(UnprocessableEntity):
            module.ImagePreviewApi().get("file-id")

        mock_application_services.return_value.upload_file_delivery.get_signed_image_preview.assert_not_called()


class TestFilePreviewApi:
    @patch.object(module, "enforce_download_for_html")
    @patch.object(module, "application_services")
    def test_inline_preview_uses_file_metadata(self, mock_application_services, mock_enforce, app: Flask):
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_file_preview.return_value = _delivery(
            mime_type="application/pdf",
            size=100,
            name="doc.pdf",
            extension="pdf",
        )

        with app.test_request_context(_SIGNED_QUERY):
            response = module.FilePreviewApi().get("file-id")

        assert response.mimetype == "application/pdf"
        assert response.headers["Content-Type"] == "application/pdf"
        assert response.headers["Content-Length"] == "100"
        assert "Accept-Ranges" not in response.headers
        mock_enforce.assert_called_once_with(
            response,
            mime_type="application/pdf",
            filename="doc.pdf",
            extension="pdf",
        )

    @patch.object(module, "application_services")
    def test_audio_preview_supports_ranges(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg",
            extension="mp3",
        )

        with app.test_request_context(_SIGNED_QUERY):
            response = module.FilePreviewApi().get("file-id")

        assert response.headers["Accept-Ranges"] == "bytes"

    @patch.object(module, "application_services")
    def test_audio_preview_honors_range_request(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg", size=1000, extension="mp3", content=b"x" * 1000
        )

        with app.test_request_context(_SIGNED_QUERY, headers={"Range": "bytes=0-99"}):
            response = module.FilePreviewApi().get("file-id")

        assert response.status_code == 206
        assert response.headers["Content-Range"] == "bytes 0-99/1000"
        assert response.headers["Accept-Ranges"] == "bytes"
        assert response.headers["Content-Length"] == "100"
        assert b"".join(response.response) == b"x" * 100

    @patch.object(module, "application_services")
    def test_range_request_does_not_drain_the_stream(self, mock_application_services, app: Flask):
        # A Range response must slice while streaming. Joining the whole
        # stream first loads the entire file into memory for every ranged
        # request; the old full-file path was streamed.
        drained = False

        def big_stream():
            nonlocal drained
            for index in range(10):
                yield bytes([index]) * 100
            drained = True

        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg", size=1000, extension="mp3", content=big_stream()
        )

        with app.test_request_context(_SIGNED_QUERY, headers={"Range": "bytes=0-99"}):
            response = module.FilePreviewApi().get("file-id")

        assert response.status_code == 206
        assert b"".join(response.response) == bytes([0]) * 100
        assert drained is False

    @patch.object(module, "application_services")
    def test_audio_preview_ignores_range_when_if_range_is_present(self, mock_application_services, app: Flask):
        # Same RFC 9110 13.1.5 rule on this route: stale If-Range + Range
        # must answer 200 with the complete body.
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg", size=1000, extension="mp3", content=b"x" * 1000
        )

        with app.test_request_context(_SIGNED_QUERY, headers={"Range": "bytes=0-9", "If-Range": '"stale-validator"'}):
            response = module.FilePreviewApi().get("file-id")

        assert response.status_code == 200
        assert "Content-Range" not in response.headers
        assert b"".join(response.response) == b"x" * 1000

    @patch.object(module, "application_services")
    def test_audio_preview_suffix_range_returns_file_tail(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg", size=1000, extension="mp3", content=b"x" * 1000
        )

        with app.test_request_context(_SIGNED_QUERY, headers={"Range": "bytes=-50"}):
            response = module.FilePreviewApi().get("file-id")

        assert response.status_code == 206
        assert response.headers["Content-Range"] == "bytes 950-999/1000"
        assert response.headers["Content-Length"] == "50"

    @patch.object(module, "application_services")
    def test_audio_preview_unsatisfiable_range_returns_416(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg", size=1000, extension="mp3", content=b"x" * 1000
        )

        with app.test_request_context(_SIGNED_QUERY, headers={"Range": "bytes=1000-"}):
            response = module.FilePreviewApi().get("file-id")

        assert response.status_code == 416
        assert response.headers["Content-Range"] == "bytes */1000"

    @patch.object(module, "application_services")
    def test_audio_preview_without_range_still_sends_full_body(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg", size=1000, extension="mp3", content=b"x" * 1000
        )

        with app.test_request_context(_SIGNED_QUERY):
            response = module.FilePreviewApi().get("file-id")

        assert response.status_code == 200
        assert "Content-Range" not in response.headers
        assert b"".join(response.response) == b"x" * 1000

    @patch.object(module, "application_services")
    def test_zero_size_omits_content_length(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            size=0
        )

        with app.test_request_context(_SIGNED_QUERY):
            response = module.FilePreviewApi().get("file-id")

        assert "Content-Length" not in response.headers

    @pytest.mark.parametrize(
        ("mime_type", "name", "extension"),
        [
            ("Image/SVG+XML; charset=UTF-8", "image.png", "png"),
            ("image/png", "image.SVG", "png"),
            ("image/png", "image.png", ".SVG"),
        ],
        ids=("mime-type", "filename", "extension"),
    )
    @patch.object(module, "application_services")
    def test_svg_preview_forces_download(self, mock_application_services, mime_type, name, extension, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type=mime_type,
            size=11,
            name=name,
            extension=extension,
        )

        with app.test_request_context(_SIGNED_QUERY):
            response = module.FilePreviewApi().get("file-id")

        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    @patch.object(module, "application_services")
    def test_html_preview_still_forces_download(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="text/html",
            size=25,
            name="unsafe.html",
            extension="html",
        )

        with app.test_request_context(_SIGNED_QUERY):
            response = module.FilePreviewApi().get("file-id")

        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    @patch.object(module, "application_services")
    def test_as_attachment_encodes_filename(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="application/pdf",
            name="报告.pdf",
            extension="pdf",
        )

        with app.test_request_context(f"{_SIGNED_QUERY}&as_attachment=true"):
            response = module.FilePreviewApi().get("file-id")

        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"
        assert response.headers["Content-Type"] == "application/octet-stream"

    @patch.object(module, "application_services")
    def test_not_found(self, mock_application_services, app: Flask):
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.side_effect = (
            UploadFileDeliveryNotFoundError("File not found or signature is invalid")
        )

        with (
            app.test_request_context(_SIGNED_QUERY),
            pytest.raises(NotFound, match="File not found or signature is invalid"),
        ):
            module.FilePreviewApi().get("file-id")

    @patch.object(module, "application_services")
    def test_missing_signature_params_are_rejected(self, mock_application_services, app: Flask):
        """An incomplete signature must fail validation before the service is reached."""
        with app.test_request_context("/?nonce=abc"), pytest.raises(UnprocessableEntity):
            module.FilePreviewApi().get("file-id")

        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.assert_not_called()


class TestWorkspaceWebappLogoApi:
    @patch.object(module, "application_services")
    def test_success(self, mock_application_services):
        service = mock_application_services.return_value.upload_file_delivery
        service.get_workspace_webapp_logo.return_value = _delivery(
            content=b"logo",
            mime_type="image/png",
            extension="png",
        )

        response = unwrap(module.WorkspaceWebappLogoApi().get)("workspace-id")

        assert response.mimetype == "image/png"
        service.get_workspace_webapp_logo.assert_called_once_with(workspace_id="workspace-id")

    @patch.object(module, "application_services")
    def test_logo_not_configured(self, mock_application_services):
        mock_application_services.return_value.upload_file_delivery.get_workspace_webapp_logo.side_effect = (
            UploadFileDeliveryNotFoundError("webapp logo is not found")
        )

        with pytest.raises(NotFound, match="webapp logo is not found"):
            unwrap(module.WorkspaceWebappLogoApi().get)("workspace-id")

    @patch.object(module, "application_services")
    def test_workspace_not_found_uses_default_404(self, mock_application_services):
        mock_application_services.return_value.upload_file_delivery.get_workspace_webapp_logo.side_effect = (
            UploadFileDeliveryNotFoundError()
        )

        with pytest.raises(NotFound) as error:
            unwrap(module.WorkspaceWebappLogoApi().get)("workspace-id")

        assert error.value.description == NotFound.description

    @patch.object(module, "application_services")
    def test_unsupported_file_type(self, mock_application_services):
        mock_application_services.return_value.upload_file_delivery.get_workspace_webapp_logo.side_effect = (
            UnsupportedFileTypeServiceError()
        )

        with pytest.raises(module.UnsupportedFileTypeError):
            unwrap(module.WorkspaceWebappLogoApi().get)("workspace-id")
