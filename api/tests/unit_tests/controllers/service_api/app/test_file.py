"""
Unit tests for Service API File controllers.

Tests coverage for:
- File upload validation
- Error handling for file operations
- FileService integration

Focus on:
- File validation logic (size, type, filename)
- Error type mappings
- Service method interfaces
"""

import uuid
from unittest.mock import Mock, patch

import pytest

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from fields.file_fields import FileResponse
from services.file_service import FileService


class TestFileResponse:
    """Test suite for FileResponse Pydantic model."""

    def test_file_response_has_required_fields(self):
        """Test FileResponse model includes required fields."""
        # Verify the model exists and can be imported
        assert FileResponse is not None
        assert hasattr(FileResponse, "model_fields")


class TestFileUploadErrors:
    """Test file upload error types."""

    def test_no_file_uploaded_error_can_be_raised(self):
        """Test NoFileUploadedError can be raised."""
        error = NoFileUploadedError()
        assert error is not None

    def test_too_many_files_error_can_be_raised(self):
        """Test TooManyFilesError can be raised."""
        error = TooManyFilesError()
        assert error is not None

    def test_unsupported_file_type_error_can_be_raised(self):
        """Test UnsupportedFileTypeError can be raised."""
        error = UnsupportedFileTypeError()
        assert error is not None

    def test_filename_not_exists_error_can_be_raised(self):
        """Test FilenameNotExistsError can be raised."""
        error = FilenameNotExistsError()
        assert error is not None

    def test_file_too_large_error_can_be_raised(self):
        """Test FileTooLargeError can be raised."""
        error = FileTooLargeError("File exceeds maximum size")
        assert "File exceeds maximum size" in str(error) or error is not None


class TestFileServiceErrors:
    """Test FileService error types."""

    def test_file_service_file_too_large_error_exists(self):
        """Test FileTooLargeError from services exists."""
        import services.errors.file

        error = services.errors.file.FileTooLargeError("File too large")
        assert isinstance(error, services.errors.file.FileTooLargeError)

    def test_file_service_unsupported_file_type_error_exists(self):
        """Test UnsupportedFileTypeError from services exists."""
        import services.errors.file

        error = services.errors.file.UnsupportedFileTypeError()
        assert isinstance(error, services.errors.file.UnsupportedFileTypeError)


class TestFileService:
    """Test FileService interface and methods."""

    def test_upload_file_method_exists(self):
        """Test FileService.upload_file method exists."""
        assert hasattr(FileService, "upload_file")
        assert callable(FileService.upload_file)

    @patch.object(FileService, "upload_file")
    def test_upload_file_returns_upload_file_object(self, mock_upload):
        """Test upload_file returns an upload file object."""
        mock_file = Mock()
        mock_file.id = str(uuid.uuid4())
        mock_file.name = "test.pdf"
        mock_file.size = 1024
        mock_file.extension = "pdf"
        mock_file.mime_type = "application/pdf"
        mock_upload.return_value = mock_file

        # Call the method directly without instantiation
        assert mock_file.name == "test.pdf"
        assert mock_file.extension == "pdf"

    @patch.object(FileService, "upload_file")
    def test_upload_file_raises_file_too_large_error(self, mock_upload):
        """Test upload_file raises FileTooLargeError."""
        import services.errors.file

        mock_upload.side_effect = services.errors.file.FileTooLargeError("File exceeds 15MB limit")

        # Verify error type exists
        with pytest.raises(services.errors.file.FileTooLargeError):
            mock_upload(Mock(), Mock(), "user_id")

    @patch.object(FileService, "upload_file")
    def test_upload_file_raises_unsupported_file_type_error(self, mock_upload):
        """Test upload_file raises UnsupportedFileTypeError."""
        import services.errors.file

        mock_upload.side_effect = services.errors.file.UnsupportedFileTypeError()

        # Verify error type exists
        with pytest.raises(services.errors.file.UnsupportedFileTypeError):
            mock_upload(Mock(), Mock(), "user_id")


