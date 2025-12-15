import unittest
from unittest.mock import MagicMock, patch

from models.dataset import Dataset, Document
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataDetail,
    MetadataOperationData,
)
from services.metadata_service import MetadataService


class TestMetadataPartialUpdate(unittest.TestCase):
    def setUp(self):
        self.dataset = MagicMock(spec=Dataset)
        self.dataset.id = "dataset_id"
        self.dataset.built_in_field_enabled = False

        self.document = MagicMock(spec=Document)
        self.document.id = "doc_id"
        self.document.doc_metadata = {"existing_key": "existing_value"}
        self.document.data_source_type = "upload_file"

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.current_account_with_tenant")
    @patch("services.metadata_service.redis_client")
    def test_partial_update_merges_metadata(self, mock_redis, mock_current_account, mock_document_service, mock_db):
        # Setup mocks
        mock_redis.get.return_value = None
        mock_document_service.get_document.return_value = self.document
        mock_current_account.return_value = (MagicMock(id="user_id"), "tenant_id")

        # Mock DB query for existing bindings

        # No existing binding for new key
        mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

        # Input data
        operation = DocumentMetadataOperation(
            document_id="doc_id",
            metadata_list=[MetadataDetail(id="new_meta_id", name="new_key", value="new_value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        # Execute
        MetadataService.update_documents_metadata(self.dataset, metadata_args)

        # Verify
        # 1. Check that doc_metadata contains BOTH existing and new keys
        expected_metadata = {"existing_key": "existing_value", "new_key": "new_value"}
        assert self.document.doc_metadata == expected_metadata

        # 2. Check that existing bindings were NOT deleted
        # The delete call in the original code: db.session.query(...).filter_by(...).delete()
        # In partial update, this should NOT be called.
        mock_db.session.query.return_value.filter_by.return_value.delete.assert_not_called()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.current_account_with_tenant")
    @patch("services.metadata_service.redis_client")
    def test_full_update_replaces_metadata(self, mock_redis, mock_current_account, mock_document_service, mock_db):
        # Setup mocks
        mock_redis.get.return_value = None
        mock_document_service.get_document.return_value = self.document
        mock_current_account.return_value = (MagicMock(id="user_id"), "tenant_id")

        # Input data (partial_update=False by default)
        operation = DocumentMetadataOperation(
            document_id="doc_id",
            metadata_list=[MetadataDetail(id="new_meta_id", name="new_key", value="new_value")],
            partial_update=False,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        # Execute
        MetadataService.update_documents_metadata(self.dataset, metadata_args)

        # Verify
        # 1. Check that doc_metadata contains ONLY the new key
        expected_metadata = {"new_key": "new_value"}
        assert self.document.doc_metadata == expected_metadata

        # 2. Check that existing bindings WERE deleted
        # In full update (default), we expect the existing bindings to be cleared.
        mock_db.session.query.return_value.filter_by.return_value.delete.assert_called()

    @patch("services.metadata_service.db")
    @patch("services.metadata_service.DocumentService")
    @patch("services.metadata_service.current_account_with_tenant")
    @patch("services.metadata_service.redis_client")
    def test_partial_update_skips_existing_binding(
        self, mock_redis, mock_current_account, mock_document_service, mock_db
    ):
        # Setup mocks
        mock_redis.get.return_value = None
        mock_document_service.get_document.return_value = self.document
        mock_current_account.return_value = (MagicMock(id="user_id"), "tenant_id")

        # Mock DB query to return an existing binding
        # This simulates that the document ALREADY has the metadata we are trying to add
        mock_existing_binding = MagicMock()
        mock_db.session.query.return_value.filter_by.return_value.first.return_value = mock_existing_binding

        # Input data
        operation = DocumentMetadataOperation(
            document_id="doc_id",
            metadata_list=[MetadataDetail(id="existing_meta_id", name="existing_key", value="existing_value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        # Execute
        MetadataService.update_documents_metadata(self.dataset, metadata_args)

        # Verify
        # We verify that db.session.add was NOT called for DatasetMetadataBinding
        # Since we can't easily check "not called with specific type" on the generic add method without complex logic,
        # we can check if the number of add calls is 1 (only for the document update) instead of 2 (document + binding)

        # Expected calls:
        # 1. db.session.add(document)
        # 2. NO db.session.add(binding) because it exists

        # Note: In the code, db.session.add is called for document.
        # Then loop over metadata_list.
        # If existing_binding found, continue.
        # So binding add should be skipped.

        # Let's filter the calls to add to see what was added
        add_calls = mock_db.session.add.call_args_list
        added_objects = [call.args[0] for call in add_calls]

        # Check that no DatasetMetadataBinding was added
        from models.dataset import DatasetMetadataBinding

        has_binding_add = any(
            isinstance(obj, DatasetMetadataBinding)
            or (isinstance(obj, MagicMock) and getattr(obj, "__class__", None) == DatasetMetadataBinding)
            for obj in added_objects
        )

        # Since we mock everything, checking isinstance might be tricky if DatasetMetadataBinding
        # is not the exact class used in the service (imports match).
        # But we can check the count.
        # If it were added, there would be 2 calls. If skipped, 1 call.
        assert mock_db.session.add.call_count == 1


if __name__ == "__main__":
    unittest.main()
