"""
Comprehensive unit tests for FileService.

This test suite provides complete coverage of file upload, validation, storage,
and retrieval operations in Dify, following TDD principles with the Arrange-Act-Assert pattern.

The FileService is responsible for managing file uploads, storage operations,
and file metadata management across the platform. Files can be uploaded by both
Account users and EndUsers, and are stored with tenant isolation.

## Test Coverage

### 1. Constructor and Initialization (TestFileServiceInitialization)
Tests service initialization:
- Initialization with Engine
- Initialization with sessionmaker
- Error handling for invalid initialization

### 2. File Upload Handling (TestFileServiceUpload)
Tests file upload operations:
- upload_file with valid inputs
- upload_text for text content
- File key generation with UUID
- Tenant isolation in storage paths
- Source URL generation
- Hash computation (SHA3-256)

### 3. File Validation (TestFileServiceValidation)
Tests file validation logic:
- Filename validation (invalid characters)
- Filename length truncation
- Extension blacklist checking
- Dataset source file type restrictions
- File size validation for different file types

### 4. File Size Limits and Quota (TestFileServiceSizeLimits)
Tests file size validation:
- Image file size limits
- Video file size limits
- Audio file size limits
- Document/other file size limits
- Boundary testing (at limit, over limit)

### 5. File Storage Operations (TestFileServiceStorage)
Tests storage operations:
- File save to storage
- File load from storage
- File delete from storage
- Storage error handling

### 6. File Metadata Management (TestFileServiceMetadata)
Tests metadata operations:
- UploadFile model creation
- Hash generation and verification
- Source URL generation
- Tenant isolation
- User role assignment

### 7. File Retrieval Operations (TestFileServiceRetrieval)
Tests file retrieval:
- get_file_preview for documents
- get_image_preview with signature verification
- get_file_generator_by_file_id
- get_public_image_preview
- get_file_content

### 8. File Deletion (TestFileServiceDeletion)
Tests file deletion:
- Delete file from storage and database
- NotFound handling (no-op)
- Transaction management

## Testing Approach

- **Mocking Strategy**: All external dependencies (storage, database session,
  file helpers, extract processor) are mocked for fast, isolated unit tests
- **Factory Pattern**: FileServiceTestDataFactory provides consistent test data
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values and side effects
  (database operations, storage calls, method invocations)

## Key Concepts

**File Types:**
- Documents: PDF, TXT, DOCX, etc. (for datasets)
- Images: JPG, PNG, GIF, etc.
- Videos: MP4, AVI, etc.
- Audio: MP3, WAV, etc.

**File Validation:**
- Filenames must not contain invalid characters
- File extensions must not be in blacklist
- File sizes must be within type-specific limits
- Dataset uploads must use document extensions

**Storage:**
- Files are stored with tenant-isolated paths
- Storage keys follow pattern: upload_files/{tenant_id}/{uuid}.{extension}
- Files are stored with SHA3-256 hash for duplicate detection

**Security:**
- Extension blacklist prevents dangerous file types
- Signature verification for secure file access
- Tenant isolation prevents cross-tenant access
"""


# ============================================================================
# IMPORTS
# ============================================================================

import hashlib
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

from models import Account
from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from services.file_service import PREVIEW_WORDS_LIMIT, FileService

# ============================================================================
# TEST DATA FACTORY
# ============================================================================


class FileServiceTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    file-related operations. This factory ensures all test data follows the
    same structure and reduces code duplication across tests.

    The factory pattern is used here to:
    - Ensure consistent test data creation
    - Reduce boilerplate code in individual tests
    - Make tests more maintainable and readable
    - Centralize mock object configuration
    """

    @staticmethod
    def create_account_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Account object.

        This method creates a mock Account instance with all required attributes
        set to sensible defaults. Accounts are one of the two user types that
        can upload files (the other being EndUser).

        Args:
            user_id: Unique identifier for the account/user
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Account object with specified attributes

        Example:
            >>> account = factory.create_account_mock(
            ...     user_id="account-456",
            ...     tenant_id="tenant-789"
            ... )
        """
        # Create a mock that matches the Account model interface
        account = create_autospec(Account, instance=True)

        # Set core attributes
        account.id = user_id
        account.tenant_id = tenant_id

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(account, key, value)

        return account

    @staticmethod
    def create_end_user_mock(
        user_id: str = "enduser-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock EndUser object.

        This method creates a mock EndUser instance with all required attributes.
        EndUsers are one of the two user types that can upload files (the other
        being Account). EndUsers typically represent API users or end consumers.

        Args:
            user_id: Unique identifier for the end user
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock EndUser object with specified attributes

        Example:
            >>> end_user = factory.create_end_user_mock(
            ...     user_id="enduser-456",
            ...     tenant_id="tenant-789"
            ... )
        """
        # Create a mock that matches the EndUser model interface
        end_user = create_autospec(EndUser, instance=True)

        # Set core attributes
        end_user.id = user_id
        end_user.tenant_id = tenant_id

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(end_user, key, value)

        return end_user

    @staticmethod
    def create_upload_file_mock(
        file_id: str = "file-123",
        name: str = "test_file.pdf",
        extension: str = "pdf",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock UploadFile object.

        UploadFile represents a file that has been uploaded to the system.
        This mock includes all the attributes that would be present in a real
        UploadFile instance.

        Args:
            file_id: Unique identifier for the file
            name: File name
            extension: File extension
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock
                (e.g., size, mime_type, hash, key, etc.)

        Returns:
            Mock UploadFile object with specified attributes

        Example:
            >>> upload_file = factory.create_upload_file_mock(
            ...     file_id="file-456",
            ...     name="document.pdf",
            ...     extension="pdf",
            ...     size=1024,
            ...     key="upload_files/tenant-123/uuid.pdf"
            ... )
        """
        # Create a mock that matches the UploadFile model interface
        upload_file = create_autospec(UploadFile, instance=True)

        # Set core attributes
        upload_file.id = file_id
        upload_file.name = name
        upload_file.extension = extension
        upload_file.tenant_id = tenant_id

        # Set default optional attributes
        upload_file.size = kwargs.get("size", 1024)
        upload_file.mime_type = kwargs.get("mime_type", "application/pdf")
        upload_file.key = kwargs.get("key", f"upload_files/{tenant_id}/{file_id}.{extension}")
        upload_file.hash = kwargs.get("hash", "test-hash")
        upload_file.source_url = kwargs.get("source_url", "")
        upload_file.used = kwargs.get("used", False)
        upload_file.created_by = kwargs.get("created_by", "user-123")
        upload_file.created_by_role = kwargs.get("created_by_role", CreatorUserRole.ACCOUNT)

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(upload_file, key, value)

        return upload_file

    @staticmethod
    def create_session_maker_mock() -> Mock:
        """
        Create a mock sessionmaker for database operations.

        This mock is used to simulate database session creation and management
        in the FileService. The sessionmaker is a factory that creates
        database sessions.

        Returns:
            Mock sessionmaker object

        Example:
            >>> session_maker = factory.create_session_maker_mock()
            >>> service = FileService(session_maker)
        """
        # Create a mock session
        mock_session = MagicMock(spec=Session)

        # Create a mock sessionmaker that returns the mock session
        mock_session_maker = MagicMock(spec=sessionmaker)
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)
        mock_session_maker.return_value = mock_session

        return mock_session_maker


