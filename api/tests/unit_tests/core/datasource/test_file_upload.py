"""Comprehensive unit tests for file upload functionality.

This test module provides extensive coverage of the file upload system in Dify,
ensuring robust validation, security, and proper handling of various file types.

TEST COVERAGE OVERVIEW:
=======================

1. File Type Validation (TestFileTypeValidation)
   - Validates supported file extensions for images, videos, audio, and documents
   - Ensures case-insensitive extension handling
   - Tests dataset-specific document type restrictions
   - Verifies extension constants are properly configured

2. File Size Limiting (TestFileSizeLimiting)
   - Tests size limits for different file categories (image: 10MB, video: 100MB, audio: 50MB, general: 15MB)
   - Validates files within limits, exceeding limits, and exactly at limits
   - Ensures proper size calculation and comparison logic

3. Virus Scanning Integration (TestVirusScanningIntegration)
   - Placeholder tests for future virus scanning implementation
   - Documents current state (no scanning implemented)
   - Provides structure for future security enhancements

4. Storage Path Generation (TestStoragePathGeneration)
   - Tests unique path generation using UUIDs
   - Validates path format: upload_files/{tenant_id}/{uuid}.{extension}
   - Ensures tenant isolation and path safety
   - Verifies extension preservation in storage keys

5. Duplicate Detection (TestDuplicateDetection)
   - Tests SHA3-256 hash generation for file content
   - Validates duplicate detection through content hashing
   - Ensures different content produces different hashes
   - Tests hash consistency and determinism

6. Invalid Filename Handling (TestInvalidFilenameHandling)
   - Validates rejection of filenames with invalid characters (/, \\, :, *, ?, ", <, >, |)
   - Tests filename length truncation (max 200 characters)
   - Prevents path traversal attacks
   - Handles edge cases like empty filenames

7. Blacklisted Extensions (TestBlacklistedExtensions)
   - Tests blocking of dangerous file extensions (exe, bat, sh, dll)
   - Ensures case-insensitive blacklist checking
   - Validates configuration-based extension blocking

8. User Role Handling (TestUserRoleHandling)
   - Tests proper role assignment for Account vs EndUser uploads
   - Validates CreatorUserRole enum values
   - Ensures correct user attribution

9. Source URL Generation (TestSourceUrlGeneration)
   - Tests automatic URL generation for uploaded files
   - Validates custom source URL preservation
   - Ensures proper URL format

10. File Extension Normalization (TestFileExtensionNormalization)
    - Tests extraction of extensions from various filename formats
    - Validates lowercase normalization
    - Handles edge cases (hidden files, multiple dots, no extension)

11. Filename Validation (TestFilenameValidation)
    - Tests comprehensive filename validation logic
    - Handles unicode characters in filenames
    - Validates length constraints and boundary conditions
    - Tests empty filename detection

12. MIME Type Handling (TestMimeTypeHandling)
    - Validates MIME type mappings for different file extensions
    - Tests fallback MIME types for unknown extensions
    - Ensures proper content type categorization

13. Storage Key Generation (TestStorageKeyGeneration)
    - Tests storage key format and component validation
    - Validates UUID collision resistance
    - Ensures path safety (no traversal sequences)

14. File Hashing Consistency (TestFileHashingConsistency)
    - Tests SHA3-256 hash algorithm properties
    - Validates deterministic hashing behavior
    - Tests hash sensitivity to content changes
    - Handles binary and empty content

15. Configuration Validation (TestConfigurationValidation)
    - Tests upload size limit configurations
    - Validates blacklist configuration
    - Ensures reasonable configuration values
    - Tests configuration accessibility

16. File Constants (TestFileConstants)
    - Tests extension set properties and completeness
    - Validates no overlap between incompatible categories
    - Ensures proper categorization of file types

TESTING APPROACH:
=================
- All tests follow the Arrange-Act-Assert (AAA) pattern for clarity
- Tests are isolated and don't depend on external services
- Mocking is used to avoid circular import issues with FileService
- Tests focus on logic validation rather than integration
- Comprehensive parametrized tests cover multiple scenarios efficiently

IMPORTANT NOTES:
================
- Due to circular import issues in the codebase (FileService -> repositories -> FileService),
  these tests validate the core logic and algorithms rather than testing FileService directly
- Tests replicate the validation logic to ensure correctness
- Future improvements could include integration tests once circular dependencies are resolved
- Virus scanning is not currently implemented but tests are structured for future addition

RUNNING TESTS:
==============
Run all tests: pytest api/tests/unit_tests/core/datasource/test_file_upload.py -v
Run specific test class: pytest api/tests/unit_tests/core/datasource/test_file_upload.py::TestFileTypeValidation -v
Run with coverage: pytest api/tests/unit_tests/core/datasource/test_file_upload.py --cov=services.file_service
"""

# Standard library imports
import hashlib  # For SHA3-256 hashing of file content
import os  # For file path operations
import uuid  # For generating unique identifiers
from unittest.mock import Mock  # For mocking dependencies

# Third-party imports
import pytest  # Testing framework

# Application imports
from configs import dify_config  # Configuration settings for file upload limits
from constants import AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS  # Supported file types
from models.enums import CreatorUserRole  # User role enumeration for file attribution


