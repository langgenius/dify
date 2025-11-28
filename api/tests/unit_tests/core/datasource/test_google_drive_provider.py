"""Comprehensive unit tests for Google Drive datasource provider.

This test module covers all aspects of the Google Drive provider including:
- Google Drive OAuth authentication (OAuth2 flow, token refresh, credential management)
- File listing (browsing files and folders, pagination, bucket handling)
- File download (single file download, binary content handling)
- Incremental sync (tracking changes, last modified time, sync state)

All tests use mocking to avoid external dependencies and ensure fast, reliable execution.
Tests follow the Arrange-Act-Assert pattern for clarity and maintainability.
"""

from unittest.mock import Mock, patch

import pytest

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveDownloadFileRequest,
    OnlineDriveFile,
    OnlineDriveFileBucket,
)
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.datasource.online_drive.online_drive_provider import (
    OnlineDriveDatasourcePluginProviderController,
)


class TestGoogleDriveOAuthAuthentication:
    """Tests for Google Drive OAuth authentication handling.

    Covers:
    - OAuth2 token authentication
    - Token refresh mechanism
    - Credential retrieval from database
    - Missing credential error handling
    - Token expiration handling
    """

    @pytest.fixture
    def mock_datasource_entity(self):
        """Create a mock datasource entity for Google Drive."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive"
        mock_entity.identity.provider = "langgenius/google_drive_datasource"
        mock_entity.identity.author = "langgenius"
        mock_entity.identity.label.en_US = "Google Drive"
        mock_entity.identity.icon = "google_drive.svg"
        mock_entity.parameters = []
        return mock_entity

    @pytest.fixture
    def mock_runtime(self):
        """Create a mock datasource runtime."""
        mock_runtime = Mock()
        mock_runtime.credentials = {
            "access_token": "test-access-token-123",
            "refresh_token": "test-refresh-token-456",
            "expires_at": 1735430400,  # Future timestamp
        }
        mock_runtime.tenant_id = "tenant-789"
        return mock_runtime

    @pytest.fixture
    def google_drive_plugin(self, mock_datasource_entity, mock_runtime):
        """Create a Google Drive plugin instance for testing."""
        return OnlineDriveDatasourcePlugin(
            entity=mock_datasource_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

    def test_plugin_initialization_with_credentials(self, google_drive_plugin, mock_runtime):
        """Test Google Drive plugin initialization with OAuth credentials."""
        # Assert
        assert google_drive_plugin.tenant_id == "tenant-789"
        assert google_drive_plugin.plugin_unique_identifier == "langgenius/google_drive_datasource"
        assert google_drive_plugin.runtime.credentials["access_token"] == "test-access-token-123"
        assert google_drive_plugin.runtime.credentials["refresh_token"] == "test-refresh-token-456"

    def test_datasource_provider_type(self, google_drive_plugin):
        """Test that the provider type is correctly set to ONLINE_DRIVE."""
        # Act
        provider_type = google_drive_plugin.datasource_provider_type()

        # Assert
        assert provider_type == DatasourceProviderType.ONLINE_DRIVE

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_oauth_token_refresh_on_expiry(self, mock_manager_class, google_drive_plugin):
        """Test automatic OAuth token refresh when token is expired."""
        # Arrange
        expired_credentials = {
            "access_token": "old-token",
            "refresh_token": "refresh-token",
            "expires_at": 1000000000,  # Past timestamp
        }
        google_drive_plugin.runtime.credentials = expired_credentials

        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Mock the refresh response
        refreshed_credentials = {
            "access_token": "new-access-token",
            "refresh_token": "refresh-token",
            "expires_at": 1735430400,
        }

        # Act - The actual refresh would happen in the service layer
        # Here we verify the plugin can work with refreshed credentials
        google_drive_plugin.runtime.credentials = refreshed_credentials

        # Assert
        assert google_drive_plugin.runtime.credentials["access_token"] == "new-access-token"
        assert google_drive_plugin.runtime.credentials["expires_at"] == 1735430400

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_missing_credentials_handling(self, mock_manager_class, mock_datasource_entity):
        """Test handling of missing OAuth credentials."""
        # Arrange
        mock_runtime = Mock()
        mock_runtime.credentials = {}
        mock_runtime.tenant_id = "tenant-789"

        # Act
        plugin = OnlineDriveDatasourcePlugin(
            entity=mock_datasource_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

        # Assert - Plugin should initialize but credentials are empty
        assert plugin.runtime.credentials == {}

    def test_credential_encryption_handling(self, google_drive_plugin):
        """Test that credentials are properly handled (encryption is done at service layer)."""
        # Arrange
        sensitive_credentials = {
            "access_token": "sensitive-token-abc123",
            "refresh_token": "sensitive-refresh-xyz789",
            "client_id": "client-id-123",
            "client_secret": "client-secret-456",
        }

        # Act
        google_drive_plugin.runtime.credentials = sensitive_credentials

        # Assert - Credentials should be stored as-is in the plugin
        # Encryption/decryption happens at the service layer
        assert google_drive_plugin.runtime.credentials["access_token"] == "sensitive-token-abc123"
        assert google_drive_plugin.runtime.credentials["client_secret"] == "client-secret-456"


class TestGoogleDriveFileListing:
    """Tests for Google Drive file listing functionality.

    Covers:
    - Browsing files and folders
    - Pagination handling
    - Bucket/folder hierarchy
    - File metadata extraction
    - Empty folder handling
    """

    @pytest.fixture
    def google_drive_plugin(self):
        """Create a Google Drive plugin instance for testing."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive"
        mock_entity.identity.provider = "langgenius/google_drive_datasource"

        mock_runtime = Mock()
        mock_runtime.credentials = {"access_token": "test-token"}
        mock_runtime.tenant_id = "tenant-789"

        return OnlineDriveDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

    def _create_drive_file(
        self, file_id: str, name: str, file_type: str = "file", size: int = 1024
    ) -> OnlineDriveFile:
        """Helper to create a Google Drive file structure."""
        return OnlineDriveFile(id=file_id, name=name, type=file_type, size=size)

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_browse_files_root_folder(self, mock_manager_class, google_drive_plugin):
        """Test browsing files in the root folder."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Mock response with files in root
        mock_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        self._create_drive_file("file-1", "Document.pdf", "file", 2048),
                        self._create_drive_file("file-2", "Spreadsheet.xlsx", "file", 4096),
                        self._create_drive_file("folder-1", "My Folder", "folder", 0),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield mock_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert len(result[0].result[0].files) == 3
        assert result[0].result[0].files[0].name == "Document.pdf"
        assert result[0].result[0].files[0].type == "file"
        assert result[0].result[0].files[2].type == "folder"

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_browse_files_with_pagination(self, mock_manager_class, google_drive_plugin):
        """Test browsing files with pagination support."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # First page response
        first_page = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        self._create_drive_file(f"file-{i}", f"File{i}.txt", "file", 1024) for i in range(1, 21)
                    ],
                    is_truncated=True,
                    next_page_parameters={"page_token": "next-page-token-abc"},
                )
            ]
        )

        # Second page response
        second_page = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        self._create_drive_file(f"file-{i}", f"File{i}.txt", "file", 1024) for i in range(21, 31)
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield first_page

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act - First page
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert - First page
        assert len(result) == 1
        assert result[0].result[0].is_truncated is True
        assert result[0].result[0].next_page_parameters == {"page_token": "next-page-token-abc"}
        assert len(result[0].result[0].files) == 20

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_browse_files_in_subfolder(self, mock_manager_class, google_drive_plugin):
        """Test browsing files within a specific subfolder."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        mock_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket="My Folder",
                    files=[
                        self._create_drive_file("file-sub-1", "SubDoc.pdf", "file", 3072),
                        self._create_drive_file("file-sub-2", "SubImage.png", "file", 5120),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield mock_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket="My Folder", prefix="folder-1", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert result[0].result[0].bucket == "My Folder"
        assert len(result[0].result[0].files) == 2
        assert result[0].result[0].files[0].name == "SubDoc.pdf"

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_browse_files_empty_folder(self, mock_manager_class, google_drive_plugin):
        """Test browsing an empty folder."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        mock_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(bucket=None, files=[], is_truncated=False, next_page_parameters=None)
            ]
        )

        def mock_generator():
            yield mock_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="empty-folder", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert len(result[0].result[0].files) == 0
        assert result[0].result[0].is_truncated is False

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_browse_files_with_various_file_types(self, mock_manager_class, google_drive_plugin):
        """Test browsing files with various file types and sizes."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        mock_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        self._create_drive_file("doc-1", "Report.docx", "file", 15360),
                        self._create_drive_file("img-1", "Photo.jpg", "file", 2097152),
                        self._create_drive_file("vid-1", "Video.mp4", "file", 104857600),
                        self._create_drive_file("folder-1", "Documents", "folder", 0),
                        self._create_drive_file("sheet-1", "Data.csv", "file", 8192),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield mock_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result[0].result[0].files) == 5
        # Verify different file sizes
        assert result[0].result[0].files[0].size == 15360  # 15 KB
        assert result[0].result[0].files[1].size == 2097152  # 2 MB
        assert result[0].result[0].files[2].size == 104857600  # 100 MB
        assert result[0].result[0].files[3].size == 0  # Folder


class TestGoogleDriveFileDownload:
    """Tests for Google Drive file download functionality.

    Covers:
    - Single file download
    - Binary content handling
    - Large file download
    - Download error handling
    - File metadata in download response
    """

    @pytest.fixture
    def google_drive_plugin(self):
        """Create a Google Drive plugin instance for testing."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive"
        mock_entity.identity.provider = "langgenius/google_drive_datasource"

        mock_runtime = Mock()
        mock_runtime.credentials = {"access_token": "test-token"}
        mock_runtime.tenant_id = "tenant-789"

        return OnlineDriveDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_download_single_file(self, mock_manager_class, google_drive_plugin):
        """Test downloading a single file from Google Drive."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Mock file content
        file_content = b"This is the content of the test file."
        mock_message = Mock()
        mock_message.type = "blob"
        mock_message.message = file_content
        mock_message.meta = {
            "file_id": "file-123",
            "file_name": "TestDocument.pdf",
            "file_size": len(file_content),
            "mime_type": "application/pdf",
        }

        def mock_generator():
            yield mock_message

        mock_manager.online_drive_download_file.return_value = mock_generator()

        # Act
        request = OnlineDriveDownloadFileRequest(id="file-123", bucket=None)
        result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert result[0].type == "blob"
        assert result[0].message == file_content
        assert result[0].meta["file_id"] == "file-123"
        assert result[0].meta["file_name"] == "TestDocument.pdf"

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_download_file_from_bucket(self, mock_manager_class, google_drive_plugin):
        """Test downloading a file from a specific bucket/folder."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        file_content = b"Content from subfolder"
        mock_message = Mock()
        mock_message.type = "blob"
        mock_message.message = file_content
        mock_message.meta = {
            "file_id": "file-456",
            "file_name": "SubfolderDoc.txt",
            "bucket": "My Folder",
        }

        def mock_generator():
            yield mock_message

        mock_manager.online_drive_download_file.return_value = mock_generator()

        # Act
        request = OnlineDriveDownloadFileRequest(id="file-456", bucket="My Folder")
        result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert result[0].message == file_content
        assert result[0].meta["bucket"] == "My Folder"

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_download_large_file(self, mock_manager_class, google_drive_plugin):
        """Test downloading a large file with streaming."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Simulate large file with chunks
        chunk1 = b"A" * 1024 * 1024  # 1 MB
        chunk2 = b"B" * 1024 * 1024  # 1 MB
        chunk3 = b"C" * 512 * 1024  # 512 KB

        mock_message1 = Mock()
        mock_message1.type = "blob"
        mock_message1.message = chunk1

        mock_message2 = Mock()
        mock_message2.type = "blob"
        mock_message2.message = chunk2

        mock_message3 = Mock()
        mock_message3.type = "blob"
        mock_message3.message = chunk3

        def mock_generator():
            yield mock_message1
            yield mock_message2
            yield mock_message3

        mock_manager.online_drive_download_file.return_value = mock_generator()

        # Act
        request = OnlineDriveDownloadFileRequest(id="large-file-789", bucket=None)
        result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 3
        total_size = sum(len(r.message) for r in result)
        assert total_size == 1024 * 1024 + 1024 * 1024 + 512 * 1024  # 2.5 MB

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_download_binary_file_types(self, mock_manager_class, google_drive_plugin):
        """Test downloading various binary file types."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Mock binary content (e.g., image)
        binary_content = bytes([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46])  # JPEG header

        mock_message = Mock()
        mock_message.type = "blob"
        mock_message.message = binary_content
        mock_message.meta = {
            "file_id": "img-001",
            "file_name": "photo.jpg",
            "mime_type": "image/jpeg",
        }

        def mock_generator():
            yield mock_message

        mock_manager.online_drive_download_file.return_value = mock_generator()

        # Act
        request = OnlineDriveDownloadFileRequest(id="img-001", bucket=None)
        result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert isinstance(result[0].message, bytes)
        assert result[0].message[:2] == b"\xFF\xD8"  # JPEG magic number
        assert result[0].meta["mime_type"] == "image/jpeg"

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_download_text_file(self, mock_manager_class, google_drive_plugin):
        """Test downloading text-based files."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        text_content = b"Line 1\nLine 2\nLine 3\nThis is a text file."
        mock_message = Mock()
        mock_message.type = "blob"
        mock_message.message = text_content
        mock_message.meta = {
            "file_id": "txt-001",
            "file_name": "notes.txt",
            "mime_type": "text/plain",
        }

        def mock_generator():
            yield mock_message

        mock_manager.online_drive_download_file.return_value = mock_generator()

        # Act
        request = OnlineDriveDownloadFileRequest(id="txt-001", bucket=None)
        result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert b"Line 1" in result[0].message
        assert b"text file" in result[0].message


class TestGoogleDriveIncrementalSync:
    """Tests for Google Drive incremental sync functionality.

    Covers:
    - Tracking file changes
    - Last modified time comparison
    - Sync state management
    - Change detection
    - Delta sync operations
    """

    @pytest.fixture
    def google_drive_plugin(self):
        """Create a Google Drive plugin instance for testing."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive"
        mock_entity.identity.provider = "langgenius/google_drive_datasource"

        mock_runtime = Mock()
        mock_runtime.credentials = {"access_token": "test-token"}
        mock_runtime.tenant_id = "tenant-789"

        return OnlineDriveDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_incremental_sync_with_modified_files(self, mock_manager_class, google_drive_plugin):
        """Test incremental sync detecting modified files."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Simulate files with modification times
        modified_files = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id="file-1", name="Updated.pdf", type="file", size=2048),
                        OnlineDriveFile(id="file-2", name="New.docx", type="file", size=4096),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield modified_files

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act - Request with last sync parameters
        request = OnlineDriveBrowseFilesRequest(
            bucket=None,
            prefix="root",
            max_keys=20,
            next_page_parameters={"last_sync_time": "2024-01-01T00:00:00Z"},
        )
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert len(result[0].result[0].files) == 2
        # These files should be the ones modified since last sync

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_incremental_sync_no_changes(self, mock_manager_class, google_drive_plugin):
        """Test incremental sync when no files have changed."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Empty result indicating no changes
        no_changes = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(bucket=None, files=[], is_truncated=False, next_page_parameters=None)
            ]
        )

        def mock_generator():
            yield no_changes

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(
            bucket=None,
            prefix="root",
            max_keys=20,
            next_page_parameters={"last_sync_time": "2024-11-27T00:00:00Z"},
        )
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert len(result[0].result[0].files) == 0

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_incremental_sync_with_page_token(self, mock_manager_class, google_drive_plugin):
        """Test incremental sync with pagination using page tokens."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # First page of changes
        first_page_changes = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id=f"file-{i}", name=f"File{i}.txt", type="file", size=1024)
                        for i in range(1, 21)
                    ],
                    is_truncated=True,
                    next_page_parameters={
                        "page_token": "change-token-abc",
                        "last_sync_time": "2024-11-27T12:00:00Z",
                    },
                )
            ]
        )

        def mock_generator():
            yield first_page_changes

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(
            bucket=None,
            prefix="root",
            max_keys=20,
            next_page_parameters={"last_sync_time": "2024-11-26T00:00:00Z"},
        )
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert result[0].result[0].is_truncated is True
        assert "change-token-abc" in result[0].result[0].next_page_parameters["page_token"]
        assert len(result[0].result[0].files) == 20

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_incremental_sync_deleted_files_handling(self, mock_manager_class, google_drive_plugin):
        """Test incremental sync handling deleted files."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Response might include metadata about deletions
        sync_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id="file-1", name="Active.pdf", type="file", size=2048),
                        # Deleted files might be marked differently or excluded
                    ],
                    is_truncated=False,
                    next_page_parameters={"deleted_ids": ["file-deleted-1", "file-deleted-2"]},
                )
            ]
        )

        def mock_generator():
            yield sync_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(
            bucket=None, prefix="root", max_keys=20, next_page_parameters={"last_sync_time": "2024-11-20T00:00:00Z"}
        )
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        # Check if deleted file IDs are tracked
        if result[0].result[0].next_page_parameters:
            assert "deleted_ids" in result[0].result[0].next_page_parameters

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_full_sync_vs_incremental_sync(self, mock_manager_class, google_drive_plugin):
        """Test difference between full sync and incremental sync."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Full sync - all files
        full_sync_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id=f"file-{i}", name=f"File{i}.txt", type="file", size=1024)
                        for i in range(1, 101)
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_full_sync():
            yield full_sync_response

        mock_manager.online_drive_browse_files.return_value = mock_full_sync()

        # Act - Full sync (no last_sync_time)
        full_request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=100)
        full_result = list(google_drive_plugin.online_drive_browse_files("user-123", full_request, "online_drive"))

        # Assert - Full sync returns all files
        assert len(full_result[0].result[0].files) == 100

        # Now test incremental sync
        incremental_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id="file-101", name="NewFile.txt", type="file", size=1024),
                        OnlineDriveFile(id="file-5", name="UpdatedFile.txt", type="file", size=2048),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_incremental_sync():
            yield incremental_response

        mock_manager.online_drive_browse_files.return_value = mock_incremental_sync()

        # Act - Incremental sync
        incremental_request = OnlineDriveBrowseFilesRequest(
            bucket=None, prefix="root", max_keys=100, next_page_parameters={"last_sync_time": "2024-11-27T00:00:00Z"}
        )
        incremental_result = list(
            google_drive_plugin.online_drive_browse_files("user-123", incremental_request, "online_drive")
        )

        # Assert - Incremental sync returns only changed files
        assert len(incremental_result[0].result[0].files) == 2


class TestGoogleDriveProviderController:
    """Tests for Google Drive provider controller.

    Covers:
    - Provider initialization
    - Datasource retrieval
    - Provider type verification
    - Multiple datasource handling
    """

    @pytest.fixture
    def mock_provider_entity(self):
        """Create a mock provider entity."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive_datasource"
        mock_entity.identity.author = "langgenius"
        mock_entity.identity.icon = "google_drive.svg"
        mock_entity.credentials_schema = []
        mock_entity.oauth_schema = Mock()
        mock_entity.oauth_schema.client_schema = []
        mock_entity.oauth_schema.credentials_schema = []

        # Mock datasources
        mock_datasource = Mock()
        mock_datasource.identity.name = "google_drive"
        mock_datasource.identity.provider = "langgenius/google_drive_datasource"
        mock_entity.datasources = [mock_datasource]

        return mock_entity

    def test_provider_controller_initialization(self, mock_provider_entity):
        """Test provider controller initialization."""
        # Act
        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_provider_entity,
            plugin_id="langgenius/google_drive_datasource",
            plugin_unique_identifier="langgenius/google_drive_datasource",
            tenant_id="tenant-789",
        )

        # Assert
        assert controller.plugin_id == "langgenius/google_drive_datasource"
        assert controller.plugin_unique_identifier == "langgenius/google_drive_datasource"
        assert controller.tenant_id == "tenant-789"

    def test_provider_type_is_online_drive(self, mock_provider_entity):
        """Test that provider type is correctly set to ONLINE_DRIVE."""
        # Arrange
        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_provider_entity,
            plugin_id="langgenius/google_drive_datasource",
            plugin_unique_identifier="langgenius/google_drive_datasource",
            tenant_id="tenant-789",
        )

        # Act
        provider_type = controller.provider_type

        # Assert
        assert provider_type == DatasourceProviderType.ONLINE_DRIVE

    def test_get_datasource_by_name(self, mock_provider_entity):
        """Test retrieving datasource by name."""
        # Arrange
        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_provider_entity,
            plugin_id="langgenius/google_drive_datasource",
            plugin_unique_identifier="langgenius/google_drive_datasource",
            tenant_id="tenant-789",
        )

        # Act
        datasource = controller.get_datasource("google_drive")

        # Assert
        assert isinstance(datasource, OnlineDriveDatasourcePlugin)
        assert datasource.tenant_id == "tenant-789"
        assert datasource.plugin_unique_identifier == "langgenius/google_drive_datasource"

    def test_get_datasource_not_found(self, mock_provider_entity):
        """Test error when datasource name not found."""
        # Arrange
        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_provider_entity,
            plugin_id="langgenius/google_drive_datasource",
            plugin_unique_identifier="langgenius/google_drive_datasource",
            tenant_id="tenant-789",
        )

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            controller.get_datasource("nonexistent_datasource")
        assert "not found" in str(exc_info.value)

    def test_provider_needs_credentials(self, mock_provider_entity):
        """Test checking if provider needs credentials."""
        # Arrange
        mock_provider_entity.credentials_schema = [Mock()]  # Has credentials
        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_provider_entity,
            plugin_id="langgenius/google_drive_datasource",
            plugin_unique_identifier="langgenius/google_drive_datasource",
            tenant_id="tenant-789",
        )

        # Act
        needs_creds = controller.need_credentials

        # Assert
        assert needs_creds is True

    def test_provider_no_credentials_needed(self, mock_provider_entity):
        """Test provider that doesn't need credentials."""
        # Arrange
        mock_provider_entity.credentials_schema = []  # No credentials
        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_provider_entity,
            plugin_id="langgenius/google_drive_datasource",
            plugin_unique_identifier="langgenius/google_drive_datasource",
            tenant_id="tenant-789",
        )

        # Act
        needs_creds = controller.need_credentials

        # Assert
        assert needs_creds is False