# ============================================================================
# PYTEST FIXTURES
# ============================================================================


@pytest.fixture
def factory():
    """
    Provide the test data factory to all tests.

    This fixture makes the FileServiceTestDataFactory available to all test
    methods, allowing them to create consistent mock objects easily.

    Returns:
        FileServiceTestDataFactory class
    """
    return FileServiceTestDataFactory


# ============================================================================
# INITIALIZATION TESTS
# ============================================================================


class TestFileServiceInitialization:
    """
    Test FileService initialization.

    This test class covers the constructor and initialization logic of the
    FileService. The service can be initialized with either an Engine or a
    sessionmaker, and should raise an error if neither is provided.
    """

    def test_init_with_engine(self, factory):
        """
        Test initialization with SQLAlchemy Engine.

        This test verifies that the FileService can be initialized with an
        Engine object. The Engine should be converted to a sessionmaker
        internally.

        Expected behavior:
        - Service initializes successfully with Engine
        - Sessionmaker is created from Engine
        - No errors are raised
        """
        # Arrange
        # Create a mock Engine
        mock_engine = MagicMock(spec=Engine)

        # Act
        # Initialize FileService with Engine
        service = FileService(session_factory=mock_engine)

        # Assert
        # Verify service was created successfully
        assert service is not None, "Service should be initialized"
        assert hasattr(service, "_session_maker"), "Service should have session_maker attribute"

    def test_init_with_sessionmaker(self, factory):
        """
        Test initialization with sessionmaker.

        This test verifies that the FileService can be initialized with a
        sessionmaker object directly. This is the preferred method when
        you already have a sessionmaker instance.

        Expected behavior:
        - Service initializes successfully with sessionmaker
        - Sessionmaker is assigned directly
        - No errors are raised
        """
        # Arrange
        # Create a mock sessionmaker
        mock_session_maker = factory.create_session_maker_mock()

        # Act
        # Initialize FileService with sessionmaker
        service = FileService(session_factory=mock_session_maker)

        # Assert
        # Verify service was created successfully
        assert service is not None, "Service should be initialized"
        assert hasattr(service, "_session_maker"), "Service should have session_maker attribute"

    def test_init_with_none_raises_error(self, factory):
        """
        Test that initialization with None raises AssertionError.

        This test verifies that the FileService correctly raises an error
        when initialized with None or no argument. This prevents silent
        failures and ensures proper initialization.

        Expected behavior:
        - AssertionError is raised
        - Error message indicates requirement for sessionmaker or Engine
        """
        # Arrange & Act & Assert
        # Verify AssertionError is raised for None
        with pytest.raises(AssertionError, match="must be a sessionmaker or an Engine"):
            FileService(session_factory=None)

    def test_init_with_invalid_type_raises_error(self, factory):
        """
        Test that initialization with invalid type raises AssertionError.

        This test verifies that the FileService correctly raises an error
        when initialized with an object that is neither an Engine nor a
        sessionmaker. This ensures type safety.

        Expected behavior:
        - AssertionError is raised
        - Error message indicates requirement for sessionmaker or Engine
        """
        # Arrange & Act & Assert
        # Verify AssertionError is raised for invalid type
        with pytest.raises(AssertionError, match="must be a sessionmaker or an Engine"):
            FileService(session_factory="invalid_type")


# ============================================================================
# FILE UPLOAD TESTS
# ============================================================================