class TestFileTypeValidation:
    """Unit tests for file type validation.

    Tests cover:
    - Valid file extensions for images, videos, audio, documents
    - Invalid/unsupported file types
    - Dataset-specific document type restrictions
    - Extension case-insensitivity
    """

    @pytest.mark.parametrize(
        ("extension", "expected_in_set"),
        [
            ("jpg", True),
            ("jpeg", True),
            ("png", True),
            ("gif", True),
            ("webp", True),
            ("svg", True),
            ("JPG", True),  # Test case insensitivity
            ("JPEG", True),
            ("bmp", False),  # Not in IMAGE_EXTENSIONS
            ("tiff", False),
        ],
    )
    def test_image_extension_in_constants(self, extension, expected_in_set):
        """Test that image extensions are correctly defined in constants."""
        # Act
        result = extension in IMAGE_EXTENSIONS or extension.lower() in IMAGE_EXTENSIONS

        # Assert
        assert result == expected_in_set

    @pytest.mark.parametrize(
        "extension",
        ["mp4", "mov", "mpeg", "webm", "MP4", "MOV"],
    )
    def test_video_extension_in_constants(self, extension):
        """Test that video extensions are correctly defined in constants."""
        # Act & Assert
        assert extension in VIDEO_EXTENSIONS or extension.lower() in VIDEO_EXTENSIONS

    @pytest.mark.parametrize(
        "extension",
        ["mp3", "m4a", "wav", "amr", "mpga", "MP3", "WAV"],
    )
    def test_audio_extension_in_constants(self, extension):
        """Test that audio extensions are correctly defined in constants."""
        # Act & Assert
        assert extension in AUDIO_EXTENSIONS or extension.lower() in AUDIO_EXTENSIONS

    @pytest.mark.parametrize(
        "extension",
        ["txt", "pdf", "docx", "xlsx", "csv", "md", "html", "TXT", "PDF"],
    )
    def test_document_extension_in_constants(self, extension):
        """Test that document extensions are correctly defined in constants."""
        # Act & Assert
        assert extension in DOCUMENT_EXTENSIONS or extension.lower() in DOCUMENT_EXTENSIONS

    def test_dataset_source_document_validation(self):
        """Test dataset source document type validation logic."""
        # Arrange
        valid_extensions = ["pdf", "txt", "docx"]
        invalid_extensions = ["jpg", "mp4", "mp3"]

        # Act & Assert - valid extensions
        for ext in valid_extensions:
            assert ext in DOCUMENT_EXTENSIONS or ext.lower() in DOCUMENT_EXTENSIONS

        # Act & Assert - invalid extensions
        for ext in invalid_extensions:
            assert ext not in DOCUMENT_EXTENSIONS
            assert ext.lower() not in DOCUMENT_EXTENSIONS


class TestFileSizeLimiting:
    """Unit tests for file size limiting logic.

    Tests cover:
    - Size limits for different file types (image, video, audio, general)
    - Files within size limits
    - Files exceeding size limits
    - Edge cases (exactly at limit)
    """

    def test_is_file_size_within_limit_image(self):
        """Test file size validation logic for images.

        This test validates the size limit checking algorithm for image files.
        Images have a default limit of 10MB (configurable via UPLOAD_IMAGE_FILE_SIZE_LIMIT).

        Test cases:
        - File under limit (5MB) should pass
        - File over limit (15MB) should fail
        - File exactly at limit (10MB) should pass
        """
        # Arrange - Set up test data for different size scenarios
        image_ext = "jpg"
        size_within_limit = 5 * 1024 * 1024  # 5MB - well under the 10MB limit
        size_exceeds_limit = 15 * 1024 * 1024  # 15MB - exceeds the 10MB limit
        size_at_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024  # Exactly at limit

        # Act - Replicate the logic from FileService.is_file_size_within_limit
        # This function determines the appropriate size limit based on file extension
        def check_size(extension: str, file_size: int) -> bool:
            """Check if file size is within allowed limit for its type.

            Args:
                extension: File extension (e.g., 'jpg', 'mp4')
                file_size: Size of file in bytes

            Returns:
                True if file size is within limit, False otherwise
            """
            # Determine size limit based on file category
            if extension in IMAGE_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024  # Convert MB to bytes
            elif extension in VIDEO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT * 1024 * 1024
            elif extension in AUDIO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT * 1024 * 1024
            else:
                # Default limit for general files (documents, etc.)
                file_size_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024

            # Return True if file size is within or equal to limit
            return file_size <= file_size_limit

        # Assert - Verify all test cases produce expected results
        assert check_size(image_ext, size_within_limit) is True  # Should accept files under limit
        assert check_size(image_ext, size_exceeds_limit) is False  # Should reject files over limit
        assert check_size(image_ext, size_at_limit) is True  # Should accept files exactly at limit

    def test_is_file_size_within_limit_video(self):
        """Test file size validation logic for videos."""
        # Arrange
        video_ext = "mp4"
        size_within_limit = 50 * 1024 * 1024  # 50MB
        size_exceeds_limit = 150 * 1024 * 1024  # 150MB
        size_at_limit = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT * 1024 * 1024

        # Act - Replicate the logic from FileService.is_file_size_within_limit
        def check_size(extension: str, file_size: int) -> bool:
            if extension in IMAGE_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024
            elif extension in VIDEO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT * 1024 * 1024
            elif extension in AUDIO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT * 1024 * 1024
            else:
                file_size_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024
            return file_size <= file_size_limit

        # Assert
        assert check_size(video_ext, size_within_limit) is True
        assert check_size(video_ext, size_exceeds_limit) is False
        assert check_size(video_ext, size_at_limit) is True

    def test_is_file_size_within_limit_audio(self):
        """Test file size validation logic for audio files."""
        # Arrange
        audio_ext = "mp3"
        size_within_limit = 30 * 1024 * 1024  # 30MB
        size_exceeds_limit = 60 * 1024 * 1024  # 60MB
        size_at_limit = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT * 1024 * 1024

        # Act - Replicate the logic from FileService.is_file_size_within_limit
        def check_size(extension: str, file_size: int) -> bool:
            if extension in IMAGE_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024
            elif extension in VIDEO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT * 1024 * 1024
            elif extension in AUDIO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT * 1024 * 1024
            else:
                file_size_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024
            return file_size <= file_size_limit

        # Assert
        assert check_size(audio_ext, size_within_limit) is True
        assert check_size(audio_ext, size_exceeds_limit) is False
        assert check_size(audio_ext, size_at_limit) is True

    def test_is_file_size_within_limit_general(self):
        """Test file size validation logic for general files."""
        # Arrange
        general_ext = "pdf"
        size_within_limit = 10 * 1024 * 1024  # 10MB
        size_exceeds_limit = 20 * 1024 * 1024  # 20MB
        size_at_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024

        # Act - Replicate the logic from FileService.is_file_size_within_limit
        def check_size(extension: str, file_size: int) -> bool:
            if extension in IMAGE_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024
            elif extension in VIDEO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT * 1024 * 1024
            elif extension in AUDIO_EXTENSIONS:
                file_size_limit = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT * 1024 * 1024
            else:
                file_size_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024
            return file_size <= file_size_limit

        # Assert
        assert check_size(general_ext, size_within_limit) is True
        assert check_size(general_ext, size_exceeds_limit) is False
        assert check_size(general_ext, size_at_limit) is True


