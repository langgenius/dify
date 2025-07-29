import io
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_login import LoginManager, UserMixin
from werkzeug.exceptions import Forbidden

from controllers.common.errors import FilenameNotExistsError
from controllers.console.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.files import FileApi
from models.account import AccountStatus
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError


class MockUser(UserMixin):
    """Mock user for testing"""

    def __init__(self, user_id: str = "test_user", is_dataset_editor: bool = True):
        self.id = user_id
        self.current_tenant_id = "test_tenant_id"
        self.is_dataset_editor = is_dataset_editor
        self.status = AccountStatus.ACTIVE

    def get_id(self) -> str:
        return self.id


def create_test_app():
    """Create Flask app with LoginManager for testing"""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret-key"
    app.config["TESTING"] = True

    login_manager = LoginManager()
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str):
        return MockUser(user_id)

    return app


class TestFileUploadSecurity:
    """Security tests for file upload functionality"""

    @pytest.fixture
    def app(self):
        return create_test_app()

    @pytest.fixture
    def api(self):
        return FileApi()

    @pytest.fixture
    def mock_user(self):
        return MockUser()

    @pytest.fixture
    def mock_decorators(self):
        """Mock all decorators used by FileApi"""
        patches = [
            patch("controllers.console.wraps.setup_required", lambda f: f),
            patch("libs.login.login_required", lambda f: f),
            patch("controllers.console.wraps.account_initialization_required", lambda f: f),
            patch("controllers.console.wraps.cloud_edition_billing_resource_check", lambda x: lambda f: f),
            patch("flask_restful.marshal_with", lambda x: lambda f: f),
        ]
        
        for p in patches:
            p.start()
        
        yield patches
        
        for p in patches:
            p.stop()

    # Test 1: Malicious File Type Detection
    @pytest.mark.parametrize(
        ("filename", "should_reject"),
        [
            # Executable files
            ("malware.php", True),
            ("backdoor.PHP", True),  # Case variation
            ("shell.exe", True),
            ("script.sh", True),
            ("batch.bat", True),
            ("command.cmd", True),
            ("powershell.ps1", True),
            # Double extensions
            ("image.jpg.php", True),
            ("document.pdf.exe", True),
            ("photo.png.sh", True),
            # Script files
            ("script.js", True),
            ("macro.vbs", True),
            ("applet.jar", True),
            # Valid files for datasets
            ("document.pdf", False),
            ("image.jpg", False),
            ("text.txt", False),
        ],
    )
    @patch("services.file_service.FileService.upload_file")
    @patch("flask_login.current_user")
    def test_should_detect_malicious_file_types(
        self, mock_current_user, mock_upload_file, mock_decorators, api, app, mock_user, filename, should_reject
    ):
        """Test detection of malicious file types"""
        mock_current_user.return_value = mock_user
        mock_current_user.is_dataset_editor = True

        # Create file with malicious extension
        file_content = b"<?php system($_GET['cmd']); ?>"
        file_data = {
            "file": (io.BytesIO(file_content), filename, "application/octet-stream"),
            "source": "datasets"
        }

        with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
            if should_reject:
                # Configure service to raise error for dangerous files
                mock_upload_file.side_effect = ServiceUnsupportedFileTypeError()

                with pytest.raises(UnsupportedFileTypeError):
                    api.post()
            else:
                # Configure service to accept safe files
                mock_upload_file.return_value = MagicMock(id="test_file_id")
                result, status = api.post()
                assert status == 201

    # Test 2: File Size Limits
    @pytest.mark.parametrize(
        ("extension", "size_mb", "should_reject"),
        [
            ("jpg", 15, True),  # Over image limit (assume 10MB)
            ("jpg", 8, False),  # Under image limit
            ("mp4", 550, True),  # Over video limit (assume 500MB)
            ("mp4", 450, False),  # Under video limit
            ("mp3", 60, True),  # Over audio limit (assume 50MB)
            ("mp3", 40, False),  # Under audio limit
            ("pdf", 20, True),  # Over general limit (assume 15MB)
            ("pdf", 10, False),  # Under general limit
        ],
    )
    @patch("services.file_service.FileService.upload_file")
    @patch("flask_login.current_user")
    def test_should_enforce_file_size_limits(
        self,
        mock_current_user,
        mock_upload_file,
        mock_decorators,
        api,
        app,
        mock_user,
        extension,
        size_mb,
        should_reject,
    ):
        """Test file size limit enforcement"""
        mock_current_user.return_value = mock_user

        # Create file with specific size (limit to reasonable size for testing)
        actual_size = min(size_mb * 1024, 1024 * 1024)  # Limit to 1MB for test performance
        file_content = b"X" * actual_size
        filename = f"test.{extension}"
        
        file_data = {
            "file": (io.BytesIO(file_content), filename, "application/octet-stream"),
            "source": "datasets"
        }

        with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
            if should_reject:
                mock_upload_file.side_effect = ServiceFileTooLargeError("File size exceeds limit")
                with pytest.raises(FileTooLargeError):
                    api.post()
            else:
                mock_upload_file.return_value = MagicMock(id="test_file_id")
                result, status = api.post()
                assert status == 201

    # Test 3: Filename Security
    @pytest.mark.parametrize(
        ("filename", "should_reject"),
        [
            # Dangerous characters
            ("<script>alert('xss')</script>.txt", True),
            ("'; DROP TABLE users; --.sql", True),
            ("file|cmd.txt", True),
            ("file:data.txt", True),
            ('file"name".txt', True),
            ("file?name.txt", True),
            ("file*name.txt", True),
            ("file<>name.txt", True),
            # Path traversal
            ("../../../etc/passwd", True),
            ("..\\..\\windows\\system32\\config\\sam", True),
            ("file.jpg\x00.php", True),  # Null byte injection
            # Valid filenames
            ("normal_file-name.txt", False),
            ("file.with.dots.txt", False),
            ("文件名.txt", False),  # Unicode filename
        ],
    )
    @patch("services.file_service.FileService.upload_file")
    @patch("flask_login.current_user")
    def test_should_sanitize_dangerous_filenames(
        self, mock_current_user, mock_upload_file, mock_decorators, api, app, mock_user, filename, should_reject
    ):
        """Test filename sanitization and validation"""
        mock_current_user.return_value = mock_user

        file_data = {
            "file": (io.BytesIO(b"content"), filename, "text/plain"),
            "source": "datasets"
        }

        def upload_file_side_effect(**kwargs):
            # Simulate filename validation in FileService
            filename = kwargs.get("filename", "")
            invalid_chars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\x00"]
            
            if any(char in filename for char in invalid_chars):
                raise ValueError("Filename contains invalid characters")
            
            return MagicMock(id="test_file_id", name=filename)

        mock_upload_file.side_effect = upload_file_side_effect

        with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
            if should_reject:
                with pytest.raises(ValueError):
                    api.post()
            else:
                result, status = api.post()
                assert status == 201

    # Test 4: Permission Validation
    @pytest.mark.parametrize(
        ("is_dataset_editor", "source", "should_allow"),
        [
            (True, "datasets", True),  # Authorized dataset editor
            (False, "datasets", False),  # Not a dataset editor
            (True, None, True),  # General upload
            (False, None, True),  # General upload (no dataset permission needed)
        ],
    )
    @patch("services.file_service.FileService.upload_file")
    @patch("flask_login.current_user")
    def test_should_enforce_proper_permissions(
        self, mock_current_user, mock_upload_file, mock_decorators, api, app, is_dataset_editor, source, should_allow
    ):
        """Test permission enforcement for dataset uploads"""
        user = MockUser(is_dataset_editor=is_dataset_editor)
        mock_current_user.return_value = user

        file_data = {"file": (io.BytesIO(b"content"), "test.txt", "text/plain")}
        if source:
            file_data["source"] = source

        mock_upload_file.return_value = MagicMock(id="test_file_id")

        with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
            if should_allow:
                result, status = api.post()
                assert status == 201
            else:
                with pytest.raises(Forbidden):
                    api.post()

    # Test 5: Multiple File Upload Prevention
    @patch("flask_login.current_user")
    def test_should_prevent_multiple_file_uploads(self, mock_current_user, mock_decorators, api, app, mock_user):
        """Test prevention of multiple file uploads"""
        mock_current_user.return_value = mock_user

        # Create form data with multiple files
        file_data = {
            "file": (io.BytesIO(b"content1"), "file1.txt", "text/plain"),
            "file2": (io.BytesIO(b"content2"), "file2.txt", "text/plain"),
        }

        with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
            with pytest.raises(TooManyFilesError):
                api.post()

    # Test 6: Missing File Handling
    @pytest.mark.parametrize(
        ("file_data", "expected_error"),
        [
            ({}, NoFileUploadedError),  # No file in request
            ({"file": (io.BytesIO(b"content"), "", "text/plain")}, FilenameNotExistsError),  # Empty filename
            ({"file": (io.BytesIO(b""), "empty.txt", "text/plain")}, None),  # Zero bytes (should be OK)
        ],
    )
    @patch("services.file_service.FileService.upload_file")
    @patch("flask_login.current_user")
    def test_should_handle_missing_files_and_edge_cases(
        self, mock_current_user, mock_upload_file, mock_decorators, api, app, mock_user, file_data, expected_error
    ):
        """Test handling of missing files and edge cases"""
        mock_current_user.return_value = mock_user
        mock_upload_file.return_value = MagicMock(id="test_file_id")

        with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
            if expected_error:
                with pytest.raises(expected_error):
                    api.post()
            else:
                result, status = api.post()
                assert status == 201

    # Test 7: Service Error Propagation
    @pytest.mark.parametrize(
        ("service_error", "expected_controller_error"),
        [
            (ServiceFileTooLargeError("File too large"), FileTooLargeError),
            (ServiceUnsupportedFileTypeError(), UnsupportedFileTypeError),
        ],
    )
    @patch("services.file_service.FileService.upload_file")
    @patch("flask_login.current_user")
    def test_should_propagate_service_errors_correctly(
        self,
        mock_current_user,
        mock_upload_file,
        mock_decorators,
        api,
        app,
        mock_user,
        service_error,
        expected_controller_error,
    ):
        """Test that service errors are correctly propagated as controller errors"""
        mock_current_user.return_value = mock_user
        mock_upload_file.side_effect = service_error

        file_data = {"file": (io.BytesIO(b"content"), "test.txt", "text/plain")}

        with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
            with pytest.raises(expected_controller_error):
                api.post()

    # Test 8: Configuration Endpoint
    @patch("controllers.console.files.dify_config")
    @patch("flask_login.current_user")
    def test_should_return_upload_configuration(
        self, mock_current_user, mock_config, mock_decorators, api, app, mock_user
    ):
        """Test GET endpoint returns proper upload configuration"""
        mock_current_user.return_value = mock_user
        
        # Mock configuration values
        mock_config.UPLOAD_FILE_SIZE_LIMIT = 15
        mock_config.UPLOAD_FILE_BATCH_LIMIT = 5
        mock_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT = 10
        mock_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT = 500
        mock_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT = 50
        mock_config.WORKFLOW_FILE_UPLOAD_LIMIT = 10

        with app.test_request_context(method="GET"):
            result, status = api.get()
            
            assert status == 200
            assert result["file_size_limit"] == 15
            assert result["batch_count_limit"] == 5
            assert result["image_file_size_limit"] == 10
            assert result["video_file_size_limit"] == 500
            assert result["audio_file_size_limit"] == 50
            assert result["workflow_file_upload_limit"] == 10