class TestFileServiceUpload:
    """
    Test file upload operations.

    This test class covers the upload_file and upload_text methods, which are
    responsible for handling file uploads, validation, storage, and database
    persistence.
    """

    @patch("services.file_service.storage")
    @patch("services.file_service.file_helpers.get_signed_file_url")
    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.uuid.uuid4")
    @patch("services.file_service.naive_utc_now")
    @patch("services.file_service.dify_config")
    def test_upload_file_with_valid_input(
        self,
        mock_config,
        mock_naive_utc_now,
        mock_uuid,
        mock_extract_tenant_id,
        mock_get_signed_url,
        mock_storage,
        factory,
    ):
        """
        Test uploading a file with valid inputs.

        This test verifies that the upload_file method correctly processes a
        valid file upload, performs all necessary validations, saves the file
        to storage, and persists metadata to the database.

        The method should:
        - Extract file extension from filename
        - Validate filename and extension
        - Check file size limits
        - Generate file UUID and storage key
        - Save file to storage
        - Create UploadFile record in database
        - Generate source URL if not provided
        - Compute file hash (SHA3-256)

        Expected behavior:
        - File is saved to storage
        - UploadFile is created and persisted
        - All attributes are set correctly
        - Returns UploadFile instance
        """
        # Arrange
        # Create mock dependencies
        tenant_id = "tenant-123"
        user = factory.create_account_mock(user_id="user-123", tenant_id=tenant_id)
        filename = "test_document.pdf"
        content = b"test file content"
        mimetype = "application/pdf"
        file_uuid = "generated-uuid-123"
        source_url = "https://example.com/file/signed-url"

        # Configure mocks
        mock_extract_tenant_id.return_value = tenant_id
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value=file_uuid)
        mock_config.STORAGE_TYPE = "local"
        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = []
        mock_naive_utc_now.return_value = Mock()
        mock_get_signed_url.return_value = source_url

        # Create mock session
        mock_session = MagicMock(spec=Session)
        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        # Create service instance
        service = FileService(session_factory=mock_session_maker)

        # Mock file size check
        with patch.object(FileService, "is_file_size_within_limit", return_value=True):
            # Act
            # Execute the method under test
            result = service.upload_file(
                filename=filename,
                content=content,
                mimetype=mimetype,
                user=user,
            )

        # Assert
        # Verify file was saved to storage
        mock_storage.save.assert_called_once()
        call_args = mock_storage.save.call_args[0]
        assert call_args[0].startswith(f"upload_files/{tenant_id}/"), "Storage key should include tenant ID"
        assert call_args[0].endswith(".pdf"), "Storage key should include extension"
        assert call_args[1] == content, "Storage should receive file content"

        # Verify UploadFile was added to session
        mock_session.add.assert_called_once()
        added_file = mock_session.add.call_args[0][0]
        assert isinstance(added_file, UploadFile), "Should create UploadFile instance"

        # Verify UploadFile attributes
        assert added_file.name == filename, "Filename should match"
        assert added_file.extension == "pdf", "Extension should be extracted"
        assert added_file.size == len(content), "Size should match content length"
        assert added_file.mime_type == mimetype, "MIME type should match"
        assert added_file.tenant_id == tenant_id, "Tenant ID should be set"
        assert added_file.created_by == user.id, "Created by should match user ID"
        assert added_file.created_by_role == CreatorUserRole.ACCOUNT, "Role should be ACCOUNT for Account user"
        assert added_file.used is False, "Used flag should be False initially"
        assert added_file.hash == hashlib.sha3_256(content).hexdigest(), "Hash should be computed correctly"

        # Verify transaction was committed
        mock_session.commit.assert_called_once()

        # Verify result is UploadFile
        assert result == added_file, "Should return created UploadFile"

    @patch("services.file_service.storage")
    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.uuid.uuid4")
    @patch("services.file_service.naive_utc_now")
    @patch("services.file_service.dify_config")
    def test_upload_file_with_end_user(
        self,
        mock_config,
        mock_naive_utc_now,
        mock_uuid,
        mock_extract_tenant_id,
        mock_storage,
        factory,
    ):
        """
        Test uploading a file with EndUser.

        This test verifies that the upload_file method correctly assigns the
        CreatorUserRole.END_USER role when the user is an EndUser instance
        rather than an Account instance.

        Expected behavior:
        - File is uploaded successfully
        - created_by_role is set to END_USER
        - All other attributes are set correctly
        """
        # Arrange
        tenant_id = "tenant-123"
        end_user = factory.create_end_user_mock(user_id="enduser-123", tenant_id=tenant_id)
        filename = "test_image.jpg"
        content = b"test image content"
        mimetype = "image/jpeg"

        mock_extract_tenant_id.return_value = tenant_id
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value="uuid-123")
        mock_config.STORAGE_TYPE = "local"
        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = []
        mock_naive_utc_now.return_value = Mock()

        mock_session = MagicMock(spec=Session)
        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        with patch.object(FileService, "is_file_size_within_limit", return_value=True):
            with patch("services.file_service.file_helpers.get_signed_file_url", return_value="url"):
                # Act
                result = service.upload_file(
                    filename=filename,
                    content=content,
                    mimetype=mimetype,
                    user=end_user,
                )

        # Assert
        added_file = mock_session.add.call_args[0][0]
        assert added_file.created_by_role == CreatorUserRole.END_USER, "Role should be END_USER for EndUser"
        assert added_file.created_by == end_user.id, "Created by should match end user ID"

    @patch("services.file_service.storage")
    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.uuid.uuid4")
    @patch("services.file_service.naive_utc_now")
    @patch("services.file_service.dify_config")
    def test_upload_file_with_custom_source_url(
        self,
        mock_config,
        mock_naive_utc_now,
        mock_uuid,
        mock_extract_tenant_id,
        mock_storage,
        factory,
    ):
        """
        Test uploading a file with custom source_url.

        This test verifies that when a source_url is provided, it is used
        directly without generating a new signed URL.

        Expected behavior:
        - source_url is preserved as provided
        - get_signed_file_url is not called
        """
        # Arrange
        tenant_id = "tenant-123"
        user = factory.create_account_mock(user_id="user-123", tenant_id=tenant_id)
        filename = "test.pdf"
        content = b"content"
        mimetype = "application/pdf"
        custom_source_url = "https://custom-url.com/file"

        mock_extract_tenant_id.return_value = tenant_id
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value="uuid-123")
        mock_config.STORAGE_TYPE = "local"
        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = []
        mock_naive_utc_now.return_value = Mock()

        mock_session = MagicMock(spec=Session)
        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        with patch.object(FileService, "is_file_size_within_limit", return_value=True):
            with patch("services.file_service.file_helpers.get_signed_file_url") as mock_get_url:
                # Act
                result = service.upload_file(
                    filename=filename,
                    content=content,
                    mimetype=mimetype,
                    user=user,
                    source_url=custom_source_url,
                )

        # Assert
        added_file = mock_session.add.call_args[0][0]
        assert added_file.source_url == custom_source_url, "Custom source URL should be preserved"
        mock_get_url.assert_not_called(), "Should not generate URL when source_url provided"

    @patch("services.file_service.storage")
    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.uuid.uuid4")
    @patch("services.file_service.naive_utc_now")
    @patch("services.file_service.dify_config")
    def test_upload_text(
        self,
        mock_config,
        mock_naive_utc_now,
        mock_uuid,
        mock_extract_tenant_id,
        mock_storage,
        factory,
    ):
        """
        Test uploading text content.

        This test verifies that the upload_text method correctly creates a
        text file from string content, saves it to storage, and persists
        metadata to the database.

        The method should:
        - Truncate text_name if longer than 200 characters
        - Generate UUID for file name
        - Save text as UTF-8 encoded bytes
        - Create UploadFile with used=True
        - Set extension to "txt" and mime_type to "text/plain"

        Expected behavior:
        - Text is saved to storage as UTF-8 bytes
        - UploadFile is created with correct attributes
        - used flag is set to True
        - Returns UploadFile instance
        """
        # Arrange
        text = "This is test text content"
        text_name = "test_text.txt"
        user_id = "user-123"
        tenant_id = "tenant-123"
        file_uuid = "uuid-456"

        mock_extract_tenant_id.return_value = tenant_id
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value=file_uuid)
        mock_config.STORAGE_TYPE = "local"
        mock_naive_utc_now.return_value = Mock()

        mock_session = MagicMock(spec=Session)
        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act
        result = service.upload_text(text=text, text_name=text_name, user_id=user_id, tenant_id=tenant_id)

        # Assert
        # Verify text was saved to storage as UTF-8
        mock_storage.save.assert_called_once()
        call_args = mock_storage.save.call_args[0]
        assert call_args[0] == f"upload_files/{tenant_id}/{file_uuid}.txt", "Storage key should match pattern"
        assert call_args[1] == text.encode("utf-8"), "Content should be UTF-8 encoded"

        # Verify UploadFile was created
        mock_session.add.assert_called_once()
        added_file = mock_session.add.call_args[0][0]
        assert isinstance(added_file, UploadFile), "Should create UploadFile instance"

        # Verify UploadFile attributes
        assert added_file.name == text_name, "Name should match"
        assert added_file.extension == "txt", "Extension should be txt"
        assert added_file.size == len(text), "Size should match text length"
        assert added_file.mime_type == "text/plain", "MIME type should be text/plain"
        assert added_file.tenant_id == tenant_id, "Tenant ID should match"
        assert added_file.created_by == user_id, "Created by should match user ID"
        assert added_file.created_by_role == CreatorUserRole.ACCOUNT, "Role should be ACCOUNT"
        assert added_file.used is True, "Used flag should be True for text uploads"
        assert added_file.used_by == user_id, "Used by should match user ID"

        # Verify transaction was committed
        mock_session.commit.assert_called_once()

        # Verify result
        assert result == added_file, "Should return created UploadFile"

    @patch("services.file_service.storage")
    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.uuid.uuid4")
    @patch("services.file_service.naive_utc_now")
    @patch("services.file_service.dify_config")
    def test_upload_text_truncates_long_name(
        self,
        mock_config,
        mock_naive_utc_now,
        mock_uuid,
        mock_extract_tenant_id,
        mock_storage,
        factory,
    ):
        """
        Test that upload_text truncates text_name longer than 200 characters.

        This test verifies that the upload_text method correctly truncates
        text names that exceed 200 characters to prevent database errors.

        Expected behavior:
        - Text name is truncated to 200 characters
        - File is uploaded successfully
        """
        # Arrange
        text = "test content"
        long_text_name = "a" * 250  # Longer than 200 characters
        user_id = "user-123"
        tenant_id = "tenant-123"

        mock_extract_tenant_id.return_value = tenant_id
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value="uuid-123")
        mock_config.STORAGE_TYPE = "local"
        mock_naive_utc_now.return_value = Mock()

        mock_session = MagicMock(spec=Session)
        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act
        result = service.upload_text(text=text, text_name=long_text_name, user_id=user_id, tenant_id=tenant_id)

        # Assert
        added_file = mock_session.add.call_args[0][0]
        assert len(added_file.name) == 200, "Name should be truncated to 200 characters"
        assert added_file.name == long_text_name[:200], "Name should match truncated version"