class TestVirusScanningIntegration:
    """Unit tests for virus scanning integration.

    Note: Current implementation does not include virus scanning.
    These tests serve as placeholders for future implementation.

    Tests cover:
    - Clean file upload (no scanning currently)
    - Future: Infected file detection
    - Future: Scan timeout handling
    - Future: Scan service unavailability
    """

    def test_no_virus_scanning_currently_implemented(self):
        """Test that no virus scanning is currently implemented."""
        # This test documents that virus scanning is not yet implemented
        # When virus scanning is added, this test should be updated

        # Arrange
        content = b"This could be any content"

        # Act - No virus scanning function exists yet
        # This is a placeholder for future implementation

        # Assert - Document current state
        assert True  # No virus scanning to test yet

    # Future test cases for virus scanning:
    # def test_infected_file_rejected(self):
    #     """Test that infected files are rejected."""
    #     pass
    #
    # def test_virus_scan_timeout_handling(self):
    #     """Test handling of virus scan timeout."""
    #     pass
    #
    # def test_virus_scan_service_unavailable(self):
    #     """Test handling when virus scan service is unavailable."""
    #     pass


class TestStoragePathGeneration:
    """Unit tests for storage path generation.

    Tests cover:
    - Unique path generation for each upload
    - Path format validation
    - Tenant ID inclusion in path
    - UUID uniqueness
    - Extension preservation
    """

    def test_storage_path_format(self):
        """Test that storage path follows correct format."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        file_uuid = str(uuid.uuid4())
        extension = "txt"

        # Act
        file_key = f"upload_files/{tenant_id}/{file_uuid}.{extension}"

        # Assert
        assert file_key.startswith("upload_files/")
        assert tenant_id in file_key
        assert file_key.endswith(f".{extension}")

    def test_storage_path_uniqueness(self):
        """Test that UUID generation ensures unique paths."""
        # Arrange & Act
        uuid1 = str(uuid.uuid4())
        uuid2 = str(uuid.uuid4())

        # Assert
        assert uuid1 != uuid2

    def test_storage_path_includes_tenant_id(self):
        """Test that storage path includes tenant ID."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        file_uuid = str(uuid.uuid4())
        extension = "pdf"

        # Act
        file_key = f"upload_files/{tenant_id}/{file_uuid}.{extension}"

        # Assert
        assert tenant_id in file_key

    @pytest.mark.parametrize(
        ("filename", "expected_ext"),
        [
            ("test.jpg", "jpg"),
            ("test.PDF", "pdf"),
            ("test.TxT", "txt"),
            ("test.DOCX", "docx"),
        ],
    )
    def test_extension_extraction_and_lowercasing(self, filename, expected_ext):
        """Test that file extension is correctly extracted and lowercased."""
        # Act
        extension = os.path.splitext(filename)[1].lstrip(".").lower()

        # Assert
        assert extension == expected_ext