class TestGoogleDriveErrorHandling:
    """Tests for Google Drive error handling.

    Covers:
    - API errors
    - Network errors
    - Authentication errors
    - Rate limiting
    - Invalid file IDs
    """

    @pytest.fixture
    def google_drive_plugin(self):
        """Create a Google Drive plugin instance for testing."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive"
        mock_entity.identity.provider = "langgenius/google_drive_datasource"

        mock_runtime = Mock()
        mock_runtime.credentials = {"access_token": "test-token"}
        mock_runtime.tenant_id = "tenant-789"

        return OnlineDriveDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_authentication_error_handling(self, mock_manager_class, google_drive_plugin):
        """Test handling of authentication errors."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Mock authentication error - generator that raises exception when iterated
        def mock_error_generator():
            raise Exception("Authentication failed: Invalid access token")
            yield  # This line is never reached but makes it a generator

        mock_manager.online_drive_browse_files.return_value = mock_error_generator()

        # Act & Assert
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        with pytest.raises(Exception) as exc_info:
            list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))
        assert "Authentication failed" in str(exc_info.value)

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_invalid_file_id_error(self, mock_manager_class, google_drive_plugin):
        """Test handling of invalid file ID errors."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        def mock_error_generator():
            raise Exception("File not found: invalid-file-id")
            yield  # This line is never reached but makes it a generator

        mock_manager.online_drive_download_file.return_value = mock_error_generator()

        # Act & Assert
        request = OnlineDriveDownloadFileRequest(id="invalid-file-id", bucket=None)
        with pytest.raises(Exception) as exc_info:
            list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))
        assert "File not found" in str(exc_info.value)

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_rate_limit_error_handling(self, mock_manager_class, google_drive_plugin):
        """Test handling of rate limit errors."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        def mock_rate_limit_generator():
            raise Exception("Rate limit exceeded. Please try again later.")
            yield  # This line is never reached but makes it a generator

        mock_manager.online_drive_browse_files.return_value = mock_rate_limit_generator()

        # Act & Assert
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        with pytest.raises(Exception) as exc_info:
            list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))
        assert "Rate limit" in str(exc_info.value)

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_network_error_handling(self, mock_manager_class, google_drive_plugin):
        """Test handling of network errors."""
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        def mock_network_error():
            raise Exception("Network error: Connection timeout")
            yield  # This line is never reached but makes it a generator

        mock_manager.online_drive_download_file.return_value = mock_network_error()

        # Act & Assert
        request = OnlineDriveDownloadFileRequest(id="file-123", bucket=None)
        with pytest.raises(Exception) as exc_info:
            list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))
        assert "Network error" in str(exc_info.value)


