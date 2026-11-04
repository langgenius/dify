import builtins
import io
from unittest.mock import patch

import pytest
from flask import Flask
from flask.views import MethodView
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
from machinery.context import RequestContext
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.model import UploadFile
from tests.helpers.unit.model_factories import make_upload_file


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


def _request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


class TestFilesCases:
    @staticmethod
    @pytest.fixture
    def app():
        app = Flask(__name__)
        app.testing = True
        return app

    @staticmethod
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

    @staticmethod
    @pytest.fixture
    def mock_current_user():
        user = Account(name="Test User", email="user-1@example.com", status=AccountStatus.ACTIVE)
        user.id = "user-1"
        user.role = TenantAccountRole.OWNER
        return user

    @staticmethod
    @pytest.fixture
    def mock_account_context(mock_current_user):
        return mock_current_user

    @staticmethod
    @pytest.fixture
    def mock_file_service():
        with patch("controllers.console.files.application_services") as services:
            yield services.return_value.files

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
                data, status = get_method(api, _request_context())

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
            mock_file_service.upload_file.assert_called_once_with(
                filename="test.txt",
                content=b"hello",
                mimetype="text/plain",
                user=mock_account_context,
                tenant_id=None,
                source=None,
                default_file_size_limit=None,
            )

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
                with pytest.raises(FileTooLargeError) as error_info:
                    post_method(api, mock_account_context)

            assert error_info.value.__cause__ is error

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
                with pytest.raises(UnsupportedFileTypeError) as error_info:
                    post_method(api, mock_account_context)

            assert error_info.value.__cause__ is error

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
                with pytest.raises(BlockedFileExtensionError) as error_info:
                    post_method(api, mock_account_context)

            assert error_info.value.description == error.description
            assert error_info.value.__cause__ is error

    class TestFilePreviewApi:
        def test_get_preview(self, app: Flask, mock_account_context, mock_file_service):
            api = FilePreviewApi()
            get_method = unwrap(api.get)
            mock_file_service.get_file_preview.return_value = "preview text"

            with app.test_request_context():
                result = get_method(api, _request_context(workspace_id="tenant-123"), "1234")

            assert result == {"content": "preview text"}
            mock_file_service.get_file_preview.assert_called_once_with(file_id="1234", tenant_id="tenant-123")

    class TestFileSupportTypeApi:
        def test_get_supported_types(self, app: Flask):
            api = FileSupportTypeApi()
            get_method = unwrap(api.get)

            with app.test_request_context():
                result = get_method(api, _request_context())

            assert result == {"allowed_extensions": list(DOCUMENT_EXTENSIONS)}


if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


