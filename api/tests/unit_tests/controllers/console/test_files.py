import io
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from constants import DOCUMENT_EXTENSIONS
from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.files import (
    FileApi,
    FilePreviewApi,
    FileSupportTypeApi,
)


def unwrap(func):
    """
    Recursively unwrap decorated functions.
    """
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app():
    app = Flask(__name__)
    app.testing = True
    return app


@pytest.fixture(autouse=True)
def mock_decorators():
    """
    Make decorators no-ops so logic is directly testable
    """
    with (
        patch("controllers.console.files.setup_required", new=lambda f: f),
        patch("controllers.console.files.login_required", new=lambda f: f),
        patch("controllers.console.files.account_initialization_required", new=lambda f: f),
        patch("controllers.console.files.cloud_edition_billing_resource_check", return_value=lambda f: f),
    ):
        yield


@pytest.fixture
def mock_current_user():
    user = MagicMock()
    user.is_dataset_editor = True
    return user


@pytest.fixture
def mock_account_context(mock_current_user):
    with patch(
        "controllers.console.files.current_account_with_tenant",
        return_value=(mock_current_user, None),
    ):
        yield


@pytest.fixture
def mock_db():
    with patch("controllers.console.files.db") as db_mock:
        db_mock.engine = MagicMock()
        yield db_mock


@pytest.fixture
def mock_file_service(mock_db):
    with patch("controllers.console.files.FileService") as fs:
        instance = fs.return_value
        yield instance


class TestFileApiGet:
    def test_get_upload_config(self, app):
        api = FileApi()
        get_method = unwrap(api.get)

        with app.test_request_context():
            data, status = get_method(api)

        assert status == 200
        assert "file_size_limit" in data
        assert "batch_count_limit" in data


