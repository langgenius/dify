import io
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy import Engine
from werkzeug.exceptions import Forbidden

from configs import dify_config
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
    upload_file_from_request,
)
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.model import UploadFile
from tests.unit_tests.model_factories import make_upload_file


def unwrap(func):
    """
    Recursively unwrap decorated functions.
    """
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def _upload_file(*, file_id: str = "file-id-123", size: int = 1024) -> UploadFile:
    return make_upload_file(
        file_id=file_id,
        tenant_id="tenant-123",
        key=f"upload/{file_id}/test.txt",
        size=size,
        created_by="user-123",
    )


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
    user = Account(name="Test User", email="user-1@example.com", status=AccountStatus.ACTIVE)
    user.id = "user-1"
    user.role = TenantAccountRole.OWNER
    return user


@pytest.fixture
def mock_account_context(mock_current_user):
    return mock_current_user


@pytest.fixture
def mock_db(sqlite_engine: Engine):
    with patch("controllers.console.files.db") as db_mock:
        db_mock.engine = sqlite_engine
        yield db_mock


@pytest.fixture
def mock_file_service(mock_db):
    with patch("controllers.console.files.FileService") as fs:
        instance = fs.return_value
        yield instance


class TestFileApiGet:
    def test_get_upload_config(self, app: Flask):
        api = FileApi()
        get_method = unwrap(api.get)

        with (
            app.test_request_context(),
            patch(
                "controllers.console.files.FeatureService.get_knowledge_file_size_limit",
                return_value=50,
            ) as get_knowledge_file_size_limit,
        ):
            data, status = get_method(api, "tenant-1")

        assert status == 200
        assert "file_size_limit" in data
        assert data["knowledge_file_size_limit"] == 50
        assert "batch_count_limit" in data
        get_knowledge_file_size_limit.assert_called_once_with("tenant-1")
        assert data["skill_file_size_limit"] == dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT


class TestFileApiPost:
    def test_no_file_uploaded(self, app: Flask, mock_account_context):
        api = FileApi()
        post_method = unwrap(api.post)

        with app.test_request_context(method="POST", data={}):
            with pytest.raises(NoFileUploadedError):
                post_method(api, mock_account_context)

    def test_too_many_files(self, app: Flask, mock_account_context):
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
                    post_method(api, mock_account_context)

    def test_filename_missing(self, app: Flask, mock_account_context):
        api = FileApi()
        post_method = unwrap(api.post)

        data = {
            "file": (io.BytesIO(b"abc"), ""),
        }

        with app.test_request_context(method="POST", data=data):
            with pytest.raises(FilenameNotExistsError):
                post_method(api, mock_account_context)

    def test_dataset_upload_without_permission(self, app: Flask, mock_current_user):
        mock_current_user.role = TenantAccountRole.NORMAL

        api = FileApi()
        post_method = unwrap(api.post)

        data = {
            "file": (io.BytesIO(b"abc"), "test.txt"),
            "source": "datasets",
        }

        with app.test_request_context(method="POST", data=data):
            with pytest.raises(Forbidden):
                post_method(api, mock_current_user)

    def test_successful_upload(self, app: Flask, mock_account_context, mock_file_service):
        api = FileApi()
        post_method = unwrap(api.post)

        mock_file_service.upload_file.return_value = _upload_file()

        data = {
            "file": (io.BytesIO(b"hello"), "test.txt"),
        }

        with app.test_request_context(method="POST", data=data):
            response, status = post_method(api, mock_account_context)

        assert status == 201
        assert response["id"] == "file-id-123"
        assert response["name"] == "test.txt"

    def test_upload_with_resource_tenant(self, app: Flask, mock_account_context, mock_file_service):
        upload_file = _upload_file()
        mock_file_service.upload_file.return_value = upload_file

        with app.test_request_context(
            method="POST",
            data={"file": (io.BytesIO(b"hello"), "test.txt")},
        ):
            result = upload_file_from_request(
                current_user=mock_account_context,
                resource_tenant_id="app-tenant-id",
            )

        assert result is upload_file
        assert mock_file_service.upload_file.call_args.kwargs["tenant_id"] == "app-tenant-id"

    def test_dataset_source_from_query_uses_knowledge_limit(
        self,
        app: Flask,
        mock_account_context,
        mock_file_service,
    ):
        upload_file = _upload_file()
        mock_file_service.upload_file.return_value = upload_file

        with (
            app.test_request_context(
                "/?source=datasets",
                method="POST",
                data={"file": (io.BytesIO(b"hello"), "test.txt")},
            ),
            patch(
                "controllers.console.files.FeatureService.get_knowledge_file_size_limit",
                return_value=50,
            ) as get_knowledge_file_size_limit,
        ):
            result = upload_file_from_request(current_user=mock_account_context)

        assert result is upload_file
        assert mock_file_service.upload_file.call_args.kwargs["source"] == "datasets"
        assert mock_file_service.upload_file.call_args.kwargs["default_file_size_limit"] == 50
        get_knowledge_file_size_limit.assert_called_once_with(mock_account_context.current_tenant_id)

    def test_upload_with_invalid_source(self, app: Flask, mock_account_context, mock_file_service):
        """Test that invalid source parameter gets normalized to None"""
        api = FileApi()
        post_method = unwrap(api.post)

        mock_file_service.upload_file.return_value = _upload_file(file_id="file-id-456", size=512)

        data = {
            "file": (io.BytesIO(b"content"), "test.txt"),
            "source": "invalid_source",  # Should be normalized to None
        }

        with app.test_request_context(method="POST", data=data):
            response, status = post_method(api, mock_account_context)

        assert status == 201
        assert response["id"] == "file-id-456"
        # Verify that FileService was called with source=None
        mock_file_service.upload_file.assert_called_once()
        call_kwargs = mock_file_service.upload_file.call_args[1]
        assert call_kwargs["source"] is None

    def test_file_too_large_error(self, app: Flask, mock_account_context, mock_file_service):
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
                post_method(api, mock_account_context)

    def test_unsupported_file_type(self, app: Flask, mock_account_context, mock_file_service):
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
                post_method(api, mock_account_context)

    def test_blocked_extension(self, app: Flask, mock_account_context, mock_file_service):
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
                post_method(api, mock_account_context)


class TestFilePreviewApi:
    def test_get_preview(self, app: Flask, mock_account_context, mock_file_service):
        api = FilePreviewApi()
        get_method = unwrap(api.get)
        mock_file_service.get_file_preview.return_value = "preview text"

        with app.test_request_context():
            result = get_method(api, "tenant-123", "1234")

        assert result == {"content": "preview text"}


class TestFileSupportTypeApi:
    def test_get_supported_types(self, app: Flask):
        api = FileSupportTypeApi()
        get_method = unwrap(api.get)

        with app.test_request_context():
            result = get_method(api)

        assert result == {"allowed_extensions": list(DOCUMENT_EXTENSIONS)}