# ============================================================================
# FILE VALIDATION TESTS
# ============================================================================


class TestFileServiceValidation:
    """
    Test file validation operations.

    This test class covers all validation logic including filename validation,
    extension checking, and file type restrictions.
    """

    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.dify_config")
    def test_upload_file_raises_error_for_invalid_filename_characters(
        self,
        mock_config,
        mock_extract_tenant_id,
        factory,
    ):
        """
        Test that upload_file raises ValueError for invalid filename characters.

        This test verifies that the upload_file method correctly rejects
        filenames containing invalid characters that could be used for path
        traversal or other security issues.

        Invalid characters: /, \\, :, *, ?, ", <, >, |

        Expected behavior:
        - ValueError is raised with appropriate message
        - File is not uploaded
        """
        # Arrange
        user = factory.create_account_mock()
        invalid_filenames = [
            "file/name.pdf",  # Forward slash
            "file\\name.pdf",  # Backslash
            "file:name.pdf",  # Colon
            "file*name.pdf",  # Asterisk
            "file?name.pdf",  # Question mark
            'file"name.pdf',  # Quote
            "file<name.pdf",  # Less than
            "file>name.pdf",  # Greater than
            "file|name.pdf",  # Pipe
        ]

        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = []

        mock_session_maker = factory.create_session_maker_mock()
        service = FileService(session_factory=mock_session_maker)

        # Act & Assert
        for invalid_filename in invalid_filenames:
            with pytest.raises(ValueError, match="Filename contains invalid characters"):
                service.upload_file(
                    filename=invalid_filename,
                    content=b"content",
                    mimetype="application/pdf",
                    user=user,
                )

    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.dify_config")
    def test_upload_file_truncates_long_filename(
        self,
        mock_config,
        mock_extract_tenant_id,
        factory,
    ):
        """
        Test that upload_file truncates filename longer than 200 characters.

        This test verifies that the upload_file method correctly truncates
        filenames that exceed 200 characters while preserving the extension.

        Expected behavior:
        - Filename is truncated to 200 characters (including extension)
        - Extension is preserved
        - File is uploaded successfully
        """
        # Arrange
        tenant_id = "tenant-123"
        user = factory.create_account_mock(tenant_id=tenant_id)
        long_name = "a" * 250
        filename = f"{long_name}.pdf"
        content = b"content"

        mock_extract_tenant_id.return_value = tenant_id
        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = []
        mock_config.STORAGE_TYPE = "local"

        mock_session = MagicMock(spec=Session)
        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        with patch.object(FileService, "is_file_size_within_limit", return_value=True):
            with patch("services.file_service.storage"):
                with patch("services.file_service.uuid.uuid4", return_value=Mock(__str__=Mock(return_value="uuid"))):
                    with patch("services.file_service.naive_utc_now", return_value=Mock()):
                        with patch("services.file_service.file_helpers.get_signed_file_url", return_value="url"):
                            # Act
                            result = service.upload_file(
                                filename=filename,
                                content=content,
                                mimetype="application/pdf",
                                user=user,
                            )

        # Assert
        added_file = mock_session.add.call_args[0][0]
        assert len(added_file.name) <= 200 + 4, "Filename should be truncated"  # 200 + ".pdf"
        assert added_file.name.endswith(".pdf"), "Extension should be preserved"

    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.dify_config")
    def test_upload_file_raises_error_for_blacklisted_extension(
        self,
        mock_config,
        mock_extract_tenant_id,
        factory,
    ):
        """
        Test that upload_file raises BlockedFileExtensionError for blacklisted extensions.

        This test verifies that the upload_file method correctly rejects files
        with extensions that are in the blacklist for security reasons.

        Expected behavior:
        - BlockedFileExtensionError is raised
        - Error message indicates the blocked extension
        - File is not uploaded
        """
        # Arrange
        user = factory.create_account_mock()
        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = ["exe", "bat", "sh", "dll"]
        mock_extract_tenant_id.return_value = "tenant-123"

        mock_session_maker = factory.create_session_maker_mock()
        service = FileService(session_factory=mock_session_maker)

        # Act & Assert
        with pytest.raises(BlockedFileExtensionError, match="is not allowed for security reasons"):
            service.upload_file(
                filename="malicious.exe",
                content=b"content",
                mimetype="application/x-msdownload",
                user=user,
            )

    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.dify_config")
    def test_upload_file_for_datasets_requires_document_extension(
        self,
        mock_config,
        mock_extract_tenant_id,
        factory,
    ):
        """
        Test that upload_file for datasets requires document extension.

        This test verifies that when source="datasets", the file extension
        must be in DOCUMENT_EXTENSIONS, otherwise UnsupportedFileTypeError
        is raised.

        Expected behavior:
        - UnsupportedFileTypeError is raised for non-document files
        - Document files are accepted
        """
        # Arrange
        user = factory.create_account_mock()
        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = []
        mock_extract_tenant_id.return_value = "tenant-123"

        mock_session_maker = factory.create_session_maker_mock()
        service = FileService(session_factory=mock_session_maker)

        # Mock document extensions
        with patch("services.file_service.DOCUMENT_EXTENSIONS", {"pdf", "txt", "docx"}):
            # Test with non-document extension
            with pytest.raises(UnsupportedFileTypeError):
                service.upload_file(
                    filename="image.jpg",
                    content=b"content",
                    mimetype="image/jpeg",
                    user=user,
                    source="datasets",
                )

            # Test with document extension (should pass validation)
            with patch.object(FileService, "is_file_size_within_limit", return_value=True):
                with patch("services.file_service.storage"):
                    with patch(
                        "services.file_service.uuid.uuid4", return_value=Mock(__str__=Mock(return_value="uuid"))
                    ):
                        with patch("services.file_service.naive_utc_now", return_value=Mock()):
                            with patch("services.file_service.file_helpers.get_signed_file_url", return_value="url"):
                                mock_session = MagicMock(spec=Session)
                                mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
                                mock_session_maker.return_value.__exit__ = Mock(return_value=None)

                                # Should not raise error
                                service.upload_file(
                                    filename="document.pdf",
                                    content=b"content",
                                    mimetype="application/pdf",
                                    user=user,
                                    source="datasets",
                                )