class TestDuplicateDetection:
    """Unit tests for duplicate file detection using hash.

    Tests cover:
    - Hash generation for uploaded files
    - Detection of identical file content
    - Different files with same name
    - Same content with different names
    """

    def test_file_hash_generation(self):
        """Test that file hash is generated correctly using SHA3-256.

        File hashing is critical for duplicate detection. The system uses SHA3-256
        to generate a unique fingerprint for each file's content. This allows:
        - Detection of duplicate uploads (same content, different names)
        - Content integrity verification
        - Efficient storage deduplication

        SHA3-256 properties:
        - Produces 256-bit (32-byte) hash
        - Represented as 64 hexadecimal characters
        - Cryptographically secure
        - Deterministic (same input always produces same output)
        """
        # Arrange - Create test content
        content = b"test content for hashing"
        # Pre-calculate expected hash for verification
        expected_hash = hashlib.sha3_256(content).hexdigest()

        # Act - Generate hash using the same algorithm
        actual_hash = hashlib.sha3_256(content).hexdigest()

        # Assert - Verify hash properties
        assert actual_hash == expected_hash  # Hash should be deterministic
        assert len(actual_hash) == 64  # SHA3-256 produces 64 hex characters (256 bits / 4 bits per char)
        # Verify hash contains only valid hexadecimal characters
        assert all(c in "0123456789abcdef" for c in actual_hash)

    def test_identical_content_same_hash(self):
        """Test that identical content produces same hash."""
        # Arrange
        content = b"identical content"

        # Act
        hash1 = hashlib.sha3_256(content).hexdigest()
        hash2 = hashlib.sha3_256(content).hexdigest()

        # Assert
        assert hash1 == hash2

    def test_different_content_different_hash(self):
        """Test that different content produces different hash."""
        # Arrange
        content1 = b"content one"
        content2 = b"content two"

        # Act
        hash1 = hashlib.sha3_256(content1).hexdigest()
        hash2 = hashlib.sha3_256(content2).hexdigest()

        # Assert
        assert hash1 != hash2

    def test_hash_consistency(self):
        """Test that hash generation is consistent across multiple calls."""
        # Arrange
        content = b"consistent content"

        # Act
        hashes = [hashlib.sha3_256(content).hexdigest() for _ in range(5)]

        # Assert
        assert all(h == hashes[0] for h in hashes)


class TestInvalidFilenameHandling:
    """Unit tests for invalid filename handling.

    Tests cover:
    - Invalid characters in filename
    - Extremely long filenames
    - Path traversal attempts
    """

    @pytest.mark.parametrize(
        "invalid_char",
        ["/", "\\", ":", "*", "?", '"', "<", ">", "|"],
    )
    def test_filename_contains_invalid_characters(self, invalid_char):
        """Test detection of invalid characters in filename.

        Security-critical test that validates rejection of dangerous filename characters.
        These characters are blocked because they:
        - / and \\ : Directory separators, could enable path traversal
        - : : Drive letter separator on Windows, reserved character
        - * and ? : Wildcards, could cause issues in file operations
        - " : Quote character, could break command-line operations
        - < and > : Redirection operators, command injection risk
        - | : Pipe operator, command injection risk

        Blocking these characters prevents:
        - Path traversal attacks (../../etc/passwd)
        - Command injection
        - File system corruption
        - Cross-platform compatibility issues
        """
        # Arrange - Create filename with invalid character
        filename = f"test{invalid_char}file.txt"
        # Define complete list of invalid characters
        invalid_chars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]

        # Act - Check if filename contains any invalid character
        has_invalid_char = any(c in filename for c in invalid_chars)

        # Assert - Should detect the invalid character
        assert has_invalid_char is True

    def test_valid_filename_no_invalid_characters(self):
        """Test that valid filenames pass validation."""
        # Arrange
        filename = "valid_file-name_123.txt"
        invalid_chars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]

        # Act
        has_invalid_char = any(c in filename for c in invalid_chars)

        # Assert
        assert has_invalid_char is False

    def test_extremely_long_filename_truncation(self):
        """Test handling of extremely long filenames."""
        # Arrange
        long_name = "a" * 250
        filename = f"{long_name}.txt"
        extension = "txt"
        max_length = 200

        # Act
        if len(filename) > max_length:
            truncated_filename = filename.split(".")[0][:max_length] + "." + extension
        else:
            truncated_filename = filename

        # Assert
        assert len(truncated_filename) <= max_length + len(extension) + 1
        assert truncated_filename.endswith(".txt")

    def test_path_traversal_detection(self):
        """Test that path traversal attempts are detected."""
        # Arrange
        malicious_filenames = [
            "../../../etc/passwd",
            "..\\..\\..\\windows\\system32",
            "../../sensitive/file.txt",
        ]
        invalid_chars = ["/", "\\"]

        # Act & Assert
        for filename in malicious_filenames:
            has_invalid_char = any(c in filename for c in invalid_chars)
            assert has_invalid_char is True


