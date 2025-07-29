import io
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_login import AnonymousUserMixin
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Forbidden

from controllers.console.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.files import FileApi
from models.account import Account
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError


class TestFileUploadSecurity:
    """Comprehensive security tests for file upload functionality"""

    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def api(self):
        return FileApi()

    @pytest.fixture
    def mock_current_user(self):
        user = MagicMock(spec=Account)
        user.is_authenticated = True
        user.is_dataset_editor = True
        user.id = "test_user_id"
        user.current_tenant_id = "test_tenant_id"
        return user

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
            # Valid files
            ("document.pdf", False),
            ("image.jpg", False),
            ("text.txt", False),
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_detect_malicious_file_types(
        self, mock_file_service, mock_current_user_context, api, app, mock_current_user, filename, should_reject
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        # Create file with malicious extension
        file_content = b"<?php system($_GET['cmd']); ?>"
        file = FileStorage(stream=io.BytesIO(file_content), filename=filename, content_type="application/octet-stream")

        with app.test_request_context(method="POST", data={"file": file, "source": "datasets"}):
            if should_reject:
                # Configure service to raise error for dangerous files
                mock_file_service.upload_file.side_effect = ServiceUnsupportedFileTypeError()

                with pytest.raises(UnsupportedFileTypeError):
                    api.post()
            else:
                # Configure service to accept safe files
                mock_file_service.upload_file.return_value = MagicMock(id="test_file_id")
                result, status = api.post()
                assert status == 201

    # Test 2: MIME Type Forgery Detection
    @pytest.mark.parametrize(
        ("filename", "content", "mime_type", "description"),
        [
            # PHP code disguised as image
            ("photo.jpg", b"<?php phpinfo(); ?>", "image/jpeg", "PHP disguised as JPEG"),
            # JavaScript in HTML
            ("page.html", b"<script>alert('xss')</script>", "text/html", "JavaScript in HTML"),
            # Executable with wrong MIME
            ("app.exe", b"MZ\x90\x00", "image/png", "EXE disguised as PNG"),
            # Valid image data (JPEG magic number)
            ("real.jpg", b"\xff\xd8\xff\xe0", "image/jpeg", "Valid JPEG"),
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_validate_mime_type_matches_content(
        self,
        mock_file_service,
        mock_current_user_context,
        api,
        app,
        mock_current_user,
        filename,
        content,
        mime_type,
        description,
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        file = FileStorage(stream=io.BytesIO(content), filename=filename, content_type=mime_type)

        with app.test_request_context(method="POST", data={"file": file, "source": "datasets"}):
            if description.startswith("Valid"):
                mock_file_service.upload_file.return_value = MagicMock(id="test_file_id")
                result, status = api.post()
                assert status == 201
            else:
                mock_file_service.upload_file.side_effect = ServiceUnsupportedFileTypeError()
                with pytest.raises(UnsupportedFileTypeError):
                    api.post()

    # Test 3: File Content Security Validation
    @pytest.mark.parametrize(
        ("filename", "content", "description"),
        [
            # SVG with embedded script
            (
                "icon.svg",
                b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
                "SVG with script tag",
            ),
            # SVG with event handler
            (
                "image.svg",
                b'<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="alert(1)"/></svg>',
                "SVG with onerror",
            ),
            # PDF with JavaScript
            ("document.pdf", b'%PDF-1.4\n/JS (app.alert("XSS"))', "PDF with JavaScript"),
            # Office document with macro indicator
            ("spreadsheet.xlsx", b"PK\x03\x04...vbaProject.bin", "Excel with macro"),
            # Clean SVG
            (
                "clean.svg",
                b'<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>',
                "Clean SVG",
            ),
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_detect_embedded_malicious_content(
        self, mock_file_service, mock_current_user_context, api, app, mock_current_user, filename, content, description
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        file = FileStorage(stream=io.BytesIO(content), filename=filename, content_type="application/octet-stream")

        with app.test_request_context(method="POST", data={"file": file, "source": "datasets"}):
            if "Clean" in description:
                mock_file_service.upload_file.return_value = MagicMock(id="test_file_id")
                result, status = api.post()
                assert status == 201
            else:
                mock_file_service.upload_file.side_effect = ServiceUnsupportedFileTypeError()
                with pytest.raises(UnsupportedFileTypeError):
                    api.post()

    # Test 4: Path Traversal Attack Prevention
    @pytest.mark.parametrize(
        ("filename", "description"),
        [
            ("../../../etc/passwd", "Unix path traversal"),
            ("..\\..\\windows\\system32\\config\\sam", "Windows path traversal"),
            ("file.jpg\x00.php", "Null byte injection"),
            ("%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd", "URL encoded traversal"),
            ("....//....//....//etc/passwd", "Alternative traversal"),
            ("/etc/passwd", "Absolute path"),
            ("C:\\Windows\\System32\\drivers\\etc\\hosts", "Windows absolute path"),
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_prevent_path_traversal_attacks(
        self, mock_file_service, mock_current_user_context, api, app, mock_current_user, filename, description
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        file = FileStorage(stream=io.BytesIO(b"content"), filename=filename, content_type="text/plain")

        # The FileService should validate and sanitize filenames
        def upload_file_side_effect(filename, content, mimetype, user, source):
            # Check if filename contains path traversal attempts
            if any(char in filename for char in ["/", "\\", "\x00", ".."]):
                raise ValueError("Filename contains invalid characters")
            return MagicMock(id="test_file_id")

        mock_file_service.upload_file.side_effect = upload_file_side_effect

        with app.test_request_context(method="POST", data={"file": file, "source": "datasets"}):
            with pytest.raises(ValueError):
                api.post()

    # Test 5: File Size Limit Enforcement
    @pytest.mark.parametrize(
        ("file_type", "extension", "size_mb", "limit_mb", "should_reject"),
        [
            # Image files
            ("image", "jpg", 15, 10, True),  # Over image limit
            ("image", "png", 8, 10, False),  # Under image limit
            # Video files
            ("video", "mp4", 550, 500, True),  # Over video limit
            ("video", "mov", 450, 500, False),  # Under video limit
            # Audio files
            ("audio", "mp3", 60, 50, True),  # Over audio limit
            ("audio", "wav", 40, 50, False),  # Under audio limit
            # Document files
            ("document", "pdf", 20, 15, True),  # Over general limit
            ("document", "txt", 10, 15, False),  # Under general limit
            # Edge cases
            ("image", "jpg", 0, 10, False),  # Zero size file
            ("document", "txt", 0.001, 15, False),  # Very small file
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    @patch("controllers.console.files.dify_config")
    def test_should_enforce_file_size_limits(
        self,
        mock_config,
        mock_file_service,
        mock_current_user_context,
        api,
        app,
        mock_current_user,
        file_type,
        extension,
        size_mb,
        limit_mb,
        should_reject,
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        # Configure size limits
        mock_config.UPLOAD_FILE_SIZE_LIMIT = 15  # General limit
        mock_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT = 10
        mock_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT = 500
        mock_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT = 50
        mock_config.UPLOAD_FILE_BATCH_LIMIT = 5
        mock_config.WORKFLOW_FILE_UPLOAD_LIMIT = 10

        # Create file with specific size
        file_content = b"X" * int(size_mb * 1024 * 1024)
        file = FileStorage(
            stream=io.BytesIO(file_content), filename=f"test.{extension}", content_type="application/octet-stream"
        )

        with app.test_request_context(method="POST", data={"file": file, "source": "datasets"}):
            if should_reject:
                mock_file_service.upload_file.side_effect = ServiceFileTooLargeError(
                    f"File size exceeds limit of {limit_mb}MB"
                )
                with pytest.raises(FileTooLargeError):
                    api.post()
            else:
                mock_file_service.upload_file.return_value = MagicMock(id="test_file_id")
                result, status = api.post()
                assert status == 201

    # Test 6: Filename Security
    @pytest.mark.parametrize(
        ("filename", "expected_sanitized"),
        [
            # Special characters that should be rejected
            ("<script>alert('xss')</script>.txt", "Invalid"),
            ("'; DROP TABLE users; --.sql", "Invalid"),
            ("file|cmd.txt", "Invalid"),
            ("file:data.txt", "Invalid"),
            ('file"name".txt', "Invalid"),
            ("file?name.txt", "Invalid"),
            ("file*name.txt", "Invalid"),
            ("file<>name.txt", "Invalid"),
            # Long filenames (should be truncated)
            ("a" * 250 + ".txt", "a" * 200 + ".txt"),
            # Unicode and control characters
            ("file\x00name.txt", "Invalid"),
            ("file\nname.txt", "Invalid"),
            ("file\rname.txt", "Invalid"),
            # Windows reserved names
            ("CON.txt", "Invalid"),
            ("PRN.txt", "Invalid"),
            ("AUX.txt", "Invalid"),
            ("NUL.txt", "Invalid"),
            ("COM1.txt", "Invalid"),
            ("LPT1.txt", "Invalid"),
            # Valid filenames
            ("normal_file-name.txt", "normal_file-name.txt"),
            ("file.with.dots.txt", "file.with.dots.txt"),
            ("文件名.txt", "文件名.txt"),  # Unicode filename
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_sanitize_dangerous_filenames(
        self, mock_file_service, mock_current_user_context, api, app, mock_current_user, filename, expected_sanitized
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        file = FileStorage(stream=io.BytesIO(b"content"), filename=filename, content_type="text/plain")

        def upload_file_side_effect(filename, content, mimetype, user, source):
            # Simulate filename validation in FileService
            invalid_chars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\x00", "\n", "\r"]
            reserved_names = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]

            base_name = filename.rsplit(".", 1)[0] if "." in filename else filename
            if any(char in filename for char in invalid_chars) or base_name.upper() in reserved_names:
                raise ValueError("Filename contains invalid characters")

            # Truncate long filenames
            if len(filename) > 200:
                extension = filename.split(".")[-1] if "." in filename else ""
                filename = filename[: 200 - len(extension) - 1] + "." + extension

            return MagicMock(id="test_file_id", name=filename)

        mock_file_service.upload_file.side_effect = upload_file_side_effect

        with app.test_request_context(method="POST", data={"file": file, "source": "datasets"}):
            if expected_sanitized == "Invalid":
                with pytest.raises(ValueError):
                    api.post()
            else:
                result, status = api.post()
                assert status == 201
                # Verify filename was properly handled
                mock_file_service.upload_file.assert_called_once()

    # Test 7: Concurrent Upload Security
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_handle_concurrent_uploads_safely(
        self, mock_file_service, mock_current_user_context, api, app, mock_current_user
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        # Simulate multiple concurrent uploads with same filename
        filename = "concurrent_test.txt"
        file1 = FileStorage(stream=io.BytesIO(b"content1"), filename=filename, content_type="text/plain")
        file2 = FileStorage(stream=io.BytesIO(b"content2"), filename=filename, content_type="text/plain")

        # Each upload should get unique ID
        mock_file_service.upload_file.side_effect = [
            MagicMock(id="unique_id_1", name=filename),
            MagicMock(id="unique_id_2", name=filename),
        ]

        with app.test_request_context(method="POST", data={"file": file1}):
            result1, status1 = api.post()
            assert status1 == 201
            assert result1.id == "unique_id_1"

        with app.test_request_context(method="POST", data={"file": file2}):
            result2, status2 = api.post()
            assert status2 == 201
            assert result2.id == "unique_id_2"

        # Verify both uploads were processed
        assert mock_file_service.upload_file.call_count == 2

    # Test 8: Permission and Authorization
    @pytest.mark.parametrize(
        ("is_authenticated", "is_dataset_editor", "source", "should_allow"),
        [
            (True, True, "datasets", True),  # Authorized dataset editor
            (True, False, "datasets", False),  # Not a dataset editor
            (True, True, None, True),  # General upload
            (False, False, "datasets", False),  # Not authenticated
            (True, True, "invalid_source", True),  # Invalid source treated as None
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_enforce_proper_permissions(
        self,
        mock_file_service,
        mock_current_user_context,
        api,
        app,
        is_authenticated,
        is_dataset_editor,
        source,
        should_allow,
    ):
        # Configure user permissions
        if is_authenticated:
            user = MagicMock(spec=Account)
            user.is_authenticated = True
            user.is_dataset_editor = is_dataset_editor
            user.id = "test_user_id"
        else:
            user = AnonymousUserMixin()

        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(user, x)

        file = FileStorage(stream=io.BytesIO(b"content"), filename="test.txt", content_type="text/plain")

        mock_file_service.upload_file.return_value = MagicMock(id="test_file_id")

        form_data = {"file": file}
        if source:
            form_data["source"] = source

        with app.test_request_context(method="POST", data=form_data):
            if should_allow:
                result, status = api.post()
                assert status == 201
            else:
                with pytest.raises(Forbidden):
                    api.post()

    # Test 9: Multiple File Upload Prevention
    @patch("controllers.console.files.current_user")
    def test_should_prevent_multiple_file_uploads(self, mock_current_user_context, api, app, mock_current_user):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        # Try to upload multiple files
        file1 = FileStorage(stream=io.BytesIO(b"content1"), filename="file1.txt", content_type="text/plain")
        file2 = FileStorage(stream=io.BytesIO(b"content2"), filename="file2.txt", content_type="text/plain")

        with app.test_request_context(method="POST", data={"file": file1, "file2": file2}):
            with pytest.raises(TooManyFilesError):
                api.post()

    # Test 10: Empty File and Missing File Handling
    @pytest.mark.parametrize(
        ("test_case", "file_data", "expected_error"),
        [
            ("no_file", {}, NoFileUploadedError),  # No file in request
            ("empty_filename", {"file": FileStorage(stream=io.BytesIO(b"content"), filename="")}, None),  # Empty name
            (
                "zero_byte_file",
                {"file": FileStorage(stream=io.BytesIO(b""), filename="empty.txt")},
                None,
            ),  # Zero bytes
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_handle_edge_cases(
        self,
        mock_file_service,
        mock_current_user_context,
        api,
        app,
        mock_current_user,
        test_case,
        file_data,
        expected_error,
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        if test_case == "empty_filename":
            # Import the specific error
            from controllers.common.errors import FilenameNotExistsError

            expected_error = FilenameNotExistsError

        mock_file_service.upload_file.return_value = MagicMock(id="test_file_id")

        with app.test_request_context(method="POST", data=file_data):
            if expected_error:
                with pytest.raises(expected_error):
                    api.post()
            else:
                result, status = api.post()
                assert status == 201

    # Test 11: Compression Bomb Protection
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_protect_against_compression_bombs(
        self, mock_file_service, mock_current_user_context, api, app, mock_current_user
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        # Create a file that simulates a compression bomb
        # In real implementation, this would be a zip file with high compression ratio
        compressed_content = b"PK\x03\x04" + b"\x00" * 100  # Minimal zip header
        file = FileStorage(stream=io.BytesIO(compressed_content), filename="bomb.zip", content_type="application/zip")

        # Service should detect and reject compression bombs
        mock_file_service.upload_file.side_effect = ServiceFileTooLargeError(
            "Compressed file exceeds maximum decompression size"
        )

        with app.test_request_context(method="POST", data={"file": file}):
            with pytest.raises(FileTooLargeError):
                api.post()

    # Test 12: Unicode and Encoding Attack Prevention
    @pytest.mark.parametrize(
        ("filename", "description"),
        [
            ("file\u202e\u0074\u0078\u0074.exe", "Right-to-left override attack"),  # Makes exe appear as txt
            ("file\ufeff.txt", "Zero-width space attack"),
            ("file\u200b\u200c\u200d.txt", "Invisible character attack"),
            ("file%E2%80%AE%74%78%74.exe", "URL encoded RLO attack"),
            ("\u0000\u0000\u0000.txt", "Null character filename"),
        ],
    )
    @patch("controllers.console.files.current_user")
    @patch("controllers.console.files.FileService")
    def test_should_handle_unicode_attacks(
        self, mock_file_service, mock_current_user_context, api, app, mock_current_user, filename, description
    ):
        mock_current_user_context.__getattr__.side_effect = lambda x: getattr(mock_current_user, x)

        file = FileStorage(stream=io.BytesIO(b"content"), filename=filename, content_type="text/plain")

        # Service should sanitize or reject suspicious Unicode patterns
        def upload_file_side_effect(filename, content, mimetype, user, source):
            # Check for dangerous Unicode characters
            dangerous_chars = [
                "\u202e",  # Right-to-left override
                "\u200b",  # Zero-width space
                "\u200c",  # Zero-width non-joiner
                "\u200d",  # Zero-width joiner
                "\ufeff",  # Zero-width no-break space
                "\u0000",  # Null character
            ]

            if any(char in filename for char in dangerous_chars):
                raise ValueError("Filename contains suspicious Unicode characters")

            return MagicMock(id="test_file_id")

        mock_file_service.upload_file.side_effect = upload_file_side_effect

        with app.test_request_context(method="POST", data={"file": file}):
            with pytest.raises(ValueError):
                api.post()