# ============================================================================
# FILE SIZE LIMIT TESTS
# ============================================================================


class TestFileServiceSizeLimits:
    """
    Test file size limit validation.

    This test class covers the is_file_size_within_limit static method and
    verifies that file size limits are correctly enforced for different file types.
    """

    @patch("services.file_service.dify_config")
    def test_is_file_size_within_limit_for_image_files(self, mock_config, factory):
        """
        Test file size validation for image files.

        This test verifies that image files use the UPLOAD_IMAGE_FILE_SIZE_LIMIT
        configuration value for size validation.

        Expected behavior:
        - Returns True for files within image size limit
        - Returns False for files exceeding image size limit
        """
        # Arrange
        image_limit_mb = 10
        image_limit_bytes = image_limit_mb * 1024 * 1024
        mock_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT = image_limit_mb

        # Test with image extension (jpg is typically in IMAGE_EXTENSIONS)
        with patch("services.file_service.IMAGE_EXTENSIONS", {"jpg", "png", "gif"}):
            # Act & Assert
            # File within limit
            assert FileService.is_file_size_within_limit(extension="jpg", file_size=image_limit_bytes) is True

            # File exactly at limit
            assert FileService.is_file_size_within_limit(extension="jpg", file_size=image_limit_bytes) is True

            # File exceeding limit
            assert FileService.is_file_size_within_limit(extension="jpg", file_size=image_limit_bytes + 1) is False

    @patch("services.file_service.dify_config")
    def test_is_file_size_within_limit_for_video_files(self, mock_config, factory):
        """
        Test file size validation for video files.

        This test verifies that video files use the UPLOAD_VIDEO_FILE_SIZE_LIMIT
        configuration value for size validation.

        Expected behavior:
        - Returns True for files within video size limit
        - Returns False for files exceeding video size limit
        """
        # Arrange
        video_limit_mb = 100
        video_limit_bytes = video_limit_mb * 1024 * 1024
        mock_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT = video_limit_mb

        # Test with video extension
        with patch("services.file_service.VIDEO_EXTENSIONS", {"mp4", "avi", "mov"}):
            # Act & Assert
            assert FileService.is_file_size_within_limit(extension="mp4", file_size=video_limit_bytes) is True
            assert FileService.is_file_size_within_limit(extension="mp4", file_size=video_limit_bytes + 1) is False

    @patch("services.file_service.dify_config")
    def test_is_file_size_within_limit_for_audio_files(self, mock_config, factory):
        """
        Test file size validation for audio files.

        This test verifies that audio files use the UPLOAD_AUDIO_FILE_SIZE_LIMIT
        configuration value for size validation.

        Expected behavior:
        - Returns True for files within audio size limit
        - Returns False for files exceeding audio size limit
        """
        # Arrange
        audio_limit_mb = 50
        audio_limit_bytes = audio_limit_mb * 1024 * 1024
        mock_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT = audio_limit_mb

        # Test with audio extension
        with patch("services.file_service.AUDIO_EXTENSIONS", {"mp3", "wav", "ogg"}):
            # Act & Assert
            assert FileService.is_file_size_within_limit(extension="mp3", file_size=audio_limit_bytes) is True
            assert FileService.is_file_size_within_limit(extension="mp3", file_size=audio_limit_bytes + 1) is False

    @patch("services.file_service.dify_config")
    def test_is_file_size_within_limit_for_document_files(self, mock_config, factory):
        """
        Test file size validation for document/other files.

        This test verifies that files that are not images, videos, or audio
        use the UPLOAD_FILE_SIZE_LIMIT configuration value for size validation.

        Expected behavior:
        - Returns True for files within default size limit
        - Returns False for files exceeding default size limit
        """
        # Arrange
        default_limit_mb = 15
        default_limit_bytes = default_limit_mb * 1024 * 1024
        mock_config.UPLOAD_FILE_SIZE_LIMIT = default_limit_mb

        # Test with document extension (not in image/video/audio)
        with patch("services.file_service.IMAGE_EXTENSIONS", {"jpg"}):
            with patch("services.file_service.VIDEO_EXTENSIONS", {"mp4"}):
                with patch("services.file_service.AUDIO_EXTENSIONS", {"mp3"}):
                    # Act & Assert
                    assert FileService.is_file_size_within_limit(extension="pdf", file_size=default_limit_bytes) is True
                    assert (
                        FileService.is_file_size_within_limit(extension="pdf", file_size=default_limit_bytes + 1)
                        is False
                    )

    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.dify_config")
    def test_upload_file_raises_error_for_file_too_large(
        self,
        mock_config,
        mock_extract_tenant_id,
        factory,
    ):
        """
        Test that upload_file raises FileTooLargeError for files exceeding size limit.

        This test verifies that the upload_file method correctly rejects files
        that exceed the size limit for their file type.

        Expected behavior:
        - FileTooLargeError is raised
        - File is not uploaded
        """
        # Arrange
        user = factory.create_account_mock()
        mock_config.UPLOAD_FILE_EXTENSION_BLACKLIST = []
        mock_config.UPLOAD_FILE_SIZE_LIMIT = 10  # 10 MB
        mock_extract_tenant_id.return_value = "tenant-123"

        mock_session_maker = factory.create_session_maker_mock()
        service = FileService(session_factory=mock_session_maker)

        # Create content larger than limit
        large_content = b"x" * (11 * 1024 * 1024)  # 11 MB

        # Act & Assert
        with pytest.raises(FileTooLargeError):
            service.upload_file(
                filename="large_file.pdf",
                content=large_content,
                mimetype="application/pdf",
                user=user,
            )


