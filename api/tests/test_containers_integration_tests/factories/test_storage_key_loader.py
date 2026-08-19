from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.app.file_access import DatabaseFileAccessController
from extensions.ext_database import db
from extensions.storage.storage_type import StorageType
from factories.file_factory import StorageKeyLoader
from graphon.file import File, FileTransferMethod, FileType
from models import ToolFile, UploadFile
from models.enums import CreatorUserRole


@pytest.mark.usefixtures("flask_req_ctx_with_containers")
class TestStorageKeyLoader:
    """
    Integration tests for StorageKeyLoader class.

    Tests the batched loading of storage keys from the database for files
    with different transfer methods: LOCAL_FILE, REMOTE_URL, and TOOL_FILE.
    """

    # ------------------------------------------------------------------
    # Per-test helpers (use db_session_with_containers as parameter)
    # ------------------------------------------------------------------

    @staticmethod
    def _create_upload_file(
        session: Session,
        tenant_id: str,
        user_id: str,
        *,
        file_id: str | None = None,
        storage_key: str | None = None,
        override_tenant_id: str | None = None,
    ) -> UploadFile:
        """Create and flush an UploadFile record for testing."""
        upload_file = UploadFile(
            tenant_id=override_tenant_id if override_tenant_id is not None else tenant_id,
            storage_type=StorageType.LOCAL,
            key=storage_key or f"test_storage_key_{uuid4()}",
            name="test_file.txt",
            size=1024,
            extension=".txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=user_id,
            created_at=datetime.now(UTC),
            used=False,
        )
        upload_file.id = file_id or str(uuid4())
        session.add(upload_file)
        session.flush()
        return upload_file

    @staticmethod
    def _create_tool_file(
        session: Session,
        tenant_id: str,
        user_id: str,
        conversation_id: str,
        *,
        file_id: str | None = None,
        file_key: str | None = None,
        override_tenant_id: str | None = None,
    ) -> ToolFile:
        """Create and flush a ToolFile record for testing."""
        tool_file = ToolFile(
            user_id=user_id,
            tenant_id=override_tenant_id if override_tenant_id is not None else tenant_id,
            conversation_id=conversation_id,
            file_key=file_key or f"test_file_key_{uuid4()}",
            mimetype="text/plain",
            original_url="http://example.com/file.txt",
            name="test_tool_file.txt",
            size=2048,
        )
        tool_file.id = file_id or str(uuid4())
        session.add(tool_file)
        session.flush()
        return tool_file

    @staticmethod
    def _create_file(
        tenant_id: str,
        related_id: str,
        transfer_method: FileTransferMethod,
        *,
        override_tenant_id: str | None = None,
    ) -> File:
        """Build a File value-object for testing."""
        remote_url = "https://example.com/test_file.txt" if transfer_method == FileTransferMethod.REMOTE_URL else None
        return File(
            file_id=str(uuid4()),
            tenant_id=override_tenant_id if override_tenant_id is not None else tenant_id,
            file_type=FileType.DOCUMENT,
            transfer_method=transfer_method,
            related_id=related_id,
            remote_url=remote_url,
            filename="test_file.txt",
            extension=".txt",
            mime_type="text/plain",
            size=1024,
            storage_key="initial_key",
        )

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------

    def test_load_storage_keys_local_file(self, db_session_with_containers: Session):
        """Test loading storage keys for LOCAL_FILE transfer method."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file = self._create_file(tenant_id, related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        loader.load_storage_keys([file])

        assert file._storage_key == upload_file.key

    def test_load_storage_keys_remote_url(self, db_session_with_containers: Session):
        """Test loading storage keys for REMOTE_URL transfer method."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file = self._create_file(tenant_id, related_id=upload_file.id, transfer_method=FileTransferMethod.REMOTE_URL)

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        loader.load_storage_keys([file])

        assert file._storage_key == upload_file.key

    def test_load_storage_keys_tool_file(self, db_session_with_containers: Session):
        """Test loading storage keys for TOOL_FILE transfer method."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        conversation_id = str(uuid4())

        tool_file = self._create_tool_file(db_session_with_containers, tenant_id, user_id, conversation_id)
        file = self._create_file(tenant_id, related_id=tool_file.id, transfer_method=FileTransferMethod.TOOL_FILE)

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        loader.load_storage_keys([file])

        assert file._storage_key == tool_file.file_key

    def test_load_storage_keys_mixed_methods(self, db_session_with_containers: Session):
        """Test batch loading with mixed transfer methods."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        conversation_id = str(uuid4())

        upload_file1 = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        upload_file2 = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        tool_file = self._create_tool_file(db_session_with_containers, tenant_id, user_id, conversation_id)

        file1 = self._create_file(tenant_id, related_id=upload_file1.id, transfer_method=FileTransferMethod.LOCAL_FILE)
        file2 = self._create_file(tenant_id, related_id=upload_file2.id, transfer_method=FileTransferMethod.REMOTE_URL)
        file3 = self._create_file(tenant_id, related_id=tool_file.id, transfer_method=FileTransferMethod.TOOL_FILE)

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        loader.load_storage_keys([file1, file2, file3])

        assert file1._storage_key == upload_file1.key
        assert file2._storage_key == upload_file2.key
        assert file3._storage_key == tool_file.file_key

    def test_load_storage_keys_empty_list(self, db_session_with_containers: Session):
        """Test with empty file list — should not raise."""
        tenant_id = str(uuid4())
        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        loader.load_storage_keys([])

    def test_load_storage_keys_ignores_legacy_file_tenant_id(self, db_session_with_containers: Session):
        """Legacy file tenant_id should not override the loader tenant scope."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file = self._create_file(
            tenant_id,
            related_id=upload_file.id,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            override_tenant_id=str(uuid4()),
        )

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        loader.load_storage_keys([file])

        assert file._storage_key == upload_file.key

    def test_load_storage_keys_missing_file_id(self, db_session_with_containers: Session):
        """Test with None file.related_id — should raise ValueError."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file = self._create_file(tenant_id, related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)
        file.related_id = None

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        with pytest.raises(ValueError, match="file id should not be None."):
            loader.load_storage_keys([file])

    def test_load_storage_keys_nonexistent_upload_file_records(self, db_session_with_containers: Session):
        """Test with missing UploadFile database records — should raise ValueError."""
        tenant_id = str(uuid4())
        file = self._create_file(tenant_id, related_id=str(uuid4()), transfer_method=FileTransferMethod.LOCAL_FILE)

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        with pytest.raises(ValueError):
            loader.load_storage_keys([file])

    def test_load_storage_keys_nonexistent_tool_file_records(self, db_session_with_containers: Session):
        """Test with missing ToolFile database records — should raise ValueError."""
        tenant_id = str(uuid4())
        file = self._create_file(tenant_id, related_id=str(uuid4()), transfer_method=FileTransferMethod.TOOL_FILE)

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        with pytest.raises(ValueError):
            loader.load_storage_keys([file])

    def test_load_storage_keys_invalid_uuid(self, db_session_with_containers: Session):
        """Test with invalid UUID format — should raise ValueError."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file = self._create_file(tenant_id, related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)
        file.related_id = "invalid-uuid-format"

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        with pytest.raises(ValueError):
            loader.load_storage_keys([file])

    def test_load_storage_keys_batch_efficiency(self, db_session_with_containers: Session):
        """Batched operations should issue exactly 2 queries for mixed file types."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        conversation_id = str(uuid4())

        upload_files = [self._create_upload_file(db_session_with_containers, tenant_id, user_id) for _ in range(3)]
        tool_files = [
            self._create_tool_file(db_session_with_containers, tenant_id, user_id, conversation_id) for _ in range(2)
        ]

        files = [
            self._create_file(tenant_id, related_id=uf.id, transfer_method=FileTransferMethod.LOCAL_FILE)
            for uf in upload_files
        ] + [
            self._create_file(tenant_id, related_id=tf.id, transfer_method=FileTransferMethod.TOOL_FILE)
            for tf in tool_files
        ]

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        with patch.object(
            db_session_with_containers, "scalars", wraps=db_session_with_containers.scalars
        ) as mock_scalars:
            loader.load_storage_keys(files)
            # Exactly 2 DB round-trips: one for UploadFile, one for ToolFile
            assert mock_scalars.call_count == 2

        for i, file in enumerate(files[:3]):
            assert file._storage_key == upload_files[i].key
        for i, file in enumerate(files[3:]):
            assert file._storage_key == tool_files[i].file_key

    def test_load_storage_keys_tenant_isolation(self, db_session_with_containers: Session):
        """Loader should not surface records belonging to a different tenant."""
        tenant_id = str(uuid4())
        other_tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file_current = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file_current = self._create_file(
            tenant_id, related_id=upload_file_current.id, transfer_method=FileTransferMethod.LOCAL_FILE
        )

        upload_file_other = self._create_upload_file(
            db_session_with_containers,
            tenant_id,
            user_id,
            override_tenant_id=other_tenant_id,
        )
        file_other = self._create_file(
            tenant_id,
            related_id=upload_file_other.id,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            override_tenant_id=other_tenant_id,
        )

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )

        with pytest.raises(ValueError, match="Upload file not found for id:"):
            loader.load_storage_keys([file_other])

        # Current-tenant file still resolves correctly
        loader.load_storage_keys([file_current])
        assert file_current._storage_key == upload_file_current.key

    def test_load_storage_keys_mixed_tenant_batch(self, db_session_with_containers: Session):
        """A batch containing a foreign-tenant file should fail on the mismatch."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file_current = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file_current = self._create_file(
            tenant_id, related_id=upload_file_current.id, transfer_method=FileTransferMethod.LOCAL_FILE
        )
        file_other = self._create_file(
            tenant_id,
            related_id=str(uuid4()),
            transfer_method=FileTransferMethod.LOCAL_FILE,
            override_tenant_id=str(uuid4()),
        )

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        with pytest.raises(ValueError, match="Upload file not found for id:"):
            loader.load_storage_keys([file_current, file_other])

    def test_load_storage_keys_duplicate_file_ids(self, db_session_with_containers: Session):
        """Duplicate file IDs in the batch should be handled gracefully."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file1 = self._create_file(tenant_id, related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)
        file2 = self._create_file(tenant_id, related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)

        loader = StorageKeyLoader(
            db_session_with_containers, tenant_id, access_controller=DatabaseFileAccessController()
        )
        loader.load_storage_keys([file1, file2])

        assert file1._storage_key == upload_file.key
        assert file2._storage_key == upload_file.key

    def test_load_storage_keys_session_isolation(self, db_session_with_containers: Session):
        """A loader backed by an uncommitted session should not see data from another session."""
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        upload_file = self._create_upload_file(db_session_with_containers, tenant_id, user_id)
        file = self._create_file(tenant_id, related_id=upload_file.id, transfer_method=FileTransferMethod.LOCAL_FILE)

        # A loader with a fresh, separate session cannot see uncommitted rows from db_session_with_containers
        with Session(bind=db.engine) as other_session:
            other_loader = StorageKeyLoader(
                other_session,
                tenant_id,
                access_controller=DatabaseFileAccessController(),
            )
            with pytest.raises(ValueError):
                other_loader.load_storage_keys([file])
