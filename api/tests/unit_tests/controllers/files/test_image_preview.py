import types
from unittest.mock import patch

import pytest
from werkzeug.exceptions import NotFound

import controllers.files.image_preview as module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture(autouse=True)
def mock_db():
    """
    Replace Flask-SQLAlchemy db with a plain object
    to avoid touching Flask app context entirely.
    """
    fake_db = types.SimpleNamespace(engine=object())
    module.db = fake_db


class DummyUploadFile:
    def __init__(self, mime_type="text/plain", size=10, name="test.txt", extension="txt"):
        self.mime_type = mime_type
        self.size = size
        self.name = name
        self.extension = extension


def fake_request(args: dict):
    """Return a fake request object (NOT a Flask LocalProxy)."""
    return types.SimpleNamespace(args=types.SimpleNamespace(to_dict=lambda flat=True: args))


class TestImagePreviewApi:
    @patch.object(module, "FileService")
    def test_success(self, mock_file_service):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
            }
        )

        generator = iter([b"img"])
        mock_file_service.return_value.get_image_preview.return_value = (
            generator,
            "image/png",
        )

        api = module.ImagePreviewApi()
        get_fn = unwrap(api.get)

        response = get_fn("file-id")

        assert response.mimetype == "image/png"

    @patch.object(module, "FileService")
    def test_unsupported_file_type(self, mock_file_service):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
            }
        )

        mock_file_service.return_value.get_image_preview.side_effect = (
            module.services.errors.file.UnsupportedFileTypeError()
        )

        api = module.ImagePreviewApi()
        get_fn = unwrap(api.get)

        with pytest.raises(module.UnsupportedFileTypeError):
            get_fn("file-id")


class TestFilePreviewApi:
    @patch.object(module, "enforce_download_for_html")
    @patch.object(module, "FileService")
    def test_basic_stream(self, mock_file_service, mock_enforce):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            }
        )

        generator = iter([b"data"])
        upload_file = DummyUploadFile(size=100)

        mock_file_service.return_value.get_file_generator_by_file_id.return_value = (
            generator,
            upload_file,
        )

        api = module.FilePreviewApi()
        get_fn = unwrap(api.get)

        response = get_fn("file-id")

        assert response.mimetype == "text/plain"
        assert response.headers["Content-Length"] == "100"
        assert "Accept-Ranges" not in response.headers
        mock_enforce.assert_called_once()

    @patch.object(module, "enforce_download_for_html")
    @patch.object(module, "FileService")
    def test_as_attachment(self, mock_file_service, mock_enforce):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": True,
            }
        )

        generator = iter([b"data"])
        upload_file = DummyUploadFile(
            mime_type="application/pdf",
            name="doc.pdf",
            extension="pdf",
        )

        mock_file_service.return_value.get_file_generator_by_file_id.return_value = (
            generator,
            upload_file,
        )

        api = module.FilePreviewApi()
        get_fn = unwrap(api.get)

        response = get_fn("file-id")

        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.headers["Content-Type"] == "application/octet-stream"
        mock_enforce.assert_called_once()

    @patch.object(module, "FileService")
    def test_unsupported_file_type(self, mock_file_service):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            }
        )

        mock_file_service.return_value.get_file_generator_by_file_id.side_effect = (
            module.services.errors.file.UnsupportedFileTypeError()
        )

        api = module.FilePreviewApi()
        get_fn = unwrap(api.get)

        with pytest.raises(module.UnsupportedFileTypeError):
            get_fn("file-id")


class TestWorkspaceWebappLogoApi:
    @patch.object(module, "FileService")
    @patch.object(module.TenantService, "get_custom_config")
    def test_success(self, mock_config, mock_file_service):
        mock_config.return_value = {"replace_webapp_logo": "logo-id"}
        generator = iter([b"logo"])

        mock_file_service.return_value.get_public_image_preview.return_value = (
            generator,
            "image/png",
        )

        api = module.WorkspaceWebappLogoApi()
        get_fn = unwrap(api.get)

        response = get_fn("workspace-id")

        assert response.mimetype == "image/png"

    @patch.object(module.TenantService, "get_custom_config")
    def test_logo_not_configured(self, mock_config):
        mock_config.return_value = {}

        api = module.WorkspaceWebappLogoApi()
        get_fn = unwrap(api.get)

        with pytest.raises(NotFound):
            get_fn("workspace-id")

    @patch.object(module, "FileService")
    @patch.object(module.TenantService, "get_custom_config")
    def test_unsupported_file_type(self, mock_config, mock_file_service):
        mock_config.return_value = {"replace_webapp_logo": "logo-id"}
        mock_file_service.return_value.get_public_image_preview.side_effect = (
            module.services.errors.file.UnsupportedFileTypeError()
        )

        api = module.WorkspaceWebappLogoApi()
        get_fn = unwrap(api.get)

        with pytest.raises(module.UnsupportedFileTypeError):
            get_fn("workspace-id")