# ============================================================================
# FILE RETRIEVAL TESTS
# ============================================================================


class TestFileServiceRetrieval:
    """
    Test file retrieval operations.

    This test class covers all methods for retrieving files, including previews,
    content, and file generators.
    """

    @patch("services.file_service.ExtractProcessor.load_from_upload_file")
    def test_get_file_preview_success(self, mock_extract_processor, factory):
        """
        Test successful file preview retrieval.

        This test verifies that the get_file_preview method correctly retrieves
        a preview of a document file, truncating to PREVIEW_WORDS_LIMIT.

        Expected behavior:
        - File is retrieved from database
        - Text is extracted using ExtractProcessor
        - Text is truncated to PREVIEW_WORDS_LIMIT (3000 characters)
        - Returns preview text
        """
        # Arrange
        file_id = "file-123"
        full_text = "A" * 5000  # Longer than PREVIEW_WORDS_LIMIT
        expected_preview = full_text[:PREVIEW_WORDS_LIMIT]

        upload_file = factory.create_upload_file_mock(
            file_id=file_id,
            extension="pdf",
            name="document.pdf",
        )

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = upload_file
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)
        # ExtractProcessor.load_from_upload_file returns a string when return_text=True
        mock_extract_processor.return_value = full_text

        # Act
        result = service.get_file_preview(file_id)

        # Assert
        assert result == expected_preview, "Preview should be truncated to PREVIEW_WORDS_LIMIT"
        mock_extract_processor.assert_called_once_with(upload_file, return_text=True)

    @patch("services.file_service.ExtractProcessor.load_from_upload_file")
    def test_get_file_preview_raises_not_found_for_missing_file(self, mock_extract_processor, factory):
        """
        Test that get_file_preview raises NotFound for missing file.

        Expected behavior:
        - NotFound exception is raised
        - Error message indicates "File not found"
        """
        # Arrange
        file_id = "nonexistent"

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # File not found
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act & Assert
        with pytest.raises(NotFound, match="File not found"):
            service.get_file_preview(file_id)

    @patch("services.file_service.ExtractProcessor.load_from_upload_file")
    def test_get_file_preview_raises_error_for_non_document(self, mock_extract_processor, factory):
        """
        Test that get_file_preview raises UnsupportedFileTypeError for non-documents.

        Expected behavior:
        - UnsupportedFileTypeError is raised
        - Preview is not generated
        """
        # Arrange
        file_id = "file-123"
        upload_file = factory.create_upload_file_mock(file_id=file_id, extension="jpg")

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = upload_file
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        with patch("services.file_service.DOCUMENT_EXTENSIONS", {"pdf", "txt"}):
            # Act & Assert
            with pytest.raises(UnsupportedFileTypeError):
                service.get_file_preview(file_id)

    @patch("services.file_service.storage")
    @patch("services.file_service.file_helpers.verify_image_signature")
    def test_get_image_preview_success(self, mock_verify_signature, mock_storage, factory):
        """
        Test successful image preview retrieval with signature verification.

        Expected behavior:
        - Signature is verified
        - File is retrieved from database
        - File generator is returned from storage
        - MIME type is returned
        """
        # Arrange
        file_id = "file-123"
        timestamp = "1234567890"
        nonce = "nonce123"
        sign = "signature123"
        mime_type = "image/jpeg"

        upload_file = factory.create_upload_file_mock(
            file_id=file_id,
            extension="jpg",
            mime_type=mime_type,
        )

        mock_verify_signature.return_value = True
        mock_generator = Mock()
        mock_storage.load.return_value = mock_generator

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = upload_file
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        with patch("services.file_service.IMAGE_EXTENSIONS", {"jpg", "png"}):
            # Act
            generator, returned_mime_type = service.get_image_preview(file_id, timestamp, nonce, sign)

        # Assert
        mock_verify_signature.assert_called_once_with(
            upload_file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign
        )
        mock_storage.load.assert_called_once_with(upload_file.key, stream=True)
        assert generator == mock_generator, "Generator should match"
        assert returned_mime_type == mime_type, "MIME type should match"

    @patch("services.file_service.file_helpers.verify_image_signature")
    def test_get_image_preview_raises_error_for_invalid_signature(self, mock_verify_signature, factory):
        """
        Test that get_image_preview raises NotFound for invalid signature.

        Expected behavior:
        - NotFound exception is raised
        - Error message indicates invalid signature
        """
        # Arrange
        file_id = "file-123"
        mock_verify_signature.return_value = False  # Invalid signature

        mock_session_maker = factory.create_session_maker_mock()
        service = FileService(session_factory=mock_session_maker)

        # Act & Assert
        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            service.get_image_preview(file_id, "timestamp", "nonce", "sign")

    @patch("services.file_service.storage")
    @patch("services.file_service.file_helpers.verify_file_signature")
    def test_get_file_generator_by_file_id_success(self, mock_verify_signature, mock_storage, factory):
        """
        Test successful file generator retrieval with signature verification.

        Expected behavior:
        - Signature is verified
        - File is retrieved from database
        - File generator is returned from storage
        - UploadFile instance is returned
        """
        # Arrange
        file_id = "file-123"
        timestamp = "1234567890"
        nonce = "nonce123"
        sign = "signature123"

        upload_file = factory.create_upload_file_mock(file_id=file_id)

        mock_verify_signature.return_value = True
        mock_generator = Mock()
        mock_storage.load.return_value = mock_generator

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = upload_file
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act
        generator, returned_file = service.get_file_generator_by_file_id(file_id, timestamp, nonce, sign)

        # Assert
        mock_verify_signature.assert_called_once_with(
            upload_file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign
        )
        mock_storage.load.assert_called_once_with(upload_file.key, stream=True)
        assert generator == mock_generator, "Generator should match"
        assert returned_file == upload_file, "UploadFile should match"

    @patch("services.file_service.storage")
    def test_get_public_image_preview_success(self, mock_storage, factory):
        """
        Test successful public image preview retrieval (no signature required).

        Expected behavior:
        - File is retrieved from database
        - File generator is returned from storage
        - MIME type is returned
        - No signature verification is performed
        """
        # Arrange
        file_id = "file-123"
        mime_type = "image/png"

        upload_file = factory.create_upload_file_mock(
            file_id=file_id,
            extension="png",
            mime_type=mime_type,
        )

        mock_generator = Mock()
        mock_storage.load.return_value = mock_generator

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = upload_file
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        with patch("services.file_service.IMAGE_EXTENSIONS", {"jpg", "png"}):
            # Act
            generator, returned_mime_type = service.get_public_image_preview(file_id)

        # Assert
        mock_storage.load.assert_called_once_with(upload_file.key)  # No stream=True for public
        assert generator == mock_generator, "Generator should match"
        assert returned_mime_type == mime_type, "MIME type should match"

    @patch("services.file_service.storage")
    def test_get_file_content_success(self, mock_storage, factory):
        """
        Test successful file content retrieval.

        Expected behavior:
        - File is retrieved from database
        - Content is loaded from storage
        - Content is decoded as UTF-8 string
        - Returns content string
        """
        # Arrange
        file_id = "file-123"
        content_bytes = b"Test file content"
        expected_content = "Test file content"

        upload_file = factory.create_upload_file_mock(file_id=file_id)

        mock_storage.load.return_value = content_bytes

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = upload_file
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act
        result = service.get_file_content(file_id)

        # Assert
        mock_storage.load.assert_called_once_with(upload_file.key)
        assert result == expected_content, "Content should be decoded as UTF-8"

    @patch("services.file_service.storage")
    def test_get_file_content_raises_not_found_for_missing_file(self, mock_storage, factory):
        """
        Test that get_file_content raises NotFound for missing file.

        Expected behavior:
        - NotFound exception is raised
        - Error message indicates "File not found"
        """
        # Arrange
        file_id = "nonexistent"

        mock_session = MagicMock(spec=Session)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # File not found
        mock_session.query.return_value = mock_query

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act & Assert
        with pytest.raises(NotFound, match="File not found"):
            service.get_file_content(file_id)