class TestFileApiPost:
    def test_no_file_uploaded(self, app, mock_account_context):
        api = FileApi()
        post_method = unwrap(api.post)

        with app.test_request_context(method="POST", data={}):
            with pytest.raises(NoFileUploadedError):
                post_method(api)

    def test_too_many_files(self, app, mock_account_context):
        api = FileApi()
        post_method = unwrap(api.post)

        with app.test_request_context(method="POST"):
            from unittest.mock import MagicMock, patch

            with patch("controllers.console.files.request") as mock_request:
                mock_request.files = MagicMock()
                mock_request.files.__len__.return_value = 2
                mock_request.files.__contains__.return_value = True
                mock_request.form = MagicMock()
                mock_request.form.get.return_value = None

                with pytest.raises(TooManyFilesError):
                    post_method(api)

    def test_filename_missing(self, app, mock_account_context):
        api = FileApi()
        post_method = unwrap(api.post)

        data = {
            "file": (io.BytesIO(b"abc"), ""),
        }

        with app.test_request_context(method="POST", data=data):
            with pytest.raises(FilenameNotExistsError):
                post_method(api)

    def test_dataset_upload_without_permission(self, app, mock_current_user):
        mock_current_user.is_dataset_editor = False

        with patch(
            "controllers.console.files.current_account_with_tenant",
            return_value=(mock_current_user, None),
        ):
            api = FileApi()
            post_method = unwrap(api.post)

            data = {
                "file": (io.BytesIO(b"abc"), "test.txt"),
                "source": "datasets",
            }

            with app.test_request_context(method="POST", data=data):
                with pytest.raises(Forbidden):
                    post_method(api)

    def test_successful_upload(self, app, mock_account_context, mock_file_service):
        api = FileApi()
        post_method = unwrap(api.post)

        mock_file = MagicMock()
        mock_file.id = "file-id-123"
        mock_file.filename = "test.txt"
        mock_file.name = "test.txt"
        mock_file.size = 1024
        mock_file.extension = "txt"
        mock_file.mime_type = "text/plain"
        mock_file.created_by = "user-123"
        mock_file.created_at = 1234567890
        mock_file.preview_url = "http://example.com/preview/file-id-123"
        mock_file.source_url = "http://example.com/source/file-id-123"
        mock_file.original_url = None
        mock_file.user_id = "user-123"
        mock_file.tenant_id = "tenant-123"
        mock_file.conversation_id = None
        mock_file.file_key = "file-key-123"

        mock_file_service.upload_file.return_value = mock_file

        data = {
            "file": (io.BytesIO(b"hello"), "test.txt"),
        }

        with app.test_request_context(method="POST", data=data):
            response, status = post_method(api)

        assert status == 201
        assert response["id"] == "file-id-123"
        assert response["name"] == "test.txt"

    def test_upload_with_invalid_source(self, app, mock_account_context, mock_file_service):
        """Test that invalid source parameter gets normalized to None"""
        api = FileApi()
        post_method = unwrap(api.post)

        # Create a properly structured mock file object
        mock_file = MagicMock()
        mock_file.id = "file-id-456"
        mock_file.filename = "test.txt"
        mock_file.name = "test.txt"
        mock_file.size = 512
        mock_file.extension = "txt"
        mock_file.mime_type = "text/plain"
        mock_file.created_by = "user-456"
        mock_file.created_at = 1234567890
        mock_file.preview_url = None
        mock_file.source_url = None
        mock_file.original_url = None
        mock_file.user_id = "user-456"
        mock_file.tenant_id = "tenant-456"
        mock_file.conversation_id = None
        mock_file.file_key = "file-key-456"

        mock_file_service.upload_file.return_value = mock_file

        data = {
            "file": (io.BytesIO(b"content"), "test.txt"),
            "source": "invalid_source",  # Should be normalized to None
        }

        with app.test_request_context(method="POST", data=data):
            response, status = post_method(api)

        assert status == 201
        assert response["id"] == "file-id-456"
        # Verify that FileService was called with source=None
        mock_file_service.upload_file.assert_called_once()
        call_kwargs = mock_file_service.upload_file.call_args[1]
        assert call_kwargs["source"] is None

    def test_file_too_large_error(self, app, mock_account_context, mock_file_service):
        api = FileApi()
        post_method = unwrap(api.post)

        from services.errors.file import FileTooLargeError as ServiceFileTooLargeError

        error = ServiceFileTooLargeError("File is too large")
        mock_file_service.upload_file.side_effect = error

        data = {
            "file": (io.BytesIO(b"x" * 1000000), "big.txt"),
        }

        with app.test_request_context(method="POST", data=data):
            with pytest.raises(FileTooLargeError):
                post_method(api)

    def test_unsupported_file_type(self, app, mock_account_context, mock_file_service):
        api = FileApi()
        post_method = unwrap(api.post)

        from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError

        error = ServiceUnsupportedFileTypeError()
        mock_file_service.upload_file.side_effect = error

        data = {
            "file": (io.BytesIO(b"x"), "bad.exe"),
        }

        with app.test_request_context(method="POST", data=data):
            with pytest.raises(UnsupportedFileTypeError):
                post_method(api)

    def test_blocked_extension(self, app, mock_account_context, mock_file_service):
        api = FileApi()
        post_method = unwrap(api.post)

        from services.errors.file import BlockedFileExtensionError as ServiceBlockedFileExtensionError

        error = ServiceBlockedFileExtensionError("File extension is blocked")
        mock_file_service.upload_file.side_effect = error

        data = {
            "file": (io.BytesIO(b"x"), "blocked.txt"),
        }

        with app.test_request_context(method="POST", data=data):
            with pytest.raises(BlockedFileExtensionError):
                post_method(api)


class TestFilePreviewApi:
    def test_get_preview(self, app, mock_file_service):
        api = FilePreviewApi()
        get_method = unwrap(api.get)
        mock_file_service.get_file_preview.return_value = "preview text"

        with app.test_request_context():
            result = get_method(api, "1234")

        assert result == {"content": "preview text"}


class TestFileSupportTypeApi:
    def test_get_supported_types(self, app):
        api = FileSupportTypeApi()
        get_method = unwrap(api.get)

        with app.test_request_context():
            result = get_method(api)

        assert result == {"allowed_extensions": list(DOCUMENT_EXTENSIONS)}