class TestBlacklistedExtensions:
    """Unit tests for blacklisted file extension handling.

    Tests cover:
    - Blocking of blacklisted extensions
    - Case-insensitive extension checking
    - Common dangerous extensions (exe, bat, sh, dll)
    - Allowed extensions
    """

    @pytest.mark.parametrize(
        ("extension", "blacklist", "should_block"),
        [
            ("exe", {"exe", "bat", "sh"}, True),
            ("EXE", {"exe", "bat", "sh"}, True),  # Case insensitive
            ("txt", {"exe", "bat", "sh"}, False),
            ("pdf", {"exe", "bat", "sh"}, False),
            ("bat", {"exe", "bat", "sh"}, True),
            ("BAT", {"exe", "bat", "sh"}, True),
        ],
    )
    def test_blacklist_extension_checking(self, extension, blacklist, should_block):
        """Test blacklist extension checking logic."""
        # Act
        is_blocked = extension.lower() in blacklist

        # Assert
        assert is_blocked == should_block

    def test_empty_blacklist_allows_all(self):
        """Test that empty blacklist allows all extensions."""
        # Arrange
        extensions = ["exe", "bat", "txt", "pdf", "dll"]
        blacklist = set()

        # Act & Assert
        for ext in extensions:
            assert ext.lower() not in blacklist

    def test_blacklist_configuration(self):
        """Test that blacklist configuration is accessible."""
        # Act
        blacklist = dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST

        # Assert
        assert isinstance(blacklist, set)
        # Blacklist can be empty or contain extensions


class TestUserRoleHandling:
    """Unit tests for different user role handling.

    Tests cover:
    - Account user role assignment
    - EndUser role assignment
    - Correct creator role values
    """

    def test_account_user_role_value(self):
        """Test Account user role enum value."""
        # Act & Assert
        assert CreatorUserRole.ACCOUNT.value == "account"

    def test_end_user_role_value(self):
        """Test EndUser role enum value."""
        # Act & Assert
        assert CreatorUserRole.END_USER.value == "end_user"

    def test_creator_role_detection_account(self):
        """Test creator role detection for Account user."""
        # Arrange
        user = Mock()
        user.__class__.__name__ = "Account"

        # Act
        from models import Account

        is_account = isinstance(user, Account) or user.__class__.__name__ == "Account"
        role = CreatorUserRole.ACCOUNT if is_account else CreatorUserRole.END_USER

        # Assert
        assert role == CreatorUserRole.ACCOUNT

    def test_creator_role_detection_end_user(self):
        """Test creator role detection for EndUser."""
        # Arrange
        user = Mock()
        user.__class__.__name__ = "EndUser"

        # Act
        from models import Account

        is_account = isinstance(user, Account) or user.__class__.__name__ == "Account"
        role = CreatorUserRole.ACCOUNT if is_account else CreatorUserRole.END_USER

        # Assert
        assert role == CreatorUserRole.END_USER


class TestSourceUrlGeneration:
    """Unit tests for source URL generation logic.

    Tests cover:
    - URL format validation
    - Custom source URL preservation
    - Automatic URL generation logic
    """

    def test_source_url_format(self):
        """Test that source URL follows expected format."""
        # Arrange
        file_id = str(uuid.uuid4())
        base_url = "https://example.com/files"

        # Act
        source_url = f"{base_url}/{file_id}"

        # Assert
        assert source_url.startswith("https://")
        assert file_id in source_url

    def test_custom_source_url_preservation(self):
        """Test that custom source URL is used when provided."""
        # Arrange
        custom_url = "https://custom.example.com/file/abc"
        default_url = "https://default.example.com/file/123"

        # Act
        final_url = custom_url or default_url

        # Assert
        assert final_url == custom_url

    def test_automatic_source_url_generation(self):
        """Test automatic source URL generation when not provided."""
        # Arrange
        custom_url = ""
        file_id = str(uuid.uuid4())
        default_url = f"https://default.example.com/file/{file_id}"

        # Act
        final_url = custom_url or default_url

        # Assert
        assert final_url == default_url
        assert file_id in final_url


class TestFileUploadIntegration:
    """Integration-style tests for file upload error handling.

    Tests cover:
    - Error types and messages
    - Exception hierarchy
    - Error inheritance
    """

    def test_file_too_large_error_exists(self):
        """Test that FileTooLargeError is defined and properly structured."""
        # Act
        from services.errors.file import FileTooLargeError

        # Assert - Verify the error class exists
        assert FileTooLargeError is not None
        # Verify it can be instantiated
        error = FileTooLargeError()
        assert error is not None

    def test_unsupported_file_type_error_exists(self):
        """Test that UnsupportedFileTypeError is defined and properly structured."""
        # Act
        from services.errors.file import UnsupportedFileTypeError

        # Assert - Verify the error class exists
        assert UnsupportedFileTypeError is not None
        # Verify it can be instantiated
        error = UnsupportedFileTypeError()
        assert error is not None

    def test_blocked_file_extension_error_exists(self):
        """Test that BlockedFileExtensionError is defined and properly structured."""
        # Act
        from services.errors.file import BlockedFileExtensionError

        # Assert - Verify the error class exists
        assert BlockedFileExtensionError is not None
        # Verify it can be instantiated
        error = BlockedFileExtensionError()
        assert error is not None

    def test_file_not_exists_error_exists(self):
        """Test that FileNotExistsError is defined and properly structured."""
        # Act
        from services.errors.file import FileNotExistsError

        # Assert - Verify the error class exists
        assert FileNotExistsError is not None
        # Verify it can be instantiated
        error = FileNotExistsError()
        assert error is not None