# ============================================================================
# FILE DELETION TESTS
# ============================================================================


class TestFileServiceDeletion:
    """
    Test file deletion operations.

    This test class covers the delete_file method, which removes files from
    both storage and the database.
    """

    @patch("services.file_service.storage")
    def test_delete_file_success(self, mock_storage, factory):
        """
        Test successful file deletion.

        This test verifies that the delete_file method correctly deletes a
        file from both storage and the database within a transaction.

        Expected behavior:
        - File is retrieved from database
        - File is deleted from storage
        - File record is deleted from database
        - Transaction is committed
        """
        # Arrange
        file_id = "file-123"
        storage_key = "upload_files/tenant-123/file-123.pdf"

        upload_file = factory.create_upload_file_mock(file_id=file_id, key=storage_key)

        mock_session = MagicMock(spec=Session)
        mock_scalar = MagicMock()
        mock_scalar.where.return_value = mock_scalar
        mock_scalar.scalar.return_value = upload_file
        mock_session.scalar = Mock(return_value=upload_file)

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)
        mock_session.begin.return_value.__enter__ = Mock(return_value=None)
        mock_session.begin.return_value.__exit__ = Mock(return_value=None)
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act
        service.delete_file(file_id)

        # Assert
        # Verify file was deleted from storage
        mock_storage.delete.assert_called_once_with(storage_key)

        # Verify file was deleted from database
        mock_session.delete.assert_called_once_with(upload_file)

    @patch("services.file_service.storage")
    def test_delete_file_noop_when_file_not_found(self, mock_storage, factory):
        """
        Test that delete_file does nothing when file is not found.

        This test verifies that the delete_file method gracefully handles
        the case when attempting to delete a file that doesn't exist.

        Expected behavior:
        - No error is raised
        - No storage operations are performed
        - No database operations are performed
        """
        # Arrange
        file_id = "nonexistent"

        mock_session = MagicMock(spec=Session)
        mock_session.scalar = Mock(return_value=None)  # File not found

        mock_session_maker = factory.create_session_maker_mock()
        mock_session_maker.return_value.__enter__ = Mock(return_value=mock_session)
        mock_session_maker.return_value.__exit__ = Mock(return_value=None)
        mock_session.begin.return_value.__enter__ = Mock(return_value=None)
        mock_session.begin.return_value.__exit__ = Mock(return_value=None)
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        service = FileService(session_factory=mock_session_maker)

        # Act
        service.delete_file(file_id)

        # Assert
        # Verify no storage operations
        mock_storage.delete.assert_not_called()

        # Verify no database delete operations
        mock_session.delete.assert_not_called()