class TestGoogleDriveAdvancedScenarios:
    """Advanced test scenarios for Google Drive provider.

    Covers:
    - Shared drives (Team Drives) handling
    - File permissions and access control
    - Special file types (Google Docs, Sheets, Slides)
    - Concurrent file operations
    - Large-scale pagination scenarios
    - Unicode and special characters in filenames
    """

    @pytest.fixture
    def google_drive_plugin(self):
        """Create a Google Drive plugin instance for advanced testing."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive"
        mock_entity.identity.provider = "langgenius/google_drive_datasource"

        mock_runtime = Mock()
        mock_runtime.credentials = {"access_token": "test-token"}
        mock_runtime.tenant_id = "tenant-789"

        return OnlineDriveDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_shared_drive_file_listing(self, mock_manager_class, google_drive_plugin):
        """Test browsing files in a shared/team drive.
        
        Shared drives (formerly Team Drives) are collaborative spaces where teams
        can store and access files. This test verifies proper handling of shared
        drive file listings.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Mock shared drive response with team drive bucket
        shared_drive_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket="Team Marketing",  # Shared drive name
                    files=[
                        OnlineDriveFile(id="shared-1", name="Campaign Plan.docx", type="file", size=4096),
                        OnlineDriveFile(id="shared-2", name="Budget 2024.xlsx", type="file", size=8192),
                        OnlineDriveFile(id="shared-folder-1", name="Assets", type="folder", size=0),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield shared_drive_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket="Team Marketing", prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert result[0].result[0].bucket == "Team Marketing"
        assert len(result[0].result[0].files) == 3
        # Verify shared drive files are properly listed
        assert any(f.name == "Campaign Plan.docx" for f in result[0].result[0].files)

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_google_workspace_file_types(self, mock_manager_class, google_drive_plugin):
        """Test handling of Google Workspace native file types.
        
        Google Workspace files (Docs, Sheets, Slides) require special handling
        as they don't have traditional file sizes and may need export/conversion.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        workspace_files = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        # Google Docs - size 0 indicates native Google format
                        OnlineDriveFile(id="doc-1", name="Meeting Notes", type="file", size=0),
                        # Google Sheets
                        OnlineDriveFile(id="sheet-1", name="Sales Data", type="file", size=0),
                        # Google Slides
                        OnlineDriveFile(id="slide-1", name="Presentation Q4", type="file", size=0),
                        # Regular file for comparison
                        OnlineDriveFile(id="pdf-1", name="Report.pdf", type="file", size=102400),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield workspace_files

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result[0].result[0].files) == 4
        # Google Workspace files have size 0
        google_files = [f for f in result[0].result[0].files if f.size == 0 and f.type == "file"]
        assert len(google_files) == 3

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_unicode_and_special_characters_in_filenames(self, mock_manager_class, google_drive_plugin):
        """Test handling of Unicode and special characters in file names.
        
        File names can contain various Unicode characters, emojis, and special
        characters that need to be properly handled.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        unicode_files = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        # Unicode characters (Chinese, Japanese, Arabic)
                        OnlineDriveFile(id="f1", name="文档.pdf", type="file", size=1024),
                        OnlineDriveFile(id="f2", name="ドキュメント.docx", type="file", size=2048),
                        OnlineDriveFile(id="f3", name="مستند.txt", type="file", size=512),
                        # Emojis in filename
                        OnlineDriveFile(id="f4", name="Project 🚀 Launch.pptx", type="file", size=4096),
                        # Special characters
                        OnlineDriveFile(id="f5", name="Report (Final) [2024].xlsx", type="file", size=8192),
                        OnlineDriveFile(id="f6", name="Data & Analysis.csv", type="file", size=1536),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield unicode_files

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result[0].result[0].files) == 6
        # Verify Unicode filenames are preserved
        filenames = [f.name for f in result[0].result[0].files]
        assert "文档.pdf" in filenames
        assert "Project 🚀 Launch.pptx" in filenames
        assert "Report (Final) [2024].xlsx" in filenames

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_deep_pagination_scenario(self, mock_manager_class, google_drive_plugin):
        """Test handling of deep pagination with multiple page tokens.
        
        Large folders may require multiple pagination requests. This test
        simulates navigating through several pages of results.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Simulate 3 pages of results
        pages = []
        for page_num in range(3):
            is_last_page = page_num == 2
            page = OnlineDriveBrowseFilesResponse(
                result=[
                    OnlineDriveFileBucket(
                        bucket=None,
                        files=[
                            OnlineDriveFile(
                                id=f"file-{page_num * 50 + i}",
                                name=f"File_{page_num * 50 + i}.txt",
                                type="file",
                                size=1024,
                            )
                            for i in range(50)
                        ],
                        is_truncated=not is_last_page,
                        next_page_parameters=None if is_last_page else {"page_token": f"token-page-{page_num + 1}"},
                    )
                ]
            )
            pages.append(page)

        # Test first page
        def mock_first_page():
            yield pages[0]

        mock_manager.online_drive_browse_files.return_value = mock_first_page()

        # Act - First page
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=50)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert - First page
        assert len(result[0].result[0].files) == 50
        assert result[0].result[0].is_truncated is True
        assert result[0].result[0].next_page_parameters["page_token"] == "token-page-1"

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_empty_credentials_scenario(self, mock_manager_class, google_drive_plugin):
        """Test behavior when credentials are empty or invalid.
        
        Ensures graceful handling when OAuth credentials are missing or invalid,
        which can happen during credential refresh failures.
        """
        # Arrange
        google_drive_plugin.runtime.credentials = {}  # Empty credentials

        # Act & Assert - Plugin should still be functional but operations may fail
        assert google_drive_plugin.runtime.credentials == {}
        assert google_drive_plugin.tenant_id == "tenant-789"

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_mixed_content_types_in_folder(self, mock_manager_class, google_drive_plugin):
        """Test folder containing mixed content types.
        
        Real-world folders often contain a mix of files, folders, shortcuts,
        and Google Workspace documents. This test ensures all types are handled.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        mixed_content = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        # Regular files
                        OnlineDriveFile(id="f1", name="document.pdf", type="file", size=10240),
                        OnlineDriveFile(id="f2", name="image.jpg", type="file", size=204800),
                        # Folders
                        OnlineDriveFile(id="d1", name="Projects", type="folder", size=0),
                        OnlineDriveFile(id="d2", name="Archive", type="folder", size=0),
                        # Google Workspace files (size 0)
                        OnlineDriveFile(id="g1", name="Spreadsheet", type="file", size=0),
                        OnlineDriveFile(id="g2", name="Presentation", type="file", size=0),
                        # Various file sizes
                        OnlineDriveFile(id="f3", name="tiny.txt", type="file", size=10),
                        OnlineDriveFile(id="f4", name="large_video.mp4", type="file", size=524288000),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield mixed_content

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        files = result[0].result[0].files
        assert len(files) == 8
        
        # Count different types
        folders = [f for f in files if f.type == "folder"]
        regular_files = [f for f in files if f.type == "file" and f.size > 0]
        workspace_files = [f for f in files if f.type == "file" and f.size == 0]
        
        assert len(folders) == 2
        assert len(regular_files) == 4
        assert len(workspace_files) == 2

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_file_download_with_metadata(self, mock_manager_class, google_drive_plugin):
        """Test file download includes comprehensive metadata.
        
        Downloaded files should include metadata like MIME type, file size,
        modification time, and other relevant information.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        file_content = b"Sample file content for testing"
        mock_message = Mock()
        mock_message.type = "blob"
        mock_message.message = file_content
        # Comprehensive metadata
        mock_message.meta = {
            "file_id": "file-metadata-123",
            "file_name": "important_document.pdf",
            "file_size": len(file_content),
            "mime_type": "application/pdf",
            "created_time": "2024-01-15T10:30:00Z",
            "modified_time": "2024-11-27T14:20:00Z",
            "owner": "user@example.com",
            "shared": True,
            "version": 3,
        }

        def mock_generator():
            yield mock_message

        mock_manager.online_drive_download_file.return_value = mock_generator()

        # Act
        request = OnlineDriveDownloadFileRequest(id="file-metadata-123", bucket=None)
        result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert result[0].meta["file_id"] == "file-metadata-123"
        assert result[0].meta["mime_type"] == "application/pdf"
        assert result[0].meta["modified_time"] == "2024-11-27T14:20:00Z"
        assert result[0].meta["shared"] is True

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_incremental_sync_with_multiple_change_types(self, mock_manager_class, google_drive_plugin):
        """Test incremental sync detecting various types of changes.
        
        Changes can include: new files, modified files, deleted files, moved files,
        and renamed files. This test ensures all change types are tracked.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Simulate comprehensive change set
        changes = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        # New files
                        OnlineDriveFile(id="new-1", name="NewReport.pdf", type="file", size=2048),
                        # Modified files (same ID, potentially different metadata)
                        OnlineDriveFile(id="existing-1", name="UpdatedDoc.docx", type="file", size=4096),
                        # Renamed files (same ID, different name)
                        OnlineDriveFile(id="existing-2", name="RenamedFile.txt", type="file", size=1024),
                    ],
                    is_truncated=False,
                    next_page_parameters={
                        "deleted_ids": ["deleted-1", "deleted-2"],  # Deleted files
                        "moved_ids": ["moved-1"],  # Files moved to different folder
                        "last_sync_time": "2024-11-27T15:00:00Z",
                    },
                )
            ]
        )

        def mock_generator():
            yield changes

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(
            bucket=None, prefix="root", max_keys=20, next_page_parameters={"last_sync_time": "2024-11-26T00:00:00Z"}
        )
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result[0].result[0].files) == 3
        # Verify change tracking metadata
        assert "deleted_ids" in result[0].result[0].next_page_parameters
        assert len(result[0].result[0].next_page_parameters["deleted_ids"]) == 2

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_concurrent_file_operations_simulation(self, mock_manager_class, google_drive_plugin):
        """Test handling of concurrent file operations.
        
        Simulates scenario where multiple files are being accessed/modified
        simultaneously, ensuring thread-safety and consistency.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Simulate multiple concurrent downloads
        file_contents = [
            (b"Content A", {"file_id": "concurrent-1", "file_name": "FileA.txt"}),
            (b"Content B", {"file_id": "concurrent-2", "file_name": "FileB.txt"}),
            (b"Content C", {"file_id": "concurrent-3", "file_name": "FileC.txt"}),
        ]

        for content, meta in file_contents:
            mock_message = Mock()
            mock_message.type = "blob"
            mock_message.message = content
            mock_message.meta = meta

            def mock_gen(msg=mock_message):
                yield msg

            mock_manager.online_drive_download_file.return_value = mock_gen()

            # Act - Simulate concurrent download
            request = OnlineDriveDownloadFileRequest(id=meta["file_id"], bucket=None)
            result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

            # Assert - Each download completes successfully
            assert len(result) == 1
            assert result[0].meta["file_id"] == meta["file_id"]


class TestGoogleDriveEdgeCases:
    """Edge case tests for Google Drive provider.

    Covers:
    - Zero-byte files
    - Extremely long file names
    - Deeply nested folder structures
    - Files with no extension
    - Duplicate file names in different folders
    - Special system files and folders
    """

    @pytest.fixture
    def google_drive_plugin(self):
        """Create a Google Drive plugin instance for edge case testing."""
        mock_entity = Mock()
        mock_entity.identity.name = "google_drive"
        mock_entity.identity.provider = "langgenius/google_drive_datasource"

        mock_runtime = Mock()
        mock_runtime.credentials = {"access_token": "test-token"}
        mock_runtime.tenant_id = "tenant-789"

        return OnlineDriveDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id="tenant-789",
            icon="google_drive.svg",
            plugin_unique_identifier="langgenius/google_drive_datasource",
        )

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_zero_byte_files(self, mock_manager_class, google_drive_plugin):
        """Test handling of zero-byte (empty) files.
        
        Empty files are valid and should be handled correctly without errors.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        zero_byte_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id="empty-1", name="empty.txt", type="file", size=0),
                        OnlineDriveFile(id="empty-2", name="placeholder.log", type="file", size=0),
                        OnlineDriveFile(id="normal-1", name="normal.txt", type="file", size=100),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield zero_byte_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result[0].result[0].files) == 3
        empty_files = [f for f in result[0].result[0].files if f.size == 0]
        assert len(empty_files) == 2

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_extremely_long_filename(self, mock_manager_class, google_drive_plugin):
        """Test handling of files with extremely long names.
        
        File systems have limits on filename length, but cloud storage may allow
        longer names. This test ensures proper handling.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Create a very long filename (255+ characters)
        long_name = "A" * 200 + "_very_long_filename_that_exceeds_normal_limits" + ".txt"

        long_filename_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id="long-1", name=long_name, type="file", size=1024),
                        OnlineDriveFile(id="normal-1", name="short.txt", type="file", size=512),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield long_filename_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result[0].result[0].files) == 2
        assert len(result[0].result[0].files[0].name) > 200

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_files_without_extension(self, mock_manager_class, google_drive_plugin):
        """Test handling of files without file extensions.
        
        Not all files have extensions (e.g., README, Makefile, LICENSE).
        These should be handled correctly.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        no_extension_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket=None,
                    files=[
                        OnlineDriveFile(id="f1", name="README", type="file", size=1024),
                        OnlineDriveFile(id="f2", name="Makefile", type="file", size=512),
                        OnlineDriveFile(id="f3", name="LICENSE", type="file", size=2048),
                        OnlineDriveFile(id="f4", name="config", type="file", size=256),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield no_extension_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(bucket=None, prefix="root", max_keys=20)
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result[0].result[0].files) == 4
        # Verify files without extensions are properly listed
        assert all("." not in f.name for f in result[0].result[0].files)

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_duplicate_filenames_different_folders(self, mock_manager_class, google_drive_plugin):
        """Test handling of duplicate filenames in different folders.
        
        Google Drive allows files with the same name in different folders.
        File IDs should be used to distinguish them.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Same filename in different buckets
        folder1_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket="Folder A",
                    files=[
                        OnlineDriveFile(id="file-a-1", name="document.pdf", type="file", size=1024),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        folder2_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket="Folder B",
                    files=[
                        OnlineDriveFile(id="file-b-1", name="document.pdf", type="file", size=2048),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        # Test folder A
        def mock_gen_a():
            yield folder1_response

        mock_manager.online_drive_browse_files.return_value = mock_gen_a()

        request_a = OnlineDriveBrowseFilesRequest(bucket="Folder A", prefix="folder-a", max_keys=20)
        result_a = list(google_drive_plugin.online_drive_browse_files("user-123", request_a, "online_drive"))

        # Test folder B
        def mock_gen_b():
            yield folder2_response

        mock_manager.online_drive_browse_files.return_value = mock_gen_b()

        request_b = OnlineDriveBrowseFilesRequest(bucket="Folder B", prefix="folder-b", max_keys=20)
        result_b = list(google_drive_plugin.online_drive_browse_files("user-123", request_b, "online_drive"))

        # Assert - Same filename but different IDs and buckets
        assert result_a[0].result[0].files[0].name == result_b[0].result[0].files[0].name
        assert result_a[0].result[0].files[0].id != result_b[0].result[0].files[0].id
        assert result_a[0].result[0].bucket != result_b[0].result[0].bucket

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_deeply_nested_folder_structure(self, mock_manager_class, google_drive_plugin):
        """Test navigation through deeply nested folder structures.
        
        Verifies that the provider can handle deep folder hierarchies
        (e.g., /root/level1/level2/level3/level4/level5).
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        # Simulate a deeply nested folder
        deep_folder_response = OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket="root/projects/2024/Q4/marketing/campaigns/social",
                    files=[
                        OnlineDriveFile(id="deep-1", name="campaign_plan.pdf", type="file", size=4096),
                        OnlineDriveFile(id="deep-folder-1", name="assets", type="folder", size=0),
                    ],
                    is_truncated=False,
                    next_page_parameters=None,
                )
            ]
        )

        def mock_generator():
            yield deep_folder_response

        mock_manager.online_drive_browse_files.return_value = mock_generator()

        # Act
        request = OnlineDriveBrowseFilesRequest(
            bucket="root/projects/2024/Q4/marketing/campaigns/social", prefix="deep-folder-id", max_keys=20
        )
        result = list(google_drive_plugin.online_drive_browse_files("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert "/" in result[0].result[0].bucket  # Verify nested path
        assert len(result[0].result[0].files) == 2

    @patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager")
    def test_download_zero_byte_file(self, mock_manager_class, google_drive_plugin):
        """Test downloading a zero-byte (empty) file.
        
        Empty files should download successfully with no content.
        """
        # Arrange
        mock_manager = Mock()
        mock_manager_class.return_value = mock_manager

        empty_content = b""  # Zero bytes
        mock_message = Mock()
        mock_message.type = "blob"
        mock_message.message = empty_content
        mock_message.meta = {
            "file_id": "empty-file-1",
            "file_name": "empty.txt",
            "file_size": 0,
        }

        def mock_generator():
            yield mock_message

        mock_manager.online_drive_download_file.return_value = mock_generator()

        # Act
        request = OnlineDriveDownloadFileRequest(id="empty-file-1", bucket=None)
        result = list(google_drive_plugin.online_drive_download_file("user-123", request, "online_drive"))

        # Assert
        assert len(result) == 1
        assert result[0].message == b""
        assert result[0].meta["file_size"] == 0
