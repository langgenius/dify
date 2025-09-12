import unittest
from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.file import File, FileTransferMethod, FileType
from extensions.ext_database import db
from factories.file_factory import StorageKeyLoader
from models import ToolFile, UploadFile
from models.enums import CreatorUserRole


@pytest.mark.usefixtures("flask_req_ctx_with_containers")
class TestStorageKeyLoader(unittest.TestCase):
    """
    Integration tests for StorageKeyLoader class.

    Tests the batched loading of storage keys from the database for files
    with different transfer methods: LOCAL_FILE, REMOTE_URL, and TOOL_FILE.
    """

    def setUp(self):
        """Set up test data before each test method."""
        self.session = db.session()
        self.tenant_id = str(uuid4())
        self.user_id = str(uuid4())
        self.conversation_id = str(uuid4())

        # Create test data that will be cleaned up after each test
        self.test_upload_files = []
        self.test_tool_files = []

        # Create StorageKeyLoader instance
        self.loader = StorageKeyLoader(self.session, self.tenant_id)

    def tearDown(self):
        """Clean up test data after each test method."""
        self.session.rollback()

    def _create_upload_file(
        self, file_id: str | None = None, storage_key: str | None = None, tenant_id: str | None = None
    ) -> UploadFile:
        """Helper method to create an UploadFile record for testing."""
        if file_id is None:
            file_id = str(uuid4())
        if storage_key is None:
            storage_key = f"test_storage_key_{uuid4()}"
        if tenant_id is None:
            tenant_id = self.tenant_id

        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type="local",
            key=storage_key,
            name="test_file.txt",
            size=1024,
            extension=".txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=self.user_id,
            created_at=datetime.now(UTC),
            used=False,
        )
        upload_file.id = file_id

        self.session.add(upload_file)
        self.session.flush()
        self.test_upload_files.append(upload_file)

        return upload_file

    def _create_tool_file(
        self, file_id: str | None = None, file_key: str | None = None, tenant_id: str | None = None
    ) -> ToolFile:
        """Helper method to create a ToolFile record for testing."""
        if file_id is None:
            file_id = str(uuid4())
        if file_key is None:
            file_key = f"test_file_key_{uuid4()}"
        if tenant_id is None:
            tenant_id = self.tenant_id

        tool_file = ToolFile(
            user_id=self.user_id,
            tenant_id=tenant_id,
            conversation_id=self.conversation_id,
            file_key=file_key,
            mimetype="text/plain",
            original_url="http://example.com/file.txt",
            name="test_tool_file.txt",
            size=2048,
        )
        tool_file.id = file_id

        self.session.add(tool_file)
        self.session.flush()
        self.test_tool_files.append(tool_file)

        return tool_file

    def _create_file(self, related_id: str, transfer_method: FileTransferMethod, tenant_id: str | None = None) -> File:
        """Helper method to create a File object for testing."""
        if tenant_id is None:
            tenant_id = self.tenant_id

        # Set related_id for LOCAL_FILE and TOOL_FILE transfer methods
        file_related_id = None
        remote_url = None

        if transfer_method in (FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE):
            file_related_id = related_id
        elif transfer_method == FileTransferMethod.REMOTE_URL:
            remote_url = "https://example.com/test_file.txt"
            file_related_id = related_id

        return File(
            id=str(uuid4()),  # Generate new UUID for File.id
            tenant_id=tenant_id,
            type=FileType.DOCUMENT,
            transfer_method=transfer_method,
            related_id=file_related_id,
            remote_url=remote_url,
            filename="test_file.txt",
            extension=".txt",
            mime_type="text/plain",
            size=1024,
            storage_key="initial_key",
        )

    def test_load_storage_keys_local_file(self):
        """Test loading storage keys for LOCAL_FILE transfer method."""
        # Create test data
        upload_file = self._create_upload_file()
        file = self._create_file(related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)

        # Load storage keys
        self.loader.load_storage_keys([file])

        # Verify storage key was loaded correctly
        assert file._storage_key == upload_file.key

    def test_load_storage_keys_remote_url(self):
        """Test loading storage keys for REMOTE_URL transfer method."""
        # Create test data
        upload_file = self._create_upload_file()
        file = self._create_file(related_id=upload_file.id, transfer_method=FileTransferMethod.REMOTE_URL)

        # Load storage keys
        self.loader.load_storage_keys([file])

        # Verify storage key was loaded correctly
        assert file._storage_key == upload_file.key

    def test_load_storage_keys_tool_file(self):
        """Test loading storage keys for TOOL_FILE transfer method."""
        # Create test data
        tool_file = self._create_tool_file()
        file = self._create_file(related_id=tool_file.id, transfer_method=FileTransferMethod.TOOL_FILE)

        # Load storage keys
        self.loader.load_storage_keys([file])

        # Verify storage key was loaded correctly
        assert file._storage_key == tool_file.file_key

    def test_load_storage_keys_mixed_methods(self):
        """Test batch loading with mixed transfer methods."""
        # Create test data for different transfer methods
        upload_file1 = self._create_upload_file()
        upload_file2 = self._create_upload_file()
        tool_file = self._create_tool_file()

        file1 = self._create_file(related_id=upload_file1.id, transfer_method=FileTransferMethod.LOCAL_FILE)
        file2 = self._create_file(related_id=upload_file2.id, transfer_method=FileTransferMethod.REMOTE_URL)
        file3 = self._create_file(related_id=tool_file.id, transfer_method=FileTransferMethod.TOOL_FILE)

        files = [file1, file2, file3]

        # Load storage keys
        self.loader.load_storage_keys(files)

        # Verify all storage keys were loaded correctly
        assert file1._storage_key == upload_file1.key
        assert file2._storage_key == upload_file2.key
        assert file3._storage_key == tool_file.file_key

    def test_load_storage_keys_empty_list(self):
        """Test with empty file list."""
        # Should not raise any exceptions
        self.loader.load_storage_keys([])

    def test_load_storage_keys_tenant_mismatch(self):
        """Test tenant_id validation."""
        # Create file with different tenant_id
        upload_file = self._create_upload_file()
        file = self._create_file(
            related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE, tenant_id=str(uuid4())
        )

        # Should raise ValueError for tenant mismatch
        with pytest.raises(ValueError) as context:
            self.loader.load_storage_keys([file])

        assert "invalid file, expected tenant_id" in str(context.value)

    def test_load_storage_keys_missing_file_id(self):
        """Test with None file.related_id."""
        # Create a file with valid parameters first, then manually set related_id to None
        file = self._create_file(related_id=str(uuid4()), transfer_method=FileTransferMethod.LOCAL_FILE)
        file.related_id = None

        # Should raise ValueError for None file related_id
        with pytest.raises(ValueError) as context:
            self.loader.load_storage_keys([file])

        assert str(context.value) == "file id should not be None."

    def test_load_storage_keys_nonexistent_upload_file_records(self):
        """Test with missing UploadFile database records."""
        # Create file with non-existent upload file id
        non_existent_id = str(uuid4())
        file = self._create_file(related_id=non_existent_id, transfer_method=FileTransferMethod.LOCAL_FILE)

        # Should raise ValueError for missing record
        with pytest.raises(ValueError):
            self.loader.load_storage_keys([file])

    def test_load_storage_keys_nonexistent_tool_file_records(self):
        """Test with missing ToolFile database records."""
        # Create file with non-existent tool file id
        non_existent_id = str(uuid4())
        file = self._create_file(related_id=non_existent_id, transfer_method=FileTransferMethod.TOOL_FILE)

        # Should raise ValueError for missing record
        with pytest.raises(ValueError):
            self.loader.load_storage_keys([file])

    def test_load_storage_keys_invalid_uuid(self):
        """Test with invalid UUID format."""
        # Create a file with valid parameters first, then manually set invalid related_id
        file = self._create_file(related_id=str(uuid4()), transfer_method=FileTransferMethod.LOCAL_FILE)
        file.related_id = "invalid-uuid-format"

        # Should raise ValueError for invalid UUID
        with pytest.raises(ValueError):
            self.loader.load_storage_keys([file])

    def test_load_storage_keys_batch_efficiency(self):
        """Test batched operations use efficient queries."""
        # Create multiple files of different types
        upload_files = [self._create_upload_file() for _ in range(3)]
        tool_files = [self._create_tool_file() for _ in range(2)]

        files = []
        files.extend(
            [self._create_file(related_id=uf.id, transfer_method=FileTransferMethod.LOCAL_FILE) for uf in upload_files]
        )
        files.extend(
            [self._create_file(related_id=tf.id, transfer_method=FileTransferMethod.TOOL_FILE) for tf in tool_files]
        )

        # Mock the session to count queries
        with patch.object(self.session, "scalars", wraps=self.session.scalars) as mock_scalars:
            self.loader.load_storage_keys(files)

            # Should make exactly 2 queries (one for upload_files, one for tool_files)
            assert mock_scalars.call_count == 2

        # Verify all storage keys were loaded correctly
        for i, file in enumerate(files[:3]):
            assert file._storage_key == upload_files[i].key
        for i, file in enumerate(files[3:]):
            assert file._storage_key == tool_files[i].file_key

    def test_load_storage_keys_tenant_isolation(self):
        """Test that tenant isolation works correctly."""
        # Create files for different tenants
        other_tenant_id = str(uuid4())

        # Create upload file for current tenant
        upload_file_current = self._create_upload_file()
        file_current = self._create_file(
            related_id=upload_file_current.id, transfer_method=FileTransferMethod.LOCAL_FILE
        )

        # Create upload file for other tenant (but don't add to cleanup list)
        upload_file_other = UploadFile(
            tenant_id=other_tenant_id,
            storage_type="local",
            key="other_tenant_key",
            name="other_file.txt",
            size=1024,
            extension=".txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=self.user_id,
            created_at=datetime.now(UTC),
            used=False,
        )
        upload_file_other.id = str(uuid4())
        self.session.add(upload_file_other)
        self.session.flush()

        # Create file for other tenant but try to load with current tenant's loader
        file_other = self._create_file(
            related_id=upload_file_other.id, transfer_method=FileTransferMethod.LOCAL_FILE, tenant_id=other_tenant_id
        )

        # Should raise ValueError due to tenant mismatch
        with pytest.raises(ValueError) as context:
            self.loader.load_storage_keys([file_other])

        assert "invalid file, expected tenant_id" in str(context.value)

        # Current tenant's file should still work
        self.loader.load_storage_keys([file_current])
        assert file_current._storage_key == upload_file_current.key

    def test_load_storage_keys_mixed_tenant_batch(self):
        """Test batch with mixed tenant files (should fail on first mismatch)."""
        # Create files for current tenant
        upload_file_current = self._create_upload_file()
        file_current = self._create_file(
            related_id=upload_file_current.id, transfer_method=FileTransferMethod.LOCAL_FILE
        )

        # Create file for different tenant
        other_tenant_id = str(uuid4())
        file_other = self._create_file(
            related_id=str(uuid4()), transfer_method=FileTransferMethod.LOCAL_FILE, tenant_id=other_tenant_id
        )

        # Should raise ValueError on tenant mismatch
        with pytest.raises(ValueError) as context:
            self.loader.load_storage_keys([file_current, file_other])

        assert "invalid file, expected tenant_id" in str(context.value)

    def test_load_storage_keys_duplicate_file_ids(self):
        """Test handling of duplicate file IDs in the batch."""
        # Create upload file
        upload_file = self._create_upload_file()

        # Create two File objects with same related_id
        file1 = self._create_file(related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)
        file2 = self._create_file(related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)

        # Should handle duplicates gracefully
        self.loader.load_storage_keys([file1, file2])

        # Both files should have the same storage key
        assert file1._storage_key == upload_file.key
        assert file2._storage_key == upload_file.key

    def test_load_storage_keys_session_isolation(self):
        """Test that the loader uses the provided session correctly."""
        # Create test data
        upload_file = self._create_upload_file()
        file = self._create_file(related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)

        # Create loader with different session (same underlying connection)

        with Session(bind=db.engine) as other_session:
            other_loader = StorageKeyLoader(other_session, self.tenant_id)
            with pytest.raises(ValueError):
                other_loader.load_storage_keys([file])