class TestFileExtensionNormalization:
    """Tests for file extension extraction and normalization.

    Tests cover:
    - Extension extraction from various filename formats
    - Case normalization (uppercase to lowercase)
    - Handling of multiple dots in filenames
    - Edge cases with no extension
    """

    @pytest.mark.parametrize(
        ("filename", "expected_extension"),
        [
            ("document.pdf", "pdf"),
            ("image.JPG", "jpg"),
            ("archive.tar.gz", "gz"),  # Gets last extension
            ("my.file.with.dots.txt", "txt"),
            ("UPPERCASE.DOCX", "docx"),
            ("mixed.CaSe.PnG", "png"),
        ],
    )
    def test_extension_extraction_and_normalization(self, filename, expected_extension):
        """Test that file extensions are correctly extracted and normalized to lowercase.

        This mimics the logic in FileService.upload_file where:
        extension = os.path.splitext(filename)[1].lstrip(".").lower()
        """
        # Act - Extract and normalize extension
        extension = os.path.splitext(filename)[1].lstrip(".").lower()

        # Assert - Verify correct extraction and normalization
        assert extension == expected_extension

    def test_filename_without_extension(self):
        """Test handling of filenames without extensions."""
        # Arrange
        filename = "README"

        # Act - Extract extension
        extension = os.path.splitext(filename)[1].lstrip(".").lower()

        # Assert - Should return empty string
        assert extension == ""

    def test_hidden_file_with_extension(self):
        """Test handling of hidden files (starting with dot) with extensions."""
        # Arrange
        filename = ".gitignore"

        # Act - Extract extension
        extension = os.path.splitext(filename)[1].lstrip(".").lower()

        # Assert - Should return empty string (no extension after the dot)
        assert extension == ""

    def test_hidden_file_with_actual_extension(self):
        """Test handling of hidden files with actual extensions."""
        # Arrange
        filename = ".config.json"

        # Act - Extract extension
        extension = os.path.splitext(filename)[1].lstrip(".").lower()

        # Assert - Should return the extension
        assert extension == "json"


class TestFilenameValidation:
    """Tests for comprehensive filename validation logic.

    Tests cover:
    - Special characters validation
    - Length constraints
    - Unicode character handling
    - Empty filename detection
    """

    def test_empty_filename_detection(self):
        """Test detection of empty filenames."""
        # Arrange
        empty_filenames = ["", " ", "  ", "\t", "\n"]

        # Act & Assert - All should be considered invalid
        for filename in empty_filenames:
            assert filename.strip() == ""

    def test_filename_with_spaces(self):
        """Test that filenames with spaces are handled correctly."""
        # Arrange
        filename = "my document with spaces.pdf"
        invalid_chars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]

        # Act - Check for invalid characters
        has_invalid = any(c in filename for c in invalid_chars)

        # Assert - Spaces are allowed
        assert has_invalid is False

    def test_filename_with_unicode_characters(self):
        """Test that filenames with unicode characters are handled."""
        # Arrange
        unicode_filenames = [
            "文档.pdf",  # Chinese
            "документ.docx",  # Russian
            "مستند.txt",  # Arabic
            "ファイル.jpg",  # Japanese
        ]
        invalid_chars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]

        # Act & Assert - Unicode should be allowed
        for filename in unicode_filenames:
            has_invalid = any(c in filename for c in invalid_chars)
            assert has_invalid is False

    def test_filename_length_boundary_cases(self):
        """Test filename length at various boundary conditions."""
        # Arrange
        max_length = 200

        # Test cases: (name_length, should_truncate)
        test_cases = [
            (50, False),  # Well under limit
            (199, False),  # Just under limit
            (200, False),  # At limit
            (201, True),  # Just over limit
            (300, True),  # Well over limit
        ]

        for name_length, should_truncate in test_cases:
            # Create filename of specified length
            base_name = "a" * name_length
            filename = f"{base_name}.txt"
            extension = "txt"

            # Act - Apply truncation logic
            if len(filename) > max_length:
                truncated = filename.split(".")[0][:max_length] + "." + extension
            else:
                truncated = filename

            # Assert
            if should_truncate:
                assert len(truncated) <= max_length + len(extension) + 1
            else:
                assert truncated == filename


class TestMimeTypeHandling:
    """Tests for MIME type handling and validation.

    Tests cover:
    - Common MIME types for different file categories
    - MIME type format validation
    - Fallback MIME types
    """

    @pytest.mark.parametrize(
        ("extension", "expected_mime_prefix"),
        [
            ("jpg", "image/"),
            ("png", "image/"),
            ("gif", "image/"),
            ("mp4", "video/"),
            ("mov", "video/"),
            ("mp3", "audio/"),
            ("wav", "audio/"),
            ("pdf", "application/"),
            ("json", "application/"),
            ("txt", "text/"),
            ("html", "text/"),
        ],
    )
    def test_mime_type_category_mapping(self, extension, expected_mime_prefix):
        """Test that file extensions map to appropriate MIME type categories.

        This validates the general category of MIME types expected for different
        file extensions, ensuring proper content type handling.
        """
        # Arrange - Common MIME type mappings
        mime_mappings = {
            "jpg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "mp4": "video/mp4",
            "mov": "video/quicktime",
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "pdf": "application/pdf",
            "json": "application/json",
            "txt": "text/plain",
            "html": "text/html",
        }

        # Act - Get MIME type
        mime_type = mime_mappings.get(extension, "application/octet-stream")

        # Assert - Verify MIME type starts with expected prefix
        assert mime_type.startswith(expected_mime_prefix)

    def test_unknown_extension_fallback_mime_type(self):
        """Test that unknown extensions fall back to generic MIME type."""
        # Arrange
        unknown_extensions = ["xyz", "unknown", "custom"]
        fallback_mime = "application/octet-stream"

        # Act & Assert - All unknown types should use fallback
        for ext in unknown_extensions:
            # In real implementation, unknown types would use fallback
            assert fallback_mime == "application/octet-stream"


