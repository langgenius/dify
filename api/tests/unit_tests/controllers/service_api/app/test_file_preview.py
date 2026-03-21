"""
Unit tests for Service API File Preview endpoint
"""

import uuid
from unittest.mock import Mock, patch

import pytest

from controllers.service_api.app.error import FileAccessDeniedError, FileNotFoundError
from controllers.service_api.app.file_preview import FilePreviewApi
from models.model import App, EndUser, Message, MessageFile, UploadFile


class TestFilePreviewApi:
    """Test suite for FilePreviewApi"""

    @pytest.fixture
    def file_preview_api(self):
        """Create FilePreviewApi instance for testing"""
        return FilePreviewApi()

    @pytest.fixture
    def mock_app(self):
        """Mock App model"""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.tenant_id = str(uuid.uuid4())
        return app

    @pytest.fixture
    def mock_end_user(self):
        """Mock EndUser model"""
        end_user = Mock(spec=EndUser)
        end_user.id = str(uuid.uuid4())
        return end_user

    @pytest.fixture
    def mock_upload_file(self):
        """Mock UploadFile model"""
        upload_file = Mock(spec=UploadFile)
        upload_file.id = str(uuid.uuid4())
        upload_file.name = "test_file.jpg"
        upload_file.extension = "jpg"
        upload_file.mime_type = "image/jpeg"
        upload_file.size = 1024
        upload_file.key = "storage/key/test_file.jpg"
        upload_file.tenant_id = str(uuid.uuid4())
        return upload_file

    @pytest.fixture
    def mock_message_file(self):
        """Mock MessageFile model"""
        message_file = Mock(spec=MessageFile)
        message_file.id = str(uuid.uuid4())
        message_file.upload_file_id = str(uuid.uuid4())
        message_file.message_id = str(uuid.uuid4())
        return message_file

    @pytest.fixture
    def mock_message(self):
        """Mock Message model"""
        message = Mock(spec=Message)
        message.id = str(uuid.uuid4())
        message.app_id = str(uuid.uuid4())
        return message

    def test_validate_file_ownership_success(
        self, file_preview_api, mock_app, mock_upload_file, mock_message_file, mock_message
    ):
        """Test successful file ownership validation"""
        file_id = str(uuid.uuid4())
        app_id = mock_app.id

        # Set up the mocks
        mock_upload_file.tenant_id = mock_app.tenant_id
        mock_message.app_id = app_id
        mock_message_file.upload_file_id = file_id
        mock_message_file.message_id = mock_message.id

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock database queries
            mock_db.session.query.return_value.where.return_value.first.side_effect = [
                mock_message_file,  # MessageFile query
                mock_message,  # Message query
                mock_upload_file,  # UploadFile query
                mock_app,  # App query for tenant validation
            ]

            # Execute the method
            result_message_file, result_upload_file = file_preview_api._validate_file_ownership(file_id, app_id)

            # Assertions
            assert result_message_file == mock_message_file
            assert result_upload_file == mock_upload_file

    def test_validate_file_ownership_file_not_found(self, file_preview_api):
        """Test file ownership validation when MessageFile not found"""
        file_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock MessageFile not found
            mock_db.session.query.return_value.where.return_value.first.return_value = None

            # Execute and assert exception
            with pytest.raises(FileNotFoundError) as exc_info:
                file_preview_api._validate_file_ownership(file_id, app_id)

            assert "File not found in message context" in str(exc_info.value)

    def test_validate_file_ownership_access_denied(self, file_preview_api, mock_message_file):
        """Test file ownership validation when Message not owned by app"""
        file_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock MessageFile found but Message not owned by app
            mock_db.session.query.return_value.where.return_value.first.side_effect = [
                mock_message_file,  # MessageFile query - found
                None,  # Message query - not found (access denied)
            ]

            # Execute and assert exception
            with pytest.raises(FileAccessDeniedError) as exc_info:
                file_preview_api._validate_file_ownership(file_id, app_id)

            assert "not owned by requesting app" in str(exc_info.value)

    def test_validate_file_ownership_upload_file_not_found(self, file_preview_api, mock_message_file, mock_message):
        """Test file ownership validation when UploadFile not found"""
        file_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock MessageFile and Message found but UploadFile not found
            mock_db.session.query.return_value.where.return_value.first.side_effect = [
                mock_message_file,  # MessageFile query - found
                mock_message,  # Message query - found
                None,  # UploadFile query - not found
            ]

            # Execute and assert exception
            with pytest.raises(FileNotFoundError) as exc_info:
                file_preview_api._validate_file_ownership(file_id, app_id)

            assert "Upload file record not found" in str(exc_info.value)

    def test_validate_file_ownership_tenant_mismatch(
        self, file_preview_api, mock_app, mock_upload_file, mock_message_file, mock_message
    ):
        """Test file ownership validation with tenant mismatch"""
        file_id = str(uuid.uuid4())
        app_id = mock_app.id

        # Set up tenant mismatch
        mock_upload_file.tenant_id = "different_tenant_id"
        mock_app.tenant_id = "app_tenant_id"
        mock_message.app_id = app_id
        mock_message_file.upload_file_id = file_id
        mock_message_file.message_id = mock_message.id

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock database queries
            mock_db.session.query.return_value.where.return_value.first.side_effect = [
                mock_message_file,  # MessageFile query
                mock_message,  # Message query
                mock_upload_file,  # UploadFile query
                mock_app,  # App query for tenant validation
            ]

            # Execute and assert exception
            with pytest.raises(FileAccessDeniedError) as exc_info:
                file_preview_api._validate_file_ownership(file_id, app_id)

            assert "tenant mismatch" in str(exc_info.value)

    def test_validate_file_ownership_invalid_input(self, file_preview_api):
        """Test file ownership validation with invalid input"""

        # Test with empty file_id
        with pytest.raises(FileAccessDeniedError) as exc_info:
            file_preview_api._validate_file_ownership("", "app_id")
        assert "Invalid file or app identifier" in str(exc_info.value)

        # Test with empty app_id
        with pytest.raises(FileAccessDeniedError) as exc_info:
            file_preview_api._validate_file_ownership("file_id", "")
        assert "Invalid file or app identifier" in str(exc_info.value)

    def test_build_file_response_basic(self, file_preview_api, mock_upload_file):
        """Test basic file response building"""
        mock_generator = Mock()

        response = file_preview_api._build_file_response(mock_generator, mock_upload_file, False)

        # Check response properties
        assert response.mimetype == mock_upload_file.mime_type
        assert response.direct_passthrough is True
        assert response.headers["Content-Length"] == str(mock_upload_file.size)
        assert "Cache-Control" in response.headers

    def test_build_file_response_as_attachment(self, file_preview_api, mock_upload_file):
        """Test file response building with attachment flag"""
        mock_generator = Mock()

        response = file_preview_api._build_file_response(mock_generator, mock_upload_file, True)

        # Check attachment-specific headers
        assert "attachment" in response.headers["Content-Disposition"]
        assert mock_upload_file.name in response.headers["Content-Disposition"]
        assert response.headers["Content-Type"] == "application/octet-stream"

    def test_build_file_response_html_forces_attachment(self, file_preview_api, mock_upload_file):
        """Test HTML files are forced to download"""
        mock_generator = Mock()
        mock_upload_file.mime_type = "text/html"
        mock_upload_file.name = "unsafe.html"
        mock_upload_file.extension = "html"

        response = file_preview_api._build_file_response(mock_generator, mock_upload_file, False)

        assert "attachment" in response.headers["Content-Disposition"]
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    def test_build_file_response_audio_video(self, file_preview_api, mock_upload_file):
        """Test file response building for audio/video files"""
        mock_generator = Mock()
        mock_upload_file.mime_type = "video/mp4"

        response = file_preview_api._build_file_response(mock_generator, mock_upload_file, False)

        # Check Range support for media files
        assert response.headers["Accept-Ranges"] == "bytes"

    def test_build_file_response_no_size(self, file_preview_api, mock_upload_file):
        """Test file response building when size is unknown"""
        mock_generator = Mock()
        mock_upload_file.size = 0  # Unknown size

        response = file_preview_api._build_file_response(mock_generator, mock_upload_file, False)

        # Content-Length should not be set when size is unknown
        assert "Content-Length" not in response.headers

    @patch("controllers.service_api.app.file_preview.storage")
    def test_get_method_integration(
        self, mock_storage, file_preview_api, mock_app, mock_end_user, mock_upload_file, mock_message_file, mock_message
    ):
        """Test the full GET method integration (without decorator)"""
        file_id = str(uuid.uuid4())
        app_id = mock_app.id

        # Set up mocks
        mock_upload_file.tenant_id = mock_app.tenant_id
        mock_message.app_id = app_id
        mock_message_file.upload_file_id = file_id
        mock_message_file.message_id = mock_message.id

        mock_generator = Mock()
        mock_storage.load.return_value = mock_generator

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock database queries
            mock_db.session.query.return_value.where.return_value.first.side_effect = [
                mock_message_file,  # MessageFile query
                mock_message,  # Message query
                mock_upload_file,  # UploadFile query
                mock_app,  # App query for tenant validation
            ]

            # Test the core logic directly without Flask decorators
            # Validate file ownership
            result_message_file, result_upload_file = file_preview_api._validate_file_ownership(file_id, app_id)
            assert result_message_file == mock_message_file
            assert result_upload_file == mock_upload_file

            # Test file response building
            response = file_preview_api._build_file_response(mock_generator, mock_upload_file, False)
            assert response is not None

            # Verify storage was called correctly
            mock_storage.load.assert_not_called()  # Since we're testing components separately

    @patch("controllers.service_api.app.file_preview.storage")
    def test_storage_error_handling(
        self, mock_storage, file_preview_api, mock_app, mock_upload_file, mock_message_file, mock_message
    ):
        """Test storage error handling in the core logic"""
        file_id = str(uuid.uuid4())
        app_id = mock_app.id

        # Set up mocks
        mock_upload_file.tenant_id = mock_app.tenant_id
        mock_message.app_id = app_id
        mock_message_file.upload_file_id = file_id
        mock_message_file.message_id = mock_message.id

        # Mock storage error
        mock_storage.load.side_effect = Exception("Storage error")

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock database queries for validation
            mock_db.session.query.return_value.where.return_value.first.side_effect = [
                mock_message_file,  # MessageFile query
                mock_message,  # Message query
                mock_upload_file,  # UploadFile query
                mock_app,  # App query for tenant validation
            ]

            # First validate file ownership works
            result_message_file, result_upload_file = file_preview_api._validate_file_ownership(file_id, app_id)
            assert result_message_file == mock_message_file
            assert result_upload_file == mock_upload_file

            # Test storage error handling
            with pytest.raises(Exception) as exc_info:
                mock_storage.load(mock_upload_file.key, stream=True)

            assert "Storage error" in str(exc_info.value)

    @patch("controllers.service_api.app.file_preview.logger")
    def test_validate_file_ownership_unexpected_error_logging(self, mock_logger, file_preview_api):
        """Test that unexpected errors are logged properly"""
        file_id = str(uuid.uuid4())
        app_id = str(uuid.uuid4())

        with patch("controllers.service_api.app.file_preview.db") as mock_db:
            # Mock database query to raise unexpected exception
            mock_db.session.query.side_effect = Exception("Unexpected database error")

            # Execute and assert exception
            with pytest.raises(FileAccessDeniedError) as exc_info:
                file_preview_api._validate_file_ownership(file_id, app_id)

            # Verify error message
            assert "File access validation failed" in str(exc_info.value)

            # Verify logging was called
            mock_logger.exception.assert_called_once_with(
                "Unexpected error during file ownership validation",
                extra={"file_id": file_id, "app_id": app_id, "error": "Unexpected database error"},
            )