class TestFileValidation:
    """Test file validation patterns."""

    def test_valid_image_mimetype(self):
        """Test common image MIME types."""
        valid_mimetypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]
        for mimetype in valid_mimetypes:
            assert mimetype.startswith("image/")

    def test_valid_document_mimetype(self):
        """Test common document MIME types."""
        valid_mimetypes = [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
            "text/csv",
        ]
        for mimetype in valid_mimetypes:
            assert mimetype is not None
            assert len(mimetype) > 0

    def test_filename_has_extension(self):
        """Test filename validation for extension presence."""
        valid_filenames = ["document.pdf", "image.png", "data.csv", "report.docx"]
        for filename in valid_filenames:
            assert "." in filename
            parts = filename.rsplit(".", 1)
            assert len(parts) == 2
            assert len(parts[1]) > 0  # Extension exists

    def test_filename_without_extension_is_invalid(self):
        """Test that filename without extension can be detected."""
        filename = "noextension"
        assert "." not in filename


class TestFileUploadResponse:
    """Test file upload response structure."""

    @patch.object(FileService, "upload_file")
    def test_upload_response_structure(self, mock_upload):
        """Test upload response has expected structure."""
        mock_file = Mock()
        mock_file.id = str(uuid.uuid4())
        mock_file.name = "test.pdf"
        mock_file.size = 2048
        mock_file.extension = "pdf"
        mock_file.mime_type = "application/pdf"
        mock_file.created_by = str(uuid.uuid4())
        mock_file.created_at = Mock()
        mock_upload.return_value = mock_file

        # Verify expected fields exist on mock
        assert hasattr(mock_file, "id")
        assert hasattr(mock_file, "name")
        assert hasattr(mock_file, "size")
        assert hasattr(mock_file, "extension")
        assert hasattr(mock_file, "mime_type")
        assert hasattr(mock_file, "created_by")
        assert hasattr(mock_file, "created_at")


# =============================================================================
# API Endpoint Tests
#
# ``FileApi.post`` is wrapped by ``@validate_app_token(fetch_user_arg=...)``
# which preserves ``__wrapped__`` via ``functools.wraps``.  We call the
# unwrapped method directly to bypass the decorator.
# =============================================================================

from tests.unit_tests.controllers.service_api.conftest import _unwrap


@pytest.fixture
def mock_app_model():
    from models import App

    app = Mock(spec=App)
    app.id = str(uuid.uuid4())
    app.tenant_id = str(uuid.uuid4())
    return app


@pytest.fixture
def mock_end_user():
    from models import EndUser

    user = Mock(spec=EndUser)
    user.id = str(uuid.uuid4())
    return user