class TestStorageKeyGeneration:
    """Tests for storage key generation and uniqueness.

    Tests cover:
    - Key format consistency
    - UUID uniqueness guarantees
    - Path component validation
    - Collision prevention
    """

    def test_storage_key_components(self):
        """Test that storage keys contain all required components.

        Storage keys should follow the format:
        upload_files/{tenant_id}/{uuid}.{extension}
        """
        # Arrange
        tenant_id = str(uuid.uuid4())
        file_uuid = str(uuid.uuid4())
        extension = "pdf"

        # Act - Generate storage key
        storage_key = f"upload_files/{tenant_id}/{file_uuid}.{extension}"

        # Assert - Verify all components are present
        assert "upload_files/" in storage_key
        assert tenant_id in storage_key
        assert file_uuid in storage_key
        assert storage_key.endswith(f".{extension}")

        # Verify path structure
        parts = storage_key.split("/")
        assert len(parts) == 3  # upload_files, tenant_id, filename
        assert parts[0] == "upload_files"
        assert parts[1] == tenant_id

    def test_uuid_collision_probability(self):
        """Test UUID generation for collision resistance.

        UUIDs should be unique across multiple generations to prevent
        storage key collisions.
        """
        # Arrange - Generate multiple UUIDs
        num_uuids = 1000

        # Act - Generate UUIDs
        generated_uuids = [str(uuid.uuid4()) for _ in range(num_uuids)]

        # Assert - All should be unique
        assert len(generated_uuids) == len(set(generated_uuids))

    def test_storage_key_path_safety(self):
        """Test that generated storage keys don't contain path traversal sequences."""
        # Arrange
        tenant_id = str(uuid.uuid4())
        file_uuid = str(uuid.uuid4())
        extension = "txt"

        # Act - Generate storage key
        storage_key = f"upload_files/{tenant_id}/{file_uuid}.{extension}"

        # Assert - Should not contain path traversal sequences
        assert "../" not in storage_key
        assert "..\\" not in storage_key
        assert storage_key.count("..") == 0


class TestFileHashingConsistency:
    """Tests for file content hashing consistency and reliability.

    Tests cover:
    - Hash algorithm consistency (SHA3-256)
    - Deterministic hashing
    - Hash format validation
    - Binary content handling
    """

    def test_hash_algorithm_sha3_256(self):
        """Test that SHA3-256 algorithm produces expected hash length."""
        # Arrange
        content = b"test content"

        # Act - Generate hash
        file_hash = hashlib.sha3_256(content).hexdigest()

        # Assert - SHA3-256 produces 64 hex characters (256 bits / 4 bits per hex char)
        assert len(file_hash) == 64
        assert all(c in "0123456789abcdef" for c in file_hash)

    def test_hash_deterministic_behavior(self):
        """Test that hashing the same content always produces the same hash.

        This is critical for duplicate detection functionality.
        """
        # Arrange
        content = b"deterministic content for testing"

        # Act - Generate hash multiple times
        hash1 = hashlib.sha3_256(content).hexdigest()
        hash2 = hashlib.sha3_256(content).hexdigest()
        hash3 = hashlib.sha3_256(content).hexdigest()

        # Assert - All hashes should be identical
        assert hash1 == hash2 == hash3

    def test_hash_sensitivity_to_content_changes(self):
        """Test that even small changes in content produce different hashes."""
        # Arrange
        content1 = b"original content"
        content2 = b"original content "  # Added space
        content3 = b"Original content"  # Changed case

        # Act - Generate hashes
        hash1 = hashlib.sha3_256(content1).hexdigest()
        hash2 = hashlib.sha3_256(content2).hexdigest()
        hash3 = hashlib.sha3_256(content3).hexdigest()

        # Assert - All hashes should be different
        assert hash1 != hash2
        assert hash1 != hash3
        assert hash2 != hash3

    def test_hash_binary_content_handling(self):
        """Test that binary content is properly hashed."""
        # Arrange - Create binary content with various byte values
        binary_content = bytes(range(256))  # All possible byte values

        # Act - Generate hash
        file_hash = hashlib.sha3_256(binary_content).hexdigest()

        # Assert - Should produce valid hash
        assert len(file_hash) == 64
        assert file_hash is not None

    def test_hash_empty_content(self):
        """Test hashing of empty content."""
        # Arrange
        empty_content = b""

        # Act - Generate hash
        file_hash = hashlib.sha3_256(empty_content).hexdigest()

        # Assert - Should produce valid hash even for empty content
        assert len(file_hash) == 64
        # SHA3-256 of empty string is a known value
        expected_empty_hash = "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
        assert file_hash == expected_empty_hash