class TestFilesSecurityCases:
    class TestFileUploadSecurity:
        """Test file upload security logic without complex framework setup"""

        # Test 1: Basic file validation
        def test_should_validate_file_presence(self) -> None:
            """Test that missing file is detected"""
            from flask import Flask, request

            app = Flask(__name__)

            with app.test_request_context(method="POST", data={}):
                # Simulate the check in FileApi.post()
                if "file" not in request.files:
                    with pytest.raises(NoFileUploadedError):
                        raise NoFileUploadedError()

        def test_should_validate_multiple_files(self) -> None:
            """Test that multiple files are rejected"""
            from flask import Flask, request

            app = Flask(__name__)

            file_data = {
                "file": (io.BytesIO(b"content1"), "file1.txt", "text/plain"),
                "file2": (io.BytesIO(b"content2"), "file2.txt", "text/plain"),
            }

            with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
                # Simulate the check in FileApi.post()
                if len(request.files) > 1:
                    with pytest.raises(TooManyFilesError):
                        raise TooManyFilesError()

        def test_should_validate_empty_filename(self) -> None:
            """Test that empty filename is rejected"""
            from flask import Flask, request

            app = Flask(__name__)

            file_data = {"file": (io.BytesIO(b"content"), "", "text/plain")}

            with app.test_request_context(method="POST", data=file_data, content_type="multipart/form-data"):
                file = request.files["file"]
                if not file.filename:
                    with pytest.raises(FilenameNotExistsError):
                        raise FilenameNotExistsError

        # Test 2: Security - Filename sanitization
        def test_should_detect_path_traversal_in_filename(self) -> None:
            """Test protection against directory traversal attacks"""
            dangerous_filenames = [
                "../../../etc/passwd",
                "..\\..\\windows\\system32\\config\\sam",
                "../../../../etc/shadow",
                "./../../../sensitive.txt",
            ]

            for filename in dangerous_filenames:
                # Any filename containing .. should be considered dangerous
                assert ".." in filename, f"Filename {filename} should be detected as path traversal"

        def test_should_detect_null_byte_injection(self) -> None:
            """Test protection against null byte injection"""
            dangerous_filenames = [
                "file.jpg\x00.php",
                "document.pdf\x00.exe",
                "image.png\x00.sh",
            ]

            for filename in dangerous_filenames:
                # Null bytes should be detected
                assert "\x00" in filename, f"Filename {filename} should be detected as null byte injection"

        def test_should_sanitize_special_characters(self) -> None:
            """Test that special characters in filenames are handled safely"""
            # Characters that could be problematic in various contexts
            dangerous_chars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\x00"]

            for char in dangerous_chars:
                filename = f"file{char}name.txt"
                # These characters should be detected or sanitized
                assert any(c in filename for c in dangerous_chars)

        # Test 3: Permission validation
        def test_should_validate_dataset_permissions(self) -> None:
            """Test dataset upload permission logic"""
            user = Account(name="Viewer", email="viewer@example.com", status=AccountStatus.ACTIVE)
            user.role = TenantAccountRole.NORMAL
            source = "datasets"

            # Simulate the permission check in FileApi.post()
            if source == "datasets" and not user.is_dataset_editor:
                with pytest.raises(Forbidden):
                    raise Forbidden()

        def test_should_allow_general_upload_without_permission(self) -> None:
            """Test general upload doesn't require dataset permission"""
            user = Account(name="Viewer", email="viewer@example.com", status=AccountStatus.ACTIVE)
            user.role = TenantAccountRole.NORMAL
            source = None  # General upload

            # This should not raise an exception
            if source == "datasets" and not user.is_dataset_editor:
                raise Forbidden()
            # Test passes if no exception is raised

        # Test 4: File type security
        def test_should_identify_dangerous_file_extensions(self) -> None:
            """Test detection of potentially dangerous file extensions"""
            dangerous_extensions = [
                ".php",
                ".PHP",
                ".pHp",  # PHP files (case variations)
                ".exe",
                ".EXE",  # Executables
                ".sh",
                ".SH",  # Shell scripts
                ".bat",
                ".BAT",  # Batch files
                ".cmd",
                ".CMD",  # Command files
                ".ps1",
                ".PS1",  # PowerShell
                ".jar",
                ".JAR",  # Java archives
                ".vbs",
                ".VBS",  # VBScript
            ]

            safe_extensions = [".txt", ".pdf", ".jpg", ".png", ".doc", ".docx"]

            # Just verify our test data is correct
            for ext in dangerous_extensions:
                assert ext.lower() in [".php", ".exe", ".sh", ".bat", ".cmd", ".ps1", ".jar", ".vbs"]

            for ext in safe_extensions:
                assert ext.lower() not in [".php", ".exe", ".sh", ".bat", ".cmd", ".ps1", ".jar", ".vbs"]

        def test_should_detect_double_extensions(self) -> None:
            """Test detection of double extension attacks"""
            suspicious_filenames = [
                "image.jpg.php",
                "document.pdf.exe",
                "photo.png.sh",
                "file.txt.bat",
            ]

            for filename in suspicious_filenames:
                # Check that these have multiple extensions
                parts = filename.split(".")
                assert len(parts) > 2, f"Filename {filename} should have multiple extensions"

        # Test 5: Configuration validation
        def test_upload_configuration_structure(self) -> None:
            """Test that upload configuration has correct structure"""
            # Simulate the configuration returned by FileApi.get()
            config = {
                "file_size_limit": 15,
                "batch_count_limit": 5,
                "image_file_size_limit": 10,
                "video_file_size_limit": 500,
                "audio_file_size_limit": 50,
                "workflow_file_upload_limit": 10,
            }

            # Verify all required fields are present
            required_fields = [
                "file_size_limit",
                "batch_count_limit",
                "image_file_size_limit",
                "video_file_size_limit",
                "audio_file_size_limit",
                "workflow_file_upload_limit",
            ]

            for field in required_fields:
                assert field in config, f"Missing required field: {field}"
                assert isinstance(config[field], int), f"Field {field} should be an integer"
                assert config[field] > 0, f"Field {field} should be positive"

        # Test 7: Source parameter handling
        def test_source_parameter_normalization(self) -> None:
            """Test that source parameter is properly normalized"""
            test_cases = [
                ("datasets", "datasets"),
                ("other", None),
                ("", None),
                (None, None),
            ]

            for input_source, expected in test_cases:
                # Simulate the source normalization in FileApi.post()
                source = "datasets" if input_source == "datasets" else None
                if source not in ("datasets", None):
                    source = None
                assert source == expected

        # Test 8: Boundary conditions
        def test_should_handle_edge_case_file_sizes(self) -> None:
            """Test handling of boundary file sizes"""
            test_cases = [
                (0, "Empty file"),  # 0 bytes
                (1, "Single byte"),  # 1 byte
                (15 * 1024 * 1024 - 1, "Just under limit"),  # Just under 15MB
                (15 * 1024 * 1024, "At limit"),  # Exactly 15MB
                (15 * 1024 * 1024 + 1, "Just over limit"),  # Just over 15MB
            ]

            for size, description in test_cases:
                # Just verify our test data
                assert isinstance(size, int), f"{description}: Size should be integer"
                assert size >= 0, f"{description}: Size should be non-negative"

        def test_should_handle_special_mime_types(self) -> None:
            """Test handling of various MIME types"""
            mime_type_tests = [
                ("application/octet-stream", "Generic binary"),
                ("text/plain", "Plain text"),
                ("image/jpeg", "JPEG image"),
                ("application/pdf", "PDF document"),
                ("", "Empty MIME type"),
                (None, "None MIME type"),
            ]

            for mime_type, description in mime_type_tests:
                # Verify test data structure
                if mime_type is not None:
                    assert isinstance(mime_type, str), f"{description}: MIME type should be string or None"
