import types
from inspect import unwrap
from unittest.mock import patch

import pytest
from werkzeug.exceptions import NotFound

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


def _fake_request(args: dict[str, object]):
    return types.SimpleNamespace(args=types.SimpleNamespace(to_dict=lambda **_kwargs: args))


class TestImagePreviewApi:
    @patch.object(module, "application_services")
    def test_success(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig"})
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_image_preview.return_value = _delivery(mime_type="image/png", extension="png")

        response = unwrap(module.ImagePreviewApi().get)("file-id")

        assert response.mimetype == "image/png"
        service.get_signed_image_preview.assert_called_once_with(
            file_id="file-id",
            timestamp="123",
            nonce="abc",
            sign="sig",
        )

    @patch.object(module, "application_services")
    def test_not_found(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig"})
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_image_preview.side_effect = UploadFileDeliveryNotFoundError(
            "File not found or signature is invalid"
        )

        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            unwrap(module.ImagePreviewApi().get)("file-id")

    @patch.object(module, "application_services")
    def test_unsupported_file_type(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig"})
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_image_preview.side_effect = UnsupportedFileTypeServiceError()

        with pytest.raises(module.UnsupportedFileTypeError):
            unwrap(module.ImagePreviewApi().get)("file-id")


class TestFilePreviewApi:
    @patch.object(module, "enforce_download_for_html")
    @patch.object(module, "application_services")
    def test_inline_preview_uses_file_metadata(self, mock_application_services, mock_enforce):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig", "as_attachment": False})
        service = mock_application_services.return_value.upload_file_delivery
        service.get_signed_file_preview.return_value = _delivery(
            mime_type="application/pdf",
            size=100,
            name="doc.pdf",
            extension="pdf",
        )

        response = unwrap(module.FilePreviewApi().get)("file-id")

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
    def test_audio_preview_supports_ranges(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig", "as_attachment": False})
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="audio/mpeg",
            extension="mp3",
        )

        response = unwrap(module.FilePreviewApi().get)("file-id")

        assert response.headers["Accept-Ranges"] == "bytes"

    @patch.object(module, "application_services")
    def test_zero_size_omits_content_length(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig", "as_attachment": False})
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            size=0
        )

        response = unwrap(module.FilePreviewApi().get)("file-id")

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
    def test_svg_preview_forces_download(self, mock_application_services, mime_type, name, extension):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig", "as_attachment": False})
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type=mime_type,
            size=11,
            name=name,
            extension=extension,
        )

        response = unwrap(module.FilePreviewApi().get)("file-id")

        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    @patch.object(module, "application_services")
    def test_html_preview_still_forces_download(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig", "as_attachment": False})
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="text/html",
            size=25,
            name="unsafe.html",
            extension="html",
        )

        response = unwrap(module.FilePreviewApi().get)("file-id")

        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    @patch.object(module, "application_services")
    def test_as_attachment_encodes_filename(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig", "as_attachment": True})
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.return_value = _delivery(
            mime_type="application/pdf",
            name="报告.pdf",
            extension="pdf",
        )

        response = unwrap(module.FilePreviewApi().get)("file-id")

        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"
        assert response.headers["Content-Type"] == "application/octet-stream"

    @patch.object(module, "application_services")
    def test_not_found(self, mock_application_services):
        module.request = _fake_request({"timestamp": "123", "nonce": "abc", "sign": "sig", "as_attachment": False})
        mock_application_services.return_value.upload_file_delivery.get_signed_file_preview.side_effect = (
            UploadFileDeliveryNotFoundError("File not found or signature is invalid")
        )

        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            unwrap(module.FilePreviewApi().get)("file-id")


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