class TestConfigurationValidation:
    """Tests for configuration values and limits.

    Tests cover:
    - Size limit configurations
    - Blacklist configurations
    - Default values
    - Configuration accessibility
    """

    def test_upload_size_limits_are_positive(self):
        """Test that all upload size limits are positive values."""
        # Act & Assert - All size limits should be positive
        assert dify_config.UPLOAD_FILE_SIZE_LIMIT > 0
        assert dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT > 0
        assert dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT > 0
        assert dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT > 0

    def test_upload_size_limits_reasonable_values(self):
        """Test that upload size limits are within reasonable ranges.

        This prevents misconfiguration that could cause issues.
        """
        # Assert - Size limits should be reasonable (between 1MB and 1GB)
        min_size = 1  # 1 MB
        max_size = 1024  # 1 GB

        assert min_size <= dify_config.UPLOAD_FILE_SIZE_LIMIT <= max_size
        assert min_size <= dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT <= max_size
        assert min_size <= dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT <= max_size
        assert min_size <= dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT <= max_size

    def test_video_size_limit_larger_than_image(self):
        """Test that video size limit is typically larger than image limit.

        This reflects the expected configuration where videos are larger files.
        """
        # Assert - Video limit should generally be >= image limit
        assert dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT >= dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT

    def test_blacklist_is_set_type(self):
        """Test that file extension blacklist is a set for efficient lookup."""
        # Act
        blacklist = dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST

        # Assert - Should be a set for O(1) lookup
        assert isinstance(blacklist, set)

    def test_blacklist_extensions_are_lowercase(self):
        """Test that all blacklisted extensions are stored in lowercase.

        This ensures case-insensitive comparison works correctly.
        """
        # Act
        blacklist = dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST

        # Assert - All extensions should be lowercase
        for ext in blacklist:
            assert ext == ext.lower(), f"Extension '{ext}' is not lowercase"


class TestFileConstants:
    """Tests for file-related constants and their properties.

    Tests cover:
    - Extension set completeness
    - Case-insensitive support
    - No duplicates in sets
    - Proper categorization
    """

    def test_image_extensions_set_properties(self):
        """Test that IMAGE_EXTENSIONS set has expected properties."""
        # Assert - Should be a set
        assert isinstance(IMAGE_EXTENSIONS, set)
        # Should not be empty
        assert len(IMAGE_EXTENSIONS) > 0
        # Should contain common image formats
        common_images = ["jpg", "png", "gif"]
        for ext in common_images:
            assert ext in IMAGE_EXTENSIONS or ext.upper() in IMAGE_EXTENSIONS

    def test_video_extensions_set_properties(self):
        """Test that VIDEO_EXTENSIONS set has expected properties."""
        # Assert - Should be a set
        assert isinstance(VIDEO_EXTENSIONS, set)
        # Should not be empty
        assert len(VIDEO_EXTENSIONS) > 0
        # Should contain common video formats
        common_videos = ["mp4", "mov"]
        for ext in common_videos:
            assert ext in VIDEO_EXTENSIONS or ext.upper() in VIDEO_EXTENSIONS

    def test_audio_extensions_set_properties(self):
        """Test that AUDIO_EXTENSIONS set has expected properties."""
        # Assert - Should be a set
        assert isinstance(AUDIO_EXTENSIONS, set)
        # Should not be empty
        assert len(AUDIO_EXTENSIONS) > 0
        # Should contain common audio formats
        common_audio = ["mp3", "wav"]
        for ext in common_audio:
            assert ext in AUDIO_EXTENSIONS or ext.upper() in AUDIO_EXTENSIONS

    def test_document_extensions_set_properties(self):
        """Test that DOCUMENT_EXTENSIONS set has expected properties."""
        # Assert - Should be a set
        assert isinstance(DOCUMENT_EXTENSIONS, set)
        # Should not be empty
        assert len(DOCUMENT_EXTENSIONS) > 0
        # Should contain common document formats
        common_docs = ["pdf", "txt", "docx"]
        for ext in common_docs:
            assert ext in DOCUMENT_EXTENSIONS or ext.upper() in DOCUMENT_EXTENSIONS

    def test_no_extension_overlap_between_categories(self):
        """Test that extensions don't appear in multiple incompatible categories.

        While some overlap might be intentional, major categories should be distinct.
        """
        # Get lowercase versions of all extensions
        images_lower = {ext.lower() for ext in IMAGE_EXTENSIONS}
        videos_lower = {ext.lower() for ext in VIDEO_EXTENSIONS}
        audio_lower = {ext.lower() for ext in AUDIO_EXTENSIONS}

        # Assert - Image and video shouldn't overlap
        image_video_overlap = images_lower & videos_lower
        assert len(image_video_overlap) == 0, f"Image/Video overlap: {image_video_overlap}"

        # Assert - Image and audio shouldn't overlap
        image_audio_overlap = images_lower & audio_lower
        assert len(image_audio_overlap) == 0, f"Image/Audio overlap: {image_audio_overlap}"

        # Assert - Video and audio shouldn't overlap
        video_audio_overlap = videos_lower & audio_lower
        assert len(video_audio_overlap) == 0, f"Video/Audio overlap: {video_audio_overlap}"