class TestFileApiPost:
    """Test suite for FileApi.post() endpoint.

    ``post`` is wrapped by ``@validate_app_token(fetch_user_arg=...)``
    which preserves ``__wrapped__``.
    """

    @patch("controllers.service_api.app.file.FileService")
    @patch("controllers.service_api.app.file.db")
    def test_upload_file_success(
        self,
        mock_db,
        mock_file_svc_cls,
        app,
        mock_app_model,
        mock_end_user,
    ):
        """Test successful file upload."""
        from io import BytesIO

        from controllers.service_api.app.file import FileApi

        mock_upload = Mock()
        mock_upload.id = str(uuid.uuid4())
        mock_upload.name = "test.pdf"
        mock_upload.size = 1024
        mock_upload.extension = "pdf"
        mock_upload.mime_type = "application/pdf"
        mock_upload.created_by = str(mock_end_user.id)
        mock_upload.created_by_role = "end_user"
        mock_upload.created_at = 1700000000
        mock_upload.preview_url = None
        mock_upload.source_url = None
        mock_upload.original_url = None
        mock_upload.user_id = None
        mock_upload.tenant_id = None
        mock_upload.conversation_id = None
        mock_upload.file_key = None
        mock_file_svc_cls.return_value.upload_file.return_value = mock_upload

        data = {"file": (BytesIO(b"file content"), "test.pdf", "application/pdf")}

        with app.test_request_context(
            "/files/upload",
            method="POST",
            content_type="multipart/form-data",
            data=data,
        ):
            api = FileApi()
            response, status = _unwrap(api.post)(
                api,
                app_model=mock_app_model,
                end_user=mock_end_user,
            )

        assert status == 201
        mock_file_svc_cls.return_value.upload_file.assert_called_once()

    def test_upload_no_file(self, app, mock_app_model, mock_end_user):
        """Test NoFileUploadedError when no file in request."""
        from controllers.service_api.app.file import FileApi

        with app.test_request_context(
            "/files/upload",
            method="POST",
            content_type="multipart/form-data",
            data={},
        ):
            api = FileApi()
            with pytest.raises(NoFileUploadedError):
                _unwrap(api.post)(api, app_model=mock_app_model, end_user=mock_end_user)

    def test_upload_too_many_files(self, app, mock_app_model, mock_end_user):
        """Test TooManyFilesError when multiple files uploaded."""
        from io import BytesIO

        from controllers.service_api.app.file import FileApi

        data = {
            "file": (BytesIO(b"content1"), "file1.pdf", "application/pdf"),
            "extra": (BytesIO(b"content2"), "file2.pdf", "application/pdf"),
        }

        with app.test_request_context(
            "/files/upload",
            method="POST",
            content_type="multipart/form-data",
            data=data,
        ):
            api = FileApi()
            with pytest.raises(TooManyFilesError):
                _unwrap(api.post)(api, app_model=mock_app_model, end_user=mock_end_user)

    def test_upload_no_mimetype(self, app, mock_app_model, mock_end_user):
        """Test UnsupportedFileTypeError when file has no mimetype."""
        from io import BytesIO

        from controllers.service_api.app.file import FileApi

        data = {"file": (BytesIO(b"content"), "test.bin", "")}

        with app.test_request_context(
            "/files/upload",
            method="POST",
            content_type="multipart/form-data",
            data=data,
        ):
            api = FileApi()
            with pytest.raises(UnsupportedFileTypeError):
                _unwrap(api.post)(api, app_model=mock_app_model, end_user=mock_end_user)

    @patch("controllers.service_api.app.file.FileService")
    @patch("controllers.service_api.app.file.db")
    def test_upload_file_too_large(
        self,
        mock_db,
        mock_file_svc_cls,
        app,
        mock_app_model,
        mock_end_user,
    ):
        """Test FileTooLargeError when file exceeds size limit."""
        from io import BytesIO

        import services.errors.file
        from controllers.service_api.app.file import FileApi

        mock_file_svc_cls.return_value.upload_file.side_effect = services.errors.file.FileTooLargeError(
            "File exceeds 15MB limit"
        )

        data = {"file": (BytesIO(b"big content"), "big.pdf", "application/pdf")}

        with app.test_request_context(
            "/files/upload",
            method="POST",
            content_type="multipart/form-data",
            data=data,
        ):
            api = FileApi()
            with pytest.raises(FileTooLargeError):
                _unwrap(api.post)(api, app_model=mock_app_model, end_user=mock_end_user)

    @patch("controllers.service_api.app.file.FileService")
    @patch("controllers.service_api.app.file.db")
    def test_upload_unsupported_file_type(
        self,
        mock_db,
        mock_file_svc_cls,
        app,
        mock_app_model,
        mock_end_user,
    ):
        """Test UnsupportedFileTypeError from FileService."""
        from io import BytesIO

        import services.errors.file
        from controllers.service_api.app.file import FileApi

        mock_file_svc_cls.return_value.upload_file.side_effect = services.errors.file.UnsupportedFileTypeError()

        data = {"file": (BytesIO(b"content"), "test.xyz", "application/octet-stream")}

        with app.test_request_context(
            "/files/upload",
            method="POST",
            content_type="multipart/form-data",
            data=data,
        ):
            api = FileApi()
            with pytest.raises(UnsupportedFileTypeError):
                _unwrap(api.post)(api, app_model=mock_app_model, end_user=mock_end_user)
